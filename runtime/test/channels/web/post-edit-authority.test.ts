import '../../helpers.js';
import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { createTempWorkspace, setEnv, withTempWorkspaceEnv } from '../../helpers.js';
import { getRuntimeConfigPaths } from '../../../src/core/config.js';
import { WebChannel } from '../../../src/channels/web.js';
import * as db from '../../../src/db.js';

const chat = 'web:post-authority';
async function fixture(path?: string, content = 'before', id = 'original') {
  await db.closeDatabase(); db.initDatabase({ ...getRuntimeConfigPaths(), ...(path ? { databasePath: path } : {}) });
  db.storeChatMetadata(chat, '2026-01-01');
  const row = db.storeMessage({ id, chat_jid: chat, sender: 'agent', sender_name: 'Fixture', content, timestamp: '2026-01-01', is_from_me: false, is_bot_message: true });
  return { row, channel: new WebChannel({ queue: { enqueue() { throw Error('No input execution'); } }, agentPool: {} } as any) };
}
const request = (annotations = false) => new Request(`http://fixture/post/1?chat_jid=${chat}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(annotations ? { annotations: [{ id: 'new' }] } : { content: 'must not write' }),
});

for (const annotations of [false, true]) for (const change of ['principal', 'gateway', 'database', 'profile'] as const)
  test(`post ${change} is fenced across JSON; annotations ${annotations}`, () =>
    withTempWorkspaceEnv('post-authority-', {}, async () => {
      const f = await fixture(), req = request(annotations), json = req.json.bind(req);
      let principal: any = { kind: 'user', userId: 'fixture', mode: 'single-user', role: 'admin', authentication: { method: 'cookie', sessionId: 'synthetic' } };
      if (change === 'principal') f.channel.authGateway = { isAuthEnabled: () => true, getPrincipal: () => principal } as any;
      const other = change === 'profile' ? createTempWorkspace('post-other-profile-') : undefined;
      let restore: (() => void) | undefined;
      req.json = async () => {
        if (change === 'principal') principal = null;
        if (change === 'gateway') f.channel.authGateway = {} as any;
        if (change === 'database') expect((await fixture(undefined, 'replacement profile', 'replacement')).row).toBe(f.row);
        if (other) restore = setEnv({ PICLAW_WORKSPACE: other.workspace, PICLAW_STORE: other.store, PICLAW_DATA: other.data });
        return json();
      };
      try {
        const result = await (annotations ? f.channel.handleUpdatePostAnnotations(req, f.row) : f.channel.handleUpdatePost(req, f.row)).catch(error => error);
        expect(result).toBeInstanceOf(Error);
        expect(db.getMessageByRowId(chat, f.row)!.data.content).toBe(change === 'database' ? 'replacement profile' : 'before');
        expect(db.getMessageByRowId(chat, f.row)!.data.annotations).toBeUndefined();
      } finally { restore?.(); await db.closeDatabase(); other?.cleanup(); }
    }));

test('internal post keeps the original database across JSON instead of adopting a replacement profile', () =>
  withTempWorkspaceEnv('internal-post-database-', {}, async () => {
    const f = await fixture(), req = new Request(`http://fixture/internal/post?chat_jid=${chat}`, { method: 'POST' });
    req.json = async () => { await fixture(undefined, 'replacement profile', 'replacement'); return { content: 'must not post to replacement' }; };
    try {
      await expect(f.channel.handleInternalPost(req)).rejects.toThrow('database binding changed');
      expect(db.getDb().query('SELECT content FROM messages').all()).toEqual([{ content: 'replacement profile' }]);
    } finally { await db.closeDatabase(); }
  }));

test('annotation input and response retain the parsed snapshot while acquisition waits', () =>
  withTempWorkspaceEnv('annotation-snapshot-', {}, async ws => {
    const path = join(ws.store, 'annotation.sqlite'), f = await fixture(path), blocker = new Database(path);
    const body = { annotations: [{ id: 'original' }] }, req = request(true); req.json = async () => body;
    let pending: Promise<Response> | undefined;
    try {
      blocker.exec('BEGIN IMMEDIATE'); pending = f.channel.handleUpdatePostAnnotations(req, f.row);
      await Bun.sleep(30); body.annotations[0]!.id = 'replacement'; blocker.exec('ROLLBACK');
      const result = await pending;
      expect((await result.json()).annotations).toEqual([{ id: 'original' }]);
      expect(db.getMessageByRowId(chat, f.row)!.data.annotations).toEqual([{ id: 'original' }]);
    } finally { if (blocker.inTransaction) blocker.exec('ROLLBACK'); await Promise.allSettled(pending ? [pending] : []); blocker.close(); await db.closeDatabase(); }
  }));

test('a transaction opened between acquisition attempts cannot be acknowledged as a committed edit', () =>
  withTempWorkspaceEnv('post-between-attempts-', {}, async ws => {
    const path = join(ws.store, 'outer.sqlite'), f = await fixture(path), blocker = new Database(path), root = db.getDb();
    let pending: Promise<unknown> | undefined;
    try {
      blocker.exec('BEGIN IMMEDIATE'); pending = f.channel.handleUpdatePost(request(), f.row).then(value => value, error => error);
      await Bun.sleep(30); root.exec('BEGIN');
      expect(String(await pending)).toContain('own transaction'); expect(root.inTransaction).toBe(true);
      expect(db.getMessageByRowId(chat, f.row)!.data.content).toBe('before');
    } finally {
      if (root.inTransaction) root.exec('ROLLBACK'); if (blocker.inTransaction) blocker.exec('ROLLBACK');
      await Promise.allSettled(pending ? [pending] : []); blocker.close(); await db.closeDatabase();
    }
  }));

test('null edit bodies and non-string internal content produce400 without a mutation', () =>
  withTempWorkspaceEnv('post-invalid-body-', {}, async () => {
    const f = await fixture(), before = db.getDb().serialize();
    const bad = () => new Request(`http://fixture/post/1?chat_jid=${chat}`, { method: 'PATCH', body: 'null', headers: { 'Content-Type': 'application/json' } });
    try {
      expect((await f.channel.handleUpdatePost(bad(), f.row)).status).toBe(400);
      expect((await f.channel.handleUpdatePostAnnotations(bad(), f.row)).status).toBe(400);
      for (const body of [null, { content: 3 }, { content: false }]) {
        expect((await f.channel.handleInternalPost(new Request('http://fixture/internal/post', { method: 'POST', body: JSON.stringify(body) }))).status).toBe(400);
      }
      expect(db.getDb().serialize()).toEqual(before);
    } finally { await db.closeDatabase(); }
  }));
