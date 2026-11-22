import { afterEach, expect, test } from "bun:test";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import { createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { defaultPolicy } from "../src/core/config.ts";
import { prepareSession, type LearningSession } from "../src/core/sessions.ts";
import { scopeKey, type InferenceRequest, type Observation } from "../src/core/types.ts";
import { createLifecycle, type LearningCredits } from "../src/core/microskills/lifecycle.ts";
import { admitFact, emptyDistiller, updateDistiller } from "../src/core/microskills/distiller.ts";
import { genericDigest } from "../src/core/microskills/digest.ts";
import { JobsDoc, KnowledgeDoc } from "../src/pi-durable/documents.ts";
import type { HostDomain, HostSession } from "../src/pi-durable/domain.ts";
import { createMechanismFolder } from "../src/pi-durable/fold.ts";
import { createInferenceQueue } from "../src/pi-durable/sidecall.ts";
const closes: (() => Promise<void>)[] = [];
afterEach(async () => {for (const close of closes.splice(0).reverse()) await close();});
const observation = (id:string,command = "pytest",output = "pytest: command not found"):Observation => ({id,sessionId:"one",runId:id,tool:"bash",semantic:"shell",command,output,targets:[],outcome:"failure",exitCode:127,coverage:"complete",nested:false,parentId:null,readOnly:false,verification:null,at:0});
async function setup(propose = false) {
  let now = 1_000_000, calls = 0;
  const requests:InferenceRequest[] = [], policy = defaultPolicy();
  Object.assign(policy,{enabled:true,mode:"active",microSkills:"both",generativeModel:{provider:"fixture",id:"small"}});
  const registry = createRegistry();let harness:Harness;
  const queue = createInferenceQueue({harness:() => harness,policy:() => policy,sideCall:async request => {
    calls++;requests.push(request);
    // SAFETY: The regex captures a complete JSON string literal from the fixture's generated digest.
    const cite=[...request.prompt.matchAll(/"iid": ("(?:[^"\\]|\\.)*")/g)].map(match=>JSON.parse(match[1]) as string);
    const facts=propose?[{id:"test-form",claim:"Repository tests run with bun test.",detector:{scope:"ran_checks",confirm:"passed"},cite: cite.slice(0,2)}]:[];
    return {text:JSON.stringify({facts,extractors:[]}),model:request.model,usage:null,cost:0,durationMs:1,authUnavailable:false,error:null};
  }});registry.install(queue.extension);
  harness = await Harness.open(new MemoryStorage(),{registry,models:createModels()},context);closes.push(() => harness.close(context));
  const root = await harness.root(context), host:HostSession = {id:"one",conversationId:root.id,scope:{host:"fixture",repository:"repo",environment:"v1"},repositoryRoot:"/repo",environmentRevision:"v1",classificationGroup:"root",delegated:false};
  const domain:HostDomain = {integrationId:"fixture",session:async () => host,tool:() => ({semantic:"shell",readOnly:false}),arguments:() => ({command:"",targets:[],coverage:"complete"}),decode:() => ({output:"",exitCode:0,aborted:false,timedOut:false,coverage:"complete"}),setTools:async () => {},catalogue:async () => ({revision:"1",source:"fixture",complete:true,tools:[]}),trajectory:async () => ({kind:"ready",cutoff:"end",observations:[],prompts:1,transcriptActivity:0})};
  const folder = createMechanismFolder({harness:() => harness,domain,queue,now:() => now});
  let session:LearningSession = prepareSession(null,{id:host.id,scope:host.scope,conversation:String(root.id),group:host.classificationGroup,now,event:"new",visibleHistory:false,carriedSections:{},carriedIds:[],cachedSection:"frozen",cachedIds:[],publishedMask:[],mode:"active"});
  session.learning = {cutoff:null,credits:{confirms:[],contradicts:[],exercises:[]},ticks:0,lastProposalAt:null,requested:0,processed:0,lastRun:null};
  let knowledge = await harness.commit(async tx => {await tx.doc(KnowledgeDoc,scopeKey(host.scope),host.scope);return null;},context).then(() => harness.snapshot(KnowledgeDoc,scopeKey(host.scope),context));
  async function checkpoint(observations:Observation[],incremental = true,partial = false) {
    session.learning!.requested++;
    session.learning!.lastRun = observations[0]?.runId ?? session.learning!.lastRun;
    const result = await folder({knowledge:knowledge!,policy,session,host,trajectory:{kind:"ready",cutoff:String(session.learning!.requested),observations,prompts:1,transcriptActivity:now,partial},signal:new AbortController().signal,incremental});
    knowledge = {...knowledge!,...result};session = {...session,learning:result.learning};
  }
  return {harness,policy,requests,checkpoint,advance:(ms:number) => {now+=ms;},get calls() {return calls;},get session() {return session;},get knowledge() {return knowledge!;}};
}
test("live model learning waits for three evidence checkpoints, has a ten-minute cooldown and skips unchanged digests",async () => {
  const f = await setup();
  await f.checkpoint([observation("1")]);await f.checkpoint([observation("2")]);expect(f.calls).toBe(0);
  await f.checkpoint([observation("3")]);expect(f.calls).toBe(1);
  for (let i = 0;i < 8;i++) await f.checkpoint([observation(`fast-${i}`,"bun test","1 passed")]);
  expect(f.calls).toBe(1);
  f.advance(600_000);await f.checkpoint([observation("new","bun test","1 passed")]);expect(f.calls).toBe(2);
  f.advance(600_000);
  for (let i = 0;i < 6;i++) await f.checkpoint([observation(`same-${i}`,"bun test","1 passed")]);
  expect(f.calls).toBe(2);expect(f.knowledge.distiller.window).toHaveLength(8);
  expect(f.session.section).toBe("frozen");expect(f.knowledge.tools.sessions).toBe(0);
});
test("empty checkpoints, Basic, Watch only and Off never spend on learning",async () => {
  const f = await setup();
  for (let i = 0;i < 10;i++) await f.checkpoint([]);
  expect(f.session.learning!.ticks).toBe(0);expect(f.calls).toBe(0);
  for (const [mode,microSkills] of [["active","envfacts"],["observe","both"],["off","both"]] as const) {
    f.policy.mode = mode;f.policy.microSkills = microSkills;
    for (let i = 0;i < 4;i++) {f.advance(600_000);await f.checkpoint([observation(`${mode}-${i}`)]);}
  }
  expect(f.calls).toBe(0);
});
test("live learning respects the existing per-session call cap, including session end",async () => {
  const f = await setup();f.policy.budget.callsPerSession = 1;
  for (let i = 0;i < 3;i++) await f.checkpoint([observation(String(i))]);
  expect(f.calls).toBe(1);f.advance(600_000);
  for (let i = 0;i < 4;i++) await f.checkpoint([observation(`later-${i}`,"bun test","1 passed")]);
  await f.checkpoint([],false);expect(f.calls).toBe(1);
  expect((await f.harness.snapshot(JobsDoc,context))!.budget.ledger).toHaveLength(1);
});
test("replayed evidence within one group cannot promote a fact or supply duplicate grounding citations",() => {
  let state = emptyDistiller();
  state.facts.push({spec:{id:"tests",claim:"The tests use pytest.",detector:{scope:"missing_command",confirm:"command not found"}},life:createLifecycle("tests",false,false)});
  const credits:LearningCredits = {confirms:[],contradicts:[],exercises:[]};
  for (let i = 0;i < 8;i++) state = updateDistiller(state,genericDigest([observation(String(i))],"same-session",[],""),[],3,false,"repo",[],credits).state;
  expect(state.facts[0]!.life.confirms).toHaveLength(1);expect(state.facts[0]!.life.fire_den).toBe(1);
  expect(state.facts[0]!.life.state).toBe("CANDIDATE");expect(state.window).toHaveLength(1);
  expect(admitFact(state,{id:"duplicate",claim:"The repository test runner is pytest.",detector:{scope:"missing_command",confirm:"command not found"},cite:["same-session","same-session"]})).toEqual({accepted:false,reason:"grounding-fail(1/2)"});
});
test("a truncated trajectory learns recent facts and tool usage without voting for disuse",async()=>{
  const f=await setup();f.policy.microSkills="envfacts";f.policy.pruning="propose";
  await f.checkpoint([observation("recent")],true,true);
  expect(f.knowledge.environment.facts.map(fact=>fact.id)).toContain("absent_tool:pytest");
  expect(f.knowledge.tools).toMatchObject({used:["bash"],sessions:0,prompts:0});
  expect(f.session.learning?.cutoff).toBe("1");
  expect(f.session.learning?.toolCounted).toBeUndefined();
  expect(f.session.learning?.toolIncomplete).toBe(true);
  await f.checkpoint([observation("next")]);
  await f.checkpoint([],false);
  expect(f.knowledge.tools).toMatchObject({used:["bash"],sessions:0,prompts:0});
});

test("partial calls are omitted; complete shell evidence still learns",async () => {
  const f = await setup();f.policy.microSkills = "envfacts";
  await f.checkpoint([{...observation("read"),semantic:"read",coverage:"partial"},observation("complete")]);
  expect(f.knowledge.environment.facts.map(fact => fact.id)).toContain("absent_tool:pytest");
  expect(f.session.learning!.lastCheck).toMatchObject({observations:2,factObservations:1,incomplete:0,proposer:"not-selected"});
  const g = await setup();g.policy.microSkills = "envfacts";
  await g.checkpoint([{...observation("partial"),coverage:"partial"}]);
  expect(g.knowledge.environment.facts).toHaveLength(0);
  expect(g.session.learning!.lastCheck).toMatchObject({observations:1,factObservations:0,incomplete:1});
  expect(f.calls+g.calls).toBe(0);
  const reads = await setup();
  for (let i=0;i<4;i++) await reads.checkpoint([{...observation(`read-${i}`),semantic:"read",coverage:"partial"}]);
  expect(reads.session.learning!.ticks).toBe(0);expect(reads.calls).toBe(0);expect(reads.knowledge.distiller.window).toHaveLength(0);
});

test("distinct completed runs can promote facts inside one session; same-run repeats cannot add votes",async()=>{
 const f=await setup();f.policy.microSkills="envfacts";
 await f.checkpoint([observation("one")]);await f.checkpoint([observation("one")]);
 expect(f.knowledge.environment.facts[0].life.confirms).toHaveLength(1);
 for(const id of ["two","three","four"])await f.checkpoint([observation(id)]);
 const fact=f.knowledge.environment.facts[0];expect(fact.life.confirms).toHaveLength(4);expect(fact.life.fire_den).toBe(4);expect(f.knowledge.render).toContain("pytest");expect(f.knowledge.factReviews).toBeUndefined();expect(f.calls).toBe(0);
});
test("a partial shell result does not discard an unrelated complete fact observation",async()=>{
 const f=await setup();f.policy.microSkills="envfacts";
 await f.checkpoint([observation("complete"),{...observation("partial","echo noisy","truncated log"),coverage:"partial"}]);
 expect(f.knowledge.environment.facts.map(f=>f.id)).toContain("absent_tool:pytest");expect(f.session.learning!.lastCheck).toMatchObject({factObservations:1,incomplete:1});
});

test("model-assisted facts ground and become eligible automatically across independent runs in one ongoing session",async()=>{
 const f=await setup(true);
 for(let i=0;i<4;i++)await f.checkpoint([{...observation(`work-${i}`,"bun test","1 passed"),outcome:"success",exitCode:0}]);
 expect(f.calls).toBe(1);expect(f.knowledge.distiller.facts).toHaveLength(1);expect(f.knowledge.distiller.facts[0].life.confirms).toHaveLength(4);expect(f.knowledge.render).toContain("Repository tests run with bun test.");expect(f.knowledge.factReviews).toBeUndefined();
});
test("partial evidence about the same subject cannot hide a contradictory outcome",async()=>{
 const f=await setup();f.policy.microSkills="envfacts";
 await f.checkpoint([observation("missing"),{...observation("partial-success","python -m pytest","1 passed"),outcome:"success",exitCode:0,coverage:"partial"}]);
 expect(f.knowledge.environment.facts).toHaveLength(0);expect(f.session.learning!.lastCheck!.notes.join(" ")).toContain("same subject");
});
test("legacy credits carry conservatively into the first new evidence group, then separate runs can progress",async()=>{
 const f=await setup();f.policy.microSkills="envfacts";await f.checkpoint([observation("old")]);delete f.session.learning!.evidenceGroup;
 await f.checkpoint([observation("upgrade")]);expect(f.knowledge.environment.facts[0].life.confirms).toHaveLength(1);
 await f.checkpoint([observation("new")]);expect(f.knowledge.environment.facts[0].life.confirms).toHaveLength(2);
});
