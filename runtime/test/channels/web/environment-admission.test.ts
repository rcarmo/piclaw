import '../../helpers.js';
import { expect, spyOn, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { withTempWorkspaceEnv } from '../../helpers.js';
import { getRuntimeConfigPaths } from '../../../src/core/config.js';
import * as db from '../../../src/db.js';
import { extensionKvSet } from '../../../src/db/extension-kv.js';
import * as admission from '../../../src/db/sqlite-async-admission.js';
import * as environment from '../../../src/environment-overrides.js';
import { WebChannel } from '../../../src/channels/web.js';

async function fixture(path?: string) {
  await db.closeDatabase(); db.initDatabase({ ...getRuntimeConfigPaths(), ...(path ? { databasePath: path } : {}) });
  return { root: db.getDb(), channel: new WebChannel({ queue: { enqueue() {} }, agentPool: {} } as any) };
}
const request = (name: string, value?: string, action = 'set', signal?: AbortSignal) => new Request('http://fixture/agent/settings/environment', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://fixture' }, body: JSON.stringify({ action, name, value }), signal,
});
const restored = (name: string, value: string | undefined) => { if (value === undefined) delete process.env[name]; else process.env[name] = value; };

for (const mode of ['set', 'clear'] as const) test(`environment ${mode} yields to WAL and changes neither SQL nor process state before admission`, () =>
  withTempWorkspaceEnv('environment-wal-', {}, async ws => {
    const name = `TEST_ENV_ADMISSION_${mode.toUpperCase()}`, original = process.env[name]; process.env[name] = 'original';
    const path = join(ws.store, 'environment.sqlite'), f = await fixture(path), blocker = new Database(path);
    if (mode === 'clear') expect((await f.channel.handleRequest(request(name, 'override'))).status).toBe(200);
    const before = environment.loadEnvironmentOverrides(), processBefore = process.env[name];
    blocker.exec('BEGIN IMMEDIATE'); let settled = false;
    const start = performance.now(), pending = f.channel.handleRequest(request(name, 'new-value', mode)).then(value => { settled = true; return value; });
    try {
      await Bun.sleep(35); expect(performance.now() - start).toBeLessThan(500); expect(settled).toBe(false);
      expect(environment.loadEnvironmentOverrides()).toEqual(before); expect(process.env[name]).toBe(processBefore);
      blocker.exec('ROLLBACK'); expect((await pending).status).toBe(200);
      expect(process.env[name]).toBe(mode === 'clear' ? 'original' : 'new-value');
    } finally { if (blocker.inTransaction) blocker.exec('ROLLBACK'); await pending; blocker.close(); await db.closeDatabase(); restored(name, original); }
  }), 12_000);

test('failed environment SQL cannot retain an uncommitted process-restore snapshot', () =>
  withTempWorkspaceEnv('environment-rollback-', {}, async () => {
    const name = 'TEST_ENV_ADMISSION_ROLLBACK', original = process.env[name]; process.env[name] = 'old baseline'; const f = await fixture();
    f.root.exec("CREATE TRIGGER reject_override BEFORE INSERT ON extension_kv WHEN new.extension_id='piclaw.environment-settings' BEGIN SELECT RAISE(ABORT,'environment SQL denied'); END");
    try {
      expect((await f.channel.handleRequest(request(name, 'rejected'))).status).toBe(400);
      expect(environment.loadEnvironmentOverrides()).toEqual({}); expect(process.env[name]).toBe('old baseline');
      f.root.exec('DROP TRIGGER reject_override'); process.env[name] = 'new baseline';
      expect((await f.channel.handleRequest(request(name, 'accepted'))).status).toBe(200);
      expect((await f.channel.handleRequest(request(name, undefined, 'clear'))).status).toBe(200);
      expect(process.env[name]).toBe('new baseline');
    } finally { await db.closeDatabase(); restored(name, original); }
  }));

test('environment HTTP captures its database before JSON rather than adopting a replacement', () =>
  withTempWorkspaceEnv('environment-binding-', {}, async () => {
    const name = 'TEST_ENV_ADMISSION_BINDING', original = process.env[name], f = await fixture(), req = request(name, 'must not publish'), json = req.json.bind(req);
    req.json = async () => { await fixture(); return json(); };
    try {
      expect((await f.channel.handleRequest(req)).status).toBe(400); expect(environment.loadEnvironmentOverrides()).toEqual({}); expect(process.env[name]).toBe(original);
    } finally { await db.closeDatabase(); restored(name, original); }
  }));

test('environment settings GET is read-only and does not republish process overrides', () =>
  withTempWorkspaceEnv('environment-reader-', {}, async () => {
    const name = 'TEST_ENV_ADMISSION_READER', original = process.env[name], f = await fixture(); process.env[name] = 'original';
    f.root.transaction(() => extensionKvSet('piclaw.environment-settings', 'overrides', { [name]: 'persisted only' }, 'global', '')).immediate();
    const before = f.root.serialize();
    try {
      expect(environment.getEnvironmentSettingsData().overrides[name]).toBe('persisted only');
      expect(process.env[name]).toBe('original'); expect(f.root.serialize()).toEqual(before);
    } finally { await db.closeDatabase(); restored(name, original); }
  }));

