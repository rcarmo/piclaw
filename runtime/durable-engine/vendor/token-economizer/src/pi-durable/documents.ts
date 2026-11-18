// SPDX-License-Identifier: Apache-2.0
import { defineDoc, defineDocFamily, defineEntry, type SubmissionId, type TaskId, type ConversationId } from "@earendil-works/pi-durable";
import { emptyBudget, type BudgetState } from "../core/accounting.ts";
import { emptyEnvelope, type EnvelopeHistory } from "../core/loopguard/envelope.ts";
import { emptyEvidence, type ToolEvidence } from "../core/toolprune/evidence.ts";
import type { LearningSession } from "../core/sessions.ts";
import type { JudgeGoal } from "../core/goals.ts";
import type { HostSession } from "./domain.ts";
import { emptyEnvironment, type EnvironmentState } from "../core/microskills/envfacts.ts";
import { emptyDistiller, type Distiller } from "../core/microskills/distiller.ts";
import type { ArtifactIdentity, Sample } from "../core/classify/contracts.ts";
import type { LoopArtifact, ToolArtifact } from "../core/classify/artifacts.ts";
import type { BM25 } from "../core/classify/bm25.ts";
import type { Guard, BackgroundVerdict } from "../core/loopguard/turn.ts";
import type { GuardEffect } from "../core/loopguard/turn.ts";
import type { ModelRef } from "../core/types.ts";
import type { ToolMapping } from "../core/observations.ts";
import type { InferenceRequest, InferenceResult, Observation, Scope } from "../core/types.ts";

export type Knowledge = { version: 1; factReviews?:import("../core/microskills/feedback.ts").FactReviews; novelty:{seen:string[];lastSkip:number;skips:number;audits:number;missed:number}; scope: Scope; environment: EnvironmentState; distiller: Distiller; envelope: EnvelopeHistory; tools: ToolEvidence; render: string; renders:{environment:string;distilled:string;ids:string[]}|null; injectedIds: string[]; foldOrder: string[]; foldQueue: string[]; foldClaim: string | null };
export const KnowledgeDoc = defineDocFamily<Knowledge, Scope>({
  kind: "token-economizer.knowledge", version: 1, scope: "session", family: true,
  initial: scope => ({ version: 1, novelty:{seen:[],lastSkip:-999,skips:0,audits:0,missed:0},scope, environment: emptyEnvironment(), distiller: emptyDistiller(), envelope: emptyEnvelope(), tools: emptyEvidence(), render: "",renders:null, injectedIds: [], foldOrder: [], foldQueue: [], foldClaim: null }),
  checkpointWhen: () => true,
});
export const SessionsDoc = defineDoc<{ version: 1; sessions: Record<string, LearningSession>; hosts: Record<string,HostSession>; claims:Record<string,TaskId> }>({
  kind: "token-economizer.sessions", version: 1, scope: "session", initial: () => ({ version: 1, sessions: {}, hosts: {}, claims:{} }), checkpointWhen: (_value,_ops,info) => info.deltasSinceBase >= 128,
});
export const ObservationsDoc = defineDocFamily<{ version: 1; observations: Observation[]; ids: string[] }, null>({
  kind: "token-economizer.observations", version: 1, scope: "session", family: true,
  initial: () => ({ version: 1, observations: [], ids: [] }), checkpointWhen: (_value,_ops,info) => info.deltasSinceBase >= 128,
});
export type ToolMetadata = {host:HostSession;key:string|null;outerTask:TaskId;taskId:TaskId;runId:string;name:string;command:string;targets:string[];partial:boolean;mapping:ToolMapping;at:number};
export const ToolMetadataDoc = defineDocFamily<{value:ToolMetadata|null},null>({kind:"token-economizer.tool-metadata",version:1,scope:"session",family:true,initial:() => ({value:null}),checkpointWhen:() => true});
export const ContextSnapshotEntry = defineEntry<{sessionId:string;section:string;injectedIds:string[]}>("token-economizer.context-snapshot");
export type AutoWaiterItem = {scope:Scope;sessionKey:string;host:HostSession};
export const AutoWaitersDoc = defineDoc<{repositories:Record<string,{task:TaskId|null;items:AutoWaiterItem[]}>}>({kind:"token-economizer.auto-waiters",version:1,scope:"session",initial:() => ({repositories:{}}),checkpointWhen:() => false});
export const NoticesDoc = defineDoc<{items:Record<string,{notice:import("../core/types.ts").Notice;delivered:boolean}>}>({kind:"token-economizer.notices",version:1,scope:"session",initial:() => ({items:{}}),checkpointWhen:() => false});
export type GuardDecisionRecord = {id:string;runId:string;action:"redirect"|"notice";mode:"observe"|"active";status:"proposed"|"queued"|"consumed"|"simulated"|"undelivered";submissionId:SubmissionId|null;reason:string;
  /** Added after v1 records existed: older decisions lack the text and time. */
  text?:string;at?:number};
