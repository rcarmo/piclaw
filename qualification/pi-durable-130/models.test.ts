import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Harness, createRegistry, defineExtension, defineTool } from "../../runtime/durable-engine/qualification/durable.ts";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/index.js";
import { context as durableContext } from "./src/fixture.js";
import { createHash } from "node:crypto";
import type { ModelRuntime as HostRuntime } from "../../node_modules/@earendil-works/pi-coding-agent";
import type { Credential, CredentialStore, Model, TranscriptContext as HostTranscript, AssistantMessage } from "../../node_modules/@earendil-works/pi-ai";
import type { Models, ImageModel, ClassifierModel, Api, ImageApi, ClassifierApi, SimpleStreamOptions } from "../../runtime/durable-engine/qualification/ai.ts";
import { createHostModels, type HostModelPolicy } from "../../runtime/durable-engine/src/index.js";
import { modelFailureDetail, parseModelFailure } from "../../runtime/durable-engine/src/host-model-failure.js";
import type { HostModelEventObserver } from "../../runtime/durable-engine/src/host-models.js";
import { HostCodexModelServices } from '../../runtime/durable-engine/src/host-codex-model-services.js';
import { addLogSink, removeLogSink, type LogRecord } from "../../runtime/src/utils/logger.js";

// These ESM-only public exports have no require condition; resolve from root.
const root = new URL("../../package.json", import.meta.url).href;
const { ModelRuntime }: typeof import("../../node_modules/@earendil-works/pi-coding-agent") =
  await import(import.meta.resolve("@earendil-works/pi-coding-agent", root));
const { createAssistantMessageEventStream }: typeof import("../../node_modules/@earendil-works/pi-ai") =
  await import(import.meta.resolve("@earendil-works/pi-ai", root));
import { Type, normalizeContext } from "../../runtime/durable-engine/qualification/ai.ts";
const ref = { provider: "qualification-provider", id: "qualification-model" };
const token = "SYNTHETIC-HOST-ONLY-TOKEN";
// Protocol-only fixture snapshot. Real durable receipt/storage tests are separate.
const fixtureTerminalReceipt = async (message: AssistantMessage) => structuredClone(message);
const model: Model<"openai-completions"> = { ...ref, name: "Qualification", api: "openai-completions",
  baseUrl: "https://fixture.invalid", input: ["text"], reasoning: true,
  contextWindow: 10000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
async function bounded<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Fixture barrier not reached within 1500ms")), 1500);
    })]);
  } finally { clearTimeout(timer); }
}
async function fixture(multimodal = false, keyless = false, deferred = false, imageInput = false, terminalError: boolean | "invalid-usage" | "wrong-owner" | "wrong-response" | "retry-once" | "retry-always" = false, errorText = token) {
  const physical = { ...model, input: imageInput ? ["text", "image"] as Model<Api>["input"] : ["text"] as Model<Api>["input"] };
  let stored: Credential | undefined = { type: "api_key", key: token };
  const requested: string[] = [];
  const credentials: CredentialStore = {
    read: async (id) => {
      // Fail before any built-in provider can consult ambient credentials.
      if (id !== ref.provider) throw new Error("Non-fixture auth forbidden");
      requested.push(id); return stored;
    },
    list: async () => stored ? [{ providerId: ref.provider, type: stored.type }] : [],
    modify: async (_id, fn) => { stored = await fn(stored); return stored; },
    delete: async () => { stored = undefined; },
  };
  const runtime: HostRuntime = await ModelRuntime.create({ credentials, modelsPath: null,
    modelsStore: { read: async () => undefined, write: async () => {}, delete: async () => {} },
    allowModelNetwork: false, refreshOnCreate: false });
  const entered = barrier();
  const held = barrier(), providerClosed = barrier();
  let hold = false;
  let fail = false;
  let calls = 0;
  let finalDelta = false, resultOnly = false, heldProvider = false;
  let approved = true;
  let budget = true;
  let captured: any;
  let checks = 0;
  const admissions: string[] = [];
  let onFence = () => {};
  const generation = new AbortController();
  let eventObserver: HostModelEventObserver["onEvent"] | undefined, eventGuard = () => {};
  const check = () => { if (!approved || !budget) throw new Error("Policy denied"); };
  const policy: HostModelPolicy = { signal: generation.signal,
    captureEventObserver: () => eventObserver ? { assertCurrent() { return eventGuard(); }, onEvent(event) { return eventObserver!(event); } } : undefined,
    authorize: async (owner, kind) => { admissions.push(`${owner.provider}/${owner.id}/${kind}`); check(); }, assertCurrent: () => { check(); if (++checks === 2) onFence(); } };
  const message: AssistantMessage = { role: "assistant", api: model.api, provider: ref.provider,
    model: ref.id, thinkingLevel: "high", timestamp: Date.now(), stopReason: "toolUse",
    content: [{ type: "thinking", thinking: "synthetic reasoning" },
      { type: "toolCall", id: "call-1", name: "fixture_tool", arguments: { value: 7 } }],
    usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  const privateHandle = { provider: ref.provider, modelId: ref.id, api: model.api, id: "private-provider-id",
    data: { token, conversion: "host-private" }, ...{ privateMarker: "host-private-marker" } };
  // Synthetic host authority hashes an internal operation ID, never provider conversion data.
  const reference = { provider: ref.provider, modelId: ref.id, api: model.api,
    id: createHash("sha256").update("synthetic-owner/synthetic-operation").digest("hex") };
  let known = false;
  let cleanup = false;
  let ownerAllowed = true;
  if (deferred) policy.deferred = {
    signal: generation.signal,
    project: (raw) => { expect(raw).toBe(privateHandle); known = true; return reference; },
    resolve: (handle) => {
      if (!known || JSON.stringify(handle) !== JSON.stringify(reference) || !ownerAllowed) throw new Error(token);
      return privateHandle;
    },
    authorize: async (_owner, kind) => { admissions.push(kind); if (!(kind === "cancelDeferred" && cleanup)) check(); },
    assertCurrent: (_owner, kind) => { if (!ownerAllowed) throw new Error(token); if (!(kind === "cancelDeferred" && cleanup)) check(); },
  };
  const run = (owner: Model<Api>, context: HostTranscript, options?: unknown) => {
    calls++; captured = { owner, context, options };
    const stream = createAssistantMessageEventStream();
    const result = deferred ? { ...message, stopReason: "deferred" as const, deferred: privateHandle } : structuredClone(message);
    if (finalDelta) stream.push({ type: "text_delta", contentIndex: 0, delta: "final delta", partial: result });
    if (heldProvider) {
      const signal = captured.options.signal;
      if (!(signal instanceof AbortSignal)) throw Error("Synthetic provider signal required");
      const cancelled = () => {
        const aborted = { ...result, stopReason: "aborted" as const, errorMessage: "synthetic transport cancelled" };
        stream.push({ type: "error", reason: "aborted", error: aborted }); stream.end(aborted); providerClosed.release();
      };
      signal.addEventListener("abort", cancelled, { once: true });
      if (signal.aborted) cancelled();
      return stream;
    }
    if (terminalError && terminalError !== "retry-once" && terminalError !== "retry-always" || terminalError === "retry-once" && calls === 2 || terminalError === "retry-always" && calls >= 2) {
      const error: AssistantMessage = { ...message, content: [], stopReason: "error" as const, errorMessage: errorText,
        usage: { ...message.usage, cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 } } };
      if (terminalError === "retry-once" || terminalError === "retry-always") error.usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
      if (terminalError === "invalid-usage") error.usage.cost.total = -1;
      if (terminalError === "wrong-owner") error.provider = "different-provider";
      if (terminalError === "wrong-response") error.responseModel = "different-model";
      if (!resultOnly) stream.push({ type: "error", reason: "error", error });
      stream.end(error); return stream;
    }
    if (terminalError === "retry-once" && calls >= 3) { result.stopReason = "stop"; result.content = [{ type: "text", text: "continued after retained failure" }]; }
    if (deferred) stream.push({ type: "start", partial: result });
    if (!resultOnly) stream.push({ type: "done", reason: result.stopReason as "toolUse" | "deferred", message: result });
    stream.end(result);
    return stream;
  };
  const image: ImageModel<ImageApi> = { ...model, type: "image", api: "synthetic-images", output: ["image", "text"],
    headers: { Authorization: token }, inputLimits: { maxRequestBytes: 10000,
      images: { maxPerRequest: 2, resize: { maxWidth: 512, ...{ credential: token } }, ...{ token } }, ...{ token } },
    cost: { ...model.cost, ...{ token } } };
  const classifier: ClassifierModel<ClassifierApi> = { ...image, type: "classifier", api: "synthetic-classifier", contextWindow: 2048 };
  const oneShot = (owner: unknown, ctx: unknown, options: unknown) => { calls++; captured = { owner, context: ctx, options }; };
  const unapproved = { ...model, id: "unapproved-model" };
  runtime.registerNativeProvider({ id: ref.provider, name: "Synthetic", getModels: () => [physical, unapproved],
    getAllModels: () => multimodal ? [physical, unapproved, image, classifier] : [physical, unapproved],
    generateImages: async (owner, ctx, options) => {
      oneShot(owner, ctx, options);
      if (fail) throw new Error(token);
      return { api: owner.api, provider: owner.provider, model: owner.id, stopReason: "stop", timestamp: 2,
        output: [{ type: "image", data: "c3ludGhldGlj", mimeType: "image/png", ...{ token } }, { type: "text", text: "synthetic" }],
        usage: { ...message.usage, cost: { ...message.usage.cost, total: 0.25, ...{ token } } },
        ...{ token, cause: token, errorMessage: token } };
    },
    classify: async (owner, ctx, options) => {
      oneShot(owner, ctx, options);
      if (fail) throw new Error(token);
      return { api: owner.api, provider: owner.provider, model: owner.id, stopReason: "stop", timestamp: 2,
        answers: { valid: { type: "bool", probability: 0.9, ...{ token } },
          pick: { type: "choice", choice: "yes", probabilities: { yes: 0.8, no: 0.2 }, confidence: 0.8 },
          score: { type: "score", score: 0.7, confidence: 0.6 } }, usage: message.usage,
        ...{ token, cause: token, errorMessage: token } };
    },
    fetchDeferred: (owner, handle, options) => {
      expect(handle).toBe(privateHandle);
      oneShot(owner, handle, options);
      if (fail) throw new Error(token);
      const stream = createAssistantMessageEventStream();
      const result = { ...message, stopReason: "stop" as const };
      stream.push({ type: "done", reason: "stop", message: result }); stream.end(result); return stream;
    },
    cancelDeferred: async (owner, handle, options) => {
      expect(handle).toBe(privateHandle); oneShot(owner, handle, options);
      if (fail) throw new Error(token);
    },
    auth: { apiKey: { name: "Synthetic", check: async () => ({ type: "api_key" }),
      resolve: async ({ credential }) => {
        if (hold) { entered.release(); await held.promise; }
        if (fail) throw new Error(token);
        if (keyless) return { auth: {}, source: "synthetic-keyless" };
        return credential?.key ? { auth: { apiKey: credential.key, headers: { Authorization: `Bearer ${credential.key}` } } } : undefined;
      } } }, stream: run, streamSimple: run });
  if (deferred) runtime.registerNativeProvider({ id: "unapproved-provider", name: "Unapproved",
    getModels: () => [{ ...unapproved, provider: "unapproved-provider" }],
    auth: {}, stream: run, streamSimple: run });
  const approvedModels = multimodal ? [ref, { ...ref, type: "image" as const }, { ...ref, type: "classifier" as const }] : [ref];
  const models: Models = createHostModels(runtime, approvedModels, policy);
  return { runtime, models, policy, requested, message, entered, held, admissions,
    model: models.getModel(ref.provider, ref.id)!,
    calls: () => calls, captured: () => captured,
    cleanup: () => { cleanup = true; }, denyOwner: () => { ownerAllowed = false; },
    hold: () => { hold = true; }, fail: () => { fail = true; },
    finalDelta: () => { finalDelta = true; message.content.unshift({ type: "text", text: "final delta" }); },
    resultOnly: () => { resultOnly = true; },
    holdUntilAbort: () => { heldProvider = true; finalDelta = true; message.content.unshift({ type: "text", text: "final delta" }); },
    providerClosed,
    observe: (observer: HostModelEventObserver["onEvent"]) => { eventObserver = observer; },
    eventAuthority: (check: () => void) => { eventGuard = check; },
    revoke: () => { approved = false; }, exhaust: () => { budget = false; },
    abort: () => generation.abort(), onFence: (fn: () => void) => { onFence = fn; } };
}
const context = { messages: [{ role: "user" as const, content: "fixture", timestamp: 1 }],
  tools: [{ name: "fixture_tool", description: "fixture", parameters: { type: "object" as const } }] };

