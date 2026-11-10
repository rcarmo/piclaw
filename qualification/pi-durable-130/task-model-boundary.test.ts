import { expect, test } from "bun:test";
import { createRegistry, defineExtension, defineTask, ToolTask, type ToolTaskInput } from "../../runtime/durable-engine/qualification/durable.ts";
import { context } from "./src/fixture.ts";
import { withTaskModelRequestScope, taskModelRequestScope, taskModelHookScope, taskModelToolScope } from "../../runtime/durable-engine/src/task-model-boundary-shim.ts";

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

test("actual SDK model and nested tool identities retain their initial-record hash through intent commits", async () => {
  const { Harness, MemoryStorage, defineTool } = await import("../../runtime/durable-engine/qualification/durable.ts");
  const { Type } = await import("../../runtime/durable-engine/qualification/ai.ts");
  const { openFixture } = await import("./src/fixture.ts");
  const base = await openFixture({ acquired: true }); await base.close();
  type Scope = NonNullable<ReturnType<typeof taskModelRequestScope>>;
  const prepared = new Map<Scope["taskId"], { scope: Scope; record: NonNullable<Awaited<ReturnType<typeof base.harness.getTask>>> }>();
  const bodies: Scope[] = [];
  const observeBody = async (api: { taskId: Scope["taskId"]; conversationId: Scope["conversationId"]; callId: string }) => {
    await Promise.resolve();
    const scope = taskModelToolScope({ ...api, toolCallId: api.callId });
    expect(scope).toBeDefined();
    const record=(await harness.getTask(api.taskId,context))!;
    expect(record.kind).toBe(ToolTask.definition.name);expect(record.version).toBe(ToolTask.definition.version);
    expect(scope!.checkpointHash).toMatch(/^[a-f0-9]{64}$/);expect(Object.isFrozen(scope)).toBe(true);
    // The metadata adapter hashes initial call input, before the SDK intent.
    // Reconstruct that public initial value only for the hash assertion below.
    prepared.set(api.taskId,{scope:scope!,record:{...record,state:{status:"running",checkpoint:ToolTask.definition.initial(record.input as ToolTaskInput)}}});
    expectOnlyCurrentTool(scope!);
    expect(taskModelRequestScope(scope!.signal)).toBe(scope);
    // The actual SDK has committed execute intent, but this is still the call
    // handler's ASL scope, hashing its original call record, not that intent.
    expect((await harness.getTask(api.taskId, context))?.state).toMatchObject({ status: "running", checkpoint: { phase: "execute" } });
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
    expect(bodies).toHaveLength(2); expect(prepared.size).toBe(2);
    expect([...prepared.values()].map(({ record }) => (record.input as ToolTaskInput).kind)).toEqual(["model", "nested"]);
    for (const { scope, record } of prepared.values()) {
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

for(const kind of ["model","nested"] as const)test(`exported ToolTask ${kind}: invalid initial records and recovery execute never acquire call authority`,async()=>{
  const input:ToolTaskInput=kind==="model"?{kind,assistant:56 as never,callId:"actual-call"}:{kind,parent:78 as never,parentCallId:"parent-call",key:"child",call:{type:"toolCall",id:"actual-call",name:"scope_nested",arguments:{value:"original"}}};
  const controller=new AbortController(),runtime={taskId:12,conversationId:34,signal:controller.signal};
  const record={id:12,conversationId:34,kind:ToolTask.definition.name,version:ToolTask.definition.version,input,state:{status:"running",checkpoint:ToolTask.definition.initial(input)}};
  const api={taskId:12 as never,conversationId:34 as never,toolCallId:"actual-call"};let bodies=0;
  const fixture=toolScopeDefinitionFixture((_record:unknown,actual:typeof runtime)=>{
    bodies++;const scope=taskModelRequestScope(actual.signal)!;
    expect(scope.toolCallId).toBeUndefined();expect(scope.checkpointHash).toBeUndefined();expect(taskModelToolScope(api)).toBeUndefined();
  });
  for(const invalid of [{...record,id:99},{...record,conversationId:99},{...record,kind:"pi.generation"},{...record,version:record.version+1},{...record,state:{status:"pending",checkpoint:record.state.checkpoint}},{...record,state:{status:"running",checkpoint:{phase:"execute",replay:"safe",arguments:{}}}}])await fixture.call(invalid,runtime,context);
  const recovery={...record,state:{status:"running",checkpoint:{phase:"execute",replay:"safe",arguments:{value:"original"}}}};
  await fixture.execute(recovery,runtime,context);expect(bodies).toBe(7);expect(taskModelToolScope(api)).toBeUndefined();
});

test("tool scope checks cancellation after awaits; matching IDs never revive an aborted scope",async()=>{
  const controller=new AbortController(),cancellation=Error("tool scope cancelled");
  const input:ToolTaskInput={kind:"model",assistant:56 as never,callId:"cancelled-call"};
  const record={id:12,conversationId:34,kind:ToolTask.definition.name,version:ToolTask.definition.version,input,state:{status:"running",checkpoint:ToolTask.definition.initial(input)}};
  const runtime={taskId:12,conversationId:34,signal:controller.signal};let effects=0;
  const fixture=toolScopeDefinitionFixture(async(_record:unknown,actual:typeof runtime)=>{
    const scope=taskModelRequestScope(actual.signal)!;expectOnlyCurrentTool(scope);await Promise.resolve();controller.abort(cancellation);
    const api={...scope,toolCallId:scope.toolCallId!};expect(()=>taskModelToolScope(api)).toThrow(cancellation);expect(()=>taskModelRequestScope(scope.signal)).toThrow(cancellation);
    expect(taskModelToolScope({...api,toolCallId:"other-call"})).toBeUndefined();expect(taskModelRequestScope(new AbortController().signal)).toBeUndefined();
    taskModelToolScope(api);effects++;
  });
  await expect(fixture.call(record,runtime,context)).rejects.toBe(cancellation);expect(effects).toBe(0);expect(taskModelRequestScope(controller.signal)).toBeUndefined();
});

test("other task kinds have no tool identity; already-aborted invocation cannot capture tool authority",async()=>{
  const api={taskId:12 as never,conversationId:34 as never,toolCallId:"same-call"};
  for(const [name,phase]of [["pi.generation","request"],["pi.compaction","summarize"],["qualification.not-a-tool","call"]]){
    const registry=createRegistry(),controller=new AbortController();let bodies=0;
    const task=defineTask({name:name!,version:1,initial:()=>({phase:phase!}),phases:{[phase!]:async(_record:unknown,runtime:{signal:AbortSignal})=>{bodies++;await Promise.resolve();expect(taskModelRequestScope(runtime.signal)?.toolCallId).toBeUndefined();expect(taskModelToolScope(api)).toBeUndefined();}},async abort(){}});
    const reader={subscribe:registry.subscribe.bind(registry),snapshot(){const snapshot=registry.snapshot();return new Proxy(snapshot,{get(target,key){if(key==="task")return(kind:string)=>kind===name?task:target.task(kind);if(key==="tasks")return()=>target.tasks().map(current=>current.definition.name===name?task:current);const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});}};
    const execute=withTaskModelRequestScope(reader).snapshot().task(name!)!.definition.phases[phase!] as Function;
    await execute({id:12,conversationId:34,kind:name,version:1,input:{kind:"model",assistant:56,callId:api.toolCallId},state:{status:"running",checkpoint:{phase}}},{taskId:12,conversationId:34,signal:controller.signal},context);
    expect(bodies).toBe(1);expect(taskModelToolScope(api)).toBeUndefined();
  }
  const controller=new AbortController(),cancellation=Error("already cancelled tool");let effects=0;
  const fixture=toolScopeDefinitionFixture(async()=>{taskModelToolScope(api);effects++;});
  const input:ToolTaskInput={kind:"model",assistant:56 as never,callId:api.toolCallId};controller.abort(cancellation);
  await expect(fixture.call({id:12,conversationId:34,kind:ToolTask.definition.name,version:ToolTask.definition.version,input,state:{status:"running",checkpoint:ToolTask.definition.initial(input)}},{taskId:12,conversationId:34,signal:controller.signal},context)).rejects.toBe(cancellation);
  expect(effects).toBe(0);expect(taskModelToolScope(api)).toBeUndefined();
});

for(const asynchronous of [false,true])test(`metadata scope propagates an entered ${asynchronous?"async":"sync"} body failure without sleeping or replay`,async()=>{
  const failure=Error("original phase failure");let bodies=0,sleeps=0;
  const task=defineTask({name:"qualification.scope-failure",version:1,initial:()=>({phase:"request" as const}),phases:{request:asynchronous?async()=>{bodies++;await Promise.resolve();throw failure;}:()=>{bodies++;throw failure;}},async abort(){}});
  const registry=createRegistry();registry.install(defineExtension({name:"failure",tasks:[task]}));
  const execute=withTaskModelRequestScope(registry).snapshot().task(task.definition.name)!.definition.phases.request as Function;
  const runtime={taskId:12,conversationId:34,signal:new AbortController().signal,sleepUntil(){sleeps++;throw Error("Host metadata must not own phase suspension");}};
  try{await execute({},runtime,context);throw Error("Body failure was swallowed");}catch(error){expect(error).toBe(failure);}
  expect(bodies).toBe(1);expect(sleeps).toBe(0);expect(taskModelRequestScope(runtime.signal)).toBeUndefined();
});


test('scoped cancellation changes callback signals but preserves the SDK commit context and abort definition',async()=>{
  const {withAbortSignal,awaitWithContext}=await import('@earendil-works/chord/context');
  const sdk=new AbortController(),lease=new AbortController(),sdkContext=withAbortSignal(sdk.signal,context),held=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();
  let externalSignal:AbortSignal|undefined,scopedSignal:AbortSignal|undefined;
  const committedContexts:typeof context[]=[];
  const abort=async()=>{},tool={name:'fixture',description:'fixture',parameters:{type:'object'},async execute(_args:unknown,_api:unknown,ctx:typeof context){externalSignal=ctx.abortSignal;entered.resolve();await awaitWithContext(held.promise,ctx);return{output:[]};}};
  const task=defineTask({name:'qualification.cancel-context',version:1,initial:()=>({phase:'call' as const}),phases:{async call(record,runtime,ctx){
    expect(ctx).toBe(sdkContext);expect(record.input).toEqual({untouched:true});scopedSignal=runtime.signal;
    const agent=await runtime.agent(ctx);
    try{await agent.tools[0]!.execute({},{}as never,ctx);}
    finally{await runtime.commit(()=>undefined,ctx);}
  }},abort});
  const registry=createRegistry();registry.install(defineExtension({name:'cancel-context',tasks:[task]}));
  const wrapped=withTaskModelRequestScope(registry,async id=>Number(id)===34?lease.signal:undefined).snapshot().task(task.definition.name)!;
  expect(wrapped.definition.abort).toBe(task.definition.abort);
  const runtime={taskId:12,conversationId:34,signal:sdk.signal,async agent(){return{tools:[tool],callable:[tool]};},
    async commit(_change:unknown,ctx:typeof context){expect(this).toBe(runtime);expect(this.signal).toBe(sdk.signal);this.signal.throwIfAborted();ctx.abortSignal?.throwIfAborted();committedContexts.push(ctx);}};
  const record={id:12,conversationId:34,kind:task.definition.name,version:1,input:{untouched:true},state:{status:'running',checkpoint:{phase:'call'}}};
  const result=(wrapped.definition.phases.call as Function)(record,runtime,sdkContext).then(()=>undefined,(error:unknown)=>error);
  await entered.promise;const reason=Error('only scoped callback cancelled');lease.abort(reason);expect(await result).toBe(reason);
  expect(committedContexts).toEqual([sdkContext]);
  expect(scopedSignal?.aborted).toBe(true);expect(externalSignal?.aborted).toBe(true);expect(sdk.signal.aborted).toBe(false);expect(sdkContext.abortSignal?.aborted).toBe(false);expect(record.state).toEqual({status:'running',checkpoint:{phase:'call'}});
});
