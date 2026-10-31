import './src/test-guard.js';
import { afterAll, beforeAll, expect, spyOn, test, setDefaultTimeout } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initDatabase, getDb, closeDatabase } from '../../runtime/src/db/connection.js';
import { installTerminalSettlementCompositionSchema } from '../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js';
import { reserveHostRequest } from '../../runtime/durable-engine/src/host-request-accounting.js';
import { modelRequestAccounting } from '../../runtime/src/budget/model-request-accounting.js';
import { ensureBudgetWork } from '../../runtime/src/db/budget-limits.js';

// This regression deliberately holds the writer longer than the old five-second cutoff.
setDefaultTimeout(10000);
let root: Database, blocker: Database, authPath: string, restoreMemory: string | undefined;
let serial = 0;
const model = { provider:'openai-codex', id:'synthetic-admission', api:'openai-codex-responses', maxTokens:100, contextWindow:1000,
  cost:{input:1,output:1,cacheRead:1,cacheWrite:1} } as any;
beforeAll(() => {
  restoreMemory=process.env.PICLAW_DB_IN_MEMORY; process.env.PICLAW_DB_IN_MEMORY='0';
  initDatabase(); root=getDb(); installTerminalSettlementCompositionSchema(root);
  const file=(root.query('PRAGMA database_list').all() as {name:string;file:string}[]).find(row=>row.name==='main')!.file;
  blocker=new Database(file); expect(root.query('PRAGMA journal_mode').get()).toEqual({journal_mode:'wal'});
  const dir=mkdtempSync(join(process.env.PICLAW_WORKSPACE!,'admission-auth-'));authPath=join(dir,'auth.json');
  writeFileSync(authPath,JSON.stringify({'openai-codex':{type:'oauth',access:'synthetic',refresh:'synthetic',accountId:'synthetic-admission',expires:Date.now()+600000}}));
});
afterAll(() => {if(blocker.inTransaction)blocker.exec('ROLLBACK');blocker.close();closeDatabase();if(restoreMemory===undefined)delete process.env.PICLAW_DB_IN_MEMORY;else process.env.PICLAW_DB_IN_MEMORY=restoreMemory;});
function request(signal=new AbortController().signal,authorise=()=>{}) {
  const operationId='model-admission-'+(++serial);
  return {terminalOwner:{signal:new AbortController().signal,assertCurrent:authorise},operationId,chatJid:'web:admission',database:root,authPath,model,signal,assertCurrent:authorise};
}
const originalPolicy=()=>root.query('PRAGMA busy_timeout').get();
async function heldBeyondOldLimit<T>(start:()=>Promise<T>):Promise<T> {
  blocker.exec('BEGIN IMMEDIATE');let settled=false,ticks=0;
  const timer=setInterval(()=>{ticks++;},25),policy=originalPolicy();
  const pending=start().then(value=>({value}),error=>({error})).finally(()=>{settled=true;});
  try {
    await Bun.sleep(5250);
    expect(settled).toBe(false);expect(ticks).toBeGreaterThan(10);expect(originalPolicy()).toEqual(policy);
    blocker.exec('ROLLBACK');const result=await pending;if('error' in result)throw result.error;return result.value;
  } finally {clearInterval(timer);if(blocker.inTransaction)blocker.exec('ROLLBACK');await pending;}
}

test('initial native request write waits beyond five seconds without entering provider work',async()=>{
  const input=request();let sends=0;
  const admitted=await heldBeyondOldLimit(()=>reserveHostRequest(input));expect(admitted).toBeDefined();
  expect(sends).toBe(0);await admitted!.dispatch();sends++;
  expect(sends).toBe(1);expect(root.query('SELECT state FROM budget_request_reservations WHERE id=?').get(admitted!.id)).toEqual({state:'dispatched'});
});

