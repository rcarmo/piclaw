import { expect, test } from "bun:test";
import { createRecoverableRuntimeBackend, type RuntimeBackend } from "../../src/runtime/bootstrap.js";
import type { DurableAbortScope, DurableSessionPositionPort } from "../../src/agent-pool/durable-runtime-adapter.js";
import { RuntimePreparationError } from "../../src/runtime/preparation-error.js";
import { RuntimeStartupCleanupError } from "../../src/runtime/startup-cleanup-error.js";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const original: DurableAbortScope = { operationId: "op:accepted", conversationId: 7, sourceSeq: 11 };
function fixture(name: string, trace: string[]) {
  const failure = deferred<unknown>();
  const state = { scope: original as DurableAbortScope | null, closeError: undefined as Error | undefined,
    closeGate: undefined as Promise<void> | undefined, calls: [] as (DurableAbortScope | undefined)[], stopped: false };
  let closing: Promise<void> | undefined;
  const port: DurableSessionPositionPort = { sessionId: "native-domain", branchId: "main", readPosition: async () => "7",
    readAbortScope: async () => state.scope,
    abort: async expected => { state.calls.push(expected); if (expected && JSON.stringify(expected) !== JSON.stringify(state.scope)) return false; state.scope = null; return true; },
    abortRetry: async expected => port.abort!(expected),
  };
  const backend: RuntimeBackend = { storageFailure: failure.promise, sessionOptions: { getDurableSession: chat => chat === "web:test" ? port : undefined,
    dispatchHostCommand: async () => { trace.push(name + ":command"); return true; } },
    bind: () => { trace.push(name + ":bind"); return { prepareInputSourceAdmission: async () => { if (state.stopped) throw Error("Old admission scope closed"); trace.push(name + ":prepare"); } } as ReturnType<RuntimeBackend["bind"]>; },
    attachChannel: async () => { trace.push(name + ":attach"); },
    stop: () => { state.stopped = true; trace.push(name + ":stop"); },
    close: () => closing ??= (async () => { trace.push(name + ":close"); await state.closeGate; if (state.closeError) throw state.closeError; trace.push(name + ":closed"); })(),
  };
  return { failure, state, port, backend };
}
test('transient replacement failure retries only clean preparation, with no automatic dispatch replay', async () => {
  const trace: string[] = [], old = fixture('old', trace), next = fixture('new', trace);
  const entered = deferred<void>(), release = deferred<void>(); let prepares = 0;
  const backend = await createRecoverableRuntimeBackend(async () => {
    prepares++;
    if (prepares === 1) return old.backend;
    expect(trace).toContain('old:closed');
    if (prepares === 2) { entered.resolve(); await release.promise; throw new RuntimePreparationError(Error('writer still locked'), true); }
    return next.backend;
  });
  old.failure.resolve(Error('storage failed')); await entered.promise;
  const callers = Array.from({ length: 3 }, () => backend.sessionOptions.dispatchHostCommand!('web:test', 'accepted'));
  // Observe the old implementation's rejection without leaking an unhandled promise.
  const results = Promise.allSettled(callers);
  release.resolve();
  expect(await results).toEqual(Array.from({ length: 3 }, () => ({ status: 'fulfilled', value: true })));
  expect(prepares).toBe(3);
  expect(trace.filter(value => value.endsWith(':command'))).toEqual(['new:command', 'new:command', 'new:command']);
  await backend.close();
});

test('clean preparation failure does not poison graceful shutdown', async () => {
  const old = fixture('old', []), failure = new RuntimePreparationError(Error('invalid replacement configuration')); let prepares = 0;
  const backend = await createRecoverableRuntimeBackend(async () => { if (++prepares === 1) return old.backend; throw failure; });
  old.failure.resolve(Error('storage failed')); await tick();
  await expect(backend.sessionOptions.dispatchHostCommand!('web:test', 'accepted')).rejects.toBe(failure);
  await expect(backend.close()).resolves.toBeUndefined(); expect(prepares).toBe(2);
});

test('uncertain replacement preparation cleanup is neither retried nor hidden on shutdown', async () => {
  const old = fixture('old', []), failure = new RuntimeStartupCleanupError([Error('close uncertain')]); let prepares = 0;
  const backend = await createRecoverableRuntimeBackend(async () => { if (++prepares === 1) return old.backend; throw failure; });
  old.failure.resolve(Error('storage failed')); await tick();
  await expect(backend.sessionOptions.dispatchHostCommand!('web:test', 'accepted')).rejects.toBe(failure);
  await expect(backend.close()).rejects.toBe(failure); expect(prepares).toBe(2);
});

