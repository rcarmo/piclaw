import {historicalExpenseRows} from '../../runtime/test/fixtures/historical-expense.js';
import { pathToFileURL } from "node:url";
import { withExtensionKvAuthority } from "../../runtime/src/extension-kv-registry.js";
import { addLogSink, removeLogSink, type LogRecord } from "../../runtime/src/utils/logger.js";
import "./src/test-guard.js";
import { expect } from "bun:test";
import { cpSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { isolatedApplicationTest } from "./src/isolated-application-test.js";
import { installGoalFixture } from "./goal-fixture.js";
import { initDatabase,getDb,closeDatabase } from "../../runtime/src/db/connection.js";
import { acquireRuntimeLock } from "../../runtime/src/runtime/single-instance.js";
import { createDefaultApplicationRuntime } from "../../runtime/durable-engine/src/default-application-runtime.js";
import { createTestCredentialStore } from "../../runtime/test/model-services-fixture.js";
import { createRuntimeBaseServices } from "../../runtime/src/runtime/composition.js";
import { AgentPool } from "../../runtime/src/agent-pool.js";
import { WebChannel } from "../../runtime/src/channels/web.js";
import { ModelRuntime } from "../../node_modules/@earendil-works/pi-coding-agent/dist/index.js";
import { createAssistantMessageEventStream } from "../../node_modules/@earendil-works/pi-ai";

const applicationTest=isolatedApplicationTest(import.meta.url);
for(const {continuation,fault} of [{continuation:false,fault:"none"},{continuation:true,fault:"none"},{continuation:false,fault:"rollback"},{continuation:false,fault:"postcommit"},{continuation:false,fault:"tokens"}]) applicationTest(`actual native Goal ${continuation?"atomic continuation then completion":"completion"}/${fault} retains tokens without host turn/financial settlement`,async()=>{
  const workspace=process.env.PICLAW_WORKSPACE!;const goalPackage=installGoalFixture(workspace);
  const plan=join(workspace,".pi/extensions/node_modules/@rcarmo/piclaw-addon-plan-sidebar");
  cpSync(join(process.env.DURABLE_ADDONS_ROOT!,"addons/plan-sidebar"),plan,{recursive:true,filter:path=>!path.split("/").includes("node_modules")});
  symlinkSync(join(import.meta.dir,"../../node_modules"),join(plan,"node_modules"));
  process.env.PICLAW_DB_IN_MEMORY="0";initDatabase();const database=getDb();
  const financial=()=>historicalExpenseRows(database,["budget_caps","budget_work","budget_request_reservations","budget_usage_events"]);
  const before=financial();
  const lock=acquireRuntimeLock({lockPath:join(workspace,"native-goal.lock"),strictOwnership:true,disabled:false});
  const credentials=createTestCredentialStore({});
  const model:any={provider:"fixture",id:"goal",name:"Fixture",api:"openai-completions",baseUrl:"https://fixture.invalid",input:["text"],reasoning:false,contextWindow:100000,maxTokens:1000,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};
  const host=await ModelRuntime.create({credentials,modelsPath:null,modelsStore:{read:async()=>undefined,write:async()=>{},delete:async()=>{}},allowModelNetwork:false,refreshOnCreate:false});
  let calls=0,faultPrepared=false,projectionFailures=0;let goalAddon:any;
  const logSink=(record:LogRecord)=>{if(record.operation==="application.message_projection_pending")projectionFailures++;};addLogSink(logSink);
  const run=(physical:any,transcript:any)=>{
    const out=createAssistantMessageEventStream();const attempt=++calls;
    const done=transcript.messages.some((message:any)=>message.role==="toolResult"&&message.toolName==="goal_complete"&&!message.isError);
    if(fault==="tokens"&&attempt===1){
      const authority={extensionId:"goal",chatJid:"web:default",assertCurrent:()=>lock.assertCurrentOwner(),write<T>(body:()=>T):T{return database.transaction(body).immediate();}};
      withExtensionKvAuthority(authority,()=>goalAddon.applyGoalConfig("web:default",{token_budget:3}));
    }
    const content=fault==="tokens"?[{type:"text",text:attempt===1?"Token budget reached.":"Final token-budget wrap-up."}]:done?[{type:"text",text:"Native Goal complete."}]:continuation&&attempt===1?[{type:"text",text:"Need one more step."}]
      :[{type:"toolCall",id:"complete-native-goal",name:"goal_complete",arguments:{summary:"Native SDK Goal path exercised",evidence:["The actual native fixture reached its accepted Goal input."]}}];
    if(done&&fault==="rollback"&&!faultPrepared){faultPrepared=true;database.exec("CREATE TEMP TRIGGER fail_native_goal_publication BEFORE UPDATE ON extension_kv WHEN NEW.extension_id='goal' AND NEW.key='thread-goal' AND json_extract(NEW.value,'$.tokens_used')>=6 BEGIN SELECT RAISE(ABORT,'native Goal publication fault'); END");}
    const message:any={role:"assistant",api:physical.api,provider:physical.provider,model:physical.id,timestamp:Date.now(),content,stopReason:content[0].type==="toolCall"?"toolUse":"stop",
      usage:{input:2,output:1,cacheRead:0,cacheWrite:0,totalTokens:3,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
    queueMicrotask(()=>{out.push({type:"done",reason:message.stopReason,message});out.end(message);});return out;
  };
  host.registerNativeProvider({id:model.provider,name:"Fixture",getModels:()=>[model],auth:{apiKey:{name:"Keyless",resolve:async()=>({auth:{},source:"fixture"})}},stream:run as any,streamSimple:run as any});
  await host.refresh({allowNetwork:false});
  const services:any={modelRuntime:host,modelRegistry:{getAvailable:()=>[model]}};
  let backend:Awaited<ReturnType<typeof createDefaultApplicationRuntime>>|undefined,pool:AgentPool|undefined,channel:WebChannel|undefined;
  const base=createRuntimeBaseServices({dataDir:workspace});
  try{
    backend=await createDefaultApplicationRuntime(lock,async()=>services);
    goalAddon=await import(pathToFileURL(join(goalPackage,"index.ts")).href);
    pool=new AgentPool({credentialStore:credentials,modelRuntime:host,modelRegistry:services.modelRegistry,...backend.sessionOptions} as any);
    const bound=backend.bind({queue:base.queue,agentPool:pool});channel=new WebChannel(bound);
    if(fault==="postcommit"){
      const broadcast=channel.broadcastEvent.bind(channel);
      channel.broadcastEvent=(event,data:any)=>{if(!faultPrepared&&event==="new_post"&&data?.data?.type==="agent_response"){faultPrepared=true;throw Error("native Goal publication ACK lost");}broadcast(event,data);};
    }
    backend.attachChannel!(channel);
    channel.queue.isLaneBusy=()=>{throw Error("Host lane cannot own Goal continuation");};
    expect(await pool.applySlashCommand("web:default","/goal Exercise native SDK Goal source")).toMatchObject({status:"success"});
    const goal=()=>JSON.parse((database.query("SELECT value FROM extension_kv WHERE extension_id='goal' AND scope='chat' AND scope_key='web:default' AND key='thread-goal'").get() as {value:string}).value);
    if(fault==="rollback"||fault==="postcommit"){
      const failedBy=Date.now()+5000;while(!projectionFailures&&Date.now()<failedBy)await Bun.sleep(10);
      expect(projectionFailures).toBe(1);expect(faultPrepared).toBe(true);
      expect(database.query("SELECT count(*) n FROM messages WHERE is_bot_message=1").get()).toEqual({n:fault==="rollback"?0:1});
      expect(goal().tokens_used).toBe(fault==="rollback"?3:6);
      const original=database.query("SELECT rowid,id FROM messages WHERE is_bot_message=0 ORDER BY rowid LIMIT 1").get() as {rowid:number;id:string};
      const dispatches=calls;
      if(fault==="rollback")database.exec("DROP TRIGGER fail_native_goal_publication");
      await bound.dispatchAcceptedInput!("web:default",original.id,original.rowid);
      expect(calls).toBe(dispatches);
    }
    const count=continuation||fault==="tokens"?2:1,deadline=Date.now()+6000;
    while((database.query("SELECT count(*) n FROM messages WHERE is_bot_message=1").get() as {n:number}).n<count&&Date.now()<deadline)await Bun.sleep(10);
    expect(database.query("SELECT count(*) n FROM messages WHERE is_bot_message=1").get()).toEqual({n:count});
    expect(goal()).toMatchObject({status:fault==="tokens"?"budget_limited":"complete",tokens_used:continuation?9:6});
    if(fault==="tokens")expect(goal()).toMatchObject({token_budget:3,budget_limit_reported:true});
    expect(calls).toBe(continuation?3:2);
    expect(database.query("SELECT count(*) n FROM token_usage").get()).toEqual({n:calls});
    expect(database.query("SELECT * FROM service_effect_s01_operations").all()).toEqual([]);
    expect(database.query("SELECT * FROM service_effect_s02_commits").all()).toEqual([]);
    expect(database.query("SELECT state FROM service_effect_s01_sources").all()).toEqual(Array.from({length:count},()=>({state:"consumed"})));
    expect(financial()).toEqual(before);
    const messages=database.query("SELECT * FROM messages ORDER BY rowid").all(),state=goal(),dispatches=calls;
    await backend.close();backend=await createDefaultApplicationRuntime(lock,async()=>services);
    expect(calls).toBe(dispatches);expect(goal()).toEqual(state);expect(database.query("SELECT * FROM messages ORDER BY rowid").all()).toEqual(messages);
  }finally{removeLogSink(logSink);await backend?.close();await channel?.stop();await base.queue.shutdown();await pool?.shutdown();await closeDatabase();lock.release();}
},30000);