export const RunDoc = defineDocFamily<{guard:Guard|null;inputs:SubmissionId[];closed:boolean;decisions:GuardDecisionRecord[]},null>({kind:"token-economizer.run",version:1,scope:"session",family:true,initial:() => ({guard:null,inputs:[],closed:true,decisions:[]}),checkpointWhen:() => false});
export type GuardJob = {effect:GuardEffect;host:HostSession;sessionKey:string;model:ModelRef|null;writerModel:ModelRef|null;classifier:ModelRef|null;threshold:number;template:boolean;status:"queued"|"running"|"complete";result:BackgroundVerdict|null;features:number[]|null;revision:string;artifactId:string|null;sampleId:string;reuse:{key:string;canonical:string}|null;compactFull:string|null;goal?:JudgeGoal;goalStamp?:string;planTask?:string};
export const GuardJobsDoc = defineDoc<{jobs:Record<string,GuardJob>}>({kind:"token-economizer.guard-jobs",version:1,scope:"session",initial:() => ({jobs:{}}),checkpointWhen:() => false});
export const ClassifiersDoc = defineDocFamily<{local:{fitMs:number;predictMs:number;predictions:number;lastFitAt:number|null};samples:Sample[];loop:LoopArtifact|null;tools:ToolArtifact[];lexical:BM25|null;text:ArtifactIdentity[];textScores:Record<string,number>;usedAcceptanceGroups:string[];lastFitGroups:number;generation:number;fitTask:TaskId|null;lastError:string|null;skipped:number;audits:number;auditMissing:number;disagreements:number},null>({kind:"token-economizer.classifiers",version:1,scope:"session",family:true,initial:() => ({local:{fitMs:0,predictMs:0,predictions:0,lastFitAt:null},samples:[],loop:null,tools:[],lexical:null,text:[],textScores:{},usedAcceptanceGroups:[],lastFitGroups:0,generation:0,fitTask:null,lastError:null,skipped:0,audits:0,auditMissing:0,disagreements:0}),checkpointWhen:() => false});
export type InferenceJob = {
  id: string; sessionKey: string; account: string; runId: string | null; revision: string; digest: string;
  /** Original Agent, independent of the maintenance task owner. Older jobs lack this field. */
  conversationId?: ConversationId;
  request: InferenceRequest; created: number; deadline: number; taskId: TaskId | null;
  status: "queued" | "running" | "complete" | "failed" | "cancelled" | "unknown";
  result: InferenceResult | null; error: string | null;
};
export const JobsDoc = defineDoc<{ version: 1; jobs: Record<string, InferenceJob>; budget: BudgetState; worker: string | null; paused: string[]; pauseRevisions:Record<string,number> }>({
  kind: "token-economizer.jobs", version: 1, scope: "session",
  initial: () => ({ version: 1, jobs: {}, budget: emptyBudget(), worker: null, paused: [],pauseRevisions:{} }), checkpointWhen: () => true,
});

export const ReuseDoc = defineDoc<{items:Record<string,{canonical:string;verdict:import("../core/loopguard/rules.ts").JudgeVerdict;writer:string|null}>;hits:number}>({kind:"token-economizer.reuse",version:1,scope:"session",initial:() => ({items:{},hits:0}),checkpointWhen:() => false});