test('synchronous channel and session facades fail closed while replacement is unavailable', async () => {
  const old = fixture('old', []), gate = deferred<void>(); old.state.closeGate = gate.promise;
  const backend = await createRecoverableRuntimeBackend(async () => old.backend);
  const bound = backend.bind({} as Parameters<RuntimeBackend['bind']>[0]);
  old.failure.resolve(Error('storage failed')); await tick();
  expect(() => backend.sessionOptions.getDurableSession!('web:test')).toThrow('Native runtime recovering');
  expect(() => bound.prepareInputSourceAdmission!('web:test')).toThrow('Native runtime recovering');
  backend.stop(); gate.resolve(); await backend.close();
});

test('shutdown cancels a certified preparation retry without reopening', async () => {
  const old = fixture('old', []), attempted = deferred<void>(); let prepares = 0;
  const backend = await createRecoverableRuntimeBackend(async () => {
    if (++prepares === 1) return old.backend;
    attempted.resolve(); throw new RuntimePreparationError(Error('writer held'), true);
  });
  old.failure.resolve(Error('storage failed')); await attempted.promise; await tick();
  await backend.close(); expect(prepares).toBe(2);
});

test('shutdown joins a late preparation and disposes its unpublished candidate', async () => {
  const trace: string[] = [], old = fixture('old', trace), next = fixture('new', trace);
  const entered = deferred<void>(), release = deferred<void>(); let prepares = 0;
  const backend = await createRecoverableRuntimeBackend(async () => {
    if (++prepares === 1) return old.backend;
    entered.resolve(); await release.promise; return next.backend;
  });
  old.failure.resolve(Error('storage failed')); await entered.promise;
  const closing = backend.close(); release.resolve(); await closing;
  expect(trace).toEqual(['old:stop', 'old:close', 'old:closed', 'new:stop', 'new:close', 'new:closed']);
});

for (const uncertain of [false, true]) test('failed candidate attachment retains no published bindings; cleanup uncertain=' + uncertain, async () => {
  const trace: string[] = [], old = fixture('old', trace), next = fixture('new', trace);
  const failure = Error('attachment failed'); let prepares = 0;
  next.backend.attachChannel = async () => { throw failure; };
  if (uncertain) next.state.closeError = Error('candidate close uncertain');
  const backend = await createRecoverableRuntimeBackend(async () => ++prepares === 1 ? old.backend : next.backend);
  const bound = backend.bind({} as Parameters<RuntimeBackend['bind']>[0]);
  await backend.attachChannel!({} as Parameters<NonNullable<RuntimeBackend['attachChannel']>>[0]);
  old.failure.resolve(Error('storage failed')); await tick();
  expect(() => bound.prepareInputSourceAdmission!('web:test')).toThrow('Native runtime recovering');
  expect(trace).not.toContain('new:prepare');
  if (uncertain) await expect(backend.close()).rejects.toBeInstanceOf(RuntimeStartupCleanupError);
  else await expect(backend.close()).resolves.toBeUndefined();
  expect(prepares).toBe(2);
});

test('successive failed generations each close before opening the next', async () => {
  const trace: string[] = [], generations = [fixture('first', trace), fixture('second', trace), fixture('third', trace)]; let prepares = 0;
  const backend = await createRecoverableRuntimeBackend(async () => generations[prepares++]!.backend);
  generations[0]!.failure.resolve(Error('first storage failed')); await tick();
  await backend.sessionOptions.dispatchHostCommand!('web:test', 'accepted');
  generations[1]!.failure.resolve(Error('second storage failed')); await tick();
  await backend.sessionOptions.dispatchHostCommand!('web:test', 'accepted');
  expect(prepares).toBe(3); expect(trace.filter(value => value.endsWith(':command'))).toEqual(['second:command', 'third:command']);
  expect(trace.indexOf('second:closed')).toBeGreaterThan(trace.indexOf('second:command')); await backend.close();
});

