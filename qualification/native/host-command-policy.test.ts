import './src/test-guard.js';
import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostCommandPolicy } from '../../runtime/durable-engine/src/host-command-policy.ts';
import { Harness, MemoryStorage, createRegistry, UserEntry } from '../../runtime/durable-engine/qualification/durable.ts';
import { createModels, fauxProvider, fauxAssistantMessage } from '../../runtime/durable-engine/qualification/ai.ts';
import { context } from './src/fixture.ts';

test('idle native context is discarded and the next turn rereads the same history', async () => {
  const root = new Database(':memory:');
  root.exec('CREATE TABLE router_state(key TEXT PRIMARY KEY,value TEXT)');
  const policy = createHostCommandPolicy(root, () => {});
  const storage = new MemoryStorage();
  const scan = storage.scanEntries.bind(storage);
  let fullScans = 0, countReads = false;
  storage.scanEntries = async (query, limit, cursor, ctx) => {
    if (countReads && query.order !== 'ascending' && query.minEntryId === undefined && limit === 256 && cursor === undefined) fullScans++;
    return scan(query, limit, cursor, ctx);
  };
  const faux = fauxProvider({ tokensPerSecond: 100_000 });
  const models = createModels(); models.setProvider(faux.provider);
  faux.setResponses([fauxAssistantMessage('first answer'), fauxAssistantMessage('second answer')]);
  const harness = await Harness.open(storage, { registry: createRegistry(), models,
    settings: { ...policy.settings, compaction: { enabled: false }, retry: { enabled: false } },
  }, context);
  try {
    const c = await harness.root(context, { agent: { model: { provider: 'faux', modelId: 'faux-1' } } });
    const seed = await c.commit(tx => tx.appendEntry(UserEntry, c.id, {
      model: [{ role: 'user', content: 'durable history marker', timestamp: 1 }],
    }), context);
    countReads = true;
    const first = await c.submit({ type: 'input', requestId: 'idle-cache-one', content: 'first prompt' }, context);
    expect((await first.wait(context)).status).toBe('done');
    await c.waitForIdle(context);
    expect(fullScans).toBeGreaterThan(0);
    fullScans = 0;
    const second = await c.submit({ type: 'input', requestId: 'idle-cache-two', content: 'second prompt' }, context);
    expect((await second.wait(context)).status).toBe('done');
    expect(fullScans).toBeGreaterThan(0);
    countReads = false;
    expect((await c.context(context)).entries[0]).toEqual(seed);
    expect((await c.context(context)).messages.flatMap(message => typeof message.content === 'string' ? [message.content] : message.content.flatMap(block => block.type === 'text' ? [block.text] : []))).toEqual([
      'durable history marker', 'first prompt', 'first answer', 'second prompt', 'second answer',
    ]);
  } finally { await harness.close(context); root.close(); }
});

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
