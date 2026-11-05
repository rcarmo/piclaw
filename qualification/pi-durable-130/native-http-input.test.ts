import { awaitWithContext, withAbortSignal, BACKGROUND_CONTEXT } from "../../runtime/durable-engine/qualification/context.ts";
import "./src/test-guard.js";
import { expect } from "bun:test";
import { join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { isolatedApplicationTest } from "./src/isolated-application-test.js";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { acquireRuntimeLock } from "../../runtime/src/runtime/single-instance.js";
import { getPiclawAgentDir } from "../../runtime/src/core/agent-dir.js";
import { createTestCredentialStore } from "../../runtime/test/model-services-fixture.js";
import { AgentPool } from "../../runtime/src/agent-pool.js";
import { createRuntimeBaseServices } from "../../runtime/src/runtime/composition.js";
import { WebChannel } from "../../runtime/src/channels/web.js";
import { handleAgentMessage } from "../../runtime/src/channels/web/handlers/agent.js";
import { createDefaultApplicationRuntime } from "../../runtime/durable-engine/src/default-application-runtime.js";
import { ModelRuntime } from "../../node_modules/@earendil-works/pi-coding-agent/dist/index.js";
import { createAssistantMessageEventStream } from "../../node_modules/@earendil-works/pi-ai";

const applicationTest=isolatedApplicationTest(import.meta.url);
const pause=()=>{let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};};

