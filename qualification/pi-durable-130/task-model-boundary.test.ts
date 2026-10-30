import { expect, test } from "bun:test";
import { createRegistry, defineExtension, defineTask } from "../../runtime/durable-engine/qualification/durable.ts";
import { context } from "./src/fixture.ts";
import { withTaskModelRequestScope, taskModelRequestScope, taskModelHookScope } from "../../runtime/durable-engine/src/task-model-boundary-shim.ts";

test("temporary request scope preserves exact invocation identity through awaits and rejects other signals", async () => {
  const registry = createRegistry();
  const definition = defineTask({ name: "qualification.scope", version: 1, initial: () => ({ phase: "request" as const }),
    phases: { async request() {} }, async abort() {} });
  registry.install(defineExtension({ name: "scope", tasks: [definition] }));
  const wrapped = withTaskModelRequestScope(registry);
  const snapshot = wrapped.snapshot();
  expect(snapshot.task("qualification.scope")).toBe(snapshot.tasks().find(task => task.definition.name === "qualification.scope"));
  expect(registry.snapshot().task("qualification.scope")).toBe(definition);
  const controller = new AbortController();
  const runtime = { taskId: 12, conversationId: 34, signal: controller.signal };
  let observed: unknown;
  const task = defineTask({ name: "qualification.observe", version: 1, initial: () => ({ phase: "summarize" as const }),
    phases: { async summarize(_task, actual) {
      await Promise.resolve();
      observed = taskModelRequestScope(actual.signal);
      expect(taskModelHookScope({ taskId: actual.taskId, conversationId: actual.conversationId })).toBeUndefined();
      expect(taskModelRequestScope(new AbortController().signal)).toBeUndefined();
      expect(taskModelRequestScope(undefined)).toBeUndefined();
    } }, async abort() {} });
  registry.install(defineExtension({ name: "observe", tasks: [task] }));
  const phase = wrapped.snapshot().task("qualification.observe")!.definition.phases.summarize as Function;
  await phase({}, runtime, context);
  expect(observed).toMatchObject({ taskId: 12, conversationId: 34, taskKind: "qualification.observe", phase: "summarize", signal: controller.signal });
  expect(taskModelRequestScope(controller.signal)).toBeUndefined();
  controller.abort();
  await expect(phase({}, runtime, context)).rejects.toThrow();
});

