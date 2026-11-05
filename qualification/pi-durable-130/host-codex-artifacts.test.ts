import "./src/test-guard.js";
import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { isSqliteContention } from '../../runtime/src/db/sqlite-async-admission.js';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostCodexArtifactStore, createHostCodexAnswerMaterializer, renderCodexAnswer } from '../../runtime/durable-engine/src/host-codex-artifacts.ts';
test('actual Root metadata and file-pill refs survive close/reopen with source guards', async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'codex-root-'));
 let root=new Database(join(cwd,'root.sqlite'));
 try {
  root.exec(`CREATE TABLE extension_kv(extension_id TEXT,scope TEXT,scope_key TEXT,key TEXT,value TEXT,updated_at TEXT,PRIMARY KEY(extension_id,scope,scope_key,key))`);
  const path='.pi/openai-codex-images/call-response.png'; await mkdir(join(cwd,'.pi/openai-codex-images'),{recursive:true}); await writeFile(join(cwd,path),'actual-image');
  let active=true;const assertCurrent=()=>{if(!active)throw Error('revoked');};
  const operation=Object.freeze({id:'codex-source',sessionId:'session',cwd,model:{provider:'openai-codex',id:'test',api:'openai-codex-responses'},signal:new AbortController().signal,assertCurrent});
  const binding={hostOperationId:'sdk-run:2:7',chatJid:'actual-chat',assertCurrent,write:<T>(body:()=>T):T=>root.transaction(body)()};
  let store=createHostCodexArtifactStore(root,operation,binding);
  const activity={kind:'image' as const,savedImage:{absolutePath:join(cwd,path),relativePath:path,callId:'call',outputFormat:'png'}};
  await store.publish(operation,activity); expect(store.refs()[0]?.sha256).toHaveLength(64);
  root.close(); root=new Database(join(cwd,'root.sqlite')); store=createHostCodexArtifactStore(root,operation,binding);
  expect(store.filePills()).toBe(`Files:\n- ${path}`);expect(store.refs()).toHaveLength(1);
  expect(await renderCodexAnswer(root,cwd,binding.chatJid,binding.hostOperationId,'SDK result',assertCurrent)).toBe(`SDK result\n\nFiles:\n- ${path}`);
  expect(root.query("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'service_effect%'").get()).toEqual({n:0});
  await expect(store.publish(Object.freeze({...operation}),activity)).rejects.toThrow('mismatch');
  await expect(store.publish(operation,{kind:'image',savedImage:{...activity.savedImage,absolutePath:join(cwd,'root.sqlite'),relativePath:'root.sqlite'}})).rejects.toThrow('outside');
  active=false;expect(()=>store.refs()).toThrow('revoked');
 }finally{root.close();await rm(cwd,{recursive:true,force:true});}
});

import { initDatabase, getDb, closeDatabase } from '../../runtime/src/db/connection.js';
import { installTerminalSettlementCompositionSchema } from '../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js';
import { createCurrentPiclawServiceWorkStore } from '../../runtime/src/service-effects/current-piclaw/service-work-store.js';
import { at, effect, sealed, value } from './src/host-handoff.js';
import { openFixture, context } from './src/fixture.js';
import { SqliteStorage } from '../../runtime/durable-engine/qualification/sqlite.ts';
import { BunSqliteDatabase } from '../../runtime/durable-engine/src/bun-sqlite.js';
import { applicationOwnership, createApplicationBootstrapBundle } from '../../runtime/durable-engine/src/application-bootstrap.js';
import { acquireRuntimeLock } from '../../runtime/src/runtime/single-instance.js';
import { hashCanonicalRequest } from '../../runtime/src/service-effects/contracts/common.js';

