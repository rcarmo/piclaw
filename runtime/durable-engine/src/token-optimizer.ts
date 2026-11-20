// Lifecycle host port of Kintsugi 4afeac1e; MIT — see mcp/UPSTREAM-LICENSE.
import {createOptimizerOutputExtension,createToolOutputTools} from "./token-optimizer-output.ts";
import {createToolOutputStore} from "./mcp/tool-output-store.ts";
import {captureMark,conversationLineage,type AgentDatabase} from "./mcp/retained-database.ts";
import type {SavedOutputReader} from "./optimizer-output-source.ts";
import {createOptimizerGoalsExtension} from "./token-optimizer-goals.ts";
import {OptimizerPlanBinding,optimizerPlanTask} from './optimizer-plan-binding.ts';
import {contextSection,fingerprint,judgeGoal,scopeKey,sessionKey,type AttachmentType,type LearningSession,type GoalPlan} from "#token-optimizer/core";
import {createSdkModelTransport,createTokenEconomizer,decodeArguments,decodeResult,detach,KnowledgeDoc,RunDoc,runIdentity,SessionsDoc,type HostDomain,type HostSession,type Knowledge} from "#token-optimizer/pi-durable";
import {BACKGROUND_CONTEXT as context} from "@earendil-works/chord/context";
import type {Models} from "@earendil-works/pi-ai";
import {AgentDoc,AssistantEntry,CompactionEntry,defineDoc,defineEntry,LiveDoc,SystemEntry,type AgentState,type Conversation,type ConversationId,type Harness,type RegistryReader} from "@earendil-works/pi-durable";
import {Type} from "typebox";import{Value}from"typebox/value";
import {carriedSnapshotIds,lastAssistantEntry,latestOptimizerEntry,nativeOptimizerTool,nativeOptimizerResult,nativeOptimizerTrajectory,optimizerSections} from "./token-optimizer-source.ts";
import type {TokenOptimizerConfiguration} from "./token-optimizer-config.ts";
import {recordOptimizerOperation} from "./token-optimizer-operations.ts";
export interface CoreOptimizerAgent {agentId:string;durableId:ConversationId;branches?:ConversationId[];parentId?:string;rootId?:string;readOnly?:boolean;oneShotCallId?:string;title?:string;label?:string}
const errorMessage=(error:unknown)=>error instanceof Error?error.message:String(error);
const NativeNotices=defineDoc<{ids:string[]}>({kind:"piclaw.token-optimizer.notices",version:1,scope:"session",initial:()=>({ids:[]}),checkpointWhen:()=>false});
export const OptimizerNotice=defineEntry<{id:string;text:string;at:number;code?:string;runId?:string|null}>("piclaw.token-optimizer.notice");
export const NativeOptimizerSessions = defineDoc<{sessions:Record<string,{host:HostSession;begin:number;end:number|null}>}>({kind:"piclaw.token-optimizer.sessions",version:1,scope:"session",initial:() => ({sessions:{}}),checkpointWhen:() => false});
const NativeEpoch = defineDoc<{id:string|null}>({kind:"piclaw.token-optimizer.epoch",version:1,scope:"conversation",history:"latest",fork:"initial",initial:() => ({id:null}),checkpointWhen:() => false});
type Filter = NonNullable<AgentState["tools"]>|null;
const NativeMask = defineDoc<{initialized:boolean;baseline:Filter;rendered:Filter;owned:string[]}>({kind:"piclaw.token-optimizer.mask",version:1,scope:"conversation",history:"latest",fork:"current",initial:() => ({initialized:false,baseline:null,rendered:null,owned:[]}),checkpointWhen:() => false});
/** Footer chips refresh at most this often while optimizer state changes. */
const chipDelayMs = 250;
/** What an Agent's composer footer shows; `focus` opens that Agent's row in Settings. */
export type OptimizerChip = {mode:"observe"|"active";facts:number;hidden:number;suggestions:number;nudged:boolean;focus:string};
/** Automatic picks wait this long before a prompt goes ahead without them. */
const promptPickLimitMs = 20_000;
const actorSchema = Type.Tuple([Type.String(),Type.String()]);
function actor(host:HostSession) {const value:unknown = JSON.parse(host.id);Value.Assert(actorSchema,value);return value[0];}
const active = new Map<string,ReturnType<typeof createNativeTokenOptimizer>>();
export function nativeTokenOptimizers() {return [...active.entries()];}
export function createNativeTokenOptimizer(options:{workspaceId:string;harness:() => Harness;models:Models;registry:RegistryReader;configuration:TokenOptimizerConfiguration;workspaceRoot:string;environmentRevision:string;agents:()=>Promise<readonly CoreOptimizerAgent[]>;plan:(host:HostSession)=>Promise<GoalPlan|null>;workspaceTitle?:() => Promise<string|null>;readSavedOutput:SavedOutputReader;database:AgentDatabase}) {
  const hosts = new Map<ConversationId,HostSession>(), subagents = new Map<ConversationId,HostSession>(), excluded = new Set<ConversationId>(), modelFree = new Map<ConversationId,boolean>(), preparing = new Set<ConversationId>();let maintenance:ConversationId|undefined, stop:(() => void)|undefined, observer:(() => void)|undefined;
  let events = Promise.resolve(), detaching:Promise<void>|undefined;
  const policyUpdates = new Set<Promise<void>>();
  const chips = new Map<ConversationId,OptimizerChip>(), chipListeners = new Set<(id:ConversationId) => void>();
  let chipRefresh:Promise<void>|null = null, chipAgain = false, detached = false;
  /** Reads only the session, repository and run records the chip needs, once per refresh pass. */
  async function summarize(host:HostSession,sessions:Record<string,LearningSession>,knowledge:Knowledge|undefined):Promise<OptimizerChip|null> {
    const policy = options.configuration.policy(options.workspaceId,actor(host));
    if (!policy.enabled || policy.mode === "off") return null;
    const session = sessions[sessionKey(host.scope,host.parent ?? host.id)], run = await options.harness().snapshot(RunDoc,sessionKey(host.scope,host.id),context);
    const current = run && !run.closed ? run.decisions.filter(decision => decision.runId === run.guard?.runId) : [];
    const nudged = current.some(decision => decision.status === "queued" || decision.status === "consumed" || decision.status === "simulated");
    return {mode:policy.mode,facts:session?.injectedIds.length ?? 0,hidden:host.parent ? 0 : session?.frozenMask.length ?? 0,suggestions:host.parent ? 0 : knowledge?.tools.proposal.length ?? 0,nudged,focus:JSON.stringify([options.workspaceId,actor(host)])};
  }
  /** Recomputes attached Agents' chips after a short pause; overlapping requests coalesce into one more pass. */
  function refreshChips() {
    if (detached) return Promise.resolve();
    if (chipRefresh) {chipAgain = true;return chipRefresh;}
    chipRefresh = (async () => {
      do {
        chipAgain = false;
        await new Promise(resolve => setTimeout(resolve,chipDelayMs));
        if (detached) return;
        const sessions = (await options.harness().snapshot(SessionsDoc,context))?.sessions ?? {}, scope = [...hosts.values()][0]?.scope;
        const knowledge = scope ? await options.harness().snapshot(KnowledgeDoc,scopeKey(scope),context) : undefined;
        for (const [id,host] of [...hosts,...subagents]) {
          const next = await summarize(host,sessions,knowledge), previous = chips.get(id);
          if (JSON.stringify(next ?? null) === JSON.stringify(previous ?? null)) continue;
          if (next) chips.set(id,next);else chips.delete(id);
          for (const listener of chipListeners) listener(id);
        }
      } while (chipAgain);
    })().catch(error => console.error("Token optimizer status refresh failed",error)).finally(() => {chipRefresh = null;});
    return chipRefresh;
  }
  const picks = new Map<ConversationId,{at:number;ms:number;hidden:string[]|null;note:string|null}>();
  async function prepare(host:HostSession,task:string,requestId:string,attachments:AttachmentType[] = [],expiresAt?:number) {
    if ((await options.harness().snapshot(LiveDoc,host.conversationId,context))?.run) throw new Error("Wait for the Agent to become idle before picking tools for a task");
    return optimizer.prepareTools(host,task,attachments,requestId,{index:0,reauditEvery:0,expiresAt},async () => (expiresAt === undefined || Date.now() < expiresAt) && hosts.get(host.conversationId)?.id === host.id && !(await options.harness().snapshot(LiveDoc,host.conversationId,context))?.run);
  }
  /**
   * Subagents are recognised from the Agent catalogue the first time their conversation is seen, which is no later than
   * their first request. One-shot and read-only Agents are not subagents here; their tool use still counts as evidence.
   */
  async function subagentHost(id:ConversationId):Promise<HostSession|null> {
    if (subagents.has(id)) return subagents.get(id)!;
    if (excluded.has(id)) return null;
    const record = (await options.agents().then(agents=>({agents})))?.agents.find(row => row.durableId === id || row.branches?.includes(id));
    if (!record) return null; // A committed SDK child may precede its host catalogue projection; absence grants nothing.
    if (!record.parentId || record.readOnly || record.oneShotCallId) {excluded.add(id);return null;}
    const parent = [...hosts.values()].find(host => actor(host) === record.rootId);if (!parent) return null;
    // The subagent's actor is its root Agent, so it follows that Agent's Settings override.
    const host:HostSession = {...parent,id:JSON.stringify([actor(parent),`subagent:${record.agentId}:${parent.id}`]),conversationId:id,parent:parent.id};
    subagents.set(id,host);return host;
  }
  const domain:HostDomain = {integrationId:"piclaw.native",session:async id => {
    const host = hosts.get(id);if (!host) return subagentHost(id);
    if (modelFree.get(id)) return {...host,delegated:true};
    return host;
  },tool:nativeOptimizerTool,arguments:(_name,args) => decodeArguments(args),decode:nativeOptimizerResult,
    async catalogue(host) {
      const conversation = await options.harness().conversation(host.conversationId,context);if (!conversation) throw new Error("Optimizer conversation is absent");
      const agent = await conversation.agent(context), stored = await options.harness().snapshot(NativeMask,host.conversationId,context), settings = await options.harness().snapshot(AgentDoc,host.conversationId,context), baseline = stored?.initialized ? stored.baseline : settings?.tools ?? null;
      const extensions = new Set(agent.extensions.map(extension => extension.name)), exposed = new Set([...agent.tools,...agent.callable,...agent.deferred].map(tool => tool.name));
      const tools = [...new Map(options.registry.snapshot().tools().filter(item => extensions.has(item.extension.name)).map(item => [item.tool.name,item.tool])).values()].filter(tool => Array.isArray(baseline) ? baseline.includes(tool.name) : !baseline?.remove.includes(tool.name)).map(tool => ({name:tool.name,description:tool.description.slice(0,4096),revision:fingerprint(JSON.stringify([tool.name,tool.description,tool.parameters,tool.callers])),protected:/plan|goal|user|ask|permission|agent|delegat|message|stop|cancel|credential|recover|codemode|tool_search|tool_output|mcp_recall|history|session_status|exit_process|switch_model|switch_thinking|set_model/i.test(tool.name),highRisk:!nativeOptimizerTool(tool.name).readOnly,exposed:exposed.has(tool.name)}));
      return {revision:fingerprint(JSON.stringify(tools.map(({exposed:_exposed,...tool}) => tool))),source:"native-registry-and-agent-filter",complete:true,tools};
    },
    async setTools(host,excluded,expiresAt) {
      const catalogue = await domain.catalogue(host), safe = excluded.filter(name => catalogue.tools.some(tool => tool.name === name && !tool.protected));
      await options.harness().commit(async tx => {
        const owner = await tx.doc(NativeMask,host.conversationId), agent = await tx.doc(AgentDoc,host.conversationId), current:Filter = agent.tools === undefined ? null : detach({value:agent.tools}).value;
        if (!owner.initialized) {owner.baseline = current;owner.rendered = current;owner.initialized = true;}
        if (JSON.stringify(current) !== JSON.stringify(owner.rendered)) {
          if(excluded.length||owner.owned.length)throw new Error("The tool filter changed outside the optimizer; refusing to overwrite another owner's restrictions");
          // Restoring nothing owns no permissions. Keep a new external filter,
          // including a persisted default-shaped array, instead of widening it.
          owner.baseline=current;owner.rendered=current;
        }
        const baseline:Filter = detach({value:owner.baseline}).value, next:Filter = Array.isArray(baseline) ? baseline.filter(name => !safe.includes(name)) : safe.length ? {remove:[...new Set([...(baseline?.remove ?? []),...safe])]} : baseline;
        if (JSON.stringify(current) !== JSON.stringify(next) && !preparing.has(host.conversationId) && (await tx.doc(LiveDoc,host.conversationId)).run) throw new Error("Task preparation expired while the Agent started work");
        if (expiresAt !== undefined && Date.now() >= expiresAt) throw new Error("Task preparation expired before tool changes committed");
        if (JSON.stringify(current) !== JSON.stringify(next)) {if (next === null) delete agent.tools;else agent.tools = next;}
        owner.rendered = next;owner.owned = safe;
      },context);
    },
    incrementalLearning:true,
    async trajectory(host,cutoff,after) {
      const record = (await options.harness().snapshot(NativeOptimizerSessions,context))?.sessions[host.id];if (!record) return {kind:"absent",reason:"No native logical session record"};
      const rootAgent = actor(host), agents = (await options.agents().then(agents=>({agents})))?.agents ?? [];
      const descendants = agents.filter(row => row.parentId && row.rootId === rootAgent).flatMap(row => [...new Set([row.durableId,...row.branches ?? []])]);
      return nativeOptimizerTrajectory(options.harness(),host,record.begin,record.end,cutoff,descendants,after);
    },
  };
  const transport = createSdkModelTransport(options.models);
  async function goalFor(host:HostSession) {
    const binding = await options.harness().snapshot(OptimizerPlanBinding,host.conversationId,context);
    const task = optimizerPlanTask((await options.harness().snapshot(LiveDoc,host.conversationId,context))?.run);
    if (task === null || binding?.task !== task) return null;
    const plan = await options.plan(host);
    const goal = plan?.revision === binding.revision ? judgeGoal(plan) : null;
    return goal ? {plan:goal,task} : null;
  }
  const optimizer = createTokenEconomizer({harness:options.harness,backgroundOwner:() => {if (maintenance === undefined) throw new Error("Optimizer maintenance owner is not attached");return maintenance;},domain,...transport,goal:goalFor,onOperation:recordOptimizerOperation,policy:host => options.configuration.policy(options.workspaceId,actor(host)),onNotice:async notice => {if (["tools-applied","tools-restored","tool-publication-refused","still-stuck"].includes(notice.code)) return;const rows = (await options.harness().snapshot(NativeOptimizerSessions,context))?.sessions, host = rows?.[notice.sessionId]?.host ?? [...subagents.values()].find(row => row.id === notice.sessionId);if (host) await options.harness().commit(async tx => {const state = await tx.doc(NativeNotices);if (state.ids.includes(notice.id)) return;await tx.appendEntry(OptimizerNotice,host.conversationId,{data:{id:notice.id,text:notice.text,at:Date.now(),code:notice.code,runId:notice.runId}});state.ids.push(notice.id);},context);},onError:error => console.error("Token optimizer observation failed",error)});
  const outputStore = createToolOutputStore(options.database);
  const outputScope = async (id:ConversationId) => {const host = await domain.session(id);return host ? {owner:JSON.stringify([options.workspaceId,options.environmentRevision,actor(host)]),lineage:await conversationLineage(options.harness(),id,context)} : null;};
  const outputExtension = createOptimizerOutputExtension({
    policyFor:async id => {
      const host=await domain.session(id);if(!host||host.delegated)return null;const policy=options.configuration.policy(options.workspaceId,actor(host));
      if(policy.offloadOutputs){const agent=await(await options.harness().conversation(id,context))?.agent(context);if(!agent?.tools.some(tool=>tool.name==='read_tool_output')&&!(agent?.tools.some(tool=>tool.name==='codemode')&&agent.callable.some(tool=>tool.name==='read_tool_output')))policy.offloadOutputs=false;}
      return policy;
    },
    scope:outputScope,mark:id => captureMark(options.harness(),id,context),store:outputStore,readSaved:options.readSavedOutput,
    summarize:(id,input,timeoutMs) => optimizer.summarizeOutput(id,input,timeoutMs),
  });
  let pruneTimer:ReturnType<typeof setInterval>|undefined,pruning:Promise<number>|undefined;
  const pruneOutputs = () => pruning ??= outputStore.prune().catch(error=>{console.error("Could not prune stored tool outputs",error);return 0;}).finally(()=>{pruning=undefined;});
  const goalExtension = createOptimizerGoalsExtension({harness:options.harness,host:domain.session,policy:host => options.configuration.policy(options.workspaceId,actor(host)),drained:optimizer.drained,plan:options.plan,goal:goalFor});
  optimizer.extension = {...optimizer.extension,tools:[...optimizer.extension.tools ?? [],...createToolOutputTools(outputStore,outputScope)],hooks:[...optimizer.extension.hooks ?? [],...outputExtension.hooks ?? [],...goalExtension.hooks ?? []]};
  async function start(conversation:Conversation,record:Pick<CoreOptimizerAgent,"agentId"|"parentId"|"readOnly"|"oneShotCallId">,event:"startup"|"new"|"resume"|"fork" = "startup",parentGroup?:string) {
    if (record.parentId || record.readOnly || record.oneShotCallId) return;
    if (event === "startup" && hosts.has(conversation.id)) return hosts.get(conversation.id)!
    const scope = {host:"piclaw.native",repository:options.workspaceId,environment:options.environmentRevision}, known = (await options.harness().snapshot(NativeEpoch,conversation.id,context))?.id ?? null;
    // A known session keeps its frozen context, so reopening a workspace needs no context or history read.
    const resumed = known !== null && Boolean((await options.harness().snapshot(SessionsDoc,context))?.sessions[sessionKey(scope,known)]);
    const view = resumed ? null : await conversation.context(context), latest = resumed ? null : await latestOptimizerEntry(conversation), carried = view ? optimizerSections(view.entries) : {};
    const host = await options.harness().commit(async tx => {
      const epoch = await tx.doc(NativeEpoch,conversation.id), sessions = await tx.doc(NativeOptimizerSessions);
      if (epoch.id === null) {
        epoch.id = JSON.stringify([record.agentId,crypto.randomUUID()]);
        const host:HostSession = {id:epoch.id,conversationId:conversation.id,scope,repositoryRoot:options.workspaceRoot,environmentRevision:options.environmentRevision,classificationGroup:parentGroup ?? epoch.id,delegated:false};
        // Installing the adapter over old history never imports that history as live learning.
        const ancestors = parentGroup ? Object.values(sessions.sessions).filter(row => row.host.classificationGroup === parentGroup) : [];
        if (event === "fork" && !ancestors.length) throw new Error("Fork classification group has no native source boundary");
        sessions.sessions[epoch.id] = {host,begin:event === "fork" ? Math.min(...ancestors.map(row => row.begin)) : latest ?? 0,end:null};
      }
      const row = sessions.sessions[epoch.id];if (!row) throw new Error("Missing native optimizer epoch");row.end = null;return detach(row.host);
    },context);
    hosts.set(conversation.id,host);
    const assistant = view ? view.entries.findLast(entry => AssistantEntry.is(entry)) : await lastAssistantEntry(conversation);modelFree.set(conversation.id,assistant?.model?.some(message => message.role === "assistant" && message.provider === "piclaw" && message.model === "codemode-template") ?? false);
    const existing = (await options.harness().snapshot(SessionsDoc,context))?.sessions[sessionKey(host.scope,host.id)];
    const carriedIds = existing ? existing.injectedIds : carried[contextSection] ? await carriedSnapshotIds(conversation,carried[contextSection]) : [];
    // Legacy forks may predate incremental learning. Read the actual fork bound
    // without scanning history so their inherited observations cannot earn new votes.
    const inheritedAt = !existing?.learning && !existing?.folded && host.classificationGroup !== host.id
      ? await options.harness().commit(async tx => (await tx.conversation(host.conversationId))?.parent?.at,context) : undefined;
    const live = await options.harness().snapshot(LiveDoc,conversation.id,context), mask = await options.harness().snapshot(NativeMask,conversation.id,context);
    const runningMask = live?.run && !live.run.afterRun && live.run.inputs.length > 0 ? existing?.frozenMask ?? mask?.owned ?? [] : undefined;
    preparing.add(conversation.id);
    queueMicrotask(() => void refreshChips());
    try {await optimizer.sessionStarted(host,{event,visibleHistory:view ? view.entries.some(entry => (entry.model?.length ?? 0) > 0) : true,carriedSections:carried,carriedIds,runningMask,learningAfter:inheritedAt !== undefined ? String(inheritedAt) : event === "fork" ? String(latest ?? 0) : undefined});} finally {preparing.delete(conversation.id);}
    return host;
  }
  async function end(id:ConversationId) {
    const host = hosts.get(id);if (!host) return;
    const conversation = (await options.harness().conversation(id,context))!, latest = await latestOptimizerEntry(conversation), live = await options.harness().snapshot(LiveDoc,id,context);
    await options.harness().commit(async tx => {const row = (await tx.doc(NativeOptimizerSessions)).sessions[host.id];if (!live?.run) row.end ??= latest ?? row.begin;},context);
    await optimizer.sessionEnded(host,!live?.run && !live?.runFailure);hosts.delete(id);
  }
  return {optimizer,domain,start,end,
    async attach() {
      if (detaching) await detaching;
      if (stop || observer) throw Error('Token optimizer is already attached');
      detaching = undefined; detached = false;
      maintenance = (await options.harness().root(context)).id;await optimizer.attach();
      // Expired outputs are never returned; this also removes them while nobody is using the workspace.
      await pruneOutputs();clearInterval(pruneTimer);pruneTimer = setInterval(pruneOutputs,3_600_000);pruneTimer.unref?.();
      const catalogue = await options.agents();
      for (const record of catalogue) if (!record.readOnly && !record.parentId && !record.oneShotCallId) await start((await options.harness().conversation(record.durableId,context))!,record,"resume");
      stop = options.configuration.watch(() => {
        if (detached) return Promise.resolve();
        const update = optimizer.updatePolicy(true).then(() => refreshChips()).finally(() => policyUpdates.delete(update));
        policyUpdates.add(update); return update;
      });active.set(options.workspaceId,this);
      const source = options.harness().observeCommits({advance(publication) {
        // Optimizer state changed: refresh the footer chips after this publication, never inside it.
        if (publication.changes.some(change => change.type === "document" && /^(token-economizer|piclaw\.token-optimizer)\./.test(change.record.kind))) queueMicrotask(() => void refreshChips());
        for (const change of publication.changes) if (change.type === "entry" && AssistantEntry.is(change.value)) modelFree.set(change.value.conversationId,change.value.model?.some(message => message.role === "assistant" && message.provider === "piclaw" && message.model === "codemode-template") ?? false);
        for (const change of publication.changes) if (change.type === "entry" && (SystemEntry.is(change.value) || CompactionEntry.is(change.value))) {
          const entry = change.value, host = hosts.get(entry.conversationId);if (!host) continue;
          events = events.then(async () => {
            const compacted = CompactionEntry.is(entry), sections = compacted ? optimizerSections((await (await options.harness().conversation(host.conversationId,context))!.context(context)).entries) : optimizerSections([entry]);
            await optimizer.replaySections(host,sections,compacted);
          }).catch(error => console.error("Token optimizer section replay failed",error));
        }
      },end() {}});observer = () => source.detach();
    },
    async reset(conversation:Conversation,record:Pick<CoreOptimizerAgent,"agentId"|"parentId"|"readOnly">) {await end(conversation.id);await options.harness().commit(async tx => {(await tx.doc(NativeEpoch,conversation.id)).id = null;},context);return start(conversation,record,"new");},
    async optimizerSessions() {return [...hosts.values()];},
    prepare,
    lookup(id:ConversationId) {return hosts.get(id);},
    /** The footer chip for an Agent or subagent conversation; absent while the optimizer is off for it. */
    chip(id:ConversationId) {return chips.get(id);},
    /** Called with a conversation ID whenever that Agent's chip changes. */
    subscribeChips(listener:(id:ConversationId) => void) {chipListeners.add(listener);void refreshChips();return () => {chipListeners.delete(listener);};},
    /** Subagents seen for a root session, with their catalogue labels, for Settings. */
    async subagentsOf(host:HostSession) {const agents = (await options.agents().then(agents=>({agents})))?.agents ?? [];return [...subagents.values()].filter(row => row.parent === host.id).map(row => ({host:row,label:agents.find(agent => agent.durableId === row.conversationId || agent.branches?.includes(row.conversationId))?.label ?? "Subagent"}));},
    /** Display name for Settings; the catalogue is the source of Agent titles. */
    async title(host:HostSession) {const record = (await options.agents().then(agents=>({agents})))?.agents.find(row => row.durableId === host.conversationId || row.branches?.includes(host.conversationId));return record?.title || record?.label || actor(host);},
    agentId:actor,
    async workspaceTitle() {return await options.workspaceTitle?.() || options.workspaceId;},
    /** The most recent automatic tool pick for each Agent, for Settings. Not persisted. */
    lastPick(id:ConversationId) {return picks.get(id);},
    /**
     * Picks tools for a new prompt before it is admitted, while the Agent is idle. A slow or failed pick never
     * blocks the prompt: it is recorded for Settings and the prompt goes ahead with the current toolset.
     */
    async preparePrompt(id:ConversationId,task:string,attachments:AttachmentType[] = []) {
      const host = hosts.get(id);if (!host || !task.trim()) return;
      const policy = options.configuration.policy(options.workspaceId,actor(host));
      if (!policy.autoToolPicks || policy.toolJudge === "none" || policy.pruning === "off" || !(policy.mode === "active" || policy.mode === "observe" && policy.inferenceInObserve)) return;
      if ((await options.harness().snapshot(LiveDoc,id,context))?.run) return;
      const began = Date.now(), work = prepare(host,task,crypto.randomUUID(),attachments,began+promptPickLimitMs).then(mask => ({mask}),error => ({error:errorMessage(error)}));
      let timer:ReturnType<typeof setTimeout>|undefined;
      const timeout = new Promise<null>(resolve => {timer=setTimeout(resolve,promptPickLimitMs,null);});
      const outcome = await Promise.race([work,timeout]).finally(() => clearTimeout(timer));
      picks.set(id,{at:Date.now(),ms:Date.now()-began,hidden:outcome && "mask" in outcome ? outcome.mask : null,note:outcome === null ? "Took too long, so the prompt went ahead with the current tools." : "error" in outcome ? outcome.error : null});
    },
    async hostForAgent(agentId:string) {const record=(await options.agents().then(agents=>({agents})))?.agents.find(record=>record.agentId===agentId);const host=record&&hosts.get(record.durableId);if(!host)throw new Error("This Agent has no optimizer session.");return host;},
    async commandNotice(host:HostSession,id:string,text:string) {await options.harness().commit(async tx=>{const state=await tx.doc(NativeNotices);const key=`command:${host.id}:${id}`;if(state.ids.includes(key))return;state.ids.push(key);await tx.appendEntry(OptimizerNotice,host.conversationId,{data:{id:key,text,at:Date.now(),code:"optimizer-command"}});},context);},
    host(id:ConversationId) {const host = hosts.get(id);if (!host) throw new Error("This Agent has no optimizer logical session");return host;},
    async detach() {
      if (detaching) return detaching;
      // Stop producers before taking the promises to join. No new callback may outlive SDK cleanup.
      detached = true; clearInterval(pruneTimer); pruneTimer = undefined;
      stop?.(); stop = undefined; observer?.(); observer = undefined;
      return detaching = (async () => {
        const settled = await Promise.allSettled([pruning,events,...policyUpdates]);
        await optimizer.close(); await chipRefresh;
        const failures = settled.filter((result):result is PromiseRejectedResult => result.status === 'rejected');
        if (failures.length) throw new AggregateError(failures.map(result => result.reason),'Token optimizer callback cleanup failed');
        if (active.get(options.workspaceId) === this) active.delete(options.workspaceId);
      })();
    },
    async close() {await events;for (const id of [...hosts.keys()]) await end(id);await this.detach();},
  };
}
