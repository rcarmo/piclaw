import { createHostController } from "../../runtime/durable-engine/src/host-controller.js";
import "./src/test-guard.js";
import { expect, spyOn } from "bun:test";
import { join } from "node:path";
import { isolatedApplicationTest } from "./src/isolated-application-test.js";
import { openFixture, context, barrier } from "./src/fixture.js";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { configure, defineExtension, type GenerationHooks } from "../../runtime/durable-engine/qualification/durable.ts";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/bun-sqlite.js";
import { HostConversationRuntime, type AcceptedInput, type CapturedRunSource, type RuntimeOptions } from "../../runtime/durable-engine/src/host-runtime.js";
import { createHostDurableBindings, initializeHostDurableBindings } from "../../runtime/durable-engine/src/host-bindings.js";
import { createHostOperationAuthority } from "../../runtime/durable-engine/src/host-operation-authority.js";
import { withTaskModelRequestScope } from "../../runtime/durable-engine/src/task-model-boundary-shim.js";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { storeChatMetadata, storeMessage } from "../../runtime/src/db/messages.js";
import { acquireRuntimeLock } from "../../runtime/src/runtime/single-instance.js";
import { installTerminalSettlementCompositionSchema } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { createCurrentPiclawServiceWorkStore } from "../../runtime/src/service-effects/current-piclaw/service-work-store.js";
import { createCurrentPiclawTerminalSettlementStore } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-store.js";
import { InMemoryEffectPayloadResolver } from "../../runtime/src/service-effects/testing/in-memory-payload-resolver.js";
import { effect, sealed, value } from "./src/host-handoff.js";
import { hashCanonicalRequest } from "../../runtime/src/service-effects/contracts/common.js";

const applicationTest = isolatedApplicationTest(import.meta.url);
const deadline = <T>(promise: Promise<T>) => Promise.race([promise, Bun.sleep(4000).then(()=>{throw Error("SDK fixture timeout");})]);