async function sourceRoot(body: (f: any) => Promise<void>, native = false) {
 const cwd=await mkdtemp(join(process.env.PICLAW_WORKSPACE!,'codex-projection-'));
 process.env.PICLAW_DB_IN_MEMORY='1'; initDatabase(); getDb().query('VACUUM INTO ?').run(join(cwd,'root.sqlite')); await closeDatabase();
 const root=new Database(join(cwd,'root.sqlite')); root.exec('PRAGMA foreign_keys=ON'); installTerminalSettlementCompositionSchema(root);
 const lock=acquireRuntimeLock({lockPath:join(cwd,'owner.lock'),strictOwnership:true,disabled:false});
 const assertOwner=()=>lock.assertCurrentOwner();
 const work=value(createCurrentPiclawServiceWorkStore(root,{hitFault:()=>false,recordTrace(){},validateAcceptance(){assertOwner();return true;}}));
 let source:any,operation:any;
 async function accept(){
 source=value(await work.acceptSource(sealed({effect:effect('image-source'),chatJid:'web:images',sourceId:'image-source',kind:'message',payloadRef:native ? 'message-row:1' : 'input:image',targetOperationId:null,parentSourceSeq:null,acceptedAt:at,createWakeIntent:false})));
 const claimed=value(await work.claimNext(sealed({effect:effect('image-claim'),chatJid:source.chatJid,expectedFrontier:0,newOperationId:'host-images',claimedAt:at})))!;
 let bound=native ? claimed.operation : value(await work.bindHarness(sealed({ effect:effect('image-bind',claimed.operation.operationId,source.sourceSeq), expectedVersion:claimed.operation.version, sessionId:'image-session', harnessOperationId:'1' })));
 if(!native){const finish={effect:{...effect('image-settle',bound.operationId,source.sourceSeq),operationId:bound.operationId},expectedVersion:bound.version,expectedHarness:bound.harness!};finish.effect.requestHash=hashCanonicalRequest({method:'finishHarness.v1',...finish} as any);bound=value(await work.finishHarness(finish));}
 operation=Object.freeze({...bound,claimedSourceSeqs:Object.freeze([...bound.claimedSourceSeqs]),harness:bound.harness ? Object.freeze({...bound.harness}) : null});
 }
 if(!native)await accept();
 const paths:string[]=[];
 async function publish(n:number) {
  const path=`.pi/openai-codex-images/call-${n}.png`; await mkdir(join(cwd,'.pi/openai-codex-images'),{recursive:true}); await writeFile(join(cwd,path),`image-${n}`);
  const actual=Object.freeze({id:`model-request-${n}`,sessionId:'session',cwd,model:{provider:'openai-codex',id:'test',api:'openai-codex-responses'},signal:new AbortController().signal,assertCurrent:assertOwner});
  const store=createHostCodexArtifactStore(root,actual,{hostOperationId:operation.operationId,chatJid:operation.chatJid,assertCurrent:assertOwner,write:body=>root.transaction(body)()});
  await store.publish(actual,{kind:'image',savedImage:{absolutePath:join(cwd,path),relativePath:path,callId:`call-${n}`,outputFormat:'png'}});paths.push(path);return store;
 }
 try {await body({root,cwd,get operation(){return operation;},work,get source(){return source;},accept,publish,paths,assertOwner,lock});}
 finally {root.close();lock.release();await rm(cwd,{recursive:true,force:true});}
}

test('six actual sourceRoot model requests aggregate under host identity; projection verifies bytes without changing canonical answer',()=>sourceRoot(async f=>{
 let store;for(let n=0;n<6;n++)store=await f.publish(n);
 expect(store.refs().map((r:any)=>r.codexOperationId)).toEqual(Array.from({length:6},(_,n)=>`model-request-${n}`));
 const writes=new Map<string,string>();const answer={text:'canonical bytes\n',message:{content:[]}};
 const materialize=createHostCodexAnswerMaterializer({...f,answers:{put(ref,text){writes.set(ref,text);}}});
 const result=await materialize('stable-ref',answer as any,f.operation);
 expect(result).toEqual({contentRef:'stable-ref',contentBlocksRef:null,mediaIds:[]});
 expect(answer.text).toBe('canonical bytes\n');expect(writes.get('stable-ref')).toBe(answer.text+'\n\nFiles:\n'+f.paths.map((p:string)=>`- ${p}`).join('\n'));
 await writeFile(join(f.cwd,f.paths[0]),'tampered');writes.clear();
 await expect(materialize('stable-ref',answer as any,f.operation)).rejects.toThrow('changed');expect(writes.size).toBe(0);
}));

test('source version revoked during filesystem await prevents owned answer write',()=>sourceRoot(async f=>{
 await f.publish(0);let checks=0,writes=0;
 const materialize=createHostCodexAnswerMaterializer({...f,assertOwner(){f.assertOwner();if(++checks===5)f.root.query('UPDATE service_effect_s01_operations SET version=version+1 WHERE operation_id=?').run(f.operation.operationId);},answers:{put(){writes++;}}});
 await expect(materialize('ref',{text:'canonical',message:{}} as any,f.operation)).rejects.toThrow('authority');expect(writes).toBe(0);
}));

