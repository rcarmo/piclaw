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
import { buildA2uiAction } from "../../runtime/src/channels/web/a2ui/action.js";
import { isA2uiSurfaceBlock } from "../../runtime/src/channels/web/a2ui/surface.js";
import { CLASSIC_A2UI_RENDERER_CAPABILITIES } from '../../runtime/src/channels/web/a2ui/capabilities.js';
import { getMessageByRowId } from "../../runtime/src/db/messages.js";
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
  let followupModelInput: string | undefined;
  const queuedEvents: Record<string, unknown>[] = [];
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
      if (text?.includes('follow-up instruction')) followupModelInput = text;
      if (text?.includes("Native recovery proof")) throw Error("HTTP 503 unavailable");
      const tool=transcript.messages.findLast((message:any)=>message.role==="toolResult"&&message.toolName==="read");
      if(tool){expect(JSON.stringify(tool)).toContain("SDK tool source proof");toolSeen=true;}
      const formTool=transcript.messages.findLast((message:any)=>message.role==="toolResult"&&message.toolName==="send_a2ui");
      const showForm=text?.includes("Native surface proof")&&!formTool;
      const content=attempt===1 ? [{type:"toolCall",id:"native-read",name:"read",arguments:{path:join(workspace,"native-read-proof.txt")}}]
        : showForm ? [{type:"toolCall",id:"native-a2ui",name:"send_a2ui",arguments:{fallback:"Native form",express:'root = Button(Text("Confirm"),action=Event("confirm"))'}}]
        : [{type:"text",text:`SDK answer ${text}`}];
      const message:any={role:"assistant",api:physical.api,provider:physical.provider,model:physical.id,timestamp:Date.now(),content,stopReason:attempt===1||showForm?"toolUse":"stop",
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
    const dispatch = channel.dispatchAcceptedInput!.bind(channel);
    channel.dispatchAcceptedInput = async (chat, id, row, mode) => {
      const prepared = database.query(`SELECT b.submission_id,s.state FROM service_effect_s01_sources s
        JOIN piclaw_durable_bindings_v1 b ON b.chat_jid=s.chat_jid AND b.source_seq=s.source_seq
        WHERE s.chat_jid=? AND s.source_id=?`).get(chat,id);
      expect(prepared).toEqual({submission_id:null,state:'pending'});
      expect(database.query('SELECT id FROM submissions WHERE request_id=?').get(`message:${row}:${id}`)).toBeNull();
      return dispatch(chat,id,row,mode);
    };
    const broadcast = channel.broadcastEvent.bind(channel);
    channel.broadcastEvent = (event, data) => {
      if (event === 'agent_followup_queued') queuedEvents.push(data as Record<string, unknown>);
      broadcast(event, data);
    };
    backend.attachChannel!(channel);
    channel.queue.isLaneBusy=()=>{throw Error("Host lane admission is retired");};
    (channel as any).getQueuedFollowupCount=()=>{throw Error("UI queue admission is retired");};
    (channel as any).getAcceptedQueuedSteering=()=>{throw Error("Host steering admission is retired");};
    pool.isActive=()=>true;pool.isStreaming=()=>false;
    const send=async(content:string,mode="auto",offerA2ui=false)=>{
      const request=new Request("https://fixture/agent/default/message",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({content,mode,
        metadata:offerA2ui ? {a2uiRendererCapabilities:CLASSIC_A2UI_RENDERER_CAPABILITIES} : undefined})});
      const response=await handleAgentMessage(channel!,request,"/agent/default/message","web:default","default");
      expect(response.status).toBe(201);return response.json() as Promise<any>;
    };
    database.exec("CREATE TEMP TRIGGER prebind_fault BEFORE INSERT ON piclaw_durable_bindings_v1 BEGIN SELECT RAISE(ABORT,'synthetic prebind write fault'); END");
    const refused=await handleAgentMessage(channel,new Request('https://fixture/agent/default/message',{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({content:'Atomic correlation rollback'})
    }),'/agent/default/message','web:default','default');
    database.exec('DROP TRIGGER prebind_fault');
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({error:'Message admission could not be confirmed.'});
    expect(database.query('SELECT count(*) n FROM messages WHERE is_bot_message=0').get()).toEqual({n:0});
    expect(database.query('SELECT count(*) n FROM service_effect_s01_sources').get()).toEqual({n:0});
    expect(database.query('SELECT count(*) n FROM piclaw_durable_bindings_v1').get()).toEqual({n:0});
    expect(calls).toBe(0);
    const primary=await send("primary instruction");await entered.promise;
    // Fault ONLY the secondary Root correlation ACK, after real SDK admission.
    // It must not turn accepted input into an HTTP failure, timeline item or lost reply.
    database.exec("CREATE TEMP TRIGGER native_ack_fault BEFORE UPDATE OF submission_id ON piclaw_durable_bindings_v1 WHEN NEW.source_id IN (SELECT id FROM messages WHERE content='follow-up instruction') BEGIN SELECT RAISE(ABORT,'synthetic native ACK fault'); END");
    const followup=await send("follow-up instruction","queue",true),steer=await send("steering instruction","steer");
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
    expect(queue.items.map((item:any)=>item.content)).toEqual(['follow-up instruction','steering instruction']);
    const liveFollowup = () => queuedEvents.find(event => event.row_id === followup.submission_id && event.mode === 'followUp');
    const watchDeadline = Date.now() + 2000;
    while (!liveFollowup() && Date.now() < watchDeadline) await Bun.sleep(10);
    expect(liveFollowup()).toMatchObject({ chat_jid: 'web:default', content: 'follow-up instruction', source: 'native_sdk' });
    expect(JSON.stringify(queuedEvents)).not.toContain('A2UI renderer metadata');
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
    expect(followupModelInput).toBe(JSON.stringify('follow-up instruction'));
    const acceptedRecords = database.query('SELECT record FROM submissions WHERE id=?').get(followup.submission_id);
    const acceptedEntries = database.query("SELECT record FROM entries WHERE json_extract(record,'$.kind')='host.accepted'").all();
    expect(JSON.stringify([acceptedRecords,acceptedEntries])).not.toContain('A2UI renderer metadata');
    expect(JSON.stringify([acceptedRecords,acceptedEntries])).not.toContain('a2uiRendererCapabilities');
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
    const formRoot = await send("Native surface proof", "auto", true);
    const readForm = () => database.query("SELECT rowid,thread_id FROM messages WHERE content = 'Native form' AND is_bot_message=1").get() as { rowid:number;thread_id:number } | null;
    const formDeadline = Date.now()+5000;
    while (!readForm() && Date.now()<formDeadline) await Bun.sleep(10);
    const form = readForm()!;
    expect(form.thread_id).toBe(formRoot.thread_id);
    const block = getMessageByRowId("web:default",form.rowid)?.data?.content_blocks?.find(isA2uiSurfaceBlock)!;
    expect(block).toMatchObject({ owner:"agent",revision:1,state:"active" });
    const message = buildA2uiAction(block.surface,"root",new Map(),new Date().toISOString());
    const body = JSON.stringify({ chat_jid:"web:default",post_id:form.rowid,thread_id:form.thread_id,revision:1,request_id:crypto.randomUUID(),message });
    const submit = (origin = "https://fixture") => channel!.handleRequest(new Request("https://fixture/agent/a2ui-action",{
      method:"POST",headers:{"content-type":"application/json",origin},body,
    }));
    expect((await submit("https://other.invalid")).status).toBe(403);
    expect((await submit()).status).toBe(201);
    expect((await submit()).status).toBe(200);
    const reload = await channel.handleRequest(new Request(`https://fixture/thread/${form.rowid}?chat_jid=web:default`));
    expect(reload.status).toBe(200);
    const { thread } = await reload.json() as {thread: { data: {content_blocks: unknown[]} }[]};
    expect(thread[0]?.data.content_blocks.find(isA2uiSurfaceBlock)).toMatchObject({state:"completed",revision:2});
    expect(database.query("SELECT count(*) n FROM messages WHERE content='Submitted confirm' AND thread_id=?").get(form.thread_id)).toEqual({n:1});

    await control.setExecutionPolicy!("autoRetry",false);
    const failedRoot = await send("Native recovery proof");
    const terminal = database.query("SELECT rowid FROM messages WHERE is_terminal_agent_reply=1 AND thread_id=?");
    const readReply = (thread: number) => (terminal.get(thread) as {rowid:number} | null)?.rowid;
    const failureDeadline = Date.now()+5000;
    while (!readReply(failedRoot.thread_id) && Date.now()<failureDeadline) await Bun.sleep(10);
    const failedPost = readReply(failedRoot.thread_id)!;
    const recovery = getMessageByRowId("web:default",failedPost)?.data?.content_blocks?.find(isA2uiSurfaceBlock)!;
    expect(recovery).toMatchObject({owner:"recovery",state:"active",revision:1});
    const recoverBody = {chat_jid:"web:default",post_id:failedPost,thread_id:failedRoot.thread_id,revision:1,request_id:crypto.randomUUID(),
      message:buildA2uiAction(recovery.surface,"continue",new Map(),new Date().toISOString())};
    const recover = (threadId: number) => channel!.handleRequest(new Request("https://fixture/agent/a2ui-action",{method:"POST",
      headers:{"content-type":"application/json"},body:JSON.stringify({...recoverBody,thread_id:threadId})}));
    expect((await recover(form.thread_id)).status).toBe(409);
    const recovered = await recover(failedRoot.thread_id);
    expect(recovered.status).toBe(201);
    expect((await recover(failedRoot.thread_id)).status).toBe(200);
    expect(database.query("SELECT count(*) n FROM messages WHERE is_bot_message=0 AND thread_id=? AND content LIKE 'Continue the previous answer%'").get(failedRoot.thread_id)).toEqual({n:1});
    expect(getMessageByRowId("web:default",failedPost)?.data?.content_blocks?.find(isA2uiSurfaceBlock)).toMatchObject({state:"completed",revision:2});
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

