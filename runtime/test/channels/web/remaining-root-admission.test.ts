import '../../helpers.js';
import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { withTempWorkspaceEnv } from '../../helpers.js';
import { getRuntimeConfigPaths } from '../../../src/core/config.js';
import * as db from '../../../src/db.js';
import * as keychain from '../../../src/secure/keychain.js';
import { WebChannel } from '../../../src/channels/web.js';
import { createWebAgentControlPlaneService } from '../../../src/channels/web/agent/agent-control-plane-service.js';
import { isProviderReadyOobeCompletedForInstance } from '../../../src/channels/web/oobe-instance-state.js';
import { listScheduledTasks } from '../../../src/scheduled-task-query-service.js';

const request = (path: string, body?: unknown, method = 'POST', signal?: AbortSignal) => new Request('http://fixture' + path, {
  method, signal, headers: { 'Content-Type': 'application/json', Origin: 'http://fixture' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
function fixture(path?: string) {
  db.closeDatabase(); db.initDatabase({ ...getRuntimeConfigPaths(), ...(path ? { databasePath: path } : {}) });
  keychain.setKeyMaterialProviderForTests({ getKeyMaterial: () => new TextEncoder().encode('owned-synthetic-key-material-only') });
  const channel = new WebChannel({ queue: { enqueue() {} }, agentPool: {} } as any);
  return { root: db.getDb(), channel };
}
const seed = () => db.storeMessage({ id: 'preserve-post-identity', chat_jid: 'web:default', sender: 'user', sender_name: 'User', content: 'owned fixture', timestamp: '2026-01-01', is_from_me: false, is_bot_message: false });
for (const action of ['keychain-set', 'keychain-delete', 'keychain-notes', 'post-delete', 'oobe'] as const) test(`remaining live ${action} yields to WAL before changing SQL`, () =>
  withTempWorkspaceEnv('remaining-root-wal-', {}, async ws => {
    const path = join(ws.store, 'root.sqlite'), f = fixture(path), row = seed();
    if (action.startsWith('keychain')) await keychain.setKeychainEntry({ name: 'fixture-only', type: 'secret', secret: 'synthetic-only' });
    const blocker = new Database(path), before = f.root.serialize(); blocker.exec('BEGIN IMMEDIATE'); let settled = false;
    const start = performance.now();
    let pending: Promise<Response>;
    if (action === 'post-delete') pending = Promise.resolve().then(() => f.channel.handleDeletePost(request('/post/' + row, undefined, 'DELETE'), row, false));
    else if (action === 'oobe') {
      const service = createWebAgentControlPlaneService(f.channel as any, { defaultChatJid: 'web:default', defaultAgentId: 'default' });
      pending = service.handleAgentOobeComplete(request('/agent/oobe-complete', { kind: 'provider-ready' }));
    } else pending = f.channel.handleRequest(request(action === 'keychain-notes' ? '/agent/keychain/notes' : '/agent/keychain',
      { name: 'fixture-only', type: 'secret', secret: 'updated-synthetic-only', userNote: 'fixture note' }, action === 'keychain-delete' ? 'DELETE' : 'POST'));
    const observed = pending.then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
    try {
      await Bun.sleep(35); expect(performance.now() - start).toBeLessThan(500); expect(settled).toBe(false); expect(f.root.serialize()).toEqual(before);
      blocker.exec('ROLLBACK'); const result = await observed; expect('error' in result).toBe(false); if ('value' in result) expect(result.value.status).toBe(200);
    } finally { if (blocker.inTransaction) blocker.exec('ROLLBACK'); await observed; blocker.close(); await db.closeDatabase(); keychain.setKeyMaterialProviderForTests(null); }
  }), 12_000);

test('OOBE automatic completion is sticky even after the last history message is removed', () =>
  withTempWorkspaceEnv('oobe-reader-', {}, async () => {
    const f = fixture(); seed();
    try { expect(await isProviderReadyOobeCompletedForInstance()).toBe(true); f.root.exec("DELETE FROM messages"); expect(await isProviderReadyOobeCompletedForInstance()).toBe(true); }
    finally { await db.closeDatabase(); keychain.setKeyMaterialProviderForTests(null); }
  }));

test('scheduled task snapshot reads do not reserve the writer under WAL', () =>
  withTempWorkspaceEnv('scheduled-reader-wal-', {}, async ws => {
    const path = join(ws.store, 'root.sqlite'), f = fixture(path), blocker = new Database(path);
    db.createTask({ id: 'readonly-snapshot', chat_jid: 'web:default', prompt: 'fixture only', model: null, task_kind: 'agent', command: null, cwd: null, timeout_sec: null, schedule_type: 'once', schedule_value: '2099-01-01T00:00:00.000Z', next_run: '2099-01-01T00:00:00.000Z', status: 'active', created_at: '2026-01-01T00:00:00.000Z' });
    blocker.exec('BEGIN IMMEDIATE'); const start = performance.now();
    try { expect(listScheduledTasks().tasks.map(task => task.id)).toEqual(['readonly-snapshot']); expect(performance.now() - start).toBeLessThan(500); }
    finally { blocker.exec('ROLLBACK'); blocker.close(); await db.closeDatabase(); keychain.setKeyMaterialProviderForTests(null); }
  }), 12_000);
