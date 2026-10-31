import { expect,test } from 'bun:test';
import { isolateBudgetTestDatabase } from './fixture.js';
import { createTempWorkspace } from '../helpers.js';
import { ensureBudgetWork,saveBudgetCap } from '../../src/db/budget-limits.js';
import { getBudgetRequest } from '../../src/db/budget-request-reservations.js';
import { getDb } from '../../src/db/connection.js';
import { admitBudgetRequest,admitBudgetRequestDispatch } from '../../src/budget/request-reservation-admission.js';
isolateBudgetTestDatabase();
const binding={id:'async-request',workId:'async-work',chatJid:'web:async',providerId:'fixture',modelId:'fixture',accountRef:'fixture',amountMicros:60};
function fixture(){ensureBudgetWork({id:binding.workId,chatJid:binding.chatJid,executionKind:'interactive'});saveBudgetCap({scope:'task',metric:'api_usd_micros',amount:100,workId:binding.workId});}
test('async host admission snapshots caller binding and verifies authority before commit',async()=>{
 fixture();let checks=0;const captured={...binding};const row=await admitBudgetRequest(captured,{signal:new AbortController().signal,authorise(){checks++;captured.amountMicros=1;}});
 expect(row.amount_microusd).toBe(60);expect(checks).toBe(2);
 expect((await admitBudgetRequestDispatch(binding,{signal:new AbortController().signal,authorise(){}})).state).toBe('dispatched');
});
test('revoked post-mutation admission rolls back its reservation',async()=>{
 fixture();let checks=0;
 await expect(admitBudgetRequest(binding,{signal:new AbortController().signal,authorise(){if(++checks===2)throw Error('revoked');}})).rejects.toThrow('revoked');
 expect(getBudgetRequest(binding.id)).toBeNull();
});
test('dispatch authority revoked after mutation rolls back to its original hold',async()=>{
 fixture();await admitBudgetRequest(binding,{signal:new AbortController().signal,authorise(){}});let checks=0;
 await expect(admitBudgetRequestDispatch(binding,{signal:new AbortController().signal,authorise(){if(++checks===4)throw Error('revoked-after-dispatch');}})).rejects.toThrow('revoked-after-dispatch');
 expect(checks).toBe(4);expect(getBudgetRequest(binding.id)?.state).toBe('reserved');
});
test('dispatch aborted after mutation rolls back to its original hold',async()=>{
 fixture();await admitBudgetRequest(binding,{signal:new AbortController().signal,authorise(){}});let checks=0;const aborter=new AbortController();
 await expect(admitBudgetRequestDispatch(binding,{signal:aborter.signal,authorise(){if(++checks===4)aborter.abort(Error('aborted-after-dispatch'));}})).rejects.toThrow('aborted-after-dispatch');
 expect(getBudgetRequest(binding.id)?.state).toBe('reserved');
});
// The first check is inside the helper callback; dispatch adds two inner
// authority checks before its UPDATE. None may be mistaken for lock acquisition.
for (const kind of ['reservation','dispatch'] as const) {
 for (const failAt of kind === 'reservation' ? [1,2] : [1,2,3,4]) {
  test(`${kind} authority SQLITE_BUSY at check ${failAt} is terminal and rolls back SQL`,async()=>{
   fixture();const database=getDb();const signal=new AbortController().signal;
   if(kind==='dispatch')await admitBudgetRequest(binding,{signal,authorise(){}});
   const snapshot=()=>['budget_request_reservations','budget_work','budget_caps','budget_decisions','token_usage']
    .map(table=>database.query(`SELECT * FROM ${table} ORDER BY rowid`).all());
   const before=snapshot();const policy=database.query('PRAGMA busy_timeout').get();
   const busy=Object.assign(Error('authority busy'),{code:'SQLITE_BUSY'});let checks=0;
   const admit=kind==='reservation'?admitBudgetRequest:admitBudgetRequestDispatch;
   await expect(admit(binding,{signal,authorise(){
    checks++;
    expect(database.inTransaction).toBe(true);
    if(checks===failAt){
     // Observe the actual write before rejecting the post-mutation check.
     expect(getBudgetRequest(binding.id)?.state??null).toBe(kind==='reservation'
      ? failAt===2?'reserved':null : failAt===4?'dispatched':'reserved');
     throw busy;
    }
   }})).rejects.toBe(busy);
   expect(checks).toBe(failAt);
   expect(snapshot()).toEqual(before);
   expect(getBudgetRequest(binding.id)?.state??null).toBe(kind==='dispatch'?'reserved':null);
   expect(database.inTransaction).toBe(false);
   expect(database.query('PRAGMA busy_timeout').get()).toEqual(policy);
  });
 }
}
for (const kind of ['reservation','dispatch'] as const) {
 test(`${kind} pre-acquisition denial enters no authority or SQL callback and is not retried`,async()=>{
  fixture();const database=getDb(),signal=new AbortController().signal;
  if(kind==='dispatch')await admitBudgetRequest(binding,{signal,authorise(){}});
  const snapshot=()=>['budget_request_reservations','budget_work','budget_caps','budget_decisions','token_usage']
   .map(table=>database.query(`SELECT * FROM ${table} ORDER BY rowid`).all());
  const before=snapshot(),policy=database.query('PRAGMA busy_timeout').get();
  const denied=Object.assign(Error('unentered dependency'),{code:'SQLITE_BUSY'});let preflight=0,authority=0;
  const admit=kind==='reservation'?admitBudgetRequest:admitBudgetRequestDispatch;
  await expect(admit(binding,{signal,authorise(){authority++;},beforeAcquire(){
   preflight++;expect(database.inTransaction).toBe(false);throw denied;
  }})).rejects.toBe(denied);
  expect(preflight).toBe(1);expect(authority).toBe(0);expect(snapshot()).toEqual(before);
  expect(database.inTransaction).toBe(false);expect(database.query('PRAGMA busy_timeout').get()).toEqual(policy);
 });
 test(`${kind} pure preflight stays outside the unchanged transaction authority contract`,async()=>{
  fixture();const database=getDb(),signal=new AbortController().signal;
  if(kind==='dispatch')await admitBudgetRequest(binding,{signal,authorise(){}});
  let preflight=0,authority=0;const admit=kind==='reservation'?admitBudgetRequest:admitBudgetRequestDispatch;
  const row=await admit(binding,{signal,beforeAcquire(){preflight++;expect(database.inTransaction).toBe(false);},
   authorise(){authority++;expect(database.inTransaction).toBe(true);}});
  expect(preflight).toBe(2);expect(authority).toBe(kind==='reservation'?2:4);
  expect(row.state).toBe(kind==='reservation'?'reserved':'dispatched');
 });
}
for (const mode of ['async','promise','nonvoid'] as const) test(`pre-acquisition ${mode} guard cannot enter funding or authority`,async()=>{
 fixture();let body=0,authority=0;
 const beforeAcquire=mode==='async'?async()=>{body++;}:mode==='promise'?()=>{body++;return Promise.reject(Error('synthetic preflight rejection'));}:()=>{body++;return 17;};
 await expect(admitBudgetRequest(binding,{signal:new AbortController().signal,beforeAcquire,authorise(){authority++;}})).rejects.toThrow('Request pre-acquisition guard must');
 await Bun.sleep(0);expect(body).toBe(mode==='async'?0:1);expect(authority).toBe(0);expect(getBudgetRequest(binding.id)).toBeNull();
});

test('actual reservation contention yields to timers, restores policy and denies revocation',async()=>{
 const entry=new URL('../fixtures/budget-request-admission-disk.ts',import.meta.url).pathname;
 const launcher=new URL('../../scripts/local-test-priority.ts',import.meta.url).pathname;
 const workspace=createTempWorkspace('budget-admission-child-');
 const child=Bun.spawn([process.execPath,'--no-env-file',launcher,'--','--env','PICLAW_DB_IN_MEMORY=0','--env',`PICLAW_WORKSPACE=${workspace.workspace}`,'--env',`PICLAW_STORE=${workspace.store}`,'--env',`PICLAW_DATA=${workspace.data}`,'--',process.execPath,'--no-env-file',entry],{stdin:'ignore',stdout:'pipe',stderr:'pipe'});
 const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
 try{const [exit,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);expect(exit,stderr).toBe(0);expect(JSON.parse(stdout.trim().split('\n').at(-1)!)).toMatchObject({reservedAfterRelease:true,revokedDispatchDenied:true,cancelledNoHold:true,busyTimeoutRestored:true,replacedDatabaseDenied:true});}
 finally{clearTimeout(timer);if(child.exitCode===null)child.kill('SIGKILL');await child.exited;workspace.cleanup();}
},15000);
