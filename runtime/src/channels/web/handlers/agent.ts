/**
 * web/handlers/agent.ts – HTTP handlers for agent-related API endpoints.
 *
 * Handles GET /agent/roster, GET /agent/status, GET /agent/thought,
 * POST /agent/thought/visibility, avatar upload/retrieval, user profile,
 * and branding endpoints.
 *
 * Consumers: web/request-router.ts routes agent paths to these handlers.
 */

import type { WebChannelLike } from "../core/web-channel-contracts.js";
import {
  getIdentityConfig,
  getRoutingConfig,
} from "../../../core/config.js";
import { parseControlCommand } from "../../../agent-control/index.js";
import { isSlashCommandInvocation } from "../../../agent-pool/slash-command.js";
import {
  RECOVERY_CONTINUATION_PROMPT,
  TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT,
} from "../../../agent-pool/context-pressure-retry.js";
import { resolveProtectedRecoveryPrompt } from "../../../agent-pool/protected-recovery-control-intent.js";
import { getExtensionKvStore } from "../../../extension-kv-registry.js";
import {
  normalizeAgentMessagePayload,
  parseAgentMessageRequest,
  storeAgentUserMessage,
} from "../messaging/agent-message-service.js";
import { handleUiThemeCommand } from "../theming/ui-theme-commands.js";
import { handleUiMetersCommand } from "../ui-meters-commands.js";
import { getServerUiMetersConfig, setServerUiMetersConfig, setServerUiThemeConfig } from "../ui-state.js";
import {
  acceptStoredChatMessageSource,
  blockChatOperation,
  claimNextChatOperation,
  completeChatOperation,
  getAcceptedChatSource,
  getChatCursor,
  getChatOperation,
  getChatOperationDisposition,
  getChatOperationIntentSources,
  getGoalContinuationCarriedIntentSources,
  getGoalContinuationLineage,
  getProtectedContinuationRootSource,
  getChatPreflight,
  getInflightMessageId,
  getMessageByRowId,
  getMessageRowIdById,
  getDb,
  rollbackChatRunWithError,
  rollbackInflightRun,
  rollbackInflightRunForCompactionConflict,
  peekNextAcceptedChatSource,
  registerChatOperationIntent,
  resumeChatOperation,
  setChatCursor,
  waitChatOperation,
  type ChatOperationOutcome,
  type ChatOperationOwner,
  type ChatOperationState,
} from "../../../db.js";
import { detectChannel, formatMessages, formatOutbound } from "../../../router.js";
import { createAgentProfileBuilder } from "../agent/agent-utils.js";
import { resolveAvatarUrl } from "../media/avatar-service.js";
import { broadcastInteractionUpdated } from "../cards/interaction-service.js";
import { storeAgentTurn } from "../messaging/agent-message-store.js";
import { finalizeSuccessfulProcessChatRun, persistIntermediateProcessChatTurn } from "../runtime/process-chat-finalization-runtime.js";
import { createProcessChatStreamingRuntime } from "../runtime/process-chat-streaming-runtime.js";
import { runDurableOperationPreflight, runProcessChatPreflight } from "../runtime/process-chat-preflight-runtime.js";
import {
  MODEL_COMMAND_TYPES,
  executeDeferredControlCommand,
  isDeferredControlCommand,
  materializeDeferredFollowups,
  resolveAndBroadcastModelStateForCommand,
  resumeFailedRunAfterModelSwitch,
  selectProcessChatMessage,
} from "../runtime/process-chat-control-runtime.js";
import { resolveThreadId, resolveThreadRootId } from "../runtime/threading.js";
import { resolveToolStatusHints } from "../../../tool-status-hints.js";
import "../../../extensions/local-core-tool-status-hints.js";
import "../../../extensions/generic-tool-status-hints.js";
import { createUuid } from "../../../utils/ids.js";
import { createLogger, debugSuppressedError } from "../../../utils/logger.js";
import type { AttachmentInfo } from "../../../agent-pool/attachments.js";
import type { NewMessage } from "../../../types.js";
import type { AgentFailureCategory, AgentOutput } from "../../../agent-pool/contracts.js";
import { classifyOpaqueAgentFailure } from "../../../agent-pool/automatic-recovery.js";
import { cancelScheduledIdleAutoCompaction } from "../../../agent-pool/compaction.js";
import { DEFAULT_BASE_RETRY_MS, getRetryAtIso } from "../../../queue/retry-policy.js";
import { formatProviderError } from "./provider-error-format.js";
import { endTrackedPhase } from "../../../runtime/progress-watchdog.js";
import { getAddonGoalDeadlineCheckpointProvider, type AddonGoalDeadlineCheckpointLease } from "../../../addons/goal-deadline-checkpoint-provider.js";
import { getGoalDeadlineCheckpointReserveMs } from "../../../agent-pool/turn-coordinator.js";

const log = createLogger("web.handlers.agent");
const TOOL_BUDGET_CONTINUATION_EXTENSION_ID = "piclaw.tool-budget-continuation";

function loadDurableSourceMessage(chatJid: string, messageId: string): NewMessage | null {
  const row = getDb().prepare(`SELECT rowid, id, chat_jid, sender, sender_name, content, screen_hint,
    content_blocks, link_previews, thread_id, timestamp, is_from_me, is_bot_message
    FROM messages WHERE chat_jid = ? AND id = ?`).get(chatJid, messageId) as {
      rowid: number;
      id: string;
      chat_jid: string;
      sender: string;
      sender_name: string;
      content: string;
      screen_hint: string | null;
      content_blocks: string | null;
      link_previews: string | null;
      thread_id: number | null;
      timestamp: string;
      is_from_me: number;
      is_bot_message: number;
    } | undefined;
  if (!row) return null;
  const parseArray = (value: string | null): unknown[] | undefined => {
    if (!value) return undefined;
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  };
  return {
    id: row.id,
    chat_jid: row.chat_jid,
    sender: row.sender,
    sender_name: row.sender_name,
    content: row.content,
    screen_hint: row.screen_hint,
    content_blocks: parseArray(row.content_blocks),
    link_previews: parseArray(row.link_previews),
    thread_id: row.thread_id,
    timestamp: row.timestamp,
    is_from_me: row.is_from_me === 1,
    is_bot_message: row.is_bot_message === 1,
  };
}

function messagePrecedes(left: NewMessage, right: NewMessage): boolean {
  if (left.timestamp !== right.timestamp) return left.timestamp < right.timestamp;
  const leftRowId = getMessageRowIdById(left.chat_jid, left.id) ?? Number.MAX_SAFE_INTEGER;
  const rightRowId = getMessageRowIdById(right.chat_jid, right.id) ?? Number.MAX_SAFE_INTEGER;
  return leftRowId < rightRowId;
}

function durableOperationOwner(operation: ChatOperationState): ChatOperationOwner {
  return {
    operationId: operation.operationId,
    sourceSeq: operation.sourceSeq,
    phase: operation.phase,
    generation: operation.generation,
  };
}

function completeCancelledDurableOperation(
  chatJid: string,
  operation: ChatOperationState,
  provenance: string,
): boolean {
  if (!operation.cancellation) return false;
  const completed = completeChatOperation(chatJid, {
    owner: durableOperationOwner(operation),
    outcome: "cancelled",
    cause: operation.cancellation.cause,
    provenance,
    createdAt: new Date().toISOString(),
    intentDispositions: getChatOperationIntentSources(operation.operationId).map((intent) => ({
      sourceSeq: intent.sourceSeq,
      outcome: "cancelled" as const,
      cause: operation.cancellation!.cause,
      provenance,
    })),
  });
  return completed.status === "completed" || completed.status === "repeated";
}

function reserveContinuation(extensionId: string, chatJid: string, threadKey: string): boolean {
  const kv = getExtensionKvStore();
  const key = `continued:${threadKey}`;
  if (kv.get(extensionId, key, "chat", chatJid)) return false;
  kv.set(extensionId, key, {
    count: 1,
    createdAt: new Date().toISOString(),
  }, "chat", chatJid);
  return true;
}

function releaseContinuation(extensionId: string, chatJid: string, threadKey: string): void {
  getExtensionKvStore().delete(extensionId, `continued:${threadKey}`, "chat", chatJid);
}

function reserveToolBudgetContinuation(chatJid: string, threadKey: string): boolean {
  return reserveContinuation(TOOL_BUDGET_CONTINUATION_EXTENSION_ID, chatJid, threadKey);
}

function releaseToolBudgetContinuation(chatJid: string, threadKey: string): void {
  releaseContinuation(TOOL_BUDGET_CONTINUATION_EXTENSION_ID, chatJid, threadKey);
}

export type BrowserObservabilityContext = {
  userId?: string;
  sessionId?: string;
  clientId?: string;
};

type QueueDeferredFollowupExtras = {
  mediaIds?: number[];
  contentBlocks?: unknown[];
  linkPreviews?: unknown[];
  screenHint?: string;
  source?: string;
  browserContext?: BrowserObservabilityContext;
  wakeIfIdle?: boolean;
};

function readTrimmedHeader(req: Request, name: string): string | null {
  const value = req.headers.get(name);
  return value && value.trim() ? value.trim() : null;
}

