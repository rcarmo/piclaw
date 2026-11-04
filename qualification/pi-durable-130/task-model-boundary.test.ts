import { expect, test } from "bun:test";
import { createRegistry, defineExtension, defineTask, ToolTask, type ToolTaskInput } from "../../runtime/durable-engine/qualification/durable.ts";
import { context } from "./src/fixture.ts";
import { withTaskModelRequestScope, taskModelRequestScope, taskModelHookScope, taskModelToolScope } from "../../runtime/durable-engine/src/task-model-boundary-shim.ts";

test('native phase has no financial preparation protocol or host-induced SDK sleep', async () => {
  const registry = createRegistry(), controller = new AbortController();
  let preparations = 0, bodies = 0, sleeps = 0;
  const result = Symbol('original body');
  const task = defineTask({ name: 'qualification.no-financial-phase', version: 1,
    initial: () => ({ phase: 'request' as const }), phases: { async request(record, runtime, ctx) {
      bodies++; expect<unknown>(record).toBe(original); expect<unknown>(runtime).toBe(actual); expect(ctx).toBe(context);
      expect(taskModelRequestScope(runtime.signal)?.taskId).toBe(runtime.taskId); return result as never;
    } }, async abort() {} });
  registry.install(defineExtension({ name: 'no-financial-phase', tasks: [task] }));
  const original = { id: 12, conversationId: 34, kind: task.definition.name, version: 1, input: {},
    state: { status: 'running', checkpoint: { phase: 'request' } } };
  const actual = { taskId: 12, conversationId: 34, signal: controller.signal, now: () => 1000,
    sleepUntil() { sleeps++; return Symbol('financial sleep'); } };
  // @ts-expect-error Financial beforePhase callbacks have been retired from this API.
  const wrapped = withTaskModelRequestScope(registry, async () => { preparations++; return false; });
  const execute = wrapped.snapshot().task(task.definition.name)!.definition.phases.request as Function;
  expect(await execute(original, actual, context)).toBe(result);
  expect(preparations).toBe(0); expect(bodies).toBe(1); expect(sleeps).toBe(0);
  expect(taskModelRequestScope(controller.signal)).toBeUndefined();
});

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
  const record = { id: 12, conversationId: 34, kind: task.definition.name, version: 1, input: {},
    state: { status: 'running', checkpoint: { phase: 'summarize' } } };
  await phase(record, runtime, context);
  expect(observed).toMatchObject({ taskId: 12, conversationId: 34, taskKind: "qualification.observe", phase: "summarize", signal: controller.signal });
  expect(taskModelRequestScope(controller.signal)).toBeUndefined();
  controller.abort();
  expect(() => phase(record, runtime, context)).toThrow();
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
  await phase({ id: 12, conversationId: 34, kind: task.definition.name, version: 1, input: {},
    state: { status: 'running', checkpoint: { phase: 'request' } } }, { taskId: 12, conversationId: 34, signal: controller.signal }, context);
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
    const before = hashes.length;
    expect(() => execute(changed, runtime, context)).toThrow('Exact running SDK phase required');
    expect(hashes).toHaveLength(before);
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
  await Promise.all(signals.map((signal, index) => phase({ id: index + 1, conversationId: index + 10,
    kind: 'qualification.concurrent', version: 1, input: {}, state: { status: 'running', checkpoint: { phase: 'summarize' } } },
    { taskId: index + 1, conversationId: index + 10, signal }, context)));
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

// Executable-definition unit fixture. Financial preparation is absent; the
// SDK owns waiting and every original body result/failure.
function phaseFixture(body: Function) {
  const registry = createRegistry(), controller = new AbortController();
  const task = defineTask({ name: "qualification.scoped-phase", version: 1,
    initial: () => ({ phase: "request" as const }),
    phases: { request: (record, runtime, ctx) => body(record, runtime, ctx) }, async abort() {} });
  registry.install(defineExtension({ name: "scoped-phase", tasks: [task] }));
  const checkpoint = { phase: "request", attempt: 3, cursor: { offset: 7, keys: ["original", "checkpoint"] } };
  const record = { id: 12, conversationId: 34, kind: task.definition.name, version: 1,
    input: { source: "original" }, state: { status: "running", checkpoint } };
  const sleeps: unknown[][] = [];
  const runtime = { taskId: 12, conversationId: 34, signal: controller.signal, now: () => 1000,
    sleepUntil: (...args: unknown[]) => { sleeps.push(args); return Symbol("SDK sleep"); } };
  const execute = withTaskModelRequestScope(registry).snapshot().task(task.definition.name)!.definition.phases.request as Function;
  return { execute, record, checkpoint, runtime, controller, sleeps };
}

