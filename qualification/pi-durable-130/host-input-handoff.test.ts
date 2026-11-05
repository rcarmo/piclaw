import './src/test-guard.js';
import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Harness, configure, defineExtension, type GenerationHooks } from '../../runtime/durable-engine/qualification/durable.ts';
import { SqliteStorage } from '../../runtime/durable-engine/qualification/sqlite.ts';
import type { AcceptedInput } from '../../runtime/durable-engine/src/host-runtime.js';
import { createHostOperationAuthority } from '../../runtime/durable-engine/src/host-operation-authority.js';
import { hashCanonicalRequest } from '../../runtime/src/service-effects/contracts/common.js';
import { hostSourceContractFixture } from './src/host-source-contract-fixture.js';
import { OwnedSqlite } from './src/ownership.js';
import { barrier, context } from './src/fixture.js';
import { at, effect, sealed, value } from './src/host-handoff.js';

async function heldHandoff(loseRootAck = false) {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, 'input-handoff-'));
  const f = await hostSourceContractFixture(dir, 'before-submit');
  const held = barrier(), release = barrier(), hookEntered = barrier(), subscribed = barrier(), hookFinished = barrier();
  const failures: unknown[] = [], proofs: unknown[] = [];
  let input!: AcceptedInput, hookActive = false, heldOnce = false, witnessEnabled = true;
  let completions = 0, producerDone = false;
  const work = f.ports.work, bindings = f.ports.bindings;
  // Hold completion OUTSIDE the root writer; leave actual composition intact.
  const complete = f.ports.completeInputHandoff;
  f.ports = { ...f.ports, async completeInputHandoff(...args) {
    if (!heldOnce) { heldOnce = true; held.release(); await release.promise; }
    completions++;
    await complete(...args);
    if (loseRootAck) throw Error('Root ACK lost after composite commit');
  } };
  const beforeRequest: NonNullable<GenerationHooks['beforeRequest']> = async (request, api) => {
    hookActive = true; hookEntered.release();
    try {
      const proof = await f.runtime!.captureRunSource(api.conversationId, api.taskId);
      createHostOperationAuthority(f.db, proof, () => f.owner.assert()).assertCurrent();
      proofs.push(proof); return request;
    } catch (error) { failures.push(error); throw error; }
    finally { hookActive = false; hookFinished.release(); }
  };
  const extension = defineExtension({ name: 'qualification.exact-handoff', hooks: [{ task: 'pi.generation', handlers: { beforeRequest } }] });
  f.base.registry.install(extension);
  const config = await Harness.open(await SqliteStorage.open(new OwnedSqlite(f.owner)), { models: f.base.models, registry: f.base.registry }, context);
  try { await config.commit(tx => configure(tx, f.base.root.id, { extensions: [extension], tools: [] }), context); }
  finally { await config.close(context); }
  f.db.query('INSERT OR IGNORE INTO chats(jid,name,last_message_time) VALUES(?,?,?)').run(f.chatJid, 'Exact handoff fixture', at);
  const source = value(await work.acceptSource(sealed({ effect: effect(`${f.incarnation}:source`), chatJid: f.chatJid,
    sourceId: `${f.incarnation}:source`, kind: 'message', payloadRef: `${f.incarnation}:source`, targetOperationId: null,
    parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
  const content = 'Exact handoff fixture';
  f.db.query('INSERT INTO messages(id,chat_jid,content,timestamp) VALUES(?,?,?,?)').run(source.sourceId, f.chatJid, content, at);
  const claimed = value(await work.claimNext(sealed({ effect: effect(`${f.incarnation}:claim`), chatJid: f.chatJid,
    expectedFrontier: 0, newOperationId: f.incarnation, claimedAt: at })))!;
  input = { incarnation: f.incarnation, conversationId: f.base.root.id, chatJid: f.chatJid, branchId: 'main',
    operationId: claimed.operation.operationId, sourceSeq: source.sourceSeq, sourceId: source.sourceId, payloadRef: source.payloadRef,
    requestId: f.primaryRequestId, requestHash: hashCanonicalRequest({ type: 'input', requestId: f.primaryRequestId, content }) };
  await f.open(); f.permit = true;
  // Observe actual wait subscription, never replace authority or guess after a sleep.
  // The baseline has no join: its real failed hook wins the race and supplies the red predicate.
  type Join = { input: AcceptedInput; ready: Promise<unknown> };
  const joins = (f.runtime as unknown as { inputHandoffs?: Map<string, Join> }).inputHandoffs;
  if (joins) {
    const get = joins.get.bind(joins);
    joins.get = key => {
      const item = get(key);
      if (!witnessEnabled || !hookActive || !item || item.input.conversationId !== input.conversationId || item.input.requestId !== input.requestId) return item;
      return { ...item, ready: new Proxy(item.ready, { get(target, property) {
        if (property === 'then') return (...args: Parameters<Promise<unknown>['then']>) => { subscribed.release(); return target.then(...args); };
        const member = Reflect.get(target, property, target); return typeof member === 'function' ? member.bind(target) : member;
      } }) };
    };
  }
  const producer = f.runtime!.submit(input);
  const submitted = producer.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }))
    .finally(() => { producerDone = true; });
  return { f, input, work, bindings, producer, submitted, release, hookFinished, failures, proofs,
    get completions() { return completions; }, get producerDone() { return producerDone; },
    async observing() { await held.promise; await hookEntered.promise; await Promise.race([subscribed.promise, hookFinished.promise]); },
    probes<T>(body: () => T): T { witnessEnabled = false; try { return body(); } finally { witnessEnabled = true; } },
    async close() { release.release(); await submitted; await f.close(); await rm(dir, { recursive: true, force: true }); },
  };
}

