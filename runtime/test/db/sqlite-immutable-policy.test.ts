import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { createTempWorkspace } from '../helpers.js';
import { openSqliteRole } from '../../src/db/sqlite-role-policy.js';
import { admitSqliteWrite } from '../../src/db/sqlite-async-admission.js';

for (const role of ['root','sdk','scheduler'] as const) test(`owned ${role} connection has immutable cooperative acquisition policy`, async () => {
  const db = openSqliteRole(':memory:', { role });
  try { expect(db.query('PRAGMA busy_timeout').get()).toEqual({ timeout: 0 }); }
  finally { db.close(); }
});
test('SQL admission has no mutable timeout setters before, during or after a committed body', async () => {
  const db = new Database(':memory:'); db.exec('CREATE TABLE input(value)'); const exec = db.exec.bind(db); let timeoutWrites = 0;
  db.exec = ((sql: string) => { if (/PRAGMA\s+busy_timeout\s*=/i.test(sql)) { timeoutWrites++; throw Error('timeout policy is immutable'); } return exec(sql); }) as typeof db.exec;
  try {
    await expect(admitSqliteWrite(db, () => { db.query('INSERT INTO input VALUES (?)').run('known commit'); return 'receipt'; })).resolves.toBe('receipt');
    expect(timeoutWrites).toBe(0); expect(db.query('SELECT * FROM input').all()).toEqual([{ value: 'known commit' }]);
  } finally { db.exec = exec; db.close(); }
});
test('an external nonzero caller policy is rejected without changing it or entering its body', async () => {
  const db = new Database(':memory:'); db.exec('PRAGMA busy_timeout=731; CREATE TABLE input(value)'); let entered = 0;
  try {
    await expect(admitSqliteWrite(db, () => { entered++; db.exec('INSERT INTO input VALUES(1)'); })).rejects.toThrow('zero busy_timeout');
    expect(entered).toBe(0); expect(db.query('PRAGMA busy_timeout').get()).toEqual({ timeout: 731 }); expect(db.query('SELECT * FROM input').all()).toEqual([]);
  } finally { db.close(); }
});
for (const role of ['root','scheduler'] as const) test(`offline ${role} WAL conflict fails promptly without publishing a handle or sleeping on the event loop`, () => {
  const ws = createTempWorkspace('immutable-wal-'), path = join(ws.base, 'locked.sqlite'), reader = new Database(path);
  reader.exec('PRAGMA journal_mode=DELETE; CREATE TABLE original(value); INSERT INTO original VALUES(42); BEGIN'); reader.query('SELECT * FROM original').all();
  try {
    const start = performance.now(); expect(() => openSqliteRole(path, { role, create: false })).toThrow();
    expect(performance.now() - start).toBeLessThan(500); expect(reader.query('SELECT * FROM original').all()).toEqual([{ value: 42 }]);
  } finally { reader.exec('ROLLBACK'); reader.close(); ws.cleanup(); }
}, 10_000);
