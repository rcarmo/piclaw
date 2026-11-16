import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { initDatabase, getDb, closeDatabase } from '../src/db/connection.js';
import { resolveRuntimeConfigPaths } from '../src/core/config-paths.js';
import manifest from './fixtures/historical-account-objects.json';

const removed = [
  'retire-historical-accounts.ts', 'lib/historical-account-copies.ts',
  'lib/historical-account-retirement.ts', 'lib/historical-account-schema.json',
];
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

test('historical cleanup entrypoints are absent; the original object declaration remains test data', () => {
  for (const path of removed) expect(existsSync(new URL(`../scripts/${path}`, import.meta.url))).toBe(false);
  expect(manifest.source).toBe('cdc214fcc06349dc9d315c2d17c866764e4557d5');
  expect(manifest.objects).toHaveLength(157);
  expect(manifest.names).toHaveLength(37);
});

test('fresh native Root does not initialise the historical account cohort', async () => {
  await closeDatabase();
  try {
    process.env.PICLAW_DB_IN_MEMORY = '1'; initDatabase();
    const names = new Set((getDb().query('SELECT name FROM sqlite_schema').all() as { name: string }[]).map(row => row.name));
    expect(manifest.names.filter(name => names.has(name))).toEqual([]);
    expect(names.has('users')).toBe(true);
    expect(names.has('web_sessions')).toBe(true);
  } finally { await closeDatabase(); }
});

test('v3 startup and removed prepare/apply commands leave the selected source unchanged and create no copies', async () => {
  await closeDatabase();
  const root = mkdtempSync(join(process.env.TMPDIR!, 'retired-account-cli-'));
  const paths = resolveRuntimeConfigPaths({ env: { PICLAW_WORKSPACE: root, PICLAW_STORE: root, PICLAW_DB_IN_MEMORY: '0' } });
  const db = new Database(paths.databasePath);
  db.exec("PRAGMA user_version=3; CREATE TABLE legacy_accounts(id TEXT PRIMARY KEY,payload BLOB); INSERT INTO legacy_accounts VALUES('old',x'00ff')");
  db.close();
  const before = digest(paths.databasePath), output = join(root, 'must-not-exist');
  try {
    expect(() => initDatabase(paths)).toThrow('session-import');
    expect(digest(paths.databasePath)).toBe(before);
    for (const action of ['prepare', 'apply']) {
      const child = Bun.spawnSync([process.execPath, new URL('../scripts/retire-historical-accounts.ts', import.meta.url).pathname, action, paths.databasePath, output], { stdout: 'pipe', stderr: 'pipe' });
      expect(child.exitCode).not.toBe(0);
      expect(digest(paths.databasePath)).toBe(before);
      expect(existsSync(output)).toBe(false);
    }
  } finally { await closeDatabase(); rmSync(root, { recursive: true, force: true }); }
});