applicationTest("SDK owns busy submit, follow-up, steering and source fences without host operations or admission lanes", async () => {
  process.env.PICLAW_DB_IN_MEMORY = "0"; initDatabase();
  const database = getDb(); database.exec("PRAGMA foreign_keys=ON"); installTerminalSettlementCompositionSchema(database);
  const path = (database.query("PRAGMA database_list").all() as {name:string;file:string}[]).find(row=>row.name==="main")!.file;
  const lock = acquireRuntimeLock({lockPath:join(process.env.PICLAW_WORKSPACE!,"direct-sdk.lock"),strictOwnership:true,disabled:false});
  const assert = () => lock.assertCurrentOwner();
  const storage = () => SqliteStorage.open(new BunSqliteDatabase(path,{root:database,assertOwner:assert,fenceTransactions:true}));
  const fixture = await openFixture({acquired:true},()=>{},storage);
  let runtime!: HostConversationRuntime;
  let controller: Awaited<ReturnType<typeof createHostController>> | undefined;
  const captures: CapturedRunSource[] = [];
  const probe = defineExtension({name:"direct-source-proof",hooks:[{task:"pi.generation",handlers:{
    async beforeRequest(request: Parameters<NonNullable<GenerationHooks["beforeRequest"]>>[0], api: Parameters<NonNullable<GenerationHooks["beforeRequest"]>>[1]) {
      const captured = await runtime.captureRunSource(api.conversationId,api.taskId);
      expect(captured.native?.taskId).toBe(api.taskId);
      createHostOperationAuthority(database,captured,assert,true).assertCurrent();
      captures.push(captured); return request;
    },
  }}]});
  fixture.registry.install(probe);
  await fixture.root.commit(tx=>configure(tx,fixture.root.id,{extensions:[fixture.registry.snapshot().extension("qualification")!,probe]}),context);
  await fixture.close();
  const chat = "web:direct", domain = "direct-sdk-test";
  storeChatMetadata(chat,new Date().toISOString(),"Fixture");
  const work = value(createCurrentPiclawServiceWorkStore(database,{hitFault:()=>false,recordTrace(){}}));
  const terminal = value(createCurrentPiclawTerminalSettlementStore(database,new InMemoryEffectPayloadResolver(),{hitFault:()=>false,recordTrace(){}}));
  initializeHostDurableBindings(database,assert);
  const bindings = createHostDurableBindings(database,{domain,incarnation:domain,manifest:[{chatJid:chat,branchId:"main",conversationId:fixture.root.id}],assertOwner:assert,
    async resolveContent(ref){const row=database.query("SELECT content FROM messages WHERE rowid=? AND chat_jid=?").get(Number(ref.slice(12)),chat) as {content:string}|null;if(!row)throw Error("Source unavailable");return row.content;}});
  const options: RuntimeOptions = {incarnation:domain,sessionId:domain,owner:{assert,release(){}},openStorage:storage,
    harnessOptions:{models:fixture.models,registry:withTaskModelRequestScope(fixture.registry),settings:{retry:{enabled:false},compaction:{enabled:false}}},
    work:new Proxy(work,{get(target,key){if(key==="getOperation")return async()=>{throw Error("Host operation lookup must not govern native input");};const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}}),terminal,bindings,
    conversationFor:()=>fixture.root.id,existingConversationIds:[fixture.root.id],
    authorizeScheduling(){throw Error("Host scheduling policy must not own native submit");},putAnswer(){throw Error("Host settlement must not own native answers");},now:()=>new Date().toISOString()};
  runtime = await HostConversationRuntime.open(options,context);
  const accept = (content:string):AcceptedInput => database.transaction(()=>{
    const sourceId=crypto.randomUUID(),timestamp=new Date().toISOString();
    const rowId=storeMessage({id:sourceId,chat_jid:chat,sender:"user",sender_name:"User",content,timestamp,is_from_me:false,is_bot_message:false});
    const source=work.acceptSourceInTransaction(sealed({effect:effect(sourceId),chatJid:chat,sourceId,kind:"message",payloadRef:`message-row:${rowId}`,targetOperationId:null,parentSourceSeq:null,acceptedAt:timestamp,createWakeIntent:false}),database);
    const requestId=`message:${rowId}:${sourceId}`;
    return {incarnation:domain,conversationId:fixture.root.id,chatJid:chat,branchId:"main",operationId:`native-message:${fixture.root.id}:${source.sourceSeq}`,
      sourceSeq:source.sourceSeq,sourceId,payloadRef:`message-row:${rowId}`,requestId,requestHash:hashCanonicalRequest({type:"input",requestId,content})};
  }).immediate();
  let providerEntries=0;
  const held=barrier(),entered=barrier(); fixture.host.modelHold=held; fixture.host.onModelEnter=()=>{providerEntries++;entered.release();};
  let view:any, wakeInbox=()=>{};
  const inboxReady=new Promise<void>(resolve=>{wakeInbox=resolve;});
  let stop=await runtime.watchSession({incarnation:domain,chatJid:chat,branchId:"main",conversationId:fixture.root.id},next=>{
    view=next;const items=next.docs["pi.inbox"]?.items;if(Array.isArray(items)&&items.length===2)wakeInbox();
  });
  try {
    const first=accept("use-tool first input"),second=accept("follow up after the answer"),steer=accept("steer this running tool round");
    const primary=await runtime.submitMessage(first); await deadline(entered.promise);
    const followup=await runtime.submitMessage(second,"followUp"),steering=await runtime.submitMessage(steer,"steer");
    await deadline(inboxReady);
    expect(view.docs["pi.inbox"].items.map((item:any)=>[item.id,item.mode])).toEqual([[followup,"followUp"],[steering,"steer"]]);
    const inspected=await runtime.inspectAuthority();
    expect(inspected.inspection.submissions).toHaveLength(3);
    for (const submission of inspected.inspection.submissions) expect(await runtime.ownsMessageSubmission(submission)).toBe(true);
    const passive=await runtime.captureRunSource(fixture.root.id,view.docs["pi.live"].run.taskId);
    expect(()=>passive.native!.assertCurrent()).toThrow("Exact SDK invocation lifetime required");
    const queueBinding={incarnation:domain,chatJid:chat,branchId:"main",conversationId:fixture.root.id};
    expect((await runtime.readMessageInbox(queueBinding)).map(item=>item.submissionId)).toEqual([followup,steering]);
    const promoted=accept("promote this existing follow-up"),removed=accept("remove this queued input");
    const promotedId=await runtime.submitMessage(promoted,"followUp"),removedId=await runtime.submitMessage(removed,"followUp");
    const acceptedBefore=database.query("SELECT record FROM submissions WHERE id=?").get(promotedId);
    // Fault the public conversation calls, not SDK tables or accepted records.
    // The real mode transaction below must remain intact when only wake fails.
    const harness=Reflect.get(runtime,"harness") as import("../../runtime/durable-engine/qualification/durable.ts").Harness;
    const conversation=harness.conversation.bind(harness);let commits=0,wakeFailures=0;
    const beforeMode=spyOn(harness,"conversation").mockImplementation(async(id,ctx)=>{
      const handle=await conversation(id,ctx);return handle&&new Proxy(handle,{get(target,key){
        if(key==="commit")return async(...args:any[])=>{if(++commits===2)throw Error("synthetic queue-control authority denial");return (target.commit as any)(...args);};
        const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
      }});
    });
    try{await expect(runtime.steerQueuedMessage(queueBinding,promotedId)).rejects.toThrow("authority denial");}finally{beforeMode.mockRestore();}
    expect((await runtime.readMessageInbox(queueBinding)).find(item=>item.submissionId===promotedId)?.mode).toBe("followUp");
    expect(database.query("SELECT record FROM submissions WHERE id=?").get(promotedId)).toEqual(acceptedBefore);
    const afterMode=spyOn(harness,"conversation").mockImplementation(async(id,ctx)=>{
      const handle=await conversation(id,ctx);return handle&&new Proxy(handle,{get(target,key){
        if(key==="submit")return async(draft:any,context:any)=>{if(draft.type==="write"&&draft.requestId===`queue-steer:${promotedId}`){wakeFailures++;throw Error("synthetic wake admission failure");}return target.submit(draft,context);};
        const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
      }});
    });
    try{expect(await runtime.steerQueuedMessage(queueBinding,promotedId)).toBe(true);}finally{afterMode.mockRestore();}
    expect(wakeFailures).toBe(1);expect(providerEntries).toBe(1);
    expect(database.query("SELECT record FROM submissions WHERE id=?").get(promotedId)).toEqual(acceptedBefore);
    expect((await runtime.readMessageInbox(queueBinding)).find(item=>item.submissionId===promotedId)?.mode).toBe("steer");
    expect(await runtime.removeQueuedMessage(queueBinding,removedId)).toBe(true);
    expect(await runtime.waitForMessage(removed,removedId)).toMatchObject({status:"unanswered",reason:"aborted"});
    expect((await runtime.readMessageInbox(queueBinding)).some(item=>item.submissionId===removedId)).toBe(false);
    expect(database.query("SELECT * FROM service_effect_s01_operations").all()).toEqual([]);
    held.release(); fixture.host.modelHold=undefined;
    const [a,b,c]=await deadline(Promise.all([runtime.waitForMessage(first,primary),runtime.waitForMessage(second,followup),runtime.waitForMessage(steer,steering)]));
    expect(a.status).toBe("done");expect(b.status).toBe("done");expect(c.status).toBe("done");
    expect(a.answer).toBe(c.answer);expect(b.answer).not.toBe(a.answer);
    expect(fixture.host.effects).toBe(1);expect(fixture.host.modelCalls).toBe(3);
    expect(captures.map(capture=>capture.inputs.map(input=>input.sourceId))).toEqual([[first.sourceId],[first.sourceId,steer.sourceId],[second.sourceId,promoted.sourceId]]);
    expect(captures[0]!.operation.operationId).toBe(captures[1]!.operation.operationId);
    const firstAnswer=await runtime.readMessageResult(first),steerAnswer=await runtime.readMessageResult(steer),followupAnswer=await runtime.readMessageResult(second);
    expect(firstAnswer?.answer?.text).toBe("synthetic answer");
    expect(firstAnswer?.inputs.map(input=>input.sourceId)).toEqual([first.sourceId,steer.sourceId]);
    expect(steerAnswer?.inputs).toEqual(firstAnswer?.inputs);
    expect(steerAnswer?.runId).toBe(firstAnswer?.runId);
    expect(firstAnswer?.runId).toBe(captures[0]!.operation.operationId);
    expect(followupAnswer?.inputs.map(input=>input.sourceId)).toEqual([second.sourceId,promoted.sourceId]);
    expect(followupAnswer?.runId).not.toBe(firstAnswer?.runId);
    const calls=fixture.host.modelCalls;
    expect(await runtime.submitMessage(first)).toBe(primary);
    expect(fixture.host.modelCalls).toBe(calls);
    expect(database.query("SELECT * FROM service_effect_s01_operations").all()).toEqual([]);
    expect(()=>captures[0]!.native!.assertCurrent()).toThrow();
    database.query("UPDATE service_effect_s01_sources SET state='disposed' WHERE source_id=?").run(first.sourceId);
    expect(()=>captures[0]!.native!.assertCurrent()).toThrow();
    const abortHold=barrier(),abortEntered=barrier(); fixture.host.modelHold=abortHold;
    fixture.host.onModelEnter=()=>{providerEntries++;abortEntered.release();};
    const interrupted=accept("held request to cancel"),withdrawn=accept("queued request to cancel");
    const interruptedId=await runtime.submitMessage(interrupted);await deadline(abortEntered.promise);
    const withdrawnId=await runtime.submitMessage(withdrawn,"followUp");
    await runtime.abortMessages({incarnation:domain,chatJid:chat,branchId:"main",conversationId:fixture.root.id});
    expect(await runtime.waitForMessage(interrupted,interruptedId)).toMatchObject({status:"unanswered",reason:"aborted"});
    expect(await runtime.waitForMessage(withdrawn,withdrawnId)).toMatchObject({status:"unanswered",reason:"aborted"});
    fixture.host.modelHold=undefined;abortHold.release();
    const restartHold=barrier(),restartEntered=barrier(); fixture.host.modelHold=restartHold;
    fixture.host.onModelEnter=()=>{providerEntries++;restartEntered.release();};
    const restartInput=accept("accepted request interrupted by SDK close"),restartQueue=accept("accepted follow-up retained across SDK close");
    const restartId=await runtime.submitMessage(restartInput);await deadline(restartEntered.promise);
    const restartQueuedId=await runtime.submitMessage(restartQueue,"followUp");
    const dispatches=providerEntries;
    await stop(); stop=async()=>{};await runtime.close();
    controller=await createHostController({
      acquireOwnership:async()=>({assertCurrentOwner:assert,release(){}}),createStorage:storage,
      runtime:{...options},recovery:{manifest:[{chatJid:chat,branchId:"main",conversationId:fixture.root.id}],work,bindings,
        async readAcceptedInput(){throw Error("Host recovery must not reconstruct or replay direct SDK messages");}},
    },context);
    runtime=controller.runtime;
    expect(providerEntries).toBe(dispatches);
    // Explicit public SDK abort marks the retained request and inbox before any
    // scheduler progress. Reopen never re-sends the interrupted provider request.
    await runtime.abortMessages({incarnation:domain,chatJid:chat,branchId:"main",conversationId:fixture.root.id});
    expect(await runtime.waitForMessage(restartInput,restartId)).toMatchObject({status:"unanswered",reason:"aborted"});
    expect(await runtime.waitForMessage(restartQueue,restartQueuedId)).toMatchObject({status:"unanswered",reason:"aborted"});
    fixture.host.modelHold=undefined;restartHold.release();
    expect(await runtime.submitMessage(second)).toBe(followup);
    expect(await runtime.submitMessage(interrupted)).toBe(interruptedId);
    expect(await runtime.submitMessage(withdrawn)).toBe(withdrawnId);
    expect(await runtime.readMessageResult(interrupted)).toMatchObject({status:{status:"unanswered",reason:"aborted"},answer:null});
    expect(await runtime.readMessageResult(second)).toMatchObject({status:{status:"done"},answer:{text:"synthetic answer"}});
    expect(providerEntries).toBe(dispatches);expect(fixture.host.modelCalls).toBe(calls);
    expect(database.query("SELECT * FROM service_effect_s01_operations").all()).toEqual([]);
    let rejectModel!:(error:Error)=>void;
    const failedHold={promise:new Promise<void>((_resolve,reject)=>{rejectModel=reject;}),release(){rejectModel(Error("synthetic model failure"));}};
    const failedEntered=barrier();fixture.host.modelHold=failedHold;fixture.host.onModelEnter=()=>{providerEntries++;failedEntered.release();};
    const failedInput=accept("this model attempt must fail"),retainedInput=accept("wake this existing input after failure");
    const failedId=await runtime.submitMessage(failedInput);await deadline(failedEntered.promise);
    const retainedId=await runtime.submitMessage(retainedInput,"followUp");
    const retainedRecord=database.query("SELECT record FROM submissions WHERE id=?").get(retainedId);
    fixture.host.modelHold=undefined;failedHold.release();
    expect(await deadline(runtime.waitForMessage(failedInput,failedId))).toMatchObject({status:"unanswered",reason:"model_error"});
    expect((await runtime.readMessageInbox(queueBinding)).map(item=>item.submissionId)).toEqual([retainedId]);
    expect(providerEntries).toBe(dispatches+1);
    expect(await runtime.steerQueuedMessage(queueBinding,retainedId)).toBe(true);
    expect(await deadline(runtime.waitForMessage(retainedInput,retainedId))).toMatchObject({status:"done"});
    expect(providerEntries).toBe(dispatches+2);expect(fixture.host.modelCalls).toBe(calls+1);
    expect(database.query("SELECT record FROM submissions WHERE id=?").get(retainedId)).not.toEqual(retainedRecord); // Normal SDK placement/settlement, not a resubmission.
    expect((await runtime.messageSubmissionStatus(retainedInput))?.id).toBe(retainedId);
    expect(await runtime.waitForMessage(failedInput,failedId)).toMatchObject({status:"unanswered",reason:"model_error"});
    expect(database.query("SELECT * FROM service_effect_s01_operations").all()).toEqual([]);
  } finally {held.release();await stop();if(controller)await controller.close();else await runtime.close();await closeDatabase();lock.release();}
},30000);