test("scope invokes the original body once with its original arguments and result", async () => {
  const result = Symbol("original body result");
  let bodies = 0;
  const fixture = phaseFixture(async (record: unknown, runtime: typeof fixture.runtime, ctx: unknown) => {
    bodies++;
    expect(record).toBe(fixture.record); expect(runtime).toBe(fixture.runtime); expect(ctx).toBe(context);
    await Promise.resolve();
    expect(taskModelRequestScope(runtime.signal)?.phase).toBe("request");
    return result;
  });
  const before = structuredClone(fixture.record);
  expect(await fixture.execute(fixture.record, fixture.runtime, context)).toBe(result);
  expect(bodies).toBe(1); expect(fixture.sleeps).toEqual([]); expect(fixture.record).toEqual(before);
  expect(taskModelRequestScope(fixture.runtime.signal)).toBeUndefined();
});

for (const asynchronous of [false, true]) test(`scope never catches an entered ${asynchronous ? "async" : "sync"} body failure as a wait or replay`, async () => {
  const failure = Error("original entered body failure");
  let bodies = 0;
  const enter = () => { bodies++; throw failure; };
  const fixture = phaseFixture(asynchronous ? async () => { await Promise.resolve(); return enter(); } : enter);
  await expect(Promise.resolve().then(() => fixture.execute(fixture.record, fixture.runtime, context))).rejects.toBe(failure);
  await Promise.resolve();
  expect(bodies).toBe(1); expect(fixture.sleeps).toEqual([]);
  expect(taskModelRequestScope(fixture.runtime.signal)).toBeUndefined();
});

test("scope rejects cancelled entry and preserves cancellation through an entered body await", async () => {
  const { barrier } = await import("./src/fixture.ts");
  const entered = barrier(), release = barrier(), cancellation = Error("native body cancelled");
  let bodies = 0, effects = 0;
  const fixture = phaseFixture(async (_record: unknown, runtime: typeof fixture.runtime) => {
    bodies++; entered.release(); await release.promise;
    taskModelRequestScope(runtime.signal); effects++;
  });
  const observed = Promise.resolve(fixture.execute(fixture.record, fixture.runtime, context))
    .then(() => ({ resolved: true }), error => ({ error }));
  try {
    await entered.promise; fixture.controller.abort(cancellation); release.release();
    expect(await observed).toEqual({ error: cancellation });
    expect(bodies).toBe(1); expect(effects).toBe(0); expect(fixture.sleeps).toEqual([]);
    expect(() => fixture.execute(fixture.record, fixture.runtime, context)).toThrow(cancellation);
    expect(bodies).toBe(1);
    expect(taskModelRequestScope(fixture.runtime.signal)).toBeUndefined();
  } finally { release.release(); }
});

test("scope fails closed on a record that is not this exact running SDK phase", () => {
  let bodies = 0;
  const fixture = phaseFixture(() => { bodies++; });
  const record = fixture.record;
  for (const invalid of [undefined, {}, { ...record, id: 99 }, { ...record, conversationId: 99 },
    { ...record, kind: "qualification.other" }, { ...record, version: 2 },
    { ...record, state: { status: "pending", checkpoint: fixture.checkpoint } },
    { ...record, state: { status: "sleeping", until: 2000, checkpoint: fixture.checkpoint } },
    { ...record, state: { status: "terminal", outcome: { status: "failed" } } },
    { ...record, state: undefined }, { ...record, state: { status: "running" } },
    { ...record, state: { status: "running", checkpoint: { ...fixture.checkpoint, phase: "other" } } }]) {
    expect(() => fixture.execute(invalid, fixture.runtime, context)).toThrow("Exact running SDK phase required");
    expect(bodies).toBe(0); expect(fixture.sleeps).toEqual([]);
    expect(taskModelRequestScope(fixture.runtime.signal)).toBeUndefined();
  }
});