async function storedOutcomeFixture(failed = false) {
  const f = await fixture();
  // Provider registration schedules its initial credential availability refresh.
  // Measure request-time access separately from construction of the host runtime.
  await Bun.sleep(0); f.requested.length = 0;
  const stored: AssistantMessage = structuredClone(f.message);
  if (failed) {
    stored.stopReason = 'error'; stored.content = [];
    stored.errorMessage = modelFailureDetail({ phase: 'provider', category: 'transport' });
  }
  const calls = { source: 0, current: 0, event: 0, observer: 0, authorize: 0, codex: 0, retain: 0, dispatch: 0, settle: 0, abandon: 0 };
  f.policy.captureSourceGuard = () => () => { calls.source++; };
  f.policy.assertStoredOutcomeCurrent = (owner, signal) => { expect(owner).toEqual(ref); signal.throwIfAborted(); calls.current++; };
  f.policy.authorize = async () => { calls.authorize++; throw Error('Stored outcome must not request new spend'); };
  f.policy.codex = new HostCodexModelServices({
    async capture() { calls.codex++; throw Error('Stored outcome must not enter Codex conversion'); },
    assertAccount() { throw Error('Unused Codex account'); }, routingScope() { throw Error('Unused Codex routing'); },
    async observe() { throw Error('Unused Codex output'); }, async flush() { throw Error('Unused Codex flush'); },
  }, { createNativeCodexHooks() { throw Error('Unused Codex hooks'); } });
  f.observe(() => { calls.observer++; }); f.eventAuthority(() => { calls.event++; });
  f.policy.prepareRequest = async () => ({ id: 'exact-receipt', recoveredTerminal: stored,
    async retainTerminal() { calls.retain++; }, async dispatch() { calls.dispatch++; },
    async settle() { calls.settle++; }, async abandon() { calls.abandon++; } });
  return { ...f, stored, recoveredCalls: calls };
}

for (const method of ['stream', 'streamSimple', 'complete', 'completeSimple'] as const) for (const failed of [false, true]) {
  test(`${method}: exact stored outcome bypasses auth, transport, Codex and historical callbacks; failed=${failed}`, async () => {
    const f = await storedOutcomeFixture(failed); f.exhaust();
    const before = JSON.stringify(f.stored), events: string[] = [];
    const value = f.models[method](f.model, context);
    if ('result' in value) for await (const event of value) events.push(event.type);
    const result = 'result' in value ? await value.result() : await value;
    expect(result).toEqual(f.stored); expect(JSON.stringify(f.stored)).toBe(before);
    expect(result).not.toBe(f.stored); expect(result.content).not.toBe(f.stored.content);
    if (failed) expect(parseModelFailure(result.errorMessage)).toEqual({ phase: 'provider', category: 'transport' });
    expect(f.recoveredCalls).toEqual({ source: 3, current: 2, event: 2, observer: 0, authorize: 0, codex: 0, retain: 0, dispatch: 0, settle: 0, abandon: 0 });
    expect(f.calls()).toBe(0); expect(f.requested).toEqual([]);
    if ('result' in value) expect(events).toEqual([failed ? 'error' : 'done']);
  });
}

for (const failed of [false, true]) for (const denial of ['missing', 'async', 'current', 'source', 'event', 'late-event', 'cancel'] as const) {
  test(`stored outcome still requires current synchronous source/model/event authority; denial=${denial}, failed=${failed}`, async () => {
    const f = await storedOutcomeFixture(failed);
    if (denial === 'missing') f.policy.assertStoredOutcomeCurrent = undefined;
    if (denial === 'async') f.policy.assertStoredOutcomeCurrent = async () => { throw Error(token); };
    if (denial === 'current') f.policy.assertStoredOutcomeCurrent = () => { throw Error(token); };
    if (denial === 'source') f.policy.captureSourceGuard = () => () => { if (++f.recoveredCalls.source === 2) throw Error(token); };
    if (denial === 'event' || denial === 'late-event') f.eventAuthority(() => { if (++f.recoveredCalls.event === (denial === 'event' ? 1 : 2)) throw Error(token); });
    if (denial === 'cancel') {
      const prepare = f.policy.prepareRequest!;
      f.policy.prepareRequest = async (...args) => { const result = await prepare(...args); f.abort(); return result; };
    }
    const result = await f.models.completeSimple(f.model, context); await Bun.sleep(0);
    expect(result.stopReason).toBe('error'); expect(result.content).toEqual([]);
    expect(parseModelFailure(result.errorMessage)).toEqual({ phase: 'source', category: failed ? 'transport' : denial === 'cancel' ? 'aborted' : 'unknown' });
    expect(result.usage).toEqual(f.stored.usage); expect(JSON.stringify(result)).not.toContain(token);
    expect(f.calls()).toBe(0); expect(f.requested).toEqual([]);
    expect(f.recoveredCalls.authorize + f.recoveredCalls.codex + f.recoveredCalls.observer + f.recoveredCalls.dispatch + f.recoveredCalls.retain + f.recoveredCalls.settle).toBe(0);
    expect(f.recoveredCalls.abandon).toBe(1);
  });
}

