// Empty isolated scheduler: real competing SQLite writers, no agent/provider work.
import '../setup-filesystem-isolation.js';
import assert from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import { mkdirSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initDatabase,getDb,closeDatabase } from '../../src/db/connection.js';
import { getStoreDir,getWorkspaceDir } from '../../src/core/config.js';
import { pollScheduledRunsOnce,type SchedulerDeps } from '../../src/task-scheduler.js';
import { createCurrentPiclawScheduledRunStore } from '../../src/service-effects/current-piclaw/scheduled-run-store.js';
import type { ScheduledRunStore } from '../../src/service-effects/contracts/scheduled-run-store.js';
assert.equal(process.env.PICLAW_DB_IN_MEMORY,'0');
mkdirSync(join(getWorkspaceDir(),'.piclaw'),{recursive:true});
writeFileSync(join(getWorkspaceDir(),'.piclaw/config.json'),JSON.stringify({domains:{access:{mode:'single-user'}}}));
initDatabase();const db=getDb(),path=join(getStoreDir(),'messages.db');db.exec('PRAGMA busy_timeout=0');
const blocker=new Database(path),scheduler=new Database(path);scheduler.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0');
const timers:ReturnType<typeof setTimeout>[]=[];let releases=0,claims=0;
async function locked<T>(run:()=>Promise<T>){blocker.exec('BEGIN IMMEDIATE');const prior=releases;timers.push(setTimeout(()=>{releases++;blocker.exec('COMMIT');},40));const value=await run();assert(releases>prior,'writer wait blocked event loop');return value;}
const deps={queue:{enqueueTask(){throw Error('No tasks permitted');}},agentPool:{},async sendMessage(){throw Error('No messages permitted');}} as unknown as SchedulerDeps;
const counts=()=>Object.fromEntries((db.query("SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'service_effect_s07_%' ORDER BY name").all() as {name:string}[]).map(({name})=>[name,(db.query(`SELECT COUNT(*) AS n FROM "${name.replaceAll('"','""')}"`).get() as {n:number}).n]));
try{
 const empty={async claimDue(){claims++;return {ok:true,value:[]};}} as unknown as ScheduledRunStore;
 // Empty reconciliation and claim scans are reads: they must finish without releasing the competing writer.
 blocker.exec('BEGIN IMMEDIATE');
 await pollScheduledRunsOnce(deps,empty);
 assert(blocker.inTransaction,'idle poll must leave the competing writer held');assert.equal(claims,0);assert.equal(releases,0);assert(!db.inTransaction);
 blocker.exec('COMMIT');
 let fail=false,entered=0;
 const built=createCurrentPiclawScheduledRunStore(scheduler,{hitFault:()=>false,recordTrace:()=>{},afterStatement(){if(fail){entered++;throw Object.assign(Error('callback busy'),{code:'SQLITE_BUSY'});}}});
 assert(built.ok,'scheduler store construction');
 const schedulerPolicy=scheduler.query('PRAGMA busy_timeout').get();
 const request=(prefix:string)=>({now:new Date().toISOString(),limit:10,workerId:'fixture-worker',leaseTokenPrefix:prefix,leaseDurationMs:60_000,reclaimAuthorities:[]});
 const result=await locked(()=>built.value.claimDue(request('fixture-contended-claim-00000001')));assert(result.ok);assert.equal(result.value.length,0);assert(!scheduler.inTransaction);
 const before=counts();fail=true;const rejected=await built.value.claimDue(request('fixture-callback-fault-00000002'));assert(!rejected.ok);assert.equal(entered,1);assert.deepEqual(counts(),before);assert(!scheduler.inTransaction);
 assert.deepEqual(db.query('PRAGMA busy_timeout').get(),{timeout:0});assert.deepEqual(scheduler.query('PRAGMA busy_timeout').get(),schedulerPolicy);
 console.log(JSON.stringify({idlePollWhileLocked:true,storeAfterRelease:true,noCallbackReplay:true,rollbackExact:true,noProviderWork:true,busyTimeoutRestored:true}));
}finally{for(const t of timers)clearTimeout(t);if(blocker.inTransaction)blocker.exec('ROLLBACK');blocker.close();scheduler.close();closeDatabase();}