test('error names and JSON text cannot forge a clean-storage retry certificate', async () => {
  const old = fixture('old', []); let prepares = 0;
  const forged = Object.assign(Error('{"_tag":"storage_unavailable","certainty":"not_applied","retryable":true}'), { name: 'RuntimePreparationError' });
  const backend = await createRecoverableRuntimeBackend(async () => { if (++prepares === 1) return old.backend; throw forged; });
  old.failure.resolve(Error('storage failed')); await tick();
  await expect(backend.sessionOptions.dispatchHostCommand!('web:test', 'accepted')).rejects.toBe(forged);
  expect(prepares).toBe(2); await expect(backend.close()).rejects.toBe(forged);
});

test('unclassified preparation failure cannot certify graceful disposal', async () => {
  const old = fixture('old', []), failure = Error('unknown partial preparation state'); let prepares = 0;
  const backend = await createRecoverableRuntimeBackend(async () => { if (++prepares === 1) return old.backend; throw failure; });
  old.failure.resolve(Error('storage failed')); await tick();
  await expect(backend.sessionOptions.dispatchHostCommand!('web:test', 'accepted')).rejects.toBe(failure);
  await expect(backend.close()).rejects.toBe(failure); expect(prepares).toBe(2);
});

const preparedBackground = {incarnation:'native-domain',conversationId:7,chatJid:'operation:accepted',branchId:'background:'+'a'.repeat(64),operationId:'operation:background:'+'a'.repeat(64),sourceSeq:1,
  sourceId:'background:'+'a'.repeat(64),payloadRef:'background:'+'a'.repeat(64),requestId:'background:'+'a'.repeat(64),requestHash:'0'.repeat(64)};
test('background admission facade: waits for confirmed cleanup and never replays an uncertain call',async()=>{
  const trace:string[]=[],old=fixture('old',trace),next=fixture('new',trace),gate=deferred<void>(),failure=Error('uncertain source publication');let prepares=0,oldCalls=0,nextCalls=0;
  old.state.closeGate=gate.promise;const signal=new AbortController().signal;
  const first:RuntimeBackend={...old.backend,sessionOptions:{...old.backend.sessionOptions,prepareAddonOperation:async()=>{oldCalls++;old.failure.resolve(failure);throw failure;}}};
  const replacement:RuntimeBackend={...next.backend,sessionOptions:{...next.backend.sessionOptions,prepareAddonOperation:async(id,received)=>{expect(id).toBe('accepted');expect(received).toBe(signal);nextCalls++;return preparedBackground;}}};
  const backend=await createRecoverableRuntimeBackend(async()=>++prepares===1?first:replacement);
  await expect(backend.sessionOptions.prepareAddonOperation!('accepted',signal)).rejects.toBe(failure);expect(oldCalls).toBe(1);
  let finished=false;const explicitRetry=backend.sessionOptions.prepareAddonOperation!('accepted',signal).then(value=>{finished=true;return value;});
  await tick();expect(finished).toBe(false);expect(nextCalls).toBe(0);expect(prepares).toBe(1);
  gate.resolve();expect(await explicitRetry).toEqual(preparedBackground);expect(oldCalls).toBe(1);expect(nextCalls).toBe(1);expect(prepares).toBe(2);
  await backend.close();await expect(backend.sessionOptions.prepareAddonOperation!('accepted')).rejects.toThrow('Native runtime closing');
});
test('background admission facade: uncertain cleanup prevents replacement admission',async()=>{
  const old=fixture('old',[]),failure=Error('failed storage'),cleanup=Error('uncertain close');let prepares=0;
  old.state.closeError=cleanup;const first:RuntimeBackend={...old.backend,sessionOptions:{...old.backend.sessionOptions,prepareAddonOperation:async()=>{old.failure.resolve(failure);throw failure;}}};
  const backend=await createRecoverableRuntimeBackend(async()=>{prepares++;return first;});
  await expect(backend.sessionOptions.prepareAddonOperation!('accepted')).rejects.toBe(failure);await tick();
  await expect(backend.sessionOptions.prepareAddonOperation!('accepted')).rejects.toBe(cleanup);expect(prepares).toBe(1);await expect(backend.close()).rejects.toBe(cleanup);
});

