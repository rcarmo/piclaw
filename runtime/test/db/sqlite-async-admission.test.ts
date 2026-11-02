import {expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {join} from 'node:path';
import {renameSync,writeFileSync} from 'node:fs';
import {createTempWorkspace} from '../helpers.js';
import {admitSqliteWrite,isSqliteContention} from '../../src/db/sqlite-async-admission.js';

async function fixture(run:(db:Database,blocker:Database)=>Promise<void>){
  const ws=createTempWorkspace('async-admission-');const path=join(ws.base,'fixture.db');
  const db=new Database(path);db.exec('PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000;CREATE TABLE input(value TEXT)');const blocker=new Database(path);
  try{await run(db,blocker);}finally{blocker.close();db.close();ws.cleanup();}
}
const count=(db:Database)=>(db.query('SELECT count(*) AS n FROM input').get() as {n:number}).n;
const timeout=(db:Database)=>(db.query('PRAGMA busy_timeout').get() as {timeout:number}).timeout;

test('shared contention classification covers extended codes without invoking error getters',()=>{
  for(const code of ['SQLITE_BUSY','SQLITE_BUSY_SNAPSHOT','SQLITE_LOCKED_SHAREDCACHE',5,261,6,262]) expect(isSqliteContention({code})).toBe(true);
  expect(isSqliteContention({errno:517})).toBe(true);
  expect(isSqliteContention(Error('database is locked'))).toBe(false);
  expect(isSqliteContention({code:'SQLITE_CONSTRAINT'})).toBe(false);
  let reads=0;
  expect(isSqliteContention({get code(){reads++;throw Error('getter');}})).toBe(false);
  expect(reads).toBe(0);
});

test('the shared helper rejects a replaced database file before entering its callback',async()=>fixture(async(db,blocker)=>{
  const path=(db.query('PRAGMA database_list').all() as {name:string;file:string}[]).find(row=>row.name==='main')!.file;
  blocker.exec('BEGIN IMMEDIATE');let entered=0;
  const pending=admitSqliteWrite(db,()=>{entered++;db.exec("INSERT INTO input VALUES('stale')");});
  await Bun.sleep(0);renameSync(path,path+'.displaced');writeFileSync(path,'replacement');
  blocker.exec('ROLLBACK');await expect(pending).rejects.toThrow('database file changed');
  expect(entered).toBe(0);expect(count(db)).toBe(0);expect(db.inTransaction).toBe(false);expect(timeout(db)).toBe(5000);
}));

test('contended admission yields while locked and commits once only after release',async()=>fixture(async(db,blocker)=>{
  blocker.exec('BEGIN IMMEDIATE');let auth=0,operations=0;
  const pending=admitSqliteWrite(db,()=>{operations++;db.query('INSERT INTO input VALUES(?)').run('one');return 7;},()=>{auth++;},new AbortController().signal);
  await Bun.sleep(10);expect(operations).toBe(0);expect(timeout(db)).toBe(5000);expect(count(db)).toBe(0);
  blocker.exec('ROLLBACK');expect(await pending).toBe(7);expect(count(db)).toBe(1);expect(operations).toBe(1);expect(auth).toBe(2);expect(timeout(db)).toBe(5000);
}));
test('cancelled or revoked admission never writes or publishes success',async()=>fixture(async(db,blocker)=>{
  blocker.exec('BEGIN IMMEDIATE');const controller=new AbortController();
  const pending=admitSqliteWrite(db,()=>db.exec("INSERT INTO input VALUES('cancelled')"),()=>{},controller.signal);await Bun.sleep(0);controller.abort(Error('cancelled'));await expect(pending).rejects.toThrow('cancelled');blocker.exec('ROLLBACK');expect(count(db)).toBe(0);expect(timeout(db)).toBe(5000);
  blocker.exec('BEGIN IMMEDIATE');let allowed=true;
  const revoked=admitSqliteWrite(db,()=>db.exec("INSERT INTO input VALUES('revoked')"),()=>{if(!allowed)throw Error('revoked');},new AbortController().signal);await Bun.sleep(0);allowed=false;blocker.exec('ROLLBACK');await expect(revoked).rejects.toThrow('revoked');expect(count(db)).toBe(0);
}));
test('deadline is bounded and all errors restore connection policy and rollback',async()=>fixture(async(db,blocker)=>{
  blocker.exec('BEGIN IMMEDIATE');const start=performance.now();
  await expect(admitSqliteWrite(db,()=>db.exec("INSERT INTO input VALUES('late')"),()=>{},new AbortController().signal,30)).rejects.toThrow();expect(performance.now()-start).toBeLessThan(500);expect(timeout(db)).toBe(5000);blocker.exec('ROLLBACK');expect(count(db)).toBe(0);
  await expect(admitSqliteWrite(db,()=>{db.exec("INSERT INTO input VALUES('bad')");throw Error('unrelated');},()=>{},new AbortController().signal)).rejects.toThrow('unrelated');expect(count(db)).toBe(0);expect(timeout(db)).toBe(5000);
  let checks=0;await expect(admitSqliteWrite(db,()=>db.exec("INSERT INTO input VALUES('post-revoke')"),()=>{if(++checks===2)throw Error('post-revoked');},new AbortController().signal)).rejects.toThrow('post-revoked');expect(count(db)).toBe(0);
}));
test('concurrent read-modify-write retries see fresh committed state without lost updates',async()=>fixture(async(db,blocker)=>{
  blocker.exec('BEGIN IMMEDIATE');const signal=new AbortController().signal;
  const append=(value:string)=>admitSqliteWrite(db,()=>{const before=count(db);db.query('INSERT INTO input VALUES(?)').run(`${before}:${value}`);},()=>{},signal);
  const first=append('a'),second=append('b');await Bun.sleep(0);blocker.exec('ROLLBACK');await Promise.all([first,second]);
  expect(count(db)).toBe(2);expect(db.query('SELECT value FROM input ORDER BY rowid').all()).toEqual([{value:'0:a'},{value:'1:b'}]);expect(timeout(db)).toBe(5000);
}));

for (const code of ['SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT', 'SQLITE_LOCKED', 261]) {
  test(`callback-raised contention is terminal and never repeats an external effect; code=${code}`, async()=>fixture(async(db)=>{
    const failure=Object.assign(Error('callback contention'),{code});
    let effects=0,rollbacks=0;
    const pending=admitSqliteWrite(db,()=>{
      effects++; db.exec("INSERT INTO input VALUES('rolled back')");
      if(effects===1) throw failure;
      return 7;
    },()=>{},new AbortController().signal,5000,()=>{},()=>{rollbacks++;});
    await expect(pending).rejects.toBe(failure);
    expect(effects).toBe(1); expect(rollbacks).toBe(1); expect(count(db)).toBe(0);
    expect(db.inTransaction).toBe(false); expect(timeout(db)).toBe(5000);
  }));
}
for (const phase of ['before','after'] as const) {
  test(`authorization contention in ${phase} phase is never replayed`,async()=>fixture(async(db)=>{
    const failure=Object.assign(Error('authorization busy'),{code:'SQLITE_BUSY'});
    let operations=0,checks=0,rollbacks=0;
    await expect(admitSqliteWrite(db,()=>{operations++;db.exec("INSERT INTO input VALUES('guarded')");},current=>{
      checks++; if(current===phase)throw failure;
    },new AbortController().signal,40,()=>{},()=>{rollbacks++;})).rejects.toBe(failure);
    expect(checks).toBe(phase==='before'?1:2);expect(operations).toBe(phase==='before'?0:1);
    expect(rollbacks).toBe(1);expect(count(db)).toBe(0);expect(timeout(db)).toBe(5000);
  }));
}
test('commit contention never replays a callback while a rollback-journal reader is pinned',async()=>fixture(async(db,reader)=>{
  db.exec('PRAGMA journal_mode=DELETE');
  reader.exec('BEGIN');reader.query('SELECT * FROM input').all();
  let operations=0,rollbacks=0;
  try {
    await expect(admitSqliteWrite(db,()=>{operations++;db.exec("INSERT INTO input VALUES('blocked commit')");},()=>{},
      new AbortController().signal,40,()=>{},()=>{rollbacks++;})).rejects.toThrow();
    expect(operations).toBe(1);expect(rollbacks).toBe(1);expect(db.inTransaction).toBe(false);
    expect(count(db)).toBe(0);expect(timeout(db)).toBe(5000);
  } finally {reader.exec('ROLLBACK');}
}));
test('nested callback contention rolls back only its savepoint and preserves the outer transaction',async()=>fixture(async(db)=>{
  db.exec("BEGIN IMMEDIATE;INSERT INTO input VALUES('outer')");
  const failure=Object.assign(Error('inner busy'),{code:'SQLITE_BUSY'});let operations=0;
  try {
    await expect(admitSqliteWrite(db,()=>{operations++;db.exec("INSERT INTO input VALUES('inner')");throw failure;},()=>{},
      new AbortController().signal,40)).rejects.toBe(failure);
    expect(operations).toBe(1);expect(db.inTransaction).toBe(true);
    expect(db.query('SELECT value FROM input').all()).toEqual([{value:'outer'}]);expect(timeout(db)).toBe(5000);
  } finally {db.exec('ROLLBACK');}
  expect(count(db)).toBe(0);
}));
test('nested compensation is rejected before authorization or callback entry',async()=>fixture(async(db)=>{
  db.exec("BEGIN IMMEDIATE;INSERT INTO input VALUES('outer')");
  let operations=0,authorizations=0,compensations=0;
  try {
    await expect(admitSqliteWrite(db,()=>{operations++;db.exec("INSERT INTO input VALUES('inner')");},()=>{authorizations++;},
      new AbortController().signal,5000,()=>{},()=>{compensations++;})).rejects.toThrow('Nested SQLite admission');
    expect(operations).toBe(0);expect(authorizations).toBe(0);expect(compensations).toBe(0);
    expect(db.inTransaction).toBe(true);expect(timeout(db)).toBe(5000);
    expect(db.query('SELECT value FROM input').all()).toEqual([{value:'outer'}]);
  } finally {db.exec('ROLLBACK');}
  expect(count(db)).toBe(0);
}));

test('compensation cannot join an outer transaction started during acquisition backoff',async()=>fixture(async(db,blocker)=>{
  blocker.exec('BEGIN IMMEDIATE');
  let operations=0,authorizations=0,compensations=0;
  const pending=admitSqliteWrite(db,()=>{operations++;db.exec("INSERT INTO input VALUES('inner')");},()=>{authorizations++;},
    new AbortController().signal,5000,()=>{},()=>{compensations++;});
  // The initial failed BEGIN retains the existing standalone cleanup contract.
  expect(compensations).toBe(1);
  blocker.exec('ROLLBACK');db.exec("BEGIN IMMEDIATE;INSERT INTO input VALUES('outer')");
  try {
    await expect(pending).rejects.toThrow('Nested SQLite admission');
    expect(operations).toBe(0);expect(authorizations).toBe(0);expect(compensations).toBe(1);
    expect(db.inTransaction).toBe(true);expect(timeout(db)).toBe(5000);
    expect(db.query('SELECT value FROM input').all()).toEqual([{value:'outer'}]);
  } finally {db.exec('ROLLBACK');}
  expect(count(db)).toBe(0);
}));

test('a changed binding while awaiting acquisition prevents callback entry without touching the stale handle',async()=>fixture(async(db,blocker)=>{
  blocker.exec('BEGIN IMMEDIATE');let valid=true,operations=0;
  const pending=admitSqliteWrite(db,()=>{operations++;},()=>{},new AbortController().signal,5000,()=>{if(!valid)throw Error('binding revoked');});
  await Bun.sleep(0);valid=false;blocker.exec('ROLLBACK');
  await expect(pending).rejects.toThrow('binding revoked');expect(operations).toBe(0);expect(count(db)).toBe(0);expect(timeout(db)).toBe(5000);
}));


test("admission rejects async callbacks before their SQL prefix executes", () => fixture(async (db) => {
  let entered = false;
  // @ts-expect-error Deliberate runtime misuse: async work must be rejected before entry.
  await expect(admitSqliteWrite(db, async () => {
    entered = true; db.run("INSERT INTO input(value) VALUES ('async-prefix')");
  })).rejects.toThrow("synchronous");
  expect(entered).toBe(false); expect(count(db)).toBe(0);
}));

test("admission rolls back SQL when a synchronous callback returns a thenable", () => fixture(async (db) => {
  let entered = 0;
  // @ts-expect-error Deliberate runtime misuse: a thenable result must roll back its SQL prefix.
  await expect(admitSqliteWrite(db, () => {
    entered++; db.run("INSERT INTO input(value) VALUES ('thenable-prefix')");
    return { then() { throw new Error("thenable must not execute"); } };
  })).rejects.toThrow("synchronous");
  expect(entered).toBe(1); expect(count(db)).toBe(0);
}));

test("post-commit timeout restoration failure cannot turn durable success into not_applied", () => fixture(async (db) => {
  const exec = db.exec.bind(db); let restored = 0;
  try {
    exec("PRAGMA busy_timeout=71");
    db.exec = ((sql: string) => {
      if (sql === "PRAGMA busy_timeout=71") { restored++; throw new Error("injected restoration failure"); }
      return exec(sql);
    }) as typeof db.exec;
    await expect(admitSqliteWrite(db, () => {
      db.run("INSERT INTO input(value) VALUES ('committed')"); return "receipt";
    })).resolves.toBe("receipt");
    expect(restored).toBe(1);
    expect(db.query("SELECT value FROM input").all()).toEqual([{ value: "committed" }]);
  } finally { db.exec = exec; }
}));


test("failed diagnostics cannot replace a completed transaction result", () => fixture(async (db) => {
  const exec = db.exec.bind(db), write = process.stderr.write;
  try {
    exec("PRAGMA busy_timeout=71");
    db.exec = ((sql: string) => {
      if (sql === "PRAGMA busy_timeout=71") throw new Error("injected restoration failure");
      return exec(sql);
    }) as typeof db.exec;
    process.stderr.write = (() => { throw new Error("injected diagnostic failure"); }) as typeof process.stderr.write;
    await expect(admitSqliteWrite(db, () => {
      db.run("INSERT INTO input VALUES ('committed')"); return "receipt";
    })).resolves.toBe("receipt");
    expect(count(db)).toBe(1);
  } finally { db.exec = exec; process.stderr.write = write; }
}));

test("nested successful admission preserves outer durability ownership despite restoration failure", () => fixture(async (db, blocker) => {
  const exec = db.exec.bind(db);
  try {
    exec("PRAGMA busy_timeout=71;BEGIN IMMEDIATE");
    db.exec = ((sql: string) => {
      if (sql === "PRAGMA busy_timeout=71") throw new Error("injected restoration failure");
      return exec(sql);
    }) as typeof db.exec;
    await expect(admitSqliteWrite(db, () => { db.run("INSERT INTO input VALUES ('savepoint')"); return "saved"; })).resolves.toBe("saved");
    expect(db.inTransaction).toBe(true); expect(count(db)).toBe(1); expect(count(blocker)).toBe(0);
    exec("ROLLBACK"); expect(count(db)).toBe(0);
  } finally { db.exec = exec; if (db.inTransaction) exec("ROLLBACK"); }
}));

test("rejected Promise returned by a synchronous wrapper is contained without executing it again", () => fixture(async (db) => {
  let calls = 0;
  // @ts-expect-error Deliberate runtime misuse: an already rejected Promise must remain contained.
  await expect(admitSqliteWrite(db, () => {
    calls++; db.run("INSERT INTO input VALUES ('prefix')");
    return Promise.reject(new Error("already rejected async work"));
  })).rejects.toThrow("synchronous");
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(calls).toBe(1); expect(count(db)).toBe(0);
}));