for (const method of ["stream", "streamSimple", "complete", "completeSimple"] as const) {
  test(`${method}: delegates actual host runtime; preserves JSON tool/thinking/options`, async () => {
    const f = await fixture();
    const options = { reasoning: "high" as const, maxTokens: 42, temperature: 0.2 };
    const value = f.models[method](f.model, context, options);
    const result = "result" in value ? await value.result() : await value;
    expect(result.stopReason).toBe("toolUse");
    expect(result.content).toEqual(f.message.content);
    expect(result.model).toBe(ref.id);
    expect(result.thinkingLevel).toBe("high");
    expect(f.calls()).toBe(1);
    expect(f.captured().options).toMatchObject({ ...options, apiKey: token, maxRetries: 0 });
    expect(f.captured().context.messages[0].toolsAdded).toEqual(context.tools);
    expect(f.requested.every((id) => id === ref.provider)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(token);
    const reads = f.requested.length;
    expect(JSON.stringify(await f.models.getAuth(f.model))).not.toContain(token);
    expect((await f.models.getAuth(f.model))?.auth).toEqual({});
    expect(f.requested.length).toBe(reads); // No host auth resolution/cache in 1.3.
    f.abort();
    expect(f.captured().options.signal.aborted).toBe(true);
    expect(JSON.stringify(f.models.getAllModels())).not.toContain("Authorization");
  });
  for (const reason of ["revoke", "exhaust", "abort"] as const) {
    test(`${method}: ${reason} during held host auth prevents fake provider dispatch`, async () => {
      const f = await fixture(); f.hold();
      const value = f.models[method](f.model, context);
      const result = "result" in value ? value.result() : value;
      try { await bounded(f.entered.promise); f[reason](); } finally { f.held.release(); }
      expect((await result).stopReason).toBe("error");
      expect(f.calls()).toBe(0);
    });
  }
}
test("denied approval/budget, auth failure and host logout never select another account", async () => {
  for (const action of ["revoke", "exhaust", "fail", "logout"] as const) {
    const f = await fixture();
    if (action === "logout") await f.runtime.logout(ref.provider); else f[action]();
    const result = await f.models.completeSimple(f.model, context);
    expect(result.stopReason).toBe("error"); expect(f.calls()).toBe(0);
    expect(JSON.stringify(result)).not.toContain(token);
    expect(f.requested.every((id) => id === ref.provider)).toBe(true);
  }
});
test("complete factory interface denies non-chat, deferred, auth UI, overrides and provider bypass", async () => {
  const f = await fixture();
  expect(f.models.getModel(ref.provider, "alternative")).toBeUndefined();
  expect(f.models.getAllModels()).toHaveLength(1);
  expect(await f.models.getAvailableOfType("classifier")).toEqual([]);
  expect(await f.models.getAvailableOfType("image")).toEqual([]);
  const handle = { id: "synthetic", provider: ref.provider, modelId: ref.id, api: f.model.api };
  expect((await f.models.fetchDeferred(f.model, handle)).stopReason).toBe("error");
  expect((await f.models.streamDeferred(f.model, handle).result()).stopReason).toBe("error");
  await expect(f.models.cancelDeferred(f.model, handle)).rejects.toThrow();
  const image: ImageModel<ImageApi> = { ...f.model, type: "image", output: ["image"] };
  const classifier: ClassifierModel<ClassifierApi> = { ...f.model, type: "classifier", compat: undefined };
  expect((await f.models.generateImages(image, { input: [] })).stopReason).toBe("error");
  expect((await f.models.classify(classifier, { state: {}, questions: {} })).stopReason).toBe("error");
  expect(() => f.models.logout(ref.provider)).toThrow();
  expect(() => f.models.login(ref.provider, "api_key", { prompt: async () => token, notify: () => {} })).toThrow();
  for (const options of [{ deferred: true }, { apiKey: "override" },
    { transformHeaders: async () => ({}) }, { onResponse: () => {} }, { maxRetries: 1 }]) {
    expect(() => f.models.streamSimple(f.model, context, options)).toThrow();
  }
  f.revoke();
  const provider = f.models.getProvider(ref.provider)!;
  expect((await provider.streamSimple(f.model, normalizeContext(context)).result()).stopReason).toBe("error");
  expect(f.calls()).toBe(0);
});

for (const kind of ["chat", "image", "classifier"] as const) test(`SDK 1.4 ${kind}: JSON identity crosses, private telemetry and callbacks do not`, async () => {
  const f = await fixture(kind !== "chat");
  const identity = { userAgent: { custom: "synthetic-client" }, attribution: { name: "Synthetic", url: "https://fixture.invalid" }, version: "1" };
  let spanReads = 0;
  const span = new Proxy({}, { get() { spanReads++; throw Error("Private span crossed the bridge"); },
    ownKeys() { spanReads++; throw Error("Private span was serialised"); } }) as NonNullable<SimpleStreamOptions["telemetry"]>;
  const invoke = () => kind === "chat" ? f.models.completeSimple(f.model, context, { identity, telemetry: span })
    : kind === "image" ? f.models.generateImages(f.models.getModelOfType("image", ref.provider, ref.id)!, imageContext, { identity, telemetry: span })
      : f.models.classify(f.models.getModelOfType("classifier", ref.provider, ref.id)!, classifierContext, { identity, telemetry: span });
  expect((await invoke()).stopReason).toBe(kind === "chat" ? "toolUse" : "stop");
  expect(f.calls()).toBe(1);
  expect(f.captured().options.identity).toEqual(identity);
  expect(f.captured().options.telemetry).not.toBe(span);
  expect(spanReads).toBe(0);
  expect(() => f.models.streamSimple(f.model, context, { identity: { version: () => token } } as never)).toThrow("Only JSON data");
  f.revoke();
  expect((await invoke()).stopReason).toBe("error");
  expect(f.calls()).toBe(1); expect(spanReads).toBe(0);
});
test("SDK 1.4 deferred: identity is data, telemetry stays local and exact private handle authority survives", async () => {
  const f = await fixture(false, false, true);
  const identity = { userAgent: "short" as const, attribution: null };
  const span = new Proxy({}, { get() { throw Error("Private deferred span crossed"); }, ownKeys() { throw Error("Private deferred span serialised"); } }) as NonNullable<SimpleStreamOptions["telemetry"]>;
  const first = await f.models.completeSimple(f.model, context, { deferred: true });
  expect(first.stopReason).toBe("deferred");
  expect((await f.models.fetchDeferred(f.model, first.deferred!, { identity, telemetry: span })).stopReason).toBe("stop");
  expect(f.captured().options.identity).toEqual(identity); expect(f.captured().options.telemetry).not.toBe(span);
  await f.models.cancelDeferred(f.model, first.deferred!, { identity, telemetry: span });
  expect(f.captured().options.identity).toEqual(identity); expect(f.captured().options.telemetry).not.toBe(span);
  expect(f.calls()).toBe(3);
});

const imageContext = { input: [{ type: "text" as const, text: "draw synthetic" }] };
const classifierContext = { state: { text: "synthetic", numbers: [1, 2] }, questions: {
  valid: { type: "bool" as const, instructions: "valid?", criteria: { true: "yes", false: "no" } } } };
for (const kind of ["image", "classifier"] as const) {
  const invoke = (f: Awaited<ReturnType<typeof fixture>>, override?: Record<string, unknown>, options?: Record<string, unknown>, direct = false) => {
    const provider = direct ? f.models.getProvider(ref.provider)! : f.models;
    return kind === "image"
      ? provider.generateImages!({ ...f.models.getModelOfType("image", ref.provider, ref.id)!, ...override }, imageContext, options)
      : provider.classify!({ ...f.models.getModelOfType("classifier", ref.provider, ref.id)!, ...override }, classifierContext, options);
  };
  test(`${kind}: public host runtime success, keyless and credential auth, typed options and sanitized cost/results`, async () => {
    for (const keyless of [false, true]) {
      const f = await fixture(true, keyless);
      const options = kind === "image" ? { metadata: { purpose: "fixture" }, timeoutMs: 12 } : { temperature: 0.5, timeoutMs: 12 };
      const result = await invoke(f, undefined, options);
      expect(result.stopReason).toBe("stop");
      expect(f.calls()).toBe(1);
      expect(f.captured().options).toMatchObject({ ...options, maxRetries: 0 });
      expect(f.captured().owner.api).toBe(kind === "image" ? "synthetic-images" : "synthetic-classifier");
      expect(f.captured().context).toEqual(kind === "image" ? imageContext : classifierContext);
      expect(f.admissions).toEqual([`${ref.provider}/${ref.id}/${kind === "image" ? "generateImages" : "classify"}`]);
      expect(JSON.stringify(result)).not.toContain(token);
      expect(result.usage?.totalTokens).toBe(5);
      if ("output" in result) {
        expect(result.output[0]).toEqual({ type: "image", data: "c3ludGhldGlj", mimeType: "image/png" });
        expect(result.usage?.cost.total).toBe(0.25);
      } else expect(result.answers.valid).toEqual({ type: "bool", probability: 0.9 });
      f.abort(); expect(f.captured().options.signal.aborted).toBe(true);
    }
  });
  for (const action of ["revoke", "exhaust", "abort"] as const) {
    test(`${kind}: ${action} before auth and during held auth prevents dispatch`, async () => {
      for (const held of [false, true]) {
        const f = await fixture(true);
        if (held) f.hold(); else f[action]();
        const pending = invoke(f);
        if (held) { try { await bounded(f.entered.promise); f[action](); } finally { f.held.release(); } }
        expect((await pending).stopReason).toBe("error"); expect(f.calls()).toBe(0);
      }
    });
  }
  test(`${kind}: auth failures/logout sanitized; no account fallback`, async () => {
    for (const action of ["fail", "logout"] as const) {
      const f = await fixture(true);
      if (action === "logout") await f.runtime.logout(ref.provider); else f.fail();
      const result = await invoke(f);
      expect(result.stopReason).toBe("error"); expect(f.calls()).toBe(0);
      expect(JSON.stringify(result)).not.toContain(token);
      expect(f.requested.every((id) => id === ref.provider)).toBe(true);
    }
  });
  test(`${kind}: foreign ownership, API/type spoofing and direct provider policy bypass denied`, async () => {
    const f = await fixture(true);
    for (const override of [{ id: "different" }, { provider: "different" }, { api: model.api }, { type: "chat" }]) {
      expect((await invoke(f, override)).stopReason).toBe("error");
    }
    f.revoke(); expect((await invoke(f, undefined, undefined, true)).stopReason).toBe("error");
    expect(f.calls()).toBe(0);
  });
  test(`${kind}: public transforms never execute before policy, even when approved`, async () => {
    for (const denied of [false, true]) {
      const f = await fixture(true);
      if (denied) f.revoke();
      const reads = f.requested.length;
      let callbacks = 0;
      const result = await invoke(f, undefined, { transformHeaders: async () => { callbacks++; return {}; } });
      expect(result.stopReason).toBe("error");
      expect(callbacks).toBe(0);
      expect(f.calls()).toBe(0);
      expect(f.requested.length).toBe(reads);
      expect(f.admissions).toEqual([]);
    }
  });
  test(`${kind}: public and direct allowed option values must be JSON data before admission`, async () => {
    class Invalid { value = 1; }
    const keys = ["timeoutMs", "maxRetryDelayMs", "maxRetries", kind === "image" ? "metadata" : "temperature"];
    for (const direct of [false, true]) {
      const f = await fixture(true);
      for (const key of keys) {
        for (const value of [() => 1, new Invalid(), NaN, Infinity, -Infinity]) {
          expect((await invoke(f, undefined, { [key]: value }, direct)).stopReason).toBe("error");
        }
      }
      expect(f.calls()).toBe(0);
      expect(f.admissions).toEqual([]);
    }
  });
  test(`${kind}: caller abort signal survives public preflight and combines with grant`, async () => {
    const f = await fixture(true);
    const caller = new AbortController();
    expect((await invoke(f, undefined, { signal: caller.signal, maxRetries: 0, maxRetryDelayMs: 0 })).stopReason).toBe("stop");
    expect(f.captured().options.maxRetryDelayMs).toBe(0);
    expect(f.captured().options.signal.aborted).toBe(false);
    caller.abort();
    expect(f.captured().options.signal.aborted).toBe(true);
    const aborted = await fixture(true);
    expect((await invoke(aborted, undefined, { signal: caller.signal })).stopReason).toBe("aborted");
    expect(aborted.calls()).toBe(0);
  });
  test(`${kind}: public model data and false API fail closed without stream fallback`, async () => {
    const f = await fixture(true);
    const reads = f.requested.length;
    for (const override of [{ api: "false-api" }, { extra: () => 1 }, { extra: new Date() }]) {
      expect((await invoke(f, override)).stopReason).toBe("error");
    }
    expect(f.calls()).toBe(0);
    expect(f.requested.length).toBe(reads);
    expect(f.admissions).toEqual([]);
  });
  test(`${kind}: keyless bridge auth describes no credentials, not host authentication`, async () => {
    const f = await fixture(true);
    const owner = f.models.getModelOfType(kind, ref.provider, ref.id)!;
    const reads = f.requested.length;
    const auth = await f.models.getAuth(owner);
    expect(auth?.auth).toEqual({});
    expect(auth?.source).toBe("host-bridge-keyless");
    expect(f.requested.length).toBe(reads);
    f.revoke();
    expect((await invoke(f)).stopReason).toBe("error");
    expect(f.calls()).toBe(0);
  });
  test(`${kind}: raw auth, transforms, retries and other-operation options denied even via provider`, async () => {
    const f = await fixture(true);
    for (const options of [{ apiKey: token }, { headers: { Authorization: token } }, { transformHeaders: () => ({}) },
      { onPayload: () => ({}) }, { maxRetries: 1 }, { deferred: true }, { size: "1024x1024" },
      kind === "image" ? { temperature: 1 } : { metadata: {} }]) {
      expect((await invoke(f, undefined, options, true)).stopReason).toBe("error");
    }
    expect(f.calls()).toBe(0);
  });
}
test("multimodal catalog keeps type-qualified shared IDs immutable, strips nested metadata and does not auto-approve", async () => {
  const f = await fixture(true);
  expect(f.models.getModels()).toHaveLength(1);
  expect(f.models.getAllModels()).toHaveLength(3);
  expect(await f.models.getAvailableOfType("image")).toHaveLength(1);
  expect(await f.models.getAvailableOfType("classifier")).toHaveLength(1);
  const image = f.models.getModelOfType("image", ref.provider, ref.id)!;
  expect(image.inputLimits).toEqual({ maxRequestBytes: 10000, images: { maxPerRequest: 2, resize: { maxWidth: 512 } } });
  expect(Object.isFrozen(image)).toBe(true); expect(Object.isFrozen(image.inputLimits!.images!.resize)).toBe(true);
  expect(JSON.stringify(f.models.getAllModels())).not.toContain(token);
  const chatOnly = createHostModels(f.runtime, [ref], f.policy);
  expect(chatOnly.getAllModels()).toHaveLength(1);
  expect((await chatOnly.generateImages(image, imageContext)).stopReason).toBe("error");
  expect(f.calls()).toBe(0);
  const port = { getPhysicalModel: f.runtime.getPhysicalModel.bind(f.runtime), stream: f.runtime.stream.bind(f.runtime), streamSimple: f.runtime.streamSimple.bind(f.runtime) };
  expect(() => createHostModels(port, [{ ...ref, type: "image" }], f.policy)).toThrow("unavailable");
});
test("non-JSON image bytes/class instances are denied rather than JSON-cloned", async () => {
  const f = await fixture(true);
  const image = f.models.getModelOfType("image", ref.provider, ref.id)!;
  const bad = { input: [{ type: "text" as const, text: "bad", bytes: new Uint8Array([1]) }] };
  expect((await f.models.generateImages(image, bad)).stopReason).toBe("error");
  expect(f.calls()).toBe(0);
});

for (const method of ["streamDeferred", "fetchDeferred", "cancelDeferred"] as const) {
  const invoke = (f: Awaited<ReturnType<typeof fixture>>, handle: any, options?: any, direct = false, owner = f.model) => {
    if (direct) {
      const provider = f.models.getProvider(ref.provider)!;
      return method === "cancelDeferred" ? provider.cancelDeferred!(owner, handle, options)
        : provider.fetchDeferred!(owner, handle, options).result();
    }
    return method === "streamDeferred" ? f.models.streamDeferred(owner, handle, options).result()
      : method === "fetchDeferred" ? f.models.fetchDeferred(owner, handle, options) : f.models.cancelDeferred(owner, handle, options);
  };
  const issue = async (f: Awaited<ReturnType<typeof fixture>>) => {
    const stream = f.models.streamSimple(f.model, context, { deferred: true });
    const events = []; for await (const event of stream) events.push(event);
    const receipt = await stream.result();
    expect(receipt.stopReason).toBe("deferred");
    expect(JSON.stringify([events, receipt])).not.toContain(token);
    expect(JSON.stringify([events, receipt])).not.toContain("private-provider-id");
    expect(JSON.stringify([events, receipt])).not.toContain("host-private");
    expect(receipt.deferred?.id).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.deferred?.data).toBeUndefined();
    return JSON.parse(JSON.stringify(receipt.deferred));
  };
  const denied = async (pending: ReturnType<typeof invoke>) => {
    if (method === "cancelDeferred") {
      let failure: unknown;
      try { await pending; } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe("Host deferred cancellation denied or failed");
    } else {
      const result = await pending;
      expect(result?.stopReason).toBe("error");
      expect(JSON.stringify(result)).not.toContain(token);
      expect(JSON.stringify(result)).not.toContain("host-private");
    }
  };
  test(`${method}: host-issued safe JSON reference, actual root runtime dispatch and direct provider path`, async () => {
    for (const direct of [false, true]) {
      const f = await fixture(false, false, true); const handle = await issue(f);
      const result = await invoke(f, handle, { timeoutMs: 100, maxRetryDelayMs: 0, ...(method === "cancelDeferred" ? {} : { wait: 0 }) }, direct);
      if (method !== "cancelDeferred") expect(result?.stopReason).toBe("stop");
      expect(f.calls()).toBe(2);
      expect(f.captured().options).toMatchObject({ apiKey: token, maxRetries: 0, timeoutMs: 100 });
      expect(f.admissions).toContain(method === "cancelDeferred" ? "cancelDeferred" : "fetchDeferred");
    }
  });
  test(`${method}: unknown, swapped owner, private data and malformed references rejected before host auth`, async () => {
    const f = await fixture(false, false, true); const handle = await issue(f); const reads = f.requested.length;
    for (const direct of [false, true]) {
      for (const bad of [{ ...handle, id: "forged" }, { ...handle, provider: "foreign" }, { ...handle, modelId: "foreign" },
        { ...handle, api: "foreign" }, { ...handle, data: { token } }, { ...handle, id: Infinity }]) await denied(invoke(f, bad, undefined, direct));
      for (const owner of [{ ...f.model, provider: "foreign" }, { ...f.model, id: "foreign" }, { ...f.model, type: "image" as const }]) {
        await denied(invoke(f, handle, undefined, direct, owner as Model<Api>));
      }
    }
    expect(f.calls()).toBe(1); expect(f.requested.length).toBe(reads);
    f.denyOwner(); await denied(invoke(f, handle)); expect(f.calls()).toBe(1);
  });
  test(`${method}: transforms, credentials, callbacks, retries and non-JSON denied before admission`, async () => {
    const f = await fixture(false, false, true); const handle = await issue(f); const reads = f.requested.length;
    let callbacks = 0; const count = () => { callbacks++; return {}; };
    for (const direct of [false, true]) for (const options of [{ transformHeaders: count }, { onPayload: count }, { onResponse: count },
      { apiKey: token }, { headers: { Authorization: token } }, { env: {} }, { fetch: count }, { maxRetries: 1 },
      { wait: Infinity }, { timeoutMs: new Date() }, { maxRetryDelayMs: count }]) await denied(invoke(f, handle, options, direct));
    expect(callbacks).toBe(0); expect(f.calls()).toBe(1); expect(f.requested.length).toBe(reads);
    expect(f.admissions).toHaveLength(1);
  });
  for (const action of ["revoke", "exhaust", "abort"] as const) test(`${method}: ${action} before and during held auth blocks dispatch`, async () => {
    for (const held of [false, true]) {
      const f = await fixture(false, false, true); const handle = await issue(f);
      if (held) f.hold(); else f[action]();
      const pending = invoke(f, handle);
      // Bun's rejects matcher may synchronously wait: observe first, release, assert last.
      void pending.catch(() => {});
      if (held) { try { await bounded(f.entered.promise); f[action](); } finally { f.held.release(); } }
      await denied(pending); expect(f.calls()).toBe(1);
    }
  });
  test(`${method}: caller abort and host auth failure never dispatch or leak credentials`, async () => {
    for (const action of ["fail", "logout", "callerAbort"] as const) {
      const f = await fixture(false, false, true); const handle = await issue(f);
      const caller = new AbortController();
      if (action === "logout") await f.runtime.logout(ref.provider);
      else if (action === "fail") f.fail(); else caller.abort();
      await denied(invoke(f, handle, { signal: caller.signal }));
      expect(f.calls()).toBe(1);
      expect(f.requested.every((id) => id === ref.provider)).toBe(true);
    }
  });
  test(`${method}: keyless host auth and caller cancellation preserve host signal`, async () => {
    const f = await fixture(false, true, true); const handle = await issue(f);
    const caller = new AbortController();
    await invoke(f, handle, { signal: caller.signal });
    expect(f.calls()).toBe(2);
    expect(f.captured().options.apiKey).toBeUndefined();
    expect(f.captured().options.signal.aborted).toBe(false);
    caller.abort();
    expect(f.captured().options.signal.aborted).toBe(true);
  });
  test(`${method}: revocation during bounded authority admission denies before host auth`, async () => {
    const f = await fixture(false, false, true); const handle = await issue(f);
    const entered = barrier(), held = barrier();
    const original = f.policy.deferred!.authorize;
    f.policy.deferred!.authorize = async (...args) => {
      entered.release(); await held.promise; await original(...args);
    };
    const reads = f.requested.length;
    const pending = invoke(f, handle); void pending.catch(() => {});
    try { await bounded(entered.promise); f.revoke(); } finally { held.release(); }
    await denied(pending);
    expect(f.calls()).toBe(1); expect(f.requested.length).toBe(reads);
  });
  test(`${method}: caller model/handle/options mutation cannot change authority or physical owner`, async () => {
    for (const direct of [false, true]) for (const phase of ["authority", "hostAuth"] as const)
      for (const provider of [ref.provider, "unapproved-provider"]) {
      const f = await fixture(false, false, true); const handle = await issue(f);
      const owner = structuredClone(f.model);
      const expected = structuredClone(owner);
      const originalHandle = structuredClone(handle);
      const options = { timeoutMs: 100, maxRetries: 0 };
      const entered = barrier(), held = barrier();
      const authority = f.policy.deferred!;
      const seen: { model: unknown; handle: unknown }[] = [];
      const resolve = authority.resolve, authorize = authority.authorize, current = authority.assertCurrent;
      authority.resolve = (h, m) => { seen.push({ model: m, handle: h }); return resolve(h, m); };
      authority.authorize = async (m, op, h, signal) => {
        seen.push({ model: m, handle: h });
        if (phase === "authority") { entered.release(); await held.promise; }
        await authorize(m, op, h, signal);
      };
      authority.assertCurrent = (m, op, h, signal) => {
        seen.push({ model: m, handle: h }); current(m, op, h, signal);
      };
      if (phase === "hostAuth") f.hold();
      const pending = invoke(f, handle, options, direct, owner); void pending.catch(() => {});
      try {
        await bounded(phase === "authority" ? entered.promise : f.entered.promise);
        owner.provider = provider; owner.id = "unapproved-model";
        if (phase === "hostAuth") owner.api = "mutated-api";
        handle.provider = "unapproved-provider"; handle.modelId = "unapproved-model"; handle.id = "swapped";
        options.timeoutMs = 999;
      } finally { held.release(); f.held.release(); }
      const result = await pending;
      if (method !== "cancelDeferred") expect(result?.stopReason).toBe("stop");
      expect(f.calls()).toBe(2);
      expect(f.captured().owner).toMatchObject({ ...ref, api: expected.api });
      expect(f.captured().options.timeoutMs).toBe(100);
      expect(seen.length).toBeGreaterThanOrEqual(3);
      for (const item of seen) {
        expect(item.model).toBe(seen[0]!.model);
        expect(item.model).toEqual(expected);
        expect(Object.isFrozen(item.model)).toBe(true);
        expect(item.handle).toBe(seen[0]!.handle);
        expect(item.handle).toEqual(originalHandle);
        expect(Object.isFrozen(item.handle)).toBe(true);
      }
    }
  });
  test(`${method}: private authority errors are sanitized without dispatch`, async () => {
    const f = await fixture(false, false, true); const handle = await issue(f);
    const reads = f.requested.length;
    f.policy.deferred!.authorize = async () => { throw new Error(`${token}/host-private-marker`); };
    const pending = invoke(f, handle); void pending.catch(() => {});
    await denied(pending);
    expect(f.calls()).toBe(1); expect(f.requested.length).toBe(reads);
  });
  test(`${method}: post-auth provider failure is sanitized`, async () => {
    const f = await fixture(false, false, true); const handle = await issue(f);
    if (method === "cancelDeferred") f.runtime.getProvider(ref.provider)!.cancelDeferred = async () => { throw new Error(token); };
    else f.runtime.getProvider(ref.provider)!.fetchDeferred = () => { throw new Error(token); };
    await denied(invoke(f, handle));
  });
  test(`${method}: reopened bridge uses host-owned authority, not a local handle registry`, async () => {
    const f = await fixture(false, false, true); const handle = await issue(f);
    const reopened = { ...f, models: createHostModels(f.runtime, [ref], f.policy) };
    await invoke(reopened, JSON.parse(JSON.stringify(handle)));
    expect(f.calls()).toBe(2);
    // This proves bridge recreation only, not production/process recovery storage.
  });
}
for (const method of ["stream", "streamSimple", "complete", "completeSimple"] as const) {
  test(`${method}: unsafe authority projection fails closed for initial deferred receipt`, async () => {
    const f = await fixture(false, false, true);
    f.policy.deferred!.project = (raw) => raw;
    const value = f.models[method](f.model, context, { deferred: true });
    const result = "result" in value ? await value.result() : await value;
    expect(result.stopReason).toBe("error");
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain("private-provider-id");
    expect(JSON.stringify(result)).not.toContain("host-private");
    expect(result.deferred).toBeUndefined();
  });
}
test("deferred cancel has explicit exact-owner cleanup grant after spend withdrawal", async () => {
  const f = await fixture(false, false, true);
  const handle = (await f.models.completeSimple(f.model, context, { deferred: true })).deferred!;
  f.revoke(); f.exhaust(); f.cleanup();
  expect((await f.models.fetchDeferred(f.model, handle)).stopReason).toBe("error");
  await f.models.cancelDeferred(f.model, handle); expect(f.calls()).toBe(2);
  f.denyOwner(); await expect(f.models.cancelDeferred(f.model, handle)).rejects.toThrow(); expect(f.calls()).toBe(2);
});

