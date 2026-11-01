import { isolatedApplicationTest } from './src/isolated-application-test.js';
import './src/test-guard.js';
import {expect,spyOn} from 'bun:test';
import {Database} from 'bun:sqlite';
import {createRecoverableRuntimeBackend,type RuntimeBackend} from '../../runtime/src/runtime/bootstrap.js';
import {RuntimePreparationError} from '../../runtime/src/runtime/preparation-error.js';
import {isSqliteContention} from '../../runtime/src/db/sqlite-async-admission.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {initDatabase,getDb,closeDatabase} from '../../runtime/src/db/connection.js';
import {storeChatMetadata} from '../../runtime/src/db.js';
import {acquireRuntimeLock} from '../../runtime/src/runtime/single-instance.js';
import {BunSqliteDatabase} from '../../runtime/durable-engine/src/bun-sqlite.js';
import {SqliteStorage} from '../../runtime/durable-engine/qualification/sqlite.ts';
import {createProvider,type AssistantMessage} from '../../runtime/durable-engine/qualification/ai.ts';
import {AssistantMessageEventStream} from '../../runtime/durable-engine/qualification/event-stream.ts';
import {applicationOwnership,createApplicationBootstrapBundle} from '../../runtime/durable-engine/src/application-bootstrap.js';
import {createHostCommandPolicy} from '../../runtime/durable-engine/src/host-command-policy.js';
import {installTerminalSettlementCompositionSchema} from '../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js';
import {admitWebUserMessage} from '../../runtime/src/channels/web/messaging/message-store.js';
import {InMemoryEffectPayloadResolver} from '../../runtime/src/service-effects/testing/in-memory-payload-resolver.js';
import {openFixture,context} from './src/fixture.js';
const applicationTest=isolatedApplicationTest(import.meta.url);
for(const scenario of ['idle','busy','retry','storage-recovery','storage-reopen-retry'] as const) applicationTest('native critical bootstrap: '+scenario,async()=>{
 const recovering=scenario==='storage-recovery'||scenario==='storage-reopen-retry';
 const dir=await mkdtemp(join(process.env.PICLAW_WORKSPACE!,'critical-controls-'));
 const owner=acquireRuntimeLock({lockPath:join(dir,'owner.lock'),strictOwnership:true,disabled:false});
 process.env.PICLAW_DB_IN_MEMORY='0';initDatabase();const root=getDb();root.exec('PRAGMA foreign_keys=ON');
 const path=(root.query('PRAGMA database_list').all() as any[]).find(r=>r.name==='main').file;
 const assert=()=>owner.assertCurrentOwner();
 const base=await openFixture({acquired:true},()=>{},()=>SqliteStorage.open(new BunSqliteDatabase(path,{root,assertOwner:assert})));
 let calls=0;const model={provider:'qualification',id:'critical',name:'Critical',api:'openai-completions' as const,baseUrl:'https://invalid.invalid',reasoning:false,input:['text' as const],contextWindow:100000,maxTokens:100,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};
 const stream=(_model:unknown,_context:unknown,options:any)=>{
  calls++;const output=new AssistantMessageEventStream();
  const finish=()=>{const message:AssistantMessage={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:scenario==='retry'?'error':'aborted',errorMessage:scenario==='retry'?'429 rate limit exceeded':'aborted',content:[]};output.push({type:'error',reason:message.stopReason as 'error'|'aborted',error:message});output.end(message);};
  if(scenario==='retry'||options?.signal?.aborted)finish();else options?.signal?.addEventListener('abort',finish,{once:true});
  return output;
 };
 base.models.setProvider(createProvider({id:model.provider,models:[model],auth:{apiKey:{name:'Synthetic',resolve:async()=>({auth:{},source:'synthetic'})}},api:{stream,streamSimple:stream}}));
 const conversation=await base.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:model.provider,modelId:model.id}}},context);
 await base.close();installTerminalSettlementCompositionSchema(root);
 const chat='web:native-critical',session='native-critical-session';storeChatMetadata(chat,new Date().toISOString());
 const branchId=(root.query('SELECT branch_id FROM chat_branches WHERE chat_jid=?').get(chat) as any).branch_id;
 const policy=createHostCommandPolicy(root,assert);const resolver=new InMemoryEffectPayloadResolver();let bundle:RuntimeBackend & {dispatchAcceptedInput:(...args:Parameters<Awaited<ReturnType<typeof createApplicationBootstrapBundle>>["dispatchAcceptedInput"]>)=>ReturnType<Awaited<ReturnType<typeof createApplicationBootstrapBundle>>["dispatchAcceptedInput"]>};
 let latest:Awaited<ReturnType<typeof createApplicationBootstrapBundle>>, writer:Database|undefined, prepares=0, storageFailures=0, reopenFailures=0, originalSubmission:number|undefined, restoreContention:(()=>void)|undefined;
 try{
  const prepare=async()=>{
   prepares++;let notify!:(error:unknown)=>void;const storageFailure=new Promise<unknown>(resolve=>{notify=resolve;});
   try { latest=await createApplicationBootstrapBundle({root,path,ownership:applicationOwnership(owner),manifest:[{chatJid:chat,branchId,conversationId:conversation.id}],sessions:new Map([[chat,session]]),offlineInitialize:true,answers:{put:(ref,text)=>resolver.putText(ref,text),resolver},readExecutionPolicy:policy.read,setExecutionPolicy:policy.set,runtime:{onStorageFailure(error){storageFailures++;if(scenario!=='storage-reopen-retry'&&writer?.inTransaction)writer.exec("ROLLBACK");notify(error);},incarnation:'native-critical-test',sessionId:'runtime',lane:'main',generation:1,now:()=>new Date().toISOString(),harnessOptions:{models:base.models,registry:base.registry,settings:{get retry(){return {...policy.settings.retry,baseDelayMs:10000};},compaction:{enabled:false}}}}},context);
   } catch(error) {
    // The bundle has certified disposal before returning the contention error.
    // Keep the real writer through the first reopen attempt, unlike the original
    // recovery fixture which releases it on the failure notification.
    if(scenario!=='storage-reopen-retry'||!isSqliteContention(error))throw error;
    reopenFailures++;expect(prepares).toBe(2);expect(writer?.inTransaction).toBe(true);
    writer!.exec('ROLLBACK');throw new RuntimePreparationError(error,true);
   }
   const native=latest;
   return {...native,storageFailure,async attachChannel(){
    const row=root.query("SELECT rowid,id FROM messages WHERE chat_jid=? AND is_bot_message=0").get(chat) as any;
    if(row){const resume=native.dispatchAcceptedInput(chat,row.id,row.rowid);if(resume)void resume().catch(()=>{});}
   }};
  };
  const backend=recovering?await createRecoverableRuntimeBackend(prepare):await prepare();
  bundle=Object.assign({},backend,{dispatchAcceptedInput:(...args:Parameters<typeof latest.dispatchAcceptedInput>)=>latest.dispatchAcceptedInput(...args)});
  if(recovering)await bundle.attachChannel!({} as any);
  const control=bundle.sessionOptions.getDurableSession!(chat)!;
  if(scenario==='idle'){
   const before=root.query('SELECT * FROM service_effect_s01_sources').all();
   await control.restart!();expect(calls).toBe(0);expect(control.sessionId).toBe(session);
   expect(root.query('SELECT * FROM service_effect_s01_sources').all()).toEqual(before);
   expect((await control.runBash!('printf BOOTSTRAP_BASH')).output).toBe('BOOTSTRAP_BASH');
   expect(await control.abortBash!()).toBe(false);expect(await control.abortRetry!()).toBe(false);
   await control.setExecutionPolicy!('autoRetry',true);expect((await control.readExecutionPolicy!()).autoRetry).toBe(true);
   await control.setExecutionPolicy!('autoRetry',false);expect((await control.readExecutionPolicy!()).autoRetry).toBe(false);
   expect(calls).toBe(0);return;
  }
  if(scenario==='retry')await control.setExecutionPolicy!('autoRetry',true);
  const bound=bundle.bind({queue:{} as any,agentPool:{} as any});
  const coordinator=bound.dispatchAcceptedInput!;
  const waitForPending=coordinator.waitForPending.bind(coordinator);
  await admitWebUserMessage({pendingLinkPreviews:new Set<number>(),broadcastEvent(){}},{chatJid:chat,content:'Critical native fixture',isBot:false,mediaIds:[],agentId:'default',agentName:'Fixture'},{acceptSource:bound.getInputSourceAdmission!(chat)},assert,new AbortController().signal);
  const message=root.query('SELECT rowid,id FROM messages WHERE chat_jid=? AND is_bot_message=0').get(chat) as any;
  const dispatch=coordinator(chat,message.id,message.rowid)!;const running=dispatch();void running.catch(()=>{});
  for(let i=0;;i++){
   const retry=root.query("SELECT record FROM tasks WHERE status<>'terminal'").all().some((row:any)=>JSON.parse(row.record).state.checkpoint?.phase==='retry');
   if(scenario==='retry'?retry:calls>0)break;
   if(i>300)throw Error('Native control fixture did not reach '+scenario);await Bun.sleep(5);
  }
  if(recovering){
   const scope=await control.readAbortScope!();expect(scope).not.toBeNull();
   originalSubmission=(root.query("SELECT id FROM submissions WHERE conversation_id=? ORDER BY id DESC LIMIT 1").get(conversation.id) as any).id;
   const sources=root.query("SELECT count(*) AS n FROM service_effect_s01_sources").get();
   for(const foreign of [{...scope!,operationId:'foreign'},{...scope!,conversationId:999999},{...scope!,sourceSeq:scope!.sourceSeq+1}])expect(await control.abort!(foreign)).toBe(false);
   expect(root.query("SELECT count(*) AS n FROM service_effect_s01_sources").get()).toEqual(sources);
   // Introduce a genuine second-connection writer only AFTER the host cancellation
   // transaction commits, at the boundary before the SDK must persist its abort.
   const transaction=root.transaction.bind(root);
   const probe=spyOn(root,"transaction").mockImplementation(((fn:any)=>{
    const target=transaction(fn),wrapped=(...args:any[])=>target(...args);
    const descriptors=Object.getOwnPropertyDescriptors(target);
    descriptors.immediate={...descriptors.immediate,value:(...args:any[])=>{
     const result=Reflect.apply(target.immediate,target,args);
     if(!writer&&(root.query("SELECT count(*) AS n FROM service_effect_s01_sources WHERE kind='cancellation'").get() as any).n){writer=new Database(path);writer.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE");}
     return result;
    }};
    return Object.defineProperties(wrapped,descriptors);
   }) as Database["transaction"]);
   restoreContention=()=>probe.mockRestore();
   expect(await control.abort!()).toBe(true);
   await running.catch(()=>{});expect(prepares).toBe(scenario==='storage-reopen-retry'?3:2);expect(storageFailures).toBe(1);
   expect(reopenFailures).toBe(scenario==='storage-reopen-retry'?1:0);
   expect(await waitForPending({chatJid:chat,messageId:message.id,rowId:message.rowid})).toBe("settled");
   expect(root.query("SELECT id FROM submissions WHERE conversation_id=? ORDER BY id").all(conversation.id)).toEqual([{id:originalSubmission}]);
   expect(root.query("SELECT id FROM tasks WHERE status<>'terminal'").all()).toEqual([]);
   expect(root.query("SELECT operation_id FROM service_effect_s01_operations WHERE phase<>'terminal'").all()).toEqual([]);
   expect(root.query("SELECT count(*) AS n FROM service_effect_s01_sources WHERE kind='cancellation'").get()).toEqual({n:1});
   expect(await bundle.sessionOptions.getDurableSession!(chat)!.abort!()).toBe(false);
   await bound.prepareInputSourceAdmission!(chat);
   expect(bound.getInputSourceAdmission!(chat)).toBeDefined();
   expect(calls).toBeGreaterThanOrEqual(1);expect(calls).toBeLessThanOrEqual(2);return;
  }
  if(scenario==='busy'){
   const sourceBefore=root.query('SELECT count(*) AS n FROM service_effect_s01_sources').get();
   expect(await control.abortRetry!()).toBe(false);expect(root.query('SELECT count(*) AS n FROM service_effect_s01_sources').get()).toEqual(sourceBefore);
   await control.restart!();
  }else expect(await control.abortRetry!()).toBe(true);
  await running;expect(calls).toBe(1);
  expect(root.query("SELECT id FROM tasks WHERE status<>'terminal'").all()).toEqual([]);
  expect(root.query("SELECT operation_id FROM service_effect_s01_operations WHERE phase<>'terminal'").all()).toEqual([]);
  expect(await control.abortRetry!()).toBe(false);
  expect(root.query("SELECT count(*) AS n FROM service_effect_s01_sources WHERE kind='cancellation'").get()).toEqual({n:1});
 }finally{restoreContention?.();if(writer?.inTransaction)writer.exec("ROLLBACK");writer?.close();await bundle!?.close();closeDatabase();owner.release();await rm(dir,{recursive:true,force:true});}
},scenario==='storage-recovery'||scenario==='storage-reopen-retry'?45000:15000);
