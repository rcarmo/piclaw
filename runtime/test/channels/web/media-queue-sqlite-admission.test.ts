import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { createTempWorkspace, setEnv } from '../../helpers.js';
import { assertPathWithinTestFilesystemIsolation } from '../../../scripts/test-filesystem-isolation.js';
import * as db from '../../../src/db.js';
import { getDatabaseBinding } from '../../../src/db/connection.js';
import { MediaService } from '../../../src/channels/web/media/media-service.js';
import { QueuedFollowupLifecycleService, type QueuedInputSourceAdmission } from '../../../src/channels/web/runtime/queued-followup-lifecycle-service.js';
import { installServiceWorkSchema } from '../../../src/service-effects/current-piclaw/service-work-schema.js';
import { createCurrentPiclawServiceWorkStore } from '../../../src/service-effects/current-piclaw/service-work-store.js';
import { hashCanonicalRequest, type CanonicalJsonValue } from '../../../src/service-effects/contracts/common.js';

let ws: ReturnType<typeof createTempWorkspace>;
let restore: () => void;
let database: Database;
let blocker: Database;
let service: QueuedFollowupLifecycleService;
beforeEach(async () => {
  ws = createTempWorkspace('media-queue-admission-');
  assertPathWithinTestFilesystemIsolation(ws.store, process.env, { allowRoot: false });
  await db.closeDatabase();
  restore = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data, PICLAW_DB_IN_MEMORY: '0' });
  // Bind this fixture's own store before opening its competing WAL writer.
  process.env.PICLAW_DB_IN_MEMORY = '0';
  db.initDatabase();
  database = db.getDb();
  const file = (database.query('PRAGMA database_list').all() as { name: string; file: string }[]).find(row => row.name === 'main')!.file;
  expect(file).toBe(join(ws.store, 'messages.db'));
  expect(getDatabaseBinding()?.path).toBe(file);
  assertPathWithinTestFilesystemIsolation(file, process.env, { allowRoot: false });
  expect(database.query('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
  blocker = new Database(file);
  expect((blocker.query('PRAGMA database_list').all() as { name: string; file: string }[]).find(row => row.name === 'main')!.file).toBe(file);
  database.exec('CREATE TABLE fixture_grants(media_id INTEGER PRIMARY KEY REFERENCES media(id));');
  service = new QueuedFollowupLifecycleService();
});
afterEach(async () => {
  blocker?.close();
  await db.closeDatabase();
  restore?.();
  ws?.cleanup();
});
const mediaCount = () => (database.query('SELECT count(*) AS n FROM media').get() as { n: number }).n;
const policy = () => database.query('PRAGMA busy_timeout').get();
const snapshot = () => ['router_state', 'chat_cursors', 'messages', 'media', 'fixture_grants'].map(table => database.query(`SELECT * FROM ${table} ORDER BY rowid`).all());

for (const kind of ['file', 'path'] as const) {
  test(`${kind} media waits without blocking the event loop, then commits once`, async () => {
    const media = new MediaService();
    const path = join(ws.data, 'input.txt');
    writeFileSync(path, 'owned fixture');
    const original = policy();
    let grants = 0;
    let checks = 0;
    blocker.exec('BEGIN IMMEDIATE');
    const admission = { authorise() { checks++; } };
    const pending = kind === 'file'
      ? media.createFromFile(new File(['owned fixture'], 'input.txt'), database, id => {
        expect(database.inTransaction).toBe(true);
        database.query('INSERT INTO fixture_grants VALUES(?)').run(id);
        grants++;
      }, admission)
      : media.createFromPath(path, undefined, undefined, admission);
    await Bun.sleep(10);
    expect(mediaCount()).toBe(0);
    expect(grants).toBe(0);
    expect(checks).toBe(0);
    expect(policy()).toEqual(original);
    blocker.exec('ROLLBACK');
    expect((await pending).status).toBe(200);
    expect(mediaCount()).toBe(1);
    expect(grants).toBe(kind === 'file' ? 1 : 0);
    expect(checks).toBe(2);
    expect(database.inTransaction).toBe(false);
    expect(policy()).toEqual(original);
  });

  for (const denial of ['cancel', 'revoke', 'after'] as const) {
    test(`${kind} media ${denial} leaves no blob or grant`, async () => {
      const media = new MediaService();
      const path = join(ws.data, 'input.txt');
      writeFileSync(path, 'owned fixture');
      const controller = new AbortController();
      let allowed = true;
      const before = snapshot();
      const original = policy();
      let calls = 0;
      const admission = { signal: controller.signal, authorise(phase: 'before' | 'after') {
        if (!allowed || (denial === 'after' && phase === 'after')) throw Error('revoked');
      } };
      blocker.exec('BEGIN IMMEDIATE');
      const pending = kind === 'file'
        ? media.createFromFile(new File(['owned fixture'], 'input.txt'), database, id => {
          calls++; database.query('INSERT INTO fixture_grants VALUES(?)').run(id);
        }, admission)
        : media.createFromPath(path, undefined, undefined, admission);
      await Bun.sleep(10);
      expect(calls).toBe(0);
      if (denial === 'cancel') controller.abort(Error('cancelled'));
      if (denial === 'revoke') allowed = false;
      blocker.exec('ROLLBACK');
      await expect(pending).rejects.toThrow(denial === 'cancel' ? 'cancelled' : 'revoked');
      expect(calls).toBe(kind === 'file' && denial === 'after' ? 1 : 0);
      expect(snapshot()).toEqual(before);
      expect(policy()).toEqual(original);
      expect(database.inTransaction).toBe(false);
    });
  }
}

