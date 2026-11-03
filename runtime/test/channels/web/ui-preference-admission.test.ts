import '../../helpers.js';
import { expect, spyOn, test } from 'bun:test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withTempWorkspaceEnv } from '../../helpers.js';
import * as db from '../../../src/db.js';
import * as admission from '../../../src/db/sqlite-async-admission.js';
import * as ui from '../../../src/channels/web/ui-state.js';
import * as identity from '../../../src/core/config-identity.js';
import { WebChannel } from '../../../src/channels/web.js';
import { handleAgentMessage } from '../../../src/channels/web/handlers/agent.js';

function fixture() {
  db.closeDatabase(); db.initDatabase();
  const channel = new WebChannel({ queue: { enqueue() { throw Error('UI preferences cannot run model input'); } },
    agentPool: { isActive: () => false, isStreaming: () => false } } as any);
  const events: Array<{ event: string; data: any }> = [];
  channel.broadcastEvent = (event, data) => { expect(db.getDb().inTransaction).toBe(false); events.push({ event, data }); };
  return { channel, events };
}
const preferences = { ui_theme: { theme: 'DRACULA', tint: ' #abc ' }, ui_meters: { enabled: true, collapsed: true }, ui_output: { outputPad: 32 } };
const normalized = { ui_theme: { theme: 'dracula', tint: '#abc' }, ui_meters: { enabled: true, collapsed: true }, ui_output: { outputPad: 24 } };
const request = (body: unknown) => new Request('http://fixture/agent/ui-state', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://fixture' }, body: JSON.stringify(body) });

test('golden: combined UI preferences retain normalization, response and existing events', () =>
  withTempWorkspaceEnv('ui-preference-contract-', {}, async () => {
    const f = fixture();
    try {
      const response = await f.channel.handleRequest(request(preferences));
      expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, ...normalized });
      expect(ui.getServerUiState()).toEqual(normalized);
      expect(f.events).toEqual([{ event: 'ui_theme', data: normalized.ui_theme }, { event: 'ui_meters', data: { mode: 'set', ...normalized.ui_meters } }, { event: 'ui_theme', data: { outputPad: 24 } }]);
    } finally { db.closeDatabase(); }
  }));

test('golden: an empty UI patch is a no-write acknowledgement', () =>
  withTempWorkspaceEnv('ui-preference-empty-', {}, async () => {
    const f = fixture(), before = db.getDb().serialize();
    try {
      expect(await (await f.channel.handleRequest(request({ unrelated: true }))).json()).toEqual({ ok: true });
      expect(db.getDb().serialize()).toEqual(before); expect(f.events).toEqual([]);
    } finally { db.closeDatabase(); }
  }));

test('theme changes leave the historical config file unchanged', () =>
  withTempWorkspaceEnv('ui-no-dual-write-', {}, async ws => {
    mkdirSync(join(ws.workspace, '.piclaw'), { recursive: true });
    const path = join(ws.workspace, '.piclaw/config.json'), bytes = JSON.stringify({ ui: { theme: 'historic', tint: '#123' }, marker: 'retain' });
    writeFileSync(path, bytes); const f = fixture();
    try {
      expect((await f.channel.handleRequest(request({ ui_theme: preferences.ui_theme }))).status).toBe(200);
      expect(ui.getServerUiThemeConfig()).toEqual(normalized.ui_theme);
      expect(readFileSync(path, 'utf8')).toBe(bytes);
    } finally { db.closeDatabase(); }
  }));

test('one combined commit retains all preferences if authority is revoked after that commit', () =>
  withTempWorkspaceEnv('ui-combined-commit-', {}, async () => {
    const f = fixture();
    let principal: any = { kind: 'user', userId: 'default', username: 'fixture', displayName: 'Fixture', role: 'admin', mode: 'single-user',
      homeChatJid: 'web:default', authentication: { method: 'cookie', sessionId: 'synthetic', expiresAt: null } };
    f.channel.authGateway = { isAuthEnabled: () => true, isInternalSecretEnabled: () => false, verifyInternalSecret: () => false,
      isAuthenticated: () => principal !== null, getPrincipal: () => principal } as any;
    const original = admission.admitSqliteWrite; let writes = 0;
    const hook = spyOn(admission, 'admitSqliteWrite').mockImplementation((async (...args: any[]) => {
      const result = await (original as any)(...args); writes++; principal = null; return result;
    }) as any);
    try {
      const response = await f.channel.handleRequest(request(preferences)).catch(error => error);
      expect(writes).toBe(1); expect(db.extensionKvGet('piclaw-ui', 'theme', 'global')).toEqual(normalized.ui_theme);
      expect(ui.getServerUiState()).toEqual(normalized);
      expect(response).toBeInstanceOf(Response); expect((response as Response).status).toBe(200); expect(await (response as Response).json()).toEqual({ ok: true, ...normalized });
    } finally { hook.mockRestore(); db.closeDatabase(); }
  }));

test('a theme command reports committed preference state after late abort without repeating its write', () =>
  withTempWorkspaceEnv('ui-late-abort-', {}, async () => {
    const f = fixture(), controller = new AbortController(), original = admission.admitSqliteWrite; let writes = 0;
    f.channel.sendMessage = async (_chat, _text, options: any) => { options?.signal?.throwIfAborted(); };
    const hook = spyOn(admission, 'admitSqliteWrite').mockImplementation((async (...args: any[]) => {
      const result = await (original as any)(...args); writes++; controller.abort(Error('late preference abort')); return result;
    }) as any);
    try {
      const response = await handleAgentMessage(f.channel, new Request('http://fixture/agent/default/message', {
        method: 'POST', signal: controller.signal, body: JSON.stringify({ content: '/theme dracula' }), headers: { 'Content-Type': 'application/json' },
      }), '/agent/default/message', 'web:default', 'default').catch(error => error);
      expect(ui.getServerUiThemeConfig().theme).toBe('dracula'); expect(writes).toBe(1);
      expect(response).toBeInstanceOf(Response); expect((response as Response).status).toBe(200);
    } finally { hook.mockRestore(); db.closeDatabase(); }
  }));

test('UI storage errors are not disguised as empty preferences', () =>
  withTempWorkspaceEnv('ui-storage-error-', {}, async () => {
    const f = fixture(), failure = Object.assign(Error('preference storage unavailable'), { code: 'SQLITE_IOERR' });
    const hook = spyOn(db.getDb(), 'prepare').mockImplementation(() => { throw failure; });
    try { expect(() => ui.getServerUiState()).toThrow('preference storage unavailable'); }
    finally { hook.mockRestore(); db.closeDatabase(); }
  }));

test('legacy theme writer and split/synchronous preference mutation exports are retired', () => {
  expect(identity).not.toHaveProperty('setUiThemeConfig');
  for (const name of ['admitServerUiThemeConfig', 'admitServerUiMetersConfig', 'admitServerUiOutputConfig', 'setServerUiMetersConfig', 'setServerUiOutputConfig']) {
    expect(ui).not.toHaveProperty(name);
  }
});
