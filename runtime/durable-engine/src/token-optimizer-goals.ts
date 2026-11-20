// Kintsugi 4afeac1e MIT port; see mcp/UPSTREAM-LICENSE.
const isDurableUserEntry=(entry:import("@earendil-works/pi-durable").EntryRecord)=>entry.kind==="pi.user"||entry.kind==="host.accepted";
import { contentText, type Message } from "@earendil-works/pi-ai";
import { CompactionEntry, ResetEntry, GenerationTask, LiveDoc, defineDoc, defineEntry, defineExtension, hook, type ConversationId, type Harness } from "@earendil-works/pi-durable";
import { consumeDecision, decisionText, emptyGuard, fingerprint, goalAdvice, observing, oversightPolicy, sessionKey, type GoalPlan, type JudgeGoal, type Policy } from "#token-optimizer/core";
import { ObservationsDoc, RunDoc, detach, runIdentity, type HostSession } from "#token-optimizer/pi-durable";
import { recordOptimizerOperation } from "./token-optimizer-operations.ts";
export const GoalContextEntry = defineEntry<{id:string;text:string}>("piclaw.token-optimizer.goal-context");
type GoalMemo = {text:string;planBinding?:string};
const GoalState = defineDoc<{epoch:string;task:string;taskId:string;runId:string|null;lastAt:number;lastCount:number;seen:string[];compaction:string|null;requestKey:string;requestText:string|null}>({kind:"piclaw.token-optimizer.goal-state",version:1,scope:"conversation",history:"latest",fork:"initial",initial:() => ({epoch:"",task:"",taskId:"",runId:null,lastAt:0,lastCount:0,seen:[],compaction:null,requestKey:"",requestText:null}),checkpointWhen:() => false});
export function createOptimizerGoalsExtension(options:{harness:() => Harness;host:(id:ConversationId) => Promise<HostSession|null>;policy:(host:HostSession) => Policy;plan:(host:HostSession) => Promise<GoalPlan|null>;goal?:(host:HostSession) => Promise<{plan:JudgeGoal;task:string}|null>;drained:() => Promise<void>;now?:() => number}) {
  const now = options.now ?? Date.now;
  return defineExtension({name:"piclaw.optimizer-goals",hooks:[hook(GenerationTask,{
    async beforeRequest(request,api,context) {
      // Older entries carried a user-shaped message in the durable model history.
      // Match the actual committed entry, not a prefix a real user could type.
      let messages = request.messages;
      if (messages.some(message=>message.role === "user" && contentText(message.content).startsWith("Task check (automated, advisory):"))) {
        const prior = (await api.entries({order:"descending"},128,undefined,context)).items.filter(GoalContextEntry.is);
        const keys = new Set(prior.flatMap(entry=>(entry.model ?? []).flatMap(message=>message.role === "user" ? [JSON.stringify([message.timestamp,contentText(message.content)])] : [])));
        messages = messages.filter(message=>message.role !== "user" || !keys.has(JSON.stringify([message.timestamp,contentText(message.content)])));
      }
      const host = await options.host(api.conversationId);if (!host || host.delegated) return {messages};
      const policy = oversightPolicy(options.policy(host));if (!observing(policy) || !policy.goalChecks) return {messages};
      await options.drained();
      const key = `goal-request:${api.taskId}:${messages.length}:${fingerprint(JSON.stringify(messages.at(-1) ?? null))}`;
      async function deliver(saved:GoalMemo|null) {
        if (!saved) return {messages};
        if (saved.planBinding) {
          if (!options.policy(host!).sharePlanWithJudge) return {messages};
          const goal = await options.goal?.(host!);
          if (!goal || fingerprint(JSON.stringify(goal)) !== saved.planBinding || !options.policy(host!).sharePlanWithJudge) return {messages};
        }
        const current = oversightPolicy(options.policy(host!));
        return append(messages,current.mode === "active" && current.goalChecks === true ? saved.text : undefined);
      }
      const previous = await api.memo<GoalMemo|null>(key,context);
      if (previous !== undefined) return deliver(previous);
      const live = await api.snapshot(LiveDoc,api.conversationId,context), runId = live?.run && !live.run.afterRun ? runIdentity(live.run) : null;
      if (!runId) {await api.memo(key,null,context);return {messages};}
      const entries = (await api.entries({order:"descending"},256,undefined,context)).items;
      const boundary = entries.findIndex(entry => ResetEntry.is(entry));
      const visible = boundary < 0 ? entries : entries.slice(0,boundary);
      const user = visible.find(isDurableUserEntry), compact = visible.find(CompactionEntry.is);
      const userText = user?.model?.filter(message => message.role === "user").map(message => contentText(message.content)).join("\n") ?? "";
      const plan = await options.plan(host), calls = (await api.snapshot(ObservationsDoc,sessionKey(host.scope,host.id),context))?.observations.filter(call => call.runId === runId) ?? [];
      const wanted = (await api.snapshot(RunDoc,sessionKey(host.scope,host.id),context))?.guard?.held;
      const boundGoal = wanted?.reason === "goal-drift" && policy.sharePlanWithJudge ? await options.goal?.(host) : null;
      const chosen = await options.harness().commit(async tx => {
        const current = await tx.doc(LiveDoc,api.conversationId);
        if (!current.run || current.run.afterRun || runIdentity(current.run) !== runId || JSON.stringify(current.run.inputs) !== JSON.stringify(live?.run?.inputs) || !observing(oversightPolicy(options.policy(host))) || !options.policy(host).goalChecks) return null;
        const state = await tx.doc(GoalState,api.conversationId);
        if (state.requestKey === key) return state.requestText ? {text:state.requestText} : null;
        state.requestKey = key;state.requestText = null;
        if (state.epoch !== host.id) {state.epoch = host.id;state.task = "";state.taskId = "";state.compaction = null;state.runId = null;}
        if (state.runId !== runId) {state.runId = runId;state.seen = [];state.lastAt = 0;state.lastCount = 0;}
        if (user && String(user.id) !== state.taskId) {state.task = userText.slice(0,4000);state.taskId = String(user.id);}
        const compacted = Boolean(compact && (!user || compact.id > user.id) && String(compact.id) !== state.compaction);
        const run = await tx.doc(RunDoc,sessionKey(host.scope,host.id),null);
        if (!run.guard || run.guard.runId !== runId) {run.guard = emptyGuard(runId);run.inputs = [...current.run.inputs];run.closed = false;}
        const guard = run.guard, held = guard.held?.reason === "goal-drift" ? guard.held : null;
        const stamp = boundGoal && boundGoal.task === JSON.stringify([runId,current.run.inputs]) ? fingerprint(JSON.stringify([boundGoal.plan,current.run.inputs,guard.edits,guard.cum_turns-guard.callsSinceGreen])) : null;
        const judged = held && stamp !== null && stamp === held.goalStamp && options.policy(host).sharePlanWithJudge === true ? held : null;
        const advice = judged ? {reason:"goal-drift",text:decisionText(guard)} : goalAdvice({id:state.taskId,text:state.task,plan},calls,compacted);
        if (held && !judged) {guard.held = null;const previous = run.decisions.find(row => row.id === held.id);if (previous) previous.status = "undelivered";}
        if (!advice) return null;
        const signature = fingerprint(JSON.stringify([state.taskId,advice.reason,plan?.revision ?? 0,compacted ? compact?.id : null]));
        if (state.seen.includes(signature) || state.lastAt && (now()-state.lastAt < 60_000 || calls.length-state.lastCount < 8)) return null;
        if (guard.nudges_done >= options.policy(host).redirects) return null;
        const active = oversightPolicy(options.policy(host)).mode === "active", id = judged?.id ?? `goal:${runId}:${signature}`, at = now();
        state.seen = [...state.seen,signature].slice(-32);state.lastAt = at;state.lastCount = calls.length;if (compact) state.compaction = String(compact.id);
        if (judged) run.guard = consumeDecision(detach(guard));
        else guard.nudges_done++;
        const record = {id,runId,action:"redirect" as const,mode:active ? "active" as const : "observe" as const,status:active ? "consumed" as const : "simulated" as const,submissionId:null,reason:advice.reason,text:advice.text,at};
        const existing = run.decisions.find(row => row.id === id);
        if (existing) Object.assign(existing,record);else run.decisions.push(record);
        // Persist the audit entry without replaying its model text in future rounds.
        if (active) await tx.appendEntry(GoalContextEntry,api.conversationId,{data:{id,text:advice.text}});
        await recordOptimizerOperation(tx,api.conversationId,{id,name:"optimizer.goal-check",status:"complete",startedAt:at,at,input:{mode:active ? "active" : "observe",runId,reason:advice.reason,taskEntry:state.taskId,planRevision:plan?.revision ?? null},output:{text:advice.text,delivery:active ? "consumed" : "simulated"}});
        state.requestText = active ? advice.text : null;
        if (!active) return null;
        const output:GoalMemo = {text:advice.text};
        if (judged && boundGoal) output.planBinding = fingerprint(JSON.stringify(boundGoal));
        return output;
      },context);
      // A retry can reuse the decision only while sending is still allowed.
      const saved = await api.memo(key,chosen,context);
      return deliver(saved);
    },
  })]});
}
function append(messages:readonly Message[],text:string|undefined) {
  return {messages:text && !messages.some(message => message.role === "user" && contentText(message.content) === text) ? [...messages,{role:"user" as const,content:text,timestamp:0}] : messages};
}
