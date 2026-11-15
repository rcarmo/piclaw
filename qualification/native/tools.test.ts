import { expect, test } from "bun:test";
import type { ToolDefinition, ExtensionToolContext } from "../../node_modules/@earendil-works/pi-coding-agent";
import { BACKGROUND_CONTEXT as context, withAbortSignal } from "../../runtime/durable-engine/qualification/context.ts";
import { Type, createModels, createProvider, type AssistantMessage, type Model } from "../../runtime/durable-engine/qualification/ai.ts";
import { AssistantMessageEventStream } from "../../runtime/durable-engine/qualification/event-stream.ts";
import { Harness, MemoryStorage, createRegistry, defineExtension, type ToolExecutionApi } from "../../runtime/durable-engine/qualification/durable.ts";
import { createHostTool, type HostToolEffectPort } from "../../runtime/durable-engine/src/index.js";

const parameters = Type.Object({ value: Type.String() });
type Details = { phase: string; privateJson?: { count: number; items: (string | null)[] } };
type Definition = ToolDefinition<typeof parameters, Details>;
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
function fixture() {
  let allowed = true;
  let effects = 0;
  let invocations = 0;
  let executions = 0;
  const entered = barrier(), held = barrier();
  let hold = false;
  let throwHost = false;
  let failResult = false;
  let checkEffect = () => {};
  let lastSignal: AbortSignal | undefined;
  let lateUpdate: Parameters<Definition["execute"]>[3];
  const image = { type: "image" as const, mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" };
  const details: Details = { phase: "done", privateJson: { count: 3, items: ["host-only", null] } };
  // Real public 1.2 ToolDefinition signature; ctx is bound by the host, never persisted.
  // Synthetic effects only: no ambient secrets, filesystem writes or transport.
  const ctx = { cwd: "/synthetic-host" } as ExtensionToolContext;
  const definition: Definition = {
    name: "host_fixture", label: "Host fixture", description: "Existing host callback",
    parameters, annotations: { readOnlyHint: true },
    prepareArguments: raw => ({ value: String((raw as { value: unknown }).value) }),
    async execute(id, args, signal, onUpdate, actualContext) {
      executions++;
      expect(id).toBe("host-call"); expect(actualContext).toBe(ctx);
      lastSignal = signal; lateUpdate = onUpdate;
      entered.release();
      if (hold) await held.promise;
      // This is the mandatory host-internal effect fence, NOT a pre-tool hook.
      checkEffect();
      effects++;
      if (throwHost) throw new Error("Synthetic host failure");
      onUpdate?.({ content: [{ type: "text", text: "a" }], details: { phase: "one" } });
      onUpdate?.({ content: [{ type: "text", text: "abc" }], details: { phase: "two" } });
      return { content: [{ type: "text", text: args.value }, image], details, isError: failResult };
    },
  };
  const host: HostToolEffectPort<typeof parameters, Details> = {
    authority: { check() { if (!allowed) throw new Error("Permission revoked"); } },
    effectFence: "host-effect-port",
    async invoke(args, call) {
      invocations++;
      checkEffect = call.assertAllowed;
      call.assertAllowed();
      return call.execute(call.toolCallId, args, call.signal, call.onUpdate, ctx);
    },
  };
  const chunks: string[] = [], updates: Details[] = [];
  const ack = barrier(); let holdAck = false;
  // A minimal invocation API double; the integration test below uses the real Harness.
  const api = { callId: "host-call", output: (chunk: string) => chunks.push(chunk),
    details: async (value: Details) => { if (holdAck) await ack.promise; updates.push(value); },
  } as unknown as ToolExecutionApi<Details>;
  return { definition, host, api, chunks, updates, image, details, entered, held, ack,
    tool: () => createHostTool(definition, host),
    counts: () => ({ effects, invocations, executions }),
    hold: () => { hold = true; }, revoke: () => { allowed = false; },
    throwHost: () => { throwHost = true; }, failResult: () => { failResult = true; },
    holdAck: () => { holdAck = true; }, signal: () => lastSignal,
    lateUpdate: () => lateUpdate?.({ content: [], details: { phase: "late" } }),
  };
}

test("delegates existing execute; preserves text/native images/JSON details, streaming ACK and result separation", async () => {
  const f = fixture(); f.holdAck();
  const tool = f.tool();
  let done = false;
  const execution = tool.execute({ value: "answer" }, f.api, context).then(result => { done = true; return result; });
  await f.entered.promise; await Promise.resolve(); await Promise.resolve();
  expect(done).toBe(false); f.ack.release();
  const result = await execution;
  expect(f.chunks).toEqual(["a", "bc"]);
  expect(f.updates).toEqual([{ phase: "one" }, { phase: "two" }]);
  expect(result.output).toEqual([{ type: "text", text: "answer" }, f.image]);
  expect(result.details).toEqual(f.details);
  expect(result).not.toHaveProperty("structuredOutput");
  expect(tool).not.toHaveProperty("structuredOutputSchema");
  expect(JSON.stringify(result.output)).not.toContain("host-only");
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  expect(() => f.lateUpdate()).toThrow("ended");
});

test("read-only annotation does not authorize replay; safe is an explicit host decision; model only", () => {
  const f = fixture();
  expect(f.tool().replay).toBe("unsafe"); expect(f.tool().callers).toEqual(["model"]);
  expect(createHostTool(f.definition, { ...f.host, replay: "safe" }).replay).toBe("safe");
  expect(() => createHostTool({ ...f.definition, outputSchema: Type.Object({}) }, f.host)).toThrow("structured");
  expect(() => createHostTool({ ...f.definition, reachesTools: () => "all" }, f.host)).toThrow("nested");
});

for (const action of ["revoke", "cancel"] as const) {
  test(`${action} before callback prevents invocation`, async () => {
    const f = fixture(), controller = new AbortController();
    if (action === "revoke") f.revoke(); else controller.abort();
    await expect(f.tool().execute({ value: "x" }, f.api, withAbortSignal(controller.signal, context))).rejects.toThrow();
    expect(f.counts()).toEqual({ effects: 0, invocations: 0, executions: 0 });
  });
  test(`${action} during execute await is fenced at the host's ACTUAL effect`, async () => {
    const f = fixture(), controller = new AbortController(); f.hold();
    const execution = f.tool().execute({ value: "x" }, f.api, withAbortSignal(controller.signal, context));
    await f.entered.promise;
    if (action === "revoke") f.revoke(); else controller.abort();
    expect(f.signal()?.aborted).toBe(action === "cancel");
    f.held.release(); await expect(execution).rejects.toThrow();
    expect(f.counts()).toEqual({ effects: 0, invocations: 1, executions: 1 });
    expect(f.chunks).toEqual([]); expect(f.updates).toEqual([]);
  });
}

test("permission is live through progress ACK and final result release", async () => {
  const f = fixture(); f.holdAck();
  const execution = f.tool().execute({ value: "x" }, f.api, context);
  await f.entered.promise; await Promise.resolve(); await Promise.resolve();
  f.revoke(); f.ack.release();
  await expect(execution).rejects.toThrow("Host tool authority unavailable");
  expect(f.counts().effects).toBe(1); // Already-admitted effects cannot be undone.
});

test("progress ACK failures are observed, not detached/unhandled", async () => {
  const f = fixture();
  const api = { ...f.api, details: async () => { throw new Error("ACK failed"); } };
  await expect(f.tool().execute({ value: "x" }, api, context)).rejects.toThrow("Host tool execution failed");
});

test("host failure with pending ACK failure has no raw or unhandled exception carrier", async () => {
  const f = fixture();
  f.definition.execute = async (_id, _args, _signal, onUpdate) => {
    onUpdate?.({ content: [{ type: "text", text: "approved progress" }], details: { phase: "one" } });
    throw new Error("SYNTHETIC_CREDENTIAL_EXECUTE", { cause: new Error("SYNTHETIC_CREDENTIAL_CAUSE") });
  };
  const api = { ...f.api, details: async () => { throw new Error("SYNTHETIC_CREDENTIAL_ACK"); } };
  await expect(f.tool().execute({ value: "x" }, api, context)).rejects.toThrow("Host tool execution failed");
  await new Promise(resolve => setTimeout(resolve, 0)); // Drain the pending ACK rejection.
});

test("LIMIT: an uncooperative callback is not made effect-safe by a pre-call check or AbortSignal", async () => {
  const f = fixture(), entered = barrier(), held = barrier(), controller = new AbortController();
  let unfencedEffects = 0;
  const uncooperative: Definition = { ...f.definition, async execute() {
    entered.release(); await held.promise;
    unfencedEffects++; // Deliberately violates the host-effect-port contract.
    return { content: [], details: { phase: "unqualified" } };
  } };
  const tool = createHostTool(uncooperative, f.host);
  const execution = tool.execute({ value: "x" }, f.api, withAbortSignal(controller.signal, context));
  await entered.promise; f.revoke(); controller.abort(); held.release();
  await expect(execution).rejects.toThrow();
  expect(unfencedEffects).toBe(1); // Post-result denial is NOT prevention of this effect.
});

test("revocation suppresses late host error text as well as late results", async () => {
  const f = fixture(), entered = barrier(), held = barrier();
  const definition: Definition = { ...f.definition, async execute() {
    entered.release(); await held.promise; throw new Error("host-private-error");
  } };
  const execution = createHostTool(definition, f.host).execute({ value: "x" }, f.api, context);
  await entered.promise; f.revoke(); held.release();
  await expect(execution).rejects.toThrow("Host tool authority unavailable");
});

test("host thrown errors are sanitized; explicit authorized error content/details stay distinct", async () => {
  const f = fixture(); f.throwHost();
  await expect(f.tool().execute({ value: "x" }, f.api, context)).rejects.toThrow("Host tool execution failed");
  const g = fixture(); g.failResult();
  const result = await g.tool().execute({ value: "error text" }, g.api, context);
  expect(result.isError).toBe(true); expect(result.details).toEqual(g.details);
  expect(result.output).toEqual([{ type: "text", text: "error text" }, g.image]);
});

test("registration snapshots actual Type.Object schema and execute/prepare callbacks", async () => {
  const f = fixture();
  const schema = Type.Object({ value: Type.String() });
  f.definition.parameters = schema;
  const tool = f.tool();
  Object.assign(schema.properties.value, { type: "number" });
  f.definition.execute = async () => { throw new Error("replacement must not execute"); };
  f.definition.prepareArguments = () => { throw new Error("replacement must not prepare"); };
  expect(tool.parameters.properties.value.type).toBe("string");
  expect(tool.prepareArguments?.({ value: 42 })).toEqual({ value: "42" });
  expect((await tool.execute({ value: "original" }, f.api, context)).output?.[0])
    .toEqual({ type: "text", text: "original" });
  expect(f.counts().executions).toBe(1);
});

test("false authority denies; registration clone and abort reasons never export exceptions or causes", async () => {
  const f = fixture();
  f.host.authority.check = () => false;
  await expect(f.tool().execute({ value: "x" }, f.api, context)).rejects.toThrow("Host tool permission denied");
  expect(() => f.tool().prepareArguments?.({ value: "x" })).toThrow("Host tool permission denied");
  const bad = { ...f.definition, parameters: { ...parameters, unsupported: () => "SYNTHETIC_CREDENTIAL" } };
  expect(() => createHostTool(bad, f.host)).toThrow("Host tool registration unavailable");
  const controller = new AbortController(); controller.abort(new Error("SYNTHETIC_CREDENTIAL"));
  try { await fixture().tool().execute({ value: "x" }, f.api, withAbortSignal(controller.signal, context)); }
  catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Host tool permission denied");
    expect(error).not.toHaveProperty("cause");
  }
});