test('reservation after initial work commit also waits for writer release',async()=>{
  const input=request(),original=root.transaction.bind(root);let armed=true,held=false,settled=false;
  const spy=spyOn(root,'transaction').mockImplementation(((body:any)=>{
    const tx=original(body);
    const wrapped=(...args:any[])=>tx(...args);
    return Object.assign(wrapped,{deferred:tx.deferred,exclusive:tx.exclusive,immediate:(...args:any[])=>{
      const result=tx.immediate(...args);
      if(armed&&!root.inTransaction&&root.query('SELECT 1 FROM budget_work WHERE id=?').get('durable-operation:'+input.operationId)){
        armed=false;held=true;blocker.exec('BEGIN IMMEDIATE');
      }
      return result;
    }});

  }) as typeof root.transaction);
  const policy=originalPolicy();const pending=reserveHostRequest(input).then(value=>({value}),error=>({error})).finally(()=>{settled=true;});
  try {
    await Bun.sleep(5250);expect(held).toBe(true);expect(settled).toBe(false);expect(originalPolicy()).toEqual(policy);
    blocker.exec('ROLLBACK');const result=await pending;if('error' in result)throw result.error;
    expect(result.value).toBeDefined();expect(root.query('SELECT state FROM budget_request_reservations WHERE id=?').get(result.value!.id)).toEqual({state:'reserved'});
  } finally {spy.mockRestore();if(blocker.inTransaction)blocker.exec('ROLLBACK');await pending;}
});

test('pre-send dispatch waits beyond five seconds and authorises one send',async()=>{
  const admitted=(await reserveHostRequest(request()))!;let sends=0;
  await heldBeyondOldLimit(async()=>{await admitted.dispatch();sends++;});expect(sends).toBe(1);
  await expect(admitted.dispatch()).rejects.toThrow('already dispatched');expect(sends).toBe(1);
});

test('aborting the native request ends writer waiting with no reservation',async()=>{
  const controller=new AbortController(),input=request(controller.signal),policy=originalPolicy();blocker.exec('BEGIN IMMEDIATE');
  const reason=Error('caller cancelled');const pending=reserveHostRequest(input).then(()=>undefined,error=>error);
  try {await Bun.sleep(30);controller.abort(reason);expect(await pending).toBe(reason);
    expect(root.query('SELECT 1 FROM budget_work WHERE id=?').get('durable-operation:'+input.operationId)).toBeNull();expect(originalPolicy()).toEqual(policy);
  } finally {blocker.exec('ROLLBACK');}
});

test('owner revocation is checked during waiting before acquiring the writer',async()=>{
  let allowed=true;const input=request(undefined,()=>{if(!allowed)throw Error('source revoked');});blocker.exec('BEGIN IMMEDIATE');
  const pending=reserveHostRequest(input).then(()=>undefined,error=>error);
  try {await Bun.sleep(30);allowed=false;expect(String(await pending)).toContain('source revoked');
    expect(root.query('SELECT 1 FROM budget_work WHERE id=?').get('durable-operation:'+input.operationId)).toBeNull();
  } finally {blocker.exec('ROLLBACK');}
});

test('entered SQL busy is terminal and rolls back exactly once',async()=>{
  const input=request(),prepare=root.prepare.bind(root),busy=Object.assign(Error('entered busy'),{code:'SQLITE_BUSY'});let entered=0;
  const spy=spyOn(root,'prepare').mockImplementation(((sql:string)=>{const statement=prepare(sql);
    if(!sql.includes('INSERT OR IGNORE INTO budget_work'))return statement;
    return new Proxy(statement,{get(target,key){if(key!=='run')return Reflect.get(target,key,target);return(...args:any[])=>{entered++;target.run(...args);throw busy;};}});
  }) as typeof root.prepare);
  try {await expect(reserveHostRequest(input)).rejects.toBe(busy);expect(entered).toBe(1);
    expect(root.query('SELECT 1 FROM budget_work WHERE id=?').get('durable-operation:'+input.operationId)).toBeNull();expect(root.inTransaction).toBe(false);
  } finally {spy.mockRestore();}
});

test('explicit bounded admission policy is preserved for other callers',async()=>{
  const id='bounded-'+(++serial);ensureBudgetWork({id,chatJid:'web:bounded',executionKind:'interactive'});
  const accounting=modelRequestAccounting({authorise(){},documentedFree:false,admissionTimeoutMs:30});
  const binding={id,workId:id,chatJid:'web:bounded',providerId:'fixture',modelId:'fixture',accountRef:'fixture',amountMicros:1};
  blocker.exec('BEGIN IMMEDIATE');
  try {await expect(accounting.reserve(binding,new AbortController().signal)).rejects.toMatchObject({code:'SQLITE_BUSY'});
    expect(root.query('SELECT 1 FROM budget_request_reservations WHERE id=?').get(id)).toBeNull();
  } finally {blocker.exec('ROLLBACK');}
});