test('media ownership callback busy is terminal and rolls back both grant and blob', async () => {
  const before = snapshot();
  let calls = 0;
  const busy = Object.assign(Error('grant busy'), { code: 'SQLITE_BUSY' });
  await expect(new MediaService().createFromFile(new File(['payload'], 'input.txt'), database, id => {
    calls++;
    database.query('INSERT INTO fixture_grants VALUES(?)').run(id);
    throw busy;
  })).rejects.toBe(busy);
  expect(calls).toBe(1);
  expect(snapshot()).toEqual(before);
});

test('media captures the singleton before file IO awaits and refuses a redirected binding', async () => {
  const file = new File(['payload'], 'input.txt');
  let release!: (buffer: ArrayBuffer) => void;
  file.arrayBuffer = () => new Promise(resolve => { release = resolve; });
  const before = snapshot();
  const pending = new MediaService().createFromFile(file);
  const undo = setEnv({ PICLAW_WORKSPACE: join(ws.workspace, 'redirected') });
  try {
    release(new Uint8Array([1, 2]).buffer);
    await expect(pending).rejects.toThrow('binding changed');
  } finally { undo(); }
  expect(snapshot()).toEqual(before);
});

function seal<T extends { effect: { requestHash: string } }>(request: T, method?: string): T {
  request.effect.requestHash = hashCanonicalRequest((method ? { method, ...request } : request) as unknown as CanonicalJsonValue);
  return request;
}
async function acceptedFixture() {
  installServiceWorkSchema(database);
  const made = createCurrentPiclawServiceWorkStore(database, { hitFault: () => false, recordTrace() {}, validateAcceptance: () => true });
  if (!made.ok) throw Error('work fixture');
  const work = made.value;
  const effect = (id: string) => ({ idempotencyKey: id, requestHash: '', operationId: null, sourceSeq: null,
    provenanceRef: 'host:queue', redactionClass: 'private' as const });
  const accept: QueuedInputSourceAdmission = ({ chatJid, item, database }) => {
    work.acceptSourceInTransaction(seal({ effect: effect(`accept:${item.source_id}`), chatJid, sourceId: item.source_id,
      kind: 'message', payloadRef: `queued-source:${item.source_id}`, targetOperationId: null, parentSourceSeq: null,
      acceptedAt: item.queuedAt, createWakeIntent: false }), database);
  };
  db.storeChatMetadata('web:default', '2024-01-01T00:00:00.000Z', 'Web');
  const rowId = db.storeMessage({ id: 'timeline', chat_jid: 'web:default', sender: 'web', sender_name: 'Web',
    content: 'same text', timestamp: '2024-01-01T00:00:00.000Z', is_from_me: false, is_bot_message: false });
  for (const [chat, id, source] of [['web:default', rowId, undefined], ['web:default', 0, undefined],
    ['web:default', 0, 'auto-protected-recovery-continuation'], ['web:foreign', 0, undefined]] as const) {
    await service.admitQueuedFollowupItem([chat, id, 'same text', null, undefined, { source }], () => {}, new AbortController().signal, accept);
  }
  const withdraw: QueuedInputSourceAdmission = ({ chatJid, item, database: captured }) => {
    expect(captured).toBe(database);
    expect(captured.inTransaction).toBe(true);
    const { source_hash: sourceHash } = database.query('SELECT source_hash FROM service_effect_s01_sources WHERE chat_jid=? AND source_id=?')
      .get(chatJid, item.source_id) as { source_hash: string };
    work.withdrawUnclaimedSourceInTransaction(seal({ effect: effect(`withdraw:${item.source_id}`), chatJid,
      sourceId: item.source_id, sourceHash, payloadRef: `queued-source:${item.source_id}`, actor: 'single-user' }, 'withdrawUnclaimedSource.v1'), captured);
  };
  const all = () => [snapshot(), ...['sources', 'chats', 'operations', 'intents', 'decisions', 'wake_intents']
    .map(table => database.query(`SELECT * FROM service_effect_s01_${table} ORDER BY rowid`).all())];
  return { rowId, withdraw, all };
}