test('background execution facade: joins cleanup, requires explicit same-owner retry and never automatically replays',async()=>{
  const old=fixture('old',[]),next=fixture('new',[]),gate=deferred<void>(),failure=Error('unknown native dispatch');let prepares=0,oldCalls=0,nextCalls=0;
  const signal=new AbortController().signal;old.state.closeGate=gate.promise;
  const first:RuntimeBackend={...old.backend,sessionOptions:{...old.backend.sessionOptions,dispatchAddonOperation:async()=>{oldCalls++;old.failure.resolve(failure);throw failure;}}};
  const replacement:RuntimeBackend={...next.backend,sessionOptions:{...next.backend.sessionOptions,dispatchAddonOperation:async(id,received)=>{expect([id,received]).toEqual(['accepted',signal]);nextCalls++;return{status:'success',result:'original native receipt'};}}};
  const backend=await createRecoverableRuntimeBackend(async()=>++prepares===1?first:replacement);
  await expect(backend.sessionOptions.dispatchAddonOperation!('accepted',signal)).rejects.toBe(failure);expect(oldCalls).toBe(1);
  let finished=false;const explicit=backend.sessionOptions.dispatchAddonOperation!('accepted',signal).then(result=>{finished=true;return result;});
  await tick();expect(finished).toBe(false);expect(prepares).toBe(1);expect(nextCalls).toBe(0);
  gate.resolve();expect(await explicit).toEqual({status:'success',result:'original native receipt'});expect(oldCalls).toBe(1);expect(nextCalls).toBe(1);expect(prepares).toBe(2);
  await backend.close();await expect(backend.sessionOptions.dispatchAddonOperation!('accepted',signal)).rejects.toThrow('Native runtime closing');
});
test('background execution facade: uncertain cleanup prevents replacement or any retry',async()=>{
  const old=fixture('old',[]),failure=Error('unknown dispatch'),cleanup=Error('uncertain close');let prepares=0;
  old.state.closeError=cleanup;const signal=new AbortController().signal;
  const first:RuntimeBackend={...old.backend,sessionOptions:{...old.backend.sessionOptions,dispatchAddonOperation:async()=>{old.failure.resolve(failure);throw failure;}}};
  const backend=await createRecoverableRuntimeBackend(async()=>{prepares++;return first;});
  await expect(backend.sessionOptions.dispatchAddonOperation!('accepted',signal)).rejects.toBe(failure);await tick();
  await expect(backend.sessionOptions.dispatchAddonOperation!('accepted',signal)).rejects.toBe(cleanup);expect(prepares).toBe(1);await expect(backend.close()).rejects.toBe(cleanup);
});

test('background receipt recovery facade: waits for confirmed cleanup and never repeats a failed observation',async()=>{
  const old=fixture('old',[]),next=fixture('new',[]),gate=deferred<void>(),failure=Error('uncertain receipt read');let prepares=0,oldReads=0,newReads=0;
  old.state.closeGate=gate.promise;
  const first:RuntimeBackend={...old.backend,sessionOptions:{...old.backend.sessionOptions,reconcileAddonOperation:async()=>{oldReads++;old.failure.resolve(failure);throw failure;}}};
  const replacement:RuntimeBackend={...next.backend,sessionOptions:{...next.backend.sessionOptions,reconcileAddonOperation:async(id,epoch)=>{expect([id,epoch]).toEqual(['accepted',1]);newReads++;return{status:'success',result:'persisted receipt'};}}};
  const backend=await createRecoverableRuntimeBackend(async()=>++prepares===1?first:replacement);
  await expect(backend.sessionOptions.reconcileAddonOperation!('accepted',1)).rejects.toBe(failure);
  let done=false;const explicit=backend.sessionOptions.reconcileAddonOperation!('accepted',1).then(result=>{done=true;return result;});
  await tick();expect(done).toBe(false);expect(prepares).toBe(1);expect(newReads).toBe(0);gate.resolve();
  expect(await explicit).toEqual({status:'success',result:'persisted receipt'});expect(oldReads).toBe(1);expect(newReads).toBe(1);await backend.close();
});
test('background receipt recovery facade: uncertain cleanup refuses replacement reads',async()=>{
  const old=fixture('old',[]),failure=Error('failed storage'),cleanup=Error('uncertain close');let prepares=0;old.state.closeError=cleanup;
  const first:RuntimeBackend={...old.backend,sessionOptions:{...old.backend.sessionOptions,reconcileAddonOperation:async()=>{old.failure.resolve(failure);throw failure;}}};
  const backend=await createRecoverableRuntimeBackend(async()=>{prepares++;return first;});
  await expect(backend.sessionOptions.reconcileAddonOperation!('accepted',1)).rejects.toBe(failure);await tick();
  await expect(backend.sessionOptions.reconcileAddonOperation!('accepted',1)).rejects.toBe(cleanup);expect(prepares).toBe(1);await expect(backend.close()).rejects.toBe(cleanup);
});

