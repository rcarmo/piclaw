// SPDX-License-Identifier: Apache-2.0
import type { ClassifyResult, Decision, LoopLabel, ToolLabel } from "../types.ts";
import type { ArtifactIdentity } from "./contracts.ts";
import { inApprovedBand } from "./thresholds.ts";
export function classificationScore(result: ClassifyResult,labels: string[],target: string): number | null {
  if (result.error || result.label === null || !labels.includes(result.label) || result.label === "uncertain") return null;
  const keys = Object.keys(result.probabilities);
  if (keys.length !== labels.length || labels.some(label => !Object.hasOwn(result.probabilities,label)) || keys.some(key => !labels.includes(key))) return null;
  const probabilities = Object.values(result.probabilities);
  if (probabilities.some(value => !Number.isFinite(value) || value < 0 || value > 1) || Math.abs(probabilities.reduce((a,b) => a+b,0)-1) > 1e-6) return null;
  return result.probabilities[target] ?? null;
}
export function loopDecision(score: number | null,artifact: ArtifactIdentity | null,authorizeStuck: boolean): Decision<LoopLabel> {
  if (score === null || !Number.isFinite(score)) return {kind:"abstain",reason:"invalid_output"};
  if (!artifact || artifact.state !== "active_bands") return {kind:"abstain",reason:"not_ready"};
  if (inApprovedBand(artifact.bands.spare,score)) return {kind:"label",label:"productive",rawScore:score,artifactId:artifact.id,reasons:["approved-spare-band"]};
  if (authorizeStuck && artifact.bands.stuck?.reviewed && inApprovedBand(artifact.bands.stuck,score)) return {kind:"label",label:"stuck",rawScore:score,artifactId:artifact.id,reasons:["reviewed-stuck-band"]};
  return {kind:"abstain",reason:"insufficient_evidence"};
}
export function toolDecision(score: number | null,artifact: ArtifactIdentity | null,allowDrop: boolean,inDomain: boolean): Decision<ToolLabel> {
  if (score === null || !Number.isFinite(score)) return {kind:"abstain",reason:"invalid_output"};
  if (score >= .5) return {kind:"label",label:"keep",rawScore:score,artifactId:artifact?.id ?? "keep-hint",reasons:["non-destructive-keep-hint"]};
  if (!inDomain) return {kind:"abstain",reason:"out_of_domain"};
  if (!artifact || artifact.state !== "active_bands") return {kind:"abstain",reason:"not_ready"};
  return allowDrop && artifact.bands.drop?.reviewed && inApprovedBand(artifact.bands.drop,score) ? {kind:"label",label:"drop_candidate",rawScore:score,artifactId:artifact.id,reasons:["reviewed-drop-band"]} : {kind:"abstain",reason:"insufficient_evidence"};
}