test('wrong chat/host metadata and revoked source fail before answer write',()=>sourceRoot(async f=>{
 await f.publish(0);let writes=0;const materialize=createHostCodexAnswerMaterializer({...f,answers:{put(){writes++;}}});
 const row=f.root.query("SELECT value FROM extension_kv WHERE extension_id='codex-conversion'").get() as any;
 const record=JSON.parse(row.value);for(const field of ['hostOperationId','chatJid']){
  f.root.query("UPDATE extension_kv SET value=? WHERE extension_id='codex-conversion'").run(JSON.stringify({...record,[field]:'wrong'}));
  await expect(materialize('ref',{text:'canonical',message:{}} as any,f.operation)).rejects.toThrow('owner mismatch');
 }
 f.root.query("UPDATE extension_kv SET value=? WHERE extension_id='codex-conversion'").run(row.value);
 f.root.query("UPDATE service_effect_s01_sources SET state='consumed' WHERE chat_jid=?").run(f.operation.chatJid);
 await expect(materialize('ref',{text:'canonical',message:{}} as any,f.operation)).rejects.toThrow('source revoked');expect(writes).toBe(0);
}));

import { InMemoryEffectPayloadResolver } from '../../runtime/src/service-effects/testing/in-memory-payload-resolver.js';
import { Harness } from '../../runtime/durable-engine/qualification/durable.ts';

test('native application bootstrap forwards Codex projection before EF-S02; public SDK history stays canonical after reopen',()=>sourceRoot(async f=>{
 const path=join(f.cwd,'root.sqlite');
 const base=await openFixture({acquired:true},()=>{},()=>SqliteStorage.open(new BunSqliteDatabase(path,{root:f.root,assertOwner:f.assertOwner})));
 const id=base.root.id;await base.close();await base.storage.close(context);
 const payloads=new InMemoryEffectPayloadResolver();const writes=new Map<string,string>();
 const answers={resolver:payloads,put(ref:string,text:string){f.assertOwner();writes.set(ref,text);payloads.putText(ref,text);}};
 let canonical='';let calls=0;
 const project=createHostCodexAnswerMaterializer({...f,answers});
 let runtime:any;
 const blocker=new Database(path);const deadline=Date.now()+2500;
 for(;;){try{blocker.exec('BEGIN IMMEDIATE');break;}catch(error){if(!isSqliteContention(error)||Date.now()>=deadline){blocker.close();throw error;}await Bun.sleep(5);}}
 let released=false;const release=setTimeout(()=>{blocker.exec('ROLLBACK');released=true;},75);
 let bundle:Awaited<ReturnType<typeof createApplicationBootstrapBundle>>;
 try { bundle=await createApplicationBootstrapBundle({root:f.root,path,ownership:applicationOwnership(f.lock),
  manifest:[{chatJid:'web:images',branchId:'main',conversationId:id}],sessions:new Map([['web:images','image-session']]),offlineInitialize:true,answers,
  onRuntime(r){runtime=r;},materializeAnswer:async(ref,answer,op)=>{calls++;canonical=answer.text;return project(ref,answer,op);},
  runtime:{incarnation:'image-native',sessionId:'image-session',lane:'main',generation:1,now:()=>at,harnessOptions:{models:base.models,registry:base.registry,settings:{retry:{enabled:false},compaction:{enabled:false}}}}
 },context);
 } finally {clearTimeout(release);if(blocker.inTransaction)blocker.exec('ROLLBACK');blocker.close();}
 expect(released).toBe(true);
 try {
  await f.accept();await f.publish(0);
  f.root.query("INSERT INTO chats(jid,name,last_message_time) VALUES(?,?,?)").run(f.source.chatJid,'images',at);
  f.root.query('INSERT INTO messages(id,chat_jid,content,timestamp) VALUES(?,?,?,?)').run(f.source.sourceId,f.source.chatJid,'native image question',at);
  const requestId='image-native-input',content='native image question';
  const input={incarnation:'image-native',chatJid:f.source.chatJid,branchId:'main',conversationId:id,operationId:f.operation.operationId,sourceSeq:f.source.sourceSeq,sourceId:f.source.sourceId,payloadRef:f.source.payloadRef,requestId,requestHash:hashCanonicalRequest({type:'input',requestId,content})};
  // Bootstrap ordinary payload lookup requires a message-row reference in accepted source.
  const submission=await runtime.submit(input);await runtime.wait(input,submission);await runtime.settle(input);
  expect(calls).toBe(1);expect([...writes.values()]).toEqual([canonical+'\n\nFiles:\n- '+f.paths[0]]);
  const bots=f.root.query('SELECT content FROM messages WHERE chat_jid=? AND is_bot_message=1').all(f.source.chatJid) as any[];
  expect(bots).toHaveLength(1);expect(bots[0].content).toBe([...writes.values()][0]);
 }finally{await bundle.close();}
 const storage=await SqliteStorage.open(new BunSqliteDatabase(path,{root:f.root,assertOwner:f.assertOwner}));
 const harness=await Harness.open(storage,{models:base.models,registry:base.registry},context);
 try{const conversation=await harness.conversation(id,context);const history=await conversation!.context(context);
  const assistants=history.messages.filter(m=>m.role==='assistant');expect(assistants).toHaveLength(1);
  expect(assistants[0]!.content).toEqual([{type:'text',text:canonical}]);
 }finally{await harness.close(context);}
},true));

