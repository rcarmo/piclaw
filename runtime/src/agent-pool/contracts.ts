/**
 * agent-pool/contracts.ts – Shared public contracts for AgentPool and its helpers.
 */

import type { AgentSessionEvent, AgentSessionRuntime, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
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
  onEvent?: (event: AssistantMessageEvent | AgentSessionEvent) => void;
  onTextDelta?: (delta: string) => void;
  onThinkingDelta?: (delta: string) => void;
  /** Optional stable identity for a retried side prompt. */
  budgetWorkId?: string;
  budgetParentWorkId?: string | null;
}

/** Options for AgentPool.runAgent(): chatJid, messages, callbacks. */
export interface RunAgentOptions {
  /** Server-owned execution provenance; never accept directly from browser/model payloads. */
  executionProvenance?: import("../core/execution-context.js").ExecutionProvenance;
  /** Server-owned budget work identity. Nested retries/continuations retain it. */
  budgetWorkId?: string;
  /** Parent budget work for delegated/nested execution. */
  budgetParentWorkId?: string | null;
  /** Explicit execution class when provenance alone is insufficient. */
  budgetExecutionKind?: import("../budget/types.js").BudgetExecutionKind;
  /** Scheduled task definition that owns this run. */
  budgetScheduledTaskId?: string | null;
  /** Internal server-owned admission hook. Never populate from client payloads. */
  budgetBeforeModelCall?: (boundary: string, prompt: string, providerId?: string) => Promise<string | null>;
  onEvent?: (event: AgentSessionEvent) => void;
  /** Called when a completed assistant message can be committed, including before tool dispatch. */
  onTurnComplete?: (turn: TurnOutput) => void;
  /** Stable runtime turn identifier for observability/correlation. */
  turnId?: string;
  /** Optional browser/user correlation identifier supplied by the caller. */
  userId?: string;
  /** Optional browser session correlation identifier supplied by the caller. */
  sessionId?: string;
  /** Optional browser tab/client correlation identifier supplied by the caller. */
  clientId?: string;
  /** Optional runtime session/fork leaf identity for observability correlation. */
  sessionLeafId?: string;
  /** Override the default timeout (ms). Use 0 or a negative value to disable. */
  timeoutMs?: number;
  /** Bound this caller's startup wait; defaults to the run timeout. Shared creation remains owned. */
  startupTimeoutMs?: number;
  /** Abort after this many tool calls complete. Undefined means no cap. */
  maxToolCalls?: number;
  /**
   * Skip Piclaw-managed pre-prompt compaction for this run.
   *
   * Used by callers that perform preflight compaction themselves before
   * promoting a pending message into normal inflight run state.
   */
  skipPrePromptCompaction?: boolean;
  /**
   * Run an idle auto-compaction check after a successful terminal turn when
   * the completed turn leaves the session near the context threshold.
   */
  scheduleIdleAutoCompaction?: boolean;
  /**
   * If set, the active tool set is clamped to names passing this predicate for
   * the entire run. The predicate is also enforced against any
   * setActiveToolsByName calls made by the agent during the run, preventing
   * LLM-driven self-escalation beyond the ceiling.
   */
  toolCeilingFilter?: (toolName: string) => boolean;
  /** Host-owned restricted operations must fail closed when tool controls are unavailable. */
  requireToolCeiling?: boolean;
  /** Restricted-run hook: SDK has built its model context with the submitted user input. */
  onOperationInputCommitted?: () => void;
  /** Caller cancellation bound to this run, not a session-wide external abort API. */
  abortSignal?: AbortSignal;
  /** Host-owned revocation check, evaluated before each budget/model admission boundary. */
  executionAdmissionCheck?: () => Promise<boolean> | boolean;
  /**
   * Let the caller durably persist a protected-recovery continuation instead
   * of running it inline. Web uses this to order queue intent before terminal
   * message and cursor finalization.
   */
  deferToolEnabledContinuation?: boolean;
  /** This run is a typed ordinary continuation after protected recovery. */
  protectedRecoveryContinuation?: boolean;
  /** One-based depth of the bounded protected-recovery handoff chain. */
  protectedRecoveryContinuationDepth?: number;
  /** Validated safe evidence carried from the handoff that created this continuation. */
  protectedRecoveryHandoffContext?: ProtectedRecoveryHandoffMetadata;
  /** Stable source-message identity used to partition repeated-failure suppression. */
  recoverySourceId?: string;
  /** Bounded progress generation within one source-message recovery chain. */
  recoveryGeneration?: number;
}

export interface RetrySettingsProvider {
  getRetrySettings?: SettingsManager["getRetrySettings"];
}

/** Construction options for creating an AgentPool. */
export interface AgentPoolOptions {
  /** Select the durable backend for the entire pool. Captured bindings are exhaustive;
   * even an empty map disables all legacy session construction. No HTTP selection. */
  dispatchScheduledAgent?: (lease: import("../service-effects/contracts/scheduled-run-store.js").ScheduledRunLease) => Promise<AgentOutput>;
  getDurableSession?: (chatJid: string) => import("./durable-runtime-adapter.js").DurableSessionPositionPort | undefined;
  createSession?: (chatJid: string, sessionDir: string) => Promise<AgentSessionRuntime>;
  createSideSession?: (chatJid: string, sessionDir: string) => Promise<AgentSessionRuntime>;
  credentialStore?: PiclawCredentialStore;
  modelRuntime?: ModelRuntime;
  modelRegistry?: import("@earendil-works/pi-coding-agent").ModelRegistry;
  sideStreamSimple?: ModelRuntime["streamSimple"];
}
