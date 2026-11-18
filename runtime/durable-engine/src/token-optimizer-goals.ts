// Kintsugi b8469c29 MIT port; see mcp/UPSTREAM-LICENSE. Existing plans are context only.
const isDurableUserEntry=(entry:import("@earendil-works/pi-durable").EntryRecord)=>entry.kind==="pi.user"||entry.kind==="host.accepted";
import { contentText, type Message } from "@earendil-works/pi-ai";
import { CompactionEntry, ResetEntry, GenerationTask, LiveDoc, defineDoc, defineEntry, defineExtension, hook, type ConversationId, type Harness } from "@earendil-works/pi-durable";
import { emptyGuard, fingerprint, goalAdvice, observing, sessionKey, type GoalPlan, type Policy } from "#token-optimizer/core";
import { ObservationsDoc, RunDoc, detach, runIdentity, type HostSession } from "#token-optimizer/pi-durable";
import { recordOptimizerOperation } from "./token-optimizer-operations.ts";
export const GoalContextEntry = defineEntry<{id:string;text:string}>("piclaw.token-optimizer.goal-context");
const GoalState = defineDoc<{epoch:string;task:string;taskId:string;runId:string|null;lastAt:number;lastCount:number;seen:string[];compaction:string|null;requestKey:string;requestText:string|null}>({kind:"piclaw.token-optimizer.goal-state",version:1,scope:"conversation",history:"latest",fork:"initial",initial:() => ({epoch:"",task:"",taskId:"",runId:null,lastAt:0,lastCount:0,seen:[],compaction:null,requestKey:"",requestText:null}),checkpointWhen:() => false});
export function createOptimizerGoalsExtension(options:{harness:() => Harness;host:(id:ConversationId) => Promise<HostSession|null>;policy:(host:HostSession) => Policy;plan:(host:HostSession) => Promise<GoalPlan|null>;drained:() => Promise<void>;now?:() => number}) {
  const now = options.now ?? Date.now;
  return defineExtension({name:"piclaw.optimizer-goals",hooks:[hook(GenerationTask,{
    async beforeRequest(request,api,context) {
      const host = await options.host(api.conversationId);if (!host || host.delegated) return;
      const policy = options.policy(host);if (!observing(policy) || !policy.goalChecks) return;
      await options.drained();
      const key = `goal-request:${api.taskId}:${request.messages.length}:${fingerprint(JSON.stringify(request.messages.at(-1) ?? null))}`;
      const previous = await api.memo<{text:string}|null>(key,context);
      if (previous !== undefined) return append(request.messages,previous?.text);
      const live = await api.snapshot(LiveDoc,api.conversationId,context), runId = live?.run && !live.run.afterRun ? runIdentity(live.run) : null;
      if (!runId) {await api.memo(key,null,context);return;}
      const entries = (await api.entries({order:"descending"},256,undefined,context)).items;
      const boundary = entries.findIndex(entry => ResetEntry.is(entry));
      const visible = boundary < 0 ? entries : entries.slice(0,boundary);
      const user = visible.find(isDurableUserEntry), compact = visible.find(CompactionEntry.is);
      const userText = user?.model?.filter(message => message.role === "user").map(message => contentText(message.content)).join("\n") ?? "";
      const plan = await options.plan(host), calls = (await api.snapshot(ObservationsDoc,sessionKey(host.scope,host.id),context))?.observations.filter(call => call.runId === runId) ?? [];
      const chosen = await options.harness().commit(async tx => {
        const live = await tx.doc(LiveDoc,api.conversationId);
        if (!live.run || live.run.afterRun || runIdentity(live.run) !== runId || !observing(options.policy(host)) || !options.policy(host).goalChecks) return null;
        const state = await tx.doc(GoalState,api.conversationId);
        if (state.requestKey === key) return state.requestText ? {text:state.requestText} : null;
        state.requestKey = key;state.requestText = null;
        if (state.epoch !== host.id) {state.epoch = host.id;state.task = "";state.taskId = "";state.compaction = null;state.runId = null;}
        if (state.runId !== runId) {state.runId = runId;state.seen = [];state.lastAt = 0;state.lastCount = 0;}
        if (user && String(user.id) !== state.taskId) {state.task = userText.slice(0,4000);state.taskId = String(user.id);}
        const compacted = Boolean(compact && (!user || compact.id > user.id) && String(compact.id) !== state.compaction);
        const advice = goalAdvice({id:state.taskId,text:state.task,plan},calls,compacted);
        if (!advice) return null;
        const signature = fingerprint(JSON.stringify([state.taskId,advice.reason,plan?.revision ?? 0,compacted ? compact?.id : null]));
        if (state.seen.includes(signature) || state.lastAt && (now()-state.lastAt < 60_000 || calls.length-state.lastCount < 8)) return null;
        const run = await tx.doc(RunDoc,sessionKey(host.scope,host.id),null);
        if (!run.guard || run.guard.runId !== runId) {run.guard = emptyGuard(runId);run.inputs = [...live.run.inputs];run.closed = false;}
        // Both goal checks and loop redirects consume the existing per-prompt allowance.
        const used = run.decisions.filter(decision => decision.runId === runId && decision.action === "redirect" && decision.status !== "proposed").length;
        if (Math.max(used,run.guard.nudges_done) >= options.policy(host).redirects) return null;
        const active = options.policy(host).mode === "active", id = `goal:${runId}:${signature}`, at = now();
        state.seen = [...state.seen,signature].slice(-32);state.lastAt = at;state.lastCount = calls.length;if (compact) state.compaction = String(compact.id);
        run.guard.nudges_done++;
        run.decisions.push({id,runId,action:"redirect",mode:active ? "active" : "observe",status:active ? "consumed" : "simulated",submissionId:null,reason:advice.reason,text:advice.text,at});
        if (active) await tx.appendEntry(GoalContextEntry,api.conversationId,{data:{id,text:advice.text},model:[{role:"user",content:advice.text,timestamp:at}]});
        await recordOptimizerOperation(tx,api.conversationId,{id,name:"optimizer.goal-check",status:"complete",startedAt:at,at,input:{mode:active ? "active" : "observe",runId,reason:advice.reason,taskEntry:state.taskId,planRevision:plan?.revision ?? null},output:{text:advice.text,delivery:active ? "consumed" : "simulated"}});
        state.requestText = active ? advice.text : null;
        return active ? {text:advice.text} : null;
      },context);
      // A repeated hook reads its persisted decision; the context entry also prevents duplicate model text.
      const saved = await api.memo(key,chosen,context);
      return append(request.messages,saved?.text);
    },
  })]});
}
function append(messages:readonly Message[],text:string|undefined) {
  return {messages:text && !messages.some(message => message.role === "user" && contentText(message.content) === text) ? [...messages,{role:"user" as const,content:text,timestamp:0}] : messages};
}
