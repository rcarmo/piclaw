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
import { RECOVERY_CONTINUATION_PROMPT } from "../../../agent-pool/context-pressure-retry.js";
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
  getChatCursor,
  getInflightMessageId,
  getMessageRowIdById,
  getDb,
  rollbackChatRunWithError,
  rollbackInflightRun,
  setChatCursor,
} from "../../../db.js";
import { detectChannel, formatMessages, formatOutbound } from "../../../router.js";
import { createAgentProfileBuilder } from "../agent/agent-utils.js";
import { resolveAvatarUrl } from "../media/avatar-service.js";
import { broadcastInteractionUpdated } from "../cards/interaction-service.js";
import { storeAgentTurn } from "../messaging/agent-message-store.js";
import { finalizeSuccessfulProcessChatRun, persistIntermediateProcessChatTurn } from "../runtime/process-chat-finalization-runtime.js";
import { createProcessChatStreamingRuntime } from "../runtime/process-chat-streaming-runtime.js";
import { runProcessChatPreflight } from "../runtime/process-chat-preflight-runtime.js";
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
import { cancelScheduledIdleAutoCompaction } from "../../../agent-pool/compaction.js";
import { DEFAULT_BASE_RETRY_MS, getRetryAtIso } from "../../../queue/retry-policy.js";
import { formatProviderError } from "./provider-error-format.js";
import { endTrackedPhase } from "../../../runtime/progress-watchdog.js";

const log = createLogger("web.handlers.agent");
const TOOL_BUDGET_CONTINUATION_EXTENSION_ID = "piclaw.tool-budget-continuation";

function reserveToolBudgetContinuation(chatJid: string, threadKey: string): boolean {
  const kv = getExtensionKvStore();
  const key = `continued:${threadKey}`;
  if (kv.get(TOOL_BUDGET_CONTINUATION_EXTENSION_ID, key, "chat", chatJid)) return false;
  kv.set(TOOL_BUDGET_CONTINUATION_EXTENSION_ID, key, {
    count: 1,
    createdAt: new Date().toISOString(),
  }, "chat", chatJid);
  return true;
}

