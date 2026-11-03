import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { AgentBranchManager } from '../../src/agent-pool/branch-manager.js';
import type { PoolEntry } from '../../src/agent-pool/session-manager.js';
import { getRuntimeConfigPaths } from '../../src/core/config.js';
import { importFresh, withTempWorkspaceEnv } from '../helpers.js';

type Store = typeof import('../../src/db.js');
type Context = { signal?: AbortSignal; authorise?: () => void };
type Action = 'handle' | 'root' | 'prune';
const parent = 'web:request-parent', child = `${parent}:child`;
async function fixture(disk: boolean, run: (input: { store: Store; manager: AgentBranchManager; pool: Map<string, PoolEntry>; path: string }) => Promise<void>) {
  return withTempWorkspaceEnv('branch-request-admission-', {}, async ws => {
    const store = await importFresh<Store>('../src/db.js'); store.closeDatabase();
    const path = join(ws.store, 'branch.sqlite');
    store.initDatabase(disk ? { ...getRuntimeConfigPaths(), databasePath: path } : getRuntimeConfigPaths());
    store.storeChatMetadata(parent, '2026-01-01', 'Parent');
    store.storeChatMetadata(child, '2026-01-01', 'Child');
    store.ensureChatBranch({ chat_jid: child, root_chat_jid: parent, parent_branch_id: store.getChatBranchByChatJid(parent)!.branch_id, agent_name: 'child' });
    const pool = new Map<string, PoolEntry>();
    const manager = new AgentBranchManager({ pool, isActive: jid => pool.get(jid)?.runtime.session.isStreaming === true });
    try { await run({ store, manager, pool, path }); }
    finally { const db = store.getDb(); if (db.inTransaction) db.exec('ROLLBACK'); store.closeDatabase(); }
  });
}
function invoke(manager: AgentBranchManager, action: Action, context: Context) {
  return action === 'handle' ? manager.renameChatBranch(child, { agentName: 'changed', ...context })
    : action === 'root' ? manager.createRootChatSession('request-fresh', context) : manager.pruneChatBranch(child, context);
}
for (const action of ['handle', 'root', 'prune'] as const) {
  test(`supported branch request cancellation fences mutation before admission: ${action}`, () => fixture(false, async ({ store, manager }) => {
    const before = store.listChatBranches(null, { includeArchived: true });
    const controller = new AbortController(); controller.abort(Error('request stopped')); let checked = 0;
    await expect(invoke(manager, action, { signal: controller.signal, authorise() { checked++; } })).rejects.toThrow('request stopped');
    expect(checked).toBe(0); expect(store.listChatBranches(null, { includeArchived: true })).toEqual(before); expect(store.getDb().inTransaction).toBe(false);
  }));
  test(`supported branch mutation requires a physical outermost commit: ${action}`, () => fixture(false, async ({ store, manager }) => {
    const db = store.getDb(), before = store.listChatBranches(null, { includeArchived: true }); db.exec('BEGIN IMMEDIATE');
    try {
      await expect(invoke(manager, action, {})).rejects.toThrow('outermost');
      expect(db.inTransaction).toBe(true); expect(store.listChatBranches(null, { includeArchived: true })).toEqual(before);
    } finally { db.exec('ROLLBACK'); }
  }));
  test(`supported branch acquisition yields to foreign WAL and commits once after release: ${action}`, () => fixture(true, async ({ store, manager, path }) => {
    const blocker = new Database(path); blocker.exec('BEGIN IMMEDIATE');
    let beats = 0, settled = false; const heartbeat = setInterval(() => { beats++; }, 5), start = performance.now();
    const before = store.listChatBranches(null, { includeArchived: true });
    const pending = invoke(manager, action, {}).then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
    try {
      await Bun.sleep(40); expect(performance.now() - start).toBeLessThan(500); expect(beats).toBeGreaterThan(0); expect(settled).toBe(false);
      expect(store.listChatBranches(null, { includeArchived: true })).toEqual(before); blocker.exec('ROLLBACK');
      const result = await pending; expect('error' in result).toBe(false);
      if ('value' in result) expect(store.getChatBranchByChatJid(result.value.chat_jid)).toEqual(result.value);
    } finally { clearInterval(heartbeat); if (blocker.inTransaction) blocker.exec('ROLLBACK'); await pending; blocker.close(); }
  }), 10_000);
  test(`late cancellation/revocation cannot reject the committed metadata receipt: ${action}`, () => fixture(false, async ({ store, manager }) => {
    const controller = new AbortController(); let current = true, observedCommit = false;
    queueMicrotask(() => { observedCommit = !store.getDb().inTransaction; current = false; controller.abort(Error('late abort')); });
    const result = await invoke(manager, action, { signal: controller.signal, authorise() { if (!current) throw Error('late revoke'); } });
    expect(observedCommit).toBe(true); expect(store.getChatBranchByChatJid(result.chat_jid)).toEqual(result);
  }));
  for (const reason of ['cancel', 'revoke', 'replace'] as const) test(`supported branch request ${reason} stops acquisition with foreign writer still held: ${action}`, () => fixture(true, async ({ store, manager, path }) => {
    const blocker = new Database(path); blocker.exec('BEGIN IMMEDIATE');
    const before = store.listChatBranches(null, { includeArchived: true }), controller = new AbortController(); let current = true;
    const context = { signal: controller.signal, authorise() { if (!current) throw Error('request revoked'); } };
    const pending = invoke(manager, action, context).then(value => ({ value }), error => ({ error }));
    try {
      await Bun.sleep(30); const revokedAt = performance.now();
      if (reason === 'cancel') controller.abort(Error('request stopped')); else current = false;
      if (reason === 'replace') { context.authorise = () => {}; context.signal = new AbortController().signal; }
      const result = await pending; expect(performance.now() - revokedAt).toBeLessThan(500);
      expect('error' in result && result.error.message).toContain(reason === 'cancel' ? 'request stopped' : 'request revoked');
      expect(blocker.inTransaction).toBe(true); expect(store.listChatBranches(null, { includeArchived: true })).toEqual(before);
    } finally { if (blocker.inTransaction) blocker.exec('ROLLBACK'); await pending; blocker.close(); }
  }), 10_000);
}
