import '../helpers.js';
import { expect, spyOn, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import * as db from '../../src/db.js';
import * as ssh from '../../src/extensions/ssh-core.js';
import { getRuntimeConfigPaths } from '../../src/core/config.js';
import { AgentPool } from '../../src/agent-pool.js';
import { createAgentPoolModelOptions } from '../model-services-fixture.js';
import { withTempWorkspaceEnv } from '../helpers.js';
const config = { ssh_target: 'fixture.invalid', ssh_port: 22, private_key_keychain: 'not-a-real-key', known_hosts_keychain: null, strict_host_key_checking: 'yes' as const };
const jid = 'web:ssh-metadata';
function fixture(path?: string) {
  db.closeDatabase(); db.initDatabase({ ...getRuntimeConfigPaths(), ...(path ? { databasePath: path } : {}) });
  return new AgentPool(createAgentPoolModelOptions());
}
for (const operation of ['set', 'clear'] as const) test(`native SSH ${operation} cannot adopt a legacy global transport as a publication target`, () =>
  withTempWorkspaceEnv('ssh-no-legacy-publication-', {}, async () => {
    const pool = fixture(); if (operation === 'clear') db.upsertSshConfig({ chat_jid: jid, ...config });
    // Registry allocation only; no keychain lookup, network or process is started.
    await ssh.registerLiveChatSshSession(jid);
    const apply = spyOn(ssh, 'applyLiveSshConfig').mockImplementation(async () => { throw Error('legacy transport must not be reconfigured'); });
    const clear = spyOn(ssh, 'clearLiveSshConfig').mockImplementation(async () => { throw Error('legacy transport must not be disposed'); });
    try {
      const result = operation === 'set' ? await pool.setSshConfig(jid, config) : await pool.clearSshConfig(jid);
      expect(result.apply_timing).toBe('next_session'); expect(apply).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled();
      expect(db.getSshConfig(jid)?.ssh_target ?? null).toBe(operation === 'set' ? config.ssh_target : null);
      expect(ssh.hasLiveChatSshSession(jid)).toBe(true);
    } finally { apply.mockRestore(); clear.mockRestore(); await ssh.unregisterLiveChatSshSession(jid); await pool.shutdown(); db.closeDatabase(); }
  }));

for (const operation of ['set', 'clear'] as const) test(`SSH metadata ${operation} waits cooperatively for WAL without starting a transport`, () =>
  withTempWorkspaceEnv('ssh-wal-admission-', {}, async ws => {
    const path = join(ws.store, 'ssh.sqlite'), pool = fixture(path); if (operation === 'clear') db.upsertSshConfig({ chat_jid: jid, ...config });
    const before = db.getSshConfig(jid), blocker = new Database(path); blocker.exec('BEGIN IMMEDIATE'); let settled = false;
    const pending = (operation === 'set' ? pool.setSshConfig(jid, config) : pool.clearSshConfig(jid)).then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
    const start = performance.now();
    try {
      await Bun.sleep(35); expect(performance.now() - start).toBeLessThan(500); expect(settled).toBe(false); expect(db.getSshConfig(jid)).toEqual(before);
      blocker.exec('ROLLBACK'); expect('value' in await pending).toBe(true);
      expect(db.getSshConfig(jid)?.ssh_target ?? null).toBe(operation === 'set' ? config.ssh_target : null);
    } finally { if (blocker.inTransaction) blocker.exec('ROLLBACK'); await pending; blocker.close(); await pool.shutdown(); db.closeDatabase(); }
  }), 12_000);

for (const reason of ['cancel', 'profile', 'shutdown'] as const) test(`SSH metadata acquisition rejects ${reason} without changing a held WAL database`, () =>
  withTempWorkspaceEnv('ssh-owner-admission-', {}, async ws => {
    const path = join(ws.store, 'ssh.sqlite'), pool = fixture(path), abort = new AbortController(), blocker = new Database(path), store = process.env.PICLAW_STORE;
    blocker.exec('BEGIN IMMEDIATE');
    const pending = pool.setSshConfig(jid, config, abort.signal).then(value => ({ value }), error => ({ error }));
    try {
      await Bun.sleep(30); const start = performance.now();
      if (reason === 'cancel') abort.abort(Error('SSH cancelled'));
      else if (reason === 'profile') process.env.PICLAW_STORE = store + '-rebound'; else await pool.shutdown();
      expect('error' in await pending).toBe(true); expect(performance.now() - start).toBeLessThan(500);
      expect(blocker.inTransaction).toBe(true); expect(db.getSshConfig(jid)).toBeNull();
    } finally { if (store === undefined) delete process.env.PICLAW_STORE; else process.env.PICLAW_STORE = store; blocker.exec('ROLLBACK'); await pending; blocker.close(); await pool.shutdown(); db.closeDatabase(); }
  }));

test('SSH metadata captures payload/target and owns the physical SQL commit', () =>
  withTempWorkspaceEnv('ssh-payload-admission-', {}, async ws => {
    const path = join(ws.store, 'ssh.sqlite'), pool = fixture(path), blocker = new Database(path), input = { ...config, chat_jid: 'forged-target' };
    blocker.exec('BEGIN IMMEDIATE'); const pending = pool.setSshConfig(jid, input);
    input.ssh_target = 'mutated.invalid';
    try {
      await Bun.sleep(30); blocker.exec('ROLLBACK');
      expect((await pending).config.ssh_target).toBe(config.ssh_target); expect(db.getSshConfig('forged-target')).toBeNull();
      db.getDb().exec('BEGIN IMMEDIATE');
      await expect(pool.clearSshConfig(jid)).rejects.toThrow('own transaction'); expect(db.getSshConfig(jid)).not.toBeNull(); db.getDb().exec('ROLLBACK');
      db.getDb().exec("CREATE TRIGGER reject_ssh BEFORE UPDATE ON ssh_configs BEGIN SELECT RAISE(ABORT,'SSH SQL denied'); END");
      await expect(pool.setSshConfig(jid, { ...config, ssh_target: 'rejected.invalid' })).rejects.toThrow('SSH SQL denied');
      expect(db.getSshConfig(jid)?.ssh_target).toBe(config.ssh_target);
    } finally { if (blocker.inTransaction) blocker.exec('ROLLBACK'); if (db.getDb().inTransaction) db.getDb().exec('ROLLBACK'); await pending; blocker.close(); await pool.shutdown(); db.closeDatabase(); }
  }));