for (const method of ["stream", "streamSimple", "complete", "completeSimple"] as const) {
  test(`${method}: public preflight snapshots before keyless factory auth yields`, async () => {
    const f = await fixture(false, false, true);
    const owner = structuredClone(f.model);
    const ctx = structuredClone(context);
    const options = { deferred: true, maxTokens: 42, metadata: { purpose: "original" } };
    const value = f.models[method](owner, ctx, options);
    owner.provider = "unapproved-provider"; owner.id = "unapproved-model"; owner.api = "mutated-api";
    ctx.messages[0]!.content = "mutated"; options.maxTokens = 999; options.metadata.purpose = "mutated";
    const result = "result" in value ? await value.result() : await value;
    expect(result.stopReason).toBe("deferred");
    expect(result.deferred).toMatchObject({ provider: ref.provider, modelId: ref.id, api: model.api });
    expect(f.calls()).toBe(1);
    expect(f.captured().owner).toMatchObject({ ...ref, api: model.api });
    expect(JSON.stringify(f.captured().context.messages)).toContain("fixture");
    expect(JSON.stringify(f.captured().context.messages)).not.toContain("mutated");
    expect(f.captured().options).toMatchObject({ maxTokens: 42, metadata: { purpose: "original" } });
    expect(f.admissions).toEqual([`${ref.provider}/${ref.id}/chat`]);
  });
}