test('exact handoff: beforeRequest waits for host completion, then enters provider once', async () => {
  const h = await heldHandoff();
  const { f, input, work, bindings, producer, submitted, release, hookFinished, failures, proofs } = h;
  try {
    await h.observing();
    expect(failures).toEqual([]); expect(proofs).toEqual([]);
    expect(f.providerEntries).toBe(0); expect(f.toolEntries).toBe(0); expect(f.base.host.modelCalls).toBe(0);
    expect(value(await work.getOperation(input.operationId))?.harness).toBeNull();
    expect((await bindings.get(input))?.submissionId).toBeNull();
    // Only the actual hook receives the wait witness; do not proxy the producer
    // promise returned to these independent caller probes.
    const [duplicate, conflict, roleConflict] = h.probes(() => [
      f.runtime!.submit({ ...input }),
      f.runtime!.submit({ ...input, sourceId: `${input.sourceId}:conflict` }),
      f.runtime!.submitIntent(input),
    ]);
    expect(duplicate).toBe(producer);
    await expect(conflict).rejects.toThrow('Input handoff identity conflict');
    await expect(roleConflict).rejects.toThrow('Input handoff identity conflict');
    release.release(); const result = await submitted;
    expect(result.ok).toBe(true); if (!result.ok) throw result.error;
    await f.runtime!.wait(input, result.value); await hookFinished.promise;
    expect(failures).toEqual([]); expect(proofs).toHaveLength(1);
    expect(f.providerEntries).toBe(1); expect(f.base.host.modelCalls).toBe(1);
    expect((await bindings.get(input))?.submissionId).toBe(result.value);
    expect(value(await work.getOperation(input.operationId))?.harness).toEqual({ sessionId: f.incarnation, harnessOperationId: String(result.value) });
  } finally { await h.close(); }
}, 30000);

function noEffects(h: Awaited<ReturnType<typeof heldHandoff>>) {
  expect(h.f.providerEntries).toBe(0);
  expect(h.f.toolEntries).toBe(0);
  expect(h.f.base.host.modelCalls).toBe(0);
  expect(h.proofs).toEqual([]);
}

