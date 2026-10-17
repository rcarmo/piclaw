import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { ModelRuntime as HostRuntime } from "../../node_modules/@earendil-works/pi-coding-agent";
import type { Credential, CredentialStore, Model, TranscriptContext as HostTranscript, AssistantMessage } from "../../node_modules/@earendil-works/pi-ai";
import type { Models, ImageModel, ClassifierModel, Api, ImageApi, ClassifierApi } from "../../runtime/durable-engine/qualification/ai.ts";
import { createHostModels, type HostModelPolicy } from "../../runtime/durable-engine/src/index.js";

// These ESM-only public exports have no require condition; resolve from root.
const root = new URL("../../package.json", import.meta.url).href;
const { ModelRuntime }: typeof import("../../node_modules/@earendil-works/pi-coding-agent") =
  await import(import.meta.resolve("@earendil-works/pi-coding-agent", root));
const { createAssistantMessageEventStream }: typeof import("../../node_modules/@earendil-works/pi-ai") =
  await import(import.meta.resolve("@earendil-works/pi-ai", root));
import { normalizeContext } from "../../runtime/durable-engine/qualification/ai.ts";
const ref = { provider: "qualification-provider", id: "qualification-model" };
const token = "SYNTHETIC-HOST-ONLY-TOKEN";
const model: Model<"openai-completions"> = { ...ref, name: "Qualification", api: "openai-completions",
  baseUrl: "https://fixture.invalid", input: ["text"], reasoning: true,
  contextWindow: 10000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
async function bounded(promise: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Fixture barrier not reached within 1500ms")), 1500);
    })]);
  } finally { clearTimeout(timer); }
}
async function fixture(multimodal = false, keyless = false, deferred = false) {
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
  const held = barrier();
  let hold = false;
  let fail = false;
  let calls = 0;
  let approved = true;
  let budget = true;
  let captured: any;
  let checks = 0;
  const admissions: string[] = [];
  let onFence = () => {};
  const generation = new AbortController();
  const check = () => { if (!approved || !budget) throw new Error("Policy denied"); };
  const policy: HostModelPolicy = { signal: generation.signal,
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
    if (deferred) stream.push({ type: "start", partial: result });
    stream.push({ type: "done", reason: result.stopReason as "toolUse" | "deferred", message: result });
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
  runtime.registerNativeProvider({ id: ref.provider, name: "Synthetic", getModels: () => [model, unapproved],
    getAllModels: () => multimodal ? [model, unapproved, image, classifier] : [model, unapproved],
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
    revoke: () => { approved = false; }, exhaust: () => { budget = false; },
    abort: () => generation.abort(), onFence: (fn: () => void) => { onFence = fn; } };
}
const context = { messages: [{ role: "user" as const, content: "fixture", timestamp: 1 }],
  tools: [{ name: "fixture_tool", description: "fixture", parameters: { type: "object" as const } }] };

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
  const classifier: ClassifierModel<ClassifierApi> = { ...f.model, type: "classifier" };
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
