/**
 * agent-pool/contracts.ts – Shared public contracts for AgentPool and its helpers.
 */

import type { AgentSessionRuntime, ModelRuntime } from "@earendil-works/pi-coding-agent";
import type {
  AssistantMessageEvent,
  Usage,
} from "@earendil-works/pi-ai";

import type { AttachmentInfo } from "./attachments.js";
import type { AgentAbortCause } from "./abort-provenance.js";
import type { PiclawCredentialStore } from "./credential-store.js";
import type { ProtectedRecoveryHandoffMetadata } from "./protected-recovery-handoff-reason.js";

export type AgentFailureCategory =
  | "rate_limit"
  | "auth_config"
  | "credential_storage"
  | "network"
  | "aborted"
  | "timeout"
  | "tool_budget"
  | "context_pressure"
  | "output_limit"
  | "provider_budget"
  | "provider"
  | "no_terminal_output"
  | "stalled_work"
  | "session_corruption"
  | "non_recoverable"
  | "already_processing"
  | "provider_unavailable"
  | "unknown";

export interface AgentRecoveryDiagnosticEntry {
  phase: "attempt_failure" | "compaction_failure";
  attempt: number;
  classifier: string;
  strategy: string | null;
  reason: string;
  error: string;
  elapsedMs: number;
  hadToolActivity: boolean;
  hadPartialOutput: boolean;
  hadCompletedTurnOutput: boolean;
  hadTerminalTurnOutput: boolean;
  hasUnresolvedToolExecution: boolean;
  sawCompactionIntent: boolean;
  compactionErrorMessage: string | null;
  toolUseBudgetExceeded?: boolean;
  assistantToolUseMessageCount?: number;
  toolExecutionCount?: number;
  toolUseMessageBudget?: number;
  failureCategory?: AgentFailureCategory;
}

export interface AgentRecoveryMetadata {
  attemptsUsed: number;
  totalElapsedMs: number;
  recovered: boolean;
  exhausted: boolean;
  lastClassifier: string | null;
  strategyHistory: string[];
  diagnostics: AgentRecoveryDiagnosticEntry[];
}

/** Output from an agent run: response text, status, and token usage. */
export interface AgentOutput {
  status: "success" | "error" | "tool_complete";
  result: string | null;
  error?: string;
  /** Structured terminal cause. Runtime decisions must not reclassify `result` prose. */
  failureCategory?: AgentFailureCategory;
  attachments?: AttachmentInfo[];
  usage?: Usage;
  recovery?: AgentRecoveryMetadata;
  toolBudgetExceeded?: boolean;
  toolStepsUsed?: number;
  toolStepsBudget?: number;
  nextAction?: string;
  /** A protected recovery ran without tools and must hand off to one ordinary tool-enabled turn. */
  requiresToolEnabledContinuation?: boolean;
  /** Safe machine-readable reason for a bounded protected-recovery handoff. */
  protectedRecoveryHandoff?: ProtectedRecoveryHandoffMetadata;
  abortCause?: AgentAbortCause;
  abortOperation?: string;
}

export type AgentTurnKind = "draft_snapshot" | "intermediate";
export type AgentTurnCause = "interrupted_text_start" | "tool_use" | "completed_boundary" | "failed_boundary";

/** A single turn's output within a multi-turn agent run. */
export interface TurnOutput {
  text: string;
  attachments: AttachmentInfo[];
  usage?: Usage;
  /** Narrow durable classification for non-terminal assistant output. */
  turnKind?: AgentTurnKind;
  /** Boundary that caused this non-terminal output to be committed. */
  cause?: AgentTurnCause;
  /** The completed assistant message committed immediately before tool dispatch. */
  followedByToolUse?: boolean;
  /** Provider text phase, separate from whether this response ended the run. */
  textPhase?: "commentary" | "final_answer" | null;
  /** Completed successful assistant response; the enclosing run can still continue. */
  terminal?: boolean;
}

/** Result returned from a side prompt run. */
export interface SidePromptResult {
  status: "success" | "error";
  result: string | null;
  thinking: string | null;
  error?: string;
  model: string | null;
  usage?: Usage;
  stopReason?: string;
}

/** Options accepted by AgentPool.runSidePrompt(). */
export interface SidePromptOptions {
  systemPrompt?: string;
  signal?: AbortSignal;
  onEvent?: (event: AssistantMessageEvent) => void;
  onTextDelta?: (delta: string) => void;
  onThinkingDelta?: (delta: string) => void;
  /** Optional stable identity for a retried side prompt. */
  requestId?: string;
}

export interface NativeDreamRequest {
  invocationId:string;chatJid:string;mode:'manual'|'auto';days:number;model:string|null;timeoutMs:number;acceptedAt:string;
  assertCurrent():void;
  signal?:AbortSignal;
}

/** Construction options for creating an AgentPool. */
export interface AgentPoolOptions {
  /** Trusted explicit historical resident-capture/test composition, never native fallthrough. */
  legacyCapture?: true;
  prepareInterruptedScheduledHarness?: import("./durable-runtime-adapter.js").PrepareInterruptedScheduledHarness;
  dispatchDreamOperation?: (request:NativeDreamRequest)=>Promise<AgentOutput>;
  /** Application-owned native slash commands; never constructs a legacy session. */
  dispatchHostCommand?: (chatJid: string, rawText: string) => Promise<import("../agent-control/agent-control-types.js").AgentControlResult>;
  /** Select the durable backend for the entire pool. Captured bindings are exhaustive;
   * even an empty map disables all legacy session construction. No HTTP selection. */
  dispatchScheduledAgent?: (lease: import("../service-effects/contracts/scheduled-run-store.js").ScheduledRunLease, options?: { signal?: AbortSignal }) => Promise<AgentOutput>;
  dispatchSidePrompt?: (chatJid: string, prompt: string, options: SidePromptOptions) => Promise<SidePromptResult>;
  getDurableSession?: (chatJid: string) => import("./durable-runtime-adapter.js").DurableSessionPositionPort | undefined;
  createSession?: (chatJid: string, sessionDir: string) => Promise<AgentSessionRuntime>;
  credentialStore?: PiclawCredentialStore;
  modelRuntime?: ModelRuntime;
  modelRegistry?: import("@earendil-works/pi-coding-agent").ModelRegistry;
}
