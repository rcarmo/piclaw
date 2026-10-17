import "./src/test-guard.js";
import { test, expect } from "bun:test";
import { Harness, MemoryStorage, createRegistry, defineExtension, defineTool, watchEvents } from "../../runtime/durable-engine/qualification/durable.ts";
import { Type, createModels, createProvider, type AssistantMessage, type Model } from "../../runtime/durable-engine/qualification/ai.ts";
import { AssistantMessageEventStream } from "../../runtime/durable-engine/qualification/event-stream.ts";
import { context, barrier } from "./src/fixture.js";
import { observeProjection, type ProjectionBinding } from "../../runtime/durable-engine/src/index.js";

async function fixture(options: { holdTool?: boolean; streamUpdate?: boolean } = {}) {
  const hold = barrier(), partial = barrier(), toolEntered = barrier(), toolHold = barrier(), streamHold = barrier(), finalHold = barrier();
  const tool = defineTool({ name: "safe_tool", description: "fake", callers: ["model"], replay: "safe",
    parameters: Type.Object({}), execute: async () => {
      toolEntered.release();
      if (options.holdTool) await toolHold.promise;
      return { output: [{ type: "text", text: "SECRET result" }] };
    } });
  const extension = defineExtension({ name: "projection", tools: [tool] });
  const registry = createRegistry(); registry.install(extension);
  const model: Model<"openai-completions"> = { id: "fake", name: "Fake", provider: "projection", api: "openai-completions",
    baseUrl: "https://invalid.invalid", reasoning: true, input: ["text"], contextWindow: 100000, maxTokens: 100,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  let calls = 0;
  const stream = () => {
    const out = new AssistantMessageEventStream();
    void (async () => {
      const first = ++calls === 1;
      const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
        content: [{ type: "text", text: "" }], stopReason: "stop", timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      out.push({ type: "start", partial: structuredClone(message) });
      out.push({ type: "text_start", contentIndex: 0, partial: structuredClone(message) });
      message.content = [{ type: "text", text: "public SECRET partial" }];
      out.push({ type: "text_delta", contentIndex: 0, delta: "public SECRET partial", partial: structuredClone(message) });
      if (first) {
        partial.release(); await hold.promise;
        if (options.streamUpdate) {
          message.content = [{ type: "text", text: "public SECRET partial live delta" }];
          out.push({ type: "text_delta", contentIndex: 0, delta: " live delta", partial: structuredClone(message) });
          await streamHold.promise;
        }
      }
      if (!first && options.holdTool) await finalHold.promise;
      message.content.push({ type: "thinking", thinking: "SECRET reasoning" });
      out.push({ type: "thinking_start", contentIndex: 1, partial: structuredClone(message) });
      out.push({ type: "thinking_delta", contentIndex: 1, delta: "SECRET reasoning", partial: structuredClone(message) });
      if (first) { message.content.push({ type: "toolCall", id: "call", name: "safe_tool", arguments: {} }); message.stopReason = "toolUse"; }
      out.push({ type: "done", reason: first ? "toolUse" : "stop", message }); out.end();
    })(); return out;
  };
  const models = createModels({ authContext: { env: async () => { throw new Error("no credentials"); }, fileExists: async () => false } });
  models.setProvider(createProvider({ id: model.provider, models: [model],
    auth: { apiKey: { name: "fake", resolve: async () => ({ auth: {}, source: "fake" }) } }, api: { stream, streamSimple: stream } }));
  const harness = await Harness.open(new MemoryStorage(), { registry, models,
    settings: { progress: { partialIntervalMs: 0, outputIntervalMs: 0 }, retry: { enabled: false }, compaction: { enabled: false } } }, context);
  const root = await harness.root(context, { agent: { model: { provider: model.provider, modelId: model.id }, extensions: [extension], tools: [tool] } });
  const submission = await root.submit({ type: "input", content: "hello", requestId: "accepted" }, context);
  await partial.promise;
  // Provider emission precedes durable publication: attach only after the partial is public.
  const ready = await watchEvents(harness, root.id, context);
  if (!ready.snapshot.generation?.message) {
    const committed = barrier();
    ready.start(async events => { if (events.some(e => e.type === "message_start" || e.type === "message_update")) committed.release(); });
    await committed.promise;
  }
  await ready.stop();
  const binding: ProjectionBinding = { chatJid: "web:projection", operationId: "host-accepted-op", harnessOperationId: "host-binding",
    threadId: "existing-thread", agentId: "existing-agent",
    submissionId: submission.id, conversationId: root.id, watchGeneration: 1 };
  const events: { name: string; payload: Record<string, unknown> }[] = [];
  let current = true;
  const ports = { isCurrent: () => current, sanitize: (s: string) => s.replaceAll("SECRET", "[redacted]"),
    send: (name: string, payload: Record<string, unknown>) => { events.push({ name, payload }); } };
  return { harness, root, submission, binding, ports, events, hold, toolEntered, toolHold, streamHold, finalHold,
    revoke: () => { current = false; }, calls: () => calls,
    close: async () => { hold.release(); toolHold.release(); streamHold.release(); finalHold.release(); await harness.close(context); } };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 500; i++) { if (check()) return; await Bun.sleep(2); }
  throw new Error("projection timeout");
}

