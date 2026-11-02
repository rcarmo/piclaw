/** Historical receipt metadata only; no legacy execution or deadline context. */
export type PiclawCompactionExecutionStage = "deterministic" | "provider_connect" | "first_token" | "streaming" | "settlement";

export type PiclawCompactionTrigger =
  | "manual"
  | "pre_prompt"
  | "idle"
  | "recovery"
  | "model_switch"
  | "model_downshift"
  | "rotation"
  | "threshold"
  | "overflow"
  | string;

export interface PiclawCompactionTriggerMetadata {
  chatJid: string;
  trigger: PiclawCompactionTrigger;
  willRetry: boolean;
  source: string;
  /** Internal identity used to isolate concurrent/late compaction cleanup. */
  generationId?: string;
  attempt?: number;
  targetContextWindow?: number;
  targetModelLabel?: string;
  /** Absolute Date.now() deadline for cooperative deterministic compaction work. */
  deadlineAtMs?: number;
  /** Maximum deterministic work units before cooperative compaction aborts. */
  maxWorkUnits?: number;
  executionStage?: PiclawCompactionExecutionStage;
  compactionMethod?: string;
  compactionExecution?: string;
  compactionInputTokens?: number;
  providerModel?: string;
  providerRequestCount?: number;
  providerRequestStartedAtMs?: number;
  providerFirstTokenAtMs?: number;
  providerLastOutputAtMs?: number;
  timeToFirstTokenMs?: number;
}
