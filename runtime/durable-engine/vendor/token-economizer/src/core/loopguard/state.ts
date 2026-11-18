// SPDX-License-Identifier: Apache-2.0
// Modified TypeScript port of Microsoft TokenEconomizer, revision 81e32e56bb3c4c1b4c9756b429be91e3960116ca; see ../../../LICENSE.
import { md5 } from "@noble/hashes/legacy.js";
import type { Observation } from "../types.ts";
import { sliceCodePoints } from "../ordering.ts";
import { pythonRound } from "./envelope.ts";
import type { SpiralSnapshot } from "./rules.ts";
export type SpiralState = {turns:number;edit_counts:Record<string,number>;edit_order:string[];error_outputs:number;test_runs:number;fail_sigs:Record<string,number>;repeated_fail_sigs:number;recent:string[]};
export function emptySpiral(): SpiralState {return {turns:0,edit_counts:{},edit_order:[],error_outputs:0,test_runs:0,fail_sigs:{},repeated_fail_sigs:0,recent:[]};}
export const referenceTests = /(runtests(\.py)?|\bpytest\b|py\.test|manage\.py\s+test|python\s+-m\s+unittest|\btox\b|\bnox\b|\btrial\b|python\d?\s+-c\b)/i;
const errors = /Traceback \(most recent call last\)|\b\w*Error\b|\bFAILED\b|\bassert\b|Exception|errors during collection|^# fail [1-9]|^not ok \d|\b[1-9]\d* (?:failing|failures?)\b|Failures: [1-9]/im;
export function errorMarker(text: string): boolean {return errors.test(text) || /^(?:--- FAIL: |FAIL\t|FAIL$)/m.test(text);}
export function basename(path: string): string {return path.replaceAll("\\","/").replace(/\/+$/,"").split("/").at(-1) ?? "";}
export function referenceFailureSignature(text: string): string | null {
  const first = text.split(/\r?\n/).find(errorMarker);if (first === undefined) return null;
  const normalized = first.replace(/0x[0-9a-f]+|\d+|\/\S+/g,"").trim();
  return Array.from(md5(new TextEncoder().encode(normalized)),byte => byte.toString(16).padStart(2,"0")).join("").slice(0,10);
}
export function spiralSignals(state: SpiralState): SpiralSnapshot {
  const failures = Object.values(state.fail_sigs).reduce((a,b) => a+b,0);
  return {turns:state.turns,edit_churn:Math.max(0,...Object.values(state.edit_counts)),distinct_edit_files:Object.keys(state.edit_counts).length,error_outputs:state.error_outputs,test_runs:state.test_runs,stagnation:failures ? state.repeated_fail_sigs/failures : 0,repeated_fail_sigs:state.repeated_fail_sigs};
}
export function spiralSnapshot(state: SpiralState): SpiralSnapshot {const signals = spiralSignals(state);return {...signals,stagnation:pythonRound(signals.stagnation,3)};}
const semanticAliases = new Map([["shell","bash"],["edit","edit"],["read","view"],["search","grep"]]);
export function canonicalTool(call: Observation): string {
  const aliases = new Map([["bash","bash"],["shell","bash"],["read","view"],["view","view"],["grep","grep"],["glob","glob"],["edit","edit"],["multiedit","edit"],["str_replace","edit"],["apply_patch","edit"],["write","create"],["create","create"]]);
  return aliases.get(call.tool.toLowerCase()) ?? (semanticAliases.get(call.semantic) ?? call.tool);
}
export function updateSpiral(prior: SpiralState,call: Observation,failed: boolean | null,shellEdits: string[] = [],verification = false): SpiralState {
  const state = structuredClone(prior);state.turns++;
  const tool = canonicalTool(call);let action = tool || "?";
  if (["edit","create"].includes(tool)) {
    const target = basename(call.targets[0] ?? "");if (target) {state.edit_order.push(target);state.edit_counts[target] = (state.edit_counts[target] ?? 0)+1;action = `edit ${target}`;}
  }
  if (tool === "bash" && call.command) {action = `$ ${sliceCodePoints(call.command.trim().replace(/\s+/g," "),0,90)}`;if (referenceTests.test(call.command)) state.test_runs++;}
  else if (["grep","glob"].includes(tool)) action = `${tool} ${sliceCodePoints(call.command,0,40)}`;
  else if (tool === "view") action = `view ${basename(call.targets[0] ?? "")}`;
  let signature: string | null = null;
  const canFail = ["view","grep","glob"].includes(tool) ? failed === true : failed !== false;
  if (call.output && canFail && errorMarker(call.output)) {
    state.error_outputs++;signature = referenceFailureSignature(call.output);
    if (signature) {if (Object.hasOwn(state.fail_sigs,signature)) state.repeated_fail_sigs++;state.fail_sigs[signature] = (state.fail_sigs[signature] ?? 0)+1;}
  }
  if (verification && !referenceTests.test(call.command)) state.test_runs++;
  state.recent.push(`${String(state.turns).padStart(3," ")}: ${action}${signature ? `  [err#${signature}]` : ""}`);
  for (const target of shellEdits) {state.edit_order.push(target);state.edit_counts[target] = (state.edit_counts[target] ?? 0)+1;}
  if (shellEdits.length) state.recent[state.recent.length-1] += `  [edits ${shellEdits.slice(0,4).join(", ")}${shellEdits.length > 4 ? ", ..." : ""}]`;
  state.recent = state.recent.slice(-40);return state;
}
export function recentDigest(state: SpiralState,envelope: number | null,verificationState: string): string {
  const snap = spiralSnapshot(state), failures = Object.values(state.fail_sigs).reduce((a,b) => a+b,0), stagnation = failures ? state.repeated_fail_sigs/failures : 0;
  let head = `turns=${state.turns} edit_churn=${snap.edit_churn} distinct_edit_files=${snap.distinct_edit_files} error_outputs=${state.error_outputs} test_runs=${state.test_runs} repeated_identical_failures=${state.repeated_fail_sigs} stagnation=${pythonRound(stagnation,2).toFixed(2)}`;
  if (envelope) head += `\nrepo_context: tasks here usually RESOLVE within ~${pythonRound(envelope)} turns; this trajectory is at ${state.turns} turns = ${pythonRound(state.turns/envelope,1).toFixed(1)}x that typical length. ${verificationState} A trajectory far past the typical resolved length with recurring failures is likely a dead-end loop, even if it touches many files.`;
  return head+"\nRecent actions (oldest->newest):\n"+state.recent.slice(-24).join("\n");
}
