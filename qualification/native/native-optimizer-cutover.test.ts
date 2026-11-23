import './src/test-guard.js';
import {expect} from 'bun:test';
import {createHash} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {hostname} from 'node:os';
import {join} from 'node:path';
import {isolatedApplicationTest} from './src/isolated-application-test.js';
import {initDatabase,getDb,closeDatabase} from '../../runtime/src/db/connection.js';
import {acquireRuntimeLock} from '../../runtime/src/runtime/single-instance.js';
import {createDefaultApplicationRuntime} from '../../runtime/durable-engine/src/default-application-runtime.js';
import {BunSqliteDatabase} from '../../runtime/durable-engine/src/bun-sqlite.js';
import {applicationRetainedDatabase} from '../../runtime/durable-engine/src/mcp/retained-database.js';
import {createToolOutputStore} from '../../runtime/durable-engine/qualification/fixtures/legacy-tool-output-store.js';
import {Harness,createRegistry,defineDoc,defineEntry,defineTask,defineExtension,type ConversationId} from '../../runtime/durable-engine/qualification/durable.js';
import {BACKGROUND_CONTEXT as context} from '../../runtime/durable-engine/qualification/context.js';
import {SqliteStorage} from '../../runtime/durable-engine/qualification/sqlite.js';
import {createModels} from '../../runtime/durable-engine/node_modules/@earendil-works/pi-ai';
import {createRuntimeBaseServices} from '../../runtime/src/runtime/composition.js';
import {createTestCredentialStore} from '../../runtime/test/model-services-fixture.js';
import {AgentPool} from '../../runtime/src/agent-pool.js';
import {WebChannel} from '../../runtime/src/channels/web.js';
import {handleAgentMessage} from '../../runtime/src/channels/web/handlers/agent.js';
import {handleRegisteredAddonConfigApiRequest} from '../../runtime/src/channels/web/handlers/addon-config-api.js';
import {getPiclawAgentDir} from '../../runtime/src/core/agent-dir.js';
import {PiclawModelRegistry} from '../../runtime/src/agent-pool/model-services.js';
import {ModelRuntime,SettingsManager} from '../../node_modules/@earendil-works/pi-coding-agent';
import {createAssistantMessageEventStream} from '../../node_modules/@earendil-works/pi-ai';

const test=isolatedApplicationTest(import.meta.url);
const Mapping=defineDoc({kind:'app.application-conversations',version:1,scope:'conversation',history:'latest',fork:'initial',checkpointWhen:()=>false,initial:()=>({version:1,domain:'',bindings:[] as {chatJid:string;branchId:string;conversationId:ConversationId;sessionId:string}[]})});
const Fact=defineEntry<{section:string;injectedIds:string[]}>('token-economizer.fact-context');
const oldWork=defineTask<{id:string},{phase:'fold'},null>({name:'token-economizer.checkpoint',version:1,initial:()=>({phase:'fold'}),phases:{async fold(){throw Error('Historical optimiser code must not run');}},async abort(){throw Error('Historical optimiser code must not run');}});
const oldOutput='out_'+'a'.repeat(32),retainedText='Historical retained output stays readable';