for (const phase of ["execute", "prepare", "authority-initial", "authority-effect", "authority-release"] as const) {
  test(`public Harness sanitizes ${phase} exceptions in persisted entries and next-turn model context`, async () => {
    const marker = `SYNTHETIC_CREDENTIAL_${phase}`;
    const leak = () => { const error = new Error(marker, { cause: new Error(marker) });
      error.name = marker; Object.assign(error, { credential: marker }); throw error; };
    const f = fixture();
    let authorityFails = phase === "authority-initial";
    f.host.authority.check = () => { if (authorityFails) leak(); };
    if (phase === "prepare") f.definition.prepareArguments = leak;
    f.definition.execute = async () => {
      if (phase === "execute") leak();
      authorityFails = true;
      if (phase === "authority-effect") f.host.authority.check();
      return { content: [{ type: "text", text: "suppressed" }], details: f.details };
    };
    if (phase === "authority-effect") {
      f.host.invoke = async (_args, call) => { authorityFails = true; call.assertAllowed(); return leak(); };
    }
    const tool = f.tool(), extension = defineExtension({ name: `safe-${phase}`, tools: [tool] });
    const registry = createRegistry(); registry.install(extension);
    const model: Model<"openai-completions"> = { id: "synthetic", name: "Synthetic", provider: "qualification", api: "openai-completions",
      baseUrl: "https://invalid.invalid", input: ["text"], reasoning: false, contextWindow: 10000, maxTokens: 100,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    const requests: string[] = [];
    const stream = (_model: unknown, transcript: unknown) => {
      requests.push(Bun.inspect(transcript, { depth: 100 }));
      const call = requests.length === 1;
      const output = new AssistantMessageEventStream();
      const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
        timestamp: 1, stopReason: call ? "toolUse" : "stop",
        content: call ? [{ type: "toolCall", id: "host-call", name: tool.name, arguments: { value: "safe" } }] : [{ type: "text", text: "done" }],
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      output.push({ type: "done", reason: call ? "toolUse" : "stop", message }); output.end(); return output;
    };
    let networkCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => { networkCalls++; throw new Error("Network forbidden"); }) as unknown as typeof fetch;
    const forbidden = async (): Promise<never> => { throw new Error("Ambient credentials forbidden"); };
    const models = createModels({ authContext: { env: forbidden, fileExists: forbidden } });
    models.setProvider(createProvider({ id: model.provider, models: [model],
      auth: { apiKey: { name: "Synthetic", resolve: async () => ({ auth: {}, source: "fixture" }) } },
      api: { stream, streamSimple: stream } }));
    const storage = new MemoryStorage();
    const harness = await Harness.open(storage, { models, registry,
      settings: { retry: { enabled: false }, compaction: { enabled: false } } }, context);
    try {
      const root = await harness.root(context, { agent: { model: { provider: model.provider, modelId: model.id }, extensions: [extension], tools: [tool] } });
      await (await root.submit({ type: "input", requestId: "failure", content: "call" }, context)).wait(context);
      await (await root.submit({ type: "input", requestId: "next", content: "continue" }, context)).wait(context);
      const entries = (await root.entries({}, 100, undefined, context)).items;
      const results = entries.flatMap(entry => entry.model ?? []).filter(message => message.role === "toolResult");
      expect(results).toHaveLength(1); expect(results[0]?.isError).toBe(true);
      const safeMessage = phase.startsWith("authority") ? "Host tool authority unavailable"
        : phase === "prepare" ? "Host tool arguments failed" : "Host tool execution failed";
      expect(Bun.inspect(results, { depth: 100 })).toContain(safeMessage);
      expect(Bun.inspect(entries, { depth: 100 })).not.toContain(marker);
      expect(requests).toHaveLength(3);
      expect(requests[2]).toContain(safeMessage);
      expect(requests.join("\n")).not.toContain(marker);
      expect(networkCalls).toBe(0);
    } finally { await harness.close(context); globalThis.fetch = originalFetch; }
  });
}