test('committed environment override remains acknowledged after late abort', () =>
  withTempWorkspaceEnv('environment-late-abort-', {}, async () => {
    const name = 'TEST_ENV_ADMISSION_ABORT', original = process.env[name], f = await fixture(), controller = new AbortController(); let writes = 0;
    const invoke = admission.admitSqliteWrite;
    const fault = spyOn(admission, 'admitSqliteWrite').mockImplementation((async (...args: Parameters<typeof invoke>) => {
      const value = await invoke(...args); writes++; controller.abort(Error('after known commit')); return value;
    }) as any);
    try {
      const response = await f.channel.handleRequest(request(name, 'committed', 'set', controller.signal));
      expect(writes).toBe(1); expect(controller.signal.aborted).toBe(true); expect(response.status).toBe(200);
      expect(environment.loadEnvironmentOverrides()[name]).toBe('committed'); expect(process.env[name]).toBe('committed');
    } finally { fault.mockRestore(); await db.closeDatabase(); restored(name, original); }
  }));

for (const reason of ['cancel', 'revoke'] as const) test(`environment ${reason} during WAL admission does not publish or mutate its caller input`, () =>
  withTempWorkspaceEnv('environment-cancel-', {}, async ws => {
    const name = `TEST_ENV_ADMISSION_${reason.toUpperCase()}`, original = process.env[name]; process.env[name] = 'original';
    const path = join(ws.store, 'environment.sqlite'), f = await fixture(path), blocker = new Database(path), abort = new AbortController(); let current = true;
    blocker.exec('BEGIN IMMEDIATE');
    const pending = environment.admitEnvironmentOverride(name, 'rejected', () => { if (!current) throw Error('environment revoked'); }, abort.signal).then(value => ({ value }), error => ({ error }));
    try {
      await Bun.sleep(30); const start = performance.now();
      if (reason === 'cancel') abort.abort(Error('environment cancelled')); else current = false;
      expect('error' in await pending).toBe(true); expect(performance.now() - start).toBeLessThan(500); expect(blocker.inTransaction).toBe(true);
      expect(environment.loadEnvironmentOverrides()).toEqual({}); expect(process.env[name]).toBe('original');
    } finally { blocker.exec('ROLLBACK'); await pending; blocker.close(); await db.closeDatabase(); restored(name, original); }
  }));

test('environment rollback after body entry restores SQL and does not retry or publish', () =>
  withTempWorkspaceEnv('environment-entered-', {}, async () => {
    const name = 'TEST_ENV_ADMISSION_ENTERED', original = process.env[name], f = await fixture(); process.env[name] = 'original'; let entered = 0;
    try {
      await expect(environment.admitEnvironmentOverride(name, 'must rollback', () => {
        if (environment.loadEnvironmentOverrides()[name]) { entered++; throw Object.assign(Error('entered environment body'), { code: 'SQLITE_BUSY' }); }
      })).rejects.toThrow('entered environment body');
      expect(entered).toBe(1); expect(environment.loadEnvironmentOverrides()).toEqual({}); expect(process.env[name]).toBe('original');
      f.root.exec('BEGIN IMMEDIATE');
      await expect(environment.admitEnvironmentOverride(name, 'not outermost', () => {})).rejects.toThrow('own transaction');
      expect(f.root.inTransaction).toBe(true); f.root.exec('ROLLBACK');
    } finally { if (f.root.inTransaction) f.root.exec('ROLLBACK'); await db.closeDatabase(); restored(name, original); }
  }));

test('clearing an absent override preserves current process values and SQL bytes', () =>
  withTempWorkspaceEnv('environment-empty-clear-', {}, async () => {
    const name = 'TEST_ENV_ADMISSION_ABSENT', original = process.env[name], f = await fixture(); process.env[name] = 'dynamic process value'; const before = f.root.serialize();
    try {
      const result = await environment.admitEnvironmentOverride(name, null, () => {});
      expect(result.overrides).toEqual({}); expect(process.env[name]).toBe('dynamic process value'); expect(f.root.serialize()).toEqual(before);
    } finally { await db.closeDatabase(); restored(name, original); }
  }));

test('concurrent set/clear restores the original process value without a second storage read', () =>
  withTempWorkspaceEnv('environment-publish-order-', {}, async () => {
    const name = 'TEST_ENV_ADMISSION_ORDER', original = process.env[name], f = await fixture(); process.env[name] = 'dynamic original';
    try {
      const first = environment.admitEnvironmentOverride(name, 'first', () => {}), second = environment.admitEnvironmentOverride(name, null, () => {});
      const [set, clear] = await Promise.all([first, second]); expect(set.overrides[name]).toBe('first'); expect(clear.overrides).toEqual({});
      expect(clear.variables.find(row => row.name === name)?.value).toBe('dynamic original'); expect(process.env[name]).toBe('dynamic original');
    } finally { await db.closeDatabase(); restored(name, original); }
  }));

test('committed environment receipt survives profile replacement without publishing into its successor', () =>
  withTempWorkspaceEnv('environment-commit-binding-', {}, async ws => {
    const name = 'TEST_ENV_ADMISSION_COMMITTED_BINDING', original = process.env[name]; process.env[name] = 'original';
    const path = join(ws.store, 'committed.sqlite'), f = await fixture(path), invoke = admission.admitSqliteWrite;
    const fault = spyOn(admission, 'admitSqliteWrite').mockImplementation((async (...args: Parameters<typeof invoke>) => {
      const value = await invoke(...args); await fixture(); return value;
    }) as any);
    try {
      const response = await f.channel.handleRequest(request(name, 'committed old profile'));
      expect(response.status).toBe(200); expect((await response.json()).settings.overrides[name]).toBe('committed old profile');
      expect(process.env[name]).toBe('original'); expect(environment.loadEnvironmentOverrides()).toEqual({});
      const source = new Database(path, { readonly: true });
      try { expect(JSON.parse((source.query("SELECT value FROM extension_kv WHERE extension_id='piclaw.environment-settings'").get() as { value: string }).value)[name]).toBe('committed old profile'); }
      finally { source.close(); }
    } finally { fault.mockRestore(); await db.closeDatabase(); restored(name, original); }
  }));
