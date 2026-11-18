import {createFactContext} from "./fact-context.ts";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { runIdentity } from "./run-identity.ts";
// SPDX-License-Identifier: Apache-2.0
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { defineExtension, defineEntry, LiveDoc, type ConversationId, type Harness, type LiveState, type Tx } from "@earendil-works/pi-durable";
import { defaultPolicy, emitting, inferenceAllowed, modelFor, observing, type Policy } from "../core/config.ts";
import { compactGuardDigest, reuseKey } from "../core/savers.ts";
import { fingerprint } from "../core/identity.ts";
import { contextSection, replaySections, sessionKey } from "../core/sessions.ts";
import { scopeKey, type DecisionClassifier, type Notice, type Observation, type SideCall } from "../core/types.ts";
import { consumeDecision, decisionText, emptyGuard, foldGuard, resolvedProxy } from "../core/loopguard/turn.ts";
import { envelope, learnedThresholds, percentile, recordTurn } from "../core/loopguard/envelope.ts";
import { scaledThresholds } from "../core/loopguard/rules.ts";
import { spiralSnapshot } from "../core/loopguard/state.ts";
import { loopFeatures, loopFeatureVersion } from "../core/classify/loop-features.ts";
import type { Sample } from "../core/classify/contracts.ts";
import { unionExclusions } from "../core/toolprune/judge.ts";
import { createInferenceQueue } from "./sidecall.ts";
import { createSessionLifecycle } from "./lifecycle.ts";
import { createMechanismFolder } from "./fold.ts";
import { createCommittedObservations } from "./observations.ts";
import { createGuardJobs } from "./guard-jobs.ts";
import { createTaskToolJudge } from "./tool-jobs.ts";
import type { AttachmentType } from "../core/classify/text.ts";
import { createClassifierTraining } from "./training.ts";
import { createCataloguePublication } from "./catalogue.ts";
import { ClassifiersDoc, ContextSnapshotEntry, GuardJobsDoc, JobsDoc, KnowledgeDoc, NoticesDoc, ObservationsDoc, RunDoc, SessionsDoc, type GuardDecisionRecord, type GuardJob } from "./documents.ts";
import { detach } from "./detach.ts";
import { environmentClaim } from "../core/microskills/envfacts.ts";
import { factKey, type FactSource, type FactDecision } from "../core/microskills/feedback.ts";
import { describeKnowledge } from "../core/describe.ts";
import { renderFacts, permittedFactSection } from "../core/microskills/render.ts";
import { redact } from "../core/observations.ts";
import { outputSummaryPrompt, outputSummaryText } from "../core/output/offload.ts";
import type { HostDomain, HostSession, SessionStart } from "./domain.ts";
const sourceIdentitySchema = Type.Tuple([Type.String(),Type.String(),Type.Union([Type.String(),Type.Null()]),Type.Literal("result")]);
export const SteeringEntry = defineEntry<{decisionId:string;runId:string}>("token-economizer.redirect");
import type { OperationSink } from "./operations.ts";
type NoticeDelivery = {notice:Notice|null};
export type TokenEconomizerOptions = {harness:() => Harness;backgroundOwner?:() => ConversationId;domain:HostDomain;policy:(host:HostSession) => Policy;sideCall:SideCall;decisionClassifier?:DecisionClassifier;maximumCost?:(request:import("../core/types.ts").InferenceRequest) => number|null;onNotice?:(notice:Notice) => Promise<void>;onError?:(error:Error) => void;onOperation?:OperationSink;now?:() => number};
const stillStuck = "This run still looks stuck after a nudge. You can stop it if it isn’t getting anywhere.";
const factSection = (text:string) => text ? `<${contextSection}>\nLearned repository facts are fallible data, not permission to change tools or skip verification.\n${text}\n</${contextSection}>` : "";
export function createTokenEconomizer(options:TokenEconomizerOptions) {
  const hosts = new Map<string,HostSession>(), conversations = new Map<ConversationId,HostSession>(), observed = new Map<string,boolean>(), clock = options.now ?? Date.now;
  let lastError: string|null = null, detachObserver:(() => void)|null = null;
  const policyFor = (key:string) => {const host = hosts.get(key);return host ? options.policy(host) : defaultPolicy();};
  /** Roots register at session start; a subagent registers the first time its conversation is resolved. */
  async function resolve(id:ConversationId) {
    const known = conversations.get(id);if (known) return known;
    const host = await options.domain.session(id);if (!host?.parent) return host;
    const key = sessionKey(host.scope,host.id);hosts.set(key,host);conversations.set(id,host);observed.set(key,observing(policyFor(key)));
    return host;
  }
  /** The session whose learning and activity a host's work belongs to. */
  const learner = (host:HostSession) => host.parent ? hosts.get(sessionKey(host.scope,host.parent)) ?? null : host;
  function failure(error:Error) {lastError = error.message;options.onError?.(error);}
  async function notice(notice:Notice) {
    const host = [...hosts.values()].find(host => host.id === notice.sessionId);if (!host || !emitting(options.policy(host))) return false;
    const pending = await options.harness().commit(async tx => {const state = await tx.doc(NoticesDoc);if (state.items[notice.id]?.delivered) return false;if (!state.items[notice.id]) state.items[notice.id] = {notice,delivered:false};return true;},BACKGROUND_CONTEXT);
    if (!pending) return true;
    if (!options.onNotice || !emitting(options.policy(host))) return false;
    await options.onNotice(notice);
    await options.harness().commit(async tx => {(await tx.doc(NoticesDoc)).items[notice.id].delivered = true;},BACKGROUND_CONTEXT);return true;
  }
  const sideCall:SideCall = async (request,signal) => {
    if (!request.classification) return options.sideCall(request,signal);
    if (!options.decisionClassifier) return {text:"",model:request.model,usage:null,cost:0,durationMs:0,authUnavailable:false,error:"Classification is unsupported by this host"};
    const result = await options.decisionClassifier(request.classification,signal);
    return {text:JSON.stringify({label:result.label,probabilities:result.probabilities}),model:result.model,usage:result.usage,cost:result.cost,durationMs:result.durationMs,authUnavailable:result.authUnavailable,error:result.error};
  };
  const queue = createInferenceQueue({harness:options.harness,backgroundOwner:options.backgroundOwner,policy:policyFor,sideCall,onOperation:options.onOperation,maximumCost:options.maximumCost,now:clock,onAuthPause:async (account,revision,key) => {const host = hosts.get(key);if (host && emitting(policyFor(key))) await notice({id:fingerprint(JSON.stringify([account,revision,"auth-pause"])),code:"model-auth-paused",text:"Optimization model calls are paused. Reconnect the provider, then choose Retry model calls in Token economizer settings.",sessionId:host.id,runId:null});}});
  const taskJudge = createTaskToolJudge({harness:options.harness,policy:policyFor,queue});
  const pipeline = createGuardJobs({harness:options.harness,backgroundOwner:options.backgroundOwner,policy:policyFor,queue});
  const publication = createCataloguePublication({harness:options.harness,backgroundOwner:options.backgroundOwner,domain:options.domain,policy:policyFor,onOperation:options.onOperation,onNotice:async item => {await notice(item);}});
  const training = createClassifierTraining({harness:options.harness,backgroundOwner:options.backgroundOwner,domain:options.domain,policy:policyFor,onOperation:options.onOperation});
  const lifecycle = createSessionLifecycle({harness:options.harness,backgroundOwner:options.backgroundOwner,domain:options.domain,policy:policyFor,onOperation:options.onOperation,fold:createMechanismFolder({harness:options.harness,domain:options.domain,queue}),now:clock,
    onFolded:async host => {await publication.wait({host,scope:host.scope,sessionKey:sessionKey(host.scope,host.id)});await training.rebuild(host);},
    renderCached:factSection});
  async function reportDecision(tx:Tx,host:HostSession,entry:GuardDecisionRecord) {
    await options.onOperation?.(tx,host.conversationId,{id:`nudge:${entry.id}`,name:"optimizer.nudge",status:"complete",startedAt:entry.at ?? clock(),at:clock(),input:{mode:entry.mode,runId:entry.runId,reason:entry.reason},output:{action:entry.action,delivery:entry.status,text:entry.text ?? "",submissionId:entry.submissionId}});
  }
  async function closeRun(host:HostSession,normal:boolean,sessionEnd = false) {
    const key = sessionKey(host.scope,host.id);
    await options.harness().commit(async tx => {
      const run = await tx.doc(RunDoc,key,null);if (run.closed || !run.guard) return;
      const policy = policyFor(key);if (!sessionEnd && (!observing(policy) || policy.loop === "off")) return;
      const guard = detach(run.guard), knowledge = await tx.doc(KnowledgeDoc,scopeKey(host.scope),host.scope);
      if (observing(policy) && !host.parent) knowledge.envelope = recordTurn(detach(knowledge.envelope),guard.cum_turns,resolvedProxy(guard,normal),spiralSnapshot(guard.whole));
      run.closed = true;run.guard.held = null;
      for (const decision of run.decisions) if (["proposed","queued"].includes(decision.status)) {
        const queued = decision.status === "queued";decision.status = "undelivered";
        if (queued) await reportDecision(tx,host,decision);
      }
    },BACKGROUND_CONTEXT);
  }
  async function onLive(id:ConversationId,live:LiveState) {
    const host = await resolve(id);if (!host || host.delegated) return;
    const key = sessionKey(host.scope,host.id), policy = policyFor(key);if (!observing(policy)) return;
    const current = await options.harness().snapshot(RunDoc,key,BACKGROUND_CONTEXT);
    if (current?.guard && !current.closed && (!live.run || runIdentity(live.run) !== current.guard.runId || live.run.afterRun)) await closeRun(host,!live.runFailure || runIdentity(live.runFailure) !== current.guard.runId);
    if (!host.parent && (!live.run || live.run.afterRun) && current?.guard?.runId) await lifecycle.runCompleted(host,current.guard.runId);
    if (!live.run || live.run.afterRun || runIdentity(live.run) === null) return;
    await options.harness().commit(async tx => {
      const run = await tx.doc(RunDoc,key,null);if (!observing(policyFor(key))) return;
      if (run.guard?.runId !== runIdentity(live.run!)!) {run.guard = emptyGuard(runIdentity(live.run!)!);run.inputs = [...live.run!.inputs];run.closed = false;}
      for (const decision of run.decisions) if (decision.runId === runIdentity(live.run!) && decision.submissionId && live.run!.inputs.includes(decision.submissionId) && decision.status === "queued") {
        decision.status = "consumed";await reportDecision(tx,host,decision);
      }
    },BACKGROUND_CONTEXT);
  }
  async function onObservation(host:HostSession,observation:Observation,liveBoundary:boolean) {
    const key = sessionKey(host.scope,host.id), policy = policyFor(key);if (!observing(policy)) return;
    const owner = learner(host);if (owner) await lifecycle.transcriptChanged(owner);
    if (policy.loop === "off") return;
    const handle = await options.harness().conversation(host.conversationId,BACKGROUND_CONTEXT);if (!handle) throw new Error("Observed conversation is missing");
    const catalogue = await options.domain.catalogue(host);
    const delivery:NoticeDelivery = {notice:null};
    await options.harness().commit(async tx => {
      const live = await tx.doc(LiveDoc,host.conversationId), run = await tx.doc(RunDoc,key,null), knowledge = await tx.doc(KnowledgeDoc,scopeKey(host.scope),host.scope), jobs = await tx.doc(GuardJobsDoc), policy = policyFor(key);
      if (!observing(policy) || policy.loop === "off") return;
      const active = live.run !== undefined && !live.run.afterRun && runIdentity(live.run) === observation.runId;
      if (!active && (run.closed || run.guard?.runId !== observation.runId)) return;
      if (run.guard?.runId !== observation.runId) {run.guard = emptyGuard(observation.runId);run.inputs = [...live.run!.inputs];run.closed = false;}
      const source:unknown = JSON.parse(observation.id);Value.Assert(sourceIdentitySchema,source);
      const toolBoundary = liveBoundary && active && !live.generation && live.tools?.some(slot => String(slot.taskId) === source[1]) === true;
      const prior = detach(run.guard), classifiers = await tx.doc(ClassifiersDoc,scopeKey(host.scope),null), pending = prior.judge_pending ? jobs.jobs[prior.judge_pending.id]?.result ?? null : null;
      const model = modelFor(policy,"loopJudge"), classifier = modelFor(policy,"loopClassifier"), spend = await tx.doc(JobsDoc);
      const accountPaused = (ref:typeof model) => ref !== null && spend.paused.includes(JSON.stringify([host.scope.host,ref.provider]));
      const runner = inferenceAllowed(policy) && ((["generative","cascade"].includes(policy.judge) && model !== null && !accountPaused(model)) || (["classifier","cascade"].includes(policy.judge) && classifier !== null && !accountPaused(classifier))) || policy.savers.localLoop && classifiers.loop?.identity.state === "active_bands";
      const thresholds = learnedThresholds(detach(knowledge.envelope),policy.level,policy.thresholds), env = envelope(detach(knowledge.envelope),policy.level,policy.thresholds);
      const folded = foldGuard(prior,observation,env,thresholds,policy.loop,policy.redirects,clock(),pending,toolBoundary && runner === true,host.repositoryRoot);run.guard = folded.state;
      const decision = folded.state.held;
      if (decision && toolBoundary) {
        const previous = run.decisions.find(item => item.id === decision.id);
        const entry:GuardDecisionRecord = previous ?? {id:decision.id,runId:observation.runId,action:decision.action,mode:policy.mode === "observe" ? "observe" : "active",status:"proposed",submissionId:null,reason:decision.reason,text:decision.action === "redirect" ? decisionText(folded.state) : stillStuck,at:clock()};
        if (!previous || previous.status === "proposed") {
          // Admission must precede this transaction's first table write. All earlier mutations are document drafts.
          if (emitting(policyFor(key)) && decision.action === "redirect" && run.inputs.every(input => live.run!.inputs.includes(input))) {
            entry.submissionId = await handle.submit(tx,{type:"input",content:decisionText(folded.state),whenBusy:"steer",whenIdle:"reject",requestId:`token-economizer-${fingerprint(decision.id)}`,entry:{kind:SteeringEntry.kind,data:{decisionId:decision.id,runId:observation.runId}}});entry.status = "queued";
          } else if (emitting(policyFor(key)) && decision.action === "notice") {
            delivery.notice = {id:decision.id,code:"still-stuck",text:stillStuck,sessionId:host.id,runId:observation.runId};entry.status = "queued";
          } else entry.status = "simulated";
          if (!previous) run.decisions.push(entry);run.guard = consumeDecision(folded.state);
          await reportDecision(tx,host,entry);
        }
      }
      if (decision && !toolBoundary && !run.decisions.some(item => item.id === decision.id)) run.decisions.push({id:decision.id,runId:observation.runId,action:decision.action,mode:policy.mode === "observe" ? "observe" : "active",status:"proposed",submissionId:null,reason:decision.reason,text:decision.action === "redirect" ? decisionText(folded.state) : stillStuck,at:clock()});
      if (folded.judge) {
        const features = folded.state.featureCoverage ? loopFeatures(folded.state.window,{repositoryRoot:host.repositoryRoot,calls:folded.state.cum_turns,callsSinceGreen:folded.state.callsSinceGreen,callsSinceNewFailure:folded.state.sinceNewFailure,p90:percentile(knowledge.envelope.resolved_turns,90)}) : null;
        const fullDigest = folded.judge.digest;
        if (policy.savers.compact) folded.judge.digest = compactGuardDigest(fullDigest,folded.state.window,host.repositoryRoot);
        const reuseInput = {scope:scopeKey(host.scope),runId:folded.state.runId,segment:folded.state.segment,sourceRange:folded.state.window.map(call => call.id),counters:[folded.state.cum_turns,folded.state.judge_gap,folded.state.judge_last,folded.state.edits,folded.state.verifications,folded.state.nudges_done],thresholdRevision:JSON.stringify(thresholds),envelopeRevision:JSON.stringify(knowledge.envelope),policyRevision:JSON.stringify(policy),model,artifactId:JSON.stringify([classifiers.generation,classifiers.loop?.identity ?? null,classifiers.text]),digest:folded.judge.digest};
        const sampleId = fingerprint(JSON.stringify([scopeKey(host.scope),folded.judge.id,"sample"]));
        const job:GuardJob = {effect:folded.judge,host,sessionKey:key,model,writerModel:modelFor(policy,"writer"),classifier,threshold:thresholds.judge_confidence,template:policy.savers.templates,status:"queued",result:null,features:features?.kind === "features" ? features.values : null,revision:fingerprint(JSON.stringify(policy)),artifactId:classifiers.loop?.identity.id ?? null,sampleId,reuse:policy.savers.reuse ? {key:reuseKey(reuseInput),canonical:JSON.stringify([reuseInput,folded.state.window])} : null,compactFull:folded.judge.digest !== fullDigest ? fullDigest : null};
        const sample:Sample = {id:sampleId,recordId:folded.judge.id,scope:scopeKey(host.scope),group:host.classificationGroup,sessionId:host.id,at:clock(),kind:"loop",tool:null,features:job.features ?? [],tokens:[],label:null,reviewed:false,source:"reference",complete:job.features !== null && catalogue.complete,eligible:true,uniform:true,featureVersion:loopFeatureVersion,labelPolicy:`reference-loop-v1:${thresholds.judge_confidence}`,catalogueRevision:catalogue.revision,environmentRevision:host.environmentRevision,teacher:model,classifier:null,textScore:null};
        if (!await pipeline.schedule(tx,job,sample)) run.guard!.judge_pending = null;
      }
    },BACKGROUND_CONTEXT);
    if (delivery.notice && await notice(delivery.notice)) {const id = delivery.notice.id;await options.harness().commit(async tx => {const row = (await tx.doc(RunDoc,key,null)).decisions.find(item => item.id === id);if (row) {row.status = "consumed";await reportDecision(tx,host,row);}},BACKGROUND_CONTEXT);}
  }
  const recorder = createCommittedObservations({harness:options.harness,domain:{...options.domain,session:resolve},policy:policyFor,onObservation,onLive,onActivity:async (id,at) => {const host = conversations.get(id), owner = host && !host.delegated ? learner(host) : null;if (owner && observing(policyFor(sessionKey(owner.scope,owner.id)))) await lifecycle.transcriptChanged(owner,at);},onError:failure});
  const facts = createFactContext({harness:options.harness,async state(id) {
    const host = conversations.get(id) ?? await resolve(id);if (!host || host.delegated) return;
    const row = (await options.harness().snapshot(SessionsDoc,BACKGROUND_CONTEXT))?.sessions[sessionKey(host.scope,host.parent ?? host.id)];
    const knowledge = await options.harness().snapshot(KnowledgeDoc,scopeKey(host.scope),BACKGROUND_CONTEXT);
    if (row && knowledge) return {row,host,knowledge,policy:options.policy(host)};
  }});
  const extension = defineExtension({name:"token-economizer",tasks:[...queue.extension.tasks ?? [],...lifecycle.extension.tasks ?? [],...pipeline.extension.tasks ?? [],...publication.extension.tasks ?? [],...training.extension.tasks ?? []],hooks:[...recorder.extension.hooks ?? [],...facts.hooks],sections:facts.sections});
  return {
    extension,
    async attach() {
      const sessions = await options.harness().snapshot(SessionsDoc,BACKGROUND_CONTEXT);
      for (const host of Object.values(sessions?.hosts ?? {})) hosts.set(sessionKey(host.scope,host.id),host);
      const observer = recorder.attach();detachObserver = () => observer.detach();
      for (const host of hosts.values()) await publication.wait({host,scope:host.scope,sessionKey:sessionKey(host.scope,host.id)});
    },
    async sessionStarted(host:HostSession,start:SessionStart & {carriedIds:string[]}) {
      const key = sessionKey(host.scope,host.id);hosts.set(key,host);conversations.set(host.conversationId,host);observed.set(key,observing(policyFor(key)));
      const previous = (await options.harness().snapshot(SessionsDoc,BACKGROUND_CONTEXT))?.sessions[key], prepared = await lifecycle.sessionStarted(host,start);if (!prepared) return null;
      if (!previous && prepared.section) await options.harness().commit(tx => tx.appendEntry(ContextSnapshotEntry,host.conversationId,{data:{sessionId:host.id,section:prepared.section,injectedIds:prepared.injectedIds}}),BACKGROUND_CONTEXT);
      await options.domain.setTools(host,prepared.frozenMask);
      await recorder.recover(host);
      if (!previous && prepared.section && emitting(policyFor(key))) await notice({id:fingerprint(JSON.stringify([scopeKey(host.scope),"facts",prepared.section])),code:"facts-selected",text:`Added ${prepared.injectedIds.length === 1 ? "1 learned repository fact" : `${prepared.injectedIds.length} learned repository facts`} to this session. They’re hints, not guarantees.`,sessionId:host.id,runId:null});
      return prepared;
    },
    async sessionEnded(host:HostSession,completedNormally = false) {await recorder.drained();await closeRun(host,completedNormally,true);await lifecycle.sessionEnded(host);},
    async replaySections(host:HostSession,sections:Record<string,string>,compacted:boolean) {
      const key = sessionKey(host.scope,host.id);
      await options.harness().commit(async tx => {const state = await tx.doc(SessionsDoc), row = state.sessions[key];if (!row) return;state.sessions[key] = replaySections(row,sections,compacted,clock());},BACKGROUND_CONTEXT);
    },
    async prepareTools(host:HostSession,task:string,attachments:AttachmentType[] = [],requestId = "",stage:{index:number;reauditEvery:number;expiresAt?:number} = {index:0,reauditEvery:0},isCurrent:() => Promise<boolean> = async () => true) {
      if (host.parent) throw new Error("Subagents use their parent's tools; prepare the parent instead");
      const startedAt = clock(), operationId = `prepare:${fingerprint(JSON.stringify([host.id,requestId || crypto.randomUUID()]))}`;
      const key = sessionKey(host.scope,host.id), knowledge = await options.harness().snapshot(KnowledgeDoc,scopeKey(host.scope),BACKGROUND_CONTEXT), catalogue = await options.domain.catalogue(host);
      if (!knowledge) throw new Error("Start the logical session before preparing tools");
      if (stage.expiresAt !== undefined && !Number.isFinite(stage.expiresAt)) throw new Error("Invalid preparation deadline");
      if (!Number.isSafeInteger(stage.index) || stage.index < 0 || !Number.isSafeInteger(stage.reauditEvery) || stage.reauditEvery < 0) throw new Error("Invalid task re-audit cadence");
      if (stage.index > 0 && stage.reauditEvery > 0 && stage.index%stage.reauditEvery === 0) {
        if (emitting(policyFor(key)) && policyFor(key).pruning !== "off") {if (!await isCurrent()) throw new Error("Task preparation expired");await options.domain.setTools(host,[],stage.expiresAt);await options.harness().commit(async tx => {(await tx.doc(SessionsDoc)).sessions[key].frozenMask = [];},BACKGROUND_CONTEXT);}
        return [];
      }
      const choices = await taskJudge(host,task,catalogue,knowledge.tools.applied,knowledge.tools.used,knowledge.tools.kept,attachments,requestId,isCurrent,stage.expiresAt);
      const current = await options.domain.catalogue(host), mask = unionExclusions(knowledge.tools.applied,choices,current.tools,knowledge.tools.used,knowledge.tools.kept);
      if (!await isCurrent()) {
        await options.harness().commit(async tx => options.onOperation?.(tx,host.conversationId,{id:operationId,name:"optimizer.prepare-tools",status:"failed",startedAt,at:clock(),input:{task,attachments},output:{error:"Task preparation expired; no tool changes applied"}}),BACKGROUND_CONTEXT);
        throw new Error("Task preparation expired; retry at an idle boundary");
      }
      if (emitting(policyFor(key))) {await options.domain.setTools(host,mask,stage.expiresAt);await options.harness().commit(async tx => {(await tx.doc(SessionsDoc)).sessions[key].frozenMask = mask;},BACKGROUND_CONTEXT);}
      if (options.onOperation && Object.keys(choices).length) await options.harness().commit(async tx => options.onOperation?.(tx,host.conversationId,{id:operationId,name:"optimizer.prepare-tools",status:"complete",startedAt,at:clock(),input:{task,attachments,mode:policyFor(key).mode},output:{decisions:choices,hidden:mask,applied:emitting(policyFor(key))}}),BACKGROUND_CONTEXT);
      return mask;
    },
    async status(host:HostSession) {
      const key = sessionKey(host.scope,host.id), knowledge = await options.harness().snapshot(KnowledgeDoc,scopeKey(host.scope),BACKGROUND_CONTEXT), sessions = await options.harness().snapshot(SessionsDoc,BACKGROUND_CONTEXT), run = await options.harness().snapshot(RunDoc,key,BACKGROUND_CONTEXT), jobs = await options.harness().snapshot(JobsDoc,BACKGROUND_CONTEXT), classifiers = await options.harness().snapshot(ClassifiersDoc,scopeKey(host.scope),BACKGROUND_CONTEXT);
      const session = sessions?.sessions[key];
      const visible = session && knowledge ? {...session,section:session.factsSuppressed ? "" : permittedFactSection(session.section,knowledge.environment,knowledge.distiller,host.scope.repository,options.policy(host),knowledge.factReviews)} : session;
      return {policy:options.policy(host),session:visible ?? null,knowledge:knowledge ?? null,run:run ?? null,jobs:Object.values(jobs?.jobs ?? {}).filter(job => job.sessionKey === key),ledger:jobs?.budget.ledger.filter(row => row.sessionId === key) ?? [],accounting:{calls:jobs?.budget.calls[key] ?? 0,dailyCalls:jobs?.budget.dailyCalls[new Date(clock()).toISOString().slice(0,10)] ?? 0,reservations:Object.entries(jobs?.budget.reserved ?? {}).filter(([,row]) => row.session === key).map(([id,row]) => ({id,cost:row.cost})),authPaused:(jobs?.paused.length ?? 0) > 0},classifiers:classifiers ?? null,lastError};
    },
    /** Explicit removal for one session; repository knowledge and future fresh sessions are unchanged. */
    async removeContext(host:HostSession) {
      const key = sessionKey(host.scope,host.id);
      return options.harness().commit(async tx => {
        if ((await tx.doc(LiveDoc,host.conversationId)).run) throw new Error("Wait until the Agent is idle, then remove learned facts.");
        const state = await tx.doc(SessionsDoc), row = state.sessions[key];if (!row) throw new Error("This Agent has no optimizer session");
        const removed = row.injectedIds.length;row.section = "";row.injectedIds = [];row.factsSuppressed = true;return removed;
      },BACKGROUND_CONTEXT);
    },
    /** Explicit feedback is separate from asynchronous learning, so an in-flight fold cannot overwrite it. */
    async reviewFact(host:HostSession,source:FactSource,id:string,decision:FactDecision,expectedClaim:string,note = "") {
      await options.harness().commit(async tx => {
        const knowledge = await tx.doc(KnowledgeDoc,scopeKey(host.scope),host.scope);
        const fact = source === "environment" ? knowledge.environment.facts.find(row => row.id === id) : knowledge.distiller.facts.find(row => row.spec.id === id);
        if (!fact) throw new Error("This fact no longer exists.");
        const claim = "spec" in fact ? fact.spec.injection ?? fact.spec.claim ?? fact.spec.id : environmentClaim(fact);
        if (fingerprint(claim) !== expectedClaim) throw new Error("This fact changed. Review the updated text before saving again.");
        knowledge.factReviews ??= {};
        knowledge.factReviews[factKey(source,id)] = {decision,claim:expectedClaim,at:clock(),note:redact(note).slice(0,500)};
        const selected = renderFacts(knowledge.environment,knowledge.distiller,host.scope.repository,options.policy(host),knowledge.factReviews);
        knowledge.render = selected.text;knowledge.renders = {environment:selected.environment,distilled:selected.distilled,ids:selected.ids};knowledge.injectedIds = selected.ids;
        const sessions = await tx.doc(SessionsDoc);
        for (const [key,row] of Object.entries(sessions.sessions)) if (scopeKey(row.scope) === scopeKey(host.scope) && row.ended === null && !row.factsSuppressed && emitting(policyFor(key))) {
          const permitted = renderFacts(knowledge.environment,knowledge.distiller,host.scope.repository,policyFor(key),knowledge.factReviews);
          row.section = factSection(permitted.text);row.injectedIds = permitted.ids;
        }
        const reviewed = describeKnowledge(knowledge.environment,knowledge.distiller,knowledge.factReviews).facts.find(row => row.source === source && row.id === id)!;
        await options.onOperation?.(tx,host.conversationId,{id:`fact-review:${factKey(source,id)}:${clock()}`,name:"optimizer.fact-review",status:"complete",startedAt:clock(),at:clock(),input:{decision},output:{facts:[reviewed]}});
      },BACKGROUND_CONTEXT);
    },
    async staleFacts(host:HostSession) {
      await options.harness().commit(async tx => {
        const knowledge = await tx.doc(KnowledgeDoc,scopeKey(host.scope),host.scope);knowledge.factReviews ??= {};
        for (const fact of knowledge.environment.facts) knowledge.factReviews[factKey("environment",fact.id)] = {decision:"stale",at:clock(),note:"Environment changed",claim:fingerprint(environmentClaim(fact))};
        for (const fact of knowledge.distiller.facts) knowledge.factReviews[factKey("distilled",fact.spec.id)] = {decision:"stale",at:clock(),note:"Environment changed",claim:fingerprint(fact.spec.injection ?? fact.spec.claim ?? fact.spec.id)};
        knowledge.render = "";knowledge.renders = {environment:"",distilled:"",ids:[]};knowledge.injectedIds = [];
        for (const row of Object.values((await tx.doc(SessionsDoc)).sessions)) if (scopeKey(row.scope) === scopeKey(host.scope)) {row.section="";row.injectedIds=[];}
        await options.onOperation?.(tx,host.conversationId,{id:`facts-stale:${clock()}`,name:"optimizer.fact-review",status:"complete",startedAt:clock(),at:clock(),input:{decision:"stale"},output:{facts:describeKnowledge(knowledge.environment,knowledge.distiller,knowledge.factReviews).facts}});
      },BACKGROUND_CONTEXT);
    },
    /** Subagents registered for a parent session, for status. */
    subagents(parent:HostSession) {return [...hosts.values()].filter(host => host.parent === parent.id && host.scope.host === parent.scope.host);},
    async proposals(host:HostSession) {return (await options.harness().snapshot(KnowledgeDoc,scopeKey(host.scope),BACKGROUND_CONTEXT))?.tools.proposal ?? [];},
    apply(host:HostSession,names:string[]) {return publication.apply({host,scope:host.scope,sessionKey:sessionKey(host.scope,host.id)},names,true);},
    restore(host:HostSession,names?:string[]) {return publication.restore(host,names);},
    async updatePolicy(retryModelCalls = false) {
      await queue.cancelDisabled();
      // Activity is not tracked while Off. Turning it on starts the quiet clock now, so open sessions aren't folded as stale.
      for (const [key,host] of hosts) {
        const now = observing(policyFor(key));
        if (now && observed.get(key) === false && conversations.get(host.conversationId) === host) await lifecycle.transcriptChanged(host);
        observed.set(key,now);
      }
      const scopes = new Map([...hosts.values()].map(host => [scopeKey(host.scope),host]));
      for (const [scope,host] of scopes) await options.harness().commit(async tx => {
        const knowledge = await tx.doc(KnowledgeDoc,scope,host.scope), sessions = await tx.doc(SessionsDoc);
        for (const [key,row] of Object.entries(sessions.sessions)) {
          if (scopeKey(row.scope) !== scope || row.ended !== null || row.factsSuppressed || !emitting(policyFor(key))) continue;
          const selected = renderFacts(knowledge.environment,knowledge.distiller,host.scope.repository,policyFor(key),knowledge.factReviews);
          row.section = factSection(selected.text);row.injectedIds = selected.ids;
        }
        const state = await tx.doc(ClassifiersDoc,scope,null), policy = options.policy(host), confidence = policy.thresholds.judge_confidence ?? scaledThresholds(policy.level).judge_confidence;
        let invalidated = false;
        for (const artifact of [state.loop?.identity,...state.tools.map(tool => tool.identity),...state.text]) {
          if (!artifact || artifact.state === "invalidated") continue;
          const loop = artifact.provenance.featureVersion === loopFeatureVersion, teacher = modelFor(policy,loop ? "loopJudge" : "toolJudge"), backend = artifact.provenance.backend === null ? null : modelFor(policy,loop ? "loopClassifier" : "toolClassifier");
          if (JSON.stringify(artifact.provenance.teacher) !== JSON.stringify(teacher) || JSON.stringify(artifact.provenance.backend) !== JSON.stringify(backend) || loop && artifact.provenance.labelPolicy !== `reference-loop-v1:${confidence}`) {artifact.state = "invalidated";artifact.bands = {spare:null,stuck:null,drop:null};artifact.invalidReason = "policy-provenance-changed";invalidated = true;}
        }
        if (invalidated) state.generation++;
      },BACKGROUND_CONTEXT);
      if (retryModelCalls) {const state = await options.harness().snapshot(JobsDoc,BACKGROUND_CONTEXT);for (const account of state?.paused ?? []) await queue.retry(account);}},
    rebuildClassifiers:training.rebuild,
    clearClassifiers:training.clear,
    reviewSample:training.review,
    /**
     * Optional summary of a stored tool output with the optimizer's model. Uses the shared queue, so budgets, redaction,
     * auth pauses and accounting apply. Returns null on any refusal, failure or timeout; callers fall back to a preview.
     */
    async summarizeOutput(conversationId:ConversationId,input:{id:string;tool:string;label:string;text:string;lines:number;bytes:number},timeoutMs:number):Promise<string|null> {
      const host = await resolve(conversationId);if (!host || host.delegated) return null;
      const key = sessionKey(host.scope,host.id), policy = policyFor(key), model = policy.generativeModel;
      if (!model || !inferenceAllowed(policy) || policy.offloadOutputs !== true || policy.outputSummaries !== true) return null;
      const expiresAt = clock()+timeoutMs, prompt = outputSummaryPrompt(input);
      const request = {id:`output-summary:${input.id}`,purpose:"output-summary" as const,model,prompt,maxOutputTokens:Math.min(400,policy.budget.maxOutputTokens),deadlineMs:Math.min(timeoutMs,policy.budget.deadlineMs)};
      const admission = await queue.enqueue(host.conversationId,request,{sessionKey:key,account:JSON.stringify([host.scope.host,model.provider]),runId:null,revision:fingerprint(JSON.stringify(policy)),digest:fingerprint(prompt),estimatedMaximumCost:null,expiresAt});
      const taskId = admission.job?.taskId;if (!taskId) return null;
      await options.harness().waitForTask(taskId,BACKGROUND_CONTEXT);
      const row = (await options.harness().snapshot(JobsDoc,BACKGROUND_CONTEXT))?.jobs[request.id];
      return row?.status === "complete" && row.result ? outputSummaryText(row.result.text) : null;
    },
    async retryModelCalls() {const state = await options.harness().snapshot(JobsDoc,BACKGROUND_CONTEXT);for (const account of state?.paused ?? []) await queue.retry(account);},
    drained:recorder.drained,
    async close() {await recorder.drained();detachObserver?.();detachObserver = null;},
  };
}
