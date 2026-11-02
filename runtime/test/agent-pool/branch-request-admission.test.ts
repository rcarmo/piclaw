import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { AgentBranchManager } from '../../src/agent-pool/branch-manager.js';
import type { PoolEntry } from '../../src/agent-pool/session-manager.js';
import { getRuntimeConfigPaths } from '../../src/core/config.js';
import { importFresh, withTempWorkspaceEnv } from '../helpers.js';

type Store = typeof import('../../src/db.js');
type Context = { signal?: AbortSignal; authorise?: () => void };
type Action = 'handle' | 'root' | 'rename' | 'merge' | 'prune' | 'purge' | 'restore';
const parent = 'web:request-parent', child = `${parent}:child`, target = `${parent}:renamed`;

async function fixture(disk: boolean, action: Action,
  run: (input: { store: Store; manager: AgentBranchManager; pool: Map<string, PoolEntry>; leaves: Map<string, string | null>; cancelled: string[];
    state: { disposed: number; warmed: number }; path: string }) => Promise<void>) {
  return withTempWorkspaceEnv('branch-request-admission-', {}, async ws => {
    const store = await importFresh<Store>('../src/db.js');
    store.closeDatabase();
    const path = join(ws.store, 'branch.sqlite');
    store.initDatabase(disk ? { ...getRuntimeConfigPaths(), databasePath: path } : getRuntimeConfigPaths());
    store.storeChatMetadata(parent, new Date().toISOString(), 'Parent');
    const root = store.getChatBranchByChatJid(parent)!;
    store.storeChatMetadata(child, new Date().toISOString(), 'Child');
    store.ensureChatBranch({ chat_jid: child, root_chat_jid: parent,
      parent_branch_id: root.branch_id, agent_name: 'child' });
    if (action === 'purge' || action === 'restore') store.archiveChatBranch(child);
    const state = { disposed: 0, warmed: 0 };
    const runtime = { session: { isStreaming: false, isCompacting: false, isRetrying: false,
      isBashRunning: false, setSessionName() {} }, async dispose() { state.disposed++; } } as unknown as PoolEntry['runtime'];
    const pool = new Map<string, PoolEntry>([[child, { runtime, lastUsed: 0 }]]);
    const leaves = new Map<string, string | null>([[child, 'retained']]), cancelled: string[] = [];
    const manager = new AgentBranchManager({ pool, activeForkBaseLeafByChat: leaves,
      isActive: jid => pool.get(jid)?.runtime.session.isStreaming === true,
      scheduleSessionWarmup() { state.warmed++; },
      cancelSessionWarmup(jid) { cancelled.push(jid); },
      async getOrCreateRuntime() { state.warmed++; return runtime; } });
    try { await run({ store, manager, pool, leaves, cancelled, state, path }); }
    finally { const db = store.getDb(); if (db.inTransaction) db.exec('ROLLBACK'); store.closeDatabase(); }
  });
}

function invoke(manager: AgentBranchManager, action: Action, context: Context) {
  switch (action) {
    case 'handle': return manager.renameChatBranch(child, { agentName: 'changed', ...context });
    case 'root': return manager.createRootChatSession('request-fresh', context);
    case 'rename': return manager.renameChatJid(child, target, context);
    case 'merge': return manager.mergeChatBranchIntoParent(child, context);
    case 'prune': return manager.pruneChatBranch(child, context);
    case 'purge': return manager.permanentPurgeChatBranch(child, context);
    case 'restore': return manager.restoreChatBranch(child, { agentName: 'restored', ...context });
  }
}

for (const action of ['handle', 'root', 'rename', 'merge', 'prune', 'purge', 'restore'] as const) {
  test(`branch request cancellation fences mutation and cleanup before admission: ${action}`, () => fixture(false, action, async ({ store, manager, pool, state }) => {
    const before = store.listChatBranches(null, { includeArchived: true }), entry = pool.get(child);
    const controller = new AbortController(); controller.abort(Error('request stopped'));
    let checked = 0;
    await expect(invoke(manager, action, { signal: controller.signal, authorise() { checked++; } })).rejects.toThrow('request stopped');
    expect(checked).toBe(0); expect(state).toEqual({ disposed: 0, warmed: 0 });
    expect(pool.get(child)).toBe(entry);
    expect(store.listChatBranches(null, { includeArchived: true })).toEqual(before);
    expect(store.getDb().inTransaction).toBe(false);
  }));
}

test('branch cleanup requires physical outermost commit rather than inherited savepoint success', () => fixture(false, 'rename', async ({ store, manager, pool, state }) => {
  const db = store.getDb(), entry = pool.get(child);
  db.exec('BEGIN IMMEDIATE');
  try {
    await expect(invoke(manager, 'rename', {})).rejects.toThrow('outermost');
    expect(db.inTransaction).toBe(true); expect(state.disposed).toBe(0);
    expect(pool.get(child)).toBe(entry); expect(store.getChatBranchByChatJid(child)).not.toBeNull();
    expect(store.getChatBranchByChatJid(target)).toBeNull();
  } finally { db.exec('ROLLBACK'); }
}));

