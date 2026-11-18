// SPDX-License-Identifier: Apache-2.0
import { failureIdentity, observationWindow } from "../observations.ts";
import { fingerprint } from "../identity.ts";
import type { Observation } from "../types.ts";
export const loopFeatureVersion = "loop-v1";
export type LoopContext = {repositoryRoot:string;calls:number;callsSinceGreen:number;callsSinceNewFailure:number|null;p90:number|null};
export type LoopFeatures = {kind:"features";values:number[]} | {kind:"abstain";reason:string};
export function loopFeatures(observations: Observation[],context: LoopContext): LoopFeatures {
  const window = observationWindow(observations,32);
  if (!window.observations.length) return {kind:"abstain",reason:"empty-window"};
  if (window.coverage !== "complete" || window.observations.some(call => call.outcome === "unknown" || call.outcome === "aborted")) return {kind:"abstain",reason:"incomplete-window"};
  const calls = window.observations, n = calls.length, failures = calls.filter(call => call.outcome === "failure" || call.outcome === "timedOut"), f = failures.length;
  const signatures = new Map<string,number>();
  for (const call of failures) {const exact = failureIdentity(call,context.repositoryRoot);if (exact === null) return {kind:"abstain",reason:"missing-failure-identity"};const key = fingerprint(exact);signatures.set(key,(signatures.get(key) ?? 0)+1);}
  const edits = calls.filter(call => (call.semantic === "edit" || call.semantic === "shell") && call.targets.length > 0), targets = new Map<string,number>();
  for (const call of edits) for (const path of new Set(call.targets)) targets.set(path,(targets.get(path) ?? 0)+1);
  const values = [Math.log1p(context.callsSinceGreen),f/n,calls.filter(call => call.outcome === "timedOut").length/n,failures.filter(call => call.exitCode === null && call.outcome !== "timedOut").length/n,
    f ? signatures.size/f : 0,f ? Math.max(0,...signatures.values())/f : 0,edits.length/n,edits.length ? Math.max(0,...targets.values())/edits.length : 0,Math.log1p(targets.size),
    context.callsSinceNewFailure === null ? 0 : Math.log1p(context.callsSinceNewFailure),context.p90 === null ? 0 : context.calls/context.p90,context.p90 === null ? 1 : 0,calls.filter(call => call.nested).length/n,calls.filter(call => call.readOnly).length/n];
  return values.every(Number.isFinite) && values.every(value => value >= 0) ? {kind:"features",values} : {kind:"abstain",reason:"invalid-feature-context"};
}
