/** Disposable two-process WAL contention probe; never logs cookies or SQL binds. */
import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { assertPathWithinTestFilesystemIsolation } from "../../scripts/test-filesystem-isolation.js";

const [mode, rawHold] = process.argv.slice(2);
assertPathWithinTestFilesystemIsolation(process.env.PICLAW_STORE!,process.env,{allowRoot:false});
assert.equal(process.env.PICLAW_DB_IN_MEMORY,"0");
const path = join(process.env.PICLAW_STORE!,"messages.db"), ready=join(process.env.PICLAW_STORE!,"ready"), go=join(process.env.PICLAW_STORE!,"go"), released=join(process.env.PICLAW_STORE!,"released");
const holdMs=Number(rawHold);assert([0,250,6000].includes(holdMs));
async function waitFile(file:string) { const deadline=performance.now()+10000;while(!existsSync(file)){assert(performance.now()<deadline,"fixture barrier timeout");await Bun.sleep(2);} }
if(mode==="writer") {
  const db=new Database(path);db.run("PRAGMA busy_timeout=5000");db.run("PRAGMA synchronous=2");
  try {
    db.run("BEGIN IMMEDIATE");db.query("UPDATE users SET display_name=display_name WHERE id='default'").run();
    writeFileSync(ready,"ready"); await waitFile(go);
    const cpu=process.cpuUsage(),start=performance.now();await Bun.sleep(holdMs);
    db.run("COMMIT");writeFileSync(released,"released");
    console.log(JSON.stringify({writer:true,holdMs,actualHoldMs:performance.now()-start,cpu:process.cpuUsage(cpu)}));
  }finally{if(db.inTransaction)db.run("ROLLBACK");db.close(true);}
}else{
  assert(["modern","missing","expired","malformed","expired-legacy","malformed-legacy","legacy-token","legacy-id","maintenance"].includes(mode));
  const {initDatabase,getDb,closeDatabase}=await import("../../src/db/connection.js");
  const {createWebSession}=await import("../../src/db/web-sessions.js");
  const {WebAuthGateway}=await import("../../src/channels/web/auth/auth-gateway.js");
  const {TotpFailureTracker}=await import("../../src/channels/web/auth/totp-failure-tracker.js");
  const {WebauthnChallengeTracker}=await import("../../src/channels/web/auth/webauthn-challenges.js");
  const {pruneExpiredAuthState}=await import("../../src/db/auth-maintenance.js");
  let writer: ReturnType<typeof Bun.spawn> | undefined;
  let output: Promise<[string,string,number]> | undefined;
  const fetchOriginal=globalThis.fetch;let network=0;const deny=()=>{network++;throw Error("network forbidden");};globalThis.fetch=Object.assign(deny,{preconnect:deny}) as typeof fetch;
  try {
    initDatabase();const db=getDb();const login=createWebSession("synthetic-cookie","default",3600,"totp");
    if(mode==="expired"||mode==="expired-legacy")db.run("UPDATE web_sessions SET expires_at='2000-01-01T00:00:00.000Z'");
    if(mode==="malformed"||mode==="malformed-legacy")db.run("UPDATE web_sessions SET expires_at='invalid'");
    if(mode==="legacy-token"||mode.endsWith("-legacy"))db.run("UPDATE web_sessions SET token='synthetic-cookie'");
    if(mode==="legacy-id")db.run("UPDATE web_sessions SET session_id=NULL");
    const gateway=new WebAuthGateway({accessMode:"single-user",passkeyMode:"totp-only",totpSecret:"fixture-only",internalSecret:"",sessionTtlSeconds:3600,hasTls:true},{json:(p,s=200)=>Response.json(p,{status:s}),challenges:new WebauthnChallengeTracker(),failureTracker:new TotpFailureTracker()});
    const request=()=>new Request("https://fixture.invalid/agent/me",{headers:{cookie:`piclaw_session=${mode==="missing"?"missing-cookie":"synthetic-cookie"}`}});
    const settings={journal:db.query("PRAGMA journal_mode").all()[0],synchronous:db.query("PRAGMA synchronous").all()[0],busyTimeout:db.query("PRAGMA busy_timeout").all()[0]};
    assert.deepEqual(settings.journal,{journal_mode:"wal"});assert.deepEqual(settings.synchronous,{synchronous:2});assert.deepEqual(settings.busyTimeout,{timeout:0});
    if(holdMs){
      const child=Bun.spawn([process.execPath,"--no-env-file",import.meta.filename,"writer",String(holdMs)],{env:process.env,stdin:"ignore",stdout:"pipe",stderr:"pipe"});
      writer=child;output=Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);await waitFile(ready);
    }
    const instrument=process.argv[4]==="instrument";
    const originals={prepare:db.prepare,query:db.query,run:db.run};let metrics:Record<string,{calls:number;ms:number}>={};
    const proxies=new WeakMap<object,object>();
    if(instrument)for(const key of ["prepare","query"] as const)(db as any)[key]=(sql:string,...params:unknown[])=>{
      const statement=Reflect.apply(originals[key],db,[sql,...params]);if(proxies.has(statement))return proxies.get(statement);
      const proxy=new Proxy(statement,{get(t,k){if(!["get","all","run"].includes(String(k)))return Reflect.get(t,k,t);return(...args:unknown[])=>{const start=performance.now();try{return Reflect.apply(t[k],t,args);}finally{const label=`${sql.trim().split(/\s/)[0]}.${String(k)}`,row=metrics[label]??={calls:0,ms:0};row.calls++;row.ms+=performance.now()-start;}};}});proxies.set(statement,proxy);return proxy;
    };
    if(instrument)db.run=((sql:string,...params:unknown[])=>{const start=performance.now();try{return Reflect.apply(originals.run,db,[sql,...params]);}finally{const label=`direct.${sql.trim().split(/\s/)[0]}`,row=metrics[label]??={calls:0,ms:0};row.calls++;row.ms+=performance.now()-start;}}) as typeof db.run;
    const loop=monitorEventLoopDelay({resolution:1});loop.enable();await Bun.sleep(5);
    const cpu=process.cpuUsage(),start=performance.now();let timerMs=0;
    const tick=new Promise<void>(resolve=>setTimeout(()=>{timerMs=performance.now()-start;resolve();},0));
    if(writer)writeFileSync(go,"go");
    let allowed:boolean|null=null,errorCode:string|null=null;
    try { if(mode==="maintenance")pruneExpiredAuthState(db);else {const req=request();await gateway.preparePrincipal(req);allowed=gateway.isAuthenticated(req);} }
    catch(error){errorCode=(error as {code?:string}).code??"non-sqlite-error";}
    const workMs=performance.now()-start,cpuUsed=process.cpuUsage(cpu),writerReleasedAtReturn=existsSync(released);
    db.prepare=originals.prepare;db.query=originals.query;db.run=originals.run;await tick;await Bun.sleep(5);loop.disable();
    let writerReceipt=null;
    if(output){const[out,err,exit]=await output;assert.equal(exit,0,err);writerReceipt=JSON.parse(out.trim().split("\n").at(-1)!);}
    const invalid=["expired","malformed","expired-legacy","malformed-legacy"].includes(mode);
    const expectBaseline=process.argv.includes("--baseline");
    const writePath=!["modern","missing"].includes(mode) && (expectBaseline||!invalid);
    if(holdMs===6000&&writePath){assert.equal(errorCode,"SQLITE_BUSY");assert.equal(writerReleasedAtReturn,false);assert.equal(allowed,null);}
    else {assert.equal(errorCode,null,JSON.stringify({mode,holdMs,workMs,writerReceipt,writerReleasedAtReturn}));if(mode!=="maintenance")assert.equal(allowed,["modern","legacy-token","legacy-id"].includes(mode));}
    if(holdMs&&!writePath)assert.equal(writerReleasedAtReturn,false,"WAL read should finish before held writer commits");
    // Once the writer ends the same branch returns its correct auth decision.
    if(mode==="maintenance")pruneExpiredAuthState(db);
    else {const req=request();await gateway.preparePrincipal(req);assert.equal(gateway.isAuthenticated(req),["modern","legacy-token","legacy-id"].includes(mode));}
    if(mode==="modern")assert.equal((db.query("SELECT session_id FROM web_sessions").get() as any).session_id,login.session_id);
    if(invalid&&!expectBaseline){
      assert.equal((db.query("SELECT count(*) AS n FROM web_sessions").get() as {n:number}).n,1,"read-only denial must not delete or migrate");
      if(mode.endsWith("-legacy"))assert(db.query("SELECT 1 FROM web_sessions WHERE token='synthetic-cookie'").get());
      pruneExpiredAuthState(db);assert.equal((db.query("SELECT count(*) AS n FROM web_sessions").get() as {n:number}).n,0);
    }
    assert.deepEqual(db.query("PRAGMA quick_check").get(),{quick_check:"ok"});assert.equal(network,0);
    console.log(JSON.stringify({mode,holdMs,instrument,expectBaseline,settings,workMs,timerMs,cpu:cpuUsed,eventLoop:{resolutionMs:1,samples:loop.count,maxMs:loop.max/1e6},allowed,errorCode,writerReleasedAtReturn,writer:writerReceipt,metrics:instrument?metrics:null,network,afterReleaseCorrect:true,scope:"Actual initial gateway.preparePrincipal plus read-only isAuthenticated, or maintenance function, synthetic state; no HTTP socket; writer locks unrelated user update. Timer delay spans synchronous work; CPU profiles include startup."}));
  }finally{if(writer&&writer.exitCode===null){writer.kill("SIGKILL");await writer.exited;}globalThis.fetch=fetchOriginal;closeDatabase();}
}
