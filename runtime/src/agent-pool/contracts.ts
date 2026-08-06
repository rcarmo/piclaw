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
  attachments?: AttachmentInfo[];
  usage?: Usage;
  recovery?: AgentRecoveryMetadata;
  toolBudgetExceeded?: boolean;
  toolStepsUsed?: number;
  toolStepsBudget?: number;
  nextAction?: string;
  abortCause?: AgentAbortCause;
  abortOperation?: string;
}

/** A single turn's output within a multi-turn agent run. */
export interface TurnOutput {
  text: string;
  attachments: AttachmentInfo[];
  usage?: Usage;
  /** The completed assistant message committed immediately before tool dispatch. */
  followedByToolUse?: boolean;
}

export interface TurnDiscard {
  reason: "tool_use_commentary" | "commentary_only";
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
}

/** Options for AgentPool.runAgent(): chatJid, messages, callbacks. */
export interface RunAgentOptions {
  onEvent?: (event: AgentSessionEvent) => void;
  /** Called when a completed assistant message can be committed, including before tool dispatch. */
  onTurnComplete?: (turn: TurnOutput) => void;
  /** Called when completed provider commentary must remain transient. */
  onTurnDiscard?: (discard: TurnDiscard) => void;
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
}

export interface RetrySettingsProvider {
  getRetrySettings?: SettingsManager["getRetrySettings"];
}

/** Construction options for creating an AgentPool. */
export interface AgentPoolOptions {
  createSession?: (chatJid: string, sessionDir: string) => Promise<AgentSessionRuntime>;
  createSideSession?: (chatJid: string, sessionDir: string) => Promise<AgentSessionRuntime>;
  credentialStore?: PiclawCredentialStore;
  modelRuntime?: ModelRuntime;
  modelRegistry?: import("@earendil-works/pi-coding-agent").ModelRegistry;
  sideStreamSimple?: ModelRuntime["streamSimple"];
}