function failAbort(f: ReturnType<typeof fixture>, method: "abort" | "abortRetry" = "abort") {
  const error = Error("Session failed after a storage error");
  f.port[method] = async () => { f.failure.resolve(error); await tick(); throw error; };
  return error;
}

test("failed-storage abort reopens after closed ownership, rebinds, and retries only its captured run", async () => {
  const trace: string[] = [], first = fixture("old", trace), next = fixture("new", trace); let prepares = 0;
  failAbort(first);
  const backend = await createRecoverableRuntimeBackend(async () => (++prepares === 1 ? first : next).backend);
  backend.bind({} as Parameters<RuntimeBackend["bind"]>[0]);
  await backend.attachChannel!({} as Parameters<NonNullable<RuntimeBackend["attachChannel"]>>[0]);
  expect(await backend.sessionOptions.getDurableSession!("web:test")!.abort!()).toBe(true);
  expect(prepares).toBe(2); expect(next.state.calls).toEqual([original]);
  expect(trace).toEqual(["old:bind", "old:attach", "old:stop", "old:close", "old:closed", "new:bind", "new:attach"]);
  await backend.close();
});

test("recovered abort refuses a successor even if its chat and session are unchanged", async () => {
  const trace: string[] = [], first = fixture("old", trace), next = fixture("new", trace); let prepares = 0;
  failAbort(first); next.state.scope = { ...original, operationId: "op:successor", sourceSeq: 12 };
  const backend = await createRecoverableRuntimeBackend(async () => (++prepares === 1 ? first : next).backend);
  expect(await backend.sessionOptions.getDurableSession!("web:test")!.abort!()).toBe(false);
  expect(next.state.scope.operationId).toBe("op:successor"); expect(next.state.calls).toEqual([original]);
  await backend.close();
});

test("retry abort retains its exact scope through storage recovery", async () => {
  const trace: string[] = [], first = fixture("old", trace), next = fixture("new", trace); let prepares = 0;
  failAbort(first, "abortRetry");
  const backend = await createRecoverableRuntimeBackend(async () => (++prepares === 1 ? first : next).backend);
  expect(await backend.sessionOptions.getDurableSession!("web:test")!.abortRetry!()).toBe(true);
  expect(next.state.calls).toEqual([original]); await backend.close();
});

test("uncertain cleanup retains failed ownership and never opens a replacement", async () => {
  const trace: string[] = [], first = fixture("old", trace); let prepares = 0;
  failAbort(first); const cleanup = Error("Storage close uncertain"); first.state.closeError = cleanup;
  const backend = await createRecoverableRuntimeBackend(async () => { prepares++; return first.backend; });
  await expect(backend.sessionOptions.getDurableSession!("web:test")!.abort!()).rejects.toBe(cleanup);
  expect(prepares).toBe(1); await expect(backend.close()).rejects.toBe(cleanup);
});

test("reopen waits for old cleanup and shutdown prevents a late replacement", async () => {
  const trace: string[] = [], first = fixture("old", trace), gate = deferred<void>(); let prepares = 0;
  first.state.closeGate = gate.promise;
  const backend = await createRecoverableRuntimeBackend(async () => { prepares++; return first.backend; });
  first.failure.resolve(Error("failed storage")); await tick(); expect(prepares).toBe(1);
  backend.stop(); const close = backend.close(); gate.resolve(); await close;
  expect(prepares).toBe(1); expect(first.state.stopped).toBe(true);
});

test("normal shutdown and forged failure names do not trigger recovery", async () => {
  const trace: string[] = [], first = fixture("old", trace); let prepares = 0;
  const forged = Object.assign(Error("ordinary host error"), { name: "SessionFailed" }); first.port.abort = async () => { throw forged; };
  const backend = await createRecoverableRuntimeBackend(async () => { prepares++; return first.backend; });
  await expect(backend.sessionOptions.getDurableSession!("web:test")!.abort!()).rejects.toBe(forged);
  expect(prepares).toBe(1); backend.stop(); first.failure.resolve(forged); await tick(); expect(prepares).toBe(1); await backend.close();
});

