import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Harness } from "../../runtime/durable-engine/qualification/durable.ts";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/bun-sqlite.ts";
import { taskModelRequestScope, withTaskModelRequestScope, type TaskModelRequestScope } from "../../runtime/durable-engine/src/task-model-boundary-shim.ts";
import { openFixture, context, barrier } from "./src/fixture.ts";

test("actual compaction summary checkpoint rebuilds exact task scope after disk reopen", async () => {
  const directory = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "compaction-scope-recovery-"));
  const openStorage = () => SqliteStorage.open(new BunSqliteDatabase(join(directory, "tasks.sqlite")));
  const fixture = await openFixture({ acquired: true });
  const scopes: TaskModelRequestScope[] = [];
  let entered = barrier();
  fixture.host.modelHold = barrier();
  fixture.host.onModelEnter = signal => {
    const scope = taskModelRequestScope(signal);
    expect(scope).toBeDefined();
    expect(scope).toMatchObject({ taskKind: "pi.compaction", phase: "summarize" });
    scopes.push(scope!); entered.release();
  };
  const options = { models: fixture.models, registry: withTaskModelRequestScope(fixture.registry),
    settings: { retry: { enabled: false }, compaction: { enabled: false, keepRecentTokens: 1 } } };
  let harness = await Harness.open(await openStorage(), options, context);
  try {
    const conversation = await harness.createConversation({ ownership: { kind: "ownerless" }, agent: { model: { provider: "qualification", modelId: "synthetic" } } }, context);
    await conversation.commit(async tx => {
      for (let i = 0; i < 4; i++) await tx.appendEntry(conversation.id, { kind: "pi.user", model: [{ role: "user", content: `checkpoint ${i}`, timestamp: i }] });
    }, context);
    const taskId = await conversation.compact("Retain decisions", context);
    harness.resume();
    await entered.promise;
    const running = await harness.getTask(taskId, context);
    expect(running?.state.status).toBe("running");
    if (running?.state.status === "running") expect(running.state.checkpoint).toMatchObject({ phase: "summarize" });
    await harness.close(context);
    expect(scopes[0]!.signal.aborted).toBe(true);
    fixture.host.modelHold = undefined;
    fixture.host.finalContent = [{ type: "text", text: "Recovered summary" }];
    entered = barrier();
    harness = await Harness.open(await openStorage(), options, context);
    harness.resume();
    await entered.promise;
    const settled = await harness.waitForTask(taskId, context);
    expect(settled.state.outcome.status).toBe("completed");
    expect(scopes).toHaveLength(2);
    expect(scopes[1]!.taskId).toBe(scopes[0]!.taskId);
    expect(scopes[1]!.conversationId).toBe(scopes[0]!.conversationId);
    expect(scopes[1]!.signal).not.toBe(scopes[0]!.signal);
    expect(fixture.host.modelCalls).toBe(1);
  } finally {
    await harness.close(context); await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 10000);