import { admitSqliteWrite } from '../../runtime/src/db/sqlite-async-admission.js';

for (const outcome of ['commit', 'revoke', 'entered-error'] as const) test(`artifact publication awaits owned WAL admission: ${outcome}`, async () => {
 const cwd=await mkdtemp(join(tmpdir(),'codex-admission-'));
 const root=new Database(join(cwd,'root.sqlite'));
 let writer:Database|undefined, pending:Promise<void>|undefined;
 try {
  root.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=0;
   CREATE TABLE extension_kv(extension_id TEXT,scope TEXT,scope_key TEXT,key TEXT,value TEXT,updated_at TEXT,PRIMARY KEY(extension_id,scope,scope_key,key))`);
  const path='.pi/openai-codex-images/call.png';
  await mkdir(join(cwd,'.pi/openai-codex-images'),{recursive:true});await writeFile(join(cwd,path),'image');
  let current=true,entries=0,settled=false;
  const assertCurrent=()=>{if(!current)throw Error('revoked');};
  const operation=Object.freeze({id:'codex',sessionId:'session',cwd,model:{provider:'openai-codex',id:'test',api:'openai-codex-responses'},signal:new AbortController().signal,assertCurrent});
  let reached!:()=>void;const writing=new Promise<void>(resolve=>{reached=resolve;});
  const failure=Object.assign(Error('entered contention'),{code:'SQLITE_BUSY'});
  const store=createHostCodexArtifactStore(root,operation,{hostOperationId:'host',chatJid:'chat',assertCurrent,write<T>(body:()=>T):Promise<T>{
   reached();
   return admitSqliteWrite(root,()=>{
    entries++;const result=body();
    if(outcome==='entered-error')throw failure;
    return result;
   },assertCurrent,operation.signal,undefined,assertCurrent);
  }});
  writer=new Database(join(cwd,'root.sqlite'));writer.exec('BEGIN IMMEDIATE');
  pending=store.publish(operation,{kind:'image',savedImage:{absolutePath:join(cwd,path),relativePath:path,callId:'call',outputFormat:'png'}});
  void pending.then(()=>{settled=true;},()=>{settled=true;});
  await writing;await Bun.sleep(40);
  expect(settled).toBe(false);expect(entries).toBe(0);
  expect(root.query('PRAGMA busy_timeout').get()).toEqual({timeout:0});
  if(outcome==='revoke')current=false;
  writer.exec('ROLLBACK');
  if(outcome==='revoke')await expect(pending).rejects.toThrow('revoked');
  else if(outcome==='entered-error')await expect(pending).rejects.toBe(failure);
  else {await pending;expect(store.refs()).toHaveLength(1);}
  expect(entries).toBe(outcome==='revoke'?0:1);
  expect(root.query('SELECT * FROM extension_kv').all()).toHaveLength(outcome==='commit'?1:0);
  expect(root.inTransaction).toBe(false);
  expect(root.query('PRAGMA busy_timeout').get()).toEqual({timeout:0});
 }finally{
  if(writer?.inTransaction)writer.exec('ROLLBACK');
  await pending?.catch(()=>{});writer?.close();root.close();await rm(cwd,{recursive:true,force:true});
 }
});