applicationTest("real HTTP submit/queue/steer bypass stale host activity and persist SDK answers with no host operations",async()=>{
  const workspace=process.env.PICLAW_WORKSPACE!;
  process.env.PICLAW_DB_IN_MEMORY="0";initDatabase();const database=getDb();
  mkdirSync(getPiclawAgentDir(),{recursive:true});writeFileSync(join(workspace,"native-read-proof.txt"),"SDK tool source proof\n");
  const lock=acquireRuntimeLock({lockPath:join(workspace,"native-http.lock"),strictOwnership:true,disabled:false});
  const credentials=createTestCredentialStore({});
  const model:any={provider:"fixture",id:"direct",name:"Fixture",api:"openai-completions",baseUrl:"https://fixture.invalid",input:["text"],reasoning:false,contextWindow:100000,maxTokens:1000,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};
  const host=await ModelRuntime.create({credentials,modelsPath:null,modelsStore:{read:async()=>undefined,write:async()=>{},delete:async()=>{}},allowModelNetwork:false,refreshOnCreate:false});
  const entered=pause(),release=pause();let calls=0,toolSeen=false;
  const heldRequests=new Map<number,{entered:ReturnType<typeof pause>;release:ReturnType<typeof pause>}>();
  const requestSignals=new Map<number,AbortSignal|undefined>();
  host.registerNativeProvider({id:model.provider,name:"Fixture",getModels:()=>[model],auth:{apiKey:{name:"Keyless fixture",resolve:async()=>({auth:{},source:"fixture"})}},
    stream:run as any,streamSimple:run as any});
  function run(physical:any,transcript:any,options?:{signal?:AbortSignal}){
    const out=createAssistantMessageEventStream();const attempt=++calls;requestSignals.set(attempt,options?.signal);
    void(async()=>{
      if(attempt===1){entered.release();await release.promise;}
      const held=heldRequests.get(attempt);if(held){held.entered.release();await awaitWithContext(held.release.promise,withAbortSignal(options!.signal!,BACKGROUND_CONTEXT));}
      options?.signal?.throwIfAborted();
      const users=transcript.messages.filter((message:any)=>message.role==="user");
      const text=JSON.stringify(users.at(-1)?.content);
      const tool=transcript.messages.findLast((message:any)=>message.role==="toolResult"&&message.toolName==="read");
      if(tool){expect(JSON.stringify(tool)).toContain("SDK tool source proof");toolSeen=true;}
      const content=attempt===1?[{type:"toolCall",id:"native-read",name:"read",arguments:{path:join(workspace,"native-read-proof.txt")}}]:[{type:"text",text:`SDK answer ${text}`}];
      const message:any={role:"assistant",api:physical.api,provider:physical.provider,model:physical.id,timestamp:Date.now(),content,stopReason:attempt===1?"toolUse":"stop",
        usage:{input:5,output:2,cacheRead:0,cacheWrite:0,totalTokens:7,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
      out.push({type:"done",reason:message.stopReason,message});out.end(message);
    })().catch(cause=>{
      const error:any={role:"assistant",api:physical.api,provider:physical.provider,model:physical.id,timestamp:Date.now(),content:[],stopReason:"error",errorMessage:String(cause),usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
      out.push({type:"error",reason:"error",error});out.end(error);
    });
    return out;
  }
  await host.refresh({allowNetwork:false});
  const services:any={modelRuntime:host,modelRegistry:{getAvailable:()=>[model]}};
  let backend:Awaited<ReturnType<typeof createDefaultApplicationRuntime>>|undefined;
  const base=createRuntimeBaseServices({dataDir:workspace});let pool:AgentPool|undefined;let channel:WebChannel|undefined;
  try{
    backend=await createDefaultApplicationRuntime(lock,async()=>services);
    pool=new AgentPool({credentialStore:credentials,modelRuntime:host,modelRegistry:services.modelRegistry,...backend.sessionOptions} as any);
    const bound=backend.bind({queue:base.queue,agentPool:pool});channel=new WebChannel(bound);
    backend.attachChannel!(channel);
    channel.queue.isLaneBusy=()=>{throw Error("Host lane admission is retired");};
    channel.getQueuedFollowupCount=()=>{throw Error("UI queue admission is retired");};
    (channel as any).getAcceptedQueuedSteering=()=>{throw Error("Host steering admission is retired");};
    pool.isActive=()=>true;pool.isStreaming=()=>false;
    const send=async(content:string,mode="auto")=>{
      const request=new Request("https://fixture/agent/default/message",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({content,mode})});
      const response=await handleAgentMessage(channel!,request,"/agent/default/message","web:default","default");
      expect(response.status).toBe(201);return response.json() as Promise<any>;
    };
    const primary=await send("primary instruction");await entered.promise;
    // Fault ONLY the secondary Root correlation ACK, after real SDK admission.
    // It must not turn accepted input into an HTTP failure, timeline item or lost reply.
    database.exec("CREATE TEMP TRIGGER native_ack_fault BEFORE UPDATE OF submission_id ON piclaw_durable_bindings_v1 WHEN NEW.source_id IN (SELECT id FROM messages WHERE content='follow-up instruction') BEGIN SELECT RAISE(ABORT,'synthetic native ACK fault'); END");
    const followup=await send("follow-up instruction","queue"),steer=await send("steering instruction","steer");
    database.exec("DROP TRIGGER native_ack_fault");
    const lostBinding=()=>database.query("SELECT b.submission_id FROM piclaw_durable_bindings_v1 b JOIN messages m ON m.id=b.source_id AND m.chat_jid=b.chat_jid WHERE m.rowid=?").get(followup.thread_id);
    expect(lostBinding()).toEqual({submission_id:null});
    expect(primary.submission_id).toBeGreaterThan(0);
    expect(followup.queued).toBe("followup");expect(typeof followup.submission_id).toBe("number");
    expect(steer.queued).toBe("steer");expect(typeof steer.submission_id).toBe("number");
    expect(database.query("SELECT * FROM service_effect_s01_operations").all()).toEqual([]);
    const queueRequest=()=>new Request("https://fixture/agent/queue-state?chat_jid=web:default");
    const queue=await (await channel.handleAgentQueueState(queueRequest())).json() as any;
    expect(queue.count).toBe(2);expect(queue.items.map((item:any)=>item.row_id)).toEqual([followup.submission_id,steer.submission_id]);
    const action=(path:string,id:number)=>new Request(`https://fixture/agent/${path}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_jid:"web:default",row_id:id})});
    const modeBefore=database.query("SELECT record FROM submissions WHERE id=?").get(steer.submission_id);
    expect((await channel.handleAgentQueueSteer(action("queue-steer",steer.submission_id))).status).toBe(201);
    expect(database.query("SELECT record FROM submissions WHERE id=?").get(steer.submission_id)).toEqual(modeBefore);
    const disposable=await send("withdraw this queued input","queue");
    const removed=await (await channel.handleAgentQueueRemove(action("queue-remove",disposable.submission_id))).json() as any;
    expect(removed).toMatchObject({removed:true,count:2});
    expect((await (await channel.handleAgentQueueState(queueRequest())).json() as any).count).toBe(2);
    expect(database.query("SELECT * FROM service_effect_s02_commits").all()).toEqual([]);
    const pendingTimeline=await (await channel.handleTimeline(50,undefined,"web:default")).json() as any;
    expect(pendingTimeline.posts.map((post:any)=>post.id)).toEqual([primary.thread_id]);
    expect(database.query("SELECT count(*) n FROM messages WHERE is_bot_message=0").get()).toEqual({n:4});
    release.release();
    const deadline=Date.now()+5000;
    while((database.query("SELECT count(*) n FROM messages WHERE is_bot_message=1").get() as {n:number}).n<2&&Date.now()<deadline)await Bun.sleep(10);
    const replies=database.query("SELECT id,content,thread_id FROM messages WHERE is_bot_message=1 ORDER BY rowid").all() as {id:string;content:string;thread_id:number}[];
    expect(replies).toHaveLength(2);expect(replies[0]!.content).toContain("steering instruction");expect(replies[1]!.content).toContain("follow-up instruction");
    expect(replies.map(reply=>reply.thread_id)).toEqual([primary.thread_id,followup.thread_id]);
    expect(toolSeen).toBe(true);expect(calls).toBe(3);
    expect(lostBinding()).toEqual({submission_id:null}); // Reply publication used SDK evidence, never a manufactured ACK.
    const placedTimeline=await (await channel.handleTimeline(50,undefined,"web:default")).json() as any;
    expect(placedTimeline.posts.filter((post:any)=>post.data.type==="user_message").map((post:any)=>post.id)).toEqual([primary.thread_id,followup.thread_id,steer.thread_id]);
    expect(database.query("SELECT count(*) n FROM token_usage").get()).toEqual({n:3});
    expect(database.query("SELECT * FROM service_effect_s01_operations").all()).toEqual([]);
    expect(database.query("SELECT * FROM service_effect_s02_commits").all()).toEqual([]);
    expect(database.query("SELECT state FROM service_effect_s01_sources").all()).toEqual([{state:"consumed"},{state:"consumed"},{state:"consumed"},{state:"consumed"}]);
    const interrupted={entered:pause(),release:pause()};heldRequests.set(4,interrupted);
    await send("cancel this request");await interrupted.entered.promise;
    const control=backend.sessionOptions.getDurableSession!("web:default")!;
    const captured=await control.readAbortScope!();expect(captured).toMatchObject({kind:"sdk",submissionIds:[expect.any(Number)]});
    expect(await control.abort!(captured!)).toBe(true);
    expect(requestSignals.get(4)?.aborted).toBe(true);interrupted.release.release();
    const successor={entered:pause(),release:pause()};heldRequests.set(5,successor);
    await send("successor must survive stale abort");await successor.entered.promise;
    expect(await control.abort!(captured!)).toBe(false);expect(requestSignals.get(5)?.aborted).toBe(false);
    successor.release.release();
    const completedBy=Date.now()+4000;
    while((database.query("SELECT count(*) n FROM messages WHERE is_bot_message=1").get() as {n:number}).n<3&&Date.now()<completedBy)await Bun.sleep(10);
    expect(database.query("SELECT count(*) n FROM messages WHERE is_bot_message=1").get()).toEqual({n:3});
    expect(database.query("SELECT * FROM service_effect_s01_operations").all()).toEqual([]);
    expect(database.query("SELECT * FROM service_effect_s02_commits").all()).toEqual([]);
  }finally{release.release();await backend?.close();await channel?.stop();await base.queue.shutdown();await pool?.shutdown();await closeDatabase();lock.release();}
},30000);

applicationTest("real HTTP native status and singleton exit publish a notice before joined cleanup, with no operation or S02",async()=>{
  const workspace=process.env.PICLAW_WORKSPACE!;process.env.PICLAW_DB_IN_MEMORY="0";initDatabase();const database=getDb();
  mkdirSync(getPiclawAgentDir(),{recursive:true});
  const lock=acquireRuntimeLock({lockPath:join(workspace,"native-exit-http.lock"),strictOwnership:true,disabled:false});
  const credentials=createTestCredentialStore({});
  const model:any={provider:"fixture",id:"direct",name:"Fixture",api:"openai-completions",baseUrl:"https://fixture.invalid",input:["text"],reasoning:false,contextWindow:100000,maxTokens:1000,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};
  const host=await ModelRuntime.create({credentials,modelsPath:null,modelsStore:{read:async()=>undefined,write:async()=>{},delete:async()=>{}},allowModelNetwork:false,refreshOnCreate:false});
  let calls=0,shutdowns=0,statusSeen=false;
  // Existing disposable-process interception: no process exit, live service or
  // shutdown handler is invoked. Keep the trap installed through child teardown.
  (globalThis as any).__PICLAW_EXIT_SCHEDULER__=()=>{shutdowns++;expect(database.query("SELECT content FROM messages WHERE is_bot_message=1 AND is_terminal_agent_reply=1").all()).toHaveLength(1);expect(database.query("SELECT id FROM tasks WHERE status<>'terminal'").all()).toEqual([]);};
  host.registerNativeProvider({id:model.provider,name:"Fixture",getModels:()=>[model],auth:{apiKey:{name:"Keyless fixture",resolve:async()=>({auth:{},source:"fixture"})}},stream:run as any,streamSimple:run as any});
  function run(physical:any,transcript:any){
    const out=createAssistantMessageEventStream();calls++;
    if(calls===2){const result=transcript.messages.findLast((message:any)=>message.role==="toolResult"&&message.toolName==="session_status");const text=result.content.filter((part:any)=>part.type==="text").map((part:any)=>part.text).join("");expect(JSON.parse(text).safe_to_restart).toBe(true);statusSeen=true;}
    if(calls>2)throw Error("No provider request may follow an accepted native exit");
    const content=[{type:"toolCall",id:`control-${calls}`,name:calls===1?"session_status":"exit_process",arguments:calls===1?{action:"check"}:{reason:"approved disposable native exit"}}];
    const message:any={role:"assistant",api:physical.api,provider:physical.provider,model:physical.id,timestamp:Date.now(),content,stopReason:"toolUse",usage:{input:5,output:2,cacheRead:0,cacheWrite:0,totalTokens:7,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
    out.push({type:"done",reason:"toolUse",message});out.end(message);return out;
  }
  await host.refresh({allowNetwork:false});const services:any={modelRuntime:host,modelRegistry:{getAvailable:()=>[model]}};
  let backend:Awaited<ReturnType<typeof createDefaultApplicationRuntime>>|undefined;
  const base=createRuntimeBaseServices({dataDir:workspace});let pool:AgentPool|undefined;let channel:WebChannel|undefined;
  try{
    backend=await createDefaultApplicationRuntime(lock,async()=>services);pool=new AgentPool({credentialStore:credentials,modelRuntime:host,modelRegistry:services.modelRegistry,...backend.sessionOptions} as any);
    channel=new WebChannel(backend.bind({queue:base.queue,agentPool:pool}));backend.attachChannel!(channel);
    const response=await handleAgentMessage(channel,new Request("https://fixture/agent/default/message",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({content:"Perform the approved disposable restart"})}),"/agent/default/message","web:default","default");
    expect(response.status).toBe(201);const accepted=await response.json() as any;expect(accepted.submission_id).toBeGreaterThan(0);
    const until=Date.now()+5000;while(!shutdowns&&Date.now()<until)await Bun.sleep(10);
    expect(statusSeen).toBe(true);expect(calls).toBe(2);expect(shutdowns).toBe(1);
    const rows=database.query("SELECT content,thread_id FROM messages WHERE is_bot_message=1").all() as {content:string;thread_id:number}[];
    expect(rows).toHaveLength(1);expect(rows[0]!.content).toContain("Restart requested — approved disposable native exit");expect(rows[0]!.thread_id).toBe(accepted.thread_id);
    expect(database.query("SELECT * FROM service_effect_s01_operations").all()).toEqual([]);expect(database.query("SELECT * FROM service_effect_s02_commits").all()).toEqual([]);
    expect(database.query("SELECT count(*) n FROM token_usage").get()).toEqual({n:2});
  }finally{await backend?.close();await channel?.stop();await base.queue.shutdown();await pool?.shutdown();await closeDatabase();lock.release();}
},30000);