applicationTest("cold attach publishes a terminal reply committed before attachment without replaying history", async () => {
  const workspace=process.env.PICLAW_WORKSPACE!;
  process.env.PICLAW_DB_IN_MEMORY="0";initDatabase();const db=getDb();
  mkdirSync(getPiclawAgentDir(),{recursive:true});
  const lock=acquireRuntimeLock({lockPath:join(workspace,"native-cold-attach.lock"),strictOwnership:true,disabled:false});
  const credentials=createTestCredentialStore({});
  const model:any={provider:"fixture",id:"direct",name:"Fixture",api:"openai-completions",baseUrl:"https://fixture.invalid",input:["text"],reasoning:false,contextWindow:100000,maxTokens:1000,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};
  const host=await ModelRuntime.create({credentials,modelsPath:null,modelsStore:{read:async()=>undefined,write:async()=>{},delete:async()=>{}},allowModelNetwork:false,refreshOnCreate:false});
  let calls=0;
  function run(physical:any){
    const stream=createAssistantMessageEventStream();
    const message:any={role:"assistant",api:physical.api,provider:physical.provider,model:physical.id,timestamp:Date.now(),
      content:[{type:"text",text:`fixture reply ${++calls}`}],stopReason:"stop",
      usage:{input:5,output:2,cacheRead:0,cacheWrite:0,totalTokens:7,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
    stream.push({type:"done",reason:"stop",message});stream.end(message);return stream;
  }
  host.registerNativeProvider({id:model.provider,name:"Fixture",getModels:()=>[model],auth:{apiKey:{name:"Keyless fixture",resolve:async()=>({auth:{},source:"fixture"})}},stream:run,streamSimple:run});
  await host.refresh({allowNetwork:false});
  const services:any={modelRuntime:host,modelRegistry:{getAvailable:()=>[model]}};
  const base=createRuntimeBaseServices({dataDir:workspace});
  let backend:Awaited<ReturnType<typeof createDefaultApplicationRuntime>>|undefined;
  let pool:AgentPool|undefined,channel:WebChannel|undefined;
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  const stop=async()=>{await backend?.close();await channel?.stop();await pool?.shutdown();backend=undefined;channel=undefined;pool=undefined;};
  const open=async()=>{
    backend=await createDefaultApplicationRuntime(lock,async()=>services);
    pool=new AgentPool({credentialStore:credentials,modelRuntime:host,modelRegistry:services.modelRegistry,...backend.sessionOptions});
    return channel=new WebChannel(backend.bind({queue:base.queue,agentPool:pool}));
  };
  const chat="web:default";
  const replies=()=>db.query("SELECT rowid,id,thread_id,content FROM messages WHERE chat_jid=? AND is_terminal_agent_reply=1 ORDER BY rowid")
    .all(chat) as {rowid:number;id:string;thread_id:number;content:string}[];
  const send=async(web:WebChannel,content:string)=>{
    const result=await handleAgentMessage(web,new Request("https://fixture/agent/default/message",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({content})}),"/agent/default/message",chat,"default");
    expect(result.status).toBe(201);return await result.json() as {submission_id:number;thread_id:number};
  };
  const waitForReplies=async(n:number)=>{
    const until=Date.now()+5000;while(replies().length<n&&Date.now()<until)await Bun.sleep(10);
    expect(replies()).toHaveLength(n);
  };
  const abort=new AbortController();let deadline:ReturnType<typeof setTimeout>|undefined;
  try{
    let web=await open();backend!.attachChannel!(web);
    const past=await send(web,"Committed history");await waitForReplies(1);
    const historical=replies()[0]!;expect(historical.thread_id).toBe(past.thread_id);
    await stop();

    web=await open();
    const decoder=new TextDecoder();
    reader=web.handleSse(new Request(`https://fixture/sse/stream?chat_jid=${chat}`,{signal:abort.signal})).body!.getReader();
    deadline=setTimeout(()=>abort.abort(),5000);
    expect(decoder.decode((await reader.read()).value)).toStartWith("event: connected\n");
    expect(replies()).toEqual([historical]);
    const early=await send(web,"Accepted before publisher attachment");await waitForReplies(2);
    const terminal=replies()[1]!;expect(terminal.thread_id).toBe(early.thread_id);
    const seen:number[]=[];
    const broadcast=web.broadcastEvent.bind(web);
    web.broadcastEvent=(event,data)=>{
      const post=data as {id?:number;data?:{is_terminal_agent_reply?:boolean}};
      if(event==="new_post"&&post.data?.is_terminal_agent_reply&&post.id!==undefined)seen.push(post.id);
      broadcast(event,data);
    };
    backend!.attachChannel!(web,"cold-start");
    for(;;){
      const frame=await reader.read();expect(frame.done).toBe(false);
      const [type,body]=decoder.decode(frame.value).split("\n");
      if(type!=="event: new_post"||!body?.startsWith("data: "))continue;
      const post=JSON.parse(body.slice(6));
      if(!post.data?.is_terminal_agent_reply)continue;
      expect(post.id).toBe(terminal.rowid);break;
    }
    await stop();
    expect(seen).toEqual([terminal.rowid]);expect(replies()).toEqual([historical,terminal]);
    expect(db.query("SELECT id,status FROM submissions ORDER BY id").all()).toEqual([
      {id:past.submission_id,status:"done"},{id:early.submission_id,status:"done"},
    ]);
    expect(calls).toBe(2);
  }finally{
    clearTimeout(deadline);abort.abort();await reader?.cancel().catch(()=>{});
    await stop();await base.queue.shutdown();await closeDatabase();lock.release();
  }
},30000);
