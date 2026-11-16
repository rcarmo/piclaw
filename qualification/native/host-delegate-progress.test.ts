import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { watchNativeDelegateProgress } from "../../runtime/durable-engine/src/host-delegate-progress.ts";
import { context, barrier } from "./src/fixture.ts";
import type { Conversation, ConversationView, ConversationWatch } from "../../runtime/durable-engine/qualification/durable.ts";
import type { NativeDelegateProgress } from "../../runtime/src/agent-pool/delegate-progress.ts";

function fixture(publish?: (p: NativeDelegateProgress) => Promise<void>) {
  let listener: Parameters<ConversationWatch['start']>[0] = async () => {};
  let stops = 0, owned = true;
  const events: NativeDelegateProgress[] = [];
  const frame = (live: any, entries: any[] = []) => ({ docs: { "pi.live": live }, entries }) as unknown as ConversationView;
  const child = { async watch() { return { value: frame({}), closed: new Promise(() => {}),
    start(fn: typeof listener) { listener = fn; }, async stop() { stops++; } }; } } as unknown as Pick<Conversation, "watch">;
  const open = () => watchNativeDelegateProgress(child, { conversationId: 7, model: { provider: "qualification", modelId: "synthetic" },
    startedAt: Date.now(), assertCurrent() { if (!owned) throw Error("revoked"); }, async publish(p) { events.push(p); await publish?.(p); } }, context);
  return { events, open, frame, emit: (live: any, entries?: any[]) => listener({kind:'value',value:frame(live, entries),ops:[],retired:false},context),
    revoke() { owned = false; }, stops: () => stops };
}
test("child observer publishes bounded lifecycle/counts but never child text, reasoning or arguments", async () => {
  const f = fixture(), progress = await f.open();
  try {
    await f.emit({ generation: { taskId: 10, message: { role: "assistant", content: [
      { type: "thinking", thinking: "PRIVATE_REASONING" }, { type: "text", text: "PRIVATE_TEXT" }] } } });
    expect(f.events.at(-1)).toMatchObject({ phase: "generating", responseChars: 12, tools: [] });
    await f.emit({ tools: [{ name: "read", status: "running", arguments: { path: "PRIVATE_PATH" }, output: "PRIVATE_OUTPUT" },
      { name: "unapproved_PRIVATE", status: "running" }, { name: "bash", status: "done" }] });
    expect(f.events.at(-1)).toMatchObject({ phase: "tool", tools: ["read"], responseChars: 12 });
    await f.emit({ generation: { retry: { at: 1 } } });
    expect(f.events.at(-1)?.phase).toBe("retrying");
    const count = f.events.length;
    await f.emit({ generation: { retry: { at: 2 } } });
    expect(f.events).toHaveLength(count);
    await progress.finish(20);
    expect(f.events.at(-1)).toMatchObject({ phase: "done", responseChars: 20, conversationId: 7 });
    expect(JSON.stringify(f.events)).not.toContain("PRIVATE");
    expect(f.stops()).toBe(1);
  } finally { await progress.stop(); }
  const count = f.events.length;
  await f.emit({ generation: {} });
  expect(f.events).toHaveLength(count);
});
test("committed generation is not double-counted against its remaining live projection", async () => {
  const f = fixture(), progress = await f.open();
  const message = { role: "assistant", content: [{ type: "text", text: "answer" }] };
  try {
    await f.emit({ generation: { taskId: 12, message } }, [{ kind: "pi.assistant", byTaskId: 12, model: [message] }]);
    expect(f.events.at(-1)?.responseChars).toBe(6);
  } finally { await progress.stop(); }
});
test("terminal publication joins in-flight observer callback before reporting done", async () => {
  const entered = barrier(), release = barrier();
  const f = fixture(async p => { if (p.phase === "generating") { entered.release(); await release.promise; } });
  const progress = await f.open();
  const updating = f.emit({ generation: {} }); await entered.promise;
  const finishing = progress.finish(5);
  await Promise.resolve();
  expect(f.events.at(-1)?.phase).toBe("generating");
  release.release(); await updating; await finishing;
  expect(f.events.at(-1)?.phase).toBe("done");
  expect(f.stops()).toBe(1);
  await progress.stop(); expect(f.stops()).toBe(1);
});
test("display failure and lost ownership never invalidate accepted child execution", async () => {
  const f = fixture(async () => { throw Error("display unavailable"); });
  const progress = await f.open(); await progress.finish(5); await progress.stop();
  expect(f.events).toHaveLength(1);
  const g = fixture(), watching = await g.open(); const count = g.events.length;
  g.revoke(); await g.emit({ generation: {} }); await watching.fail(); await watching.stop();
  expect(g.events).toHaveLength(count); expect(g.stops()).toBe(1);
});
test("failed observer publishes only bounded failure metadata", async () => {
  const f = fixture(), progress = await f.open(); await progress.fail(); await progress.stop();
  expect(f.events.at(-1)?.phase).toBe("failed"); expect(f.stops()).toBe(1);
});