test("unscoped abort is never replayed, even after a genuine storage failure", async () => {
  const trace: string[] = [], first = fixture("old", trace), next = fixture("new", trace); let prepares = 0;
  const error = failAbort(first); delete first.port.readAbortScope;
  const backend = await createRecoverableRuntimeBackend(async () => (++prepares === 1 ? first : next).backend);
  await expect(backend.sessionOptions.getDurableSession!("web:test")!.abort!()).rejects.toBe(error);
  expect(next.state.calls).toEqual([]); await backend.close();
});

test("unknown chats and idle scopes do not abort or fabricate dispatch", async () => {
  const first = fixture("old", []); first.state.scope = null;
  const backend = await createRecoverableRuntimeBackend(async () => first.backend);
  expect(backend.sessionOptions.getDurableSession!("web:foreign")).toBeUndefined();
  expect(await backend.sessionOptions.getDurableSession!("web:test")!.abort!()).toBe(false);
  expect(first.state.calls).toEqual([]); await backend.close();
});

test("caller-supplied abort scope cannot be replaced with the current run", async () => {
  const first = fixture("old", []);
  const backend = await createRecoverableRuntimeBackend(async () => first.backend);
  const control = backend.sessionOptions.getDurableSession!("web:test")!;
  for (const foreign of [{ ...original, operationId: "foreign" }, { ...original, conversationId: 8 }, { ...original, sourceSeq: 12 }]) {
    expect(await control.abort!(foreign)).toBe(false);
  }
  expect(first.state.calls).toEqual([]); expect(first.state.scope).toEqual(original);
  await backend.close();
});

test("channel callbacks captured at startup use fresh admission scopes after reopen", async () => {
  const trace: string[] = [], first = fixture("old", trace), next = fixture("new", trace); let prepares = 0;
  const backend = await createRecoverableRuntimeBackend(async () => (++prepares === 1 ? first : next).backend);
  const bound = backend.bind({} as Parameters<RuntimeBackend["bind"]>[0]);
  await bound.prepareInputSourceAdmission!("web:test");
  first.failure.resolve(Error("storage closed")); await tick();
  await bound.prepareInputSourceAdmission!("web:test");
  expect(trace.filter(value => value.endsWith(":prepare"))).toEqual(["old:prepare", "new:prepare"]);
  await backend.close();
});

function observingFixture(name: string, trace: string[]) {
  const f = fixture(name, trace);
  const dispatch = Object.assign(async () => { trace.push(name + ":dispatch"); return "pending" as const; }, {
    async waitForPending(this: unknown, identity: { chatJid: string; messageId: string; rowId: number }) {
      expect(this).toBe(dispatch);
      trace.push(name + ":observe:" + identity.messageId);
      return "settled" as const;
    },
  });
  f.backend.bind = options => Object.freeze({ ...options, dispatchAcceptedInput: dispatch });
  return f;
}

test("channel recovery facade preserves callable pending observer before first recovery", async () => {
  const trace: string[] = [], f = observingFixture("initial", trace);
  const backend = await createRecoverableRuntimeBackend(async () => f.backend);
  const coordinator = backend.bind({} as any).dispatchAcceptedInput!;
  const wait = coordinator.waitForPending.bind(coordinator); // Actual web handler call shape.
  expect(await coordinator("web:test", "accepted", 1)).toBe("pending");
  expect(await wait({ chatJid: "web:test", messageId: "accepted", rowId: 1 })).toBe("settled");
  expect(trace).toEqual(["initial:dispatch", "initial:observe:accepted"]);
  await backend.close();
});

