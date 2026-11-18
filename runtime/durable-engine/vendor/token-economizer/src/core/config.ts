// SPDX-License-Identifier: Apache-2.0
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type { InferenceRequest } from "./types.ts";
const positive = Type.Integer({ minimum: 1 });
const model = Type.Union([Type.Null(), Type.Object({ provider: Type.String({ minLength: 1 }), id: Type.String({ minLength: 1 }) },{additionalProperties:false})]);
export const PolicySchema = Type.Object({
  version: Type.Literal(1), enabled: Type.Boolean(), mode: Type.Enum(["off", "observe", "active"]),
  inferenceInObserve: Type.Boolean(),
  microSkills: Type.Enum(["off", "envfacts", "distiller", "both"]),
  maxFacts: positive, maxFactTokens: positive, proposeEvery: positive,
  pruning: Type.Enum(["off", "propose", "auto"]), quietMinutes: Type.Number({ minimum: 0 }),
  evidencePrompts: positive, evidenceMinSessions: positive, evidenceSessions: positive,
  loop: Type.Enum(["off", "rules", "judge"]), level: Type.Enum(["default", "conservative", "aggressive"]),
  redirects: positive, judge: Type.Enum(["generative", "classifier", "cascade"]),
  toolJudge: Type.Enum(["none", "generative", "classifier", "cascade"]),
  /** Run the task judge on each new prompt while idle. Optional so older saved settings still load. */
  autoToolPicks: Type.Optional(Type.Boolean()),
  reduceOutputs: Type.Optional(Type.Boolean()),
  goalChecks: Type.Optional(Type.Boolean()),
  /** Store long tool outputs outside model context, with bounded search and reads. Optional so older settings load. */
  offloadOutputs: Type.Optional(Type.Boolean()),
  /** Ask the optimizer model to summarise each stored output; a deterministic preview is the fallback. */
  outputSummaries: Type.Optional(Type.Boolean()),
  offload: Type.Optional(Type.Object({ bytes: Type.Integer({ minimum: 1024, maximum: 262_144 }), lines: Type.Integer({ minimum: 10, maximum: 5000 }), retentionDays: Type.Integer({ minimum: 1, maximum: 30 }) }, { additionalProperties: false })),
  generativeModel: model, classifierModel: model,
  models:Type.Object({proposer:model,loopJudge:model,writer:model,toolJudge:model,loopClassifier:model,toolClassifier:model},{additionalProperties:false}),
  thresholds:Type.Object({min_turns:Type.Optional(positive),edit_churn:Type.Optional(positive),distinct_edit_files:Type.Optional(positive),error_outputs:Type.Optional(positive),stagnation:Type.Optional(Type.Number({minimum:0,maximum:1})),envelope_margin:Type.Optional(Type.Number({exclusiveMinimum:0})),envelope_pct:Type.Optional(Type.Number({minimum:0,maximum:100})),envelope_min_samples:Type.Optional(positive),judge_confidence:Type.Optional(Type.Number({minimum:0,maximum:1})),backstop_mult:Type.Optional(Type.Number({exclusiveMinimum:0})),gate_min_turns:Type.Optional(positive),gate_error_outputs:Type.Optional(positive),nudge_on_ambiguous:Type.Optional(Type.Boolean())},{additionalProperties:false}),
  budget: Type.Object({ callsPerSession: positive, callsPerDay: positive, maxCostPerSession: Type.Union([Type.Null(),Type.Number({ minimum: 0 })]), deadlineMs: Type.Integer({ minimum: 1, maximum: 180_000 }), maxOutputTokens: positive }),
  savers: Type.Object({ localLoop: Type.Boolean(), authorizeLocalStuck: Type.Boolean(), toolPrefilter: Type.Boolean(), localToolDrops: Type.Boolean(), reuse: Type.Boolean(), templates: Type.Boolean(), novelty: Type.Boolean(), compact: Type.Boolean(), auditPercent: Type.Number({ minimum: 0, maximum: 20 }) }),
}, { additionalProperties: false });
export type Policy = Static<typeof PolicySchema>;
export function defaultPolicy(): Policy {
  return { version: 1, enabled: false, mode: "off", inferenceInObserve: false,
    microSkills: "off", maxFacts: 4, maxFactTokens: 150, proposeEvery: 3,
    pruning: "off", quietMinutes: 60, evidencePrompts: 10, evidenceMinSessions: 2, evidenceSessions: 5,
    loop: "off", level: "default", redirects: 1, judge: "generative", toolJudge: "none",
    generativeModel: null, classifierModel: null,
    models:{proposer:null,loopJudge:null,writer:null,toolJudge:null,loopClassifier:null,toolClassifier:null},thresholds:{},
    budget: { callsPerSession: 12, callsPerDay: 100, maxCostPerSession: null, deadlineMs: 180_000, maxOutputTokens: 1024 },
    savers: { localLoop: false, authorizeLocalStuck: false, toolPrefilter: false, localToolDrops: false, reuse: false, templates: false, novelty: false, compact: false, auditPercent: 5 },
  };
}
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Persisted and HTTP policies are validated against the complete schema at this boundary.
export function parsePolicy(value: unknown): Policy { Value.Assert(PolicySchema, value); return structuredClone(value); }
export type Override = "inherit" | "off" | "observe" | "active";
export function effectivePolicy(policy: Policy, workspace: Override = "inherit", agent: Override = "inherit"): Policy {
  if (!policy.enabled || policy.mode === "off" || workspace === "off" || agent === "off") return { ...policy, mode: "off" };
  return { ...policy, mode: agent !== "inherit" ? agent : workspace !== "inherit" ? workspace : policy.mode };
}
export function modelFor(policy:Policy,purpose:keyof Policy["models"]) {return policy.models[purpose] ?? (purpose === "loopClassifier" || purpose === "toolClassifier" ? policy.classifierModel : policy.generativeModel);}
export function inferenceAllowed(policy: Policy): boolean { return policy.enabled && (policy.mode === "active" || policy.mode === "observe" && policy.inferenceInObserve); }
export function purposeAllowed(policy:Policy,request:InferenceRequest):boolean {
  if (!inferenceAllowed(policy)) return false;
  const paidFacts = policy.microSkills === "distiller" || policy.microSkills === "both";
  if (request.purpose === "proposer") return paidFacts;
  if (request.purpose === "output-summary") return policy.offloadOutputs === true && policy.outputSummaries === true;
  if (request.purpose === "loop-judge" || request.purpose === "writer") return policy.loop === "judge";
  if (request.purpose === "tool-judge") return policy.pruning !== "off" && policy.toolJudge !== "none";
  if (request.purpose === "classifier") return request.classification?.purpose === "loop" ? policy.loop === "judge" : request.classification?.purpose === "tools" && policy.pruning !== "off" && policy.toolJudge !== "none";
  return policy.savers.auditPercent > 0 && (request.auditFor === "loop" ? policy.loop === "judge" : request.auditFor === "tools" ? policy.pruning !== "off" && policy.toolJudge !== "none" : request.auditFor === "proposer" && paidFacts);
}
export const defaultOutputOffload = { bytes: 8192, lines: 100, retentionDays: 7 } as const;
export function outputOffload(policy: Policy) { return { ...defaultOutputOffload, ...policy.offload }; }
export function observing(policy: Policy): boolean { return policy.enabled && policy.mode !== "off"; }
export function emitting(policy: Policy): boolean { return policy.enabled && policy.mode === "active"; }