test("image capability: authorization, real post-auth fence, and accepted SQLite recovery", async () => {
  const image = { type: "image" as const, data: "c3ludGhldGlj", mimeType: "image/png" };
  // Registration starts a background availability refresh even with refreshOnCreate:false.
  const baseline = await fixture(false, true, false, true);
  expect(baseline.requested).toEqual([]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(baseline.requested).toEqual([ref.provider, ref.provider]);
  expect(baseline.calls()).toBe(0);
  for (const role of ["user", "toolResult"] as const) {
    const ctx = { messages: [role === "user"
      ? { role, content: [image], timestamp: 1 }
      : { role, content: [image], toolCallId: "call-1", toolName: "fixture_tool", isError: false, timestamp: 1 }] };
    for (const phase of ["authorize", "post-auth"] as const) {
      const f = await fixture(false, true, false, true);
      // Settle registration plus an explicit public refresh before counting dispatch auth.
      await f.runtime.refresh({ allowNetwork: false });
      const initialReads = f.requested.length;
      expect(initialReads).toBe(4);
      const physical = f.runtime.getPhysicalModel(ref.provider, ref.id)!;
      // The SDK catalog preserves the NativeProvider getModels() object, not a clone.
      expect(f.runtime.getPhysicalModel(ref.provider, ref.id)).toBe(physical);
      const revoke = () => {
        physical.input.splice(0, physical.input.length, "text");
        expect(f.runtime.getPhysicalModel(ref.provider, ref.id)!.input).toEqual(["text"]);
      };
      if (phase === "authorize") f.policy.authorize = async () => { await Promise.resolve(); revoke(); };
      else f.hold();
      const pending = f.models.completeSimple(f.model, ctx);
      if (phase === "post-auth") {
        try { await bounded(f.entered.promise); revoke(); } finally { f.held.release(); }
      }
      const result = await pending;
      expect(result.stopReason).toBe("error");
      expect(result.errorMessage).toBe(modelFailureDetail({ phase: phase === "authorize" ? "admission" : "provider", category: "unknown" }));
      expect(f.calls()).toBe(0);
      expect(JSON.stringify(result)).not.toContain(token);
      expect(f.requested.length - initialReads).toBe(phase === "authorize" ? 0 : 1);
      // Text-only requests remain legal on the same downgraded physical owner.
      f.policy.authorize = async () => {};
      expect((await f.models.completeSimple(f.model, context)).stopReason).toBe("toolUse");
      expect(f.calls()).toBe(1);
    }
  }
  const f = await fixture(false, true, false, true);
  const directory = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "image-recovery-"));
  const path = join(directory, "candidate.sqlite");
  const registry = createRegistry();
  const open = async () => Harness.open(await SqliteStorage.open(new BunSqliteDatabase(path)), {
    models: f.models, registry, settings: { retry: { enabled: false }, compaction: { enabled: false } },
  }, durableContext);
  let harness = await open();
  try {
    const root = await harness.root(durableContext, { agent: { model: { provider: ref.provider, modelId: ref.id } } });
    f.message.content = [{ type: "text", text: "Image accepted" }];
    f.message.stopReason = "stop";
    const accepted = await root.submit({ type: "input", requestId: "accepted-image", content: [image] }, durableContext);
    expect((await accepted.wait(durableContext)).status).toBe("done");
    const before = await accepted.status(durableContext);
    const callsBeforeReopen = f.calls();
    await harness.close(durableContext);
    f.runtime.getPhysicalModel(ref.provider, ref.id)!.input.splice(0, 2, "text");
    expect(f.runtime.getPhysicalModel(ref.provider, ref.id)!.input).toEqual(["text"]);
    f.policy.authorize = async () => {};
    harness = await open();
    const recovered = (await harness.submission(accepted.id, durableContext))!;
    expect(await recovered.status(durableContext)).toEqual(before);
    expect(f.calls()).toBe(callsBeforeReopen);
    const reopenedRoot = await harness.root(durableContext);
    expect(JSON.stringify((await reopenedRoot.context(durableContext)).messages)).toContain(image.data);
    const continuation = await reopenedRoot.submit({ type: "input", requestId: "after-capability-change", content: "Continue" }, durableContext);
    await continuation.wait(durableContext);
    expect((await continuation.status(durableContext)).status).toBe("unanswered");
    expect(f.calls()).toBe(callsBeforeReopen);
  } finally { await harness.close(durableContext); await rm(directory, { recursive: true, force: true }); }
});

