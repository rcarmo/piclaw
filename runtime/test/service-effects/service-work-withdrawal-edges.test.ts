import { expect, test } from 'bun:test';
import { hashCanonicalRequest, type CanonicalJsonValue } from '../../src/service-effects/contracts/common.js';
import { createCurrentPiclawServiceWorkStore } from '../../src/service-effects/current-piclaw/service-work-store.js';
import { computeClosedSourceFrontier } from '../../src/service-effects/current-piclaw/source-frontier.js';
import { openSqliteSubject } from './terminal-settlement-test-support.js';

function seal<T extends { effect: { requestHash: string } }>(input: T, method?: string): T {
  input.effect.requestHash = hashCanonicalRequest((method ? { method, ...input } : input) as unknown as CanonicalJsonValue);
  return input;
}
for (const guard of ['missing', 'false-first', 'false-last', 'async-first', 'async-last', 'throw-last'] as const) test(`withdrawal writer fence ${guard} rejects and rolls back every table`, () => {
  const s = openSqliteSubject(':memory:', [], false), db = s.database;
  try {
    let calls = 0;
    const validateAcceptance = guard === 'missing' ? undefined : (() => {
      calls++;
      if (guard === 'throw-last' && calls === 2) throw Error('private guard');
      if (guard.startsWith('async') && calls === (guard.endsWith('first') ? 1 : 2)) return Promise.reject(Error('private async guard'));
      return calls !== (guard === 'false-first' ? 1 : guard === 'false-last' ? 2 : -1);
    }) as (() => boolean);
    const made = createCurrentPiclawServiceWorkStore(db, { hitFault: () => false, recordTrace() {}, validateAcceptance });
    const seed = createCurrentPiclawServiceWorkStore(db, { hitFault: () => false, recordTrace() {} });
    if (!made.ok || !seed.ok) throw Error('fixture');
    const effect = (key: string) => ({ idempotencyKey: key, requestHash: '', operationId: null, sourceSeq: null, provenanceRef: 'host', redactionClass: 'private' as const });
    const accepted = seal({ effect: effect('accept'), chatJid: 'web:edges', sourceId: 'source-edges', kind: 'message' as const, payloadRef: 'queued-source:source-edges', targetOperationId: null, parentSourceSeq: null, acceptedAt: '2026-08-14T09:00:00.000Z', createWakeIntent: true });
    db.transaction(() => seed.value.acceptSourceInTransaction(accepted, db))();
    const row = db.query('SELECT source_hash FROM service_effect_s01_sources').get() as { source_hash: string };
    const request = seal({ effect: effect('withdraw'), chatJid: accepted.chatJid, sourceId: accepted.sourceId, sourceHash: row.source_hash, payloadRef: accepted.payloadRef, actor: 'single-user' }, 'withdrawUnclaimedSource.v1');
    const snapshot = () => (db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map(({ name }) => [name, db.query(`SELECT * FROM "${name}"`).all()]);
    const before = snapshot();
    expect(() => db.transaction(() => made.value.withdrawUnclaimedSourceInTransaction(request, db))()).toThrow('owner_conflict');
    expect(snapshot()).toEqual(before);
    expect(calls).toBe(guard === 'missing' ? 0 : guard.endsWith('first') ? 1 : 2);
  } finally { s.dispose?.(); }
});

test('shared frontier stops on every open state, rejects gaps/corruption, and crosses only closed suffix', () => {
  const s = openSqliteSubject(':memory:', [], false), db = s.database;
  try {
    // Shadow only the source table to inject states excluded by the real CHECK.
    db.exec("CREATE TEMP TABLE service_effect_s01_sources(chat_jid TEXT DEFAULT 'chat', source_seq INTEGER, state TEXT)");
    for (const state of ['pending', 'claimed', 'queued']) {
      db.exec('DELETE FROM temp.service_effect_s01_sources');
      db.query('INSERT INTO temp.service_effect_s01_sources(source_seq, state) VALUES (1, ?), (2, ?)').run(state, 'disposed');
      expect(computeClosedSourceFrontier(db, 'chat', 0, 3)).toBe(0);
    }
    db.exec("DELETE FROM temp.service_effect_s01_sources; INSERT INTO temp.service_effect_s01_sources(source_seq, state) VALUES (1, 'consumed'), (2, 'disposed')");
    expect(computeClosedSourceFrontier(db, 'chat', 0, 3)).toBe(2);
    db.exec('DELETE FROM temp.service_effect_s01_sources WHERE source_seq=1');
    expect(() => computeClosedSourceFrontier(db, 'chat', 0, 3)).toThrow();
    db.exec("INSERT INTO temp.service_effect_s01_sources(source_seq, state) VALUES (1, 'corrupt')");
    expect(() => computeClosedSourceFrontier(db, 'chat', 0, 3)).toThrow();
    expect(() => computeClosedSourceFrontier(db, 'chat', 3, 3)).toThrow();
  } finally { s.dispose?.(); }
});

for (const kind of ['scheduled_agent', 'control'] as const) test(`queued payload reference cannot withdraw non-message ${kind}`, () => {
  const s = openSqliteSubject(':memory:', [], false), db = s.database;
  try {
    const made = createCurrentPiclawServiceWorkStore(db, { hitFault: () => false, recordTrace() {}, validateAcceptance: () => true });
    if (!made.ok) throw Error('fixture');
    const effect = (key: string) => ({ idempotencyKey: key, requestHash: '', operationId: null, sourceSeq: null, provenanceRef: 'host', redactionClass: 'private' as const });
    db.transaction(() => made.value.acceptSourceInTransaction(seal({ effect: effect('accept'), chatJid: 'web:kind', sourceId: 'source-kind', kind, payloadRef: 'queued-source:source-kind', targetOperationId: null, parentSourceSeq: null, acceptedAt: '2026-08-14T09:00:00.000Z', createWakeIntent: false }), db))();
    const row = db.query('SELECT source_hash FROM service_effect_s01_sources').get() as { source_hash: string };
    const request = seal({ effect: effect('withdraw'), chatJid: 'web:kind', sourceId: 'source-kind', sourceHash: row.source_hash, payloadRef: 'queued-source:source-kind', actor: 'single-user' }, 'withdrawUnclaimedSource.v1');
    expect(() => db.transaction(() => made.value.withdrawUnclaimedSourceInTransaction(request, db))()).toThrow('invalid_transition');
    expect(made.value.getAcceptedSource('web:kind', 'source-kind')?.state).toBe('pending');
  } finally { s.dispose?.(); }
});
