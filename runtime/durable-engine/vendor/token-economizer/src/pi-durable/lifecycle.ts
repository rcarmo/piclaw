// SPDX-License-Identifier: Apache-2.0
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { defineExtension, defineTask, type Harness, type ConversationId, type JsonObject } from "@earendil-works/pi-durable";
import { describeKnowledge } from "../core/describe.ts";
import { emitting, observing, type Policy } from "../core/config.ts";
import { claimFold, deferFold, endSession, finishFold, prepareSession, recoverableSessions, sessionKey, transcriptChanged, type LearningSession } from "../core/sessions.ts";
import { scopeKey } from "../core/types.ts";
import { renderFacts, permittedFactSection } from "../core/microskills/render.ts";
import { KnowledgeDoc, ObservationsDoc, SessionsDoc, type Knowledge } from "./documents.ts";
import type { HostDomain, HostSession, SessionStart, Trajectory } from "./domain.ts";
import type { OperationSink, OptimizerOperation } from "./operations.ts";
export type FoldResult = Pick<Knowledge,"tools" | "render" | "injectedIds" | "environment" | "distiller"> & Partial<Pick<Knowledge,"novelty"|"renders">> & { learning?: NonNullable<LearningSession["learning"]> };
export type SessionFolder = (input: { session: LearningSession; host: HostSession; trajectory: Extract<Trajectory,{kind:"ready"}>; knowledge: Knowledge; policy: Policy; signal: AbortSignal; incremental?: boolean }) => Promise<FoldResult>;
export function createSessionLifecycle(options: { harness: () => Harness; backgroundOwner?:() => ConversationId; domain: HostDomain; policy: (key: string) => Policy; fold: SessionFolder; renderCached?:(text:string) => string; now?:() => number; onFolded?:(host:HostSession) => Promise<void>;onOperation?:OperationSink }) {
  const task = defineTask<{ key: string; host: HostSession; incremental?: boolean }, { phase: "fold" }, null>({
    name: "token-economizer.fold", version: 1, initial: () => ({ phase: "fold" }),
    phases: { async fold(current,runtime,context) {
      const { key,host,incremental } = current.input, claim = String(runtime.taskId);
      await runtime.commit(async tx => {
        const sessions = await tx.doc(SessionsDoc), knowledge = await tx.doc(KnowledgeDoc,scopeKey(host.scope),host.scope), row = sessions.sessions[key];
        if (!row || row.folded && !incremental || !observing(options.policy(key))) return;
        if (row.claim === claim) return;
        if (knowledge.foldClaim !== null || knowledge.foldQueue[0] !== key) return;
        const admitted = claimFold(row,claim,row.cutoff ?? "",runtime.now(),incremental);
        if (admitted.kind === "admitted") { sessions.sessions[key] = admitted.session; knowledge.foldClaim = claim; sessions.claims[key] = runtime.taskId; }
      },context);
      const session = (await runtime.snapshot(SessionsDoc,context))!.sessions[key];
      if (!session || session.folded && !incremental || !observing(options.policy(key))) {
        await runtime.commit(async tx => {
          const knowledge = await tx.doc(KnowledgeDoc,scopeKey(host.scope),host.scope), state = await tx.doc(SessionsDoc), row = state.sessions[key];
          if (row && row.claim === claim) state.sessions[key] = deferFold(row,claim,runtime.now(),incremental);
          if (knowledge.foldClaim === claim) knowledge.foldClaim = null;
          knowledge.foldQueue = knowledge.foldQueue.filter(item => item !== key);
          return {status:"terminal",outcome:{status:"completed",result:null}};
        },context); return;
      }
      if (session.claim !== claim) {
        await runtime.sleepUntil(runtime.now()+100,{phase:"fold"},context); return;
      }
      const trajectory = await options.domain.trajectory(host,session.cutoff || null,session.learning?.cutoff);
      if (trajectory.kind === "later") {
        await runtime.commit(async tx => {
          const sessions = await tx.doc(SessionsDoc), knowledge = await tx.doc(KnowledgeDoc,scopeKey(host.scope),host.scope);
          sessions.sessions[key] = deferFold(sessions.sessions[key],claim,runtime.now(),incremental); knowledge.foldClaim = null; knowledge.foldQueue = knowledge.foldQueue.filter(item => item !== key);
          return { status:"terminal",outcome:{status:"completed",result:null} };
        },context); return;
      }
      const startedAt = runtime.now();
      const activity:OptimizerOperation = {id:`learning:${key}:${claim}`,name:incremental ? "optimizer.learn" : "optimizer.fold",status:"running",startedAt,at:startedAt,
        input:{mode:options.policy(key).mode,from:session.learning?.cutoff ?? null,to:trajectory.kind === "ready" ? trajectory.cutoff : null,prompts:trajectory.kind === "ready" ? trajectory.prompts : null,
          observations:trajectory.kind === "ready" ? trajectory.observations.length : 0,
          evidence:trajectory.kind === "ready" ? trajectory.observations.slice(-16).map(call => ({tool:call.tool,command:call.command.slice(0,1024),output:call.output.slice(-1024),exitCode:call.exitCode,coverage:call.coverage})) : []},output:null};
      const show = trajectory.kind !== "ready" || trajectory.observations.length > 0 || !session.learning?.toolCounted && trajectory.prompts !== 0 && options.policy(key).pruning !== "off";
      let result: FoldResult | null = null;
      let before:Knowledge|null = null;
      if (trajectory.kind === "ready") {
        await runtime.commit(async tx => {
          (await tx.doc(SessionsDoc)).sessions[key].cutoff = trajectory.cutoff;
          if (show) await options.onOperation?.(tx,host.conversationId,activity);
        },context);
        const knowledge = await runtime.snapshot(KnowledgeDoc,scopeKey(host.scope),context);
        before = knowledge ?? null;
        try { result = await options.fold({ session,host,trajectory,knowledge:knowledge!,policy:options.policy(key),signal:runtime.signal,incremental }); }
        catch (error) {
          runtime.signal.throwIfAborted();
          const message = Error.isError(error) ? error.message : String(error);
          runtime.report(error);
          await runtime.commit(async tx => {
            const sessions = await tx.doc(SessionsDoc), knowledge = await tx.doc(KnowledgeDoc,scopeKey(host.scope),host.scope);
            const row = deferFold(sessions.sessions[key],claim,runtime.now(),incremental); row.foldError = message; sessions.sessions[key] = row;
            knowledge.foldClaim = null; knowledge.foldQueue = knowledge.foldQueue.filter(item => item !== key);
            if (show) await options.onOperation?.(tx,host.conversationId,{...activity,status:"failed",at:runtime.now(),output:{error:message}});
            return {status:"terminal",outcome:{status:"failed",error:{message}}};
          },context); return;
        }
      }
      await runtime.commit(async tx => {
        const sessions = await tx.doc(SessionsDoc), knowledge = await tx.doc(KnowledgeDoc,scopeKey(host.scope),host.scope), row = sessions.sessions[key];
        const previousSection = row.section;
        if (!observing(options.policy(key))) {
          sessions.sessions[key] = deferFold(row,claim,runtime.now(),incremental); knowledge.foldClaim = null;
        } else {
          if (result) { knowledge.tools = result.tools; knowledge.render = result.render; knowledge.injectedIds = result.injectedIds; knowledge.environment = result.environment; knowledge.distiller = result.distiller;if (result.novelty) knowledge.novelty = result.novelty;if (result.renders) knowledge.renders = result.renders; }
          // Re-render against CURRENT feedback, not the snapshot taken before the async fold.
          const selected = renderFacts(knowledge.environment,knowledge.distiller,host.scope.repository,options.policy(key),knowledge.factReviews);
          knowledge.render = selected.text;knowledge.renders = {environment:selected.environment,distilled:selected.distilled,ids:selected.ids};knowledge.injectedIds = selected.ids;
          // Knowledge is workspace-scoped: all attached On sessions receive the
          // current eligible set, while their initial provider prefix stays frozen.
          for (const [peerKey,peer] of Object.entries(sessions.sessions)) {
            if (scopeKey(peer.scope) !== scopeKey(host.scope) || peer.ended !== null || peer.factsSuppressed || !emitting(options.policy(peerKey))) continue;
            const published = renderFacts(knowledge.environment,knowledge.distiller,host.scope.repository,options.policy(peerKey),knowledge.factReviews);
            const previous = before && renderFacts(before.environment,before.distiller,host.scope.repository,options.policy(peerKey),knowledge.factReviews);
            if (previous?.text === published.text) continue;
            peer.section = options.renderCached ? options.renderCached(published.text) : published.text;peer.injectedIds = published.ids;
          }
          if (incremental) {
            row.claim = null;row.cutoff = null;row.recordActivity = runtime.now();
            const checkpoint = result?.learning ?? session.learning;
            if (checkpoint && trajectory.kind === "ready") row.learning = {...checkpoint,cutoff:trajectory.cutoff,processed:session.learning!.requested,finalRequested:row.learning?.finalRequested ?? false,requested:row.learning?.requested ?? checkpoint.requested,lastRun:row.learning?.lastRun ?? checkpoint.lastRun};
            row.foldError = trajectory.kind === "ready" ? null : trajectory.reason;
          } else {
            if (result?.learning) row.learning = result.learning;
            sessions.sessions[key] = finishFold(row,claim,runtime.now(),trajectory.kind === "unreadable" || trajectory.kind === "absent" ? trajectory.reason : null);
          }
          const observations = await tx.doc(ObservationsDoc,key,null);
          observations.observations = observations.observations.slice(-256);observations.ids = observations.ids.slice(-256);
          if (!incremental) knowledge.foldOrder.push(key); knowledge.foldClaim = null;
        }
        knowledge.foldQueue = knowledge.foldQueue.filter(item => item !== key);
        if (incremental && trajectory.kind === "ready" && observing(options.policy(key)) && (!row.folded && (row.ended !== null || row.learning?.finalRequested) || (row.learning?.requested ?? 0) > (row.learning?.processed ?? 0))) {
          knowledge.foldQueue.push(key);
          await tx.createTask(row.folded || row.ended === null && !row.learning?.finalRequested ? checkpointTask : task,{key,host,incremental:row.folded || row.ended === null && !row.learning?.finalRequested},{ownership:{kind:"conversation"},conversationId:options.backgroundOwner?.() ?? host.conversationId,background:true});
        }
        if (show) {
          const factRows = (source:Pick<Knowledge,"environment"|"distiller"|"factReviews">) => describeKnowledge(source.environment,source.distiller,source.factReviews).facts.map(fact => ({...fact,state:fact.source === "environment" ? source.environment.facts.find(row=>row.id===fact.id)!.life.state : source.distiller.facts.find(row=>row.spec.id===fact.id)!.life.state}));
          const previous = new Map(before ? factRows(before).map(fact => [fact.id,fact]) : []), current = result ? factRows(knowledge) : [];
          const changes = {
            facts:current.filter(fact => {const old = previous.get(fact.id);return !old || old.state !== fact.state || old.status !== fact.status || old.claim !== fact.claim;}),
            suggestedTools:result?.tools.proposal.filter(name => !before?.tools.proposal.includes(name)) ?? [],
            withdrawnTools:before?.tools.proposal.filter(name => result && !result.tools.proposal.includes(name)) ?? [],
          };
          const output:JsonObject = result ? {
            environmentFacts:result.environment.facts.length,distilledFacts:result.distiller.facts.length,
            newFacts:current.filter(fact => !previous.has(fact.id)).map(fact => fact.id),
            facts:current.slice(-40),changes,learning:result.learning?.lastCheck ?? null,
            toolSuggestions:result.tools.proposal,hiddenTools:result.tools.applied,sessions:result.tools.sessions,prompts:result.tools.prompts,
            activeFactsChanged:previousSection !== row.section,
          } : {error:trajectory.kind === "ready" ? "No learning result" : trajectory.reason};
          await options.onOperation?.(tx,host.conversationId,{...activity,status:!observing(options.policy(key)) ? "cancelled" : result ? "complete" : "failed",at:runtime.now(),output});
        }
        return { status:"terminal",outcome:{status:"completed",result:null} };
      },context);
      if (observing(options.policy(key))) await options.onFolded?.(host);
    } },
    async abort(current,runtime,context) {
      await runtime.commit(async tx => {
        const sessions = await tx.doc(SessionsDoc), row = sessions.sessions[current.input.key];
        const knowledge = await tx.doc(KnowledgeDoc,scopeKey(current.input.host.scope),current.input.host.scope);
        if (row?.claim === String(runtime.taskId)) sessions.sessions[current.input.key] = deferFold(row,String(runtime.taskId),runtime.now(),current.input.incremental);
        if (knowledge.foldClaim === String(runtime.taskId)) knowledge.foldClaim = null;
        knowledge.foldQueue = knowledge.foldQueue.filter(item => item !== current.input.key);
        await options.onOperation?.(tx,current.input.host.conversationId,{id:`learning:${current.input.key}:${runtime.taskId}`,name:current.input.incremental ? "optimizer.learn" : "optimizer.fold",status:"cancelled",startedAt:row?.recordActivity ?? runtime.now(),at:runtime.now(),input:{},output:{error:"Learning cancelled"}});
        return {status:"terminal",outcome:{status:"aborted",result:null,reason:"Fold cancelled"}};
      },context);
    },
  });
  // A separate kind keeps older apps from interpreting a live checkpoint as a session end.
  const checkpointTask = defineTask({...task.definition,name:"token-economizer.checkpoint"});
  async function enqueue(key: string,host: HostSession,incremental = false) {
    await options.harness().commit(async tx => {
      const row = (await tx.doc(SessionsDoc)).sessions[key], knowledge = await tx.doc(KnowledgeDoc,scopeKey(host.scope),host.scope);
      if (!row || row.folded && !incremental || row.claim || knowledge.foldQueue.includes(key) || !observing(options.policy(key))) return;
      knowledge.foldQueue.push(key);
      await tx.createTask(incremental ? checkpointTask : task,{key,host,incremental},{ownership:{kind:"conversation"},conversationId:options.backgroundOwner?.() ?? host.conversationId,background:true});
    },BACKGROUND_CONTEXT);
  }
  async function requestCheckpoint(host:HostSession,runId:string|null) {
      if (!options.domain.incrementalLearning || host.delegated || host.parent || !observing(options.policy(sessionKey(host.scope,host.id)))) return;
      const key = sessionKey(host.scope,host.id);
      const changed = await options.harness().commit(async tx => {
        const row = (await tx.doc(SessionsDoc)).sessions[key];
        if (!row || row.ended !== null || runId !== null && row.learning?.lastRun === runId) return false;
        if (!row.learning) {
          // Legacy folded journals lack per-fact credits. Conservatively protect all existing facts
          // from gaining another independent vote from this same logical session.
          const knowledge = await tx.doc(KnowledgeDoc,scopeKey(host.scope),host.scope);
          const credited = row.folded ? [...knowledge.environment.facts.map(fact => `env:${fact.id}`),...knowledge.distiller.facts.map(fact => `fact:${fact.spec.id}`)] : [];
          row.learning = {cutoff:row.folded ? row.cutoff : null,credits:{confirms:[...credited],contradicts:[],exercises:[...credited]},ticks:0,lastProposalAt:null,requested:0,processed:0,lastRun:null,toolCounted:row.folded};
        }
        if (row.folded && !row.claim) row.cutoff = null;
        if (row.folded) row.learning.finalRequested = false;
        row.learning.requested++;if (runId !== null) row.learning.lastRun = runId;return true;
      },BACKGROUND_CONTEXT);
      if (changed) await enqueue(key,host,true);
  }
  return {
    extension: defineExtension({name:"token-economizer.sessions",tasks:[task,checkpointTask]}),
    async sessionStarted(host: HostSession,start: SessionStart & { carriedIds: string[] }) {
      if (host.delegated) return null;
      const key = sessionKey(host.scope,host.id), now = (options.now ?? Date.now)();
      const prepared = await options.harness().commit(async tx => {
        const state = await tx.doc(SessionsDoc), knowledge = await tx.doc(KnowledgeDoc,scopeKey(host.scope),host.scope), policy = options.policy(key);
        const mode = policy.enabled ? policy.mode : "off";
        const selected = renderFacts(knowledge.environment,knowledge.distiller,host.scope.repository,policy,knowledge.factReviews), cached = selected.text;
        const refresh = state.sessions[key] !== undefined && emitting(policy);
        const row = prepareSession(state.sessions[key] ?? null,{id:host.id,scope:host.scope,conversation:String(host.conversationId),group:host.classificationGroup,now,
          ...start,cachedSection:policy.microSkills === "off" ? "" : options.renderCached ? options.renderCached(cached) : cached,cachedIds:selected.ids,publishedMask:start.runningMask ?? knowledge.tools.applied,mode});
        row.section = row.factsSuppressed ? "" : refresh ? (options.renderCached ? options.renderCached(cached) : cached) : permittedFactSection(row.section,knowledge.environment,knowledge.distiller,host.scope.repository,policy,knowledge.factReviews);
        if (refresh && !row.factsSuppressed) row.injectedIds = selected.ids;
        if (!row.section) row.injectedIds = [];
        if (start.learningAfter !== undefined && !row.learning && !row.folded) row.learning = {cutoff:start.learningAfter,credits:{confirms:[],contradicts:[],exercises:[]},ticks:0,lastProposalAt:null,requested:0,processed:0,lastRun:null};
        state.sessions[key] = row; state.hosts[key] = structuredClone(host); return structuredClone(row);
      },BACKGROUND_CONTEXT);
      // The fresh snapshot is frozen before recovery can change the repository render.
      await options.harness().commit(async tx => {
        const state = await tx.doc(SessionsDoc);
        for (const [sessionId,taskId] of Object.entries(state.claims)) {
          const row = state.sessions[sessionId];if (!row) throw new Error("Missing claimed learning session");if (!row.claim) {delete state.claims[sessionId];continue;}
          const owner = await tx.task(taskId);if (!owner) throw new Error("Missing durable fold claim owner");
          if (owner.state.status !== "terminal") continue;
          const knowledge = await tx.doc(KnowledgeDoc,scopeKey(row.scope),row.scope), released = deferFold(row,row.claim,(options.now ?? Date.now)(),row.folded);
          if (knowledge.foldClaim !== row.claim) throw new Error("Repository fold claim ownership mismatch");
          released.foldError = owner.state.outcome.status === "failed" || owner.state.outcome.status === "faulted" ? owner.state.outcome.error.message : "Fold ended without its marker";
          state.sessions[sessionId] = released;knowledge.foldClaim = null;knowledge.foldQueue = knowledge.foldQueue.filter(item => item !== sessionId);delete state.claims[sessionId];
        }
      },BACKGROUND_CONTEXT);
      const state = await options.harness().snapshot(SessionsDoc,BACKGROUND_CONTEXT);
      for (const row of recoverableSessions(Object.values(state!.sessions),host.scope,host.id,now)) {
        const source = state!.hosts[sessionKey(row.scope,row.id)];
        if (!source) throw new Error("Missing pinned learning session host");
        await enqueue(sessionKey(row.scope,row.id),source,options.domain.incrementalLearning === true && row.learning !== undefined && !row.learning.finalRequested && row.ended === null);
      }
      return prepared;
    },
    async runCompleted(host:HostSession,runId:string) {await requestCheckpoint(host,runId);},
    async sessionEnded(host: HostSession) {
      if (host.delegated) return;
      const key = sessionKey(host.scope,host.id);
      const prior = (await options.harness().snapshot(SessionsDoc,BACKGROUND_CONTEXT))?.sessions[key];
      if (prior?.folded && options.domain.incrementalLearning) await requestCheckpoint(host,null);
      if (!prior) {
        const source = await options.domain.trajectory(host,null);if (source.kind === "absent") return;
        await options.harness().commit(async tx => {
          const state = await tx.doc(SessionsDoc);if (state.sessions[key]) return;
          state.sessions[key] = prepareSession(null,{id:host.id,scope:host.scope,conversation:String(host.conversationId),group:host.classificationGroup,now:(options.now ?? Date.now)(),event:"resume",visibleHistory:true,carriedSections:{},carriedIds:[],cachedSection:"",cachedIds:[],publishedMask:[],mode:"off"});state.hosts[key] = host;
        },BACKGROUND_CONTEXT);
      }
      const exists = await options.harness().commit(async tx => {
        const state = await tx.doc(SessionsDoc), row = state.sessions[key];
        if (!row) return false;
        if (row.learning && !row.folded) row.learning.finalRequested = true;
        state.sessions[key] = endSession(row,(options.now ?? Date.now)()); return true;
      },BACKGROUND_CONTEXT);
      if (exists) await enqueue(key,host,Boolean(prior?.folded && options.domain.incrementalLearning));
    },
    async transcriptChanged(host: HostSession,at = (options.now ?? Date.now)()) {
      const key = sessionKey(host.scope,host.id);
      await options.harness().commit(async tx => {
        const state = await tx.doc(SessionsDoc), row = state.sessions[key];
        if (row) {const next = transcriptChanged(row,Math.max(row.transcriptActivity,at));next.recordActivity = (options.now ?? Date.now)();state.sessions[key] = next;}
      },BACKGROUND_CONTEXT);
    },
    async observations(key: string) { return (await options.harness().snapshot(ObservationsDoc,key,BACKGROUND_CONTEXT))?.observations ?? []; },
  };
}
