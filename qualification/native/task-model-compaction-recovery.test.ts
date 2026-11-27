import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Harness } from "../../runtime/durable-engine/qualification/durable.ts";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/bun-sqlite.ts";
import { taskModelRequestScope, withTaskModelRequestScope, type TaskModelRequestScope } from "../../runtime/durable-engine/src/task-model-boundary-shim.ts";
import { A2UI_METADATA_HEADING } from "../../runtime/src/channels/web/a2ui/transport-metadata.ts";
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

test("actual built-in compaction projects only the accepted A2UI source before the provider summary request", async () => {
  const directory = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "compaction-a2ui-boundary-"));
  const fixture = await openFixture({ acquired: true });
  const selectedModel = fixture.models.getModel("qualification", "synthetic")!;
  const requests: { model: unknown; transcript: { messages: readonly { role: string; content: unknown }[] }; scope: TaskModelRequestScope }[] = [];
  const completeSimple = fixture.models.completeSimple.bind(fixture.models);
  const models = new Proxy(fixture.models, { get(target, key) {
    if (key === "completeSimple") return (...args: Parameters<typeof completeSimple>) => {
      const scope = taskModelRequestScope(args[2]?.signal);
      if (!scope) throw Error("Missing real compaction summary request scope");
      requests.push({ model: args[0], transcript: args[1], scope });
      return completeSimple(...args);
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const visible = "Keep this accepted decision";
  const metadata = JSON.stringify({ a2uiRendererDataModel: { version: "1.0", surfaces: { legacy: {} } } });
  const literal = `${visible}\n\n${A2UI_METADATA_HEADING}${metadata}`;
  const projected: { source: { chatJid: string; sourceId: string; conversationId: number }; content: string }[] = [];
  const project = (source: { chatJid: string; sourceId: string; conversationId: number }, content: string) => {
    projected.push({ source, content });
    return content === literal && source.sourceId === "legacy-a2ui" ? visible : content;
  };
  const database = new BunSqliteDatabase(join(directory, "tasks.sqlite"));
  const harness = await Harness.open(
    await SqliteStorage.open(database),
    { models, registry: withTaskModelRequestScope(fixture.registry, undefined, project),
      settings: { retry: { enabled: false }, compaction: { enabled: false, keepRecentTokens: 1 } } }, context);
  try {
    const conversation = await harness.createConversation({ ownership: { kind: "ownerless" },
      agent: { model: { provider: "qualification", modelId: "synthetic" } } }, context);
    const ids = await conversation.commit(async tx => {
      const accepted = await tx.appendEntry(conversation.id, { kind: "host.accepted",
        data: { chatJid: "web:default", sourceId: "legacy-a2ui", conversationId: conversation.id },
        model: [{ role: "user", content: literal, timestamp: 1 }] });
      const human = await tx.appendEntry(conversation.id, { kind: "pi.user",
        model: [{ role: "user", content: literal, timestamp: 2 }] });
      await tx.appendEntry(conversation.id, { kind: "pi.user", model: [{ role: "user", content: "Recent tail", timestamp: 3 }] });
      return [accepted.id, human.id];
    }, context);
    const history = () => database.all<{ record: string }>("SELECT record FROM entries WHERE id IN (?, ?) ORDER BY id", ids[0], ids[1]);
    const before = await history();

    const taskId = await conversation.compact("Retain the accepted decision", context);
    harness.resume();
    const settled = await harness.waitForTask(taskId, context);
    expect(settled.state).toMatchObject({ status: "terminal", outcome: { status: "completed" } });
    const projection = { source: { chatJid: "web:default", sourceId: "legacy-a2ui", conversationId: conversation.id }, content: literal };
    expect(projected).toEqual([projection, projection]);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.scope).toMatchObject({ taskKind: "pi.compaction", phase: "summarize", taskId,
      conversationId: conversation.id });
    expect(requests[0]!.model).toBe(selectedModel);
    const providerPayload = fixture.host.transcripts.map(transcript => JSON.parse(transcript) as { role: string; content: unknown }[]).at(-1)!;
    expect(JSON.stringify(providerPayload)).toBe(JSON.stringify(requests[0]!.transcript.messages));
    const summaryPrompt = providerPayload.flatMap(message => typeof message.content === "string" ? [message.content] :
      Array.isArray(message.content) ? (message.content as { type: string; text?: string }[]).filter(block => block.type === "text").map(block => block.text ?? "") : [])
      .join("\n");
    expect(summaryPrompt).toContain(`[User]: ${visible}\n\n[User]: ${literal}`);
    expect(summaryPrompt.split(A2UI_METADATA_HEADING)).toHaveLength(2);
    const after = await history();
    expect(after).toEqual(before);
    expect(JSON.parse(after[0]!.record).model[0].content).toBe(literal);
    expect(JSON.parse(after[1]!.record).model[0].content).toBe(literal);
  } finally {
    await harness.close(context); await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 10000);