test('branch acquisition yields to a foreign WAL writer and commits once after release', () => fixture(true, 'rename', async ({ store, manager, state, path }) => {
  const blocker = new Database(path); blocker.exec('BEGIN IMMEDIATE');
  let beats = 0, settled = false;
  const heartbeat = setInterval(() => { beats++; }, 5), start = performance.now();
  const pending = invoke(manager, 'rename', {}).then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
  try {
    await Bun.sleep(40);
    expect(performance.now() - start).toBeLessThan(500);
    expect(beats).toBeGreaterThan(0); expect(settled).toBe(false); expect(state.disposed).toBe(0);
    expect(store.getChatBranchByChatJid(child)).not.toBeNull();
    expect(store.getDb().query('PRAGMA busy_timeout').get()).toEqual({ timeout: 5000 });
    blocker.exec('ROLLBACK');
    const result = await pending;
    expect('error' in result).toBe(false); expect(state.disposed).toBe(1);
    expect(store.getChatBranchByChatJid(child)).toBeNull();
    expect(store.getChatBranchByChatJid(target)).not.toBeNull();
  } finally {
    clearInterval(heartbeat); if (blocker.inTransaction) blocker.exec('ROLLBACK'); await pending; blocker.close();
  }
}), 10_000);

for (const action of ['rename', 'merge', 'purge', 'prune'] as const) {
  test(`postcommit microtask replacement is not adopted as a cleanup target: ${action}`, () => fixture(false, action, async ({ store, manager, pool, leaves, cancelled, state }) => {
    let replacementDisposed = 0, observedCommit = false;
    const replacement = { runtime: { ...pool.get(child)!.runtime, async dispose() { replacementDisposed++; } }, lastUsed: 1 };
    // Uncontended SQL commits synchronously. This independent queued action runs
    // before the high-level method resumes from its admission await.
    queueMicrotask(() => {
      observedCommit = !store.getDb().inTransaction && (action === 'prune'
        ? store.getChatBranchByChatJid(child)?.archived_at != null : store.getChatBranchByChatJid(child) === null);
      pool.set(child, replacement); leaves.set(child, 'replacement-leaf');
    });
    await invoke(manager, action, {});
    expect(observedCommit).toBe(true); expect(state.disposed).toBe(1);
    expect(replacementDisposed).toBe(0); expect(pool.get(child)).toBe(replacement);
    expect(leaves.get(child)).toBe('replacement-leaf'); expect(cancelled).toEqual([]);
  }));
}

test('entered postcommit cleanup finishes once after request cancellation or revocation', () => fixture(false, 'rename', async ({ store, manager, pool, state }) => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  pool.get(child)!.runtime.dispose = async () => { state.disposed++; entered(); await gate; };
  const controller = new AbortController(); let current = true;
  const pending = invoke(manager, 'rename', { signal: controller.signal,
    authorise() { if (!current) throw Error('request revoked after commit'); } });
  try {
    await Promise.race([started, pending.then(() => { throw Error('Missing cleanup wait'); })]);
    expect(store.getDb().inTransaction).toBe(false);
    expect(store.getChatBranchByChatJid(target)).not.toBeNull();
    current = false; controller.abort(Error('request stopped after commit')); release();
    await pending;
    expect(state.disposed).toBe(1); expect(pool.has(child)).toBe(false);
    expect(store.getChatBranchByChatJid(child)).toBeNull();
  } finally { release(); await pending.catch(() => {}); }
}));

for (const reason of ['cancel', 'revoke', 'replace'] as const) {
  test(`branch request ${reason} stops acquisition while the foreign writer remains held`, () => fixture(true, 'rename', async ({ store, manager, pool, state, path }) => {
    const blocker = new Database(path); blocker.exec('BEGIN IMMEDIATE');
    const entry = pool.get(child), controller = new AbortController(); let current = true;
    const context = { signal: controller.signal, authorise() { if (!current) throw Error('request revoked'); } };
    const pending = invoke(manager, 'rename', context).then(value => ({ value }), error => ({ error }));
    try {
      await Bun.sleep(30); const revokedAt = performance.now();
      if (reason === 'cancel') controller.abort(Error('request stopped')); else current = false;
      if (reason === 'replace') { context.authorise = () => {}; context.signal = new AbortController().signal; }
      const result = await pending;
      expect(performance.now() - revokedAt).toBeLessThan(500);
      expect('error' in result && result.error.message).toContain(reason === 'cancel' ? 'request stopped' : 'request revoked');
      expect(blocker.inTransaction).toBe(true); expect(state.disposed).toBe(0); expect(pool.get(child)).toBe(entry);
      expect(store.getChatBranchByChatJid(child)).not.toBeNull();
      expect(store.getChatBranchByChatJid(target)).toBeNull();
      expect(store.getDb().query('PRAGMA busy_timeout').get()).toEqual({ timeout: 5000 });
    } finally { if (blocker.inTransaction) blocker.exec('ROLLBACK'); await pending; blocker.close(); }
  }), 10_000);
}
