import '../../helpers.js';
import { expect, spyOn, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { copyFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { withTempWorkspaceEnv } from '../../helpers.js';
import { getRuntimeConfigPaths } from '../../../src/core/config.js';
import { WebChannel } from '../../../src/channels/web.js';
import * as db from '../../../src/db.js';
import * as messages from '../../../src/db/messages.js';

const chat = 'web:post-admission';
function fixture(path?: string, media = false) {
  db.closeDatabase(); db.initDatabase({ ...getRuntimeConfigPaths(), ...(path ? { databasePath: path } : {}) });
  db.storeChatMetadata(chat, '2026-01-01T00:00:00Z');
  const id = db.storeMessage({ id: 'original', chat_jid: chat, sender: 'agent', sender_name: 'Fixture', content: 'before',
    timestamp: '2026-01-01T00:00:00Z', is_bot_message: true, is_from_me: false });
  const channel = new WebChannel({ queue: { enqueue() { throw Error('No provider replay'); } }, agentPool: {} } as any);
  const events: unknown[] = [];
  channel.interactionBroadcaster.broadcastInteractionUpdated = row => { expect(db.getDb().inTransaction).toBe(false); events.push(row); };
  let mediaId: number | undefined;
  if (media) {
    mediaId = db.createMedia('attachment.txt', 'text/plain', new TextEncoder().encode('attachmentneedle attachment body'));
    db.attachMediaToMessage(id, [mediaId]);
  }
  return { channel, id, mediaId, events };
}
const request = (annotations = false, signal?: AbortSignal) => new Request(`http://fixture/post/1?chat_jid=${encodeURIComponent(chat)}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, signal,
  body: JSON.stringify(annotations ? { annotations: [{ id: 'new' }] } : { content: 'after', thread_id: 1 }),
});
const edit = (f: ReturnType<typeof fixture>, req: Request, annotations: boolean) => annotations
  ? f.channel.handleUpdatePostAnnotations(req, f.id) : f.channel.handleUpdatePost(req, f.id);

for (const annotations of [false, true]) for (const outcome of ['cancel', 'archive', 'row', 'file'] as const)
  test(`held WAL post edit yields and rejects ${outcome}; annotations ${annotations}`, () =>
    withTempWorkspaceEnv('post-edit-wal-', {}, async ws => {
      const path = join(ws.store, 'posts.sqlite'), f = fixture(path), root = db.getDb();
      root.exec('PRAGMA busy_timeout=200'); // Fixture-owned policy, unchanged by admission.
      const blocker = new Database(path), controller = new AbortController();
      let pending: Promise<Response | Error> | undefined, settled = false, beats = 0, moved = false;
      const timer = setInterval(() => { beats++; }, 5);
      try {
        blocker.exec('BEGIN IMMEDIATE');
        pending = edit(f, request(annotations, controller.signal), annotations)
          .then(value => { settled = true; return value; }, error => { settled = true; return error; });
        await Bun.sleep(45); expect(settled).toBe(false); expect(beats).toBeGreaterThan(1); expect(f.events).toEqual([]);
        if (outcome === 'cancel') controller.abort(Error('cancelled edit'));
        else if (outcome === 'file') {
          renameSync(path, path + '.owned-original'); moved = true; copyFileSync(path + '.owned-original', path);
        } else {
          if (outcome === 'archive') blocker.query('UPDATE chat_branches SET archived_at=? WHERE chat_jid=?').run('2026-01-02', chat);
          else blocker.query('UPDATE messages SET id=? WHERE rowid=?').run('replacement', f.id);
          blocker.exec('COMMIT');
        }
        expect(await pending).toBeInstanceOf(Error);
        if (outcome === 'cancel' || outcome === 'file') expect(blocker.inTransaction).toBe(true);
        expect(db.getMessageByRowId(chat, f.id)!.data.content).toBe('before');
        expect(messages.getMessageAnnotations(chat, f.id)).toBeNull(); expect(f.events).toEqual([]);
        expect(root.query('PRAGMA busy_timeout').get()).toEqual({ timeout: 200 });
      } finally {
        clearInterval(timer); controller.abort();
        if (moved) { unlinkSync(path); renameSync(path + '.owned-original', path); }
        if (blocker.inTransaction) blocker.exec('ROLLBACK');
        await Promise.allSettled(pending ? [pending] : []); blocker.close(); db.closeDatabase();
      }
    }));

for (const annotations of [false, true]) test(`media FTS and links survive the last edit trigger; annotations ${annotations}`, () =>
  withTempWorkspaceEnv('post-edit-media-', {}, async () => {
    const f = fixture(undefined, true);
    try {
      const response = await edit(f, request(annotations), annotations);
      expect(response.status).toBe(200);
      expect(db.getDb().query("SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'attachmentneedle'").all()).toEqual([{ rowid: f.id }]);
      expect(db.getMediaIdsForMessage(f.id)).toEqual([f.mediaId!]);
      db.getDb().exec("INSERT INTO messages_fts(messages_fts) VALUES('integrity-check')");
    } finally { db.closeDatabase(); }
  }));

for (const annotations of [false, true]) test(`failed in-transaction readback rolls back edits, media and FTS; annotations ${annotations}`, () =>
  withTempWorkspaceEnv('post-edit-readback-', {}, async () => {
    const f = fixture(undefined, true), root = db.getDb(), prepare = root.prepare.bind(root);
    const before = db.getMessageByRowId(chat, f.id), fault = Object.assign(Error('readback unavailable'), { code: 'SQLITE_BUSY' });
    let readbacks = 0;
    root.prepare = ((sql: string) => {
      if (sql.startsWith('SELECT rowid, chat_jid, sender, sender_name, content,')) { readbacks++; throw fault; }
      return prepare(sql);
    }) as typeof root.prepare;
    try {
      try { await expect(edit(f, request(annotations), annotations)).rejects.toBe(fault); }
      finally { root.prepare = prepare; }
      expect(readbacks).toBe(1);
      expect(db.getMessageByRowId(chat, f.id)).toEqual(before); expect(f.events).toEqual([]);
      expect(db.getMediaIdsForMessage(f.id)).toEqual([f.mediaId!]);
      expect(root.query("SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'attachmentneedle'").all()).toEqual([{ rowid: f.id }]);
      root.exec("INSERT INTO messages_fts(messages_fts) VALUES('integrity-check')");
    } finally { root.prepare = prepare; db.closeDatabase(); }
  }));

for (const observer of ['SSE', 'SSE and logger'] as const) test(`committed content edit stays200 after optional ${observer} failure`, () =>
  withTempWorkspaceEnv('post-edit-publication-', {}, async () => {
    const f = fixture(), controller = new AbortController();
    f.channel.interactionBroadcaster.broadcastInteractionUpdated = () => { controller.abort(Error('late abort after commit')); throw Error('observer unavailable'); };
    const hook = observer === 'SSE and logger' ? spyOn(process.stderr, 'write').mockImplementation(() => { throw Error('diagnostic stream unavailable'); }) : undefined;
    let result: Response | Error;
    try { result = await f.channel.handleUpdatePost(request(false, controller.signal), f.id).catch(error => error); }
    finally { hook?.mockRestore(); }
    try { expect(result).toBeInstanceOf(Response); expect((result as Response).status).toBe(200); expect(db.getMessageByRowId(chat, f.id)!.data.content).toBe('after'); }
    finally { db.closeDatabase(); }
  }));

for (const annotations of [false, true]) test(`post edit refuses inherited transaction ownership; annotations ${annotations}`, () =>
  withTempWorkspaceEnv('post-edit-outer-', {}, async () => {
    const f = fixture(); let observed!: Promise<unknown>;
    try {
      expect(() => db.getDb().transaction(() => {
        observed = edit(f, request(annotations), annotations).then(value => value, error => error);
        throw Error('outer rollback');
      }).immediate()).toThrow('outer rollback');
      expect(String(await observed)).toContain('own transaction');
      expect(db.getMessageByRowId(chat, f.id)!.data.content).toBe('before'); expect(messages.getMessageAnnotations(chat, f.id)).toBeNull();
      expect(f.events).toEqual([]);
    } finally { await Promise.allSettled(observed ? [observed] : []); db.closeDatabase(); }
  }));
