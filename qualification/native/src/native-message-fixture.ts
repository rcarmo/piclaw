import './test-guard.js';
import { rmSync } from 'node:fs';
import { assertPathWithinTestFilesystemIsolation } from '../../../runtime/scripts/test-filesystem-isolation.js';
import { createTempWorkspace } from '../../../runtime/test/helpers.js';
import { resolveRuntimeConfigPaths } from '../../../runtime/src/core/config-paths.js';
import { initDatabase,getDb,closeDatabase } from '../../../runtime/src/db/connection.js';
import { storeChatMetadata,storeMessageInDatabase } from '../../../runtime/src/db/messages.js';
import { SqliteStorage } from '../../../runtime/durable-engine/qualification/sqlite.ts';
import { BunSqliteDatabase } from '../../../runtime/durable-engine/src/bun-sqlite.js';
import { createHostController } from '../../../runtime/durable-engine/src/host-controller.js';
import { HostConversationRuntime,type AcceptedInput,type RuntimeOptions } from '../../../runtime/durable-engine/src/host-runtime.js';
import { initializeHostDurableBindings,createHostDurableBindings } from '../../../runtime/durable-engine/src/host-bindings.js';
import { createCurrentPiclawServiceWorkStore } from '../../../runtime/src/service-effects/current-piclaw/service-work-store.js';
import { createCurrentPiclawTerminalSettlementStore } from '../../../runtime/src/service-effects/current-piclaw/terminal-settlement-store.js';
import { installTerminalSettlementCompositionSchema } from '../../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js';
import { InMemoryEffectPayloadResolver } from '../../../runtime/src/service-effects/testing/in-memory-payload-resolver.js';
import { hashCanonicalRequest } from '../../../runtime/src/service-effects/contracts/common.js';
import { withTaskModelRequestScope } from '../../../runtime/durable-engine/src/task-model-boundary-shim.js';
import { TestOwner } from './ownership.js';
import { context,openFixture } from './fixture.js';
import { value,sealed,effect } from './host-handoff.js';

/** Real single-file Root/SDK fixture. It supplies identities and a provider,
 * never an execution queue, recovered intent, operation or terminal commit. */
