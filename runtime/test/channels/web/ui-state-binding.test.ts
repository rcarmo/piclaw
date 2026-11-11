import '../../helpers.js';
import { expect, spyOn, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { createTempWorkspace, withTempWorkspaceEnv } from '../../helpers.js';
import { getRuntimeConfigPaths } from '../../../src/core/config.js';
import * as db from '../../../src/db.js';
import { admitServerUiState, getServerUiState } from '../../../src/channels/web/ui-state.js';
import { WebChannel } from '../../../src/channels/web.js';
import { AgentBranchManager } from '../../../src/agent-pool/branch-manager.js';
import { createWebAgentControlPlaneService } from '../../../src/channels/web/agent/agent-control-plane-service.js';

async function fixture(path?: string) {
  await db.closeDatabase(); db.initDatabase({ ...getRuntimeConfigPaths(), ...(path ? { databasePath: path } : {}) });
  const channel = new WebChannel({ queue: { enqueue() {} }, agentPool: {} } as any);
  return { channel, root: db.getDb() };
}
const request = (body: unknown, path = '/agent/ui-state') => new Request('http://fixture' + path, { method: 'POST', body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json', Origin: 'http://fixture' } });
const patch = { ui_theme: { theme: 'dracula', tint: '#abc' }, ui_meters: { collapsed: true }, ui_output: { outputPad: 7 } };

test('a later preference write failure rolls back the complete combined patch and publishes nothing', () =>
  withTempWorkspaceEnv('ui-preference-rollback-', {}, async () => {
    const f = await fixture(), before = getServerUiState(); let publications = 0;
    f.channel.broadcastEvent = () => { publications++; };
    f.root.exec("CREATE TRIGGER deny_meters BEFORE INSERT ON extension_kv WHEN new.extension_id='piclaw-ui' AND new.key='meters' BEGIN SELECT RAISE(ABORT,'meters denied'); END");
    try {
      await expect(f.channel.handleRequest(request(patch))).rejects.toThrow('meters denied');
      expect(getServerUiState()).toEqual(before); expect(publications).toBe(0);
      expect(db.extensionKvList('piclaw-ui', '', 'global')).toEqual([]);
    } finally { await db.closeDatabase(); }
  }));

test('UI preferences cannot adopt another database while JSON is parsed', () =>
  withTempWorkspaceEnv('ui-preference-binding-', {}, async () => {
    const f = await fixture(), req = request(patch); const json = req.json.bind(req);
    req.json = async () => { await fixture(); return json(); };
    try {
      await expect(f.channel.handleRequest(req)).rejects.toThrow('database binding changed');
      expect(db.extensionKvList('piclaw-ui', '', 'global')).toEqual([]);
    } finally { await db.closeDatabase(); }
  }));

test('branch control captures its database before JSON rather than renaming a replacement profile', () =>
  withTempWorkspaceEnv('branch-request-database-', {}, async () => {
    const f = await fixture(), chat = 'web:branch-binding'; db.storeChatMetadata(chat, '2026-01-01');
    const manager = new AgentBranchManager({ pool: new Map(), isActive: () => false });
    const service = createWebAgentControlPlaneService({ ...f.channel,
      json: f.channel.json.bind(f.channel), broadcastEvent() {}, processChat: async () => {},
      agentPool: { renameChatBranch: manager.renameChatBranch.bind(manager) } as any,
    } as any, { defaultChatJid: chat, defaultAgentId: 'default' });
    const req = request({ chat_jid: chat, agent_name: 'unexpected-name' }, '/agent/branch-rename'), json = req.json.bind(req);
    req.json = async () => { await fixture(); db.storeChatMetadata(chat, '2026-01-01'); return json(); };
    try {
      const response = await service.handleAgentBranchRename(req);
      expect(response.status).toBeGreaterThanOrEqual(400); expect(db.getChatBranchByChatJid(chat)!.agent_name).not.toBe('unexpected-name');
    } finally { await db.closeDatabase(); }
  }));

for (const outcome of ['cancel', 'revoke'] as const) test(`UI preference acquisition yields under held WAL and rejects ${outcome} before its SQL body`, () =>
  withTempWorkspaceEnv('ui-preference-wal-', {}, async ws => {
    const path = join(ws.store, 'ui.sqlite'), f = await fixture(path), blocker = new Database(path), controller = new AbortController();
    f.root.exec('PRAGMA busy_timeout=0');
    let allowed = true, settled = false, beats = 0, pending: Promise<unknown> | undefined;
    const timer = setInterval(() => { beats++; }, 5);
    try {
      blocker.exec('BEGIN IMMEDIATE');
      pending = admitServerUiState(patch, () => { if (!allowed) throw Error('revoked UI owner'); }, controller.signal).then(value => { settled = true; return value; }, error => { settled = true; return error; });
      await Bun.sleep(45); expect(settled).toBe(false); expect(beats).toBeGreaterThan(1);
      if (outcome === 'cancel') controller.abort(Error('cancelled preferences')); else { allowed = false; blocker.exec('COMMIT'); }
      expect(await pending).toBeInstanceOf(Error); expect(db.extensionKvList('piclaw-ui', '', 'global')).toEqual([]);
      expect(f.root.query('PRAGMA busy_timeout').get()).toEqual({ timeout: 0 });
    } finally { clearInterval(timer); controller.abort(); if (blocker.inTransaction) blocker.exec('ROLLBACK'); await Promise.allSettled(pending ? [pending] : []); blocker.close(); await db.closeDatabase(); }
  }));

test('committed UI state remains acknowledged when SSE and diagnostic publication fail', () =>
  withTempWorkspaceEnv('ui-preference-observer-', {}, async () => {
    const f = await fixture(), original = process.stderr.write.bind(process.stderr); let published = false;
    f.channel.broadcastEvent = () => { published = true; throw Error('optional SSE unavailable'); };
    const hook = spyOn(process.stderr, 'write').mockImplementation((chunk: any) => { if (published) throw Error('diagnostics unavailable'); return original(chunk); });
    let response: Response | Error;
    try { response = await f.channel.handleRequest(request(patch)).catch(error => error); }
    finally { hook.mockRestore(); }
    try { expect(response).toBeInstanceOf(Response); expect((response as Response).status).toBe(200); expect(getServerUiState().ui_output.outputPad).toBe(7); }
    finally { await db.closeDatabase(); }
  }));

test('historical config remains a read-only startup fallback in a real isolated child', async () => {
  const ws = createTempWorkspace('ui-legacy-child-');
  const launcher = new URL('../../../scripts/local-test-priority.ts', import.meta.url).pathname;
  const fixture = new URL('../../fixtures/ui-theme-legacy-reader.ts', import.meta.url).pathname;
  const child = Bun.spawn([process.execPath, '--no-env-file', launcher, '--env', 'PICLAW_DB_IN_MEMORY=1', '--env', `PICLAW_WORKSPACE=${ws.workspace}`,
    '--env', `PICLAW_STORE=${ws.store}`, '--env', `PICLAW_DATA=${ws.data}`, '--', process.execPath, '--no-env-file', fixture], { stdout: 'pipe', stderr: 'pipe' });
  try {
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit, `${stderr}\n${stdout}`).toBe(0);
    expect(JSON.parse(stdout.trim().split('\n').at(-1)!)).toEqual({ kind: 'ui-theme-legacy-reader', configUnchanged: true, sqlitePrimary: true, legacyFallback: true });
  } finally { if (child.exitCode === null) child.kill(); await child.exited; ws.cleanup(); }
});

test('general settings response preparation failure cannot reject an already committed UI preference patch', () =>
  withTempWorkspaceEnv('general-response-preparation-', {}, async () => {
    const f = await fixture(), before = getServerUiState();
    const config = await import('../../../src/core/config.js');
    const fault = spyOn(config, 'getOrCreateWebWidgetToken').mockImplementation(() => { throw Error('widget token preparation failed'); });
    try {
      const response = await f.channel.handleRequest(request({ uiTheme: 'dracula', outputPad: 9 }, '/agent/settings/general'));
      expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: 'widget token preparation failed' });
      expect(getServerUiState()).toEqual(before); expect(db.extensionKvList('piclaw-ui', '', 'global')).toEqual([]);
    } finally { fault.mockRestore(); await db.closeDatabase(); }
  }));
