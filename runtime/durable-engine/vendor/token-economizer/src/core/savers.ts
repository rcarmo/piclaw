// SPDX-License-Identifier: Apache-2.0
import { fingerprint } from "./identity.ts";
import { failureIdentity } from "./observations.ts";
import type { ModelRef, Observation } from "./types.ts";
export type ReuseInput = {scope:string;runId:string;segment:number;sourceRange:string[];counters:number[];thresholdRevision:string;envelopeRevision:string;policyRevision:string;model:ModelRef|null;artifactId:string|null;digest:string};
export function reuseKey(input: ReuseInput): string {return fingerprint(JSON.stringify(input));}
export function auditSelected(scope: string,id: string,percent: number): boolean {
  if (percent < 0 || percent > 20 || !Number.isFinite(percent)) throw new Error("Invalid audit sampling percentage");
  return parseInt(fingerprint(JSON.stringify(["audit-v1",scope,id])).slice(0,8),16)/0x1_0000_0000 < percent/100;
}
export type CompactRun = {firstId:string;lastId:string;count:number;observation:Observation};
export function compactFailures(observations: Observation[],repositoryRoot: string): CompactRun[] {
  const result: CompactRun[] = [];
  for (const observation of observations) {
    const previous = result.at(-1), signature = failureIdentity(observation,repositoryRoot), eligible = signature !== null && observation.semantic !== "edit" && observation.targets.length === 0 && observation.verification === null;
    if (previous && eligible && previous.observation.semantic !== "edit" && previous.observation.targets.length === 0 && previous.observation.verification === null && failureIdentity(previous.observation,repositoryRoot) === signature) {previous.lastId = observation.id;previous.count++;}
    else result.push({firstId:observation.id,lastId:observation.id,count:1,observation});
  }
  return result;
}
export type NoveltyState = {seen:string[];lastSkip:number;skips:number};
export function noveltyGate(prior: NoveltyState,signals: string[],coverageComplete: boolean,now: number) {
  const key = JSON.stringify(signals), state = structuredClone(prior);
  if (!coverageComplete || key.length > 64_000) return {state,skip:false};
  if (state.seen.includes(key)) {state.lastSkip = now;state.skips++;return {state,skip:true};}
  state.seen = [...state.seen,key].slice(-256);return {state,skip:false};
}
/** Compact only the display tail; numerical state and the frozen observations never change. */
export function compactGuardDigest(digest:string,observations:Observation[],repositoryRoot:string):string {
  const marker = "Recent actions (oldest->newest):\n", offset = digest.indexOf(marker);if (offset < 0) return digest;
  const head = digest.slice(0,offset+marker.length), lines = digest.slice(offset+marker.length).split("\n"), source = observations.slice(-lines.length);
  if (source.length !== lines.length) return digest;
  const compacted = compactFailures(source,repositoryRoot).map(run => {
    const first = source.findIndex(call => call.id === run.firstId), last = source.findIndex(call => call.id === run.lastId);
    return run.count === 1 ? lines[first] : `${lines[first]} [repeated ${run.count}; first=${JSON.stringify(run.firstId)} last=${JSON.stringify(run.lastId)}; through action ${lines[last].split(":")[0]?.trim()}]`;
  });
  const result = head+compacted.join("\n");return result.length < digest.length ? result : digest;
}
