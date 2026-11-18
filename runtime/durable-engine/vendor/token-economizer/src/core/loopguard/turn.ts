// SPDX-License-Identifier: Apache-2.0
// Modified TypeScript port of Microsoft TokenEconomizer, revision 81e32e56bb3c4c1b4c9756b429be91e3960116ca; see ../../../LICENSE.
// Ported from TokenEconomizer loopguard/turn.py; asynchronous work is returned as an effect.
import type { Observation } from "../types.ts";
import { failureIdentity } from "../observations.ts";
import { fingerprint } from "../identity.ts";
import { assess, gateForJudge, isStuck, nudgeText, type JudgeVerdict, type Thresholds } from "./rules.ts";
import { canonicalTool, emptySpiral, errorMarker, recentDigest, spiralSignals, updateSpiral, type SpiralState } from "./state.ts";
import { shellEditTargets, shellRevertTargets } from "./shell-edits.ts";
import { runnerVerdict, statusOfTests } from "./verification.ts";
export type GuardDecision = {action:"redirect" | "notice";reason:string;id:string};
export type Guard = {
  runId:string;segment:number;st:SpiralState;whole:SpiralState;cum_turns:number;nudges_done:number;aborted:boolean;noticeDelivered:boolean;
  judge_last:number;judge_gap:number;judge_calls:number;last_edit:number;last_verify:number;last_verify_failed:boolean;edits:number;verifications:number;
  judge_pending:{id:string;since:number;segment:number}|null;nudge_ready:string|null;held:GuardDecision|null;seen:string[];window:Observation[];callsSinceGreen:number;sinceNewFailure:number|null;exactSignatures:string[];featureCoverage:boolean;
};
export function emptyGuard(runId: string): Guard {return {runId,segment:0,st:emptySpiral(),whole:emptySpiral(),cum_turns:0,nudges_done:0,aborted:false,noticeDelivered:false,judge_last:-999,judge_gap:5,judge_calls:0,last_edit:0,last_verify:0,last_verify_failed:false,edits:0,verifications:0,judge_pending:null,nudge_ready:null,held:null,seen:[],window:[],callsSinceGreen:0,sinceNewFailure:null,exactSignatures:[],featureCoverage:true};}
export function resolvedProxy(guard: Guard,normal: boolean): boolean {return normal && !guard.aborted && guard.cum_turns !== 0 && !(guard.last_verify_failed && guard.last_verify > guard.last_edit);}
export function verificationState(guard: Guard): string {return !guard.verifications ? "No test or verification run has been seen in this turn." : `The last verification run ${guard.last_verify_failed ? "failed" : "passed"}.${guard.last_edit > guard.last_verify ? " There have been edits since." : ""}`;}
export type BackgroundVerdict = {id:string;runId:string;segment:number;verdict:JudgeVerdict|null;writer:string|null};
export type GuardEffect = {id:string;runId:string;segment:number;digest:string};
export type GuardFold = {state:Guard;judge:GuardEffect|null;decision:GuardDecision|null};
export function foldGuard(prior: Guard,call: Observation,envelope: number | null,thresholds: Thresholds,mode: "off" | "rules" | "judge",budget: number,now: number,ready: BackgroundVerdict | null,runnerAvailable: boolean,repositoryRoot = ""): GuardFold {
  const state = structuredClone(prior);
  if (mode === "off" || state.seen.includes(call.id)) return {state,judge:null,decision:null};
  state.seen.push(call.id);state.window = [...state.window,call].slice(-32);
  state.callsSinceGreen = call.verification === "passed" ? 0 : state.callsSinceGreen+1;
  if (call.coverage !== "complete" || ["unknown","aborted"].includes(call.outcome)) state.featureCoverage = false;
  const exact = failureIdentity(call,repositoryRoot), signature = exact === null ? null : fingerprint(exact);
  if (signature && !state.exactSignatures.includes(signature)) {state.exactSignatures.push(signature);state.sinceNewFailure = 0;}
  else if (state.sinceNewFailure !== null) state.sinceNewFailure++;
  const shell = canonicalTool(call) === "bash", status = shell ? statusOfTests(call.command) : null;
  let exit = call.exitCode;
  if (status === "hidden" || status === "mixed") {const verdict = runnerVerdict(call.output);if (verdict !== null) exit = Number(verdict);else if (status === "hidden") exit = null;}
  const reverted = shell ? shellRevertTargets(call.command) : [], shellEdits = shell ? shellEditTargets(call.command).filter(file => !reverted.includes(file) || state.whole.edit_counts[file]) : [];
  const failed = exit === null ? call.outcome === "failure" || call.outcome === "timedOut" ? true : !shell && call.outcome === "success" ? false : null : exit !== 0;
  state.st = updateSpiral(state.st,call,failed,shellEdits,status !== null);state.whole = updateSpiral(state.whole,call,failed,shellEdits,status !== null);state.cum_turns++;
  if (["edit","create"].includes(canonicalTool(call))) {state.last_edit = state.cum_turns;state.edits++;}
  else {
    if (shellEdits.length) {state.last_edit = state.cum_turns-(status !== null ? 1 : 0);state.edits++;}
    if (status !== null) {state.last_verify = state.cum_turns;state.verifications++;state.last_verify_failed = exit !== null ? exit !== 0 : errorMarker(call.output);}
  }
  if (state.aborted || state.held || envelope === null) return {state,judge:null,decision:null};
  const thr = {...thresholds,gate_over_envelope:false,gate_min_turns:Math.max(thresholds.gate_min_turns,thresholds.min_turns)}, signals = spiralSignals(state.st);
  const decide = (reason: string): GuardFold => {
    const decision: GuardDecision = {action:state.nudges_done < budget ? "redirect" : "notice",reason,id:JSON.stringify([state.runId,state.segment,call.id,reason])};
    if (decision.action === "notice") state.aborted = true;
    state.held = decision;return {state,judge:null,decision};
  };
  if (state.cum_turns >= (thr.backstop_turns ?? envelope*thr.backstop_mult) && isStuck(signals,thr)) return decide("cum-backstop");
  if (mode === "rules") {const assessment = assess(signals,envelope,thr,null);return assessment.redirect ? decide(assessment.reason) : {state,judge:null,decision:null};}
  if (!gateForJudge(signals,thr)) return {state,judge:null,decision:null};
  const pending = state.judge_pending;
  if (pending && ready?.id === pending.id && ready.runId === state.runId && ready.segment === state.segment) {
    state.judge_pending = null;
    if (ready.verdict) state.nudge_ready = ready.writer?.trim() || null;
    state.judge_gap = ready.verdict?.stuck === false ? Math.min(20,state.judge_gap+5) : 5;
    const assessment = assess(signals,envelope,thr,{verdict:ready.verdict});
    if (assessment.redirect) return decide(assessment.reason);
    if (thr.nudge_on_ambiguous && assessment.reason === "judge-ambiguous-spared" && state.nudges_done < budget) return decide("ambiguous-past-envelope");
    return {state,judge:null,decision:null};
  }
  if (pending && now-pending.since < 300_000) return {state,judge:null,decision:null};
  state.judge_pending = null;
  if (state.st.turns-state.judge_last < state.judge_gap) return {state,judge:null,decision:null};
  state.judge_last = state.st.turns;state.judge_calls++;
  if (!runnerAvailable) return {state,judge:null,decision:null};
  const effect: GuardEffect = {id:JSON.stringify([state.runId,state.segment,state.judge_calls]),runId:state.runId,segment:state.segment,digest:recentDigest(state.st,envelope,verificationState(state))};
  state.judge_pending = {id:effect.id,since:now,segment:state.segment};return {state,judge:effect,decision:null};
}
export function decisionText(guard: Guard): string {return guard.nudge_ready ?? nudgeText(spiralSignals(guard.st),guard.st.edit_counts,guard.st.edit_order);}
/** Apply only at a live boundary, including a simulated Observe boundary; held replay does not spend. */
export function consumeDecision(prior: Guard): Guard {
  const state = structuredClone(prior);if (!state.held) return state;
  if (state.held.action === "redirect") {
    state.nudges_done++;state.segment++;state.st = emptySpiral();state.window = [];state.sinceNewFailure = null;state.exactSignatures = [];state.featureCoverage = true;state.judge_last = -999;state.judge_gap = 5;state.judge_pending = null;state.nudge_ready = null;
  } else state.noticeDelivered = true;
  state.held = null;return state;
}