test("real public watch projects committed partial/tool events through actual EF-S08, never terminal", async () => {
  const f = await fixture({ streamUpdate: true });
  const observer = await observeProjection(f.harness, f.binding, f.ports, context);
  try {
    await until(() => f.events.some(e => String(e.payload.text).includes("partial")));
    expect(f.events.some(e => e.name === "agent_status")).toBe(false); // Snapshot is draft reset only.
    expect(f.events[0]?.payload.text).toBe("");
    expect(f.calls()).toBe(1); // Attaching a watch does not schedule another run.
    f.hold.release();
    await until(() => f.events.some(e => String(e.payload.text).includes("live delta")));
    f.streamHold.release(); await f.submission.wait(context);
    await until(() => f.events.some(e => e.payload.type === "tool_call"));
    expect(observer.settlementAuthority).toBe(false);
    expect(JSON.stringify(f.events)).not.toContain("SECRET");
    expect(JSON.stringify(f.events)).not.toContain("reasoning");
    expect(f.events.every(e => e.payload.turn_id === f.binding.operationId)).toBe(true);
    expect(f.events.some(e => ["done", "error"].includes(String(e.payload.type)))).toBe(false);
    const { chatJid, operationId, harnessOperationId, watchGeneration } = f.binding;
    const identity = { chatJid, operationId, harnessOperationId, watchGeneration, receiptSeq: 999 };
    const denied = await observer.sink.publishTerminal({ ...identity, type: "agent_terminal",
      terminalCommitRef: "watch-is-not-authority", disposition: "completed", messageRowId: null, errorCode: null });
    expect(!denied.ok && denied.error._tag).toBe("terminal_not_committed");
    for (const patch of [{ operationId: "durable-task-is-not-host-op" }, { chatJid: "other-chat" }, { harnessOperationId: "other-binding" }]) {
      const wrong = await observer.sink.publishEvent({ ...identity, ...patch, type: "assistant_delta", textDelta: "wrong" });
      expect(!wrong.ok && wrong.error._tag).toBe("owner_conflict");
    }
    const protectedPayload = await observer.sink.publishEvent({ ...identity, type: "assistant_delta", textDelta: "safe",
      ...{ rawStack: "SECRET" } });
    expect(!protectedPayload.ok && protectedPayload.error._tag).toBe("protected_payload");
  } finally { await observer.stop(); await f.close(); }
}, 15000);

test("owner loss and callback stop fence observations but do not settle/cancel model work", async () => {
  const f = await fixture(); const observer = await observeProjection(f.harness, f.binding, f.ports, context);
  try {
    f.revoke(); const count = f.events.length;
    await observer.stop();
    expect((await f.submission.status(context)).status).not.toBe("done");
    f.hold.release(); expect((await f.submission.wait(context)).status).toBe("done");
    expect(f.events.length).toBe(count);
    const { chatJid, operationId, harnessOperationId, watchGeneration } = f.binding;
    const late = await observer.sink.publishEvent({ chatJid, operationId, harnessOperationId, watchGeneration,
      receiptSeq: 999, type: "assistant_delta", textDelta: "late" });
    expect(!late.ok && late.error._tag).toBe("owner_conflict");
  } finally { await observer.stop(); await f.close(); }
}, 15000);

test("more than 100 pending public batches resync via fresh EF generation, bounded replacement, stale rejected", async () => {
  const f = await fixture(); const observer = await observeProjection(f.harness, f.binding, f.ports, context);
  const entered = barrier(), release = barrier();
  const original = observer.sink.publishEvent.bind(observer.sink);
  let blocked = false;
  observer.sink.publishEvent = async event => { if (!blocked) { blocked = true; entered.release(); await release.promise; } return original(event); };
  try {
    f.hold.release();
    await entered.promise;
    for (let i = 0; i < 110; i++) await f.root.submit({ type: "write", entry: { kind: "app.note", data: i } }, context);
    release.release();
    await until(() => f.events.filter(e => e.name === "agent_draft" && e.payload.text === "").length >= 2);
    const { chatJid, operationId, harnessOperationId, watchGeneration } = f.binding;
    const stale = await original({ chatJid, operationId, harnessOperationId, watchGeneration,
      receiptSeq: 99999, type: "assistant_delta", textDelta: "stale" });
    expect(!stale.ok && stale.error._tag).toBe("stale_generation");
    expect(f.events.every(e => Buffer.byteLength(JSON.stringify(e.payload), "utf8") <= 65536)).toBe(true);
    expect(f.events.some(e => e.payload.type === "thinking")).toBe(false);
    expect(f.events.some(e => e.payload.type === "done")).toBe(false);
  } finally { release.release(); await observer.stop(); await f.close(); }
}, 15000);

