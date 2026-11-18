// SPDX-License-Identifier: Apache-2.0
import type { Coverage, Observation, Outcome } from "./types.ts";
import { safeEnvironmentValue } from "./privacy.ts";

export type SemanticTool = "shell" | "edit" | "read" | "search" | "wrapper" | "other";
export type ToolMapping = { semantic: SemanticTool; readOnly: boolean };
export type SourceIdentity = { conversation: string; outerCall: string; nestedKey: string | null; phase: "result" };
export type ObservationInput = {
  source: SourceIdentity; sessionId: string; runId: string; tool: string; mapping: ToolMapping;
  command: string; targets: string[]; output: string; isError: boolean;
  exitCode: number | null; timedOut: boolean; aborted: boolean; completedNonProcess?:boolean;
  coverage: Coverage; at: number; verification: Observation["verification"];
};
export function observationId(source: SourceIdentity): string {
  return JSON.stringify([source.conversation, source.outerCall, source.nestedKey, source.phase]);
}
/** Remove terminal controls before parsing diagnostics or sending any model input. */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\x1b[@-_]/g, "");
}
/** These are diagnostic redactions, not permission to learn arbitrary environment values. */
export function redact(text: string): string {
  return stripAnsi(text)
    .replace(/-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----[\s\S]*?-----END (?:[A-Z ]*PRIVATE KEY)-----/g, "[REDACTED KEY]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16})\b/g, "[REDACTED TOKEN]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED JWT]")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@")
    .replace(/([?&][^&#\s=]+=)[^&#\s]+/g, "$1[REDACTED]")
    .replace(/\b((?:authorization|proxy-authorization)\s*:\s*)(?:Bearer\s+|Basic\s+)?[^\r\n]+/gi, "$1[REDACTED]")
    .replace(/((?:["']?)(?:api[_-]?key|api[_-]?token|access[_-]?token|refresh[_-]?token|token|password|passwd|secret[_-]?access[_-]?key|private[_-]?key|client[_-]?secret|credentials?|secret|cookie)(?:["']?)\s*[=:]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, "$1[REDACTED]")
    .replace(/\b([A-Z_][A-Z0-9_]*)=(\[REDACTED\]|"[^"\n]*"|'[^'\n]*'|[^\s;&|`,)}\]]+)/g, (match,name: string,value: string) => value === "[REDACTED]" || safeEnvironmentValue(name,value.replace(/^["']|["']$/g,"")) ? match : `${name}=[REDACTED]`);
}
export function resultOutcome(input: Pick<ObservationInput, "exitCode" | "isError" | "aborted" | "timedOut">): Outcome {
  if (input.aborted) return "aborted";
  if (input.timedOut) return "timedOut";
  if (input.isError || input.exitCode !== null && input.exitCode !== 0) return "failure";
  return input.exitCode === 0 ? "success" : "unknown";
}
export function makeObservation(input: ObservationInput): Observation {
  return {
    id: observationId(input.source), sessionId: input.sessionId, runId: input.runId,
    tool: input.tool, semantic: input.mapping.semantic, command: redact(input.command),
    targets: [...new Set(input.targets.map(redact))], output: redact(input.output), outcome: input.completedNonProcess && input.mapping.semantic !== "shell" && (input.exitCode === null || input.exitCode === 0) && !input.isError && !input.timedOut && !input.aborted ? "success" : resultOutcome(input),
    exitCode: input.exitCode, coverage: input.coverage, nested: input.source.nestedKey !== null,
    parentId: input.source.nestedKey !== null ? input.source.outerCall : null,
    readOnly: input.mapping.readOnly, verification: input.verification, at: input.at,
  };
}
/** Preserve quoted whitespace and command boundaries; collapse only unquoted horizontal space. */
export function normalizeCommand(command: string): string {
  let quote = "", escaped = false, pendingSpace = false, output = "";
  for (const char of command.trim()) {
    if (escaped) { output += char; escaped = false; continue; }
    if (char === "\\" && quote !== "'") { if (pendingSpace) output += " "; pendingSpace = false; output += char; escaped = true; continue; }
    if (quote) { output += char; if (char === quote) quote = ""; continue; }
    if (char === " " || char === "\t" || char === "\r") { pendingSpace = true; continue; }
    if (pendingSpace && output && !output.endsWith("\n") && char !== "\n") output += " ";
    pendingSpace = false; output += char;
    if (char === "'" || char === '"') quote = char;
  }
  return output;
}
export function relativeTarget(target: string, root: string): string {
  const normalized = target.replaceAll("\\", "/"), prefix = root.replaceAll("\\", "/").replace(/\/+$/, "");
  return prefix && normalized.startsWith(`${prefix}/`) ? normalized.slice(prefix.length + 1) : normalized;
}
/** Exact saver identity: unlike the upstream spiral signature, numbers and paths matter. */
export function failureIdentity(observation: Observation, repositoryRoot: string): string | null {
  if (observation.coverage !== "complete" || !["failure", "timedOut"].includes(observation.outcome)) return null;
  const diagnostic = redact(observation.output).replace(/\b((?:request|trace)[_-]?id\s*[=:]\s*)[A-Za-z0-9_-]+/gi, "$1<volatile>")
    .replace(/\b(timestamp\s*[=:]\s*)\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g, "$1<volatile>");
  return JSON.stringify([observation.semantic, normalizeCommand(redact(observation.command)),
    [...new Set(observation.targets.map(target => relativeTarget(redact(target), repositoryRoot)))].sort(),
    observation.outcome, observation.exitCode, diagnostic]);
}
export type ObservationWindow = { observations: Observation[]; coverage: Coverage };
export function observationWindow(observations: Observation[], limit = 32): ObservationWindow {
  const window = observations.slice(-limit);
  return { observations: window, coverage: window.every(item => item.coverage === "complete") ? "complete" : "partial" };
}
