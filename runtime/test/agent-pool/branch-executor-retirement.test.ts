import { expect, test } from 'bun:test';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentBranchManager, listSessionArtifactPaths, removeSessionArtifacts } from '../../src/agent-pool/branch-manager.js';
import { AgentPool } from '../../src/agent-pool.js';
import { createLegacyCapturePoolOptions } from '../model-services-fixture.js';
import * as db from '../../src/db.js';
import { SESSIONS_DIR } from '../../src/core/config.js';
import { sanitiseJid } from '../../src/agent-pool/session-paths.js';
import { withTempWorkspaceEnv } from '../helpers.js';

const retired = ['renameChatJid', 'mergeChatBranchIntoParent', 'permanentPurgeChatBranch', 'restoreChatBranch', 'createForkedChatBranch', 'ensureBranchRegistration'];
test('branch executor and sync registration APIs are retired rather than wrapped', () => {
  for (const name of retired) expect(AgentBranchManager.prototype).not.toHaveProperty(name);
});

for (const operation of ['rename', 'merge', 'purge', 'restore', 'fork'] as const) test(`capture composition cannot execute retired branch ${operation}`, () =>
  withTempWorkspaceEnv('branch-capture-retired-', {}, async () => {
    db.closeDatabase(); db.initDatabase();
    const parent = `web:retired-${operation}`, child = `${parent}:child`;
    db.storeChatMetadata(parent, '2026-01-01', 'Parent');
    db.storeChatMetadata(child, '2026-01-01', 'Child');
    db.ensureChatBranch({ chat_jid: child, root_chat_jid: parent, parent_branch_id: db.getChatBranchByChatJid(parent)!.branch_id, agent_name: 'child' });
    if (operation === 'purge' || operation === 'restore') db.archiveChatBranch(child);
    const dir = join(SESSIONS_DIR, sanitiseJid(child)); mkdirSync(dir, { recursive: true });
    const bytes = 'historical JSONL and config bytes\n'; writeFileSync(join(dir, 'history.jsonl'), bytes);
    const before = db.getDb().serialize(), files = readdirSync(SESSIONS_DIR); let created = 0;
    const pool = new AgentPool({ ...createLegacyCapturePoolOptions(), createSession: async () => { created++; throw Error('legacy runtime must not be constructed'); } });
    try {
      let pending: Promise<unknown>;
      switch (operation) {
        case 'rename': pending = pool.renameChatJid(child, `${parent}:moved`); break;
        case 'merge': pending = pool.mergeChatBranchIntoParent(child); break;
        case 'purge': pending = pool.permanentPurgeChatBranch(child); break;
        case 'restore': pending = pool.restoreChatBranch(child); break;
        case 'fork': pending = pool.createForkedChatBranch(child); break;
      }
      await expect(pending).rejects.toThrow('unavailable');
      expect(created).toBe(0); expect(db.getDb().serialize()).toEqual(before);
      expect(readdirSync(SESSIONS_DIR)).toEqual(files); expect(readFileSync(join(dir, 'history.jsonl'), 'utf8')).toBe(bytes);
    } finally { await pool.shutdown(); db.closeDatabase(); }
  }));

for (const operation of ['handle', 'archive', 'root'] as const) test(`admitted ${operation} has no legacy cache, warmup or filesystem publication tail`, () =>
  withTempWorkspaceEnv('branch-metadata-only-', {}, async () => {
    db.closeDatabase(); db.initDatabase();
    const jid = 'web:metadata-only'; db.storeChatMetadata(jid, '2026-01-01', 'Historical');
    const dir = join(SESSIONS_DIR, sanitiseJid(jid)); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.branch-seed.json'), 'historical seed bytes');
    let effects = 0;
    const unexpected = () => { effects++; throw Error('retired publication'); };
    const entry = { runtime: { session: { setSessionName: unexpected }, dispose: unexpected }, lastUsed: 0 } as any;
    const pool = new Map([[jid, entry]]);
    // Pass old callbacks as adversarial extra fields: no new lifecycle owner is permitted.
    const manager = new AgentBranchManager({ pool, isActive: () => false, activeForkBaseLeafByChat: new Map([[jid, 'seed']]),
      getOrCreateRuntime: unexpected, scheduleSessionWarmup: unexpected, cancelSessionWarmup: unexpected, onWarn: unexpected } as any);
    try {
      const result = operation === 'handle' ? await manager.renameChatBranch(jid, { agentName: 'friendly' })
        : operation === 'archive' ? await manager.pruneChatBranch(jid) : await manager.createRootChatSession('fresh-root');
      expect(db.getChatBranchByChatJid(result.chat_jid)).toEqual(result);
      expect(effects).toBe(0); expect(pool.get(jid)).toBe(entry);
      expect(readFileSync(join(dir, '.branch-seed.json'), 'utf8')).toBe('historical seed bytes');
    } finally { db.closeDatabase(); }
  }));

test('offline artifact preview/apply helper APIs remain usable without a branch executor', () =>
  withTempWorkspaceEnv('branch-artifact-api-', {}, () => {
    const jid = 'web:offline', own = join(SESSIONS_DIR, sanitiseJid(jid)), variant = own + '__variant';
    const foreign = join(SESSIONS_DIR, sanitiseJid('web:offline-other'));
    for (const dir of [own, variant, foreign]) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'history'), dir); }
    expect(listSessionArtifactPaths(jid).sort()).toEqual([own, variant].sort());
    expect(removeSessionArtifacts(jid).sort()).toEqual([own, variant].sort());
    expect(readFileSync(join(foreign, 'history'), 'utf8')).toBe(foreign);
  }));