test("captured pending observer follows replacement ownership and rejects after close", async () => {
  const trace: string[] = [], a = observingFixture("old", trace), b = observingFixture("new", trace);
  let prepares = 0;
  failAbort(a);
  const backend = await createRecoverableRuntimeBackend(async () => (++prepares === 1 ? a : b).backend);
  const coordinator = backend.bind({} as any).dispatchAcceptedInput!;
  const wait = coordinator.waitForPending.bind(coordinator);
  expect(await backend.sessionOptions.getDurableSession!("web:test")!.abort!()).toBe(true);
  expect(await coordinator("web:test", "accepted", 1)).toBe("pending");
  expect(await wait({ chatJid: "web:test", messageId: "accepted", rowId: 1 })).toBe("settled");
  expect(trace.filter(value => value.includes(":dispatch") || value.includes(":observe:"))).toEqual(["new:dispatch", "new:observe:accepted"]);
  expect(b.state.calls).toEqual([original]);
  await backend.close();
  expect(() => wait({ chatJid: "web:test", messageId: "accepted", rowId: 1 })).toThrow("Native runtime closing");
});

test("missing backend pending observation fails closed instead of settling accepted work", async () => {
  const f = fixture("invalid", []);
  f.backend.bind = options => ({ ...options, dispatchAcceptedInput: (async () => "pending") as any });
  const backend = await createRecoverableRuntimeBackend(async () => f.backend);
  const coordinator = backend.bind({} as any).dispatchAcceptedInput!;
  expect(() => coordinator.waitForPending({ chatJid: "web:test", messageId: "accepted", rowId: 1 }))
    .toThrow("Native channel binding method unavailable: dispatchAcceptedInput.waitForPending");
  await backend.close();
});

test('Dream dispatch facade: preserves original invocation and deadline, joins cleanup and never automatically replays',async()=>{
  const old=fixture('old',[]),next=fixture('new',[]),gate=deferred<void>(),failure=Error('uncertain Dream dispatch');let prepares=0,oldCalls=0,nextCalls=0;
  const request={invocationId:'00000000-0000-4000-8000-000000000001',chatJid:'web:test',mode:'manual' as const,days:2,model:'fixture/original',timeoutMs:1000,acceptedAt:'2026-01-01T00:00:00.000Z',assertCurrent(){}};
  old.state.closeGate=gate.promise;
  const first:RuntimeBackend={...old.backend,sessionOptions:{...old.backend.sessionOptions,dispatchDreamOperation:async received=>{expect(received).toBe(request);oldCalls++;old.failure.resolve(failure);throw failure;}}};
  const replacement:RuntimeBackend={...next.backend,sessionOptions:{...next.backend.sessionOptions,dispatchDreamOperation:async received=>{expect(received).toBe(request);nextCalls++;return{status:'success',result:'same invocation receipt'};}}};
  const backend=await createRecoverableRuntimeBackend(async()=>++prepares===1?first:replacement);
  await expect(backend.sessionOptions.dispatchDreamOperation!(request)).rejects.toBe(failure);expect(oldCalls).toBe(1);await tick();expect(nextCalls).toBe(0);
  let ended=false;const explicit=backend.sessionOptions.dispatchDreamOperation!(request).then(value=>{ended=true;return value;});await tick();expect(ended).toBe(false);expect(prepares).toBe(1);
  gate.resolve();expect(await explicit).toEqual({status:'success',result:'same invocation receipt'});expect(oldCalls).toBe(1);expect(nextCalls).toBe(1);await backend.close();
  await expect(backend.sessionOptions.dispatchDreamOperation!(request)).rejects.toThrow('Native runtime closing');
});

test('Dream dispatch facade: unconfirmed cleanup cannot replace or replay an invocation',async()=>{
  const old=fixture('old',[]),failure=Error('failed storage'),cleanup=Error('unconfirmed Dream cleanup');let prepares=0,calls=0;old.state.closeError=cleanup;
  const request={invocationId:'00000000-0000-4000-8000-000000000002',chatJid:'web:test',mode:'manual' as const,days:2,model:null,timeoutMs:1000,acceptedAt:'2026-01-01T00:00:00.000Z',assertCurrent(){}};
  const first:RuntimeBackend={...old.backend,sessionOptions:{...old.backend.sessionOptions,dispatchDreamOperation:async()=>{calls++;old.failure.resolve(failure);throw failure;}}};
  const backend=await createRecoverableRuntimeBackend(async()=>{prepares++;return first;});
  await expect(backend.sessionOptions.dispatchDreamOperation!(request)).rejects.toBe(failure);await tick();
  await expect(backend.sessionOptions.dispatchDreamOperation!(request)).rejects.toBe(cleanup);expect(calls).toBe(1);expect(prepares).toBe(1);await expect(backend.close()).rejects.toBe(cleanup);
});