test("snapshot from a different submission cannot project its partial or tools", async () => {
  const f = await fixture();
  const unrelated = await f.root.submit({ type: "write", entry: { kind: "app.note", data: "unrelated" } }, context);
  const observer = await observeProjection(f.harness, { ...f.binding, submissionId: unrelated.id }, f.ports, context);
  try {
    f.hold.release(); await f.submission.wait(context); await Bun.sleep(10);
    expect(f.events.filter(e => e.name === "agent_draft").every(e => e.payload.text === "")).toBe(true);
    expect(f.events.some(e => e.name === "agent_status")).toBe(false);
    expect(f.events[0]?.payload.text).toBe("");
  } finally { await observer.stop(); await f.close(); }
}, 15000);

test("public assistant write during accepted held tool is never draft provenance", async () => {
  const f = await fixture({ holdTool: true });
  const observer = await observeProjection(f.harness, f.binding, f.ports, context);
  const publicWatch = await watchEvents(f.harness, f.root.id, context);
  const observed: string[] = [];
  publicWatch.start(async events => { for (const event of events) {
    if (event.type === "message_start" && event.message.role === "assistant")
      for (const block of event.message.content) if (block.type === "text") observed.push(block.text);
  } });
  try {
    await until(() => f.events.some(e => String(e.payload.text).includes("partial")));
    f.hold.release(); await f.toolEntered.promise;
    await until(() => f.events.some(e => e.payload.type === "tool_call"));
    const marker = "UNTRUSTED_PUBLIC_ASSISTANT_WRITE";
    const message: AssistantMessage = { role: "assistant", api: "openai-completions", provider: "custom", model: "custom",
      content: [{ type: "text", text: marker }], stopReason: "stop", timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    await f.root.submit({ type: "write", entry: { kind: "app.custom", model: [message] } }, context);
    // Model-bearing writes queue during tools, then append at the same run's post-tools boundary.
    f.toolHold.release();
    await until(() => observed.includes(marker)); // Real public API emits the ambiguous start.
    expect((await f.submission.status(context)).status).not.toBe("done");
    expect(JSON.stringify(f.events)).not.toContain(marker);
    // A reattachment snapshot must not harvest committed assistant-looking entries either.
    const resumed = await observeProjection(f.harness, { ...f.binding, watchGeneration: 2 }, f.ports, context);
    await resumed.stop();
    f.finalHold.release(); await f.submission.wait(context); await Bun.sleep(10);
    expect(JSON.stringify(f.events)).not.toContain(marker);
    expect(f.events.some(e => e.payload.type === "thinking")).toBe(false);
  } finally { await publicWatch.stop(); await observer.stop(); await f.close(); }
}, 15000);

for (const sample of ["\u0000", "😀é"]) test(`serialized publication bound includes escaping and UTF-8: ${JSON.stringify(sample)}`, async () => {
  const f = await fixture();
  const observer = await observeProjection(f.harness, f.binding, { ...f.ports, sanitize: () => sample.repeat(20000) }, context);
  try {
    await until(() => f.events.some(e => typeof e.payload.text === "string" && e.payload.text.length === 8192));
    expect(f.events.every(e => Buffer.byteLength(JSON.stringify(e.payload), "utf8") <= 65536)).toBe(true);
  } finally { await observer.stop(); await f.close(); }
}, 15000);

test("oversized host metadata fails closed for every serialized publication", async () => {
  const f = await fixture();
  const observer = await observeProjection(f.harness, { ...f.binding, threadId: "😀".repeat(20000) }, f.ports, context);
  try {
    f.hold.release(); await f.submission.wait(context); await Bun.sleep(10);
    expect(f.events).toEqual([]);
  } finally { await observer.stop(); await f.close(); }
}, 15000);

test("host-sanitized output and cumulative captured draft are bounded", async () => {
  const f = await fixture();
  const observer = await observeProjection(f.harness, f.binding, { ...f.ports, sanitize: () => "safe".repeat(20000) }, context);
  try {
    await until(() => f.events.some(e => String(e.payload.text).length === 8192));
    f.hold.release(); await f.submission.wait(context); await Bun.sleep(10);
    expect(f.events.every(e => JSON.stringify(e.payload).length < 40000)).toBe(true);
    expect(f.events.every(e => e.payload.agent_id === "existing-agent" && e.payload.thread_id === "existing-thread")).toBe(true);
    expect(JSON.stringify(f.events)).not.toContain("SECRET");
  } finally { await observer.stop(); await f.close(); }
}, 15000);
