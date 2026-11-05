import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { createTempWorkspace, setEnv } from '../../helpers.js';
import { assertPathWithinTestFilesystemIsolation } from '../../../scripts/test-filesystem-isolation.js';
import * as db from '../../../src/db.js';
import { getDatabaseBinding } from '../../../src/db/connection.js';
import { MediaService } from '../../../src/channels/web/media/media-service.js';
import { installServiceWorkSchema } from '../../../src/service-effects/current-piclaw/service-work-schema.js';
import { createCurrentPiclawServiceWorkStore } from '../../../src/service-effects/current-piclaw/service-work-store.js';
import { hashCanonicalRequest, type CanonicalJsonValue } from '../../../src/service-effects/contracts/common.js';

let ws: ReturnType<typeof createTempWorkspace>;
let restore: () => void;
let database: Database;
let blocker: Database;
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