test("accepted limitation: public transformHeaders is awaited, not an atomic dispatch fence", async () => {
  const f = await fixture();
  f.onFence(() => queueMicrotask(() => { f.revoke(); f.abort(); }));
  await f.models.completeSimple(f.model, context);
  // The runtime still calls the provider after revocation in this await gap.
  // A cooperative transport sees an aborted signal, but strict zero-dispatch
  // requires a public synchronous guard at provider invocation in host 1.2.
  expect(f.calls()).toBe(1);
  expect(f.captured().options.signal.aborted).toBe(true);
});

for (const method of ["stream", "streamSimple", "complete", "completeSimple"] as const) for (const failed of [false, true]) {
  test(`${method}: optional observer failure on terminal preserves original outcome/accounting; providerError=${failed}`, async () => {
    const f = await fixture(false, false, false, false, failed, `HTTP 504 timed out ${token}`);
    const settlements: AssistantMessage[] = [], records: LogRecord[] = [];
    let observers = 0;
    f.policy.prepareRequest = async () => ({ retainTerminal: fixtureTerminalReceipt, async dispatch() {}, async settle(message) { settlements.push(structuredClone(message)); }, async abandon() {} });
    f.observe(() => { observers++; throw Error(token); });
    const sink = (record: LogRecord) => { records.push(record); }; addLogSink(sink);
    try {
      const value = f.models[method](f.model, context);
      const result = "result" in value ? await value.result() : await value;
      expect(result.stopReason).toBe(failed ? "error" : "toolUse");
      expect(settlements).toHaveLength(1);
      expect(result.usage).toEqual(settlements[0]!.usage);
      if (failed) expect(parseModelFailure(result.errorMessage)).toEqual({ phase: "provider", category: "timeout", httpStatus: 504 });
      else expect(result.content).toEqual(f.message.content);
      expect(observers).toBe(1); expect(f.calls()).toBe(1);
      expect(records.filter(record => record.operation === "durable_model.observer_failed")).toHaveLength(1);
      expect(JSON.stringify([result, records])).not.toContain(token);
    } finally { removeLogSink(sink); }
  });
}

test("optional observer failure on final delta detaches while provider terminal still settles once", async () => {
  const f = await fixture(); f.finalDelta();
  let observers = 0, settlements = 0;
  f.observe(() => { observers++; throw Error(token); });
  f.policy.prepareRequest = async () => ({ retainTerminal: fixtureTerminalReceipt, async dispatch() {}, async settle() { settlements++; }, async abandon() {} });
  const result = await f.models.completeSimple(f.model, context);
  expect(result.stopReason).toBe("toolUse"); expect(result.content).toEqual(f.message.content);
  expect(result.usage).toEqual(f.message.usage);
  expect(observers).toBe(1); expect(settlements).toBe(1); expect(f.calls()).toBe(1);
  expect(f.captured().options.signal.aborted).toBe(false);
});

test("optional observer mutations never change provider terminal or accounting evidence", async () => {
  const f = await fixture(); f.finalDelta();
  let settled: AssistantMessage | undefined;
  f.observe(event => {
    if ("partial" in event) { event.partial.usage.input = 999; event.partial.content.length = 0; }
    if (event.type === "done") { event.message.usage.input = 999; event.message.content.length = 0; }
  });
  f.policy.prepareRequest = async () => ({ retainTerminal: fixtureTerminalReceipt, async dispatch() {}, async settle(message) { settled = structuredClone(message); }, async abandon() {} });
  const result = await f.models.completeSimple(f.model, context);
  expect(result.content).toEqual(f.message.content); expect(result.usage).toEqual(f.message.usage);
  expect(settled?.content).toEqual(f.message.content); expect(settled?.usage).toEqual(f.message.usage);
  expect(f.calls()).toBe(1);
});

test("ordinary synchronous observer return values do not detach notification", async () => {
  const f = await fixture(); f.finalDelta(); const seen: string[] = [];
  f.observe(event => seen.push(event.type));
  const result = await f.models.completeSimple(f.model, context);
  expect(result.stopReason).toBe("toolUse"); expect(result.content).toEqual(f.message.content);
  expect(seen).toEqual(["text_delta", "done"]); expect(f.calls()).toBe(1);
});

test("rejected asynchronous observer cannot poison result publication or produce unhandled rejection", async () => {
  const f = await fixture();
  f.observe(async () => { throw Error(token); });
  const result = await f.models.completeSimple(f.model, context); await Bun.sleep(0);
  expect(result.stopReason).toBe("toolUse"); expect(result.content).toEqual(f.message.content);
  expect(result.usage).toEqual(f.message.usage); expect(f.calls()).toBe(1);
});

test("late observer rejection after SDK-visible result publication preserves outcome and at-most-once settlement", async () => {
  const f = await fixture(), release = barrier(); let observers = 0, settlements = 0;
  f.observe(() => { observers++; return release.promise.then(() => { throw Error(token); }); });
  f.policy.prepareRequest = async () => ({ retainTerminal: fixtureTerminalReceipt, async dispatch() {}, async settle() { settlements++; }, async abandon() {} });
  try {
    const result = await bounded(f.models.completeSimple(f.model, context));
    const published = JSON.stringify(result);
    expect(result.stopReason).toBe("toolUse"); expect(result.content).toEqual(f.message.content);
    expect(result.usage).toEqual(f.message.usage); expect(settlements).toBe(1);
    release.release(); await Bun.sleep(0);
    expect(JSON.stringify(result)).toBe(published);
    expect(observers).toBe(1); expect(settlements).toBe(1); expect(f.calls()).toBe(1);
  } finally { release.release(); await Bun.sleep(0); }
});

test("mandatory event authority failure remains fatal after retaining the full original terminal before the fence", async () => {
  const f = await fixture(); let observers = 0, settlements = 0;
  const retained: AssistantMessage[] = [], order: string[] = [];
  f.eventAuthority(() => { order.push('fence'); throw Error(token); });
  f.observe(() => { observers++; });
  f.policy.prepareRequest = async () => ({ async dispatch() {}, async retainTerminal(message) { retained.push(structuredClone(message)); order.push('retain'); }, async settle() { settlements++; }, async abandon() {} });
  const result = await f.models.completeSimple(f.model, context);
  expect(result.stopReason).toBe("error"); expect(parseModelFailure(result.errorMessage)?.phase).toBe("source");
  expect(result.usage).toEqual(f.message.usage);
  expect(retained).toHaveLength(1); expect(retained[0]).toMatchObject({ content: f.message.content, usage: f.message.usage, stopReason: f.message.stopReason });
  expect(order).toEqual(['retain', 'fence']);
  expect(observers).toBe(0); expect(settlements).toBe(0); expect(f.calls()).toBe(1);
  expect(JSON.stringify(result)).not.toContain(token);
});

test('mandatory nonterminal fence failure drains and retains the actual terminal without provider or financial callback replay', async () => {
  const f = await fixture(); f.finalDelta();
  const retained: AssistantMessage[] = [], order: string[] = []; let settlements = 0, observers = 0;
  f.eventAuthority(() => { order.push('fence'); throw Error(token); }); f.observe(() => { observers++; });
  f.policy.prepareRequest = async () => ({ async dispatch() {}, async retainTerminal(message) { retained.push(structuredClone(message)); order.push('retain'); }, async settle() { settlements++; }, async abandon() {} });
  const result = await f.models.completeSimple(f.model, context);
  expect(parseModelFailure(result.errorMessage)?.phase).toBe('source'); expect(result.stopReason).toBe('error');
  expect(retained).toHaveLength(1); expect(retained[0]).toMatchObject({ content: f.message.content, usage: f.message.usage, stopReason: f.message.stopReason });
  expect(order).toEqual(['fence', 'retain']); expect(f.captured().options.signal.aborted).toBe(true);
  expect(f.calls()).toBe(1); expect(settlements).toBe(0); expect(observers).toBe(0);
});

test('result-only terminal is retained before its final mandatory authority check', async () => {
  const f = await fixture(); f.resultOnly(); const order: string[] = []; let settlements = 0;
  f.eventAuthority(() => { order.push('fence'); throw Error(token); }); f.observe(() => {});
  f.policy.prepareRequest = async () => ({ async dispatch() {}, async retainTerminal(message) { expect(message.content).toEqual(f.message.content); order.push('retain'); }, async settle() { settlements++; }, async abandon() {} });
  const result = await f.models.completeSimple(f.model, context);
  expect(parseModelFailure(result.errorMessage)?.phase).toBe('source'); expect(result.usage).toEqual(f.message.usage);
  expect(order).toEqual(['retain', 'fence']); expect(settlements).toBe(0); expect(f.calls()).toBe(1);
});

