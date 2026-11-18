// Kintsugi 4afeac1e MIT regression cases; SQLite and existing Piclaw Plan fixtures.
import {afterEach,expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {contentText,createModels,fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {LiveDoc,createRegistry,defineDoc,defineExtension,defineTool,Harness,MemoryStorage,ToolResultEntry,CompactionEntry,UserEntry} from '@earendil-works/pi-durable';
import {SqliteStorage} from '@earendil-works/pi-durable/storage/sqlite';
import {Type} from 'typebox';
import {CodemodeSandbox} from '@earendil-works/pi-codemode';
import {createOptimizerCodemodeTool} from '../src/optimizer-codemode.ts';
import {createNativeTokenOptimizer,type CoreOptimizerAgent} from '../src/token-optimizer.ts';
import {TokenOptimizerConfiguration} from '../src/token-optimizer-config.ts';
import {OptimizerOperationEntry} from '../src/token-optimizer-operations.ts';
import {optimizerCallEntry as codemodeCallEntry} from '../src/optimizer-output-source.ts';
import {OptimizerPlanBinding,optimizerPlanTask} from '../src/optimizer-plan-binding.ts';
import {GoalContextEntry} from '../src/token-optimizer-goals.ts';
import {PlanDoc} from '../src/plan-document.ts';
import {updatePlanArgsToMarkdown,parsePlanMarkdown} from '../../src/plan/markdown.js';
import {BunSqliteDatabase} from '../src/bun-sqlite.ts';
import {applicationRetainedDatabase} from '../src/mcp/retained-database.ts';
import {JobsDoc,KnowledgeDoc,ObservationsDoc,RunDoc} from '#token-optimizer/pi-durable';
import {scopeKey,sessionKey} from '#token-optimizer/core';
type FixtureAgent={ [Key in keyof CoreOptimizerAgent]:CoreOptimizerAgent[Key] };
const WorkspaceAgents=defineDoc<{agents:FixtureAgent[]}> ({kind:'fixture.optimizer-agents',version:1,scope:'session',initial:()=>({agents:[]}),checkpointWhen:()=>false});
const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
type FixturePlanInput=Parameters<typeof updatePlanArgsToMarkdown>[0];
let plans:{change(workspace:string,agent:string,input:FixturePlanInput):Promise<{revision:number}>};
const agentPlanStore=()=>plans;
const raw=Array.from({length:100},(_,i)=>`(pass) fixture > case ${i} [0.1ms]`).join('\n')+'\n100 pass\n0 fail\nRan 100 tests across 8 files.';
async function setup(mode:'off'|'observe'|'active'='active',persistent=false,retry=false,failing=false){
 const dir=mkdtempSync(join(tmpdir(),'optimizer-oversight-')),file=join(dir,'state.sqlite'),db=new Database(file,{create:true});
 db.exec('PRAGMA journal_mode=WAL;PRAGMA secure_delete=ON;PRAGMA busy_timeout=0;CREATE TABLE router_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);');
 cleanup.push(async()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 const configuration=new TokenOptimizerConfiguration(db,()=>{});const config=await configuration.load();Object.assign(config.policy,{enabled:mode!=='off',mode,reduceOutputs:true,goalChecks:true});await configuration.configure(config);if(mode==='active'){const next=configuration.snapshot();next.policy.mode='active';await configuration.configure(next);}
 const models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);
 const registry=createRegistry(),sandbox=new CodemodeSandbox();let harness:Harness,calls=0;
 cleanup.push(()=>sandbox.close());
 registry.install(defineExtension({name:'fixture.codemode',tools:[createOptimizerCodemodeTool(sandbox)]}));
 registry.install(defineExtension({name:'fixture.tools',tools:[defineTool({name:'bash',description:'Synthetic check',parameters:Type.Object({command:Type.String()}),structuredOutputSchema:Type.Object({output:Type.String(),exitCode:Type.Integer(),truncated:Type.Boolean(),timedOut:Type.Boolean(),aborted:Type.Boolean()}),replay:'safe',async execute(){calls++;const log=failing?'AssertionError: unexpected parser output':raw,exitCode=failing?1:0;return{output:[{type:'text' as const,text:log}],structuredOutput:{output:log,exitCode,truncated:false,timedOut:false,aborted:false},details:{fullOutputPath:'/owned/full-fixture.log',exitCode,displayAnsi:log}};}}),defineTool({name:'edit',description:'Synthetic edit',parameters:Type.Object({path:Type.String()}),replay:'safe',async execute(){calls++;return{output:[{type:'text' as const,text:'Edited'}]};}})]}));
 const native=createNativeTokenOptimizer({workspaceId:'fixture',workspaceRoot:dir,environmentRevision:'owned-fixture',models,registry,harness:()=>harness,configuration,database:applicationRetainedDatabase(db,()=>{}),readSavedOutput:async()=>({status:'unavailable'}),agents:async()=>(await harness.snapshot(WorkspaceAgents,context))?.agents??[],async plan(host){
  const child=host.parent?(await harness.snapshot(WorkspaceAgents,context))?.agents.find(record=>record.durableId===host.conversationId):undefined;
  if(host.parent&&!child)return null;
  const agentId=child?.agentId??JSON.parse(host.id)[0],plan=await harness.snapshot(PlanDoc,agentId,context);
  return plan?{revision:plan.revision??0,steps:parsePlanMarkdown(plan.markdown).plan}:null;
 }});registry.install(native.optimizer.extension);
 const open=async()=>Harness.open(persistent?await SqliteStorage.open(new BunSqliteDatabase(file)):new MemoryStorage(),{models,registry,settings:{retry:{enabled:retry,baseDelayMs:1,maxRetries:1}}},context);
 harness=await open();cleanup.push(async()=>{try{await native.close();}finally{await harness.close(context);}});
 const conversation=await harness.root(context);await conversation.configure({model:{provider:'faux',modelId:'faux-1'},instructions:'Fixture instructions'},context);
 await harness.commit(async tx=>{(await tx.doc(WorkspaceAgents)).agents.push({agentId:'agent',durableId:conversation.id});},context);
 plans={async change(_workspace,agent,input){return harness.commit(async tx=>{const plan=await tx.doc(PlanDoc,agent,{chat_jid:agent,markdown:'',updated_at:null});plan.markdown=updatePlanArgsToMarkdown(input);plan.updated_at=new Date().toISOString();plan.revision=(plan.revision??0)+1;return{revision:plan.revision};},context);}};
 await native.attach();const host=native.host(conversation.id);
 const entries=async()=>(await conversation.entries({order:'ascending'},1000,undefined,context)).items;
 return{configuration,native,models,faux,host,conversation,entries,get harness(){return harness;},calls:()=>calls,async reopen(){await native.detach();await harness.close(context);harness=await open();return(await harness.conversation(conversation.id,context))!;}};
}
for(const mode of ["off","observe","active"] as const)test(`direct bash reducer: ${mode}, raw learning evidence and no extra calls`,async()=>{
  const f=await setup(mode);f.faux.setResponses([fauxAssistantMessage([fauxToolCall("bash",{command:"bun test"})],{stopReason:"toolUse"}),async request=>{const output=request.messages.filter(message=>message.role==="toolResult").map(message=>contentText(message.content)).join("\n");expect(output.includes("Output reduced")).toBe(mode==="active");return fauxAssistantMessage("Done");}]);
  await(await f.conversation.submit({type:"input",content:"Run tests"},context)).wait(context);await f.native.optimizer.drained();
  expect(f.calls()).toBe(1);expect(f.faux.state.callCount).toBe(2);
  const result=(await f.entries()).find(ToolResultEntry.is)!;const message=result.model![0]!;if(message.role!=="toolResult")throw Error("Expected tool result");
  if(mode!=="off") {
    expect(message.details).toMatchObject({optimizerRawOutput:raw,optimizerReduction:{applied:mode==="active"}});
    const observations=await f.harness.snapshot(ObservationsDoc,sessionKey(f.host.scope,f.host.id),context);expect(observations!.observations[0]!.output).toContain("fixture > case 99");
    const trajectory=await f.native.domain.trajectory(f.host,null);if(trajectory.kind!=="ready")throw Error("Expected trajectory");expect(trajectory.observations[0]!.output).toContain("fixture > case 99");
  }
});
test("code mode executes against unchanged raw values; only its exact emitted result is reduced",async()=>{
  const f=await setup();f.faux.setResponses([fauxAssistantMessage([fauxToolCall("codemode",{code:'const result=await tools.bash({command:"bun test"});if(!result.output.includes("fixture > case 99"))throw Error("script received a summary");return result;'})],{stopReason:"toolUse"}),async request=>{const text=request.messages.filter(message=>message.role==="toolResult").map(message=>contentText(message.content)).join("\n");expect(text).toContain("Output reduced");return fauxAssistantMessage("Done");}]);
  await(await f.conversation.submit({type:"input",content:"Run tests"},context)).wait(context);expect(f.calls()).toBe(1);expect(f.faux.state.callCount).toBe(2);
  const source=(await f.entries()).filter(codemodeCallEntry.is).find(entry=>entry.data.phase==="end");expect(source?.data.phase === "end" ? source.data.output : undefined).toContain("fixture > case 99");
});
test("committed reductions survive SQLite reopen without rerunning commands",async()=>{
  const f=await setup("active",true);f.faux.setResponses([fauxAssistantMessage([fauxToolCall("bash",{command:"bun test"})],{stopReason:"toolUse"}),fauxAssistantMessage("Done")]);
  await(await f.conversation.submit({type:"input",content:"Run tests"},context)).wait(context);
  const before=JSON.stringify((await f.entries()).filter(ToolResultEntry.is));const conversation=await f.reopen();
  expect(JSON.stringify((await conversation.entries({order:"ascending"},1000,undefined,context)).items.filter(ToolResultEntry.is))).toBe(before);expect(f.calls()).toBe(1);
});
for(const mode of ["off","observe","active"] as const)test(`goal verification debt: ${mode}, one reminder within the original run`,async()=>{
  const f=await setup(mode);let requests=0;
  f.faux.setResponses([fauxAssistantMessage([fauxToolCall("codemode",{code:'for(let i=0;i<4;i++)await tools.edit({path:"src/parser.ts"});'})],{stopReason:"toolUse"}),async request=>{requests++;const text=request.messages.filter(message=>message.role==="user").map(message=>contentText(message.content)).join("\n");expect(text.includes("Task check (automated")).toBe(mode==="active");if(mode==="active")expect(text).toContain("Fix the parser without changing the API");return fauxAssistantMessage("Done");}]);
  await(await f.conversation.submit({type:"input",content:"Fix the parser without changing the API"},context)).wait(context);
  expect(requests).toBe(1);expect(f.faux.state.callCount).toBe(2);
  const entries=await f.entries();expect(entries.filter(GoalContextEntry.is)).toHaveLength(mode==="active"?1:0);
  const checks=entries.filter(OptimizerOperationEntry.is).filter(entry=>entry.data.name==="optimizer.goal-check");expect(checks).toHaveLength(mode==="off"?0:1);
  if(mode!=="off")expect(checks[0]!.data.output).toMatchObject({delivery:mode==="active"?"consumed":"simulated"});
});
test("active plan supplies the unfinished step; later prompts get their own objective and allowance",async()=>{
  const f=await setup();await agentPlanStore().change("fixture","agent",{action:"update",plan:[{step:"Verify parser edge cases",status:"in_progress"}]});
  for(const task of ["Fix the parser","Check the serializer"]) {
    f.faux.setResponses([fauxAssistantMessage([fauxToolCall("codemode",{code:'await tools.edit({path:"src/parser.ts"});await tools.edit({path:"src/parser.ts"});await tools.bash({command:"bun test"});'})],{stopReason:"toolUse"}),async request=>{const notes=request.messages.filter(message=>message.role==="user"&&contentText(message.content).startsWith("Task check (automated"));expect(contentText(notes.at(-1)!.content)).toContain(task);expect(contentText(notes.at(-1)!.content)).toContain("Verify parser edge cases");return fauxAssistantMessage("Done");}]);
    await(await f.conversation.submit({type:"input",content:task},context)).wait(context);
  }
  expect((await f.entries()).filter(GoalContextEntry.is)).toHaveLength(2);expect(f.faux.state.callCount).toBe(4);
});

test("goal reminder survives provider retry with one committed check and a pinned plan",async()=>{
  const f=await setup("active",false,true);await agentPlanStore().change("fixture","agent",{action:"update",plan:[{step:"Original step",status:"in_progress"}]});
  const seen:string[]=[];
  f.faux.setResponses([fauxAssistantMessage([fauxToolCall("codemode",{code:'for(let i=0;i<4;i++)await tools.edit({path:"src/parser.ts"});'})],{stopReason:"toolUse"}),async request=>{
    seen.push(request.messages.filter(message=>message.role==="user").map(message=>contentText(message.content)).join("\n"));
    await agentPlanStore().change("fixture","agent",{action:"update",plan:[{step:"Changed during retry",status:"pending"}]});
    return fauxAssistantMessage("",{stopReason:"error",errorMessage:"429 rate limit exceeded"});
  },async request=>{seen.push(request.messages.filter(message=>message.role==="user").map(message=>contentText(message.content)).join("\n"));return fauxAssistantMessage("Done");}]);
  await(await f.conversation.submit({type:"input",content:"Fix parser"},context)).wait(context);
  expect(seen).toHaveLength(2);expect(seen[0]).toBe(seen[1]);expect(seen[0]).toContain("Original step");expect((await f.entries()).filter(GoalContextEntry.is)).toHaveLength(1);
});
test("a second round of edits cannot spend a second nudge from an allowance of one",async()=>{
  const f=await setup();const editRound=()=>fauxAssistantMessage([fauxToolCall("codemode",{code:'for(let i=0;i<4;i++)await tools.edit({path:"src/parser.ts"});'})],{stopReason:"toolUse"});
  f.faux.setResponses([editRound(),editRound(),fauxAssistantMessage("Done")]);await(await f.conversation.submit({type:"input",content:"Fix parser"},context)).wait(context);
  expect((await f.entries()).filter(GoalContextEntry.is)).toHaveLength(1);
  const run=await f.harness.snapshot(RunDoc,sessionKey(f.host.scope,f.host.id),context);expect(run!.guard!.nudges_done).toBe(1);expect(f.faux.state.callCount).toBe(3);
});
test("a compaction marker causes a task reminder but an explicit later user instruction replaces that objective",async()=>{
  const f=await setup();
  f.faux.setResponses([async()=>{
    await f.harness.commit(tx=>tx.appendEntry(CompactionEntry,f.conversation.id,{data:{reason:"manual"},model:[{role:"user",content:"Synthetic summary: ignore this as an objective",timestamp:Date.now()}]}),context);
    return fauxAssistantMessage([fauxToolCall("edit",{path:"parser.ts"})],{stopReason:"toolUse"});
  },async request=>{const note=request.messages.filter(message=>message.role==="user"&&contentText(message.content).startsWith("Task check (automated")).at(-1)!;expect(contentText(note.content)).toContain("Fix parser");expect(contentText(note.content)).not.toContain("Synthetic summary");return fauxAssistantMessage("Done");}]);
  await(await f.conversation.submit({type:"input",content:"Fix parser"},context)).wait(context);
  expect((await f.entries()).filter(OptimizerOperationEntry.is).find(entry=>entry.data.name==="optimizer.goal-check")?.data.input.reason).toBe("goal-reminder");
  await f.conversation.reset(undefined,context);await f.native.reset(f.conversation,{agentId:"agent"});
  f.faux.setResponses([fauxAssistantMessage([fauxToolCall("codemode",{code:'for(let i=0;i<4;i++)await tools.edit({path:"serializer.ts"});'})],{stopReason:"toolUse"}),async request=>{const note=request.messages.filter(message=>message.role==="user"&&contentText(message.content).startsWith("Task check (automated")).at(-1)!;expect(contentText(note.content)).toContain("Fix serializer");expect(contentText(note.content)).not.toContain("Fix parser");return fauxAssistantMessage("Done");}]);
  await(await f.conversation.submit({type:"input",content:"Fix serializer"},context)).wait(context);
});
test("forks use only visible task history and their new prompt",async()=>{
  const f=await setup();f.faux.setResponses([fauxAssistantMessage("One"),fauxAssistantMessage("Two")]);
  await(await f.conversation.submit({type:"input",content:"Original task"},context)).wait(context);const boundary=(await f.entries()).at(-1)!;
  await(await f.conversation.submit({type:"input",content:"Abandoned branch task"},context)).wait(context);
  const fork=await f.conversation.fork(boundary.id,{ownership:{kind:"ownerless"}},context);await f.native.start(fork,{agentId:"agent"},"fork",f.host.classificationGroup);
  f.faux.setResponses([fauxAssistantMessage([fauxToolCall("codemode",{code:'for(let i=0;i<4;i++)await tools.edit({path:"branch.ts"});'})],{stopReason:"toolUse"}),async request=>{const note=request.messages.filter(message=>message.role==="user"&&contentText(message.content).startsWith("Task check (automated")).at(-1)!;expect(contentText(note.content)).toContain("Fork objective");expect(contentText(note.content)).not.toContain("Abandoned branch task");return fauxAssistantMessage("Done");}]);
  await(await fork.submit({type:"input",content:"Fork objective"},context)).wait(context);
});
test("children use their own user task and plan, not their parent's",async()=>{
  const f=await setup();await agentPlanStore().change("fixture","agent",{action:"update",plan:[{step:"Private root objective",status:"in_progress"}]});await agentPlanStore().change("fixture","child",{action:"update",plan:[{step:"Child checks",status:"in_progress"}]});
  const record=await f.harness.commit(async tx=>{const row=await tx.createConversation({ownership:{kind:"ownerless"}});(await tx.doc(WorkspaceAgents)).agents.push({agentId:"child",durableId:row.id,parentId:"agent",rootId:"agent",label:"child",title:"Child"});return row;},context);
  const child=(await f.harness.conversation(record.id,context))!;await child.configure({model:{provider:"faux",modelId:"faux-1"}},context);
  f.faux.setResponses([fauxAssistantMessage([fauxToolCall("codemode",{code:'for(let i=0;i<4;i++)await tools.edit({path:"child.ts"});'})],{stopReason:"toolUse"}),async request=>{const note=request.messages.filter(message=>message.role==="user"&&contentText(message.content).startsWith("Task check (automated")).at(-1)!;expect(contentText(note.content)).toContain("Child task");expect(contentText(note.content)).toContain("Child checks");expect(contentText(note.content)).not.toContain("Private root");return fauxAssistantMessage("Done");}]);
  await(await child.submit({type:"input",content:"Child task"},context)).wait(context);expect((await f.entries()).filter(GoalContextEntry.is)).toHaveLength(0);
});

test("explicit steering changes the quoted goal without treating automated context as a user task",async()=>{
  const f=await setup();
  f.faux.setResponses([async()=>{await f.conversation.submit({type:"input",content:"Instead fix the serializer, no deployment",whenBusy:"steer",whenIdle:"reject"},context);return fauxAssistantMessage([fauxToolCall("codemode",{code:'for(let i=0;i<4;i++)await tools.edit({path:"serializer.ts"});'})],{stopReason:"toolUse"});},async request=>{const note=request.messages.filter(message=>message.role==="user"&&contentText(message.content).startsWith("Task check (automated")).at(-1)!;expect(contentText(note.content)).toContain("Instead fix the serializer, no deployment");return fauxAssistantMessage("Done");}]);
  await(await f.conversation.submit({type:"input",content:"Fix parser"},context)).wait(context);
  expect((await f.entries()).filter(GoalContextEntry.is)).toHaveLength(1);
});

for (const scenario of ["active","changed plan","observe","old plan","no consent","standalone","revoked on retry","changed while queued","changed during SDK auth","steered input"] as const) test(`existing loop judge supplies goal oversight: ${scenario}`, async () => {
  const mode=scenario==="observe"?"observe":"active",f=await setup(mode,false,scenario==="revoked on retry",true);
  const config=f.configuration.snapshot();Object.assign(config.policy,{loop:"judge",sharePlanWithJudge:scenario!=="no consent",inferenceInObserve:true,generativeModel:{provider:"faux",id:"faux-1"},thresholds:{min_turns:1,gate_min_turns:1,gate_error_outputs:1}});await f.configuration.configure(config);
  if(scenario==="changed while queued"){const options=f.configuration.snapshot();Object.assign(options.policy,{offloadOutputs:true,outputSummaries:true});await f.configuration.configure(options);}
  const planStore=agentPlanStore();const planned=await planStore.change("fixture","agent",{action:"update",plan:[{step:"Verify parser edge cases",status:"in_progress"},{step:"Unrelated private plan item",status:"pending"}]});
  await f.harness.commit(async tx=>{(await tx.doc(KnowledgeDoc,scopeKey(f.host.scope),f.host.scope)).envelope.resolved_turns=[40,40,40,40,40];},context);
  let main=0,judges=0,plansSent=0;
  const ready = Promise.withResolvers<void>();
  const queued = scenario==="changed while queued", duringAuth = scenario==="changed during SDK auth";
  if(duringAuth){
    const complete=f.models.completeSimple.bind(f.models);
    f.models.completeSimple=(model,request,options)=>complete(model,request,{...options,async transformHeaders(headers){
      if(request.messages.some(message=>message.role==="user"&&contentText(message.content).includes("Active plan item (quoted task data"))) await planStore.change("fixture","agent",{action:"update",plan:[{step:"New item after auth",status:"in_progress"}]});
      return await options?.transformHeaders?.(headers)??headers;
    }});
  }
  cleanup.push(async()=>ready.resolve());
  f.faux.setResponses(Array.from({length:8},()=>async request=>{
    const prompt=contentText(request.messages[0]?.content??"");
    if(prompt.includes("Summarise this tool output")){await ready.promise;return fauxAssistantMessage("Fixture summary");}
    if (prompt.includes("Return the JSON verdict:")) {
      judges++;const hasPlan=prompt.includes("Verify parser edge cases");if(hasPlan)plansSent++;
      const shared=scenario!=="old plan"&&scenario!=="no consent"&&!queued&&!duringAuth;expect(hasPlan).toBe(shared);expect(prompt).not.toContain("Unrelated private plan item");expect(prompt).not.toContain("Private user request text");
      await ready.promise;
      const verdict={stuck:false,confidence:1,reason:"No stagnant loop"};
      return fauxAssistantMessage(JSON.stringify(shared?{...verdict,goal:{drift:true,confidence:1}}:verdict));
    }
    if (prompt.includes("Write the redirect:")) throw Error("Goal drift must not start a writer call");
    main++;
    if(main===1 && scenario!=="old plan") await f.harness.commit(async tx=>{const run=(await tx.doc(LiveDoc,f.conversation.id)).run;Object.assign(await tx.doc(OptimizerPlanBinding,f.conversation.id),{revision:planned.revision,task:optimizerPlanTask(run)});},context);
    if(main===1 && queued) void f.native.optimizer.summarizeOutput(f.conversation.id,{id:"queue-fixture",tool:"bash",label:"test fixture",text:"synthetic",lines:1,bytes:9},10000);
    if (main===2) {
      if(queued){
        let found=false;
        for(let i=0;i<200&&!found;i++){const jobs=Object.values((await f.harness.snapshot(JobsDoc,context))?.jobs??{});found=jobs.some(job=>job.request.includesPlan&&job.status==="queued");if(!found)await Bun.sleep(5);}
        await planStore.change("fixture","agent",{action:"update",plan:[{step:"New task item",status:"in_progress"}]});
        ready.resolve();expect(found).toBe(true);
      }
      ready.resolve();
      for (let attempt=0;attempt<100;attempt++) {
        const jobs=await f.harness.commit(tx=>tx.scanTasks({kind:'token-economizer.guard-judge',status:'terminal'},1),context);
        if (jobs.items.length) break;
        await Bun.sleep(5);
      }
      if (scenario==="changed plan") await planStore.change("fixture","agent",{action:"update",plan:[{step:"Check serializer instead",status:"in_progress"}]});
      if (scenario==='steered input') await f.conversation.submit({type:'input',content:'New user instruction; reassess the current plan',whenBusy:'steer',whenIdle:'reject'},context);
    }
    if (main<3 && scenario==="standalone") return fauxAssistantMessage([fauxToolCall("bash",{command:`bun test case-${main}.test.ts`})],{stopReason:"toolUse"});
    if (main<3) return fauxAssistantMessage([fauxToolCall("codemode",{code:`for (let i=0;i<4;i++) await tools.bash({command: "bun test case-${main}-"+i+".test.ts"});`})],{stopReason:"toolUse"});
    const texts=request.messages.filter(message=>message.role==="user").map(message=>contentText(message.content));
    expect(texts.some(text=>text.includes("Recent actions may not be advancing"))).toBe(scenario==="active"||scenario==="standalone"||scenario==="revoked on retry"&&main===3);
    if(scenario==="revoked on retry"&&main===3){const config=f.configuration.snapshot();config.policy.sharePlanWithJudge=false;await f.configuration.configure(config);return fauxAssistantMessage("",{stopReason:"error",errorMessage:"429 rate limit exceeded"});}
    return fauxAssistantMessage("Done");
  }));
  expect((await(await f.conversation.submit({type:"input",content:"Private user request text"},context)).wait(context)).status).toBe("done");
  await f.native.optimizer.drained();
  const notes=(await f.entries()).filter(OptimizerOperationEntry.is).filter(entry=>entry.data.name==="optimizer.goal-check" && entry.data.input.reason==="goal-drift");
  const delivery=(scenario==="active"||scenario==="standalone"||scenario==="revoked on retry")?"consumed":scenario==="observe"?"simulated":undefined;
  if(delivery)expect(notes.at(-1)?.data.output).toMatchObject({delivery});
  else expect(notes).toHaveLength(0);
  const jobs=await f.harness.snapshot(JobsDoc,context);
  if(queued || duringAuth) {
    const obsolete=Object.values(jobs!.jobs).find(job=>job.request.includesPlan);
    expect(obsolete?.status).toBe("cancelled");expect(obsolete?.result).toBeNull();
    expect(jobs?.budget.ledger.find(row=>row.id===obsolete?.id)?.cost).toBe(0);
    expect(plansSent).toBe(0);
  } else {
    expect(jobs?.budget.ledger.map(row=>row.purpose)).toEqual(["loop-judge"]);expect(judges).toBe(1);
  }
  expect(main).toBe(scenario==="revoked on retry"?4:3);
},15_000);

test("a provider retry cannot replay a goal nudge after switching to Watch only",async()=>{
  const f=await setup("active",false,true);const seen:boolean[]=[];
  const hasAdvice=(messages:Parameters<typeof contentText>[0][])=>messages.some(content=>contentText(content).includes("Task check (automated"));
  f.faux.setResponses([fauxAssistantMessage([fauxToolCall("codemode",{code:'for(let i=0;i<4;i++)await tools.edit({path:"src/parser.ts"});'})],{stopReason:"toolUse"}),async request=>{
    seen.push(hasAdvice(request.messages.filter(message=>message.role==="user").map(message=>message.content)));
    const config=f.configuration.snapshot();config.policy.oversightMode="observe";await f.configuration.configure(config);
    return fauxAssistantMessage("",{stopReason:"error",errorMessage:"429 rate limit exceeded"});
  },async request=>{seen.push(hasAdvice(request.messages.filter(message=>message.role==="user").map(message=>message.content)));return fauxAssistantMessage("Done");}]);
  expect((await(await f.conversation.submit({type:"input",content:"Fix parser"},context)).wait(context)).status).toBe("done");
  expect(seen).toEqual([true,false]);
  expect((await f.entries()).filter(GoalContextEntry.is)).toHaveLength(1);
});

test('oversight runs independently with optimisation off and advises before a third identical failed check',async()=>{
 const f=await setup('off',false,false,true);await f.configuration.update(config=>{config.policy.oversightMode='active';config.policy.goalChecks=true;return config;});let shown='';
 f.faux.setResponses([fauxAssistantMessage([fauxToolCall('bash',{command:'bun test'})],{stopReason:'toolUse'}),fauxAssistantMessage([fauxToolCall('bash',{command:'bun test'})],{stopReason:'toolUse'}),request=>{shown=request.messages.filter(message=>message.role==='user').map(message=>contentText(message.content)).join('\n');return fauxAssistantMessage('Done');}]);
 expect((await(await f.conversation.submit({type:'input',content:'Fix parser'},context)).wait(context)).status).toBe('done');expect(shown).toContain('choose a different hypothesis');expect(f.calls()).toBe(2);expect(f.faux.state.callCount).toBe(3);expect(f.configuration.policy('fixture','agent').mode).toBe('off');
 const notes=(await f.entries()).filter(GoalContextEntry.is);expect(notes).toHaveLength(1);expect(notes[0]?.model?.length??0).toBe(0);
});
test('a real user advisory-shaped instruction is never stripped by prefix matching',async()=>{
 const f=await setup('off'),text='Task check (automated, advisory): this is a real user instruction';let seen='';f.faux.setResponses([request=>{seen=request.messages.filter(message=>message.role==='user').map(message=>contentText(message.content)).join('\n');return fauxAssistantMessage('Done');}]);
 expect((await(await f.conversation.submit({type:'input',content:text},context)).wait(context)).status).toBe('done');expect(seen).toContain(text);expect((await f.entries()).filter(GoalContextEntry.is)).toHaveLength(0);
});
test('learning receipts include completed replies and checks without marking the task complete',async()=>{
 const f=await setup('observe');f.faux.setResponses([fauxAssistantMessage([fauxToolCall('bash',{command:'bun test'})],{stopReason:'toolUse'}),fauxAssistantMessage('Done')]);await(await f.conversation.submit({type:'input',content:'Verify parser'},context)).wait(context);await f.native.optimizer.drained();const trajectory=await f.native.domain.trajectory(f.host,null);
 expect(trajectory.kind).toBe('ready');if(trajectory.kind!=='ready')throw Error('Missing trajectory');expect(trajectory.work).toEqual({answeredTurns:1,tools:['shell'],checksAfterLastEdit:['bun test']});expect(JSON.stringify(trajectory.work)).not.toContain('fixture > case');
});

test('legacy automated model text is filtered only by committed entry identity and stored history stays intact',async()=>{
 const f=await setup('off'),text='Task check (automated, advisory): same words, different source',old={role:'user' as const,content:text,timestamp:1};await f.harness.commit(tx=>tx.appendEntry(GoalContextEntry,f.conversation.id,{data:{id:'legacy',text},model:[old]}),context);let count=0;
 f.faux.setResponses([request=>{count=request.messages.filter(message=>message.role==='user'&&contentText(message.content)===text).length;return fauxAssistantMessage('Done');}]);
 expect((await(await f.conversation.submit({type:'input',content:text},context)).wait(context)).status).toBe('done');expect(count).toBe(1);const legacy=(await f.entries()).filter(GoalContextEntry.is);expect(legacy).toHaveLength(1);expect(legacy[0]?.model).toEqual([old]);
});