function getBrowserObservabilityContext(req: Request): BrowserObservabilityContext {
  const userId = readTrimmedHeader(req, "x-piclaw-user-id");
  const sessionId = readTrimmedHeader(req, "x-piclaw-session-id");
  const clientId = readTrimmedHeader(req, "x-piclaw-client-id");
  return {
    ...(userId ? { userId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(clientId ? { clientId } : {}),
  };
}

function enqueueProcessChatAfterCompaction(
  channel: WebChannelLike,
  chatJid: string,
  agentId: string,
  messageId: string,
  threadRootId: number | undefined,
  browserObservability: BrowserObservabilityContext | undefined,
): void {
  channel.queue.enqueue(async () => {
    await processChat(channel, chatJid, agentId, threadRootId, browserObservability);
  }, `compaction-resume:${chatJid}:${messageId}`, `chat:${chatJid}`);
}

function describeNetworkError(errorText: string): string {
  if (/ENOTFOUND|getaddrinfo|dns/i.test(errorText)) {
    const hostMatch = errorText.match(/ENOTFOUND\s+(\S+)|getaddrinfo.*?\s+(\S+?)(?:\s|$|:)/i);
    const host = hostMatch?.[1] || hostMatch?.[2] || '';
    return host ? `DNS lookup failed for ${host}` : 'DNS lookup failed — provider hostname not reachable';
  }
  if (/ECONNREFUSED|connection.*refused/i.test(errorText)) {
    return 'Connection refused — provider API endpoint is down or blocked';
  }
  if (/ETIMEDOUT|timed? out|timeout/i.test(errorText)) {
    return 'Connection timed out — provider API did not respond';
  }
  if (/ECONNRESET|connection.*(?:reset|ended|closed)|websocket.*(?:closed|ended|1006)|socket hang up/i.test(errorText)) {
    return 'Connection closed — provider closed the connection unexpectedly';
  }
  if (/fetch failed/i.test(errorText)) {
    return 'Network request failed — check provider URL and connectivity';
  }
  return 'Network error — check provider connectivity';
}

type TurnOutcomeSeverity = "warning" | "error" | "critical" | "info";

function buildTurnOutcomeMarker(options: {
  kind: string;
  label: string;
  title: string;
  detail?: string;
  severity?: TurnOutcomeSeverity;
  draftRecovered?: boolean;
  attemptsUsed?: number;
  classifier?: string | null;
  failureCategory?: AgentFailureCategory;
  toolBudgetExceeded?: boolean;
  toolStepsUsed?: number;
  toolStepsBudget?: number;
  nextAction?: string;
  abortCause?: string;
  abortOperation?: string;
}): Record<string, unknown> {
  return {
    type: "turn_outcome_marker",
    kind: options.kind,
    label: options.label,
    title: options.title,
    detail: options.detail,
    severity: options.severity ?? "warning",
    draft_recovered: Boolean(options.draftRecovered),
    attempts_used: Number.isFinite(options.attemptsUsed) ? options.attemptsUsed : undefined,
    classifier: options.classifier ?? null,
    failure_category: options.failureCategory,
    tool_budget_exceeded: options.toolBudgetExceeded ? true : undefined,
    tool_steps_used: Number.isFinite(options.toolStepsUsed) ? options.toolStepsUsed : undefined,
    tool_steps_budget: Number.isFinite(options.toolStepsBudget) ? options.toolStepsBudget : undefined,
    next_action: readTrimmedString(options.nextAction) || undefined,
    abort_cause: readTrimmedString(options.abortCause) || undefined,
    abort_operation: readTrimmedString(options.abortOperation) || undefined,
  };
}

function buildErrorOutcomeMarker(
  errorText: string,
  options: {
    failureCategory?: AgentFailureCategory;
    draftRecovered?: boolean;
    attemptsUsed?: number;
    classifier?: string | null;
    severity?: TurnOutcomeSeverity;
    toolBudgetExceeded?: boolean;
    toolStepsUsed?: number;
    toolStepsBudget?: number;
    nextAction?: string;
    abortCause?: string;
    abortOperation?: string;
  } = {},
): Record<string, unknown> {
  const category = options.failureCategory ?? "unknown";
  const detail = errorText.slice(0, 500);
  const providerError = formatProviderError(errorText);
  const common = {
    detail,
    draftRecovered: options.draftRecovered,
    attemptsUsed: options.attemptsUsed,
    classifier: options.classifier,
    failureCategory: category,
  };

  if (category === "tool_budget" || options.toolBudgetExceeded) {
    return buildTurnOutcomeMarker({
      ...common,
      kind: "tool_budget",
      label: "tool budget",
      title: "Tool-use budget exceeded",
      severity: "warning",
      toolBudgetExceeded: true,
      toolStepsUsed: options.toolStepsUsed,
      toolStepsBudget: options.toolStepsBudget,
      nextAction: options.nextAction || "Ask me to continue; I will resume from the latest known partial state instead of replaying the whole turn.",
      abortCause: options.abortCause,
      abortOperation: options.abortOperation,
    });
  }

  if (category === "rate_limit") {
    return buildTurnOutcomeMarker({ ...common, kind: "provider", label: "rate limit", title: "Provider retry budget exhausted", severity: "warning" });
  }
  if (category === "auth_config") {
    return buildTurnOutcomeMarker({
      ...common,
      kind: "provider",
      label: "provider",
      title: "Provider authentication/configuration required",
      detail: `${detail} — Sign in with /login or configure provider credentials, then retry.`,
      severity: options.severity ?? "error",
    });
  }
  if (category === "network") {
    return buildTurnOutcomeMarker({ ...common, kind: "network", label: "network", title: describeNetworkError(errorText), severity: options.severity ?? "error" });
  }
  if (category === "aborted") {
    return buildTurnOutcomeMarker({
      ...common,
      kind: "abort",
      label: "aborted",
      title: "Turn aborted",
      severity: options.severity ?? "warning",
      abortCause: options.abortCause,
      abortOperation: options.abortOperation,
    });
  }
  if (category === "session_corruption" || category === "context_pressure") {
    return buildTurnOutcomeMarker({
      ...common,
      kind: "context",
      label: providerError?.label ?? "context",
      title: providerError?.title ?? "Session context needs repair",
      detail: providerError?.detail ?? detail,
      severity: providerError?.severity ?? options.severity ?? "error",
    });
  }
  if (category === "timeout") {
    return buildTurnOutcomeMarker({ ...common, kind: "timeout", label: "timeout", title: "Timed out", severity: options.severity ?? "warning" });
  }
  if (category === "output_limit") {
    return buildTurnOutcomeMarker({ ...common, kind: "provider", label: "output limit", title: "Provider output limit reached", severity: options.severity ?? "warning" });
  }
  if (category === "no_terminal_output") {
    return buildTurnOutcomeMarker({ ...common, kind: "blank_final", label: "no reply", title: "No final reply produced", severity: options.severity ?? "warning" });
  }
  if (category === "stalled_work") {
    return buildTurnOutcomeMarker({ ...common, kind: "timeout", label: "stalled work", title: "Stalled work interrupted", severity: options.severity ?? "warning" });
  }

  // Provider-specific extraction is presentation-only: it may improve wording,
  // but cannot alter persistence, retry, continuation, or success authority.
  return buildTurnOutcomeMarker({
    ...common,
    kind: category === "provider" || category === "provider_unavailable" ? "provider" : "error",
    label: providerError?.label ?? (category === "provider" ? "provider" : "error"),
    title: providerError?.title ?? "Turn failed",
    detail: providerError?.detail ?? detail,
    severity: providerError?.severity ?? options.severity ?? "warning",
  });
}

interface FailureActionSummary {
  summary: string;
  title?: string;
  toolName?: string;
  statusText?: string;
}

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function summarizeFailureActionFromStatus(status: Record<string, unknown> | null | undefined): FailureActionSummary | null {
  if (!status || typeof status !== "object") return null;

  const type = readTrimmedString(status.type);
  const title = readTrimmedString(status.title);
  const detail = readTrimmedString(status.detail);
  const toolName = readTrimmedString(status.tool_name ?? status.toolName);
  const statusText = readTrimmedString(status.status ?? status.tool_status ?? status.toolStatus);

  if (type === "thinking" && !toolName) return null;

  let summary = "";
  if ((type === "tool_call" || type === "tool_status") && (title || toolName)) {
    const statusSuffix = statusText && !/^(working\.\.\.|done)$/i.test(statusText) ? statusText : "";
    summary = [title || toolName, statusSuffix].filter(Boolean).join(" — ");
  } else if (type === "intent") {
    summary = [title, detail].filter(Boolean).join(" — ");
  } else if (title) {
    summary = [title, detail].filter(Boolean).join(" — ");
  }

  if (!summary) return null;
  return {
    summary,
    title: title || undefined,
    toolName: toolName || undefined,
    statusText: statusText || undefined,
  };
}

function withFailureActionMetadata(
  marker: Record<string, unknown> | null,
  action: FailureActionSummary | null,
): Record<string, unknown> | null {
  if (!marker || !action?.summary) return marker;
  return {
    ...marker,
    tool_action_summary: action.summary,
    tool_title: action.title,
    tool_name: action.toolName,
    tool_status: action.statusText,
  };
}

function buildFailureVisibleText(options: {
  draftText?: string;
  title?: string;
  detail?: string;
  actionSummary?: string;
  attemptsUsed?: number;
  classifier?: string;
  nextAction?: string;
  inlineDiagnostic?: boolean;
  showDiagnosticWithoutDraft?: boolean;
}): string {
  const draftText = readTrimmedString(options.draftText);
  const title = readTrimmedString(options.title) || "Turn failed";
  const detail = readTrimmedString(options.detail);
  const actionSummary = readTrimmedString(options.actionSummary);
  const nextAction = readTrimmedString(options.nextAction) || null;
  const diagnostic = [
    `⚠️ ${title}`,
    actionSummary || null,
    detail && !actionSummary.includes(detail) ? detail : null,
    nextAction,
  ].filter(Boolean).join("\n");
  if (draftText && options.inlineDiagnostic) {
    return diagnostic ? `${draftText}\n\n${diagnostic}` : draftText;
  }
  // Diagnostic info is usually carried in the outcome marker content block and
  // rendered by the client as a collapsible pill. Keep ordinary recovered drafts
  // concise, but make recovery-budget timeout failures readable without a draft.
  if (draftText) return draftText;
  return options.showDiagnosticWithoutDraft ? diagnostic : "";
}

function buildRetryStatusPayload(base: {
  threadId: string | number | null;
  agentId: string;
  turnId: string;
  title: string;
  detail?: string;
}): Record<string, unknown> {
  const startedAt = new Date().toISOString();
  return {
    thread_id: base.threadId,
    agent_id: base.agentId,
    type: "intent",
    title: base.title,
    ...(base.detail ? { detail: base.detail } : {}),
    turn_id: base.turnId,
    started_at: startedAt,
    retry_at: getRetryAtIso(1, DEFAULT_BASE_RETRY_MS, Date.parse(startedAt)),
    retry_delay_ms: DEFAULT_BASE_RETRY_MS,
  };
}

export function buildAgentStatusPhaseKey(payload: Record<string, unknown>): string {
  const type = typeof payload.type === "string" ? payload.type : "unknown";
  const intentKey = typeof payload.intent_key === "string"
    ? payload.intent_key.trim()
    : (typeof payload.intentKey === "string" ? payload.intentKey.trim() : "");
  const classifier = typeof payload.classifier === "string" ? payload.classifier.trim() : "";
  const toolCallId = typeof payload.tool_call_id === "string"
    ? payload.tool_call_id.trim()
    : (typeof payload.toolCallId === "string" ? payload.toolCallId.trim() : "");
  const toolName = typeof payload.tool_name === "string"
    ? payload.tool_name.trim()
    : (typeof payload.toolName === "string" ? payload.toolName.trim() : "");
  const phase = typeof payload.phase === "string"
    ? payload.phase.trim()
    : (typeof payload.state === "string" ? payload.state.trim() : "");

  if (type === "tool_call" || type === "tool_status") {
    return `tool:${toolCallId || toolName || "unknown"}`;
  }
  if (type === "intent") {
    return `intent:${intentKey || classifier || "generic"}`;
  }
  return `${type}:${phase}`;
}

function withAgentStatusProgressMetadata(
  payload: Record<string, unknown>,
  previousStatus: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const now = new Date().toISOString();
  const next = { ...payload };
  const type = typeof next.type === "string" ? next.type : "";

  if (type === "done" || type === "error") {
    return {
      ...next,
      last_event_at: now,
      phase_key: buildAgentStatusPhaseKey(next),
    };
  }

  const previous = previousStatus && typeof previousStatus === "object" ? previousStatus : null;
  const previousPhaseKey = previous && typeof previous.phase_key === "string"
    ? previous.phase_key
    : previous
      ? buildAgentStatusPhaseKey(previous)
      : null;
  const nextPhaseKey = buildAgentStatusPhaseKey(next);
  const previousStartedAt = previous && typeof previous.started_at === "string"
    ? previous.started_at
    : (previous && typeof previous.startedAt === "string" ? previous.startedAt : null);
  const previousRunStartedAt = previous && typeof previous.run_started_at === "string"
    ? previous.run_started_at
    : (previous && typeof previous.runStartedAt === "string" ? previous.runStartedAt : null);

  return {
    ...next,
    started_at: typeof next.started_at === "string"
      ? next.started_at
      : previousPhaseKey === nextPhaseKey && previousStartedAt
        ? previousStartedAt
        : now,
    run_started_at: typeof next.run_started_at === "string"
      ? next.run_started_at
      : previousRunStartedAt || now,
    last_event_at: now,
    phase_key: nextPhaseKey,
  };
}

export function withResolvedToolStatusHints(chatJid: string, payload: Record<string, unknown>): Record<string, unknown> {
  const isToolStatus = payload?.type === "tool_call" || payload?.type === "tool_status";
  const toolName = typeof payload?.tool_name === "string" ? payload.tool_name.trim() : "";
  if (!isToolStatus || !toolName) return payload;

  const existingHints = Array.isArray(payload?.status_hints)
    ? payload.status_hints
    : (Array.isArray(payload?.statusHints) ? payload.statusHints : []);
  if (existingHints.length > 0) return payload;

  const statusHints = resolveToolStatusHints({
    chatJid,
    toolName,
    args: payload?.tool_args,
    payload,
  });
  if (statusHints.length === 0) return payload;
  return { ...payload, status_hints: statusHints };
}

export function stripMarkdownCodeFenceMarkers(value: string): string {
  return value
    .replace(/^```[a-zA-Z0-9_-]*\s*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .trim();
}

export function buildRecoveryMarkerBlocks(recovery: { attemptsUsed?: number; lastClassifier?: string | null } | null | undefined): Array<Record<string, unknown>> | undefined {
  if (!recovery?.attemptsUsed) return undefined;
  return [{
    type: "recovery_marker",
    recovered: true,
    attempts_used: recovery.attemptsUsed,
    classifier: recovery.lastClassifier ?? null,
    label: recovery.attemptsUsed === 1
      ? "Recovered automatically"
      : `Recovered after ${recovery.attemptsUsed} attempts`,
  }];
}

export function summarizeCommandStatusTitle(message: unknown, fallback = "Command failed"): string {
  const raw = typeof message === "string" ? message.trim() : "";
  if (!raw) return fallback;
  const unfenced = stripMarkdownCodeFenceMarkers(raw);
  const collapsed = unfenced.replace(/\s*\n\s*/g, " ").trim();
  return collapsed || fallback;
}

function parseLeadingAgentMention(content: string): { agentName: string; remainder: string } | null {
  const match = content.match(/^\s*@([a-zA-Z0-9][a-zA-Z0-9_-]{0,31})(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return {
    agentName: match[1].toLowerCase(),
    remainder: (match[2] ?? "").trim(),
  };
}

function fallbackAgentHandle(chatJid: string): string {
  return (chatJid.split(/[:/]/).filter(Boolean).pop() || chatJid)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "agent";
}

function shouldPersistSteerRequest(req: Request, payload: { persist_steer?: boolean } | undefined): boolean {
  return payload?.persist_steer === true || req.headers.get("X-Piclaw-Persist-Steer") === "1";
}

/**
 * Handle a web `/agent/:agentId/message` request by storing user input and starting/queuing a run.
 * @param channel Web channel contract providing persistence, queueing, and broadcast helpers.
 * @param req Incoming HTTP request containing normalized message payload data.
 * @param pathname Request pathname used to resolve the explicit target agent id.
 * @param chatJid Chat JID that should receive the message/run.
 * @param defaultAgentId Fallback agent id when the route does not include one explicitly.
 * @returns A JSON response describing created messages, queueing, or routing failures.
 */
export async function handleAgentMessage(
  channel: WebChannelLike,
  req: Request,
  pathname: string,
  chatJid: string,
  defaultAgentId: string
): Promise<Response> {
  const agentId = pathname.split("/")[2] || defaultAgentId;
  const browserObservability = getBrowserObservabilityContext(req);
  const parsed = await parseAgentMessageRequest(req);
  if (parsed.error || !parsed.payload) return channel.json({ error: parsed.error }, 400);

  const normalized = normalizeAgentMessagePayload(parsed.payload);
  let content = typeof normalized.content === "string" ? normalized.content : "";
  const hasAttachments =
    normalized.mediaIds.length > 0 ||
    (Array.isArray(normalized.contentBlocks) && normalized.contentBlocks.length > 0) ||
    (Array.isArray(normalized.linkPreviews) && normalized.linkPreviews.length > 0);
  const hasPayload = content.trim().length > 0 || hasAttachments;
  if (!hasPayload) return channel.json({ error: "Missing 'content' field" }, 400);

  const requestMode = normalized.mode ?? "auto";
  const persistSteer = shouldPersistSteerRequest(req, parsed.payload);
  const mention = content.trim().length > 0 ? parseLeadingAgentMention(content) : null;
  const mentionTarget = mention
    ? (typeof (channel.agentPool as { findChatByAgentName?: (name: string) => { chat_jid: string; agent_name: string } | null }).findChatByAgentName === "function"
      ? (channel.agentPool as { findChatByAgentName: (name: string) => { chat_jid: string; agent_name: string } | null }).findChatByAgentName(mention.agentName)
      : (typeof (channel.agentPool as { findActiveChatByAgentName?: (name: string) => { chat_jid: string; agent_name: string } | null }).findActiveChatByAgentName === "function"
          ? (channel.agentPool as { findActiveChatByAgentName: (name: string) => { chat_jid: string; agent_name: string } | null }).findActiveChatByAgentName(mention.agentName)
          : null))
    : null;
  if (mention && !mentionTarget) {
    return channel.json({ error: `Unknown agent @${mention.agentName}` }, 404);
  }
  if (mention && mentionTarget && mentionTarget.chat_jid === chatJid) {
    content = mention.remainder;
  }
  if (mention && mentionTarget && mentionTarget.chat_jid !== chatJid && !mention.remainder && !hasAttachments) {
    return channel.json({ error: `Missing message body for @${mention.agentName}` }, 400);
  }
  if (content.trim().length === 0 && !hasAttachments) {
    return channel.json({ error: "Missing 'content' field" }, 400);
  }

  cancelScheduledIdleAutoCompaction(chatJid);

  const command = parseControlCommand(content, getRoutingConfig().triggerPattern);
  const trimmed = content.trim();
  const themeCommand = handleUiThemeCommand(trimmed);
  const metersCommand = handleUiMetersCommand(trimmed);
  const isSettingsCommand = /^\/settings\s*$/i.test(trimmed);
  const isStreaming = typeof channel.agentPool.isStreaming === "function"
    ? channel.agentPool.isStreaming(chatJid)
    : false;
  const isActive = typeof (channel.agentPool as { isActive?: (chatJid: string) => boolean }).isActive === "function"
    ? (channel.agentPool as { isActive: (chatJid: string) => boolean }).isActive(chatJid)
    : isStreaming;
  const hasQueuedBacklog = channel.getQueuedFollowupCount(chatJid) > 0;
  // NOTE: we intentionally use the in-memory active-run flags—not the DB
  // inflight marker—to decide whether to queue/defer. The DB marker survives
  // restarts and can be stale (cleared only when recovery runs), so trusting
  // it here would silently defer messages against ghost turns that no
  // processChat is actively draining. The in-memory session state resets on
  // restart and reflects whether the agent pool still has an active run,
  // including streaming/compaction/retry phases of the same turn.

  if (mention && mentionTarget && mentionTarget.chat_jid !== chatJid) {
    const sourceInteraction = storeAgentUserMessage(channel, chatJid, {
      content: typeof normalized.content === "string" ? normalized.content : content,
      mediaIds: normalized.mediaIds,
      contentBlocks: normalized.contentBlocks,
      linkPreviews: normalized.linkPreviews,
      screenHint: normalized.screenHint,
    });
    if (!sourceInteraction) return channel.json({ error: "Failed to store message" }, 500);

    channel.broadcastEvent("new_post", sourceInteraction);
    setChatCursor(chatJid, sourceInteraction.timestamp);

    const sourceAgentName = typeof (channel.agentPool as { getAgentHandleForChat?: (chatJid: string) => string }).getAgentHandleForChat === "function"
      ? (channel.agentPool as { getAgentHandleForChat: (chatJid: string) => string }).getAgentHandleForChat(chatJid)
      : fallbackAgentHandle(chatJid);
    const forwardedContent = mention.remainder;
    const forwardHeaders = new Headers({ "Content-Type": "application/json" });
    if (browserObservability.userId) forwardHeaders.set("x-piclaw-user-id", browserObservability.userId);
    if (browserObservability.sessionId) forwardHeaders.set("x-piclaw-session-id", browserObservability.sessionId);
    if (browserObservability.clientId) forwardHeaders.set("x-piclaw-client-id", browserObservability.clientId);
    const forwardReq = new Request(`http://internal/agent/${agentId}/message?chat_jid=${encodeURIComponent(mentionTarget.chat_jid)}`, {
      method: "POST",
      headers: forwardHeaders,
      body: JSON.stringify({
        content: forwardedContent,
        media_ids: normalized.mediaIds,
        content_blocks: normalized.contentBlocks,
        link_previews: normalized.linkPreviews,
        mode: requestMode,
        ...(persistSteer ? { persist_steer: true } : {}),
        screen_hint: normalized.screenHint,
      }),
    });

    const forwardRes = await handleAgentMessage(channel, forwardReq, pathname, mentionTarget.chat_jid, defaultAgentId);
    if (!forwardRes.ok) {
      return forwardRes;
    }

    const responseBody = await forwardRes.json().catch(() => ({} as Record<string, unknown>));
    return channel.json({
      ...responseBody,
      user_message: sourceInteraction,
      source_chat_jid: chatJid,
      source_agent_name: sourceAgentName,
      target_chat_jid: mentionTarget.chat_jid,
      target_agent_name: mentionTarget.agent_name,
      relayed: true,
      mention_routed: true,
    }, forwardRes.status);
  }

  const queueDeferredFollowup = (
    queuedContent: string,
    extras: QueueDeferredFollowupExtras = {}
  ): Response => {
    const queuedAt = new Date().toISOString();
    // Don't inherit the active turn's thread root. Deferred followups are
    // independent messages typed while the agent was busy — they should
    // start their own thread when materialized (self-rooted via
    // storeWebMessage's default behaviour).
    const queuedThreadId: number | null = null;
    const queuedBy = extras.browserContext
      ? {
          ...(extras.browserContext.userId ? { userId: extras.browserContext.userId } : {}),
          ...(extras.browserContext.sessionId ? { sessionId: extras.browserContext.sessionId } : {}),
          ...(extras.browserContext.clientId ? { clientId: extras.browserContext.clientId } : {}),
        }
      : undefined;
    const queuedRowId = channel.enqueueQueuedFollowupItem(chatJid, 0, queuedContent, queuedThreadId, queuedAt, {
      mediaIds: extras.mediaIds,
      contentBlocks: extras.contentBlocks,
      linkPreviews: extras.linkPreviews,
      screenHint: extras.screenHint,
      source: extras.source,
      queuedBy: queuedBy && Object.keys(queuedBy).length > 0 ? queuedBy : undefined,
    });
    channel.broadcastEvent("agent_followup_queued", {
      chat_jid: chatJid,
      thread_id: queuedThreadId,
      row_id: queuedRowId,
      content: queuedContent,
      timestamp: queuedAt,
      ...(extras.source ? { source: extras.source } : {}),
      ...(queuedBy && Object.keys(queuedBy).length > 0 ? { queued_by: queuedBy } : {}),
    });
    if (extras.wakeIfIdle) {
      channel.resumeChat(chatJid);
    }
    return channel.json({ queued: "followup", thread_id: queuedThreadId }, 201);
  };

  const queueDeferredSteer = async (steerContent: string, source?: string): Promise<Response | null> => {
    if (!isStreaming) return null;
    const steerResult = await channel.agentPool.queueStreamingMessage(chatJid, steerContent, "steer");
    if (!steerResult.queued) return null;
    const queuedAt = new Date().toISOString();
    channel.broadcastEvent("agent_steer_queued", {
      chat_jid: chatJid,
      thread_id: null,
      source,
      timestamp: queuedAt,
      content: steerContent,
    });
    return channel.json({ queued: "steer", thread_id: null }, 201);
  };

  log.info("Handling agent message", {
    operation: "handle_agent_message",
    chatJid,
    mode: requestMode,
    isStreaming,
    isActive,
    hasQueuedBacklog,
    shouldDefer: false,
    hasCommand: Boolean(command),
    contentPreview: content.slice(0, 60),
  });

  if (!persistSteer && !command && !themeCommand && !metersCommand && !isSettingsCommand && isStreaming && requestMode === "steer") {
    const steerResponse = await queueDeferredSteer(content, "compose");
    if (steerResponse) return steerResponse;
  }

  if ((command?.type === "queue" || command?.type === "queue_all") && isStreaming) {
    const queuedText = (command.message || "").trim();
    if (queuedText) {
      return queueDeferredFollowup(queuedText, { source: "web.queue_command", browserContext: browserObservability });
    }
  }

  if (command?.type === "steer" && isStreaming) {
    const steerText = (command.message || "").trim();
    if (steerText) {
      const steerResponse = await queueDeferredSteer(steerText, "command");
      if (steerResponse) return steerResponse;
    }
  }

  if (themeCommand) {
    if (themeCommand.payload) {
      const uiTheme = setServerUiThemeConfig({ theme: themeCommand.payload.theme, tint: themeCommand.payload.tint ?? null });
      channel.broadcastEvent("ui_theme", { ...uiTheme });
    }

    const formattedThemeMessage = formatOutbound(themeCommand.message, "web");
    if (formattedThemeMessage) {
      try {
        // Keep /theme purely UI-scope but still surface the command output to the
        // timeline so users can see the theme list/output immediately.
        await channel.sendMessage(chatJid, formattedThemeMessage, { forceRoot: true });
      } catch (error) {
        log.error("Failed to send /theme response", {
          operation: "handle_agent_message.theme_response",
          chatJid,
          err: error,
        });
      }
    }

    return channel.json(
      { thread_id: null, command: themeCommand, ui_only: true },
      200
    );
  }

  if (metersCommand) {
    if (metersCommand.payload) {
      const currentMeters = getServerUiMetersConfig();
      const nextMeters = metersCommand.payload.mode === "toggle"
        ? setServerUiMetersConfig({ enabled: !currentMeters.enabled })
        : metersCommand.payload.mode === "set"
          ? setServerUiMetersConfig({ enabled: metersCommand.payload.enabled })
          : setServerUiMetersConfig({ collapsed: metersCommand.payload.collapsed });
      channel.broadcastEvent("ui_meters", { chat_jid: chatJid, mode: "set", ...nextMeters });
    }

    const formattedMetersMessage = formatOutbound(metersCommand.message, "web");
    if (formattedMetersMessage) {
      try {
        await channel.sendMessage(chatJid, formattedMetersMessage, { forceRoot: true });
      } catch (error) {
        log.error("Failed to send /meters response", {
          operation: "handle_agent_message.meters_response",
          chatJid,
          err: error,
        });
      }
    }

    return channel.json(
      { thread_id: null, command: metersCommand, ui_only: true },
      200
    );
  }

  if (isSettingsCommand) {
    channel.broadcastEvent("ui_open_tab", { chat_jid: chatJid, path: "piclaw://settings", label: "Settings" });
    return channel.json(
      { thread_id: null, command: { message: "Opening settings…" }, ui_only: true },
      200,
    );
  }

  if (command?.type === "abort" && !hasAttachments) {
    const activeOperation = getChatOperation(chatJid);
    if (activeOperation) {
      const result = await channel.agentPool.cancelOperationAndAbort(
        chatJid,
        activeOperation.operationId,
        "user_abort",
      );
      if (result.status === "cancelled") channel.resumeChat(chatJid);
      return channel.json(
        {
          thread_id: null,
          command: {
            status: result.status === "cancelled" ? "success" : "error",
            message: result.status === "cancelled"
              ? "Operation cancellation persisted."
              : "The active operation changed before cancellation; no action was taken.",
            cancellation_status: result.status,
            physically_aborted: result.physicallyAborted,
          },
          ui_only: true,
          immediate: isActive,
        },
        200,
      );
    }

    const result = await channel.agentPool.applyControlCommand(chatJid, command);
    return channel.json(
      {
        thread_id: null,
        command: result,
        ui_only: true,
        immediate: isActive,
      },
      200,
    );
  }

  // Model/thinking commands: execute without writing to the timeline,
  // EXCEPT for bare /model (list) and bare /thinking (query) which should
  // surface their table/output as a timeline message like /theme does.
  if (command && MODEL_COMMAND_TYPES.has(command.type)) {
    const result = await channel.agentPool.applyControlCommand(chatJid, command);

    // Broadcast model state so the UI hint updates immediately
    let modelState: { model: string | null; thinkingLevel: string | null; thinkingLevelLabel: string | null; supportsThinking: boolean | undefined } | null = null;
    if (result.status === "success") {
      modelState = await resolveAndBroadcastModelStateForCommand(channel, chatJid, result);
      if (command.type === "model" || command.type === "thinking" || command.type === "cycle_model" || command.type === "cycle_thinking") {
        resumeFailedRunAfterModelSwitch(channel, chatJid, command);
      }
    }

    // Bare /model (list) or bare /thinking (query) — write output to the timeline
    const isBareModelList = command.type === "model" && !(command as any).modelId && !(command as any).provider;
    const isBareThinkingQuery = command.type === "thinking" && !(command as any).level;
    if ((isBareModelList || isBareThinkingQuery) && result.message) {
      const formattedMessage = formatOutbound(result.message, "web");
      if (formattedMessage) {
        try {
          await channel.sendMessage(chatJid, formattedMessage, { forceRoot: true });
        } catch (error) {
          log.error("Failed to send model/thinking list response", {
            operation: "handle_agent_message.model_list_response",
            chatJid,
            err: error,
          });
        }
      }
    }

    return channel.json(
      {
        thread_id: null,
        command: {
          ...result,
          model_label: modelState?.model ?? (result as { model_label?: string | null }).model_label ?? null,
          thinking_level: modelState?.thinkingLevel ?? (result as { thinking_level?: string | null }).thinking_level ?? null,
          thinking_level_label: modelState?.thinkingLevelLabel ?? (result as { thinking_level_label?: string | null }).thinking_level_label ?? (result as { thinking_level?: string | null }).thinking_level ?? null,
          supports_thinking: modelState?.supportsThinking,
        },
        ui_only: true,
      },
      200,
    );
  }

  // Check early whether this message should be deferred as a queued followup.
  // If so, skip DB persistence entirely — the message will be stored when
  // materialised from the in-memory queue after the current turn completes.
  // This prevents the cursor from advancing past queued messages during
  // finalizeSuccessfulRun, which would cause them to be silently consumed.
  const shouldDeferQueuedFollowup =
    !command &&
    !themeCommand &&
    !metersCommand &&
    !isSlashCommandInvocation(trimmed) &&
    (isActive || hasQueuedBacklog) &&
    (requestMode === "queue" || requestMode === "auto");

  if (shouldDeferQueuedFollowup) {
    log.info("Deferring agent message as queued follow-up", {
      operation: "handle_agent_message.defer_followup",
      chatJid,
      mode: requestMode,
      isStreaming,
      isActive,
      hasQueuedBacklog,
      shouldDefer: true,
      hasCommand: Boolean(command),
      contentPreview: content.slice(0, 60),
    });

    const response = queueDeferredFollowup(content, {
      mediaIds: normalized.mediaIds,
      contentBlocks: normalized.contentBlocks,
      linkPreviews: normalized.linkPreviews,
      screenHint: normalized.screenHint,
      source: "web.compose",
      browserContext: browserObservability,
      wakeIfIdle: hasQueuedBacklog && !isActive,
    });

    return response;
  }

  const durableDirectNormal = new URL(req.url).hostname !== "internal"
    && !command
    && !themeCommand
    && !metersCommand
    && !isSettingsCommand
    && !isSlashCommandInvocation(trimmed)
    && requestMode !== "steer"
    && !isActive
    && !hasQueuedBacklog;
  let interaction: ReturnType<typeof storeAgentUserMessage> = null;
  try {
    if (durableDirectNormal) {
      interaction = getDb().transaction(() => {
        const stored = storeAgentUserMessage(channel, chatJid, {
          content,
          mediaIds: normalized.mediaIds,
          contentBlocks: normalized.contentBlocks,
          linkPreviews: normalized.linkPreviews,
          threadId: normalized.threadId,
          screenHint: normalized.screenHint,
        });
        if (!stored) throw new Error("Failed to store durable web message");
        acceptStoredChatMessageSource(chatJid, stored.id);
        return stored;
      }).immediate();
    } else {
      interaction = storeAgentUserMessage(channel, chatJid, {
        content,
        mediaIds: normalized.mediaIds,
        contentBlocks: normalized.contentBlocks,
        linkPreviews: normalized.linkPreviews,
        threadId: normalized.threadId,
        screenHint: normalized.screenHint,
      });
    }
  } catch (error) {
    log.error("Failed to persist accepted web message", {
      operation: "handle_agent_message.accept_failed",
      chatJid,
      durableDirectNormal,
      err: error,
    });
    return channel.json({ error: "Failed to store message" }, 500);
  }

  if (!interaction) return channel.json({ error: "Failed to store message" }, 500);

  // Defer new_post broadcast — don't emit for messages that will be queued
  // as follow-ups (prevents flash in timeline before filtering kicks in).
  let newPostBroadcast = false;
  const broadcastNewPost = () => {
    if (!newPostBroadcast) {
      newPostBroadcast = true;
      channel.broadcastEvent("new_post", interaction);
    }
  };

  let threadId = resolveThreadId(normalized.threadId, interaction.id);

  const identity = getIdentityConfig();
  const withAgentProfile = createAgentProfileBuilder(
    chatJid,
    identity.assistantName,
    resolveAvatarUrl("agent", identity.assistantAvatar),
    identity.userName || null,
    resolveAvatarUrl("user", identity.userAvatar),
    identity.userAvatarBackground || null
  );

  const emitCommandStatus = (payload: Record<string, unknown>) => {
    const activeStatus = typeof channel.getAgentStatus === "function"
      ? channel.getAgentStatus(chatJid)
      : null;
    const nextPayload = withAgentStatusProgressMetadata(payload, activeStatus);
    channel.updateAgentStatus(chatJid, nextPayload);
    channel.broadcastEvent("agent_status", withAgentProfile(nextPayload));
  };

  const publishCommandContextUsage = async (
    result: { contextUsage?: { tokens: number | null; contextWindow: number | null; percent: number | null; estimated?: boolean; source?: string; phase?: string } },
    payload: { threadId: string | number | null; turnId: string },
  ): Promise<void> => {
    let contextUsage = result.contextUsage;
    if (contextUsage?.tokens === null || contextUsage?.tokens === undefined) {
      const current = typeof channel.agentPool.getContextUsageForChat === "function"
        ? await channel.agentPool.getContextUsageForChat(chatJid).catch(() => null)
        : null;
      if (current?.tokens !== null && current?.tokens !== undefined) {
        contextUsage = {
          tokens: current.tokens,
          contextWindow: current.contextWindow,
          percent: current.percent,
          source: "agent_pool",
          phase: "after_command",
        };
      }
    }
    if (!contextUsage || contextUsage.tokens === null) return;
    const persistedUsage = {
      tokens: contextUsage.tokens,
      contextWindow: contextUsage.contextWindow,
      percent: contextUsage.percent,
    };
    const statusUsage = {
      ...persistedUsage,
      estimated: contextUsage.estimated === true,
      source: contextUsage.source ?? null,
      phase: contextUsage.phase ?? null,
    };
    if (typeof channel.setContextUsage === "function") channel.setContextUsage(chatJid, persistedUsage);
    emitCommandStatus({
      thread_id: payload.threadId,
      agent_id: agentId,
      turn_id: payload.turnId,
      type: "context_usage",
      context_usage: statusUsage,
    });
  };

  const queueFollowupMessage = async (): Promise<Response | null> => {
    // Web queued follow-ups are managed by the web channel itself rather than
    // AgentSession's internal follow-up queue. This guarantees the current turn
    // finalizes and publishes before the next queued user message begins.
    // Treat non-streaming compaction/retry phases as active too: submitting
    // during compaction must queue behind the current session instead of
    // starting a competing processChat run.
    if (!isActive) {
      return null;
    }

    channel.enqueueQueuedFollowupItem(
      chatJid,
      interaction.id,
      content,
      interaction.id,
      interaction.timestamp,
      {
        source: "web.compose_persisted",
        queuedBy: {
          ...(browserObservability.userId ? { userId: browserObservability.userId } : {}),
          ...(browserObservability.sessionId ? { sessionId: browserObservability.sessionId } : {}),
          ...(browserObservability.clientId ? { clientId: browserObservability.clientId } : {}),
        },
      }
    );
    channel.broadcastEvent("agent_followup_queued", {
      chat_jid: chatJid,
      thread_id: interaction.data?.thread_id ?? interaction.id ?? null,
      row_id: interaction.id,
      content,
      timestamp: interaction.timestamp,
      source: "web.compose_persisted",
    });

    return channel.json(
      {
        user_message: interaction,
        thread_id: threadId,
        queued: "followup",
      },
      201
    );
  };

  const queueSteerMessage = async (source?: string): Promise<Response | null> => {
    const activeOperation = getChatOperation(chatJid);
    const persistedMessageId = interaction.id
      ? (getDb().prepare("SELECT id FROM messages WHERE rowid = ?").get(interaction.id) as { id: string } | undefined)?.id ?? null
      : null;
    const steerResult = await channel.agentPool.queueStreamingMessage(chatJid, content, "steer", activeOperation && persistedMessageId
      ? {
          operationOwner: durableOperationOwner(activeOperation),
          beforeQueue: () => {
            const registered = registerChatOperationIntent(chatJid, durableOperationOwner(activeOperation), {
              sourceKind: "steer",
              sourceId: persistedMessageId,
              acceptedAt: interaction.timestamp,
              payloadRef: `message:${persistedMessageId}`,
            });
            if (registered.status === "rejected") throw new Error(`Steer intent ownership rejected: ${registered.reason}`);
          },
        }
      : {});
    if (!steerResult.queued) {
      return null;
    }

    if (persistSteer && interaction.id) {
      getDb().prepare("UPDATE messages SET is_steering_message = 1 WHERE rowid = ?").run(interaction.id);
    }

    const inflightMessageId = getInflightMessageId(chatJid);
    const rootRowId = inflightMessageId ? getMessageRowIdById(chatJid, inflightMessageId) : null;
    if (rootRowId && rootRowId !== interaction.id) {
      getDb().prepare("UPDATE messages SET thread_id = ? WHERE rowid = ?").run(rootRowId, interaction.id);
      interaction.data.thread_id = rootRowId;
      threadId = rootRowId;
      const currentIdentity = getIdentityConfig();
      broadcastInteractionUpdated(
        channel,
        interaction,
        currentIdentity.assistantName,
        resolveAvatarUrl("agent", currentIdentity.assistantAvatar),
        currentIdentity.userName || null,
        resolveAvatarUrl("user", currentIdentity.userAvatar),
        currentIdentity.userAvatarBackground || null
      );
    }

    channel.queuePendingSteering(chatJid, interaction.timestamp);
    channel.broadcastEvent("agent_steer_queued", {
      chat_jid: chatJid,
      thread_id: threadId ?? null,
      source,
    });

    return channel.json(
      {
        user_message: interaction,
        thread_id: threadId,
        queued: "steer",
      },
      201
    );
  };

  if (command) {
    broadcastNewPost();
    const commandTurnId = createUuid("turn");
    const commandTitle = content.trim().split(/\s+/, 1)[0] || "command";
    const isCompactCommand = command.type === "compact";
    const isSessionRotateCommand = command.type === "session_rotate";
    const commandModel = (isCompactCommand || isSessionRotateCommand) && typeof channel.agentPool.getCurrentModelLabel === "function"
      ? await channel.agentPool.getCurrentModelLabel(chatJid).catch(() => null)
      : null;

    if (isCompactCommand) {
      // Compaction gets the timer affordance (same as auto-compaction)
      emitCommandStatus({
        thread_id: interaction.timestamp,
        agent_id: agentId,
        turn_id: commandTurnId,
        type: "intent",
        title: "Compacting context",
        detail: "Manual compaction requested via /compact.",
        intent_key: "compaction",
        started_at: new Date().toISOString(),
        model: commandModel,
      });
    } else if (isSessionRotateCommand) {
      emitCommandStatus({
        thread_id: interaction.timestamp,
        agent_id: agentId,
        turn_id: commandTurnId,
        type: "intent",
        title: "Rotating session",
        detail: "Compacting context before archiving the current session and creating its successor.",
        intent_key: "session_rotation",
        started_at: new Date().toISOString(),
        model: commandModel,
      });
    } else {
      emitCommandStatus({
        thread_id: interaction.timestamp,
        agent_id: agentId,
        turn_id: commandTurnId,
        type: "intent",
        title: "Running " + commandTitle + "...",
      });
    }

    const result = await channel.agentPool.applyControlCommand(chatJid, command);
    if (result.status === "success" && (isCompactCommand || isSessionRotateCommand)) {
      await publishCommandContextUsage(result, {
        threadId: interaction.timestamp,
        turnId: commandTurnId,
      });
    }
    if (result.status === "success" && isSessionRotateCommand) {
      await resolveAndBroadcastModelStateForCommand(channel, chatJid, result);
    }
    const formatted = formatOutbound(result.message, "web");
    const isQueueCommand = command.type === "queue" || command.type === "queue_all";
    const isSteerCommand = command.type === "steer";

    const rollupTargetChatJid = command.type === "rollup" && result.status === "success" && typeof (result as { rolled_up_to?: unknown }).rolled_up_to === "string"
      ? String((result as { rolled_up_to?: string }).rolled_up_to || "").trim()
      : "";
    const responseChatJid = rollupTargetChatJid || chatJid;

    if (formatted || result.contentBlocks?.length) {
      if (isQueueCommand && result.queued_followup) {
        return queueDeferredFollowup(((command as { message?: string }).message || content).trim(), { source: "web.queue_command", browserContext: browserObservability });
      } else if (isSteerCommand && (result as { queued_steer?: boolean }).queued_steer) {
        const steerResponse = await queueSteerMessage("command");
        if (steerResponse) {
          return steerResponse;
        }
      } else if (isSteerCommand && (result as { queued_followup?: boolean }).queued_followup) {
        return queueDeferredFollowup(((command as { message?: string }).message || content).trim(), { source: "web.steer_command", browserContext: browserObservability });
      } else if (isSteerCommand && result.status === "error" && result.retry_as_followup) {
        return queueDeferredFollowup(
          ((command as { message?: string }).message || content).trim(),
          { source: "web.steer_retry", browserContext: browserObservability },
        );
      } else {
        const sendOptions: Record<string, unknown> = { threadId: interaction.id };
        if (result.mediaIds?.length) {
          sendOptions.mediaIds = result.mediaIds;
        }
        if (result.contentBlocks?.length) {
          sendOptions.contentBlocks = result.contentBlocks;
        }
        await channel.sendMessage(responseChatJid, formatted || "", sendOptions);
      }
    }

    // Broadcast model changes so the UI hint updates immediately
    const modelCommands = ["model", "thinking", "cycle_model", "cycle_thinking"];
    if (result.status === "success" && modelCommands.includes(command.type)) {
      let nextModel = result.model_label ?? null;
      let thinkingLevel = result.thinking_level ?? null;
      let thinkingLevelLabel = result.thinking_level_label ?? null;
      let supportsThinking: boolean | undefined = undefined;

      try {
        const modelState = await channel.agentPool.getAvailableModels(chatJid);
        if (!nextModel) nextModel = modelState.current ?? null;
        if (thinkingLevel == null) thinkingLevel = modelState.thinking_level ?? null;
        if (!thinkingLevelLabel) thinkingLevelLabel = modelState.thinking_level_label ?? thinkingLevel;
        supportsThinking = modelState.supports_thinking;
      } catch (err) {
      debugSuppressedError(log, "Failed to read current model for thinking persistence.", err, { operation: "persist_thinking.init_model" });
        if (typeof channel.agentPool.getCurrentModelLabel === "function") {
          nextModel = await channel.agentPool.getCurrentModelLabel(chatJid).catch(() => null);
        }
      }

      channel.broadcastEvent("model_changed", {
        chat_jid: chatJid,
        model: nextModel ?? null,
        thinking_level: thinkingLevel ?? null,
        thinking_level_label: thinkingLevelLabel ?? thinkingLevel ?? null,
        supports_thinking: supportsThinking,
      });
    }

    if (command.type === "rollup" && rollupTargetChatJid) {
      channel.broadcastEvent("extension_ui_title", {
        chat_jid: rollupTargetChatJid,
        title: "",
      });
    }

    if (result.status === "success" && (command.type === "model" || command.type === "cycle_model")) {
      if (channel.retryFailedOnModelSwitch(chatJid)) {
        channel.resumeChat(chatJid);
      }
    }

    emitCommandStatus({
      thread_id: interaction.timestamp,
      agent_id: agentId,
      turn_id: commandTurnId,
      type: result.status === "success" ? "done" : "error",
      title: result.status === "success"
        ? "Completed " + commandTitle
        : summarizeCommandStatusTitle(result.message, "Command failed"),
    });

    if (isSteerCommand && (result as { queued_steer?: boolean }).queued_steer) {
      return channel.json({ user_message: interaction, thread_id: threadId, command: result, queued: "steer" }, 201);
    }

    return channel.json(
      { user_message: interaction, thread_id: threadId, command: result },
      201
    );
  }

  // If message looks like a slash command invocation, execute it directly.
  // Paths such as /workspace/piclaw or prose that merely mention /commands stay normal prompts.
  if (isSlashCommandInvocation(trimmed)) {
    broadcastNewPost();
    const commandTurnId = createUuid("turn");
    const slashName = trimmed.split(/\s+/, 1)[0] || "/command";
    emitCommandStatus({
      thread_id: interaction.timestamp,
      agent_id: agentId,
      turn_id: commandTurnId,
      type: "intent",
      title: "Running " + slashName + "...",
    });

    channel.lastCommandInteractionId = interaction.id;
    let cmdResult;
    try {
      cmdResult = await channel.agentPool.applySlashCommand(chatJid, trimmed);
    } finally {
      channel.lastCommandInteractionId = null;
    }
    try {
      const formatted = formatOutbound(cmdResult.message || "", "web");
      if (formatted) await channel.sendMessage(chatJid, formatted, interaction.id);
    } catch (e) {
      log.error("Failed to send slash command response", {
        operation: "handle_agent_message.slash_command_response",
        chatJid,
        err: e,
      });
    }

    if (slashName === "/reload" && cmdResult.status === "success") {
      emitCommandStatus({
        thread_id: interaction.timestamp,
        agent_id: agentId,
        turn_id: commandTurnId,
        type: "intent",
        title: "Reload scheduled — waiting for restart",
        detail: cmdResult.message || undefined,
      });
    } else {
      emitCommandStatus({
        thread_id: interaction.timestamp,
        agent_id: agentId,
        turn_id: commandTurnId,
        type: cmdResult.status === "success" ? "done" : "error",
        title: cmdResult.status === "success"
          ? "Completed " + slashName
          : summarizeCommandStatusTitle(cmdResult.message, "Command failed"),
      });
    }

    return channel.json(
      { user_message: interaction, thread_id: threadId, command: cmdResult },
      201
    );
  }

  if (requestMode === "steer") {
    if (persistSteer) broadcastNewPost();
    const steerResponse = await queueSteerMessage("compose");
    if (steerResponse) {
      return steerResponse;
    }
  }

  if (requestMode === "queue" || requestMode === "auto") {
    const followupResponse = await queueFollowupMessage();
    if (followupResponse) {
      return followupResponse;
    }
  }

  // Normal (non-queued) message processing — broadcast to timeline now
  broadcastNewPost();

  log.info("Enqueuing processChat for normal agent message path", {
    operation: "handle_agent_message.enqueue_process_chat",
    chatJid,
    queueKey: `chat:${chatJid}:${interaction.id}`,
  });

  channel.queue.enqueue(async () => {
    await processChat(channel, chatJid, agentId, interaction.data?.thread_id ?? interaction.id, browserObservability);
  }, `chat:${chatJid}:${interaction.id}`, `chat:${chatJid}`);

  return channel.json({ user_message: interaction, thread_id: threadId }, 201);

}