for (const failed of [false, true]) test(`terminal-retention rejection is not replayed by physical drain or financial cleanup; providerFailed=${failed}`, async () => {
  const f = await fixture(false, false, false, false, failed, 'HTTP 504 timed out');
  let retentions = 0, settlements = 0, observers = 0, abandonments = 0;
  f.observe(() => { observers++; });
  f.policy.prepareRequest = async () => ({ async dispatch() {}, async retainTerminal() { retentions++; throw Error(token); }, async settle() { settlements++; }, async abandon() { abandonments++; } });
  const result = await f.models.completeSimple(f.model, context);
  expect(result.stopReason).toBe('error'); expect(retentions).toBe(1); expect(settlements).toBe(0); expect(observers).toBe(0); expect(abandonments).toBe(1);
  expect(parseModelFailure(result.errorMessage)).toEqual(failed ? { phase: 'accounting', category: 'timeout', httpStatus: 504 } : { phase: 'accounting', category: 'unknown' });
  expect(result.usage).toEqual(failed ? { ...f.message.usage, cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 } } : f.message.usage);
  expect(f.calls()).toBe(1); expect(JSON.stringify(result)).not.toContain(token);
});

test("terminal projection failure cannot erase validated original usage", async () => {
  const f = await fixture(); Object.assign(f.message, { unsupportedProviderMetadata: new Date() });
  const result = await f.models.completeSimple(f.model, context);
  expect(result.stopReason).toBe("error");
  expect(result.usage).toEqual(f.message.usage);
  expect(parseModelFailure(result.errorMessage)?.phase).toBe("conversion");
  expect(f.calls()).toBe(1);
});

test("provider error facts survive a simultaneous mandatory observer authority failure", async () => {
  const f = await fixture(false, false, false, false, true, `HTTP 504 timed out ${token}`);
  f.eventAuthority(() => { throw Error("source authority revoked"); }); f.observe(() => {});
  const result = await f.models.completeSimple(f.model, context);
  expect(result.stopReason).toBe("error");
  expect(parseModelFailure(result.errorMessage)).toEqual({ phase: "source", category: "timeout", httpStatus: 504 });
  expect(result.usage.cost.total).toBe(0.3); expect(f.calls()).toBe(1);
  expect(JSON.stringify(result)).not.toContain(token);
});

test("result-only provider error is classified before the mandatory post-result fence", async () => {
  const f = await fixture(false, false, false, false, true, `HTTP 504 timed out ${token}`); f.resultOnly();
  let observers = 0;
  f.eventAuthority(() => { throw Error("result authority revoked"); }); f.observe(() => { observers++; });
  const result = await f.models.completeSimple(f.model, context);
  expect(result.stopReason).toBe("error");
  expect(parseModelFailure(result.errorMessage)).toEqual({ phase: "source", category: "timeout", httpStatus: 504 });
  expect(result.usage.cost.total).toBe(0.3); expect(observers).toBe(0); expect(f.calls()).toBe(1);
});

test("nonterminal authority failure aborts and joins the actual provider result without replay", async () => {
  const f = await fixture(); f.holdUntilAbort(); let observers = 0;
  f.eventAuthority(() => { throw Error("stream authority revoked"); }); f.observe(() => { observers++; });
  try {
    const result = await bounded(f.models.completeSimple(f.model, context));
    await bounded(f.providerClosed.promise);
    expect(f.captured().options.signal.aborted).toBe(true);
    expect(result.stopReason).toBe("error"); expect(parseModelFailure(result.errorMessage)?.phase).toBe("source");
    expect(result.usage).toEqual(f.message.usage); expect(observers).toBe(0); expect(f.calls()).toBe(1);
  } finally { f.abort(); await bounded(f.providerClosed.promise); }
});

test("asynchronous event authority is rejected rather than ignored as an optional observer", async () => {
  const f = await fixture(); let observers = 0;
  f.eventAuthority(async () => { throw Error(token); });
  f.observe(() => { observers++; });
  const result = await f.models.completeSimple(f.model, context); await Bun.sleep(0);
  expect(result.stopReason).toBe("error"); expect(parseModelFailure(result.errorMessage)?.phase).toBe("source");
  expect(result.usage).toEqual(f.message.usage); expect(observers).toBe(0); expect(f.calls()).toBe(1);
  expect(JSON.stringify(result)).not.toContain(token);
});

test("event authority is rechecked after result publication before accounting or SDK success", async () => {
  const f = await fixture(); let settlements = 0;
  f.observe(() => { f.eventAuthority(() => { throw Error(token); }); });
  f.policy.prepareRequest = async () => ({ retainTerminal: fixtureTerminalReceipt, async dispatch() {}, async settle() { settlements++; }, async abandon() {} });
  const result = await f.models.completeSimple(f.model, context);
  expect(result.stopReason).toBe("error"); expect(parseModelFailure(result.errorMessage)?.phase).toBe("source");
  expect(result.usage).toEqual(f.message.usage); expect(settlements).toBe(0); expect(f.calls()).toBe(1);
});

test('failed host request preserves validated reported usage without private diagnostics', async () => {
  const f = await fixture(false, false, false, false, true);
  const result = await f.models.complete(f.model, context);
  expect(result.stopReason).toBe('error');
  expect(result.usage).toMatchObject({ input: 2, output: 3, totalTokens: 5, cost: { input: 0.1, output: 0.2, total: 0.3 } });
  expect(JSON.stringify(result)).not.toContain(token);
  expect(result.content).toEqual([]);
  expect(f.calls()).toBe(1);
});

test("provider failure preserves safe category, accounting and a single dispatch", async () => {
  const f = await fixture(false, false, false, false, true, `HTTP 504 timed out; Authorization: Bearer ${token}`);
  const records: LogRecord[] = [], sink = (record: LogRecord) => { records.push(record); };
  let settlements = 0, abandonments = 0;
  f.policy.prepareRequest = async () => ({ retainTerminal: fixtureTerminalReceipt, async dispatch() {}, async settle() { settlements++; }, async abandon() { abandonments++; } });
  addLogSink(sink);
  try {
    const result = await f.models.completeSimple(f.model, context);
    expect(result.stopReason).toBe("error");
    expect(parseModelFailure(result.errorMessage)).toEqual({ phase: "provider", category: "timeout", httpStatus: 504 });
    expect(f.calls()).toBe(1); expect(settlements).toBe(1); expect(abandonments).toBe(1);
    expect(result.usage.cost.total).toBe(0.3);
    expect(records.filter(record => record.operation === "durable_model.request_failed")).toHaveLength(1);
    expect(records.find(record => record.operation === "durable_model.request_failed")).toMatchObject({ phase: "provider", category: "timeout", httpStatus: 504 });
    expect(JSON.stringify([result, records])).not.toContain(token);
  } finally { removeLogSink(sink); }
});

test("unresolved accounting does not overwrite the original provider timeout", async () => {
  const f = await fixture(false, false, false, false, true, `HTTP 504 timed out ${token}`);
  f.policy.prepareRequest = async () => ({ retainTerminal: fixtureTerminalReceipt, async dispatch() {}, async settle() { throw Error(token); }, async abandon() {} });
  const result = await f.models.completeSimple(f.model, context);
  expect(parseModelFailure(result.errorMessage)).toEqual({phase:"accounting",category:"timeout",httpStatus:504});
  expect(f.calls()).toBe(1);
  expect(JSON.stringify(result)).not.toContain(token);
});

test("admission failure reports its stage without dispatch or private exception text", async () => {
  const f = await fixture();
  f.policy.authorize = async () => { throw Error(`Invalid API key: ${token}`); };
  const result = await f.models.completeSimple(f.model, context);
  expect(result.stopReason).toBe("error");
  expect(result.errorMessage).toBe("Host model request failed [phase=admission; category=authentication]");
  expect(f.calls()).toBe(0);
  expect(JSON.stringify(result)).not.toContain(token);
});

test("accounting and cleanup failures remain visible without repeating provider work", async () => {
  const f = await fixture();
  const records: LogRecord[] = [], sink = (record: LogRecord) => { records.push(record); };
  f.policy.prepareRequest = async () => ({ retainTerminal: fixtureTerminalReceipt, async dispatch() {}, async settle() { throw Error(token); }, async abandon() { throw Error(token); } });
  addLogSink(sink);
  try {
    const result = await f.models.completeSimple(f.model, context);
    expect(result.errorMessage).toBe("Host model request failed [phase=accounting; category=unknown]");
    expect(f.calls()).toBe(1);
    expect(records.some(record => record.operation === "durable_model.cleanup_failed" && record.phase === "accounting")).toBe(true);
    expect(JSON.stringify([records, result])).not.toContain(token);
  } finally { removeLogSink(sink); }
});

for (const invalid of ['invalid-usage', 'wrong-owner', 'wrong-response'] as const) test(`failed host usage rejects ${invalid} without disclosing diagnostics`, async () => {
  const f = await fixture(false, false, false, false, invalid);
  const result = await f.models.complete(f.model, context);
  expect(result.stopReason).toBe('error');
  expect(result.usage).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
  expect(JSON.stringify(result)).not.toContain(token);
  expect(result.content).toEqual([]);
  expect(f.calls()).toBe(1);
});