test("public durable Harness prepares and validates args before existing host execution; keeps native result channels", async () => {
  const f = fixture(), tool = f.tool();
  const extension = defineExtension({ name: "host-tool-qualification", tools: [tool] });
  const registry = createRegistry(); registry.install(extension);
  const model: Model<"openai-completions"> = { id: "synthetic", name: "Synthetic", provider: "qualification", api: "openai-completions",
    baseUrl: "https://invalid.invalid", input: ["text"], reasoning: false, contextWindow: 10000, maxTokens: 100,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  let invalid = false;
  const stream = (_model: unknown, transcript: { messages: readonly { role: string }[] }) => {
    const output = new AssistantMessageEventStream();
    const call = transcript.messages.at(-1)?.role === "user";
    const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
      timestamp: 1, stopReason: call ? "toolUse" : "stop",
      content: call ? [{ type: "toolCall", id: "host-call", name: tool.name, arguments: { value: 42 } }] : [{ type: "text", text: "done" }],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    output.push({ type: "done", reason: call ? "toolUse" : "stop", message }); output.end(); return output;
  };
  // Exercise the public preparation port, including rejection after a bad repair.
  tool.prepareArguments = raw => invalid ? { value: {} as string } : f.definition.prepareArguments!(raw);
  const forbidden = async (): Promise<never> => { throw new Error("Ambient credentials forbidden"); };
  const models = createModels({ authContext: { env: forbidden, fileExists: forbidden } });
  models.setProvider(createProvider({ id: model.provider, models: [model],
    auth: { apiKey: { name: "Synthetic", resolve: async () => ({ auth: {}, source: "fixture" }) } },
    api: { stream, streamSimple: stream } }));
  const harness = await Harness.open(new MemoryStorage(), { models, registry,
    settings: { retry: { enabled: false }, compaction: { enabled: false } } }, context);
  try {
    const root = await harness.root(context, { agent: { model: { provider: model.provider, modelId: model.id }, extensions: [extension], tools: [tool] } });
    await (await root.submit({ type: "input", requestId: "valid", content: "call" }, context)).wait(context);
    expect(f.counts().effects).toBe(1);
    const entries = await root.entries({}, 100, undefined, context);
    const results = entries.items.flatMap(entry => entry.model ?? []).filter(message => message.role === "toolResult");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ content: [{ type: "text", text: "42" }, f.image], details: f.details, isError: false });
    invalid = true;
    await (await root.submit({ type: "input", requestId: "invalid", content: "call" }, context)).wait(context);
    expect(f.counts().effects).toBe(1);
    const rejected = (await root.entries({}, 100, undefined, context)).items.flatMap(entry => entry.model ?? [])
      .find(message => message.role === "toolResult" && message.isError);
    expect(rejected).toMatchObject({ isError: true });
  } finally { await harness.close(context); }
});