test("original SDK body owns persisted sleep and reopen; failed bodies never revive", async () => {
  const { Harness } = await import("../../runtime/durable-engine/qualification/durable.ts");
  const { openFixture } = await import("./src/fixture.ts");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { SqliteStorage } = await import("../../runtime/durable-engine/qualification/sqlite.ts");
  const { BunSqliteDatabase } = await import("../../runtime/durable-engine/src/bun-sqlite.ts");
  const base = await openFixture({ acquired: true }); await base.close();
  const directory = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "native-phase-reopen-"));
  const openStorage = () => SqliteStorage.open(new BunSqliteDatabase(join(directory, "tasks.sqlite")));
  type Checkpoint = { phase: "request"; attempt: number; cursor: { offset: number; keys: string[] } };
  const checkpoint: Checkpoint = { phase: "request", attempt: 3, cursor: { offset: 7, keys: ["original", "checkpoint"] } };
  const bodies: number[] = [], wakes: { active: boolean; at?: number }[] = [];
  let clock = 1000;
  const task = defineTask<{ fail: boolean; source: string }, Checkpoint, null, object>({ name: "qualification.native-phase", version: 1,
    initial: () => structuredClone(checkpoint),
    phases: { async request(record, runtime, ctx) {
      bodies.push(record.id);
      expect(record.state).toEqual({ status: "running", checkpoint });
      expect(taskModelRequestScope(runtime.signal)).toMatchObject({ taskId: record.id, conversationId: record.conversationId, phase: "request" });
      if (record.input.fail) throw Error("entered original body failed");
      expect(record.input).toEqual({ fail: false, source: "original input" });
      if (runtime.now() < 2000) return runtime.sleepUntil(2000, record.state.checkpoint, ctx);
      await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), ctx);
    } }, async abort() {} });
  base.registry.install(defineExtension({ name: "native-phase", tasks: [task] }));
  const options = { models: base.models, now: () => clock,
    onWake: (wake: { active: boolean; at?: number }) => { wakes.push({ ...wake }); },
    registry: withTaskModelRequestScope(base.registry) };
  let harness = await Harness.open(await openStorage(), options, context);
  try {
    const conversation = await harness.createConversation({ ownership: { kind: "ownerless" } }, context);
    const create = (fail: boolean) => harness.commit(tx => tx.createTask(task, { fail, source: "original input" },
      { conversationId: conversation.id, ownership: { kind: "conversation" } }), context);
    const waiting = await create(false), failure = await create(true);
    expect(bodies).toEqual([]); harness.resume();
    const deadline = Date.now() + 1500;
    while ((await harness.getTask(waiting, context))?.state.status !== "sleeping" && Date.now() < deadline) await Bun.sleep(1);
    const sleeping = await harness.getTask(waiting, context);
    expect(sleeping?.state).toEqual({ status: "sleeping", until: 2000, checkpoint });
    expect(sleeping?.input).toEqual({ fail: false, source: "original input" });
    const failed = await harness.waitForTask(failure, context);
    expect(failed.state.outcome.status).toBe("faulted");
    expect(bodies.filter(id => id === waiting)).toHaveLength(1);
    expect(bodies.filter(id => id === failure)).toHaveLength(1);
    await harness.close(context);
    harness = await Harness.open(await openStorage(), options, context);
    expect((await harness.getTask(waiting, context))?.state).toEqual(sleeping!.state);
    harness.resume(); await Bun.sleep(5);
    expect((await harness.getTask(waiting, context))?.state).toEqual(sleeping!.state);
    expect(bodies).toHaveLength(2); expect(wakes.some(wake => wake.at === 2000)).toBe(true);
    clock = 2000; harness.resume();
    const completed = await harness.waitForTask(waiting, context);
    expect(completed.id).toBe(waiting); expect(completed.conversationId).toBe(conversation.id);
    expect(completed.input).toEqual(sleeping!.input);
    expect(completed.state.outcome).toEqual({ status: "completed", result: null });
    expect(bodies.filter(id => id === waiting)).toHaveLength(2);
    expect(bodies.filter(id => id === failure)).toHaveLength(1);
    await harness.close(context);
    harness = await Harness.open(await openStorage(), options, context);
    harness.resume(); await Bun.sleep(5);
    expect((await harness.getTask(waiting, context))?.state).toEqual(completed.state);
    expect((await harness.getTask(failure, context))?.state).toEqual(failed.state);
    expect(bodies).toHaveLength(3);
    expect(base.host.modelCalls).toBe(0); expect(base.host.effects).toBe(0); expect(base.host.credentialLookups).toBe(0);
  } finally { await harness.close(context); await rm(directory, { recursive: true, force: true }); }
});