function releaseToolBudgetContinuation(chatJid: string, threadKey: string): void {
  getExtensionKvStore().delete(
    TOOL_BUDGET_CONTINUATION_EXTENSION_ID,
    `continued:${threadKey}`,
    "chat",
    chatJid,
  );
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

function isRateLimitError(errorText: string | null | undefined): boolean {
  if (!errorText) return false;
  return /\b429\b|rate[ -]?limit|too many requests|retry-after/i.test(errorText);
}

function isAuthError(errorText: string | null | undefined): boolean {
  if (!errorText) return false;
  return /authentication failed|credentials may have expired|no api key(?: found| for provider)?|token refresh failed\s*:\s*401|re-authenticate|unauthorized|\b401\b|\b403\b|invalid.*api.*key|api.*key.*invalid|token.*expired|oauth.*expired|refresh.*token/i.test(errorText);
}

function isModelConfigError(errorText: string | null | undefined): boolean {
  if (!errorText) return false;
  return /no model selected|select a model|use \/model|use \/login/i.test(errorText);
}

function isSessionCorruptionError(errorText: string | null | undefined): boolean {
  if (!errorText) return false;
  return /invalid_request_error|\b400\b.*(?:image|media_type|content|base64|tool_use_id|tool_result|tool_use)|media_type|image.*source|unexpected [`'\"]?tool_use_id[`'\"]?|tool_result.*corresponding.*tool_use/i.test(errorText);
}

function isQuotaError(errorText: string | null | undefined): boolean {
  if (!errorText) return false;
  return /quota|usage.*limit|out of.*usage|billing|insufficient.*funds|exceeded.*limit|credit/i.test(errorText);
}

function isNetworkError(errorText: string | null | undefined): boolean {
  if (!errorText) return false;
  return /\bENOTFOUND\b|\bECONNREFUSED\b|\bETIMEDOUT\b|\bECONNRESET\b|getaddrinfo|dns.*failed|network.*error|connection.*(?:error|refused|lost|ended|closed)|websocket.*(?:closed|ended|1006)|fetch failed|socket hang up/i.test(errorText);
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
    tool_budget_exceeded: options.toolBudgetExceeded ? true : undefined,
    tool_steps_used: Number.isFinite(options.toolStepsUsed) ? options.toolStepsUsed : undefined,
    tool_steps_budget: Number.isFinite(options.toolStepsBudget) ? options.toolStepsBudget : undefined,
    next_action: readTrimmedString(options.nextAction) || undefined,
    abort_cause: readTrimmedString(options.abortCause) || undefined,
    abort_operation: readTrimmedString(options.abortOperation) || undefined,
  };
}

function isToolBudgetExceededError(text: string): boolean {
  return /tool.use budget exceeded/i.test(text);
}

function isAbortError(errorText: string | null | undefined): boolean {
  if (!errorText) return false;
  return /\b(?:aborterror|aborted|operation was aborted|request was aborted)\b/i.test(errorText);
}

function buildErrorOutcomeMarker(
  errorText: string,
  options: {
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
  if (isToolBudgetExceededError(errorText)) {
    return buildTurnOutcomeMarker({
      kind: "tool_budget",
      label: "tool budget",
      title: "Tool-use budget exceeded",
      detail: errorText.slice(0, 500),
      severity: "warning",
      draftRecovered: options.draftRecovered,
      attemptsUsed: options.attemptsUsed,
      classifier: options.classifier,
      toolBudgetExceeded: options.toolBudgetExceeded ?? true,
      toolStepsUsed: options.toolStepsUsed,
      toolStepsBudget: options.toolStepsBudget,
      nextAction: options.nextAction || "Ask me to continue; I will resume from the latest known partial state instead of replaying the whole turn.",
      abortCause: options.abortCause,
      abortOperation: options.abortOperation,
    });
  }

  const providerError = formatProviderError(errorText);
  if (providerError) {
    return buildTurnOutcomeMarker({
      kind: providerError.category === "network"
        ? "network"
        : providerError.category === "session_corruption"
          ? "context"
          : "provider",
      label: providerError.label,
      title: providerError.title,
      detail: providerError.detail,
      severity: providerError.severity,
      draftRecovered: options.draftRecovered,
      attemptsUsed: options.attemptsUsed,
      classifier: options.classifier,
    });
  }

  if (isRateLimitError(errorText)) {
    return buildTurnOutcomeMarker({
      kind: "provider",
      label: "rate limit",
      title: "Provider retry budget exhausted",
      detail: errorText.slice(0, 500),
      severity: "warning",
      draftRecovered: options.draftRecovered,
      attemptsUsed: options.attemptsUsed,
      classifier: options.classifier,
    });
  }

  if (isAuthError(errorText) || isQuotaError(errorText) || isModelConfigError(errorText)) {
    const authGuidance = isAuthError(errorText)
      ? "Sign in with /login or configure provider credentials, then retry."
      : null;
    const baseDetail = errorText.slice(0, 500);
    return buildTurnOutcomeMarker({
      kind: "provider",
      label: "provider",
      title: isAuthError(errorText)
        ? "Provider authentication/configuration required"
        : isQuotaError(errorText)
          ? "Provider quota exceeded"
          : "Model configuration error",
      detail: [baseDetail, authGuidance].filter(Boolean).join(" — "),
      severity: options.severity ?? "error",
      draftRecovered: options.draftRecovered,
      attemptsUsed: options.attemptsUsed,
      classifier: options.classifier,
    });
  }

  if (isNetworkError(errorText)) {
    return buildTurnOutcomeMarker({
      kind: "network",
      label: "network",
      title: describeNetworkError(errorText),
      detail: errorText.slice(0, 500),
      severity: options.severity ?? "error",
      draftRecovered: options.draftRecovered,
      attemptsUsed: options.attemptsUsed,
      classifier: options.classifier,
    });
  }

  if (isAbortError(errorText)) {
    return buildTurnOutcomeMarker({
      kind: "abort",
      label: "aborted",
      title: "Turn aborted",
      detail: errorText.slice(0, 500),
      severity: options.severity ?? "warning",
      draftRecovered: options.draftRecovered,
      attemptsUsed: options.attemptsUsed,
      classifier: options.classifier,
      abortCause: options.abortCause,
      abortOperation: options.abortOperation,
    });
  }

  if (isSessionCorruptionError(errorText)) {
    return buildTurnOutcomeMarker({
      kind: "context",
      label: "context",
      title: "Session context needs repair",
      detail: errorText.slice(0, 500),
      severity: options.severity ?? "error",
      draftRecovered: options.draftRecovered,
      attemptsUsed: options.attemptsUsed,
      classifier: options.classifier,
    });
  }

  return buildTurnOutcomeMarker({
    kind: "error",
    label: "error",
    title: "Turn failed",
    detail: errorText.slice(0, 500),
    severity: options.severity ?? "warning",
    draftRecovered: options.draftRecovered,
    attemptsUsed: options.attemptsUsed,
    classifier: options.classifier,
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
  inlineDiagnostic?: boolean;
  showDiagnosticWithoutDraft?: boolean;
}): string {
  const draftText = readTrimmedString(options.draftText);
  const title = readTrimmedString(options.title) || "Turn failed";
  const detail = readTrimmedString(options.detail);
  const actionSummary = readTrimmedString(options.actionSummary);
  const nextAction = /tool-use budget exceeded/i.test(`${title} ${detail}`)
    ? "Ask me to continue; I will resume from the latest known partial state."
    : null;
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

function buildAgentStatusPhaseKey(payload: Record<string, unknown>): string {
  const type = typeof payload.type === "string" ? payload.type : "unknown";
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const intentKey = typeof payload.intent_key === "string"
    ? payload.intent_key.trim()
    : (typeof payload.intentKey === "string" ? payload.intentKey.trim() : "");
  const toolName = typeof payload.tool_name === "string"
    ? payload.tool_name.trim()
    : (typeof payload.toolName === "string" ? payload.toolName.trim() : "");

  if ((type === "tool_call" || type === "tool_status") && toolName) {
    return `tool:${toolName}:${title}`;
  }
  if (type === "intent" && intentKey) {
    return `intent:${intentKey}:${title}`;
  }
  return `${type}:${title}`;
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

  const interaction = storeAgentUserMessage(channel, chatJid, {
    content,
    mediaIds: normalized.mediaIds,
    contentBlocks: normalized.contentBlocks,
    linkPreviews: normalized.linkPreviews,
    threadId: normalized.threadId,
    screenHint: normalized.screenHint,
  });

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
    const steerResult = await channel.agentPool.queueStreamingMessage(chatJid, content, "steer");
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
      } else if (isSteerCommand && result.status === "error" && result.message === "No active response to steer. Please send a message first.") {
        const queueResponse = await queueFollowupMessage();
        if (queueResponse) {
          return queueResponse;
        }
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
  const selection = selectProcessChatMessage({
    chatJid,
    prevCursor,
    threadRootId,
  });

  if (selection.kind === "no_messages") {
    log.info("processChat found no pending messages", {
      operation: "process_chat.no_pending_messages",
      chatJid,
      cursor: prevCursor,
      threadRootId: threadRootId ?? null,
    });
    await materializeDeferredFollowups({
      channel,
      chatJid,
      agentId,
    });
    return;
  }

  if (selection.kind === "stale_failed_run_cleared") {
    log.info("processChat clearing stale failed-run marker without replay", {
      operation: "process_chat.clear_failed_run_without_replay",
      chatJid,
      cursor: prevCursor,
      failedPrevTs: selection.failedRun.prevTs,
      failedTs: selection.failedRun.failedTs,
      failedMessageId: selection.failedRun.messageId,
      pendingMessageCount: selection.pendingMessages.length,
    });
    if (selection.shouldResume) {
      channel.resumeChat(chatJid);
    } else {
      await materializeDeferredFollowups({
        channel,
        chatJid,
        agentId,
      });
    }
    return;
  }

  const {
    pendingMessages: messages,
    currentMessage,
    messageThreadId,
    effectiveThreadRootId,
  } = selection;

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
  const prompt = formatMessages([currentMessage], channelName, chatJid);
  const lastMessage = currentMessage;
  const runStartedAt = new Date().toISOString();
  const threadId = lastMessage.timestamp;

  const turnId = createUuid("turn");
  const streamRuntime = await createProcessChatStreamingRuntime({
    channel, chatJid, agentId, threadId, turnId, runStartedAt, sourceMessageId: lastMessage.id ?? null,
    withResolvedToolStatusHints, withAgentStatusProgressMetadata,
  });
  const { emitter, trackedEmitter, streamingHandler: trackedStreamingHandler, clearCommittedDraft, timeoutMs } = streamRuntime;
  const streamState = streamRuntime.state;
  let turnCount = 0;
  let hadIntermediateOutput = false;
  let persistedIntermediateOutput = false;
  let intermediatePersistFailed = false;
  const resolvedThreadRootId = resolveThreadRootId(channel, chatJid, currentMessage.id ?? "", effectiveThreadRootId);

  const preflight = await runProcessChatPreflight({
    channel, chatJid, agentId, message: { id: lastMessage.id, timestamp: lastMessage.timestamp }, prevCursor, effectiveThreadRootId: effectiveThreadRootId ?? null, turnId, runStartedAt, browserObservability,
    streamingHandler: trackedStreamingHandler, compactionState: streamState,
    enqueueResume: (root) => enqueueProcessChatAfterCompaction(channel, chatJid, agentId, lastMessage.id, root, browserObservability),
  });
  if (preflight === "deferred") return;

  const persistTerminalOutcome = (
    text: string,
    marker: Record<string, unknown> | null,
    options: { critical?: boolean; additionalBlocks?: Array<Record<string, unknown>>; usage?: unknown } = {},
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
      skipPlaceholder: turnCount === 0,
      isTerminalAgentReply: true,
      extraContentBlocks: [
        streamRuntime.buildAgentTimingBlock(options.usage),
        ...(marker ? [marker] : []),
        ...(Array.isArray(options.additionalBlocks) ? options.additionalBlocks : []),
        ...streamRuntime.buildThinkingRefBlocks(),
      ],
      onMessageStored: streamRuntime.persistThinkingForRow,
    });
  };
  const persistVisibleFailureOutcome = (
    markerBase: Record<string, unknown>,
    detail?: string,
    options: { requireDraft?: boolean } = {},
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
      || markerKind === "context";
    const text = buildFailureVisibleText({
      draftText,
      title,
      detail: detail || markerDetail,
      actionSummary: lastAction?.summary,
      attemptsUsed: Number.isFinite(marker?.attempts_used) ? (marker?.attempts_used as number) : undefined,
      classifier: markerClassifier,
      inlineDiagnostic,
      showDiagnosticWithoutDraft,
    });

    return persistTerminalOutcome(text, marker);
  };

  const publishDraftFallback = (
    reason?: "timeout" | "error" | "empty-final" | "rate-limit",
    detail?: string,
    options: {
      requireDraft?: boolean;
      markerOptions?: {
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

  const finalizeSuccessfulRun = async () => finalizeSuccessfulProcessChatRun({
    channel,
    emitter: trackedEmitter,
    chatJid,
    agentId,
    turnId,
    threadId,
    prevCursor,
    recovery: streamState.lastRecoveryMeta,
  });

  const output = await channel.agentPool.runAgent(prompt, chatJid, {
    timeoutMs,
    turnId,
    ...(browserObservability?.userId ? { userId: browserObservability.userId } : {}),
    ...(browserObservability?.sessionId ? { sessionId: browserObservability.sessionId } : {}),
    ...(browserObservability?.clientId ? { clientId: browserObservability.clientId } : {}),
    skipPrePromptCompaction: true,
    scheduleIdleAutoCompaction: true,
    onEvent: trackedStreamingHandler,
    onTurnDiscard: () => {
      clearCommittedDraft();
    },
    onTurnComplete: (turn: { text: string; attachments: unknown[]; usage?: unknown; followedByToolUse?: boolean }) => {
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
        }
      }
    },
  });

  streamState.lastRecoveryMeta = output.recovery || null;

  if (output.status === "tool_complete") {
    // Provider stopped cleanly after tool use with no closing text reply.
    // This is not an error — emit a muted "done" pill and finalise normally.
    // If there is a draft buffer (partial streamed text), surface it so the user
    // sees the work that was done even though the model didn't emit a final reply.
    const toolCompleteDraft = channel.getBuffer(turnId, "draft");
    const toolCompleteDraftText = typeof toolCompleteDraft?.text === "string" ? toolCompleteDraft.text.trim() : "";
    const marker = buildTurnOutcomeMarker({
      kind: "tool_complete",
      label: "done",
      title: "Completed via tools",
      detail: toolCompleteDraftText
        ? "Turn finished after tool use — showing recovered draft."
        : "Turn finished after tool use — no closing reply was emitted.",
      severity: "info",
      draftRecovered: Boolean(toolCompleteDraftText),
    });
    const persisted = toolCompleteDraftText
      ? persistTerminalOutcome(toolCompleteDraftText, marker, { usage: output.usage })
      : persistVisibleFailureOutcome(marker);
    if (persisted) {
      await finalizeSuccessfulRun();
    } else {
      rollbackChatRunWithError(chatJid, {
        prevTs: prevCursor,
        failedTs: lastMessage.timestamp,
        messageId: lastMessage.id,
        threadRootId: resolvedThreadRootId ?? null,
        createdAt: new Date().toISOString(),
      });
    }
    return;
  }

  if (output.status === "error") {
    if (output.error && output.error.includes("already processing")) {
      // A concurrent run is already handling this chat. Roll back the cursor
      // we advanced so this message stays pending, then throw so the queue
      // retries after backoff.
      rollbackInflightRun(chatJid, prevCursor);
      trackedEmitter.status(buildRetryStatusPayload({
        threadId,
        agentId,
        turnId,
        title: "Queued — waiting for current response",
      }));
      throw new Error(output.error);
    }

    if (output.error && output.error.includes("No API provider registered for api:")) {
      // Extension/provider registration races can happen right after restart.
      // Keep the message pending and let the queue retry automatically.
      rollbackInflightRun(chatJid, prevCursor);
      trackedEmitter.status(buildRetryStatusPayload({
        threadId,
        agentId,
        turnId,
        title: "Model provider is initializing — retrying shortly",
        detail: output.error,
      }));
      throw new Error(output.error);
    }

    const errorText = output.error || "Agent error";
    const providerError = formatProviderError(errorText);
    const rateLimited = providerError?.category === "rate_limit" || isRateLimitError(errorText);
    const networkFailed = providerError?.category === "network" || isNetworkError(errorText);
    const networkDetail = providerError?.title || (networkFailed ? describeNetworkError(errorText) : null);
    const markerOptions = {
      toolBudgetExceeded: output.toolBudgetExceeded,
      toolStepsUsed: output.toolStepsUsed,
      toolStepsBudget: output.toolStepsBudget,
      nextAction: output.nextAction,
      abortCause: output.abortCause,
      abortOperation: output.abortOperation,
    };
    const queueToolBudgetContinuation = (): void => {
      if (!output.toolBudgetExceeded || output.recovery?.exhausted) return;
      const continuationThreadId = resolvedThreadRootId
        ?? getMessageRowIdById(chatJid, lastMessage.id ?? "");
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

    const fallbackPublished = errorText.toLowerCase().includes("timed out")
      ? publishDraftFallback("timeout", errorText, { markerOptions })
      : rateLimited
        ? publishDraftFallback("rate-limit", errorText, { markerOptions })
        : publishDraftFallback("error", errorText, { markerOptions });

    if (fallbackPublished) {
      // Reserve/enqueue only after the terminal outcome is durable. A failed
      // terminal write must not consume this lineage's sole continuation.
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
      rollbackChatRunWithError(chatJid, {
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
      title: providerError?.title || (rateLimited ? "AI provider rate limit" : networkFailed ? networkDetail! : errorText),
      detail: providerError?.detail || (rateLimited ? errorText : networkFailed ? errorText : undefined),
      turn_id: turnId,
    });
    return;
  }

  // Store the final turn's output. The same first-turn placeholder rule used
  // during onTurnComplete() also applies here: the original response must not
  // consume a queued follow-up placeholder, but later turns are allowed to.
  //
  // Exactly-once rule: never clear inflight state unless a terminal reply was
  // actually persisted (either the final output itself or a draft fallback).
  const finalAttachments = output.attachments ?? [];
  const hasOutput = !!(output.result || finalAttachments.length > 0);
  const finalDraft = channel.getBuffer(turnId, "draft");
  const hasDraftFallback = typeof finalDraft?.text === "string" && finalDraft.text.trim().length > 0;
  const finalized = hasOutput
    ? storeAgentTurn(channel, emitter, {
        chatJid,
        text: output.result || "",
        attachments: finalAttachments as AttachmentInfo[],
        channelName,
        threadId: resolvedThreadRootId,
        skipPlaceholder: turnCount === 0,
        isTerminalAgentReply: true,
        extraContentBlocks: [
          streamRuntime.buildAgentTimingBlock(output.usage),
          ...(buildRecoveryMarkerBlocks(output.recovery) ?? []),
          ...streamRuntime.buildThinkingRefBlocks(),
        ],
        onMessageStored: streamRuntime.persistThinkingForRow,
      })
    : hasDraftFallback
      ? publishDraftFallback("empty-final")
      : persistedIntermediateOutput
        ? true
        : publishDraftFallback("empty-final");

  if (!finalized && hasOutput) {
    // The agent produced output but terminal persistence failed.
    // Hold the user turn for an explicit retry/skip decision.
    const errorText = "Agent completed but terminal response could not be persisted.";
    rollbackChatRunWithError(chatJid, {
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
    return;
  }

  if (!finalized && !hasOutput) {
    if (persistedIntermediateOutput) {
      // A prior turn in the same run was already persisted (e.g. auto-
      // compaction produced a trailing empty turn). Treat this as success and
      // do not emit the no-response warning.
      await finalizeSuccessfulRun();
      return;
    }

    if (hadIntermediateOutput && intermediatePersistFailed) {
      const errorText = "Agent produced intermediate output but it could not be persisted.";
      rollbackChatRunWithError(chatJid, {
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
      return;
    }

    // Check if a draft buffer existed — if so, the agent DID produce content
    // but persistence failed, which is a real error worth recording.
    const draft = channel.getBuffer(turnId, "draft");
    const hadDraft = !!(typeof draft?.text === "string" && draft.text.trim());
    if (hadDraft) {
      const errorText = "Agent completed but draft response could not be persisted.";
      rollbackChatRunWithError(chatJid, {
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
      return;
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
      || !!streamState.lastCompactionErrorMessage;

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
      if (persisted) {
        await finalizeSuccessfulRun();
      } else {
        rollbackChatRunWithError(chatJid, {
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
      return;
    }

    // Missing terminal output is a real failure. Consume the user turn with a
    // compact bubble instead of replaying it through hidden failed-run state.
    const title = "Agent produced no response";
    const detail =
      "The model returned an empty reply before finalization.";

    log.warn("Agent completed without output; marking run as failed", {
      operation: "process_chat.no_output_blank_failed",
      chatJid,
      hadIntermediateOutput,
      persistedIntermediateOutput,
      hadDraft,
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
    if (persisted) {
      await finalizeSuccessfulRun();
    } else {
      rollbackChatRunWithError(chatJid, {
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
    return;
  }

  await finalizeSuccessfulRun();
  endTrackedPhase(chatJid);
}
