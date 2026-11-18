// SPDX-License-Identifier: Apache-2.0
import { fingerprint } from "../identity.ts";
import { compareCodePoints } from "../ordering.ts";
import type { ArtifactIdentity, Bands, Provenance, Sample } from "./contracts.ts";
import { textInDomain, fitVocabulary } from "./text.ts";
import { chronologicalSplit } from "./samples.ts";
import { acceptBand, selectBand } from "./thresholds.ts";
import { fitLogistic, logisticScore, type LogisticModel, type LogisticFit } from "./logistic.ts";
import { bernoulliScore, fitBernoulli, type BernoulliModel } from "./bernoulli.ts";
export type LoopArtifact = {identity:ArtifactIdentity;model:LogisticModel|null};
export type ToolArtifact = {identity:ArtifactIdentity;tool:string;model:BernoulliModel|null};
export function compatible(samples: Sample[],provenance: Provenance): Sample[] {
  return samples.filter(row => row.scope === provenance.scope && row.featureVersion === provenance.featureVersion && row.labelPolicy === provenance.labelPolicy && row.catalogueRevision === provenance.catalogueRevision && row.environmentRevision === provenance.environmentRevision && JSON.stringify(row.teacher) === JSON.stringify(provenance.teacher)).sort((a,b) => a.at-b.at || compareCodePoints(a.id,b.id));
}
export function provenanceMatches(provenance:Provenance,sample:Sample,backend:Provenance["backend"]):boolean {
  return compatible([sample],provenance).length === 1 && JSON.stringify(provenance.backend) === JSON.stringify(backend);
}
function identity(provenance: Provenance,split: ReturnType<typeof chronologicalSplit>,bands: Bands,reason: string|null,payload: string): ArtifactIdentity {
  const groups = (rows: Sample[]) => [...new Set(rows.map(row => row.group))];
  return {id:fingerprint(payload),provenance,state:reason ? "collecting" : [bands.spare,bands.stuck,bands.drop].some(band => band?.approved) ? "active_bands" : "observe_only",fitGroups:groups(split.fit),selectionGroups:groups(split.selection),acceptanceGroups:groups(split.acceptance),bands,invalidReason:reason};
}
export function fitLoopArtifact(samples: Sample[],provenance: Provenance,usedAcceptanceGroups: string[] = [],pretrained?:LogisticFit): LoopArtifact {
  const split = chronologicalSplit(compatible(samples,provenance).filter(row => row.kind === "loop"));split.acceptance = split.acceptance.filter(row => !usedAcceptanceGroups.includes(row.group));
  const fit = pretrained ?? fitLogistic(split.fit), bands: Bands = {spare:null,stuck:null,drop:null};
  if (fit.kind === "unready") return {identity:identity(provenance,split,bands,fit.reason,JSON.stringify([provenance,fit.reason])),model:null};
  const score = (rows: Sample[]) => rows.map(sample => ({sample,score:logisticScore(fit.model,sample.features) ?? NaN})), selection = score(split.selection), acceptance = score(split.acceptance);
  bands.spare = acceptBand(selectBand(selection,"low",.05),acceptance,false);bands.stuck = acceptBand(selectBand(selection,"high",.01),acceptance,true);
  if (bands.spare && bands.stuck && bands.spare.threshold >= bands.stuck.threshold) bands.stuck = null;
  return {identity:identity(provenance,split,bands,null,JSON.stringify([provenance,fit.model,bands,split.fit.map(row => row.id),split.selection.map(row => row.id),split.acceptance.map(row => row.id)])),model:fit.model};
}
export function fitToolArtifact(samples: Sample[],provenance: Provenance,tool: string,usedAcceptanceGroups: string[] = []): ToolArtifact {
  const split = chronologicalSplit(compatible(samples,provenance).filter(row => row.kind === "tool"));
  for (const key of ["fit","selection","acceptance"] as const) split[key] = split[key].filter(row => row.tool === tool && (key !== "acceptance" || !usedAcceptanceGroups.includes(row.group)));
  const fit = fitBernoulli(split.fit), bands: Bands = {spare:null,stuck:null,drop:null};
  if (fit.kind === "unready") return {tool,identity:identity(provenance,split,bands,fit.reason,JSON.stringify([provenance,tool,fit.reason])),model:null};
  const score = (rows: Sample[]) => rows.map(sample => {const value = textInDomain({tokens:sample.tokens,omitted:!sample.complete},fit.model.vocabulary) ? bernoulliScore(fit.model,sample.tokens) : NaN;return {sample,score:value < .5 ? value : NaN};});
  bands.drop = acceptBand(selectBand(score(split.selection),"low",.005),score(split.acceptance),true);
  return {tool,identity:identity(provenance,split,bands,null,JSON.stringify([provenance,tool,fit.model,bands,split.fit.map(row => row.id),split.selection.map(row => row.id),split.acceptance.map(row => row.id)])),model:fit.model};
}
export function textClassifierArtifact(samples: Sample[],provenance: Provenance,scores: Record<string,number>,tool: string|null,usedAcceptanceGroups: string[] = []): ArtifactIdentity {
  const split = chronologicalSplit(compatible(samples,provenance).filter(row => JSON.stringify(row.classifier) === JSON.stringify(provenance.backend) && (tool === null ? row.kind === "loop" : row.kind === "tool" && row.tool === tool)));
  split.acceptance = split.acceptance.filter(row => !usedAcceptanceGroups.includes(row.group));
  const vocabulary = tool === null ? [] : fitVocabulary(split.fit);
  const scored = (rows: Sample[]) => rows.map(sample => ({sample,score:Object.hasOwn(scores,sample.id) && (tool === null || scores[sample.id] < .5 && textInDomain({tokens:sample.tokens,omitted:!sample.complete},vocabulary)) ? scores[sample.id] : NaN})), bands: Bands = {spare:null,stuck:null,drop:null};
  if (tool === null) {bands.spare = acceptBand(selectBand(scored(split.selection),"low",.05),scored(split.acceptance),false);bands.stuck = acceptBand(selectBand(scored(split.selection),"high",.01),scored(split.acceptance),true);if (bands.spare && bands.stuck && bands.spare.threshold >= bands.stuck.threshold) bands.stuck = null;}
  else bands.drop = acceptBand(selectBand(scored(split.selection),"low",.005),scored(split.acceptance),true);
  const artifact = identity(provenance,split,bands,null,JSON.stringify([provenance,tool,bands,split.fit.map(row => row.id),split.selection.map(row => row.id),split.acceptance.map(row => row.id),vocabulary]));
  artifact.tool = tool;
  if (tool !== null) artifact.vocabulary = vocabulary;
  return artifact;
}