for (const action of ['withdraw', 'reorder'] as const) {
  for (const outcome of ['success', 'cancel', 'revoke', 'after'] as const) {
    test(`${action} under owned WAL lock: ${outcome} preserves identities, foreign queue and frontier`, async () => {
      const { rowId, withdraw, all } = await acceptedFixture();
      const beforeQueue = service.getQueuedFollowupItems('web:default');
      const foreign = service.getQueuedFollowupItems('web:foreign');
      const before = all();
      const original = policy();
      const controller = new AbortController();
      let allowed = true;
      let calls = 0;
      const options = { signal: controller.signal, authorise(phase: 'before' | 'after') {
        if (!allowed || (outcome === 'after' && phase === 'after')) throw Error('revoked');
      }, withdrawAcceptedSource: ((stored) => { calls++; withdraw(stored); }) as QueuedInputSourceAdmission };
      blocker.exec('BEGIN IMMEDIATE');
      const pending = action === 'withdraw'
        ? service.removeQueuedFollowupForAction('web:default', rowId, options)
        : service.reorderQueuedFollowupItems('web:default', 2, 1, options);
      await Bun.sleep(10);
      expect(all()).toEqual(before);
      expect(calls).toBe(0);
      expect(policy()).toEqual(original);
      if (outcome === 'cancel') controller.abort(Error('cancelled'));
      if (outcome === 'revoke') allowed = false;
      blocker.exec('ROLLBACK');
      if (outcome === 'success') {
        await pending;
        expect(service.getQueuedFollowupItems('web:default')).toEqual(action === 'withdraw'
          ? beforeQueue.filter(item => item.rowId !== rowId) : [beforeQueue[0], beforeQueue[2], beforeQueue[1]]);
        if (action === 'reorder') expect(service.getPendingQueuedSourceOrder('web:default')).toEqual(
          [beforeQueue[0], beforeQueue[2], beforeQueue[1]].map(item => item!.source_id!));
        expect(db.getMessageByRowId('web:default', rowId) === undefined).toBe(action === 'withdraw');
      } else {
        await expect(pending).rejects.toThrow(outcome === 'cancel' ? 'cancelled' : 'revoked');
        expect(all()).toEqual(before);
        expect(service.getQueuedFollowupItems('web:default')).toEqual(beforeQueue);
      }
      expect(calls).toBe(action === 'withdraw' && (outcome === 'after' || outcome === 'success') ? 1 : 0);
      expect(service.getQueuedFollowupItems('web:foreign')).toEqual(foreign);
      expect(database.inTransaction).toBe(false);
      expect(policy()).toEqual(original);
      // Neither operation consumes an allocation, even on post-write rollback.
      const next = service.enqueueQueuedFollowupItem('web:default', 0, 'next');
      expect(next).toBe(Math.min(...beforeQueue.map(item => item.rowId)) - 1);
    });
  }
}

test('withdrawal does not act on an accepted source that reused the selected row while waiting', async () => {
  const { rowId, withdraw } = await acceptedFixture();
  let calls = 0;
  blocker.exec('BEGIN IMMEDIATE');
  const pending = service.removeQueuedFollowupForAction('web:default', rowId, {
    withdrawAcceptedSource(stored) { calls++; withdraw(stored); },
  });
  // The external writer changes identity without going through this service.
  const rows = db.getDeferredQueuedFollowups('web:default').map(item => item.rowId === rowId ? { ...item, source_id: 'source-replacement' } : item);
  blocker.query('UPDATE chat_cursors SET queued_followups_json=? WHERE chat_jid=?').run(JSON.stringify(rows), 'web:default');
  blocker.exec('COMMIT');
  await expect(pending).rejects.toThrow('unavailable');
  expect(calls).toBe(0);
  expect(db.getDeferredQueuedFollowups('web:default')).toEqual(rows);
  expect(db.getMessageByRowId('web:default', rowId)).toBeDefined();
});