test('default factory retires a historical optimiser checkpoint, preserves old facts and serves retained output after restart',async()=>{
 const workspace=process.env.PICLAW_WORKSPACE!;process.env.PICLAW_DB_IN_MEMORY='0';initDatabase();const database=getDb();
 const owner=acquireRuntimeLock({lockPath:join(workspace,'optimizer-removal.lock'),strictOwnership:true,disabled:false});
 const credentials=createTestCredentialStore({fixture:{type:'api_key',key:'synthetic-only'}}),host=await ModelRuntime.create({credentials,modelsPath:null,modelsStore:{read:async()=>undefined,write:async()=>{},delete:async()=>{}},allowModelNetwork:false,refreshOnCreate:false});
 const model={provider:'fixture',id:'main',name:'Fixture',api:'openai-completions' as const,baseUrl:'https://fixture.invalid',input:['text' as const],reasoning:false,contextWindow:128000,maxTokens:1000,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
 let calls=0,toolResponse:unknown;
 const run=(_physical:unknown,transcript:{messages:readonly {role:string}[]})=>{
  calls++;const tool=calls===1,stream=createAssistantMessageEventStream();
  if(!tool)toolResponse=transcript.messages.findLast(item=>item.role==='toolResult');
  const message={role:'assistant' as const,api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),content:tool ? [{type:'toolCall' as const,id:'read-historical',name:'read_tool_output',arguments:{id:oldOutput}}] : [{type:'text' as const,text:'Ordinary reply after retirement'}],stopReason:tool?'toolUse' as const:'stop' as const,usage:{input:2,output:1,cacheRead:0,cacheWrite:0,totalTokens:3,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
  queueMicrotask(()=>{stream.push({type:'done',reason:message.stopReason,message});stream.end(message);});return stream;
 };
 host.registerNativeProvider({id:'fixture',name:'Fixture',getModels:()=>[model],auth:{apiKey:{name:'Synthetic',resolve:async()=>({auth:{},source:'fixture'})}},stream:run,streamSimple:run});
 await host.refresh({allowNetwork:false});await host.getAvailable();const registry=new PiclawModelRegistry(host),settings=SettingsManager.create(workspace,getPiclawAgentDir());settings.setDefaultModelAndProvider('fixture','main');await settings.flush();
 const services={modelRuntime:host,modelRegistry:registry,credentialStore:credentials,agentDir:getPiclawAgentDir()},base=createRuntimeBaseServices({dataDir:workspace});
 let backend:Awaited<ReturnType<typeof createDefaultApplicationRuntime>>|undefined,pool:AgentPool|undefined,channel:WebChannel|undefined;
 try{
  backend=await createDefaultApplicationRuntime(owner,async()=>services);
  await backend.close();backend=undefined;
  const path=database.query<{file:string},[]>("SELECT file FROM pragma_database_list WHERE name='main'").get()!.file;
  const seedRegistry=createRegistry();seedRegistry.install(defineExtension({name:'fixture.old-optimizer-record',tasks:[oldWork]}));
  const seed=await Harness.open(await SqliteStorage.open(new BunSqliteDatabase(path,{root:database,assertOwner:()=>owner.assertCurrentOwner(),fenceTransactions:true})),{registry:seedRegistry,models:createModels()},context);
  let taskNumber:number,factNumber:number;
  try{
   const binding=(await seed.snapshot(Mapping,1 as ConversationId,context))!.bindings.find(row=>row.chatJid==='web:default')!;
   const ids=await seed.commit(async tx=>{
    const fact=await tx.appendEntry(Fact,binding.conversationId,{data:{section:'Keep this historical fact',injectedIds:['fact:fixture']}});
    const task=await tx.createTask(oldWork,{id:'historical-example'},{conversationId:1 as ConversationId,background:true,ownership:{kind:'conversation'}});
    return {fact:fact.id,task};
   },context);
   taskNumber=ids.task;factNumber=ids.fact;
   const real=realpathSync(workspace),workspaceId=createHash('sha256').update(real).digest('hex');
   const environment=createHash('sha256').update(JSON.stringify([hostname(),process.platform,process.arch,real,getPiclawAgentDir()])).digest('hex');
   await createToolOutputStore(applicationRetainedDatabase(database,()=>owner.assertCurrentOwner())).save({id:oldOutput,owner:JSON.stringify([workspaceId,environment,binding.chatJid]),conversation:binding.conversationId,after:factNumber,tool:'bash',label:'historical fixture',text:retainedText,complete:true,retentionMs:60000});
  }finally{await seed.close(context);}
  const factRow=()=>database.query('SELECT record FROM entries WHERE id=?').get(factNumber);
  const factBefore=factRow(),outputBefore=database.query('SELECT * FROM retained_tool_outputs WHERE id=?').get(oldOutput);
  backend=await createDefaultApplicationRuntime(owner,async()=>services);
  const taskRow=()=>JSON.parse(database.query<{record:string},[number]>('SELECT record FROM tasks WHERE id=?').get(taskNumber)!.record);
  expect(taskRow()).toMatchObject({kind:'token-economizer.checkpoint',input:{id:'historical-example'},state:{status:'terminal',outcome:{status:'orphaned'}}});
  const retired=taskRow();expect(calls).toBe(0);
  expect(await handleRegisteredAddonConfigApiRequest(new Request('https://fixture/agent/addons/api/token-optimizer/config'),'token-optimizer','config',(body,status=200)=>Response.json(body,{status}))).toBeNull();
  pool=new AgentPool({credentialStore:credentials,modelRuntime:host,modelRegistry:registry,...backend.sessionOptions});channel=new WebChannel(backend.bind({queue:base.queue,agentPool:pool}));backend.attachChannel!(channel);
  const request=new Request('https://fixture/agent/default/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'Read old output without replaying it'})});
  expect((await handleAgentMessage(channel,request,'/agent/default/message','web:default','default')).status).toBe(201);
  const deadline=Date.now()+10000;
  while(!database.query('SELECT 1 FROM messages WHERE is_bot_message=1 AND content=?').get('Ordinary reply after retirement')&&Date.now()<deadline)await Bun.sleep(10);
  expect(database.query('SELECT count(*) n FROM messages WHERE is_bot_message=1 AND content=?').get('Ordinary reply after retirement')).toEqual({n:1});
  expect(calls).toBe(2);expect(JSON.stringify(toolResponse)).toContain(retainedText);expect(JSON.stringify(toolResponse)).not.toContain('Stored outputs are unavailable');
  await backend.close();backend=await createDefaultApplicationRuntime(owner,async()=>services);
  expect(calls).toBe(2);expect(taskRow()).toEqual(retired);expect(factRow()).toEqual(factBefore);
  expect(database.query('SELECT * FROM retained_tool_outputs WHERE id=?').get(oldOutput)).toEqual(outputBefore);
  expect(database.query("SELECT count(*) n FROM tasks WHERE json_extract(record,'$.kind') LIKE 'token-economizer.%'").get()).toEqual({n:1});
 }finally{await backend?.close();await channel?.stop();await base.queue.shutdown();await pool?.shutdown();await closeDatabase();owner.release();}
},30000);