test("Goal hook identity resolves only its current public generation IDs without a HookApi signal", async () => {
  const registry = createRegistry(), controller = new AbortController();
  const task = defineTask({ name: "pi.generation", version: 1, initial: () => ({ phase: "request" as const }),
    phases: { async request(_record, actual) {
      await Promise.resolve();
      const api = { taskId: actual.taskId, conversationId: actual.conversationId,
        get signal(): never { throw Error("HookApi.signal is not a public SDK contract"); } };
      expect(taskModelHookScope(api)?.signal).toBe(actual.signal);
      expect(taskModelHookScope({ taskId: 99 as never, conversationId: actual.conversationId })).toBeUndefined();
      expect(taskModelHookScope({ taskId: actual.taskId, conversationId: 99 as never })).toBeUndefined();
      expect(taskModelRequestScope(undefined)).toBeUndefined();
      expect(taskModelRequestScope(new AbortController().signal)).toBeUndefined();
    } }, async abort() {} });
  // Public RegistryReader fixture: the SDK registry already owns pi.generation.
  // Substitute only its executable definition for this identity-only unit test.
  const reader = { subscribe: registry.subscribe.bind(registry), snapshot() {
    const snapshot = registry.snapshot();
    return new Proxy(snapshot, { get(target, key) {
      if (key === "task") return (name: string) => name === "pi.generation" ? task : target.task(name);
      if (key === "tasks") return () => target.tasks().map(current => current.definition.name === "pi.generation" ? task : current);
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  } };
  const wrapped = withTaskModelRequestScope(reader);
  const phase = wrapped.snapshot().task("pi.generation")!.definition.phases.request as Function;
  await phase({}, { taskId: 12, conversationId: 34, signal: controller.signal }, context);
  expect(taskModelHookScope({ taskId: 12 as never, conversationId: 34 as never })).toBeUndefined();
});

for (const [kind, phaseName] of [["pi.generation", "request"], ["pi.compaction", "summarize"]] as const) test(`${kind}: checkpoint identity preserves attempts and input without hashing volatile task state`, async () => {
  const registry = createRegistry(), controller = new AbortController();
  const hashes: (string | undefined)[] = [];
  const observe = async (_record: unknown, runtime: { signal: AbortSignal }) => {
    hashes.push(taskModelRequestScope(runtime.signal)?.checkpointHash);
  };
  const task = defineTask({ name: kind, version: 1, initial: () => ({ phase: phaseName }),
    phases: { request: observe, summarize: observe }, async abort() {} });
  // Public executable-definition fixture only; no storage or execution authority.
  const reader = { subscribe: registry.subscribe.bind(registry), snapshot() {
    const snapshot = registry.snapshot();
    return new Proxy(snapshot, { get(target, key) {
      if (key === "task") return (name: string) => name === kind ? task : target.task(name);
      if (key === "tasks") return () => target.tasks().map(current => current.definition.name === kind ? task : current);
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  } };
  const execute = withTaskModelRequestScope(reader).snapshot().task(kind)!.definition.phases[phaseName] as Function;
  const runtime = { taskId: 12, conversationId: 34, signal: controller.signal };
  const checkpoint = { phase: phaseName, attempt: 1, cutoff: 5, model: { provider: "fixture", modelId: "same" } };
  const record = { id: 12, conversationId: 34, kind, version: 1, input: { z: 2, a: 1 }, state: { status: "running", checkpoint } };
  await execute(record, runtime, context);
  expect(hashes[0]).toMatch(/^[a-f0-9]{64}$/);
  await execute({ ...record, startedAt: 999, input: { a: 1, z: 2 }, state: { status: "running", checkpoint: {
    model: { modelId: "same", provider: "fixture" }, cutoff: 5, attempt: 1, phase: phaseName,
  } } }, runtime, context);
  expect(hashes[1]).toBe(hashes[0]);
  for (const changed of [
    { ...record, input: { z: 3, a: 1 } },
    { ...record, state: { status: "running", checkpoint: { ...checkpoint, attempt: 2 } } },
    { ...record, state: { status: "running", checkpoint: { ...checkpoint, cutoff: 6 } } },
    { ...record, state: { status: "running", checkpoint: { ...checkpoint, model: { provider: "fixture", modelId: "changed" } } } },
  ]) {
    await execute(changed, runtime, context);
    expect(hashes.at(-1)).not.toBe(hashes[0]); expect(hashes.at(-1)).toMatch(/^[a-f0-9]{64}$/);
  }
  for (const changed of [{ ...record, id: 99 }, { ...record, conversationId: 99 }, { ...record, version: 2 },
    { ...record, state: { status: "pending", checkpoint } }, { ...record, state: { status: "running", checkpoint: { ...checkpoint, phase: "other" } } }]) {
    await execute(changed, runtime, context); expect(hashes.at(-1)).toBeUndefined();
  }
  expect(taskModelRequestScope(controller.signal)).toBeUndefined();
});

test("temporary request scope isolates concurrent phases and follows registry replacement", async () => {
  const registry = createRegistry();
  const seen: number[] = [];
  const make = (version: number) => defineTask({ name: "qualification.concurrent", version,
    initial: () => ({ phase: "summarize" as const }),
    phases: { async summarize(_record, runtime) {
      await Bun.sleep(runtime.taskId === 1 ? 5 : 1);
      expect(taskModelRequestScope(runtime.signal)?.taskId).toBe(runtime.taskId);
      seen.push(version);
    } }, async abort() {} });
  const first = make(1);
  registry.install(defineExtension({ name: "concurrent", tasks: [first] }));
  const wrapped = withTaskModelRequestScope(registry);
  const original = wrapped.snapshot();
  let changes = 0;
  const unsubscribe = wrapped.subscribe(() => { changes++; });
  const phase = original.task("qualification.concurrent")!.definition.phases.summarize as Function;
  const signals = [new AbortController().signal, new AbortController().signal];
  await Promise.all(signals.map((signal, index) => phase({}, { taskId: index + 1, conversationId: index + 10, signal }, context)));
  registry.install(defineExtension({ name: "concurrent", tasks: [make(2)] }));
  expect(changes).toBe(1);
  expect(original.task("qualification.concurrent")!.definition.version).toBe(1);
  expect(wrapped.snapshot().task("qualification.concurrent")!.definition.version).toBe(2);
  expect(seen).toEqual([1, 1]);
  unsubscribe();
});

test("real SDK generation model call receives checkpoint identity from its actual running record", async () => {
  const { Harness } = await import("../../runtime/durable-engine/qualification/durable.ts");
  const { openFixture } = await import("./src/fixture.ts");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { SqliteStorage } = await import("../../runtime/durable-engine/qualification/sqlite.ts");
  const { BunSqliteDatabase } = await import("../../runtime/durable-engine/src/bun-sqlite.ts");
  const base = await openFixture({ acquired: true }); await base.close();
  const directory = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "real-checkpoint-"));
  const scopes: NonNullable<ReturnType<typeof taskModelRequestScope>>[] = [];
  const invoke = base.models.streamSimple.bind(base.models);
  const models = new Proxy(base.models, { get(target, key) {
    if (key === "streamSimple") return (...args: Parameters<typeof invoke>) => {
      const scope = taskModelRequestScope(args[2]?.signal);
      if (!scope) throw Error("Real task scope missing");
      scopes.push(scope); return invoke(...args);
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const harness = await Harness.open(await SqliteStorage.open(new BunSqliteDatabase(join(directory, "tasks.sqlite"))),
    { models, registry: withTaskModelRequestScope(base.registry) }, context);
  try {
    const root = await harness.root(context, { agent: { model: { provider: "qualification", modelId: "synthetic" } } });
    const submission = await root.submit({ type: "input", requestId: "real-checkpoint", content: "synthetic answer" }, context);
    expect((await submission.wait(context)).status).toBe("done");
    expect(scopes).toHaveLength(1);
    expect(scopes[0]!.taskKind).toBe("pi.generation"); expect(scopes[0]!.phase).toBe("request");
    expect(scopes[0]!.conversationId).toBe(root.id);
    expect(scopes[0]!.checkpointHash).toMatch(/^[a-f0-9]{64}$/);
    expect((await harness.getTask(scopes[0]!.taskId, context))?.state.status).toBe("terminal");
    expect(Object.isFrozen(scopes[0])).toBe(true);
  } finally { await harness.close(context); await rm(directory, { recursive: true, force: true }); }
});

test("temporary request scope is rebuilt for a persisted summary phase after harness reopen", async () => {
  const { Harness } = await import("../../runtime/durable-engine/qualification/durable.ts");
  const { createModels } = await import("../../runtime/durable-engine/qualification/ai.ts");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { SqliteStorage } = await import("../../runtime/durable-engine/qualification/sqlite.ts");
  const { BunSqliteDatabase } = await import("../../runtime/durable-engine/src/bun-sqlite.ts");
  const directory = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "task-model-reopen-"));
  const openStorage = () => SqliteStorage.open(new BunSqliteDatabase(join(directory, "tasks.sqlite")));
  const registry = createRegistry();
  let executions = 0;
  const task = defineTask<null, { phase: "summarize" }, null, object>({ name: "qualification.recovered-summary", version: 1,
    initial: () => ({ phase: "summarize" }),
    phases: { async summarize(record, runtime, ctx) {
      const scope = taskModelRequestScope(runtime.signal);
      expect(scope).toMatchObject({ taskId: record.id, conversationId: record.conversationId, taskKind: "qualification.recovered-summary", phase: "summarize" });
      executions++;
      await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), ctx);
    } }, async abort() {} });
  registry.install(defineExtension({ name: "recovered", tasks: [task] }));
  const options = { models: createModels(), registry: withTaskModelRequestScope(registry) };
  let harness = await Harness.open(await openStorage(), options, context);
  const conversation = await harness.createConversation({ ownership: { kind: "ownerless" } }, context);
  const id = await harness.commit(tx => tx.createTask(task, null, { conversationId: conversation.id, ownership: { kind: "conversation" } }), context);
  expect(executions).toBe(0);
  await harness.close(context);
  harness = await Harness.open(await openStorage(), options, context);
  try {
    harness.resume();
    expect((await harness.waitForTask(id, context)).state.outcome.status).toBe("completed");
    expect(executions).toBe(1);
  } finally { await harness.close(context); await rm(directory, { recursive: true, force: true }); }
});
