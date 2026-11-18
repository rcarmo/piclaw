// SPDX-License-Identifier: Apache-2.0
// TokenEconomizer port: upstream Microsoft, Apache-2.0; native TypeScript adaptation.
export type Mode = "off" | "observe" | "active";
export type Outcome = "success" | "failure" | "aborted" | "timedOut" | "unknown";
export type ModelRef = { provider: string; id: string };
export type Coverage = "complete" | "partial";
export type Scope = { repository: string; environment: string; host: string };
export type Observation = {
  id: string; sessionId: string; runId: string; tool: string; semantic: string;
  command: string; targets: string[]; output: string; outcome: Outcome; exitCode: number | null;
  coverage: Coverage; nested: boolean; parentId: string | null; readOnly: boolean;
  verification: "passed" | "failed" | null; at: number;
};
export type ToolInfo = { name: string; description: string; revision: string; protected: boolean; highRisk: boolean; exposed: boolean };
export type Notice = { id: string; code: string; text: string; sessionId: string; runId: string | null };
export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: Record<string, number>; reasoning: number | null };
export type Spend = { id: string; sessionId: string; purpose: string; model: ModelRef; usage: Usage | null; cost: number | null; durationMs: number; status: "complete" | "failed" | "unknown" };
export type Price = { input: number; output: number; cacheRead: number; cacheWrite: Record<string, number> };
export type Reason = "not_ready" | "insufficient_evidence" | "out_of_domain" | "stale" | "invalid_output" | "unsupported" | "drift";
export type Decision<L extends string> = { kind: "label"; label: L; rawScore: number; artifactId: string; reasons: string[] } | { kind: "abstain"; reason: Reason };
export type LoopLabel = "productive" | "stuck";
export type ToolLabel = "keep" | "drop_candidate";
export type InferencePurpose = "proposer" | "loop-judge" | "writer" | "tool-judge" | "classifier" | "audit" | "output-summary";
export type InferenceRequest = { id: string; cacheScope?: string; includesPlan?: boolean; planBinding?: string; purpose: InferencePurpose; model: ModelRef; prompt: string; maxOutputTokens: number; deadlineMs: number; classification?: ClassifyRequest; auditFor?:"loop"|"tools"|"proposer" };
export type InferenceResult = { text: string; model: ModelRef; usage: Usage | null; cost: number | null; authUnavailable: boolean; error: string | null; durationMs: number };
export type SideCall = (request: InferenceRequest, signal: AbortSignal, beforeSend?: () => Promise<void>) => Promise<InferenceResult>;
export type ClassifyRequest = { id: string; model: ModelRef; purpose: "loop" | "tools"; state: string; labels: Record<string, string>; deadlineMs: number };
export type ClassifyResult = { label: string | null; probabilities: Record<string, number>; model: ModelRef; usage: Usage | null; cost: number | null; error: string | null; authUnavailable: boolean; durationMs: number };
export type DecisionClassifier = (request: ClassifyRequest, signal: AbortSignal) => Promise<ClassifyResult>;
export function scopeKey(scope: Scope): string { return JSON.stringify([scope.host, scope.repository, scope.environment]); }