for (const archiveFails of [false, true]) for (const exhausted of [false, true]) test(`SDK bounded retry retains failures and never repeats committed tools: exhausted=${exhausted}, archiveFails=${archiveFails}`, async () => {
  const { retainModelFailureEvidence } = await import("../../runtime/durable-engine/src/host-model-failure-evidence.js");
  const { readdir, readFile } = await import("node:fs/promises");
  const f = await fixture(false, true, false, false, exhausted ? "retry-always" : "retry-once", "HTTP 504 timed out; upstream request interrupted");
  const directory = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "retained-model-retry-"));
  const requests: {id:string;state:string}[] = [];
  f.policy.retainFailure = evidence => {
    if (archiveFails) throw Error("fixture evidence storage unavailable");
    return retainModelFailureEvidence(join(directory, "failures"), evidence);
  };
  f.policy.prepareRequest = async () => {
    const row = {id: crypto.randomUUID(), state: "reserved"}; requests.push(row);
    return {id:row.id, retainTerminal: fixtureTerminalReceipt, async dispatch() {row.state = "dispatched";}, async settle(message) {
      if (message.stopReason === "error") { row.state = "unresolved"; throw Error("Native request settlement unresolved"); }
      row.state = "settled";
    }, async abandon() { if (row.state === "dispatched") row.state = "unresolved"; }};
  };
  let effects = 0;
  const tool = defineTool({name: "fixture_tool", description: "Committed effect counter", callers: ["model"], replay: "unsafe", parameters: Type.Object({value:Type.Number()}), execute: async () => {effects++;return {output:[{type:"text",text:"effect committed"}]};}});
  const registry = createRegistry(); registry.install(defineExtension({name:"retained-retry-fixture", tools:[tool]}));
  const harness = await Harness.open(await SqliteStorage.open(new BunSqliteDatabase(join(directory,"sdk.sqlite"))), {models:f.models, registry,
    settings:{retry:{enabled:true,maxRetries:1,baseDelayMs:1},compaction:{enabled:false}}}, durableContext);
  try {
    const root = await harness.root(durableContext,{agent:{model:{provider:ref.provider,modelId:ref.id},tools:[tool]}});
    const submitted = await root.submit({type:"input",requestId:"retained-retry",content:"Perform one effect and continue"},durableContext);
    expect((await submitted.wait(durableContext)).status).toBe(exhausted ? "unanswered" : "done");
    expect(effects).toBe(1); expect(f.calls()).toBe(3);
    expect(requests.map(row=>row.state)).toEqual(exhausted ? ["settled","unresolved","unresolved"] : ["settled","unresolved","settled"]);
    expect(new Set(requests.map(row=>row.id)).size).toBe(3);
    const files=archiveFails ? [] : await readdir(join(directory,"failures")); expect(files.length).toBe(archiveFails ? 0 : exhausted ? 2 : 1);
    for(const file of files) {const evidence=JSON.parse(await readFile(join(directory,"failures",file),"utf8"));expect(evidence.providerFailure).toMatchObject({category:"timeout",httpStatus:504});expect(evidence.errors.providerError.errorMessage).toContain("upstream request interrupted");expect(requests.map(row=>row.id)).toContain(evidence.requestId);}
    const page=await root.entries({order:"ascending"},100,undefined,durableContext);
    const failures=page.items.filter(entry=>entry.kind==="pi.assistant" && entry.model?.[0]?.role==="assistant" && entry.model[0].stopReason==="error");
    expect(failures.length).toBe(exhausted ? 2 : 1);
    for(const entry of failures) expect(JSON.stringify(entry).includes("evidence=")).toBe(!archiveFails);
  } finally {await harness.close(durableContext); await rm(directory,{recursive:true,force:true});}
});

test("retention write failure preserves original provider classification and unresolved request", async () => {
  const f=await fixture(false,true,false,false,true,"HTTP 504 upstream interrupted; PRIVATE_ORIGINAL_REASON");
  const records:LogRecord[]=[],sink=(record:LogRecord)=>{records.push(record);};let seen:unknown,abandoned=0;
  f.policy.prepareRequest=async()=>({ retainTerminal: fixtureTerminalReceipt,id:"original-unresolved-request",async dispatch(){},async settle(){throw Error("PRIVATE_SETTLEMENT_FAILURE");},async abandon(){abandoned++;}});
  f.policy.retainFailure=evidence=>{seen=evidence;throw Error("PRIVATE_ARCHIVE_FAILURE");};
  addLogSink(sink);
  try {
    const result=await f.models.completeSimple(f.model,context);
    expect(result.stopReason).toBe("error");expect(parseModelFailure(result.errorMessage)).toEqual({phase:"accounting",category:"timeout",httpStatus:504});
    expect(seen).toMatchObject({requestId:"original-unresolved-request",failure:{phase:"accounting",category:"timeout",httpStatus:504},providerError:{errorMessage:"HTTP 504 upstream interrupted; PRIVATE_ORIGINAL_REASON"}});
    expect(abandoned).toBe(1);expect(JSON.stringify(records)).toContain("durable_model.evidence_failed");
    for(const secret of ["PRIVATE_ORIGINAL_REASON","PRIVATE_SETTLEMENT_FAILURE","PRIVATE_ARCHIVE_FAILURE"])expect(JSON.stringify(records)+JSON.stringify(result)).not.toContain(secret);
  }finally{removeLogSink(sink);}
});

test("malformed diagnostic hook result cannot strand the model stream", async () => {
  const fx=await fixture(false,false,false,false,true,"ECONNRESET provider interrupted");
  fx.policy.retainFailure=()=>"not-a-receipt-id";
  const result=await bounded(fx.models.complete(fx.model,context));
  expect(result.stopReason).toBe("error");
  expect(parseModelFailure(result.errorMessage)?.category).toBe("transport");
  expect(result.errorMessage).not.toContain("not-a-receipt-id");
  expect(fx.calls()).toBe(1);
});

test("throwing caller model getters fail closed before invocation", async () => {
  const fx=await fixture();
  await fx.models.complete(fx.model,context);
  const before=fx.calls();
  const model={...fx.model};Object.defineProperty(model,"provider",{get(){throw Error(token);}});
  expect(()=>fx.models.complete(model,context)).toThrow();
  expect(fx.calls()).toBe(before);
});

for(const kind of ["image","classifier"] as const) test(`${kind} provider failures retain bounded evidence and their actual stage`, async()=>{
  const fx=await fixture(true),retained:any[]=[];
  fx.policy.retainFailure=input=>{retained.push(input);return "00000503-0000-0000-0000-000000000000";};
  let providerCalls=0;
  (fx.runtime as any)[kind==="image"?"generateImages":"classify"]=async()=>{providerCalls++;throw Error(token);};
  const result=kind==="image"?await fx.models.generateImages(fx.models.getModelOfType("image",ref.provider,ref.id)!,imageContext)
    :await fx.models.classify(fx.models.getModelOfType("classifier",ref.provider,ref.id)!,classifierContext);
  expect(result.stopReason).toBe("error");
  expect(parseModelFailure(result.errorMessage)).toEqual({phase:"provider",category:"unknown",evidenceId:"00000503-0000-0000-0000-000000000000"});
  expect(JSON.stringify(result)).not.toContain(token);
  expect(retained.length).toBe(1);
  expect(retained[0].error.message).toBe(token);
  expect(providerCalls).toBe(1);
});

test("abort during retry backoff survives reopen without replay or resolving uncertain holds", async () => {
  const f = await fixture(false, true, false, false, "retry-always", "HTTP 504 timed out");
  const directory = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "cancel-model-retry-"));
  const path = join(directory, "sdk.sqlite");
  const requests: { id: string; state: string }[] = [];
  f.policy.prepareRequest = async () => {
    const row = { id: crypto.randomUUID(), state: "reserved" }; requests.push(row);
    return { id: row.id, retainTerminal: fixtureTerminalReceipt, async dispatch() { row.state = "dispatched"; }, async settle(message) {
      if (message.stopReason === "error") { row.state = "unresolved"; throw Error("Native request settlement unresolved"); }
      row.state = "settled";
    }, async abandon() { if (row.state === "dispatched") row.state = "unresolved"; } };
  };
  let effects = 0;
  const tool = defineTool({ name: "fixture_tool", description: "Committed effect counter", callers: ["model"], replay: "unsafe", parameters: Type.Object({ value: Type.Number() }),
    execute: async () => { effects++; return { output: [{ type: "text", text: "effect committed" }] }; } });
  const registry = createRegistry(); registry.install(defineExtension({ name: "cancel-retry-fixture", tools: [tool] }));
  const options = { models: f.models, registry, settings: { retry: { enabled: true, maxRetries: 2, baseDelayMs: 60_000 }, compaction: { enabled: false } } };
  let harness = await Harness.open(await SqliteStorage.open(new BunSqliteDatabase(path)), options, durableContext);
  let watch: Awaited<ReturnType<Awaited<ReturnType<typeof harness.root>>["watch"]>> | undefined;
  try {
    let root = await harness.root(durableContext, { agent: { model: { provider: ref.provider, modelId: ref.id }, tools: [tool] } });
    let reachedBackoff!: () => void;
    const backoff = new Promise<void>(resolve => { reachedBackoff = resolve; });
    watch = await root.watch(durableContext);
    watch.start(async view => { if ((view.docs["pi.live"] as any)?.generation?.retry) reachedBackoff(); });
    const submission = await root.submit({ type: "input", requestId: "cancel-backoff", content: "Perform one effect and continue" }, durableContext);
    await bounded(backoff);
    expect(f.calls()).toBe(2); expect(effects).toBe(1);
    await bounded(root.abort(durableContext));
    expect(await bounded(submission.wait(durableContext))).toMatchObject({ status: "unanswered", reason: "aborted" });
    expect(requests.map(row => row.state)).toEqual(["settled", "unresolved"]);
    const entries = await root.entries({ order: "ascending" }, 100, undefined, durableContext);
    expect(entries.items.some(entry => entry.kind === "pi.assistant" && entry.model?.[0]?.role === "assistant" && entry.model[0].stopReason === "error")).toBe(true);
    const held = JSON.stringify(requests);
    await watch.stop(); watch = undefined;
    await harness.close(durableContext);
    harness = await Harness.open(await SqliteStorage.open(new BunSqliteDatabase(path)), options, durableContext);
    root = await harness.root(durableContext);
    expect(await root.entries({ order: "ascending" }, 100, undefined, durableContext)).toEqual(entries);
    harness.resume();
    await Bun.sleep(20);
    expect(f.calls()).toBe(2); expect(effects).toBe(1);
    expect(JSON.stringify(requests)).toBe(held);
  } finally { await watch?.stop(); await harness.close(durableContext); await rm(directory, { recursive: true, force: true }); }
});
