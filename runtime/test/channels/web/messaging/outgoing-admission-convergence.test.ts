import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { withTempWorkspaceEnv, importFresh } from '../../../helpers.js';
import { getRuntimeConfigPaths } from '../../../../src/core/config.js';
import { WebChannel } from '../../../../src/channels/web.js';
import * as messages from '../../../../src/channels/web/messaging/message-store.js';

type Store = typeof import('../../../../src/db.js');
const chat = 'web:outgoing-contract';

test('incoming and outgoing rows have one admitted write recipe', () => {
  expect('admitWebUserMessage' in messages).toBe(false);
  expect('admitUserMessage' in WebChannel.prototype).toBe(false);
});

test('outgoing send yields and honours cancellation while the foreign WAL writer stays held', () =>
  withTempWorkspaceEnv('outgoing-wal-', {}, async ws => {
    const store = await importFresh<Store>('../src/db.js'); await store.closeDatabase();
    const path = join(ws.store, 'outgoing.sqlite'); store.initDatabase({ ...getRuntimeConfigPaths(), databasePath: path });
    store.storeChatMetadata(chat, '2026-11-02T00:00:00Z', 'Fixture');
    const web = new WebChannel({ queue: { enqueue() {} }, agentPool: {} } as any);
    let broadcasts = 0; web.broadcastEvent = () => { broadcasts++; };
    const blocker = new Database(path), controller = new AbortController();
    expect(store.getDb().query('PRAGMA busy_timeout').get()).toEqual({ timeout: 0 }); blocker.exec('BEGIN IMMEDIATE');
    let beats = 0; const timer = setInterval(() => { beats++; }, 5);
    const started = performance.now();
    const pending = web.sendMessage(chat, 'cancelled outgoing reply', { signal: controller.signal, requirePersistence: true } as any);
    const observed = pending.then(() => null, error => error);
    try {
      await Bun.sleep(30); controller.abort(Error('fixture cancelled'));
      expect(await observed).toBe(controller.signal.reason);
      expect(performance.now() - started).toBeLessThan(500); expect(beats).toBeGreaterThan(0);
      expect(blocker.inTransaction).toBe(true); expect(broadcasts).toBe(0);
      expect(store.getDb().query('SELECT id FROM messages WHERE chat_jid=?').all(chat)).toEqual([]);
      expect(store.getDb().query('PRAGMA busy_timeout').get()).toEqual({ timeout: 0 });
    } finally { clearInterval(timer); if (blocker.inTransaction) blocker.exec('ROLLBACK'); await observed; blocker.close(); await store.closeDatabase(); }
  }));

test('admitted outgoing rows cannot adopt an archived target while waiting for SQL', () =>
  withTempWorkspaceEnv('outgoing-target-', {}, async ws => {
    const store = await importFresh<Store>('../src/db.js'); await store.closeDatabase();
    const path = join(ws.store, 'target.sqlite'); store.initDatabase({ ...getRuntimeConfigPaths(), databasePath: path });
    store.storeChatMetadata(chat, '2026-11-02T00:00:00Z', 'Fixture');
    const blocker = new Database(path); blocker.exec('BEGIN IMMEDIATE');
    const pending = messages.admitWebMessage({} as any, { chatJid: chat, content: 'obsolete target', isBot: true,
      mediaIds: [], agentId: 'default', agentName: 'Fixture' }, {}, () => {}, new AbortController().signal);
    const observed = pending.then(() => null, error => error);
    try {
      await Bun.sleep(20);
      blocker.query('UPDATE chat_branches SET archived_at=? WHERE chat_jid=?').run('2026-11-02T00:01:00Z', chat);
      blocker.exec('COMMIT');
      expect(await observed).toBeInstanceOf(Error);
      expect(store.getDb().query('SELECT id FROM messages WHERE chat_jid=?').all(chat)).toEqual([]);
    } finally { if (blocker.inTransaction) blocker.exec('ROLLBACK'); await observed; blocker.close(); await store.closeDatabase(); }
  }));

test('publication admission rejects inherited transactions instead of acknowledging a rolled-back savepoint', () =>
  withTempWorkspaceEnv('outgoing-outer-transaction-', {}, async () => {
    const store = await importFresh<Store>('../src/db.js'); await store.closeDatabase(); store.initDatabase(getRuntimeConfigPaths());
    let pending!: Promise<unknown>;
    try {
      expect(() => store.getDb().transaction(() => {
        pending = messages.admitWebMessage({ broadcastEvent() {} } as any, { chatJid: chat, content: 'must not acknowledge', isBot: true,
          mediaIds: [], agentId: 'default', agentName: 'Fixture' }, {});
        throw Error('outer rollback');
      }).immediate()).toThrow('outer rollback');
      await expect(pending).rejects.toThrow('own transaction');
      expect(store.getDb().query('SELECT id FROM messages WHERE chat_jid=?').all(chat)).toEqual([]);
    } finally { await Promise.allSettled(pending ? [pending] : []); await store.closeDatabase(); }
  }));

test('the synchronous web writer and public forwarding chain are retired', async () => {
  const { WebChannel } = await import('../../../../src/channels/web.js');
  expect(messages).not.toHaveProperty('storeWebMessage');
  expect(WebChannel.prototype).not.toHaveProperty('storeMessage');
});
