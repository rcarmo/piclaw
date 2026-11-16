import './src/test-guard.js';
import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostCommandPolicy } from '../../runtime/durable-engine/src/host-command-policy.ts';

for (const revoke of [false, true]) test(`retry policy yields under owned WAL contention; revoke=${revoke}`, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'policy-admission-'));
  const root = new Database(join(dir, 'root.sqlite'));
  let writer: Database | undefined;
  const override = process.env.PICLAW_AUTO_COMPACTION_ENABLED;
  delete process.env.PICLAW_AUTO_COMPACTION_ENABLED;
  let pending: Promise<void> | undefined;
  try {
    root.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=0; CREATE TABLE router_state(key TEXT PRIMARY KEY,value TEXT)');
    writer = new Database(join(dir, 'root.sqlite'));
    writer.exec('BEGIN IMMEDIATE');
    let current = true;
    const policy = createHostCommandPolicy(root, () => { if (!current) throw Error('revoked'); });
    const compact = policy.read().autoCompact;
    // This non-SQL setting must remain usable while another connection owns the writer.
    await policy.set('autoCompact', !compact);
    expect(policy.read().autoCompact).toBe(!compact);
    await policy.set('autoCompact', compact);
    let settled = false;
    pending = policy.set('autoRetry', true);
    void pending.then(() => { settled = true; }, () => { settled = true; });
    await Bun.sleep(40);
    expect(settled).toBe(false);
    expect(root.query('PRAGMA busy_timeout').get()).toEqual({ timeout: 0 });
    expect(root.query('SELECT * FROM router_state').all()).toEqual([]);
    if (revoke) current = false;
    writer.exec('ROLLBACK');
    if (revoke) await expect(pending).rejects.toThrow('revoked');
    else { await pending; expect(policy.read().autoRetry).toBe(true); }
    expect(root.query('SELECT * FROM router_state').all()).toHaveLength(revoke ? 0 : 1);
    expect(root.inTransaction).toBe(false);
    expect(root.query('PRAGMA busy_timeout').get()).toEqual({ timeout: 0 });
  } finally {
    if (writer?.inTransaction) writer.exec('ROLLBACK');
    await pending?.catch(() => {});
    writer?.close(); root.close();
    if (override === undefined) delete process.env.PICLAW_AUTO_COMPACTION_ENABLED;
    else process.env.PICLAW_AUTO_COMPACTION_ENABLED = override;
    await rm(dir, { recursive: true, force: true });
  }
});

test('retry policy rolls back a revoked entered callback without replay', async () => {
  const root = new Database(':memory:');
  root.exec('CREATE TABLE router_state(key TEXT PRIMARY KEY,value TEXT)');
  let entered = 0;
  const failure = Object.assign(Error('entered contention'), { code: 'SQLITE_BUSY' });
  const policy = createHostCommandPolicy(root, () => {
    if (root.query('SELECT * FROM router_state').all().length) { entered++; throw failure; }
  });
  try {
    await expect(policy.set('autoRetry', true)).rejects.toBe(failure);
    expect(entered).toBe(1);
    expect(root.query('SELECT * FROM router_state').all()).toEqual([]);
    expect(root.inTransaction).toBe(false);
  } finally { root.close(); }
});