for (const boundary of ["request", "yield"] as const) applicationTest(`Goal ${boundary} boundary withdraws stale queued continuations without failing or replaying human work`, async () => {
  const { createHostGoalPrompt } = await import("../../runtime/durable-engine/src/host-goal-prompt.js");
  process.env.PICLAW_DB_IN_MEMORY = "0"; initDatabase();
  const database = getDb(); installTerminalSettlementCompositionSchema(database);
  const path = (database.query("PRAGMA database_list").all() as {name:string;file:string}[]).find(row=>row.name==="main")!.file;
  const lock = acquireRuntimeLock({lockPath:join(process.env.PICLAW_WORKSPACE!,"goal-queue.lock"),strictOwnership:true,disabled:false});
  const assert = () => lock.assertCurrentOwner();
  const storage = () => SqliteStorage.open(new BunSqliteDatabase(path,{root:database,assertOwner:assert,fenceTransactions:true}));
  const fixture = await openFixture({acquired:true},()=>{},storage);
  const chat = "web:goal-queue", domain = "goal-queue-test";
  let runtime!: HostConversationRuntime, obsolete = false;
  const denials: unknown[] = [];
  const identity = (text: string) => text === "QUEUED_GOAL" ? {goalId:"finished-goal",generation:1} : null;
  const goal = createHostGoalPrompt({
    // The running input is ordinary work, not an autonomous Goal grant.
    loadThreadGoal: () => null,
    goalInputIdentity: identity,
    resolveGoalInput: text => ({action:identity(text) && obsolete ? "handled" : "continue"}),
    isGoalBudgetInput: () => false,
    buildGoalSystemPrompt: () => "", buildGoalBudgetLimitPrompt: () => "",
    claimGoalBudgetWrapup() {}, accountGoalProgress() {}, accountTerminalGoalProgress() {},
  }, {root:database,runtime:()=>runtime,assertOwner:assert,failClosed:error=>{denials.push(error);}});
  fixture.registry.install(goal);
  await fixture.root.commit(tx=>configure(tx,fixture.root.id,{extensions:[fixture.registry.snapshot().extension("qualification")!,goal]}),context);
  await fixture.close();
  storeChatMetadata(chat,new Date().toISOString(),"Fixture");
  const work = value(createCurrentPiclawServiceWorkStore(database,{hitFault:()=>false,recordTrace(){}}));
  const terminal = value(createCurrentPiclawTerminalSettlementStore(database,new InMemoryEffectPayloadResolver(),{hitFault:()=>false,recordTrace(){}}));
  initializeHostDurableBindings(database,assert);
  const bindings = createHostDurableBindings(database,{domain,incarnation:domain,manifest:[{chatJid:chat,branchId:"main",conversationId:fixture.root.id}],assertOwner:assert,
    async resolveContent(ref){const row=database.query("SELECT content FROM messages WHERE rowid=? AND chat_jid=?").get(Number(ref.slice(12)),chat) as {content:string}|null;if(!row)throw Error("Source unavailable");return row.content;}});
  runtime = await HostConversationRuntime.open({incarnation:domain,sessionId:domain,owner:{assert,release(){}},openStorage:storage,
    harnessOptions:{models:fixture.models,registry:withTaskModelRequestScope(fixture.registry),settings:{retry:{enabled:false},compaction:{enabled:false}}},
    work,terminal,bindings,conversationFor:()=>fixture.root.id,existingConversationIds:[fixture.root.id],authorizeScheduling(){},putAnswer(){throw Error("No host answer owner");},now:()=>new Date().toISOString()},context);
  const accept = (content:string):AcceptedInput => database.transaction(()=>{
    const sourceId=crypto.randomUUID(),timestamp=new Date().toISOString();
    const rowId=storeMessage({id:sourceId,chat_jid:chat,sender:"user",sender_name:"User",content,timestamp,is_from_me:false,is_bot_message:false});
    const source=work.acceptSourceInTransaction(sealed({effect:effect(sourceId),chatJid:chat,sourceId,kind:"message",payloadRef:`message-row:${rowId}`,targetOperationId:null,parentSourceSeq:null,acceptedAt:timestamp,createWakeIntent:false}),database);
    const requestId=`message:${rowId}:${sourceId}`;
    return {incarnation:domain,conversationId:fixture.root.id,chatJid:chat,branchId:"main",operationId:`native-message:${fixture.root.id}:${source.sourceSeq}`,
      sourceSeq:source.sourceSeq,sourceId,payloadRef:`message-row:${rowId}`,requestId,requestHash:hashCanonicalRequest({type:"input",requestId,content})};
  }).immediate();
  const held=barrier(),entered=barrier(); fixture.host.modelHold=held; fixture.host.onModelEnter=()=>entered.release();
  // request: the running tool completes the Goal before its next model call.
  // yield: another authorized action completes it while the final model is held.
  fixture.host.onToolEnter=()=>{obsolete=true;};
  try {
    const first=accept(boundary==="request"?"use-tool running work":"running work"),stale=accept("QUEUED_GOAL"),human=accept("human follow-up");
    const firstId=await runtime.submitMessage(first);await deadline(entered.promise);
    const staleId=await runtime.submitMessage(stale,"followUp"),humanId=await runtime.submitMessage(human,"followUp");
    const acceptedRow=database.query("SELECT content FROM messages WHERE id=?").get(stale.sourceId);
    expect((await runtime.readMessageInbox(first)).map(item=>item.submissionId)).toEqual([staleId,humanId]);
    if(boundary==="yield")obsolete=true;
    fixture.host.modelHold=undefined;held.release();
    expect(await deadline(runtime.waitForMessage(first,firstId))).toMatchObject({status:"done"});
    expect(await deadline(runtime.waitForMessage(stale,staleId))).toMatchObject({status:"unanswered",reason:"aborted"});
    expect(await deadline(runtime.waitForMessage(human,humanId))).toMatchObject({status:"done"});
    expect(denials).toEqual([]);
    expect(fixture.host.modelCalls).toBe(boundary==="request"?3:2);
    expect(fixture.host.effects).toBe(boundary==="request"?1:0);
    expect(fixture.host.transcripts.every(text=>!text.includes("QUEUED_GOAL"))).toBe(true);
    expect(database.query("SELECT content FROM messages WHERE id=?").get(stale.sourceId)).toEqual(acceptedRow);
    expect((await runtime.readMessageResult(stale))?.status).toMatchObject({status:"unanswered",reason:"aborted"});
    expect(await runtime.submitMessage(stale)).toBe(staleId); // Idempotent; never replay the revoked input.
    expect(fixture.host.modelCalls).toBe(boundary==="request"?3:2);
    expect(database.query("SELECT * FROM service_effect_s01_operations").all()).toEqual([]);
  } finally {held.release();await runtime.close();await closeDatabase();lock.release();}
},30000);