export interface NativeMessageFixtureIdentity { workspace:{base:string;workspace:string;store:string;data:string};domain:string;chat:string }
export async function nativeMessageFixture(recovered?:NativeMessageFixtureIdentity) {
  if(recovered)for(const path of Object.values(recovered.workspace))assertPathWithinTestFilesystemIsolation(path,process.env,{allowRoot:false});
  const workspace=recovered?{...recovered.workspace,cleanup(){rmSync(recovered.workspace.base,{recursive:true,force:true});}}:createTempWorkspace('native-message-');
  const paths=resolveRuntimeConfigPaths({env:{...process.env,PICLAW_WORKSPACE:workspace.workspace,PICLAW_STORE:workspace.store,PICLAW_DATA:workspace.data,PICLAW_DB_IN_MEMORY:'0'}});
  let owner=TestOwner.acquire(paths.databasePath);
  initDatabase(paths);const root=getDb();root.exec('PRAGMA foreign_keys=ON');installTerminalSettlementCompositionSchema(root);
  const assert=()=>owner.assert();
  let candidateDatabase:BunSqliteDatabase;
  const storage=()=>{candidateDatabase=new BunSqliteDatabase(paths.databasePath,{root,assertOwner:assert,fenceTransactions:true});return SqliteStorage.open(candidateDatabase);};
  const base=await openFixture({get acquired(){return owner.acquired;}},()=>{},storage);
  const domain=recovered?.domain??'native-fixture:'+crypto.randomUUID(),chat=recovered?.chat??'web:'+domain;
  if(!recovered)storeChatMetadata(chat,new Date().toISOString(),'Native fixture');
  const work=value(createCurrentPiclawServiceWorkStore(root,{hitFault(){return false;},recordTrace(){}}));
  const terminal=value(createCurrentPiclawTerminalSettlementStore(root,new InMemoryEffectPayloadResolver(),{hitFault(){return false;},recordTrace(){}}));
  initializeHostDurableBindings(root,assert);
  const bindings=createHostDurableBindings(root,{domain,incarnation:domain,manifest:[{chatJid:chat,branchId:'main',conversationId:base.root.id}],assertOwner:assert,
    async resolveContent(ref){const row=root.query('SELECT content FROM messages WHERE rowid=? AND chat_jid=?').get(Number(ref.slice(12)),chat) as {content:string}|null;if(!row)throw Error('Missing native message');return row.content;}});
  const options:RuntimeOptions={incarnation:domain,sessionId:domain,owner:{assert,release(){}},openStorage:storage,
    harnessOptions:{models:base.models,registry:withTaskModelRequestScope(base.registry),settings:{retry:{enabled:false},compaction:{enabled:false}}},
    work:new Proxy(work,{get(target,key){if(key==='getOperation')return async()=>{throw Error('Host operation lookup cannot govern native input');};const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}}),terminal,bindings,
    existingConversationIds:[base.root.id],conversationFor(id,branch){if(id!==chat||branch!=='main')throw Error('Manifest conflict');return base.root.id;},authorizeScheduling(){throw Error('Host scheduling cannot govern native input');},
    putAnswer(){throw Error('Host settlement cannot own native replies');},now:()=>new Date().toISOString()};
  let runtime:HostConversationRuntime|undefined,controller:Awaited<ReturnType<typeof createHostController>>|undefined;
  const open=async()=>{
    controller=await createHostController({acquireOwnership:async()=>({assertCurrentOwner:assert,release(){}}),createStorage:storage,runtime:options,
      recovery:{manifest:[{chatJid:chat,branchId:'main',conversationId:base.root.id}],work,bindings,async readAcceptedInput(){throw Error('Host recovery must not reconstruct native input');}}},context);
    runtime=controller.runtime;return runtime;
  };
  function accept(content:string):AcceptedInput{return root.transaction(()=>{
    const sourceId=crypto.randomUUID(),timestamp=new Date().toISOString();
    const row=storeMessageInDatabase(root,{id:sourceId,chat_jid:chat,sender:'user',sender_name:'Fixture',content,timestamp,is_from_me:false,is_bot_message:false});
    const source=work.acceptSourceInTransaction(sealed({effect:{...effect(sourceId),provenanceRef:'application:pi-durable'},chatJid:chat,sourceId,kind:'message',payloadRef:`message-row:${row}`,targetOperationId:null,parentSourceSeq:null,acceptedAt:timestamp,createWakeIntent:false}),root);
    const requestId=`message:${row}:${sourceId}`;
    return {incarnation:domain,conversationId:base.root.id,chatJid:chat,branchId:'main',operationId:`native-message:${base.root.id}:${source.sourceSeq}`,sourceSeq:source.sourceSeq,sourceId,payloadRef:source.payloadRef,requestId,requestHash:hashCanonicalRequest({type:'input',requestId,content})};
  }).immediate();}
  return {root,base,options,bindings,work,chat,domain,accept,get candidateDatabase(){return candidateDatabase;},
    identity:{workspace:{base:workspace.base,workspace:workspace.workspace,store:workspace.store,data:workspace.data},domain,chat},
    owner:()=>owner.token,
    ownerLease:()=>({assertCurrentOwner:assert,release(){owner.releaseAfterClose();}}),
    sdkSnapshot:()=>JSON.parse(JSON.stringify(['entries','submissions'].map(table=>root.query(`SELECT * FROM ${table} ORDER BY id`).all()),(_key,value)=>value instanceof Uint8Array?{blob:Buffer.from(value).toString('hex')}:typeof value==='bigint'?{integer:value.toString()}:value)), 
    binding:{incarnation:domain,conversationId:base.root.id,chatJid:chat,branchId:'main'},
    get runtime(){if(!runtime)throw Error('Native fixture runtime is not open');return runtime;},
    get controller(){if(!controller)throw Error('Native fixture controller is not open');return controller;},
    async open(){await base.close();return open();},
    async reopen(){await controller!.close();owner.releaseAfterClose();owner.closeConnection();owner=TestOwner.acquire(paths.databasePath);return open();},
    async close(){base.host.modelHold?.release();base.host.toolHold?.release();await controller?.close();await base.close();await closeDatabase();owner.releaseAfterClose();owner.closeConnection();workspace.cleanup();},
  };
}