// Public 1.4 exported definition, with only the executable bodies replaced for
// observation. These unit fixtures grant no tool/source/accounting authority.
function toolScopeDefinitionFixture(body: Function) {
  const registry = createRegistry();
  const task = { ...ToolTask, definition: { ...ToolTask.definition, phases: {
    call: (record: unknown, runtime: unknown, ctx: unknown) => body(record, runtime, ctx),
    execute: (record: unknown, runtime: unknown, ctx: unknown) => body(record, runtime, ctx),
  } } };
  const reader = { subscribe: registry.subscribe.bind(registry), snapshot() {
    const snapshot = registry.snapshot();
    return new Proxy(snapshot, { get(target, key) {
      if (key === "task") return (name: string) => name === ToolTask.definition.name ? task : target.task(name);
      if (key === "tasks") return () => target.tasks().map(current => current.definition.name === ToolTask.definition.name ? task : current);
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  } };
  const phases = withTaskModelRequestScope(reader).snapshot().task("pi.tool")!.definition.phases;
  return { call: phases.call as Function, execute: phases.execute as Function };
}

function expectOnlyCurrentTool(scope: NonNullable<ReturnType<typeof taskModelRequestScope>>) {
  const api = { taskId: scope.taskId, conversationId: scope.conversationId, toolCallId: scope.toolCallId! };
  expect(taskModelToolScope(api)).toBe(scope);
  // Every nonempty combination of wrong task/conversation/call IDs fails closed.
  for (let mask = 1; mask < 8; mask++) expect(taskModelToolScope({
    taskId: mask & 1 ? (Number(api.taskId) + 1000) as never : api.taskId,
    conversationId: mask & 2 ? (Number(api.conversationId) + 1000) as never : api.conversationId,
    toolCallId: mask & 4 ? `${api.toolCallId}/not-current` : api.toolCallId,
  })).toBeUndefined();
  expect(taskModelToolScope({ ...api, toolCallId: "" })).toBeUndefined();
  expect(taskModelRequestScope(new AbortController().signal)).toBeUndefined();
  expect(taskModelHookScope(api)).toBeUndefined();
}

test("actual SDK model and nested tools retain initial-call identity through intent commits", async () => {
  const { Harness, MemoryStorage, defineTool } = await import("../../runtime/durable-engine/qualification/durable.ts");
  const { Type } = await import("../../runtime/durable-engine/qualification/ai.ts");
  const { openFixture } = await import("./src/fixture.ts");
  const base = await openFixture({ acquired: true }); await base.close();
  type Scope = NonNullable<ReturnType<typeof taskModelRequestScope>>;
  const initial = new Map<Scope["taskId"], { scope: Scope; record: NonNullable<Awaited<ReturnType<typeof base.harness.getTask>>> }>();
  const bodies: Scope[] = [];
  const observeBody = async (api: { taskId: Scope["taskId"]; conversationId: Scope["conversationId"]; callId: string }) => {
    await Promise.resolve();
    const scope = taskModelToolScope({ ...api, toolCallId: api.callId });
    expect(scope).toBeDefined();
    expectOnlyCurrentTool(scope!);
    expect(taskModelRequestScope(scope!.signal)).toBe(scope);
    const record = (await harness.getTask(api.taskId, context))!;
    expect(record.kind).toBe(ToolTask.definition.name);
    expect(record.version).toBe(ToolTask.definition.version);
    // SDK execution intent is already committed. The scope must still retain
    // the initial call identity, never the recovery execute checkpoint.
    expect(record.state).toMatchObject({ status: "running", checkpoint: { phase: "execute" } });
    const input = record.input as ToolTaskInput;
    expect(scope!.toolCallId).toBe(input.kind === "model" ? input.callId : input.call.id);
    expect(scope!.checkpointHash).toMatch(/^[a-f0-9]{64}$/);
    initial.set(api.taskId, { scope: scope!, record: { ...structuredClone(record),
      state: { status: "running", checkpoint: ToolTask.definition.initial(input) } } });
    expect(scope!.phase).toBe("call");
    bodies.push(scope!);
    return scope!;
  };
  let parentScope: Scope;
  const nested = defineTool({ name: "scope_nested", description: "Scope observation only", callers: ["tools"], replay: "unsafe",
    parameters: Type.Object({ value: Type.String() }), async execute(_args, api) {
      const scope = await observeBody(api);
      expect(scope.taskId).not.toBe(parentScope.taskId);
      expect(scope.conversationId).toBe(parentScope.conversationId);
      expect(scope.toolCallId).toBe(`${parentScope.toolCallId}/child`);
      expect(taskModelToolScope({ ...parentScope, toolCallId: parentScope.toolCallId! })).toBeUndefined();
      expect(taskModelRequestScope(parentScope.signal)).toBeUndefined();
      return { output: [{ type: "text", text: "nested observed" }] };
    } });
  const parent = defineTool({ name: "host_effect", description: "Scope observation only", callers: ["model"], replay: "unsafe",
    parameters: Type.Object({ value: Type.String() }), async execute(_args, api, ctx) {
      parentScope = await observeBody(api);
      const result = await api.executeTool(nested.name, { value: "nested input" }, ctx, { key: "child" });
      expect(result.isError).toBe(false);
      expect(taskModelToolScope({ ...api, toolCallId: api.callId })).toBe(parentScope);
      expect(taskModelToolScope({ ...bodies[1]!, toolCallId: bodies[1]!.toolCallId! })).toBeUndefined();
      return { output: [{ type: "text", text: "parent observed" }] };
    } });
  const extension = defineExtension({ name: "qualification", tools: [parent, nested] });
  base.registry.install(extension);
  const harness = await Harness.open(new MemoryStorage(), { models: base.models,
    registry: withTaskModelRequestScope(base.registry), settings: { retry: { enabled: false }, compaction: { enabled: false } } }, context);
  try {
    const root = await harness.root(context, { agent: { model: { provider: "qualification", modelId: "synthetic" }, extensions: [extension], tools: [parent, nested] } });
    const submission = await root.submit({ type: "input", requestId: "actual-tool-scopes", content: "use-tool" }, context);
    expect((await submission.wait(context)).status).toBe("done");
    expect(bodies).toHaveLength(2); expect(initial.size).toBe(2);
    expect([...initial.values()].map(({ record }) => (record.input as ToolTaskInput).kind)).toEqual(["model", "nested"]);
    for (const { scope, record } of initial.values()) {
      expect(taskModelToolScope({ ...scope, toolCallId: scope.toolCallId! })).toBeUndefined();
      expect(taskModelRequestScope(scope.signal)).toBeUndefined();
      expect((await harness.getTask(scope.taskId, context))?.state.status).toBe("terminal");
      const controller = new AbortController();
      const runtime = { taskId: record.id, conversationId: record.conversationId, signal: controller.signal };
      const hashes: (string | undefined)[] = [];
      const fixture = toolScopeDefinitionFixture((_record: unknown, actual: typeof runtime) => {
        const current = taskModelRequestScope(actual.signal)!;
        expectOnlyCurrentTool(current); hashes.push(current.checkpointHash);
      });
      await fixture.call(record, runtime, context);
      await fixture.call(record, runtime, context);
      // Canonical object order and volatile scheduler fields are not identity.
      const input = record.input as ToolTaskInput;
      const reordered = input.kind === "model" ? { callId: input.callId, assistant: input.assistant, kind: input.kind }
        : { ...input, call: { arguments: input.call.arguments, name: input.call.name, id: input.call.id, type: input.call.type } };
      await fixture.call({ ...record, startedAt: 999, input: reordered }, runtime, context);
      expect(hashes).toEqual([scope.checkpointHash, scope.checkpointHash, scope.checkpointHash]);
      const changedInputs: ToolTaskInput[] = input.kind === "model"
        ? [{ ...input, assistant: (Number(input.assistant) + 1000) as never }, { ...input, callId: `${input.callId}-changed` }]
        : [{ ...input, parent: (Number(input.parent) + 1000) as never }, { ...input, parentCallId: `${input.parentCallId}-changed` },
          { ...input, key: "different-key" }, { ...input, call: { ...input.call, arguments: { value: "different input" } } },
          { ...input, call: { ...input.call, id: `${input.call.id}-changed` } }];
      for (const changed of changedInputs) {
        await fixture.call({ ...record, input: changed }, runtime, context);
        expect(hashes.at(-1)).toMatch(/^[a-f0-9]{64}$/);
        expect(hashes.at(-1)).not.toBe(scope.checkpointHash);
      }
    }
    expect(base.host.credentialLookups).toBe(0);
  } finally { await harness.close(context); }
});

for (const kind of ["model", "nested"] as const) test(`exported ToolTask ${kind}: invalid frames never enter a body; recovery never acquires call identity`, async () => {
  const input: ToolTaskInput = kind === "model" ? { kind, assistant: 56 as never, callId: "actual-call" }
    : { kind, parent: 78 as never, parentCallId: "parent-call", key: "child", call: { type: "toolCall", id: "actual-call", name: "scope_nested", arguments: { value: "original" } } };
  const controller = new AbortController();
  const runtime = { taskId: 12, conversationId: 34, signal: controller.signal };
  const record = { id: 12, conversationId: 34, kind: ToolTask.definition.name, version: ToolTask.definition.version,
    input, state: { status: "running", checkpoint: ToolTask.definition.initial(input) } };
  const api = { taskId: 12 as never, conversationId: 34 as never, toolCallId: "actual-call" };
  let bodies = 0;
  const fixture = toolScopeDefinitionFixture((_record: unknown, actual: typeof runtime) => {
    bodies++;
    const scope = taskModelRequestScope(actual.signal)!;
    expect(scope.phase).toBe("execute");
    expect(scope.toolCallId).toBeUndefined(); expect(scope.checkpointHash).toBeUndefined();
    expect(taskModelToolScope(api)).toBeUndefined();
  });
  expect(taskModelToolScope(api)).toBeUndefined();
  for (const invalid of [{ ...record, id: 99 }, { ...record, conversationId: 99 }, { ...record, kind: "pi.generation" },
    { ...record, version: record.version + 1 }, { ...record, state: { status: "pending", checkpoint: record.state.checkpoint } },
    { ...record, state: { status: "running", checkpoint: { phase: "execute", replay: "safe", arguments: {} } } }]) {
    expect(() => fixture.call(invalid, runtime, context)).toThrow("Exact running SDK phase required");
    expect(bodies).toBe(0); expect(taskModelToolScope(api)).toBeUndefined();
  }
  const recovery = { ...record, state: { status: "running", checkpoint: { phase: "execute", replay: "safe", arguments: { value: "original" } } } };
  await fixture.execute(recovery, runtime, context);
  expect(bodies).toBe(1);
  expect(taskModelToolScope(api)).toBeUndefined();
  expect(taskModelRequestScope(controller.signal)).toBeUndefined();
});

test("tool scope checks cancellation after awaits; matching IDs cannot revive an aborted scope", async () => {
  for (const alreadyAborted of [false, true]) {
    const controller = new AbortController(), cancellation = Error("tool scope cancelled");
    const input: ToolTaskInput = { kind: "model", assistant: 56 as never, callId: "cancelled-call" };
    const record = { id: 12, conversationId: 34, kind: ToolTask.definition.name, version: ToolTask.definition.version,
      input, state: { status: "running", checkpoint: ToolTask.definition.initial(input) } };
    const runtime = { taskId: 12, conversationId: 34, signal: controller.signal };
    let bodies = 0;
    const fixture = toolScopeDefinitionFixture(async (_record: unknown, actual: typeof runtime) => {
      bodies++;
      const scope = taskModelRequestScope(actual.signal)!;
      expectOnlyCurrentTool(scope);
      const api = { ...scope, toolCallId: scope.toolCallId! };
      await Promise.resolve(); controller.abort(cancellation);
      expect(() => taskModelToolScope(api)).toThrow(cancellation);
      expect(() => taskModelRequestScope(scope.signal)).toThrow(cancellation);
      expect(taskModelToolScope({ ...api, toolCallId: "other-call" })).toBeUndefined();
      expect(taskModelRequestScope(new AbortController().signal)).toBeUndefined();
    });
    if (alreadyAborted) {
      controller.abort(cancellation);
      expect(() => fixture.call(record, runtime, context)).toThrow(cancellation);
    } else await fixture.call(record, runtime, context);
    expect(bodies).toBe(alreadyAborted ? 0 : 1);
    expect(taskModelToolScope({ taskId: 12 as never, conversationId: 34 as never, toolCallId: input.callId })).toBeUndefined();
    expect(taskModelRequestScope(controller.signal)).toBeUndefined();
  }
});

test("tool identity is unavailable in other task kinds, and an already-aborted tool never enters its body", async () => {
  const api = { taskId: 12 as never, conversationId: 34 as never, toolCallId: "same-call" };
  for (const [name, phase] of [["pi.generation", "request"], ["pi.compaction", "summarize"], ["qualification.not-a-tool", "call"]]) {
    const registry = createRegistry(), controller = new AbortController();
    let bodies = 0;
    const task = defineTask({ name: name!, version: 1, initial: () => ({ phase: phase! }), phases: {
      [phase!]: async (_record: unknown, runtime: { signal: AbortSignal }) => {
        bodies++; await Promise.resolve();
        expect(taskModelRequestScope(runtime.signal)?.toolCallId).toBeUndefined();
        expect(taskModelToolScope(api)).toBeUndefined();
      },
    }, async abort() {} });
    const reader = { subscribe: registry.subscribe.bind(registry), snapshot() {
      const snapshot = registry.snapshot();
      return new Proxy(snapshot, { get(target, key) {
        if (key === "task") return (kind: string) => kind === name ? task : target.task(kind);
        if (key === "tasks") return () => target.tasks().map(current => current.definition.name === name ? task : current);
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      } });
    } };
    const execute = withTaskModelRequestScope(reader).snapshot().task(name!)!.definition.phases[phase!] as Function;
    await execute({ id: 12, conversationId: 34, kind: name, version: 1,
      input: { kind: "model", assistant: 56, callId: api.toolCallId }, state: { status: "running", checkpoint: { phase } } },
    { taskId: 12, conversationId: 34, signal: controller.signal }, context);
    expect(bodies).toBe(1); expect(taskModelToolScope(api)).toBeUndefined();
  }
  const controller = new AbortController(), cancellation = Error("already cancelled tool");
  let bodies = 0;
  const fixture = toolScopeDefinitionFixture(() => { bodies++; });
  const input: ToolTaskInput = { kind: "model", assistant: 56 as never, callId: api.toolCallId };
  controller.abort(cancellation);
  expect(() => fixture.call({ id: 12, conversationId: 34, kind: ToolTask.definition.name, version: ToolTask.definition.version,
    input, state: { status: "running", checkpoint: ToolTask.definition.initial(input) } },
  { taskId: 12, conversationId: 34, signal: controller.signal }, context)).toThrow(cancellation);
  expect(bodies).toBe(0);
  expect(taskModelToolScope(api)).toBeUndefined();
});
