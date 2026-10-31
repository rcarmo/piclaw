import "./src/test-guard.js";
import { test, expect } from "bun:test";
import { projectModelContext } from "../../runtime/durable-engine/src/host-model-context.ts";
import { createHostModelTools, hostModelToolNames, nativeToolInstructions } from "../../runtime/durable-engine/src/host-model-controls.js";
import { BACKGROUND_CONTEXT as context, withAbortSignal } from "../../runtime/durable-engine/qualification/context.ts";
import type { ConversationId, TaskId } from "../../runtime/durable-engine/qualification/durable.ts";

const conversationId = 7 as ConversationId, taskId = 9 as TaskId;

function fixture(sections: any[] = [], messages: any[] = [], prepareContext?: Parameters<typeof createHostModelTools>[0]["prepareContext"]) {
  const model = (provider: string, id: string, contextWindow = 200000) => ({ provider, id, name: id, api: "openai-responses", reasoning: true,
    input: ["text"], contextWindow, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
  const catalog = [model("first", "one"), model("second", "two"), model("second", "tiny", 100)];
  let state: any = { model: { provider: "first", modelId: "one" }, thinkingLevel: "off", tools: ["bash"] };
  let valid = true, available = true, guards = 0, reads = 0, duringDoc: ((current: any) => void) | undefined;
  const tools = createHostModelTools({ assertCurrent() { if (!valid) throw Error("revoked"); }, available: () => catalog as any,
    assertModel(choice) { if (!available || !catalog.some(m => m.provider === choice.provider && m.id === choice.modelId)) throw Error("unavailable"); },
    prepareContext: prepareContext ?? (async (call, model, thinkingLevel) => {
      expect(call.conversationId).toBe(conversationId); reads++;
      const projected = await projectModelContext({ messages, entries: [], contributions: [] } as any,
        { conversationId, agent: { ...state, model, thinkingLevel, sections, tools: [] }, env: undefined, read: api }, context);
      return { messages: projected, assertScopeCurrent() {}, async assertCurrent() {} };
    }),
    async captureSourceGuard(call) { expect(call).toEqual({ conversationId, taskId, toolCallId: "owned" }); return () => { guards++; if (!valid) throw Error("revoked"); }; },
  });
  const api: any = { conversationId, taskId, callId: "owned", registry: { tools: () => [], sections: () => sections },
    async agent() { return { ...state, sections }; },
    async commit(body: any) { const copy = structuredClone(state); const result = await body({ async doc() { duringDoc?.(copy); return copy; } }); state = copy; return result; } };
  const run = async (name: string, args: any = {}, ctx = context) => {
    const tool = tools.find(t => t.name === name)!;
    const result: any = await tool.execute(args, api, ctx); return JSON.parse(result.output[0].text);
  };
  return { tools, run, state: () => state, revoke() { valid = false; }, unapprove() { available = false; },
    duringDoc(fn: (current: any) => void) { duringDoc = fn; }, stats: () => ({ guards, reads }) };
}
test("native model controls are registered, model-only and nonreplayable, with native discovery guidance", () => {
  const f = fixture(); expect(f.tools.map(t => t.name)).toEqual([...hostModelToolNames]);
  for (const tool of f.tools) { expect(tool.callers).toEqual(["model"]); expect(tool.replay).toBe("unsafe"); }
  expect(nativeToolInstructions).toContain("searchTools"); expect(nativeToolInstructions).toContain("describeTool"); expect(nativeToolInstructions).toContain("bash");
});
test("list and empty controls inspect current persisted state without changing it", async () => {
  const f = fixture(), before = structuredClone(f.state());
  expect((await f.run("list_models", { query: "second", limit: 1, offset: 1 })).models[0].id).toBe("tiny");
  for (const name of ["get_model_state", "set_model"]) { const result = await f.run(name); expect(result.model).toBe("first/one"); expect(result.thinking_level).toBe("off"); expect(result.changed).toBe(false); }
  expect(f.state()).toEqual(before); expect(f.stats().reads).toBe(0);
});
test("owned model and thinking selection persists only the conversation and preserves explicit off", async () => {
  const f = fixture(); const changed = await f.run("set_model", { model: "second/two", thinking_level: "off" });
  expect(changed.model).toBe("second/two"); expect(changed.applies_to).toBe("next model request");
  expect(f.state()).toEqual({ model: { provider: "second", modelId: "two" }, thinkingLevel: "off", tools: ["bash"] });
  await f.run("switch_model", { model: "one" }); expect(f.state().model.provider).toBe("first");
  await f.run("switch_thinking", { level: "medium" }); expect(f.state().thinkingLevel).toBe("medium");
  expect(f.stats().reads).toBe(2);
});
test("invalid model/thinking leaves state unchanged and small-context targets retain the existing admission bound", async () => {
  const f = fixture(), before = structuredClone(f.state());
  expect((await f.run("set_model", { model: "missing/model" })).error).toContain("not available");
  expect((await f.run("set_model", { model: "second/two", thinking_level: "invalid" })).error).toContain("Unsupported");
  await expect(f.run("set_model", { model: "second/tiny" })).rejects.toThrow("compact first");
  expect(f.state()).toEqual(before);
});
for (const phase of ["before", "after-await", "policy"] as const) test(`model controls fail closed on ${phase} revocation`, async () => {
  const f = fixture(), before = structuredClone(f.state());
  if (phase === "before") f.revoke();
  if (phase === "after-await") f.duringDoc(() => f.revoke());
  if (phase === "policy") f.duringDoc(() => f.unapprove());
  await expect(f.run("set_model", { model: "second/two" })).rejects.toThrow(phase === "policy" ? "unavailable" : "revoked");
  expect(f.state()).toEqual(before);
});
for (const phase of ["before", "after-await"] as const) test(`model controls preserve state on ${phase} cancellation`, async () => {
  const f = fixture(), before = structuredClone(f.state()), controller = new AbortController();
  const reason = new Error(`MODEL_CONTROL_ABORT_${phase}`);
  const ctx = withAbortSignal(controller.signal, context);
  expect(ctx.abortSignal).toBe(controller.signal);
  if (phase === "before") controller.abort(reason);
  else f.duringDoc(() => controller.abort(reason));
  await expect(f.run("set_model", { model: "second/two" }, ctx)).rejects.toBe(reason);
  expect(controller.signal.aborted).toBe(true);
  expect(f.state()).toEqual(before);
  expect(f.stats().reads).toBe(phase === "before" ? 0 : 1);
  // A fresh context still permits the same operation: cancellation, not a
  // malformed context or a broken fixture, was the reason for refusal.
  f.duringDoc(() => {});
  expect((await f.run("set_model", { model: "second/two" })).model).toBe("second/two");
  expect(f.state().model).toEqual({ provider: "second", modelId: "two" });
});

test("registered prompt sections are measured before configuration; empty optional section does not disable model controls", async () => {
  let renders = 0;
  const f = fixture([{ key: "late-night-regrets", async render(input: any) { renders++; expect(input.agent.model).toEqual({provider:"second",modelId:"two"}); return undefined; } }]);
  expect((await f.run("set_model", {model:"second/two",thinking_level:"off"})).model).toBe("second/two");
  expect(renders).toBe(1);
});
for (const failure of ["oversize", "render-error", "revoked"] as const) test(`dynamic prompt ${failure} denies model change without writes`, async () => {
  const f = fixture([{key:"dynamic", async render() { if(failure==="render-error") throw Error("unreadable prompt"); if(failure==="revoked") f.revoke(); return "界".repeat(failure==="oversize" ? 1000000 : 1); }}]);
  const before = structuredClone(f.state());
  await expect(f.run("set_model", {model:"second/two"})).rejects.toThrow();
  expect(f.state()).toEqual(before);
});

for (const sameModel of [false, true]) test(`thinking-only controls skip model-fit work with explicit same model=${sameModel}`, async () => {
  const f = fixture([{ key: "not-needed", async render() { throw Error("must not render for thinking-only"); } }],
    [{ role: "user", content: "x".repeat(2100000), timestamp: 0 }]);
  const result = await f.run("set_model", { ...(sameModel ? { model: "first/one" } : {}), thinking_level: "high" });
  expect(result.thinking_level).toBe("high"); expect(f.state().model).toEqual({ provider: "first", modelId: "one" });
  expect(f.stats().reads).toBe(0);
  await f.run("switch_thinking", { level: "off" }); expect(f.state().thinkingLevel).toBe("off");
  expect((await f.run("set_model", {thinking_level:"invalid"})).error).toContain("Unsupported");
  expect(f.state().thinkingLevel).toBe("off");
  await expect(f.run("set_model", {model:"second/two"})).rejects.toThrow("must not render");
  expect(f.state().model).toEqual({ provider: "first", modelId: "one" });
});
test("large existing context permits a thinking-only change but still rejects a different-model fit", async () => {
  const f = fixture([], [{role:"user", content:"x".repeat(2100000),timestamp:0}]);
  expect((await f.run("switch_thinking",{level:"high"})).thinking_level).toBe("high");
  expect(f.stats().reads).toBe(0);
  await expect(f.run("set_model",{model:"second/two"})).rejects.toThrow("compact first");
  expect(f.state().model).toEqual({provider:"first",modelId:"one"});
  expect(f.state().thinkingLevel).toBe("high");
});
test("same-model optimisation fails closed if the persisted model changes during preparation", async () => {
  const f=fixture(); const before=structuredClone(f.state());
  f.duringDoc(current=>{current.model={provider:"second",modelId:"two"};});
  await expect(f.run("set_model",{model:"first/one",thinking_level:"high"})).rejects.toThrow("Model selection changed");
  expect(f.state()).toEqual(before);
});

for (const reject of [false, true]) test(`owned model selection uses prepared selected schemas and final commit fence; reject=${reject}`, async () => {
  let preparations = 0, checks = 0;
  const f = fixture([{ key: "phase-must-not-render", render() { throw Error("stale phase prompt must not render"); } }], [], async (call, model) => {
    preparations++; expect(call).toEqual({ conversationId, taskId, toolCallId: "owned" });
    expect(model).toEqual({ provider: "second", modelId: "two" });
    return { messages: [], assertScopeCurrent() {}, async assertCurrent(_tx, current) {
      checks++; expect((current as any).model).toEqual({ provider: "first", modelId: "one" });
      if (reject) throw Error("Model context history changed; retry the command.");
    } };
  });
  const before = structuredClone(f.state());
  if (reject) {
    await expect(f.run("set_model", { model: "second/two" })).rejects.toThrow("history changed");
    expect(f.state()).toEqual(before);
  } else {
    expect((await f.run("set_model", { model: "second/two" })).model).toBe("second/two");
  }
  expect(preparations).toBe(1); expect(checks).toBe(1); expect(f.stats().reads).toBe(0);
});
