import { parseRemoteCompactionDetails, type RemoteCompactionDetails, type RemoteCompactionFailureCode } from "./remote-compaction.js";
type SmartCompactionMethod = "selective" | "pipelined";
type CompactionTimeoutStage = "provider_connect" | "first_token" | "streaming" | "deterministic" | "settlement";

export const SMART_COMPACTION_RESULT_DETAILS_KIND = "piclaw.smart_compaction";
export const SMART_COMPACTION_RESULT_DETAILS_VERSION = 1;

export type SmartCompactionExecution =
  | "deterministic_noop"
  | "single_pass"
  | "single_pass_repair"
  | "progressive"
  | "progressive_partial";

export type SmartCompactionRemoteOutcome = "disabled" | "success" | RemoteCompactionFailureCode;

export interface SmartCompactionResultDetails {
  kind: typeof SMART_COMPACTION_RESULT_DETAILS_KIND;
  version: typeof SMART_COMPACTION_RESULT_DETAILS_VERSION;
  method: SmartCompactionMethod | "provider_native";
  execution: SmartCompactionExecution | "provider_native";
  remoteCompaction: {
    outcome: SmartCompactionRemoteOutcome;
    reason?: string;
  };
  modelCallCount: number;
  model?: string;
  providerRequestCount?: number;
  timeToFirstTokenMs?: number;
  durationMs?: number;
  timeoutStage?: CompactionTimeoutStage;
  processedChunkCount?: number;
  totalChunkCount?: number;
}

export type PiclawCompactionResultDetails = SmartCompactionResultDetails | RemoteCompactionDetails;

export function parsePiclawCompactionResultDetails(value: unknown): PiclawCompactionResultDetails | null {
  return parseSmartCompactionResultDetails(value) ?? parseRemoteCompactionDetails(value);
}

export function parseSmartCompactionResultDetails(value: unknown): SmartCompactionResultDetails | null {
  if (!value || typeof value !== "object") return null;
  const details = value as Partial<SmartCompactionResultDetails>;
  if (
    details.kind !== SMART_COMPACTION_RESULT_DETAILS_KIND
    || details.version !== SMART_COMPACTION_RESULT_DETAILS_VERSION
    || (details.method !== "selective" && details.method !== "pipelined" && details.method !== "provider_native")
    || typeof details.execution !== "string"
    || !details.remoteCompaction
    || typeof details.remoteCompaction !== "object"
    || typeof details.remoteCompaction.outcome !== "string"
    || typeof details.modelCallCount !== "number"
  ) return null;
  return details as SmartCompactionResultDetails;
}
