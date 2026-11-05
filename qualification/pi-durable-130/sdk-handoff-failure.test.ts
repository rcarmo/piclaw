import './src/test-guard.js';
import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { StorageWrite, SubmissionRecord } from '../../runtime/durable-engine/qualification/durable.ts';
import { SqliteStorage } from '../../runtime/durable-engine/qualification/sqlite.ts';
import type { AcceptedInput } from '../../runtime/durable-engine/src/host-runtime.js';
import { hashCanonicalRequest } from '../../runtime/src/service-effects/contracts/common.js';
import { hostSourceContractFixture } from './src/host-source-contract-fixture.js';
import { OwnedSqlite } from './src/ownership.js';
import { barrier, context } from './src/fixture.js';
import { at, effect, sealed, value } from './src/host-handoff.js';

// Unlike loss of a conversation.submit return with a usable Session, a thrown
// real Storage.commit fails the SDK Session and closes its backend. No repair,
// second submit, Harness reopen, resume, provider replay or task revival here.
test('SDK commit ACK lost: failed Session leaves original input uncertain and host handoff ungranted', async () => {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, 'sdk-handoff-failure-'));
  const f = await hostSourceContractFixture(dir, 'before-submit');
  let reader: SqliteStorage | undefined;
  try {
    const work = f.ports.work;
    f.db.query('INSERT OR IGNORE INTO chats(jid,name,last_message_time) VALUES(?,?,?)').run(f.chatJid, 'SDK storage failure', at);
    const source = value(await work.acceptSource(sealed({ effect: effect(`${f.incarnation}:source`), chatJid: f.chatJid,
      sourceId: `${f.incarnation}:source`, kind: 'message', payloadRef: `${f.incarnation}:source`, targetOperationId: null,
      parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
    const content = 'Original live SDK commit, lost ACK';
    f.db.query('INSERT INTO messages(id,chat_jid,content,timestamp) VALUES(?,?,?,?)').run(source.sourceId, f.chatJid, content, at);
    const claimed = value(await work.claimNext(sealed({ effect: effect(`${f.incarnation}:claim`), chatJid: f.chatJid,
      expectedFrontier: 0, newOperationId: f.incarnation, claimedAt: at })))!;
    const input: AcceptedInput = { incarnation: f.incarnation, conversationId: f.base.root.id, chatJid: f.chatJid, branchId: 'main',
      operationId: claimed.operation.operationId, sourceSeq: source.sourceSeq, sourceId: source.sourceId, payloadRef: source.payloadRef,
      requestId: f.primaryRequestId, requestHash: hashCanonicalRequest({ type: 'input', requestId: f.primaryRequestId, content }) };
    let completions = 0;
    const complete = f.ports.completeInputHandoff;
    f.ports = { ...f.ports, async completeInputHandoff(...args) { completions++; await complete(...args); } };
    await f.open(); f.permit = true;

    // Install only AFTER the actual runtime has opened its actual storage.
    const storage = f.candidateStorage, database = f.candidateDatabase;
    const commit = storage.commit.bind(storage), closeDatabase = database.close.bind(database);
    const backendClosed = barrier();
    let databaseCloses = 0, matches = 0, injected = false;
    let committed: SubmissionRecord | undefined;
    let committedWrites: readonly StorageWrite[] = [];
    database.close = async () => { await closeDatabase(); databaseCloses++; backendClosed.release(); };
    const lostAck = new Error('Qualification: real SDK storage commit succeeded but ACK was lost');
    storage.commit = async (writes: readonly StorageWrite[], callContext) => {
      const target = writes.find((write): write is Extract<StorageWrite, { type: 'submission' }> =>
        write.type === 'submission' && write.value.type === 'input' &&
        write.value.conversationId === input.conversationId && write.value.requestId === input.requestId);
      if (target) matches++;
      const seq = await commit(writes, callContext); // Real durable transaction, never a synthetic submit.
      if (target && !injected) {
        injected = true; committed = structuredClone(target.value); committedWrites = structuredClone(writes);
        throw lostAck; // Fatal Storage guard path, not a post-submit host adapter fault.
      }
      return seq;
    };
    const operationBefore = f.db.query('SELECT * FROM service_effect_s01_operations WHERE operation_id=?').get(input.operationId);
    const sourceBefore = work.getAcceptedSource(f.chatJid, source.sourceId);
    expect((await f.ports.bindings.get(input))?.submissionId ?? null).toBeNull();

    // Exactly one original live runtime submission. Do not retry even on failure.
    await expect(f.runtime!.submit(input)).rejects.toThrow(lostAck.message);
    await backendClosed.promise;
    await f.runtime!.close(); // Drain before constructing another owned connection.
    expect(injected).toBe(true); expect(matches).toBe(1); expect(databaseCloses).toBe(1);
    expect(committed?.type).toBe('input'); expect(committed?.status).toBe('placed');
    expect(completions).toBe(0);
    expect(f.db.query('SELECT * FROM service_effect_s01_operations WHERE operation_id=?').get(input.operationId)).toEqual(operationBefore);
    expect(work.getAcceptedSource(f.chatJid, source.sourceId)).toEqual(sourceBefore);
    expect((await f.ports.bindings.get(input))?.submissionId).toBeNull();
    expect(value(await work.getOperation(input.operationId))?.harness).toBeNull();
    expect(f.providerEntries).toBe(0); expect(f.toolEntries).toBe(0);
    expect(f.base.host.modelCalls).toBe(0); expect(f.base.host.effects).toBe(0);
    expect(f.owner.acquired).toBe(true);

    // FORENSIC FIXTURE READER ONLY, NOT PRODUCTION RECOVERY. The failed runtime
    // is drained; owner is still held. Open public storage without any Session,
    // Harness or resume, and close it before f.close releases the TestOwner.
    reader = await SqliteStorage.open(new OwnedSqlite(f.owner));
    const found = await reader.submissionByRequest(input.conversationId, input.requestId, context);
    expect(found).toEqual(committed);
    const page = await reader.scanSubmissions({ conversationId: input.conversationId }, 100, undefined, context);
    expect(page.next).toBeUndefined();
    expect(page.items).toEqual([committed!]); // Only the original input, no replay/revival.
    for (const write of committedWrites) {
      if (write.type === 'entry') expect((await reader.entry(write.value.id, context))?.entry).toEqual(write.value);
    }
    expect(found?.requestId).toBe(input.requestId); expect(found?.conversationId).toBe(input.conversationId);
    if (found?.type !== 'input' || found.status !== 'placed') throw Error('Original placed input evidence missing');
    const placed = (await reader.entry(found.entry, context))?.entry;
    expect(placed?.conversationId).toBe(input.conversationId);
    expect(placed?.kind).toBe('host.accepted');
    expect(placed?.data).toEqual({ ...input, role: 'primary' });
    expect(placed?.model).toHaveLength(1);
    expect(placed?.model?.[0]).toMatchObject({ role: 'user', content });
    expect(f.providerEntries).toBe(0); expect(f.toolEntries).toBe(0);
    expect(f.base.host.modelCalls).toBe(0); expect(f.base.host.effects).toBe(0);
  } finally {
    await reader?.close(context);
    await f.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);


// Fault only the public conversation adapter return; the SDK Session stays live.
test('SDK submit return lost: usable Session reconciles original producer without resubmit', async () => {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, 'sdk-usable-return-'));
  const f = await hostSourceContractFixture(dir, 'before-submit');
  const completionEntered = barrier(), allowCompletion = barrier();
  try {
    const work = f.ports.work;
    f.db.query('INSERT OR IGNORE INTO chats(jid,name,last_message_time) VALUES(?,?,?)').run(f.chatJid, 'SDK storage failure', at);
    const source = value(await work.acceptSource(sealed({ effect: effect(`${f.incarnation}:source`), chatJid: f.chatJid,
      sourceId: `${f.incarnation}:source`, kind: 'message', payloadRef: `${f.incarnation}:source`, targetOperationId: null,
      parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
    const content = 'use-tool: usable Session lost return';
    f.db.query('INSERT INTO messages(id,chat_jid,content,timestamp) VALUES(?,?,?,?)').run(source.sourceId, f.chatJid, content, at);
    const claimed = value(await work.claimNext(sealed({ effect: effect(`${f.incarnation}:claim`), chatJid: f.chatJid,
      expectedFrontier: 0, newOperationId: f.incarnation, claimedAt: at })))!;
    const input: AcceptedInput = { incarnation: f.incarnation, conversationId: f.base.root.id, chatJid: f.chatJid, branchId: 'main',
      operationId: claimed.operation.operationId, sourceSeq: source.sourceSeq, sourceId: source.sourceId, payloadRef: source.payloadRef,
      requestId: f.primaryRequestId, requestHash: hashCanonicalRequest({ type: 'input', requestId: f.primaryRequestId, content }) };
    let completions = 0;
    const complete = f.ports.completeInputHandoff;
    f.ports = { ...f.ports, async completeInputHandoff(...args) {
      completions++; completionEntered.release();
      await allowCompletion.promise;
      await complete(...args);
    } };
    await f.open(); f.permit = true;
    // Access private runtime ownership only to inject at the public Harness API.
    // Wrap EVERY returned conversation: no assumption of handle caching.
    const harness = (f.runtime as unknown as { harness: import('../../runtime/durable-engine/qualification/durable.ts').Harness }).harness;
    const originalConversation = harness.conversation;
    let submits = 0, lost = false;
    let actual: Awaited<ReturnType<NonNullable<Awaited<ReturnType<typeof originalConversation>>>['submit']>> | undefined;
    const lostReturn = new Error('Qualification: public submit completed; host lost return');
    harness.conversation = async function (...args) {
      const conversation = await originalConversation.apply(this, args);
      if (!conversation) return conversation;
      const originalSubmit = conversation.submit;
      return new Proxy(conversation, { get(target, property) {
        if (property === 'submit') return async (...submitArgs: Parameters<typeof originalSubmit>) => {
          submits++;
          const result = await originalSubmit.apply(target, submitArgs);
          actual = result;
          if (!lost) { lost = true; throw lostReturn; }
          return result;
        };
        const member = Reflect.get(target, property, target);
        return typeof member === 'function' ? member.bind(target) : member;
      } });
    };
    const pending = f.runtime!.submit(input);
    await completionEntered.promise;
    expect(lost).toBe(true); expect(submits).toBe(1); expect(actual).toBeDefined();
    const evidence = await f.candidateStorage.submissionByRequest(input.conversationId, input.requestId, context);
    expect(evidence?.id).toBe(actual!.id);
    expect(evidence?.type).toBe('input');
    if (evidence?.type !== 'input' || evidence.status !== 'placed') throw Error('Original placed evidence missing');
    const accepted = (await f.candidateStorage.entry(evidence.entry, context))?.entry;
    expect(accepted?.kind).toBe('host.accepted');
    expect(accepted?.data).toEqual({ ...input, role: 'primary' });
    expect((await f.ports.bindings.get(input))?.submissionId ?? null).toBeNull();
    expect(value(await work.getOperation(input.operationId))?.harness).toBeNull();
    expect(f.providerEntries).toBe(0); expect(f.base.host.effects).toBe(0);
    allowCompletion.release();
    const id = await pending;
    expect(id).toBe(actual!.id);
    expect((await f.ports.bindings.get(input))?.submissionId).toBe(id);
    expect(value(await work.getOperation(input.operationId))?.harness).toMatchObject({ sessionId: f.incarnation, harnessOperationId: String(id) });
    await f.runtime!.wait(input, id);
    expect(await actual!.status(context)).toMatchObject({ type: 'input', status: 'done' });
    expect((await f.runtime!.reconcile(input)).answer?.text).toBe('synthetic answer');
    expect(f.base.host.modelCalls).toBe(2); expect(f.base.host.effects).toBe(1);
    expect(f.base.host.credentialLookups).toBe(0);
    const page = await f.candidateStorage.scanSubmissions({ conversationId: input.conversationId }, 100, undefined, context);
    expect(page.next).toBeUndefined(); expect(page.items.map(item => item.id)).toEqual([id]);
    expect(completions).toBe(1); expect(submits).toBe(1);
    await harness.inspect(context); // Same healthy Session, not a reopened forensic reader.
    expect(f.owner.acquired).toBe(true);
  } finally {
    allowCompletion.release();
    await f.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
