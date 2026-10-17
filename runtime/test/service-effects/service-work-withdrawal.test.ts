import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { hashCanonicalRequest, type CanonicalJsonValue } from "../../src/service-effects/contracts/common.js";
import { createCurrentPiclawServiceWorkStore, EffectAdmissionError, type WithdrawUnclaimedSourceRequest } from "../../src/service-effects/current-piclaw/service-work-store.js";
import { terminalOperation, terminalRequest } from "../../src/service-effects/testing/contract-suites/terminal-settlement-store-contract.js";
import { openSqliteSubject } from "./terminal-settlement-test-support.js";

function seal<T extends { effect: { requestHash: string } }>(request: T, method?: string): T {
  request.effect.requestHash = hashCanonicalRequest((method ? { method, ...request } : request) as unknown as CanonicalJsonValue);
  return request;
}

test('withdraw later pending source holds active frontier; real EF-S02 closes disposed suffix', async () => {
  const subject = openSqliteSubject(':memory:', [], false);
  const db = subject.database;
  try {
    subject.seedOperation(terminalOperation({ chatJid: 'web:default' }));
    let owner = true;
    const made = createCurrentPiclawServiceWorkStore(db, { hitFault: () => false, recordTrace() {}, validateAcceptance: () => owner });
    if (!made.ok) throw Error('fixture');
    const work = made.value;
    const effect = (key: string) => ({ idempotencyKey: key, requestHash: '', operationId: null, sourceSeq: null, provenanceRef: 'host', redactionClass: 'private' as const });
    const accepted = db.transaction(() => work.acceptSourceInTransaction(seal({ effect: effect('accept-later'), chatJid: 'web:default', sourceId: 'later', kind: 'message' as const,
      payloadRef: 'queued-source:later', targetOperationId: null, parentSourceSeq: null, acceptedAt: '2026-08-14T09:00:00.000Z', createWakeIntent: false }), db))();
    const row = db.query('SELECT source_hash FROM service_effect_s01_sources WHERE source_id=?').get('later') as { source_hash: string };
    const request: WithdrawUnclaimedSourceRequest = seal({ effect: effect('withdraw-later'), chatJid: 'web:default', sourceId: 'later', sourceHash: row.source_hash, payloadRef: 'queued-source:later', actor: 'single-user' }, 'withdrawUnclaimedSource.v1');
    const snapshot = () => ['sources', 'chats', 'decisions'].map(table => db.query(`SELECT * FROM service_effect_s01_${table}`).all());
    const before = snapshot();
    for (const patch of [{ chatJid: 'wrong' }, { sourceId: 'wrong' }, { sourceHash: 'a'.repeat(64) }, { payloadRef: 'message-row:1' }]) {
      const invalid = seal({ ...request, ...patch, effect: { ...request.effect } }, 'withdrawUnclaimedSource.v1');
      expect(() => db.transaction(() => work.withdrawUnclaimedSourceInTransaction(invalid, db))()).toThrow(EffectAdmissionError);
      expect(snapshot()).toEqual(before);
    }
    expect(() => work.withdrawUnclaimedSourceInTransaction(request, db)).toThrow('owner_conflict');
    const other = new Database(':memory:');
    try { expect(() => db.transaction(() => work.withdrawUnclaimedSourceInTransaction(request, other))()).toThrow('owner_conflict'); } finally { other.close(); }
    owner = false;
    expect(() => db.transaction(() => work.withdrawUnclaimedSourceInTransaction(request, db))()).toThrow('owner_conflict');
    owner = true;
    const disposed = db.transaction(() => work.withdrawUnclaimedSourceInTransaction(request, db))();
    expect(disposed.state).toBe('disposed'); expect(disposed.sourceSeq).toBe(accepted.sourceSeq);
    expect(db.transaction(() => work.withdrawUnclaimedSourceInTransaction(request, db))()).toEqual(disposed);
    const changedActor = seal({ ...request, actor: 'other', effect: { ...request.effect } }, 'withdrawUnclaimedSource.v1');
    expect(() => db.transaction(() => work.withdrawUnclaimedSourceInTransaction(changedActor, db))()).toThrow('idempotency_conflict');
    const changedSource = seal({ ...request, sourceHash: 'b'.repeat(64), effect: { ...request.effect } }, 'withdrawUnclaimedSource.v1');
    expect(() => db.transaction(() => work.withdrawUnclaimedSourceInTransaction(changedSource, db))()).toThrow('idempotency_conflict');
    for (const id of ['open-gap', 'disposed-after-gap']) {
      db.transaction(() => work.acceptSourceInTransaction(seal({ effect: effect(`accept-${id}`), chatJid: 'web:default', sourceId: id, kind: 'message' as const,
        payloadRef: `queued-source:${id}`, targetOperationId: null, parentSourceSeq: null, acceptedAt: '2026-08-14T09:00:00.000Z', createWakeIntent: false }), db))();
    }
    const suffix = db.query('SELECT source_hash FROM service_effect_s01_sources WHERE source_id=?').get('disposed-after-gap') as { source_hash: string };
    db.transaction(() => work.withdrawUnclaimedSourceInTransaction(seal({ ...request, sourceId: 'disposed-after-gap', sourceHash: suffix.source_hash,
      payloadRef: 'queued-source:disposed-after-gap', effect: effect('withdraw-suffix') }, 'withdrawUnclaimedSource.v1'), db))();
    const frontier = await work.getChatFrontier('web:default');
    expect(frontier.ok && frontier.value.consumedThroughSourceSeq).toBe(0);
    expect(frontier.ok && frontier.value.activeOperationId).toBe('operation-1');
    const terminal = await subject.store.commitTerminal(terminalRequest({ chatJid: 'web:default' }));
    expect(terminal.ok).toBe(true);
    expect(terminal.ok && terminal.value.consumedThroughSourceSeq).toBe(2);
    expect(db.transaction(() => work.withdrawUnclaimedSourceInTransaction(request, db))()).toEqual(disposed);
  } finally { subject.dispose?.(); }
});
