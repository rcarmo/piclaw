import '../../../helpers.js';
import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { withTempWorkspaceEnv, importFresh } from '../../../helpers.js';
import { getRuntimeConfigPaths } from '../../../../src/core/config.js';
import { WebChannel } from '../../../../src/channels/web.js';
type Store = typeof import('../../../../src/db.js');

for (const outcome of ['cancel', 'archive'] as const) test(`queued HTTP admission yields under held WAL and rejects ${outcome} without a raw write`, () =>
  withTempWorkspaceEnv('queued-admission-wal-', {}, async ws => {
    const db = await importFresh<Store>('../src/db.js'); db.closeDatabase();
    const path = join(ws.store, 'queued.sqlite'), chat = 'web:queued-wal';
    db.initDatabase({ ...getRuntimeConfigPaths(), databasePath: path });
    db.storeChatMetadata(chat, '2026-01-01T00:00:00Z');
    db.ensureChatBranch({ chat_jid: chat, agent_name: 'fixture' });
    const policy = db.getDb().query('PRAGMA busy_timeout').get();
    const channel = new WebChannel({ queue: { enqueue() { throw Error('No input execution'); } },
      agentPool: { isActive: () => true, isStreaming: () => true } } as any);
    const events: string[] = []; channel.broadcastEvent = event => { events.push(event); };
    const blocker = new Database(path), controller = new AbortController();
    let pending: Promise<Response> | undefined, settled = false, beats = 0;
    const timer = setInterval(() => { beats++; }, 5);
    try {
      blocker.exec('BEGIN IMMEDIATE');
      const req = new Request(`http://fixture/agent/default/message?chat_jid=${chat}`, { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'must not be accepted', mode: 'queue' }) });
      pending = channel.handleAgentMessage(req, '/agent/default/message').then(response => { settled = true; return response; });
      await Bun.sleep(45); expect(settled).toBe(false); expect(beats).toBeGreaterThan(1);
      expect(events).toEqual([]); expect(channel.getQueuedFollowupCount(chat)).toBe(0);
      if (outcome === 'cancel') {
        controller.abort(Error('cancelled queued writer'));
        expect((await pending).status).toBe(400); expect(blocker.inTransaction).toBe(true);
      } else {
        blocker.query('UPDATE chat_branches SET archived_at=? WHERE chat_jid=?').run('2026-01-02T00:00:00Z', chat);
        blocker.exec('COMMIT');
        expect((await pending).status).toBe(403);
      }
      expect(db.getDb().query('SELECT id FROM messages WHERE chat_jid=?').all(chat)).toEqual([]);
      expect(db.getDeferredQueuedFollowups(chat)).toEqual([]); expect(events).toEqual([]);
      expect(db.getDb().query('PRAGMA busy_timeout').get()).toEqual(policy);
    } finally {
      clearInterval(timer); controller.abort(); if (blocker.inTransaction) blocker.exec('ROLLBACK');
      await Promise.allSettled(pending ? [pending] : []); blocker.close(); db.closeDatabase();
    }
  }));

test('a source callback cannot replace the queued target lifetime inside the transaction', () =>
  withTempWorkspaceEnv('queued-callback-lifetime-', {}, async () => {
    const db = await importFresh<Store>('../src/db.js'); db.closeDatabase(); db.initDatabase(getRuntimeConfigPaths());
    const chat = 'web:queued-callback';
    db.storeChatMetadata(chat, '2026-01-01T00:00:00Z'); const branch = db.ensureChatBranch({ chat_jid: chat, agent_name: 'fixture' });
    const channel = new WebChannel({ queue: { enqueue() {} }, agentPool: {} } as any);
    let entered = 0;
    try {
      await expect(channel.admitQueuedFollowupItem([chat, 0, 'unchanged original payload'], () => {}, new AbortController().signal,
        ({ database }) => { entered++; expect(database.inTransaction).toBe(true);
          database.query('UPDATE chat_branches SET branch_id=? WHERE chat_jid=?').run('changed-in-callback', chat); }))
        .rejects.toThrow('target lifetime changed');
      expect(entered).toBe(1); expect(db.getChatBranchByChatJid(chat)!.branch_id).toBe(branch.branch_id);
      expect(db.getDeferredQueuedFollowups(chat)).toEqual([]);
      expect(await channel.admitQueuedFollowupItem([chat, 0, 'next original target'], () => {}, new AbortController().signal)).toBe(-1);
    } finally { db.closeDatabase(); }
  }));