/**
 * Drain chat work for an agent turn, including deferred followups and run lifecycle events.
 * @param channel Web channel contract for chat state, queue control, and event fanout.
 * @param chatJid Chat JID being processed.
 * @param agentId Agent identifier used for run execution and telemetry.
 * @param threadRootId Optional thread root id used to keep follow-up messages linked.
 * @returns Resolves when the current chat processing cycle has completed.
 */
export async function processChat(
  channel: WebChannelLike,
  chatJid: string,
  agentId: string,
  threadRootId?: number,
  browserObservability?: BrowserObservabilityContext,
): Promise<void> {
  const prevCursor = getChatCursor(chatJid);
  const selection = selectProcessChatMessage({ chatJid, prevCursor, threadRootId });
  const existingOperation = getChatOperation(chatJid);
  const nextAcceptedSource = existingOperation ? null : peekNextAcceptedChatSource(chatJid);
  const nextAcceptedMessage = nextAcceptedSource?.sourceKind === "message"
    ? loadDurableSourceMessage(chatJid, nextAcceptedSource.sourceId)
    : null;
  const earlierLegacyMessage = !existingOperation
    && nextAcceptedMessage
    && selection.kind === "message"
    && selection.currentMessage.id !== nextAcceptedMessage.id
    && messagePrecedes(selection.currentMessage, nextAcceptedMessage);
  const shouldClaimDurableSource = Boolean(existingOperation)
    || Boolean(nextAcceptedSource?.sourceKind === "protected_continuation")
    || Boolean(nextAcceptedSource?.sourceKind === "goal_continuation")
    || Boolean(nextAcceptedSource?.sourceKind === "message" && !earlierLegacyMessage);
  const operationClaim = shouldClaimDurableSource ? claimNextChatOperation(chatJid) : null;
  let durableOperation = operationClaim?.status === "claimed" || operationClaim?.status === "existing"
    ? operationClaim.operation
    : null;
  const durableSource = operationClaim?.status === "claimed" || operationClaim?.status === "existing"
    ? operationClaim.source
    : null;
  if (durableOperation && durableSource?.sourceKind !== "message"
    && durableSource?.sourceKind !== "protected_continuation"
    && durableSource?.sourceKind !== "goal_continuation") {
    log.warn("Durable prompt consumer refused an unsupported source", {
      operation: "process_chat.operation_source_not_supported",
      chatJid,
      sourceKind: durableSource?.sourceKind ?? null,
      sourceSeq: durableSource?.sourceSeq ?? null,
    });
    return;
  }
  if (durableOperation?.phase === "waiting") {
    const resumed = resumeChatOperation(chatJid, durableOperationOwner(durableOperation));
    if (resumed.status !== "applied") return;
    durableOperation = resumed.operation;
  }
  if (durableOperation?.cancellation) {
    if (completeCancelledDurableOperation(chatJid, durableOperation, "process_chat_cancelled_frontier")) {
      channel.resumeChat(chatJid);
    }
    return;
  }
  if (durableOperation?.phase === "blocked") return;

  const activePreflight = durableOperation ? null : getChatPreflight(chatJid);
  if (activePreflight) {
    log.info("Deferring chat processor to active preflight owner", {
      operation: "process_chat.preflight_owned",
      chatJid,
      messageId: activePreflight.messageId,
      startedAt: activePreflight.startedAt,
    });
    return;
  }

  if (!durableOperation && selection.kind === "no_messages") {
    log.info("processChat found no pending messages", {
      operation: "process_chat.no_pending_messages",
      chatJid,
      cursor: prevCursor,
      threadRootId: threadRootId ?? null,
    });
    await materializeDeferredFollowups({ channel, chatJid, agentId });
    return;
  }

  if (!durableOperation && selection.kind === "stale_failed_run_cleared") {
    log.info("processChat clearing stale failed-run marker without replay", {
      operation: "process_chat.clear_failed_run_without_replay",
      chatJid,
      cursor: prevCursor,
      failedPrevTs: selection.failedRun.prevTs,
      failedTs: selection.failedRun.failedTs,
      failedMessageId: selection.failedRun.messageId,
      pendingMessageCount: selection.pendingMessages.length,
    });
    if (selection.shouldResume) channel.resumeChat(chatJid);
    else await materializeDeferredFollowups({ channel, chatJid, agentId });
    return;
  }

  const protectedContinuationRoot = durableSource?.sourceKind === "protected_continuation"
    ? getProtectedContinuationRootSource(durableSource)
    : null;
  const goalContinuationLineage = durableSource?.sourceKind === "goal_continuation"
    ? getGoalContinuationLineage(durableSource)
    : null;
  const goalContinuationRoot = goalContinuationLineage
    ? getAcceptedChatSource(goalContinuationLineage.rootSourceSeq)
    : null;
  const durableMessageId = durableSource?.sourceKind === "message"
    ? durableSource.sourceId
    : protectedContinuationRoot?.frontierMessageId ?? goalContinuationRoot?.frontierMessageId;
  const claimedMessage = durableMessageId ? loadDurableSourceMessage(chatJid, durableMessageId) : null;
  if (durableOperation && !claimedMessage) {
    if (durableSource?.sourceKind === "protected_continuation") {
      const createdAt = new Date().toISOString();
      const artifactId = createUuid("message");
      const completed = completeChatOperation(chatJid, {
        owner: durableOperationOwner(durableOperation),
        outcome: "failed",
        cause: "protected_continuation_invalid_lineage",
        provenance: "web_process_chat_protected_refusal",
        createdAt,
        intentDispositions: getChatOperationIntentSources(durableOperation.operationId).map((intent) => ({
          sourceSeq: intent.sourceSeq,
          outcome: "failed" as const,
          cause: "protected_continuation_invalid_lineage",
          provenance: "web_process_chat_protected_refusal",
        })),
        artifact: { message: {
          id: artifactId,
          chat_jid: chatJid,
          sender: "web-agent",
          sender_name: getIdentityConfig().assistantName,
          content: "Protected recovery continuation could not be resumed because its source lineage is invalid. Retry the original request manually.",
          timestamp: createdAt,
          is_from_me: false,
          is_bot_message: true,
          is_terminal_agent_reply: true,
          content_blocks: [buildTurnOutcomeMarker({
            kind: "recovery",
            label: "recovery",
            title: "Protected continuation refused",
            detail: "The immutable source lineage is missing or invalid. Retry the original request manually.",
            severity: "error",
          })],
        } },
      });
      if (completed.status === "completed" || completed.status === "repeated") {
        const rowId = getMessageRowIdById(chatJid, artifactId);
        const interaction = rowId ? getMessageByRowId(chatJid, rowId) : null;
        if (interaction) channel.broadcastEvent("new_post", interaction);
        channel.resumeChat(chatJid);
      }
    } else {
      blockChatOperation(chatJid, durableOperationOwner(durableOperation));
    }
    log.error("Claimed durable prompt source is missing or invalid", {
      operation: "process_chat.operation_source_missing",
      chatJid,
      sourceKind: durableSource?.sourceKind ?? null,
      sourceSeq: durableSource?.sourceSeq ?? null,
      sourceId: durableSource?.sourceId ?? null,
    });
    return;
  }
  if (!durableOperation && selection.kind !== "message") return;

  const messages = selection.pendingMessages;
  const currentMessage = claimedMessage ?? (selection.kind === "message" ? selection.currentMessage : null);
  if (!currentMessage) return;
  const messageThreadId = currentMessage.thread_id ?? null;
  const effectiveThreadRootId = messageThreadId ?? threadRootId ?? null;

  log.info("processChat selected next pending message", {
    operation: "process_chat.select_message",
    chatJid,
    cursor: prevCursor,
    pendingMessageCount: messages.length,
    pendingMessages: messages.map(m => `${m.id}@${m.timestamp}`),
    threadRootId: threadRootId ?? null,
    messageThreadId: messageThreadId ?? null,
    effectiveThreadRootId: effectiveThreadRootId ?? null,
    processingMessageId: currentMessage.id,
  });

  const persistedCommand = parseControlCommand(String(currentMessage.content || ""), getRoutingConfig().triggerPattern);
  if (isDeferredControlCommand(persistedCommand)) {
    const action = await executeDeferredControlCommand({
      channel,
      chatJid,
      agentId,
      command: persistedCommand,
      message: {
        rowId: getMessageRowIdById(chatJid, currentMessage.id ?? "") ?? 0,
        messageId: currentMessage.id,
        content: String(currentMessage.content || ""),
        timestamp: currentMessage.timestamp,
        threadId: currentMessage.thread_id ?? effectiveThreadRootId ?? null,
      },
      effectiveThreadRootId,
    });
    if (action === "continue") {
      await materializeDeferredFollowups({
        channel,
        chatJid,
        agentId,
      });
    }
    return;
  }

  const channelName = detectChannel(chatJid);
  const durableProtectedContinuation = durableSource?.sourceKind === "protected_continuation";
  const durableGoalContinuation = durableSource?.sourceKind === "goal_continuation";
  const goalProvider = durableGoalContinuation ? getAddonGoalDeadlineCheckpointProvider() : null;
  const goalContinuation = durableGoalContinuation && goalContinuationLineage && goalProvider
    ? goalProvider.resolveContinuation({
        chatJid,
        goalId: goalContinuationLineage.goalId,
        checkpointId: goalContinuationLineage.checkpointId,
        generation: goalContinuationLineage.generation,
      })
    : null;
  if (durableGoalContinuation && goalContinuation?.status !== "continue") {
    if (!goalProvider || !goalContinuationLineage) {
      blockChatOperation(chatJid, durableOperationOwner(durableOperation!));
    } else {
      const completed = completeChatOperation(chatJid, {
        owner: durableOperationOwner(durableOperation!),
        outcome: "skipped",
        cause: "goal_continuation_no_longer_active",
        provenance: "web_process_chat_goal_continuation",
        createdAt: new Date().toISOString(),
        intentDispositions: getChatOperationIntentSources(durableOperation!.operationId).map((intent) => ({
          sourceSeq: intent.sourceSeq,
          outcome: "skipped" as const,
          cause: "goal_continuation_no_longer_active",
          provenance: "web_process_chat_goal_continuation",
        })),
      });
      if (completed.status === "completed" || completed.status === "repeated") channel.resumeChat(chatJid);
    }
    return;
  }
  const protectedRecoveryPrompt = durableProtectedContinuation
    ? TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT
    : resolveProtectedRecoveryPrompt(currentMessage);
  const promptMessage = durableGoalContinuation && goalContinuation?.status === "continue"
    ? { ...currentMessage, content: goalContinuation.content }
    : protectedRecoveryPrompt
      ? { ...currentMessage, content: protectedRecoveryPrompt }
      : currentMessage;
  const carriedGoalSteers = durableGoalContinuation && durableSource
    ? getGoalContinuationCarriedIntentSources(durableSource.sourceSeq)
      .map((intent) => intent.payloadRef.startsWith("message:")
        ? loadDurableSourceMessage(chatJid, intent.payloadRef.slice("message:".length))
        : null)
      .filter((message): message is NewMessage => Boolean(message))
    : [];
  if (durableGoalContinuation && durableSource
    && carriedGoalSteers.length !== getGoalContinuationCarriedIntentSources(durableSource.sourceSeq).length) {
    blockChatOperation(chatJid, durableOperationOwner(durableOperation!));
    return;
  }
  const prompt = formatMessages([promptMessage, ...carriedGoalSteers], channelName, chatJid);
  const lastMessage = currentMessage;
  const runStartedAt = new Date().toISOString();
  const threadId = lastMessage.timestamp;

  const turnId = createUuid("turn");
  if (durableGoalContinuation && goalContinuationLineage) {
    channel.broadcastEvent("goal_deadline_continuation_claimed", {
      chat_jid: chatJid,
      checkpoint_id: goalContinuationLineage.checkpointId,
      old_turn_id: goalContinuationLineage.oldTurnId,
      new_turn_id: turnId,
      source_seq: durableSource?.sourceSeq ?? null,
      generation: goalContinuationLineage.generation,
      goal_id: goalContinuationLineage.goalId,
    });
  }
  const streamRuntime = await createProcessChatStreamingRuntime({
    channel, chatJid, agentId, threadId, turnId, runStartedAt, sourceMessageId: lastMessage.id ?? null,
    withResolvedToolStatusHints, withAgentStatusProgressMetadata,
  });
  const { emitter, trackedEmitter, streamingHandler: trackedStreamingHandler, clearCommittedDraft, timeoutMs } = streamRuntime;
  const streamState = streamRuntime.state;
  let turnCount = 0;
  let hadIntermediateOutput = false;
  let persistedIntermediateOutput = false;
  let lastPersistedIntermediateRowId: number | null = null;
  let intermediatePersistFailed = false;
  const resolvedThreadRootId = resolveThreadRootId(channel, chatJid, currentMessage.id ?? "", effectiveThreadRootId);

  if (durableOperation) {
    const preflight = await runDurableOperationPreflight({
      channel, chatJid, agentId, message: { id: lastMessage.id, timestamp: lastMessage.timestamp },
      operation: durableOperation, effectiveThreadRootId: effectiveThreadRootId ?? null,
      turnId, browserObservability, streamingHandler: trackedStreamingHandler, compactionState: streamState,
      enqueueResume: (root) => enqueueProcessChatAfterCompaction(channel, chatJid, agentId, lastMessage.id, root, browserObservability),
    });
    if (preflight.status === "deferred") return;
    durableOperation = preflight.operation;
  } else {
    const preflight = await runProcessChatPreflight({
      channel, chatJid, agentId, message: { id: lastMessage.id, timestamp: lastMessage.timestamp }, prevCursor, effectiveThreadRootId: effectiveThreadRootId ?? null, turnId, runStartedAt, browserObservability,
      streamingHandler: trackedStreamingHandler, compactionState: streamState,
      enqueueResume: (root) => enqueueProcessChatAfterCompaction(channel, chatJid, agentId, lastMessage.id, root, browserObservability),
    });
    if (preflight === "deferred") return;
  }

  let shouldRemoveStaleProtectedContinuation = false;
  let durableOperationCompleted = false;
  const blockFailedRun = (failed: Parameters<typeof rollbackChatRunWithError>[1]): void => {
    if (!durableOperation) {
      rollbackChatRunWithError(chatJid, failed);
      return;
    }
    const current = getChatOperation(chatJid);
    if (!current || current.operationId !== durableOperation.operationId) return;
    const blocked = blockChatOperation(chatJid, durableOperationOwner(current));
    if (blocked.status === "applied") durableOperation = blocked.operation;
  };
  const deferDurableRetry = (legacyRollback: () => void): void => {
    if (!durableOperation) {
      legacyRollback();
      return;
    }
    const current = getChatOperation(chatJid);
    if (!current || current.operationId !== durableOperation.operationId) return;
    const waiting = waitChatOperation(chatJid, durableOperationOwner(current));
    if (waiting.status === "applied") durableOperation = waiting.operation;
  };
  const commitDurableTerminal = (
    rowId: number,
    outcome: ChatOperationOutcome,
    cause: string,
    provenance: string,
    protectedSuccessorRootSourceSeq?: number,
  ): boolean => {
    if (!durableOperation) return true;
    const message = getDb().prepare("SELECT id FROM messages WHERE chat_jid = ? AND rowid = ?")
      .get(chatJid, rowId) as { id: string } | undefined;
    if (!message) return false;
    try {
      const completed = completeChatOperation(chatJid, {
        owner: durableOperationOwner(durableOperation),
        outcome,
        cause,
        provenance,
        createdAt: new Date().toISOString(),
        artifact: { messageId: message.id },
        intentDispositions: getChatOperationIntentSources(durableOperation.operationId).map((intent) => ({
          sourceSeq: intent.sourceSeq,
          outcome: "succeeded" as const,
          cause: "steer_applied",
          provenance,
        })),
        ...(protectedSuccessorRootSourceSeq
          ? { successor: { sourceKind: "protected_continuation" as const, rootSourceSeq: protectedSuccessorRootSourceSeq } }
          : {}),
      });
      durableOperationCompleted = completed.status === "completed" || completed.status === "repeated";
      if (!durableOperationCompleted) {
        log.warn("Durable terminal completion lost operation ownership", {
          operation: "process_chat.operation_completion_rejected",
          chatJid,
          operationId: durableOperation.operationId,
          sourceSeq: durableOperation.sourceSeq,
          phase: durableOperation.phase,
          generation: durableOperation.generation,
          reason: "reason" in completed ? completed.reason : "unknown",
          observedOperation: "operation" in completed ? completed.operation : null,
        });
      }
      return durableOperationCompleted;
    } catch (error) {
      log.error("Durable terminal completion failed after message persistence", {
        operation: "process_chat.operation_completion_failed",
        chatJid,
        operationId: durableOperation.operationId,
        sourceSeq: durableOperation.sourceSeq,
        rowId,
        err: error,
      });
      return false;
    }
  };
  const persistTerminalOutcome = (
    text: string,
    marker: Record<string, unknown> | null,
    options: {
      critical?: boolean;
      additionalBlocks?: Array<Record<string, unknown>>;
      usage?: unknown;
      outcome?: ChatOperationOutcome;
      cause?: string;
      provenance?: string;
      protectedSuccessorRootSourceSeq?: number;
    } = {},
  ) => {
    // Capture thinking BEFORE broadcast via onMessageStored callback so a
    // fast client receiving the SSE agent_response event can immediately
    // fetch /agent/thinking?message_id=N without racing the INSERT.
    return storeAgentTurn(channel, emitter, {
      chatJid,
      text,
      attachments: [],
      channelName,
      threadId: resolvedThreadRootId,
      skipPlaceholder: shouldRemoveStaleProtectedContinuation || turnCount === 0,
      isTerminalAgentReply: true,
      removeProtectedContinuationForSourceMessageId: shouldRemoveStaleProtectedContinuation
        ? String(lastMessage.id || "").trim() || null
        : null,
      extraContentBlocks: [
        streamRuntime.buildAgentTimingBlock(options.usage),
        ...(marker ? [marker] : []),
        ...(Array.isArray(options.additionalBlocks) ? options.additionalBlocks : []),
        ...streamRuntime.buildThinkingRefBlocks(),
      ],
      onMessageStored: streamRuntime.persistThinkingForRow,
      commitTerminal: durableOperation
        ? (rowId) => commitDurableTerminal(
            rowId,
            options.outcome ?? "succeeded",
            options.cause ?? "agent_completed",
            options.provenance ?? "web_process_chat",
            options.protectedSuccessorRootSourceSeq,
          )
        : undefined,
    });
  };
  const persistVisibleFailureOutcome = (
    markerBase: Record<string, unknown>,
    detail?: string,
    options: {
      requireDraft?: boolean;
      outcome?: ChatOperationOutcome;
      cause?: string;
      provenance?: string;
    } = {},
  ) => {
    const draft = channel.getBuffer(turnId, "draft");
    const draftText = typeof draft?.text === "string" ? draft.text.trim() : "";
    if (options.requireDraft && !draftText) return false;

    const lastAction = summarizeFailureActionFromStatus(channel.getAgentStatus(chatJid));
    const marker = withFailureActionMetadata(markerBase, lastAction);
    const title = readTrimmedString(marker?.title) || "Turn failed";
    const markerDetail = readTrimmedString(marker?.detail);
    const markerType = readTrimmedString(marker?.type);
    const markerKind = readTrimmedString(marker?.kind);
    const markerClassifier = readTrimmedString(marker?.classifier);
    const inlineDiagnostic = markerKind === "tool_budget"
      || markerClassifier === "tool_history_pressure"
      || markerClassifier === "budget_exhausted";
    const showDiagnosticWithoutDraft = (markerType === "timeout_marker"
      && markerClassifier === "budget_exhausted")
      || markerKind === "context"
      || markerClassifier === "recovery_suppressed";
    const text = buildFailureVisibleText({
      draftText,
      title,
      detail: detail || markerDetail,
      actionSummary: lastAction?.summary,
      attemptsUsed: Number.isFinite(marker?.attempts_used) ? (marker?.attempts_used as number) : undefined,
      classifier: markerClassifier,
      nextAction: readTrimmedString(marker?.next_action),
      inlineDiagnostic,
      showDiagnosticWithoutDraft,
    });

    return persistTerminalOutcome(text, marker, {
      outcome: options.outcome ?? "failed",
      cause: options.cause ?? (markerClassifier || markerKind || markerType || "agent_failure"),
      provenance: options.provenance ?? "web_process_chat_failure",
    });
  };

  const publishDraftFallback = (
    reason?: "timeout" | "error" | "empty-final" | "rate-limit",
    detail?: string,
    options: {
      requireDraft?: boolean;
      markerOptions?: {
        failureCategory?: AgentFailureCategory;
        toolBudgetExceeded?: boolean;
        toolStepsUsed?: number;
        toolStepsBudget?: number;
        nextAction?: string;
      };
    } = {},
  ) => {
    // Draft fallback should publish the currently visible draft for whichever
    // turn failed to finalize, even if earlier turns in the same session were
    // already flushed via onTurnComplete(). For the very first turn we must
    // still skip placeholder consumption so an already-queued follow-up is not
    // accidentally stolen by the original response.
    const draft = channel.getBuffer(turnId, "draft");
    const draftText = typeof draft?.text === "string" ? draft.text.trim() : "";

    const markerBase = reason === "timeout"
      ? {
          type: "timeout_marker",
          timed_out: true,
          title: "Timed out",
          draft_recovered: Boolean(draftText),
          attempts_used: streamState.lastRecoveryMeta?.attemptsUsed,
          classifier: streamState.lastRecoveryMeta?.lastClassifier ?? null,
        }
      : reason === "rate-limit"
        ? buildErrorOutcomeMarker(detail || "rate limit", {
            draftRecovered: Boolean(draftText),
            attemptsUsed: streamState.lastRecoveryMeta?.attemptsUsed,
            classifier: streamState.lastRecoveryMeta?.lastClassifier ?? null,
            ...options.markerOptions,
          })
        : reason === "empty-final"
          ? buildTurnOutcomeMarker({
              kind: "blank_final",
              label: "no reply",
              title: "No final reply produced",
              detail: streamState.lastRecoveryMeta?.lastClassifier ? `Last recovery classifier: ${streamState.lastRecoveryMeta.lastClassifier}.` : undefined,
              severity: "warning",
              draftRecovered: Boolean(draftText),
              attemptsUsed: streamState.lastRecoveryMeta?.attemptsUsed,
              classifier: streamState.lastRecoveryMeta?.lastClassifier ?? null,
            })
          : buildErrorOutcomeMarker(detail || "Response ended with an error before finalization", {
              draftRecovered: Boolean(draftText),
              attemptsUsed: streamState.lastRecoveryMeta?.attemptsUsed,
              classifier: streamState.lastRecoveryMeta?.lastClassifier ?? null,
              ...options.markerOptions,
            });

    return persistVisibleFailureOutcome(markerBase, reason === "timeout" ? detail : undefined, options);
  };

  const finalizeSuccessfulRun = async (): Promise<void> => {
    if (durableOperation && !durableOperationCompleted) {
      blockFailedRun({
        prevTs: prevCursor,
        failedTs: lastMessage.timestamp,
        messageId: lastMessage.id,
        threadRootId: resolvedThreadRootId ?? null,
        createdAt: new Date().toISOString(),
      });
      return;
    }
    await finalizeSuccessfulProcessChatRun({
      channel,
      emitter: trackedEmitter,
      chatJid,
      agentId,
      turnId,
      threadId,
      prevCursor,
      recovery: streamState.lastRecoveryMeta,
      durableOperationCompleted,
    });
  };

  let terminalOutputHandledInPromptLane = false;
  let terminalOutputPersistedInPromptLane = false;
  let goalDeadlineSettlementUnverified = false;
  const persistSuccessfulOutputBeforeMaintenance = (terminalOutput: AgentOutput): boolean => {
    terminalOutputHandledInPromptLane = true;
    streamState.lastRecoveryMeta = terminalOutput.recovery || null;
    shouldRemoveStaleProtectedContinuation = !terminalOutput.requiresToolEnabledContinuation;

    if (durableOperation) {
      const current = getChatOperation(chatJid);
      if (!current || current.operationId !== durableOperation.operationId || current.cancellation) return false;
    }

    if (terminalOutput.status === "tool_complete") {
      const draft = channel.getBuffer(turnId, "draft");
      const draftText = typeof draft?.text === "string" ? draft.text.trim() : "";
      const marker = buildTurnOutcomeMarker({
        kind: "tool_complete",
        label: "done",
        title: "Completed via tools",
        detail: draftText
          ? "Turn finished after tool use — showing recovered draft."
          : "Turn finished after tool use — no closing reply was emitted.",
        severity: "info",
        draftRecovered: Boolean(draftText),
      });
      const persisted = draftText
        ? persistTerminalOutcome(draftText, marker, {
            usage: terminalOutput.usage,
            outcome: "tool_complete",
            cause: "provider_tool_complete",
            provenance: "web_process_chat",
          })
        : persistVisibleFailureOutcome(marker, undefined, {
            outcome: "tool_complete",
            cause: "provider_tool_complete",
            provenance: "web_process_chat",
          });
      if (!persisted) {
        blockFailedRun({
          prevTs: prevCursor,
          failedTs: lastMessage.timestamp,
          messageId: lastMessage.id,
          threadRootId: resolvedThreadRootId ?? null,
          createdAt: new Date().toISOString(),
        });
      }
      return Boolean(persisted);
    }

    const finalAttachments = terminalOutput.attachments ?? [];
    const hasOutput = Boolean(terminalOutput.result || finalAttachments.length > 0);
    if (hasOutput) {
      const stored = storeAgentTurn(channel, emitter, {
        chatJid,
        text: terminalOutput.result || "",
        attachments: finalAttachments as AttachmentInfo[],
        channelName,
        threadId: resolvedThreadRootId,
        skipPlaceholder: shouldRemoveStaleProtectedContinuation || turnCount === 0,
        isTerminalAgentReply: true,
        removeProtectedContinuationForSourceMessageId: shouldRemoveStaleProtectedContinuation
          ? String(lastMessage.id || "").trim() || null
          : null,
        extraContentBlocks: [
          streamRuntime.buildAgentTimingBlock(terminalOutput.usage),
          ...(buildRecoveryMarkerBlocks(terminalOutput.recovery) ?? []),
          ...streamRuntime.buildThinkingRefBlocks(),
        ],
        onMessageStored: streamRuntime.persistThinkingForRow,
        commitTerminal: durableOperation
          ? (rowId) => commitDurableTerminal(rowId, "succeeded", "agent_completed", "web_process_chat")
          : undefined,
      });
      if (stored) return true;

      const errorText = "Agent completed but terminal response could not be persisted.";
      blockFailedRun({
        prevTs: prevCursor,
        failedTs: lastMessage.timestamp,
        messageId: lastMessage.id,
        threadRootId: resolvedThreadRootId ?? null,
        createdAt: new Date().toISOString(),
      });
      trackedEmitter.status({
        thread_id: threadId,
        agent_id: agentId,
        type: "error",
        title: errorText,
        turn_id: turnId,
      });
      return false;
    }

    const finalDraft = channel.getBuffer(turnId, "draft");
    const hasDraftFallback = typeof finalDraft?.text === "string" && finalDraft.text.trim().length > 0;
    if (hasDraftFallback && publishDraftFallback("empty-final")) return true;

    if (persistedIntermediateOutput) {
      if (!durableOperation) return true;
      if (lastPersistedIntermediateRowId !== null && commitDurableTerminal(
        lastPersistedIntermediateRowId,
        "succeeded",
        "intermediate_output_completed_run",
        "web_process_chat_intermediate_completion",
      )) return true;
      blockFailedRun({
        prevTs: prevCursor,
        failedTs: lastMessage.timestamp,
        messageId: lastMessage.id,
        threadRootId: resolvedThreadRootId ?? null,
        createdAt: new Date().toISOString(),
      });
      return false;
    }

    if (hadIntermediateOutput && intermediatePersistFailed) {
      const errorText = "Agent produced intermediate output but it could not be persisted.";
      blockFailedRun({
        prevTs: prevCursor,
        failedTs: lastMessage.timestamp,
        messageId: lastMessage.id,
        threadRootId: resolvedThreadRootId ?? null,
        createdAt: new Date().toISOString(),
      });
      trackedEmitter.status({
        thread_id: threadId,
        agent_id: agentId,
        type: "error",
        title: errorText,
        turn_id: turnId,
      });
      return false;
    }

    if (hasDraftFallback) {
      const errorText = "Agent completed but draft response could not be persisted.";
      blockFailedRun({
        prevTs: prevCursor,
        failedTs: lastMessage.timestamp,
        messageId: lastMessage.id,
        threadRootId: resolvedThreadRootId ?? null,
        createdAt: new Date().toISOString(),
      });
      trackedEmitter.status({
        thread_id: threadId,
        agent_id: agentId,
        type: "error",
        title: errorText,
        turn_id: turnId,
      });
      return false;
    }

    const originalContent = currentMessage.content || "";
    const preview = originalContent.length > 120
      ? originalContent.slice(0, 120) + "…"
      : originalContent;
    const recoveryIntent = streamRuntime.getActiveRecoveryIntent();
    const recoveryLooksStalled = Boolean(streamState.lastRecoveryMeta?.exhausted)
      || streamState.lastRecoveryOutcome === "exhausted"
      || streamState.sawCompactionEvent
      || streamState.sawRecoveryEvent
      || recoveryIntent !== null
      || Boolean(streamState.lastCompactionErrorMessage);

    if (recoveryLooksStalled) {
      const title = streamState.lastRecoveryMeta?.exhausted || streamState.lastRecoveryOutcome === "exhausted"
        ? "Automatic recovery exhausted"
        : streamState.lastCompactionErrorMessage
          ? "Context compaction failed"
          : recoveryIntent === "compaction"
            ? "Context compaction did not complete"
            : "Context recovery did not complete";
      const detail = streamState.lastCompactionErrorMessage
        ? streamState.lastCompactionErrorMessage
        : streamState.lastRecoveryMeta?.lastClassifier
          ? `Last recovery classifier: ${streamState.lastRecoveryMeta.lastClassifier}.`
          : "The turn ended without a persisted reply while compaction or automatic recovery was in flight.";
      log.warn("Agent completed without output after compaction/recovery activity", {
        operation: "process_chat.no_output_recovery_stalled",
        chatJid,
        title,
        sawCompactionEvent: streamState.sawCompactionEvent,
        sawRecoveryEvent: streamState.sawRecoveryEvent,
        recoveryIntent,
        lastCompactionErrorMessage: streamState.lastCompactionErrorMessage,
        recovery: streamState.lastRecoveryMeta,
      });
      const marker = buildTurnOutcomeMarker({
        kind: streamState.lastCompactionErrorMessage ? "context" : "recovery",
        label: streamState.lastCompactionErrorMessage ? "context" : "recovery",
        title,
        detail,
        severity: "warning",
        attemptsUsed: streamState.lastRecoveryMeta?.attemptsUsed,
        classifier: streamState.lastRecoveryMeta?.lastClassifier ?? null,
      });
      const persisted = persistVisibleFailureOutcome(marker);
      if (!persisted) {
        blockFailedRun({
          prevTs: prevCursor,
          failedTs: lastMessage.timestamp,
          messageId: lastMessage.id,
          threadRootId: resolvedThreadRootId ?? null,
          createdAt: new Date().toISOString(),
        });
      }
      trackedEmitter.status({
        thread_id: threadId,
        agent_id: agentId,
        type: "error",
        title,
        detail,
        turn_id: turnId,
      });
      return Boolean(persisted);
    }

    const title = "Agent produced no response";
    const detail = "The model returned an empty reply before finalization.";
    log.warn("Agent completed without output; marking run as failed", {
      operation: "process_chat.no_output_blank_failed",
      chatJid,
      hadIntermediateOutput,
      persistedIntermediateOutput,
      hadDraft: false,
      recovery: streamState.lastRecoveryMeta,
    });
    const marker = buildTurnOutcomeMarker({
      kind: "blank_final",
      label: "no reply",
      title,
      detail: preview ? `${detail} Prompt: ${preview}` : detail,
      severity: "warning",
      attemptsUsed: streamState.lastRecoveryMeta?.attemptsUsed,
      classifier: streamState.lastRecoveryMeta?.lastClassifier ?? null,
    });
    const persisted = persistVisibleFailureOutcome(marker);
    if (!persisted) {
      blockFailedRun({
        prevTs: prevCursor,
        failedTs: lastMessage.timestamp,
        messageId: lastMessage.id,
        threadRootId: resolvedThreadRootId ?? null,
        createdAt: new Date().toISOString(),
      });
    }
    trackedEmitter.status({
      thread_id: threadId,
      agent_id: agentId,
      type: "error",
      title,
      detail,
      turn_id: turnId,
    });
    return Boolean(persisted);
  };

  let goalDeadlineLease: AddonGoalDeadlineCheckpointLease | null = null;
  const goalDeadlineProvider = durableOperation ? getAddonGoalDeadlineCheckpointProvider() : null;
  const goalDeadlineReserveMs = goalDeadlineProvider ? getGoalDeadlineCheckpointReserveMs(timeoutMs) : 0;
  const output = await channel.agentPool.runAgent(prompt, chatJid, {
    ...(durableOperation ? { operationOwner: durableOperationOwner(durableOperation) } : {}),
    timeoutMs,
    turnId,
    ...(browserObservability?.userId ? { userId: browserObservability.userId } : {}),
    ...(browserObservability?.sessionId ? { sessionId: browserObservability.sessionId } : {}),
    ...(browserObservability?.clientId ? { clientId: browserObservability.clientId } : {}),
    skipPrePromptCompaction: true,
    scheduleIdleAutoCompaction: true,
    protectedRecoveryContinuation: Boolean(protectedRecoveryPrompt) && !durableProtectedContinuation,
    ...(durableOperation && (durableProtectedContinuation || !protectedRecoveryPrompt)
      ? { protectedRecoveryHandoffMode: durableProtectedContinuation ? "durable_continuation" as const : "durable_externalize" as const }
      : {}),
    onEvent: trackedStreamingHandler,
    onTurnDiscard: () => {
      clearCommittedDraft();
    },
    onTerminalOutput: (terminalOutput) => {
      try {
        terminalOutputPersistedInPromptLane = persistSuccessfulOutputBeforeMaintenance(terminalOutput);
        return terminalOutputPersistedInPromptLane;
      } catch (error) {
        terminalOutputHandledInPromptLane = true;
        terminalOutputPersistedInPromptLane = false;
        log.error("Terminal output callback failed while prompt lane was held", {
          operation: "process_chat.terminal_output_callback_failed",
          chatJid,
          err: error,
        });
        blockFailedRun({
          prevTs: prevCursor,
          failedTs: lastMessage.timestamp,
          messageId: lastMessage.id,
          threadRootId: resolvedThreadRootId ?? null,
          createdAt: new Date().toISOString(),
        });
        return false;
      }
    },
    ...(durableOperation && goalDeadlineProvider && goalDeadlineReserveMs > 0
      ? {
          goalDeadlineCheckpoint: {
            reserveMs: goalDeadlineReserveMs,
            tryLatch: (latch: import("../../../agent-pool/contracts.js").GoalDeadlineCheckpointLatch) => {
              const current = getChatOperation(chatJid);
              if (!current || current.operationId !== durableOperation?.operationId || current.cancellation) return false;
              goalDeadlineLease = goalDeadlineProvider.tryLatch({
                chatJid,
                operationId: current.operationId,
                sourceSeq: current.sourceSeq,
                operationGeneration: current.generation,
                oldTurnId: latch.oldTurnId,
                checkpointId: latch.checkpointId,
                deadlineAt: latch.deadlineAt,
              });
              return Boolean(goalDeadlineLease);
            },
          },
          onGoalDeadlineCheckpoint: async (evidence: import("../../../agent-pool/contracts.js").GoalDeadlineCheckpointEvidence) => {
            terminalOutputHandledInPromptLane = true;
            clearCommittedDraft();
            const lease = goalDeadlineLease;
            if (!lease) return false;
            try {
            if (lease.checkpointId !== evidence.checkpointId) return false;
            const operation = getChatOperation(chatJid);
            if (!operation || operation.operationId !== lease.operationId || operation.sourceSeq !== lease.sourceSeq) return false;
            const source = getAcceptedChatSource(operation.sourceSeq);
            if (!source) return false;
            const initialResolution = goalDeadlineProvider.revalidate(lease);
            const settledBeforeDeadline = evidence.settlement === "idle"
              && Date.parse(evidence.settledAt) <= Date.parse(evidence.deadlineAt);
            if (!settledBeforeDeadline) {
              goalDeadlineSettlementUnverified = true;
              if (!operation.cancellation) {
                blockFailedRun({
                  prevTs: prevCursor,
                  failedTs: lastMessage.timestamp,
                  messageId: lastMessage.id,
                  threadRootId: resolvedThreadRootId ?? null,
                  createdAt: new Date().toISOString(),
                });
              }
              trackedEmitter.status({
                thread_id: threadId,
                agent_id: agentId,
                type: "error",
                title: "Goal deadline checkpoint stopped",
                detail: evidence.abortError || "The old turn did not settle safely; no continuation was scheduled.",
                turn_id: turnId,
              });
              return false;
            }
            const intents = getChatOperationIntentSources(operation.operationId);
            const intentMessages = intents.map((intent) => {
              if (intent.sourceKind !== "steer" || !intent.payloadRef.startsWith("message:")) return null;
              const messageId = intent.payloadRef.slice("message:".length);
              return getDb().prepare(`SELECT content, is_steering_message FROM messages WHERE chat_jid = ? AND id = ?`)
                .get(chatJid, messageId) as { content: string; is_steering_message: number } | undefined ?? null;
            });
            const cancellation = operation.cancellation;
            const allIntentPayloadsValid = intentMessages.every(Boolean);
            let appliedCount = intents.length - evidence.pendingSteering.length;
            const pendingMatchesSuffix = allIntentPayloadsValid && appliedCount >= 0
              && evidence.pendingFollowUps.length === 0
              && evidence.pendingSteering.every((text, index) => {
                const row = intentMessages[appliedCount + index];
                return row?.is_steering_message === 1 && row.content === text;
              });
            const steerAccountingValid = settledBeforeDeadline && pendingMatchesSuffix
              && !intentMessages.slice(0, Math.max(0, appliedCount)).some((row) => row?.is_steering_message !== 1);
            if (!steerAccountingValid) appliedCount = -1;
            const canContinue = !cancellation && initialResolution.action === "continue" && appliedCount >= 0;
            const createdAt = new Date().toISOString();
            const marker = buildTurnOutcomeMarker({
              kind: "recovery",
              label: canContinue ? "checkpoint" : "checkpoint failed",
              title: canContinue ? "Goal progress checkpointed" : "Goal deadline checkpoint stopped",
              detail: canContinue
                ? "The superseded turn settled before its deadline and one ordinary tool-enabled continuation was scheduled."
                : evidence.abortError || "The old turn or its accepted steering could not be settled safely; no continuation worker was created.",
              severity: canContinue ? "info" : "error",
            });
            const visibleText = initialResolution.action === "complete" || initialResolution.action === "stop"
              ? initialResolution.visibleText
              : canContinue
                ? initialResolution.visibleText
                : "Goal deadline checkpoint could not safely schedule a continuation.";
            const artifactId = createUuid("message");
            const currentLineage = source.sourceKind === "goal_continuation" ? getGoalContinuationLineage(source) : null;
            const rootSourceSeq = currentLineage?.rootSourceSeq
              ?? (source.sourceKind === "protected_continuation" ? getProtectedContinuationRootSource(source)?.sourceSeq : null)
              ?? source.sourceSeq;
            const parentGeneration = currentLineage?.generation ?? 0;
            const carriedIntentSourceSeqs = canContinue ? intents.slice(appliedCount).map((intent) => intent.sourceSeq) : [];
            const provenance = "web_process_chat_goal_deadline_checkpoint";
            const resolutionSignature = JSON.stringify(initialResolution);
              const completed = completeChatOperation(chatJid, {
                owner: durableOperationOwner(operation),
                outcome: cancellation
                  ? "cancelled"
                  : canContinue
                    ? "interrupted"
                    : initialResolution.action === "complete" || initialResolution.action === "stop"
                      ? "succeeded"
                      : initialResolution.action === "suppress" ? "skipped" : "failed",
                cause: cancellation
                  ? cancellation.cause
                  : canContinue
                    ? "goal_deadline_checkpoint"
                    : initialResolution.action === "complete" || initialResolution.action === "stop"
                      ? `goal_deadline_goal_${initialResolution.action}`
                      : "goal_deadline_checkpoint_not_continued",
                provenance,
                createdAt,
                ...(initialResolution.action === "suppress" || cancellation ? {} : { artifact: { message: {
                  id: artifactId,
                  chat_jid: chatJid,
                  sender: "web-agent",
                  sender_name: getIdentityConfig().assistantName,
                  content: visibleText,
                  timestamp: createdAt,
                  is_from_me: false,
                  is_bot_message: true,
                  is_terminal_agent_reply: true,
                  content_blocks: [marker, {
                    type: "goal_deadline_checkpoint",
                    checkpointId: evidence.checkpointId,
                    oldTurnId: evidence.oldTurnId,
                    deadlineAt: evidence.deadlineAt,
                    triggeredAt: evidence.triggeredAt,
                    settledAt: evidence.settledAt,
                    settlement: evidence.settlement,
                    sourceSeq: operation.sourceSeq,
                    operationId: operation.operationId,
                    operationGeneration: operation.generation,
                    goalId: lease.goalId,
                  }],
                } } }),
                ...(canContinue ? { successor: {
                  sourceKind: "goal_continuation" as const,
                  rootSourceSeq,
                  parentSourceSeq: source.sourceSeq,
                  parentGeneration,
                  generation: parentGeneration + 1,
                  goalId: lease.goalId,
                  checkpointId: evidence.checkpointId,
                  oldTurnId: evidence.oldTurnId,
                  carriedIntentSourceSeqs,
                } } : {}),
                intentDispositions: intents.map((intent, index) => {
                  const wasApplied = appliedCount >= 0 && index < appliedCount;
                  return {
                    sourceSeq: intent.sourceSeq,
                    outcome: wasApplied
                      ? "succeeded" as const
                      : canContinue
                        ? "interrupted" as const
                        : cancellation
                          ? "cancelled" as const
                          : initialResolution.action === "complete" || initialResolution.action === "stop" || initialResolution.action === "suppress"
                            ? "skipped" as const
                            : "failed" as const,
                    cause: wasApplied
                      ? "steer_applied"
                      : canContinue
                        ? "goal_deadline_steer_carried"
                        : cancellation
                          ? cancellation.cause
                          : initialResolution.action === "complete" || initialResolution.action === "stop"
                            ? `goal_deadline_goal_${initialResolution.action}`
                            : "goal_deadline_checkpoint_not_continued",
                    provenance,
                  };
                }),
              }, {
                beforeWrite: () => {
                  if (JSON.stringify(goalDeadlineProvider.revalidate(lease)) !== resolutionSignature) {
                    throw new Error("Goal deadline checkpoint state changed before commit");
                  }
                },
                afterWrite: (boundary) => {
                  if (boundary === "release" && canContinue) {
                    goalDeadlineProvider.markScheduled(lease, { generation: parentGeneration + 1 });
                  }
                },
              });
              terminalOutputPersistedInPromptLane = completed.status === "completed" || completed.status === "repeated";
              durableOperationCompleted = terminalOutputPersistedInPromptLane;
              if (!terminalOutputPersistedInPromptLane) {
                const latest = getChatOperation(chatJid);
                if (latest?.operationId === lease.operationId && !latest.cancellation) {
                  blockFailedRun({
                    prevTs: prevCursor,
                    failedTs: lastMessage.timestamp,
                    messageId: lastMessage.id,
                    threadRootId: resolvedThreadRootId ?? null,
                    createdAt: new Date().toISOString(),
                  });
                }
              }
              if (terminalOutputPersistedInPromptLane && initialResolution.action !== "suppress") {
                const rowId = getMessageRowIdById(chatJid, artifactId);
                const interaction = rowId ? getMessageByRowId(chatJid, rowId) : null;
                if (interaction) channel.broadcastEvent("new_post", interaction);
              }
              return terminalOutputPersistedInPromptLane;
            } catch (error) {
              log.error("Goal deadline checkpoint commit failed", {
                operation: "process_chat.goal_deadline_checkpoint_failed",
                chatJid,
                checkpointId: evidence.checkpointId,
                err: error,
              });
              const latest = getChatOperation(chatJid);
              if (latest?.operationId === lease.operationId && !latest.cancellation) {
                blockFailedRun({
                  prevTs: prevCursor,
                  failedTs: lastMessage.timestamp,
                  messageId: lastMessage.id,
                  threadRootId: resolvedThreadRootId ?? null,
                  createdAt: new Date().toISOString(),
                });
              }
              return false;
            } finally {
              goalDeadlineProvider.release(lease);
            }
          },
        }
      : {}),
    onProtectedRecoveryHandoff: (handoffOutput) => {
      terminalOutputHandledInPromptLane = true;
      streamState.lastRecoveryMeta = handoffOutput.recovery || null;
      clearCommittedDraft();
      if (!durableOperation || durableProtectedContinuation) return false;
      try {
        const marker = buildTurnOutcomeMarker({
          kind: "recovery",
          label: "recovery",
          title: "Recovery continuation scheduled",
          detail: "The unfinished request will continue in one durable ordinary turn with execution tools restored.",
          severity: "info",
          attemptsUsed: handoffOutput.recovery?.attemptsUsed,
          classifier: handoffOutput.recovery?.lastClassifier ?? null,
        });
        terminalOutputPersistedInPromptLane = Boolean(persistTerminalOutcome(
          "Recovery continuation scheduled.",
          marker,
          {
            outcome: "interrupted",
            cause: "protected_recovery_continuation_registered",
            provenance: "web_process_chat_protected_handoff",
            protectedSuccessorRootSourceSeq: durableOperation.sourceSeq,
          },
        ));
      } catch (error) {
        terminalOutputPersistedInPromptLane = false;
        log.error("Protected recovery handoff callback failed while prompt lane was held", {
          operation: "process_chat.protected_handoff_callback_failed",
          chatJid,
          err: error,
        });
      }
      if (!terminalOutputPersistedInPromptLane) {
        blockFailedRun({
          prevTs: prevCursor,
          failedTs: lastMessage.timestamp,
          messageId: lastMessage.id,
          threadRootId: resolvedThreadRootId ?? null,
          createdAt: new Date().toISOString(),
        });
      }
      return terminalOutputPersistedInPromptLane;
    },
    onTurnComplete: (turn: { text: string; attachments: unknown[]; usage?: unknown; followedByToolUse?: boolean }) => {
      const currentOperation = durableOperation ? getChatOperation(chatJid) : null;
      if (currentOperation && currentOperation.operationId === durableOperation?.operationId && currentOperation.cancellation) {
        clearCommittedDraft();
        return;
      }
      // Turn boundary: the first turn (index 0) is the original prompt's
      // response — skip placeholder consumption so it doesn't steal a
      // placeholder that belongs to a queued follow-up.
      // Subsequent turns (index 1+) are follow-up responses and should
      // consume their corresponding placeholder.
      const isFirstTurn = turnCount === 0;
      turnCount++;
      if (turn.text || turn.attachments.length > 0) {
        hadIntermediateOutput = true;
        const stored = persistIntermediateProcessChatTurn({
          channel,
          emitter,
          chatJid,
          text: turn.text,
          attachments: turn.attachments as AttachmentInfo[],
          channelName,
          threadId: resolvedThreadRootId,
          skipPlaceholder: isFirstTurn,
          timingBlock: streamRuntime.buildAgentTimingBlock(turn.usage),
          followedByToolUse: turn.followedByToolUse,
          operationOwner: durableOperation ? durableOperationOwner(durableOperation) : undefined,
          clearCommittedDraft,
        });
        if (!stored) {
          intermediatePersistFailed = true;
          log.warn("Failed to persist intermediate agent turn", {
            operation: "process_chat.persist_intermediate_turn",
            chatJid,
            turnCount,
            textLength: turn.text.length,
            attachmentCount: turn.attachments.length,
          });
        } else {
          persistedIntermediateOutput = true;
          lastPersistedIntermediateRowId = stored;
        }
      }
    },
  });

  streamState.lastRecoveryMeta = output.recovery || null;

  if (goalDeadlineSettlementUnverified) {
    // Keep the exact owner occupied when cancellation raced a failed Goal abort:
    // terminal cancellation is not safe until prompt and tool settlement is proven.
    endTrackedPhase(chatJid);
    return;
  }

  if (durableOperation) {
    const currentOperation = getChatOperation(chatJid);
    if (currentOperation && currentOperation.operationId === durableOperation.operationId && currentOperation.cancellation) {
      if (completeCancelledDurableOperation(chatJid, currentOperation, "session_control_abort")) {
        durableOperationCompleted = true;
        clearCommittedDraft();
        endTrackedPhase(chatJid);
        channel.resumeChat(chatJid);
      }
      return;
    }
    const disposition = getChatOperationDisposition(durableOperation.sourceSeq);
    if (disposition?.operationId === durableOperation.operationId && disposition.outcome === "cancelled") {
      clearCommittedDraft();
      endTrackedPhase(chatJid);
      return;
    }
  }

  // A prior process may have persisted protected handoff intent before
  // crashing. Successful replay removes that source-tagged intent in the same
  // SQLite UPDATE that clears inflight state (see finalizeSuccessfulRun), so
  // neither delete-before-commit nor commit-before-delete can lose or duplicate
  // the continuation.
  const removeStaleProtectedContinuation = !output.requiresToolEnabledContinuation;
  shouldRemoveStaleProtectedContinuation = removeStaleProtectedContinuation;

  if (terminalOutputHandledInPromptLane || output.status !== "error") {
    if (!terminalOutputHandledInPromptLane) {
      terminalOutputPersistedInPromptLane = persistSuccessfulOutputBeforeMaintenance(output);
    }
    if (terminalOutputPersistedInPromptLane) {
      await finalizeSuccessfulRun();
      if (output.status === "success") endTrackedPhase(chatJid);
    }
    return;
  }

  if (output.status === "error") {
    // Compatibility boundary for injected/legacy AgentPool implementations.
    // Normal runtime outputs already carry this enum from attempt finalization.
    output.failureCategory ??= classifyOpaqueAgentFailure(output.error);
    if (output.toolBudgetExceeded) output.failureCategory = "tool_budget";
    if (output.failureCategory === "compaction_in_progress") {
      // This processor does not own the SDK's active physical compaction.
      // Preserve that compaction marker and leave the message pending; the
      // owning preflight completion queues the one authoritative resume.
      deferDurableRetry(() => rollbackInflightRunForCompactionConflict(chatJid, prevCursor, {
        messageId: lastMessage.id,
        startedAt: runStartedAt,
      }));
      log.info("Deferred prompt while another physical compaction is active", {
        operation: "process_chat.compaction_in_progress",
        chatJid,
        messageId: lastMessage.id,
      });
      endTrackedPhase(chatJid);
      return;
    }

    if (output.failureCategory === "already_processing") {
      // A concurrent run is already handling this chat. Preserve durable
      // ownership in waiting so the queue retry resumes the same operation.
      deferDurableRetry(() => rollbackInflightRun(chatJid, prevCursor));
      trackedEmitter.status(buildRetryStatusPayload({
        threadId,
        agentId,
        turnId,
        title: "Queued — waiting for current response",
      }));
      throw new Error(output.error || "Agent run is already processing");
    }

    if (output.failureCategory === "provider_unavailable") {
      // Extension/provider registration races can happen right after restart.
      // Keep the same durable operation pending for the queue retry.
      deferDurableRetry(() => rollbackInflightRun(chatJid, prevCursor));
      trackedEmitter.status(buildRetryStatusPayload({
        threadId,
        agentId,
        turnId,
        title: "Model provider is initializing — retrying shortly",
        detail: output.error,
      }));
      throw new Error(output.error || "No API provider is registered");
    }

    const errorText = output.error || "Agent error";
    const providerError = formatProviderError(errorText);
    const rateLimited = output.failureCategory === "rate_limit";
    const networkFailed = output.failureCategory === "network";
    const networkDetail = networkFailed ? describeNetworkError(errorText) : null;
    const markerOptions = {
      failureCategory: output.failureCategory,
      toolBudgetExceeded: output.toolBudgetExceeded,
      toolStepsUsed: output.toolStepsUsed,
      toolStepsBudget: output.toolStepsBudget,
      nextAction: output.nextAction,
      abortCause: output.abortCause,
      abortOperation: output.abortOperation,
    };
    const recoverySuppressedReason = output.recovery?.lastClassifier === "recovery_suppressed"
      ? output.recovery.diagnostics.slice().reverse().find((entry) => entry.classifier === "recovery_suppressed")?.reason || null
      : null;
    const resolveContinuationThreadId = (): number | null => resolvedThreadRootId
      ?? getMessageRowIdById(chatJid, lastMessage.id ?? "");
    const queueToolBudgetContinuation = (): void => {
      if (!output.toolBudgetExceeded || output.recovery?.exhausted) return;
      const continuationThreadId = resolveContinuationThreadId();
      if (!continuationThreadId) {
        log.warn("Could not resolve thread lineage for bounded tool-budget continuation", {
          operation: "process_chat.tool_budget_auto_continue_missing_lineage",
          chatJid,
          messageId: lastMessage.id ?? null,
        });
        return;
      }
      const continuationThreadKey = String(continuationThreadId);
      if (!reserveToolBudgetContinuation(chatJid, continuationThreadKey)) return;

      try {
        const queuedAt = new Date().toISOString();
        const queuedRowId = channel.enqueueQueuedFollowupItem(
          chatJid,
          0,
          RECOVERY_CONTINUATION_PROMPT,
          continuationThreadId,
          queuedAt,
          { source: "auto-tool-budget-continuation" },
        );
        channel.broadcastEvent("agent_followup_queued", {
          chat_jid: chatJid,
          thread_id: continuationThreadId,
          row_id: queuedRowId,
          content: RECOVERY_CONTINUATION_PROMPT,
          timestamp: queuedAt,
          source: "auto-tool-budget-continuation",
        });
        log.info("Queued one bounded continuation after a healthy tool-budget stop", {
          operation: "process_chat.tool_budget_auto_continue",
          chatJid,
          threadKey: continuationThreadKey,
          queuedRowId,
        });
      } catch (error) {
        releaseToolBudgetContinuation(chatJid, continuationThreadKey);
        log.warn("Failed to queue bounded continuation after tool-budget stop", {
          operation: "process_chat.tool_budget_auto_continue_failed",
          chatJid,
          threadKey: continuationThreadKey,
          err: error,
        });
      }
    };
    if (output.requiresToolEnabledContinuation) {
      // A durable child has already spent its external handoff. It may consume
      // only the one typed post-compaction internal resume owned by AgentPool.
      clearCommittedDraft();
      const internalResumeExhausted = durableProtectedContinuation
        && output.protectedRecoveryHandoff?.afterSuccessfulCompaction === true;
      const marker = buildTurnOutcomeMarker({
        kind: "recovery",
        label: "recovery",
        title: durableProtectedContinuation
          ? internalResumeExhausted
            ? "Post-compaction recovery resume exhausted"
            : "Protected continuation cannot be handed off again"
          : "Internal recovery continuation failed",
        detail: durableProtectedContinuation
          ? internalResumeExhausted
            ? "The bounded internal tool-enabled resume did not produce an authoritative terminal result. Retry the request manually."
            : "The durable continuation already spent its external handoff and no successful compaction authorised an internal resume. Retry the request manually."
          : "The runtime did not complete its internal tool-restored continuation.",
        severity: "error",
        attemptsUsed: output.recovery?.attemptsUsed,
        classifier: output.recovery?.lastClassifier ?? null,
      });
      const persisted = persistVisibleFailureOutcome(marker, undefined, {
        outcome: "failed",
        cause: durableProtectedContinuation
          ? internalResumeExhausted
            ? "protected_continuation_internal_resume_exhausted"
            : "protected_continuation_external_handoff_refused"
          : "protected_recovery_internal_handoff_invariant",
        provenance: durableProtectedContinuation
          ? "web_process_chat_protected_refusal"
          : "web_process_chat_failure",
      });
      if (persisted) {
        await finalizeSuccessfulRun();
      } else {
        blockFailedRun({
          prevTs: prevCursor,
          failedTs: lastMessage.timestamp,
          messageId: lastMessage.id,
          threadRootId: resolvedThreadRootId ?? null,
          createdAt: new Date().toISOString(),
        });
      }
      return;
    }
    if (output.recovery?.lastClassifier === "recovery_suppressed") {
      const detail = recoverySuppressedReason
        ?? "Automatic recovery was intentionally suppressed because repeated identical failures reached the loop-guard limit.";
      const marker = buildTurnOutcomeMarker({
        kind: "recovery",
        label: "recovery",
        title: "Automatic recovery suppressed",
        detail,
        severity: "warning",
        attemptsUsed: output.recovery.attemptsUsed,
        classifier: "recovery_suppressed",
      });
      const persisted = persistVisibleFailureOutcome(marker);
      if (persisted) {
        await finalizeSuccessfulRun();
      } else {
        blockFailedRun({
          prevTs: prevCursor,
          failedTs: lastMessage.timestamp,
          messageId: lastMessage.id,
          threadRootId: resolvedThreadRootId ?? null,
          createdAt: new Date().toISOString(),
        });
      }
      trackedEmitter.status({
        thread_id: threadId,
        agent_id: agentId,
        type: "error",
        state: "recovery_suppressed",
        classifier: "recovery_suppressed",
        failure_category: output.failureCategory ?? "unknown",
        title: "Automatic recovery suppressed",
        detail,
        recovery_suppressed_reason: detail,
        turn_id: turnId,
      });
      return;
    }

    const fallbackPublished = output.failureCategory === "timeout" || output.failureCategory === "stalled_work"
      ? publishDraftFallback("timeout", errorText, { markerOptions })
      : rateLimited
        ? publishDraftFallback("rate-limit", errorText, { markerOptions })
        : publishDraftFallback("error", errorText, { markerOptions });

    if (fallbackPublished) {
      // Tool-budget reservations remain after terminal persistence.
      queueToolBudgetContinuation();
      await finalizeSuccessfulRun();
      return;
    }

    const marker = buildErrorOutcomeMarker(errorText, {
      attemptsUsed: output.recovery?.attemptsUsed,
      classifier: output.recovery?.lastClassifier ?? null,
      severity: rateLimited ? "warning" : "error",
      ...markerOptions,
    });
    const persisted = persistVisibleFailureOutcome(marker);
    if (persisted) {
      queueToolBudgetContinuation();
      await finalizeSuccessfulRun();
    } else {
      blockFailedRun({
        prevTs: prevCursor,
        failedTs: lastMessage.timestamp,
        messageId: lastMessage.id,
        threadRootId: resolvedThreadRootId ?? null,
        createdAt: new Date().toISOString(),
      });
    }

    trackedEmitter.status({
      thread_id: threadId,
      agent_id: agentId,
      type: "error",
      state: output.failureCategory === "auth_config" ? "blocked_auth" : "failed",
      classifier: output.recovery?.lastClassifier ?? output.failureCategory ?? "unknown",
      failure_category: output.failureCategory ?? "unknown",
      title: providerError?.title || (rateLimited ? "AI provider rate limit" : networkFailed ? networkDetail! : errorText),
      detail: providerError?.detail || (rateLimited ? errorText : networkFailed ? errorText : undefined),
      turn_id: turnId,
    });
    return;
  }
}
