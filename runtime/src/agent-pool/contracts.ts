/**
 * agent-pool/contracts.ts – Shared public contracts for AgentPool and its helpers.
 */

import type { AgentSessionEvent, AgentSessionRuntime, SettingsManager } from "@mariozechner/pi-coding-agent";
import type {
  Api,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Model,
  Usage,
  streamSimple,
} from "@mariozechner/pi-ai";

import type { AttachmentInfo } from "./attachments.js";

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
  sawCompactionIntent: boolean;
  compactionErrorMessage: string | null;
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
  recovery?: AgentRecoveryMetadata;
}

/** A single turn's output within a multi-turn agent run. */
export interface TurnOutput {
  text: string;
  attachments: AttachmentInfo[];
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
  /** Called when a turn completes (text_start → next text_start or end). */
  onTurnComplete?: (turn: TurnOutput) => void;
  /** Override the default timeout (ms). Use 0 or a negative value to disable. */
  timeoutMs?: number;
  /** Abort after this many tool calls complete. Undefined means no cap. */
  maxToolCalls?: number;
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
  modelRegistry?: import("@mariozechner/pi-coding-agent").ModelRegistry;
  sideStreamSimple?: (
    model: Model<Api>,
    context: Parameters<typeof streamSimple>[1],
    options?: Parameters<typeof streamSimple>[2]
  ) => AssistantMessageEventStream;
}
