import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { closeDatabase, getDb, initDatabase } from '../../src/db/connection.js';
import { withTempWorkspaceEnv, waitFor } from '../helpers.js';

const fixture = new URL('../fixtures/index-worker-database.ts', import.meta.url).pathname;
async function seed(keepOpen = false) {
  await closeDatabase(); initDatabase();
  getDb().exec("CREATE TABLE fixture_owner(value);INSERT INTO fixture_owner VALUES('preserve');INSERT INTO chats(jid,name) VALUES('web:worker','retained')");
  if (!keepOpen) await closeDatabase();
}
function binding(ws: {workspace:string;store:string;data:string}) {
  const paths = [ws.workspace, ws.store, ws.data, join(ws.store, 'messages.db')].map(realpathSync);
  const identities = paths.map(p => { const s = lstatSync(p); return `${s.dev}:${s.ino}`; });
  return { version: 1, mode: 'single-user', workspace: paths[0], store: paths[1], data: paths[2], database: paths[3], databaseIdentity: identities[3], identities };
}
async function child(scenario: string, payload?: unknown) {
  const p = spawn(process.execPath, ['--no-env-file', fixture, scenario], {
    env: process.env, stdio: payload === undefined ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe', 'pipe'],
  });
  let out = '', err = '';
  p.stdout!.on('data', value => { out += value; }); p.stderr!.on('data', value => { err += value; });
  if (payload !== undefined) (p.stdio[3] as import('node:stream').Writable).end(JSON.stringify(payload));
  const exited = once(p, 'close'), timer = setTimeout(() => p.kill('SIGKILL'), 15000);
  try {
    const [exit] = await exited;
    expect(exit, err).toBe(0);
    expect(JSON.parse(out.trim().split('\n').at(-1)!)).toEqual({ scenario, noCoreMigrationOrVacuum: true });
  } finally { clearTimeout(timer); if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL'); await exited; }
}
for (const scenario of ['file', 'note']) test(`actual ${scenario} worker never runs core migrations or VACUUM`, async () => {
  await withTempWorkspaceEnv('worker-database-', {}, async ws => {
    process.env.PICLAW_DB_IN_MEMORY = '0'; await seed();
    mkdirSync(join(ws.workspace, 'notes'), { recursive: true }); writeFileSync(join(ws.workspace, 'notes', 'worker.md'), 'bounded worker fixture');
    const file = join(ws.store, 'messages.db');
    const before = new Database(file, { readonly: true });
    const core = before.query("SELECT * FROM piclaw_schema_migrations WHERE owner!='note-retrieval' ORDER BY owner,migration_order").all(); before.close(true);
    await child(scenario, scenario === 'note' ? binding(ws) : undefined);
    const after = new Database(file, { readonly: true });
    try {
      expect(after.query("SELECT * FROM piclaw_schema_migrations WHERE owner!='note-retrieval' ORDER BY owner,migration_order").all()).toEqual(core);
      expect(after.query('SELECT * FROM fixture_owner').all()).toEqual([{ value: 'preserve' }]);
      expect(after.query("SELECT name FROM chats WHERE jid='web:worker'").get()).toEqual({ name: 'retained' });
      if (scenario === 'file') expect(after.query('SELECT path FROM workspace_files').all()).toEqual([{ path: 'notes/worker.md' }]);
      else expect(after.query('SELECT state FROM note_retrieval_state').get()).toEqual({ state: 'ready' });
    } finally { after.close(true); await closeDatabase(); }
  });
});
for (const scenario of ['missing', 'uninitialized', 'non-wal', 'escalation', 'revoked', 'cached']) test(`worker connection fails closed: ${scenario}`, async () => {
  await withTempWorkspaceEnv('worker-open-', {}, async ws => {
    process.env.PICLAW_DB_IN_MEMORY = '0'; await closeDatabase();
    const file = join(ws.store, 'messages.db');
    if (scenario === 'escalation' || scenario === 'revoked' || scenario === 'cached') await seed();
    else if (scenario !== 'missing') {
      const db = new Database(file); db.exec("CREATE TABLE sentinel(value);INSERT INTO sentinel VALUES(42)");
      if (scenario === 'uninitialized') db.exec('PRAGMA journal_mode=WAL'); db.close(true);
    }
    await child(scenario);
    if (scenario === 'missing') expect(existsSync(file)).toBe(false);
    else if (scenario === 'uninitialized' || scenario === 'non-wal') {
      const db = new Database(file, { readonly: true });
      try { expect(db.query("SELECT name FROM sqlite_schema WHERE type='table'").all()).toEqual([{ name: 'sentinel' }]); expect(db.query('SELECT * FROM sentinel').all()).toEqual([{ value: 42 }]); }
      finally { db.close(true); }
    }
  });
});

test('crashed index worker releases its write lock and handle without replay', async () => {
  await withTempWorkspaceEnv('worker-crash-', {}, async ws => {
    process.env.PICLAW_DB_IN_MEMORY = '0'; await seed(true);
    const p = spawn(process.execPath, ['--no-env-file', fixture, 'crash'], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = ''; p.stdout.on('data', value => { out += value; }); p.stderr.on('data', value => { err += value; });
    const exited = once(p, 'close');
    try {
      await waitFor(() => { if (p.exitCode !== null) throw Error(err); return out.includes('INDEX_WORKER_HELD'); });
      p.kill('SIGKILL'); const [code, signal] = await exited; expect(code).toBeNull(); expect(signal).toBe('SIGKILL');
      const db = new Database(join(ws.store, 'messages.db'));
      try {
        const started = performance.now(); db.exec('BEGIN IMMEDIATE'); expect(performance.now() - started).toBeLessThan(500);
        expect(db.query('SELECT * FROM fixture_owner').all()).toEqual([{ value: 'preserve' }]); db.exec('ROLLBACK');
      } finally { db.close(true); }
    } finally { if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL'); await exited; await closeDatabase(); }
  });
});

test('worker opens behind a writer held beyond five seconds without migration or parent-loop stalls', async () => {
  await withTempWorkspaceEnv('worker-open-locked-', {}, async ws => {
    process.env.PICLAW_DB_IN_MEMORY = '0'; await seed(true);
    const blocker = new Database(join(ws.store, 'messages.db')); blocker.exec('BEGIN IMMEDIATE');
    const go = join(ws.base, 'release');
    const p = Bun.spawn([process.execPath, '--no-env-file', fixture, 'open-locked', go], { env: process.env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    let ticks = 0; const heartbeat = setInterval(() => ticks++, 20);
    const release = setTimeout(() => { blocker.exec('ROLLBACK'); writeFileSync(go, 'released'); }, 6200);
    const deadline = setTimeout(() => p.kill('SIGKILL'), 15000);
    try {
      const [exit, out, err] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
      expect(exit, err).toBe(0); expect(out).toContain('INDEX_WORKER_OPEN'); expect(ticks).toBeGreaterThan(100);
    } finally {
      clearInterval(heartbeat); clearTimeout(release); clearTimeout(deadline);
      if (blocker.inTransaction) blocker.exec('ROLLBACK'); blocker.close(true); await closeDatabase();
      if (p.exitCode === null) p.kill('SIGKILL'); await p.exited;
    }
  });
}, 20000);