for (const change of ['cancellation', 'owner revocation', 'version', 'conflicting harness', 'source membership', 'source payload'] as const) {
  test(`exact handoff: live hold rejects ${change} without ACK or execution`, async () => {
    const h = await heldHandoff();
    const { f, input, work } = h;
    let ownerDb: Database | undefined;
    try {
      await h.observing();
      expect(h.failures).toEqual([]); noEffects(h);
      // Conflict every non-key identity component, not only sourceId. These are
      // independent callers, NOT the hook's wait-subscription witness.
      for (const patch of [
        { incarnation: `${input.incarnation}:other` }, { chatJid: `${input.chatJid}:other` },
        { branchId: 'other' }, { operationId: `${input.operationId}:other` },
        { sourceSeq: input.sourceSeq + 1 }, { sourceId: `${input.sourceId}:other` },
        { payloadRef: `${input.payloadRef}:other` }, { requestHash: '0'.repeat(64) },
      ]) await expect(h.probes(() => f.runtime!.submit({ ...input, ...patch }))).rejects.toThrow('Input handoff identity conflict');
      expect(h.probes(() => f.runtime!.submit({ ...input }))).toBe(h.producer);
      await expect(h.probes(() => f.runtime!.submitIntent(input))).rejects.toThrow('Input handoff identity conflict');
      const operation = value(await work.getOperation(input.operationId))!;
      if (change === 'cancellation') {
        const cancel = value(await work.acceptSource(sealed({ effect: effect(`${f.incarnation}:cancel-source`), chatJid: f.chatJid,
          sourceId: `${f.incarnation}:cancel`, kind: 'cancellation', payloadRef: 'cancel:payload', targetOperationId: input.operationId,
          parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
        value(await work.acceptCancellation(sealed({ effect: effect(`${f.incarnation}:cancel`, input.operationId, cancel.sourceSeq),
          expectedVersion: operation.version, sourceId: cancel.sourceId, sourceSeq: cancel.sourceSeq, cause: 'user', requestedAt: at })));
      } else if (change === 'owner revocation') {
        // Fault injection into the test owner, never SDK lifecycle state. Restore
        // only for owned cleanup after both live observers have rejected.
        ownerDb = new Database(f.path);
        ownerDb.exec('UPDATE qualification_process_owner SET active=0');
      } else if (change === 'version') {
        f.db.query('UPDATE service_effect_s01_operations SET version=version+1 WHERE operation_id=?').run(input.operationId);
      } else if (change === 'conflicting harness') {
        value(await work.bindHarness(sealed({ effect: effect(`${f.incarnation}:other-harness`, input.operationId, input.sourceSeq),
          expectedVersion: operation.version, sessionId: 'other-session', harnessOperationId: '999' })));
      } else if (change === 'source membership') {
        f.db.query('DELETE FROM service_effect_s01_operation_sources WHERE operation_id=? AND source_seq=?').run(input.operationId, input.sourceSeq);
      } else {
        f.db.query('UPDATE service_effect_s01_sources SET payload_ref=? WHERE chat_jid=? AND source_seq=?').run('changed:payload', input.chatJid, input.sourceSeq);
      }
      // Compare the whole host execution row: completion must not overwrite the
      // conflicting authority or leave partial ACK/version/phase writes behind.
      const before = f.db.query('SELECT * FROM service_effect_s01_operations WHERE operation_id=?').get(input.operationId);
      h.release.release();
      expect((await h.submitted).ok).toBe(false);
      await h.hookFinished.promise;
      expect(h.failures).toHaveLength(1); noEffects(h);
      expect(f.db.query('SELECT * FROM service_effect_s01_operations WHERE operation_id=?').get(input.operationId)).toEqual(before);
      expect((f.db.query('SELECT submission_id FROM piclaw_durable_bindings_v1 WHERE request_id=?').get(input.requestId) as { submission_id: number | null }).submission_id).toBeNull();
      expect(h.completions).toBe(1);
    } finally {
      ownerDb?.exec('UPDATE qualification_process_owner SET active=1'); ownerDb?.close();
      await h.close();
    }
  }, 30000);
}

test('exact handoff: close detaches held observing hook, not underlying producer SQL', async () => {
  const h = await heldHandoff();
  let closing: Promise<void> | undefined;
  try {
    await h.observing(); expect(h.failures).toEqual([]); noEffects(h);
    closing = h.f.runtime!.close();
    await h.hookFinished.promise;
    expect(h.failures).toHaveLength(1); noEffects(h);
    expect(h.producerDone).toBe(false);
    expect(h.completions).toBe(0);
    expect((await h.bindings.get(h.input))?.submissionId).toBeNull();
    expect(value(await h.work.getOperation(h.input.operationId))?.harness).toBeNull();
    // Only now let the entered callback finish. Ordinary close is not a
    // quiescence/rollback proof and must not be reported as producer completion.
    h.release.release();
    expect((await h.submitted).ok).toBe(false);
    await closing;
    expect((await h.bindings.get(h.input))?.submissionId).toBeNull();
    expect(value(await h.work.getOperation(h.input.operationId))?.harness).toBeNull();
    noEffects(h);
  } finally { h.release.release(); await h.submitted; await closing; await h.close(); }
}, 30000);

test('exact handoff: lost root ACK after composite commit uses exact pair readback once', async () => {
  const h = await heldHandoff(true);
  try {
    await h.observing(); expect(h.failures).toEqual([]); noEffects(h);
    const duplicate = h.probes(() => h.f.runtime!.submit({ ...h.input }));
    expect(duplicate).toBe(h.producer);
    h.release.release();
    const result = await h.submitted;
    expect(result.ok).toBe(true); if (!result.ok) throw result.error;
    expect(await duplicate).toBe(result.value);
    await h.f.runtime!.wait(h.input, result.value); await h.hookFinished.promise;
    expect(h.completions).toBe(1);
    expect((await h.bindings.get(h.input))?.submissionId).toBe(result.value);
    expect(value(await h.work.getOperation(h.input.operationId))?.harness).toEqual({ sessionId: h.f.incarnation, harnessOperationId: String(result.value) });
    expect(h.failures).toEqual([]); expect(h.proofs).toHaveLength(1);
    expect(h.f.providerEntries).toBe(1); expect(h.f.base.host.modelCalls).toBe(1); expect(h.f.toolEntries).toBe(0);
  } finally { await h.close(); }
}, 30000);
