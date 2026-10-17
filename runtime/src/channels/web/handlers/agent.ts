/**
 * web/handlers/agent.ts – HTTP handlers for agent-related API endpoints.
 *
 * Handles GET /agent/roster, GET /agent/status, GET /agent/thought,
 * POST /agent/thought/visibility, avatar upload/retrieval, user profile,
 * and branding endpoints.
 *
 * Consumers: web/request-router.ts routes agent paths to these handlers.
 */

import { acceptQueuedInputSource } from "../runtime/queued-followup-lifecycle-service.js";
import { getAddonLocalDispatchBlock } from "../../../addons/local-dispatch.js";
import { withVerifiedAddonMessage } from "../../../addons/local-context.js";
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { readAccessConfig } from "../../../core/config-access.js";
import { isFamilyWebToolAllowed } from '../../../core/family-workspace-policy.js';
import { withExecutionIdentity, type ExecutionIdentity } from "../../../core/execution-context.js";
import { withChatContext } from "../../../core/chat-context.js";
import { ChatAccessDenied } from "../../../db/session-ownership.js";
import { resolveFamilyMessageAuthority } from "../messaging/family-message-authority.js";
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
import {
  PROTECTED_RECOVERY_CONTROL_LABEL,
  buildProtectedRecoveryControlIntentBlock,
  resolveProtectedRecoveryControlIntent,
} from "../../../agent-pool/protected-recovery-control-intent.js";
import {
  MAX_PROTECTED_RECOVERY_HANDOFF_DEPTH,
  PROTECTED_RECOVERY_HANDOFF_LIMIT_MESSAGE,
  isPostCompactionProtectedRecoveryHandoff,
} from "../../../agent-pool/protected-recovery-handoff.js";
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
  getMessagesSince,
  getFailedRun,
  getInflightMessageId,
  getMessageRowIdById,
  getDb,
  rollbackChatRunWithError,
  rollbackInflightRun,
  setChatCursor,
} from "../../../db.js";
import { detectChannel, formatMessages, formatOutbound } from "../../../router.js";
import { isSqliteContention } from '../../../db/sqlite-async-admission.js';
import { bindInputRequestAuthority, readInputRequestAuthority, releaseInputRequestAuthority, captureInputTarget, type ValidateInputAuthority } from '../messaging/input-request-authority.js';
import { createAgentProfileBuilder } from "../agent/agent-utils.js";
import { buildGeneralSettingsProfileUpdate, getGeneralSettingsData } from "./general-settings.js";
import { resolveAvatarUrl } from "../media/avatar-service.js";
import { broadcastInteractionUpdated } from "../cards/interaction-service.js";
import { storeAgentTurn } from "../messaging/agent-message-store.js";
import { finalizeSuccessfulProcessChatRun, persistIntermediateProcessChatTurn } from "../runtime/process-chat-finalization-runtime.js";
import { createProcessChatStreamingRuntime } from "../runtime/process-chat-streaming-runtime.js";
import { getMessageByRowId, promoteCompletedAgentReply } from "../../../db/messages.js";
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
import type { AgentFailureCategory, TurnOutput } from "../../../agent-pool/contracts.js";
import {
  buildProtectedRecoveryHandoffMetadata,
  formatProtectedRecoveryHandoff,
  protectedRecoveryHandoffContentBlockFields,
  type ProtectedRecoveryHandoffMetadata,
} from "../../../agent-pool/protected-recovery-handoff-reason.js";
import { classifyOpaqueAgentFailure } from "../../../agent-pool/automatic-recovery.js";
import { cancelScheduledIdleAutoCompaction } from "../../../agent-pool/compaction.js";
import { DEFAULT_BASE_RETRY_MS, getRetryAtIso } from "../../../queue/retry-policy.js";
import { formatProviderError, sanitizeProviderErrorDetail } from "./provider-error-format.js";
import { endTrackedPhase } from "../../../runtime/progress-watchdog.js";

const log = createLogger("web.handlers.agent");
const TOOL_BUDGET_CONTINUATION_EXTENSION_ID = "piclaw.tool-budget-continuation";

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
  protectedRecoveryHandoff?: ProtectedRecoveryHandoffMetadata;
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
    ...(options.protectedRecoveryHandoff
      ? protectedRecoveryHandoffContentBlockFields(options.protectedRecoveryHandoff)
      : {}),
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
    protectedRecoveryHandoff?: ProtectedRecoveryHandoffMetadata;
  } = {},
): Record<string, unknown> {
  const category = options.failureCategory ?? "unknown";
  const displayErrorText = sanitizeProviderErrorDetail(errorText) || "Agent error";
  const detail = displayErrorText.slice(0, 500);
  const providerError = formatProviderError(displayErrorText);
  if (options.protectedRecoveryHandoff) {
    const presentation = formatProtectedRecoveryHandoff(options.protectedRecoveryHandoff);
    return buildTurnOutcomeMarker({
      kind: "recovery",
      label: presentation.label,
      title: presentation.title,
      detail: presentation.detail,
      severity: options.severity ?? "warning",
      draftRecovered: options.draftRecovered,
      attemptsUsed: options.attemptsUsed,
      classifier: options.classifier,
      failureCategory: category,
      nextAction: presentation.nextAction,
      protectedRecoveryHandoff: options.protectedRecoveryHandoff,
    });
  }
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
  if (category === "credential_storage") {
    return buildTurnOutcomeMarker({
      ...common,
      kind: "error",
      label: "credentials",
      title: "Credentials could not be read/resolved; local storage/configuration needs attention",
      detail: "Credentials could not be read/resolved; local storage/configuration needs attention",
      severity: options.severity ?? "error",
    });
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
    return buildTurnOutcomeMarker({
      ...common,
      kind: "network",
      label: providerError?.label ?? "network",
      title: providerError?.title ?? describeNetworkError(displayErrorText),
      detail: providerError?.detail ?? detail,
      severity: options.severity ?? providerError?.severity ?? "error",
    });
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
  if (category === "context_pressure") {
    return buildTurnOutcomeMarker({
      ...common,
      kind: "context",
      label: "context",
      title: "Context limit reached",
      detail: options.abortCause === "context_pressure"
        ? "Piclaw paused this turn at its context threshold. Automatic continuation did not complete; the session is preserved."
        : detail,
      severity: options.severity ?? "warning",
      nextAction: options.nextAction || "Ask me to continue from the saved state; if context pressure persists, run /compact first.",
      abortCause: options.abortCause,
      abortOperation: options.abortOperation,
    });
  }
  if (category === "session_corruption") {
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

// Only in-process forwarding can share the original guarded request authority.
// No request body/header can supply or replace this capability.
function captureInputAuthority(channel: WebChannelLike, req: Request): () => void {
  const gateway = channel.authGateway;
  const authEnabled = gateway?.isAuthEnabled?.() === true;
  const principal = gateway?.getPrincipal?.(req, true) ?? null;
  const key = (value: typeof principal) => JSON.stringify(value && [value.kind, value.userId, value.mode, value.role, value.authentication]);
  const principalKey = key(principal);
  const internal = !principal && gateway?.isInternalSecretEnabled?.() === true && gateway.verifyInternalSecret(req);
  if (authEnabled && !principal && !internal) throw Error('Incoming request has no verified authority.');
  return () => {
    req.signal.throwIfAborted();
    if (readAccessConfig().mode !== 'single-user' || (gateway?.isAuthEnabled?.() === true) !== authEnabled) throw Error('Incoming request authority changed.');
    if (internal) {
      if (!gateway.isInternalSecretEnabled() || !gateway.verifyInternalSecret(req)) throw Error('Internal request authority changed.');
    } else if (key(gateway?.getPrincipal?.(req, true) ?? null) !== principalKey) {
      throw Error('Incoming request principal changed.');
    }
  };
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
  if (readAccessConfig().mode !== "single-user") return channel.json({ error: "Use account-bound text message admission." }, 403);
  let internalAuthority: ReturnType<typeof readInputRequestAuthority>;
  let revalidateInputAuthority: ValidateInputAuthority;
  try { internalAuthority = readInputRequestAuthority(req, chatJid, pathname); revalidateInputAuthority = internalAuthority?.validate ?? captureInputAuthority(channel, req); revalidateInputAuthority(); }
  catch { return channel.json({ error: 'Input authority is unavailable.' }, 403); }
  // Pin the trusted host selection to this route before any body read/await.
  // Request contents cannot select an engine or replace this SQL-only callback.
  const prepareAdmission = channel.prepareInputSourceAdmission?.bind(channel);
  const lookupAdmission = channel.getInputSourceAdmission?.bind(channel);
  const lookupQueuedAdmission = channel.getQueuedInputSourceAdmission?.bind(channel);
  let acceptSource: ReturnType<NonNullable<WebChannelLike["getInputSourceAdmission"]>>;
  let acceptQueuedSource: ReturnType<NonNullable<WebChannelLike["getQueuedInputSourceAdmission"]>>;
  try {
    if (!prepareAdmission) {
      acceptSource = lookupAdmission?.(chatJid);
      acceptQueuedSource = lookupQueuedAdmission?.(chatJid);
    }
  }
  catch { return channel.json({ error: 'Input admission could not be confirmed.' }, 503); }
  if (internalAuthority) {
    try {
      const reader = req.clone().body?.getReader();
      if (!reader) throw Error('Internal input body is missing.');
      const chunks: Uint8Array[] = []; let bytes = 0;
      try {
        for (;;) { req.signal.throwIfAborted(); const next=await reader.read(); if(next.done)break; bytes+=next.value.length; if(bytes>512*1024)throw Error('Internal input body exceeds bound.'); chunks.push(next.value); }
        const body = Buffer.concat(chunks.map(chunk=>Buffer.from(chunk))).toString('utf8');
        internalAuthority.verifyBody(body); revalidateInputAuthority();
      } finally { await reader.cancel(); reader.releaseLock(); }
    } catch { return channel.json({ error: 'Internal input binding changed.' }, 403); }
  }
  const agentId = pathname.split("/")[2] || defaultAgentId;
  const browserObservability = getBrowserObservabilityContext(req);
  const parsed = await parseAgentMessageRequest(req);
  if (parsed.error || !parsed.payload) return channel.json({ error: parsed.error }, 400);
  try { revalidateInputAuthority(); }
  catch { return channel.json({ error: 'Input authority changed before admission.' }, 403); }

  const normalized = normalizeAgentMessagePayload(parsed.payload);
  const localDispatch = getAddonLocalDispatchBlock(req, chatJid, normalized.content ?? "");
  if (localDispatch) normalized.contentBlocks = [...(normalized.contentBlocks ?? []), localDispatch];
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
  if (prepareAdmission) {
    try {
      revalidateInputAuthority();
      if (!command && !themeCommand && !metersCommand && !isSettingsCommand && !isSlashCommandInvocation(content)) {
        await prepareAdmission(chatJid);
        revalidateInputAuthority();
      }
      acceptSource = lookupAdmission?.(chatJid);
      acceptQueuedSource = lookupQueuedAdmission?.(chatJid);
    } catch { return channel.json({ error: 'Input admission could not be confirmed.' }, 503); }
  }
  const isStreaming = typeof channel.agentPool.isStreaming === "function"
    ? channel.agentPool.isStreaming(chatJid)
    : false;
  const isChatActive = () => channel.agentPool.isStreaming?.(chatJid) === true
    || channel.agentPool.isActive?.(chatJid) === true
    || channel.queue?.isLaneBusy?.(`chat:${chatJid}`) === true;
  const isActive = isChatActive();
  const hasQueuedBacklog = channel.getQueuedFollowupCount(chatJid) > 0;
  // NOTE: we intentionally use the in-memory active-run flags—not the DB
  // inflight marker—to decide whether to queue/defer. The DB marker survives
  // restarts and can be stale (cleared only when recovery runs), so trusting
  // it here would silently defer messages against ghost turns that no
  // processChat is actively draining. The in-memory session state resets on
  // restart and reflects whether the agent pool still has an active run,
  // including streaming/compaction/retry phases of the same turn.

  if (mention && mentionTarget && mentionTarget.chat_jid !== chatJid) {
    const targetJid = mentionTarget.chat_jid;
    const targetName = mentionTarget.agent_name;
    const validateTarget = captureInputTarget(targetJid);
    const sourceContent = typeof normalized.content === 'string' ? normalized.content : content;
    const sourceOptions = { contentBlocks: normalized.contentBlocks, linkPreviews: normalized.linkPreviews, screenHint: normalized.screenHint };
    let sourceInteraction: ReturnType<typeof storeAgentUserMessage>;
    try {
      // Mentions commit the source before forwarding, but creation and its
      // authority proof still belong to that source's own admission TX.
      sourceInteraction = channel.admitUserMessage
        ? await channel.admitUserMessage(chatJid, sourceContent, normalized.mediaIds, sourceOptions, revalidateInputAuthority, req.signal)
        : storeAgentUserMessage(channel, chatJid, { content: sourceContent, mediaIds: normalized.mediaIds, ...sourceOptions });
    } catch (error) {
      if (req.signal.aborted) return channel.json({ error: 'Input submission was cancelled before acceptance.' }, 400);
      if (isSqliteContention(error)) return channel.json({ error: 'Message storage is busy; this input was not accepted.' }, 503);
      return channel.json({ error: 'Source input admission could not be confirmed.' }, 503);
    }
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
    const forwardBody = JSON.stringify({
      content: forwardedContent, media_ids: normalized.mediaIds, content_blocks: normalized.contentBlocks,
      link_previews: normalized.linkPreviews, mode: requestMode,
      ...(persistSteer ? { persist_steer: true } : {}), screen_hint: normalized.screenHint,
    });
    const forwardReq = new Request(`http://internal/agent/${agentId}/message?chat_jid=${encodeURIComponent(mentionTarget.chat_jid)}`, {
      method: "POST",
      headers: forwardHeaders,
      signal: req.signal,
      body: forwardBody,
    });
    let forwardRes: Response;
    try {
      bindInputRequestAuthority(forwardReq, targetJid, forwardBody, phase => {
        // The source TX is already committed. Recheck that exact receipt, not
        // its original absent lifetime or the target's new attempt phase.
        revalidateInputAuthority('after');
        const currentTarget = typeof channel.agentPool.findChatByAgentName === 'function'
          ? channel.agentPool.findChatByAgentName(mention!.agentName)
          : channel.agentPool.findActiveChatByAgentName?.(mention!.agentName);
        if (currentTarget?.chat_jid !== targetJid || currentTarget?.agent_name !== targetName) throw Error('Mention target changed.');
        validateTarget(phase);
      });
      forwardRes = await handleAgentMessage(channel, forwardReq, pathname, mentionTarget.chat_jid, defaultAgentId);
    } catch (error) {
      debugSuppressedError(log, 'Mention forwarding failed after source commit.', error, { operation: 'agent_message.mention_forward_after_commit', chatJid, targetJid, rowId: sourceInteraction.id });
      forwardRes = channel.json({ error: req.signal.aborted
        ? 'Mention forwarding was cancelled after source acceptance.'
        : 'Mention forwarding authority could not be confirmed after source acceptance.' }, req.signal.aborted ? 400 : 403);
    }
    finally { releaseInputRequestAuthority(forwardReq); }
    const responseBody = await forwardRes.json().catch(() => ({} as Record<string, unknown>));
    return channel.json({
      ...responseBody,
      user_message: sourceInteraction,
      source_chat_jid: chatJid,
      source_agent_name: sourceAgentName,
      target_chat_jid: mentionTarget.chat_jid,
      target_agent_name: mentionTarget.agent_name,
      source_committed: true,
      relayed: forwardRes.ok,
      mention_routed: true,
    }, forwardRes.status);
  }

  const revalidateQueuedAdmission = revalidateInputAuthority;
  const queueDeferredFollowup = async (
    queuedContent: string,
    extras: QueueDeferredFollowupExtras = {}
  ): Promise<Response> => {
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
    const args: Parameters<WebChannelLike['enqueueQueuedFollowupItem']> = [chatJid, 0, queuedContent, queuedThreadId, queuedAt, {
      mediaIds: extras.mediaIds,
      contentBlocks: extras.contentBlocks,
      linkPreviews: extras.linkPreviews,
      screenHint: extras.screenHint,
      source: extras.source,
      queuedBy: queuedBy && Object.keys(queuedBy).length > 0 ? queuedBy : undefined,
    }];
    let queuedRowId: number;
    try {
      const accept = !command && !themeCommand && !metersCommand && !isSettingsCommand
        && !isSlashCommandInvocation(trimmed) && extras.source === 'web.compose' ? acceptQueuedSource : undefined;
      if (accept && !channel.admitQueuedFollowupItem) throw Error('Atomic queued admission is unavailable.');
      queuedRowId = channel.admitQueuedFollowupItem
        ? await channel.admitQueuedFollowupItem(args, revalidateQueuedAdmission, req.signal, accept)
        : channel.enqueueQueuedFollowupItem(...args);
    } catch (error) {
      if (isSqliteContention(error)) return channel.json({ error: 'Queue storage is busy; this input was not accepted.' }, 503);
      if (req.signal.aborted) return channel.json({ error: 'Input submission was cancelled before acceptance.' }, 400);
      return channel.json({ error: 'Queued input could not be accepted.' }, 403);
    }
    channel.broadcastEvent("agent_followup_queued", {
      chat_jid: chatJid,
      thread_id: queuedThreadId,
      row_id: queuedRowId,
      content: queuedContent,
      timestamp: queuedAt,
      ...(extras.source ? { source: extras.source } : {}),
      ...(queuedBy && Object.keys(queuedBy).length > 0 ? { queued_by: queuedBy } : {}),
    });
    const stillActive = isChatActive();
    // Manual /queue remains deferred even while idle. Compose admission opts
    // in so a turn ending during an asynchronous lock wait cannot strand input.
    if (extras.wakeIfIdle && !stillActive) {
      channel.resumeChat(chatJid);
    }
    return channel.json({ queued: "followup", thread_id: queuedThreadId }, 201);
  };

  const queueDeferredSteer = async (steerContent: string, source?: string): Promise<Response | null> => {
    if (!isStreaming) return null;
    const steerResult = await channel.agentPool.queueStreamingMessage(chatJid, steerContent, "steer",
      internalAuthority ? { validate: revalidateInputAuthority, signal: req.signal } : undefined);
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
    hasCommand: Boolean(command || themeCommand),
    contentPreview: content.slice(0, 60),
  });

  if (!persistSteer && !command && !themeCommand && !metersCommand && !isSettingsCommand && isStreaming && requestMode === "steer") {
    const steerResponse = await queueDeferredSteer(content, "compose");
    if (steerResponse) return steerResponse;
    return queueDeferredFollowup(content, {
      source: 'web.steer_startup_fallback', browserContext: browserObservability, wakeIfIdle: true,
      mediaIds: normalized.mediaIds, contentBlocks: normalized.contentBlocks,
      linkPreviews: normalized.linkPreviews, screenHint: normalized.screenHint,
    });
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

    let themeResponseDelivered = true;
    const formattedThemeMessage = formatOutbound(themeCommand.message, "web");
    if (formattedThemeMessage) {
      try {
        // Keep /theme purely UI-scope but still surface the command output to the
        // timeline so users can see the theme list/output immediately.
        await channel.sendMessage(chatJid, formattedThemeMessage, { forceRoot: true, requirePersistence: true });
      } catch (error) {
        themeResponseDelivered = false;
        log.error("Failed to send /theme response", {
          operation: "handle_agent_message.theme_response",
          chatJid,
          err: error,
        });
      }
    }

    return channel.json(
      { thread_id: null, command: themeCommand, ui_only: true, response_delivery: themeResponseDelivered ? 'persisted' : 'failed' },
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

  // Bound durable maintenance must follow the accepted primary's terminal
  // settlement. Reuse the host selector captured before body awaits, without
  // invoking source admission for a command. Legacy compaction stays immediate.
  if (command?.type === "compact" && acceptSource !== undefined && isActive) {
    return queueDeferredFollowup(content, { source: "web.compose", browserContext: browserObservability, wakeIfIdle: true });
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
    (requestMode === "queue" || requestMode === "auto" || (requestMode === "steer" && !isStreaming));

  if (shouldDeferQueuedFollowup) {
    log.info("Deferring agent message as queued follow-up", {
      operation: "handle_agent_message.defer_followup",
      chatJid,
      mode: requestMode,
      isStreaming,
      isActive,
      hasQueuedBacklog,
      shouldDefer: true,
      hasCommand: Boolean(command || themeCommand),
      contentPreview: content.slice(0, 60),
    });

    const response = queueDeferredFollowup(content, {
      mediaIds: normalized.mediaIds,
      contentBlocks: normalized.contentBlocks,
      linkPreviews: normalized.linkPreviews,
      screenHint: normalized.screenHint,
      source: requestMode === 'steer' ? 'web.steer_startup_fallback' : 'web.compose',
      browserContext: browserObservability,
      wakeIfIdle: true,
    });

    return response;
  }

  let queuedDuringAdmission = false;
  let deferredRowId = 0;
  let deferredAt = '';
  const deferredSource = requestMode === 'steer' ? 'web.steer_startup_fallback' : 'web.compose';
  let interaction: ReturnType<typeof storeAgentUserMessage>;
  // Ordinary input admitted while idle can become a follow-up while waiting
  // for storage. Decide against fresh in-memory state inside the same commit.
  if (channel.admitUserMessage && !command && !themeCommand && !metersCommand && !isSettingsCommand
    && !content.trimStart().startsWith('/') && (!persistSteer || requestMode !== 'steer' || !isStreaming)) {
    try {
      interaction = await channel.admitUserMessage(chatJid, content, normalized.mediaIds, {
        contentBlocks: normalized.contentBlocks, linkPreviews: normalized.linkPreviews,
        threadId: normalized.threadId, screenHint: normalized.screenHint, acceptSource,
      }, revalidateQueuedAdmission, req.signal, () => {
        const busy = isChatActive();
        queuedDuringAdmission = busy || channel.getQueuedFollowupCount(chatJid) > 0;
        if (!queuedDuringAdmission) return false;
        deferredAt = new Date().toISOString();
        deferredRowId = channel.enqueueQueuedFollowupItem(chatJid, 0, content,
          null, deferredAt, {
            source: deferredSource, mediaIds: normalized.mediaIds, contentBlocks: normalized.contentBlocks,
            linkPreviews: normalized.linkPreviews, screenHint: normalized.screenHint,
            queuedBy: { ...(browserObservability.userId ? { userId: browserObservability.userId } : {}),
              ...(browserObservability.sessionId ? { sessionId: browserObservability.sessionId } : {}),
              ...(browserObservability.clientId ? { clientId: browserObservability.clientId } : {}) },
          });
        if (deferredSource === 'web.compose' && acceptQueuedSource)
          acceptQueuedInputSource(chatJid, deferredRowId, getDb(), acceptQueuedSource);
        return true;
      });
    } catch (error) {
      if (isSqliteContention(error)) return channel.json({ error: 'Message storage is busy; this input was not accepted.' }, 503);
      if (req.signal.aborted) return channel.json({ error: 'Input submission was cancelled before acceptance.' }, 400);
      return channel.json({ error: 'Input admission could not be confirmed.' }, 503);
    }
  } else {
    // Legacy synchronous storage still needs the host fence after async parsing/attachments.
    revalidateInputAuthority();
    interaction = storeAgentUserMessage(channel, chatJid, {
      content, mediaIds: normalized.mediaIds, contentBlocks: normalized.contentBlocks,
      linkPreviews: normalized.linkPreviews, threadId: normalized.threadId, screenHint: normalized.screenHint,
    });
  }

  if (queuedDuringAdmission) {
    channel.broadcastEvent('agent_followup_queued', { chat_jid: chatJid, row_id: deferredRowId, content,
      thread_id: null, timestamp: deferredAt, source: deferredSource });
    if (!isChatActive()) channel.resumeChat(chatJid);
    return channel.json({ thread_id: null, queued: 'followup' }, 201);
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

  const withAgentProfile = (payload: Record<string, unknown>) => {
    const identity = getIdentityConfig();
    return createAgentProfileBuilder(
      chatJid, identity.assistantName, resolveAvatarUrl("agent", identity.assistantAvatar),
      identity.userName || null, resolveAvatarUrl("user", identity.userAvatar), identity.userAvatarBackground || null,
    )(payload);
  };

  let commandStatusTurnId: unknown;
  let commandStatusStarted = false;
  const emitCommandStatus = (payload: Record<string, unknown>) => {
    const activeStatus = typeof channel.getAgentStatus === "function"
      ? channel.getAgentStatus(chatJid)
      : null;
    // A new command may claim the surface, but an older operation must not
    // overwrite a successor (or resurrect a status that has been cleared).
    if (commandStatusStarted && typeof channel.getAgentStatus === "function"
      && (!activeStatus || activeStatus.turn_id !== commandStatusTurnId)) return;
    if (!commandStatusStarted) {
      commandStatusTurnId = payload.turn_id;
      commandStatusStarted = true;
    }
    // Usage is a side-channel event, not a lifecycle phase. In particular it
    // must not replace the owning intent before that command's terminal event.
    if (payload.type === "context_usage") {
      channel.broadcastEvent("agent_status", withAgentProfile(payload));
      return;
    }
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
    const contextUsageRecord = contextUsage as unknown as { sessionGeneration?: unknown };
    const usageGeneration = typeof contextUsageRecord.sessionGeneration === "string"
      ? contextUsageRecord.sessionGeneration
      : null;
    const activeGeneration = typeof channel.agentPool.getSessionGenerationForChat === "function"
      ? channel.agentPool.getSessionGenerationForChat(chatJid)
      : null;
    if (usageGeneration && activeGeneration && usageGeneration !== activeGeneration) return;
    const sessionGeneration = usageGeneration ?? activeGeneration;
    const persistedUsage = {
      tokens: contextUsage.tokens,
      contextWindow: contextUsage.contextWindow,
      percent: contextUsage.percent,
      ...(sessionGeneration ? { sessionGeneration } : {}),
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
    if (isCompactCommand || isSessionRotateCommand) {
      // Claim before model lookup can yield; later metadata must retain ownership
      // and the original timer rather than claiming over a newer command.
      const intent = {
        thread_id: interaction.timestamp,
        agent_id: agentId,
        turn_id: commandTurnId,
        type: "intent",
        title: isCompactCommand ? "Compacting context" : "Rotating session",
        detail: isCompactCommand
          ? "Manual compaction requested via /compact."
          : "Compacting context before archiving the current session and creating its successor.",
        intent_key: isCompactCommand ? "compaction" : "session_rotation",
        started_at: new Date().toISOString(),
        model: null,
      };
      emitCommandStatus(intent);
      if (typeof channel.agentPool.getCurrentModelLabel === "function") {
        let commandModel: string | null = null;
        try {
          commandModel = await channel.agentPool.getCurrentModelLabel(chatJid);
        } catch (err) {
          debugSuppressedError(log, "Failed to read model for command status.", err, { operation: "command_status.model_lookup" });
        }
        if (commandModel !== null) emitCommandStatus({ ...intent, model: commandModel });
      }
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
    if (result.status === "success" && ["agent_avatar", "agent_name", "user_avatar", "user_name", "user_github"].includes(command.type)) {
      channel.broadcastEvent("profile_update", buildGeneralSettingsProfileUpdate(getGeneralSettingsData()));
    }
    if (result.status === "success" && result.sessionGenerationChanged && result.sessionGeneration) {
      const boundaryUsage = {
        tokens: null,
        contextWindow: null,
        percent: null,
        sessionGeneration: result.sessionGeneration,
      };
      channel.setContextUsage(chatJid, { ...boundaryUsage, reset: true });
      emitCommandStatus({
        thread_id: interaction.timestamp,
        agent_id: agentId,
        turn_id: commandTurnId,
        type: "context_usage",
        context_reset: true,
        sessionGeneration: result.sessionGeneration,
        context_usage: boundaryUsage,
      });
    }
    if (result.status === "success" && !result.sessionGenerationChanged && (isCompactCommand || isSessionRotateCommand)) {
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
  const mode = readAccessConfig().mode;
  if (mode === "single-user") return processAuthorisedChat(channel, chatJid, agentId, threadRootId, browserObservability);
  if (mode !== "family-shared") throw new ChatAccessDenied();
  const pending = getMessagesSince(chatJid, getChatCursor(chatJid), getIdentityConfig().assistantName);
  if (!pending.length) return; // Never materialise unprovenanced legacy follow-ups in family mode.
  const message = pending[0]!;
  const identity = resolveFamilyMessageAuthority(chatJid, message.id);
  // Family failures need an explicit owner-authorised retry/skip; never use legacy stale-failure skipping.
  if (getFailedRun(chatJid)) throw new Error("Family message processing is held for an authorised recovery action.");
  const rootId = message.thread_id ?? getMessageRowIdById(chatJid, message.id) ?? undefined;
  return withExecutionIdentity(identity, () => withChatContext(chatJid, "web", () =>
    processAuthorisedChat(channel, chatJid, agentId, rootId, { userId: identity.provenance.actorUserId }, identity)));
}

async function processAuthorisedChat(
  channel: WebChannelLike,
  chatJid: string,
  agentId: string,
  threadRootId?: number,
  browserObservability?: BrowserObservabilityContext,
  identity?: ExecutionIdentity,
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

  const coordinator = channel.dispatchAcceptedInput;
  const pendingIdentity = Object.freeze({ chatJid, messageId: currentMessage.id,
    rowId: getMessageRowIdById(chatJid, currentMessage.id) ?? 0 });
  const waitForPending = coordinator?.waitForPending.bind(coordinator);
  let acceptedDispatch: (() => Promise<"settled" | "pending">) | undefined;
  try {
    acceptedDispatch = coordinator?.(chatJid, currentMessage.id, pendingIdentity.rowId);
  } catch {
    // A fenced or unreadable persisted selection is not evidence of legacy ownership.
    acceptedDispatch = async () => "pending";
  }
  if (acceptedDispatch) {
    const { beginChatRun, endChatRun } = await import("../../../db/chat-cursors.js");
    beginChatRun(chatJid, currentMessage.timestamp, { prevTs: prevCursor,
      messageId: currentMessage.id, startedAt: new Date().toISOString() });
    let result = await acceptedDispatch().catch(() => "pending" as const);
    if (result === "pending") {
      // The captured host port owns observation only. Shutdown must retain the recovery marker.
      if (!waitForPending) throw new Error("Accepted dispatch requires host pending observation");
      result = await waitForPending(pendingIdentity);
      if (result === "pending") return;
    }
    endChatRun(chatJid);
    channel.resumeChat(chatJid);
    return;
  }

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
  const protectedRecoveryIntent = resolveProtectedRecoveryControlIntent(currentMessage);
  const protectedRecoveryPrompt = protectedRecoveryIntent
    ? TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT
    : null;
  const protectedRecoveryHandoffContext: ProtectedRecoveryHandoffMetadata | undefined =
    protectedRecoveryIntent?.reason
      && protectedRecoveryIntent.compaction
      && typeof protectedRecoveryIntent.tools_required === "boolean"
      && typeof protectedRecoveryIntent.retryable === "boolean"
      && Number.isInteger(protectedRecoveryIntent.recovery_attempts)
      ? {
          reason: protectedRecoveryIntent.reason,
          compaction: protectedRecoveryIntent.compaction,
          toolsRequired: protectedRecoveryIntent.tools_required,
          retryable: protectedRecoveryIntent.retryable,
          recoveryAttempts: Number(protectedRecoveryIntent.recovery_attempts),
          ...(protectedRecoveryIntent.primary_failure_category === "timeout"
            ? {
                primaryFailure: {
                  category: "timeout" as const,
                  detail: String(protectedRecoveryIntent.primary_failure_detail),
                  elapsedMs: Number(protectedRecoveryIntent.primary_failure_elapsed_ms),
                  executionToolsEnabled: protectedRecoveryIntent.primary_failure_execution_tools === true,
                  hadPartialOutput: protectedRecoveryIntent.primary_failure_had_partial_output === true,
                  hadToolActivity: protectedRecoveryIntent.primary_failure_had_tool_activity === true,
                  toolExecutionCount: Number(protectedRecoveryIntent.primary_failure_tool_executions),
                },
              }
            : {}),
          ...(protectedRecoveryIntent.recovery_source_id
            ? { recoverySourceId: protectedRecoveryIntent.recovery_source_id }
            : {}),
          ...(Number.isInteger(protectedRecoveryIntent.recovery_generation)
            ? { recoveryGeneration: protectedRecoveryIntent.recovery_generation }
            : {}),
        }
      : undefined;
  const promptMessage = protectedRecoveryPrompt
    ? { ...currentMessage, content: protectedRecoveryPrompt }
    : currentMessage;
  const prompt = formatMessages([identity ? { ...promptMessage, sender_name: identity.displayName, sender: identity.provenance.actorUserId } : promptMessage], channelName, chatJid);
  const lastMessage = currentMessage;
  const runStartedAt = new Date().toISOString();
  const threadId = lastMessage.timestamp;

  const turnId = createUuid("turn");
  const streamRuntime = await createProcessChatStreamingRuntime({
    channel, chatJid, agentId, threadId, turnId, runStartedAt, sourceMessageId: lastMessage.id ?? null,
    withResolvedToolStatusHints, withAgentStatusProgressMetadata,
  });
  const { emitter, trackedEmitter, streamingHandler: trackedStreamingHandler, timeoutMs } = streamRuntime;
  const streamState = streamRuntime.state;
  let turnCount = 0;
  let hadIntermediateOutput = false;
  let persistedIntermediateOutput = false;
  let intermediatePersistFailed = false;
  const resolvedThreadRootId = resolveThreadRootId(channel, chatJid, currentMessage.id ?? "", effectiveThreadRootId);

  let startupFailure: string | undefined;
  let preflight: "continue" | "deferred" = "continue";
  try { preflight = await runProcessChatPreflight({
    channel, chatJid, agentId, message: { id: lastMessage.id, timestamp: lastMessage.timestamp }, prevCursor, effectiveThreadRootId: effectiveThreadRootId ?? null, turnId, runStartedAt, browserObservability,
    streamingHandler: trackedStreamingHandler, compactionState: streamState,
    skipPrePromptCompaction: Boolean(identity) || protectedRecoveryHandoffContext?.reason === "unresolved_tool_execution",
    enqueueResume: (root) => enqueueProcessChatAfterCompaction(channel, chatJid, agentId, lastMessage.id, root, browserObservability),
  }); } catch (error) {
    startupFailure = error instanceof Error ? error.message : "Runtime startup failed.";
  }
  if (preflight === "deferred") return;

  let shouldRemoveStaleProtectedContinuation = false;
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
      onMessageStored: (rowId, interaction) => streamRuntime.consumePersistedPreviewsForRow(
        rowId,
        interaction.data?.thread_id ?? resolvedThreadRootId,
      ),
    });
  };
  const persistVisibleFailureOutcome = (
    markerBase: Record<string, unknown>,
    detail?: string,
    options: { requireDraft?: boolean; suppressDraft?: boolean } = {},
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
    const markerSeverity = readTrimmedString(marker?.severity);
    const inlineDiagnostic = markerKind === "tool_budget"
      || markerClassifier === "tool_history_pressure"
      || markerClassifier === "budget_exhausted";
    const showDiagnosticWithoutDraft = (markerType === "timeout_marker"
      && markerClassifier === "budget_exhausted")
      || markerKind === "context"
      || (markerKind === "recovery" && markerSeverity !== "info");
    const text = buildFailureVisibleText({
      draftText: options.suppressDraft ? '' : draftText,
      title,
      detail: detail || markerDetail,
      actionSummary: lastAction?.summary,
      attemptsUsed: Number.isFinite(marker?.attempts_used) ? (marker?.attempts_used as number) : undefined,
      classifier: markerClassifier,
      nextAction: readTrimmedString(marker?.next_action),
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
        failureCategory?: AgentFailureCategory;
        toolBudgetExceeded?: boolean;
        toolStepsUsed?: number;
        toolStepsBudget?: number;
        nextAction?: string;
        protectedRecoveryHandoff?: ProtectedRecoveryHandoffMetadata;
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

    const markerBase = options.markerOptions?.protectedRecoveryHandoff
      ? buildErrorOutcomeMarker(detail || "Automatic recovery paused", {
          draftRecovered: Boolean(draftText),
          attemptsUsed: streamState.lastRecoveryMeta?.attemptsUsed,
          classifier: streamState.lastRecoveryMeta?.lastClassifier ?? null,
          ...options.markerOptions,
        })
      : reason === "timeout"
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

    const visibleDetail = reason === "timeout" && !options.markerOptions?.protectedRecoveryHandoff
      ? detail
      : undefined;
    return persistVisibleFailureOutcome(markerBase, visibleDetail, options);
  };

  let completedReplyRowId: number | null = null;
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

  const output = startupFailure ? {status: "error" as const, result: null, error: startupFailure, failureCategory: classifyOpaqueAgentFailure(startupFailure)} : await withVerifiedAddonMessage(chatJid, currentMessage, () => channel.agentPool.runAgent(prompt, chatJid, {
    ...(identity ? {
      executionProvenance: identity.provenance,
      // Narrow initial family conversation tools; global mutators lack owner-scoped entry points.
      toolCeilingFilter: isFamilyWebToolAllowed,
    } : {}),
    timeoutMs,
    turnId,
    ...(browserObservability?.userId ? { userId: browserObservability.userId } : {}),
    ...(browserObservability?.sessionId ? { sessionId: browserObservability.sessionId } : {}),
    ...(browserObservability?.clientId ? { clientId: browserObservability.clientId } : {}),
    skipPrePromptCompaction: true,
    scheduleIdleAutoCompaction: !identity,
    deferToolEnabledContinuation: !identity,
    protectedRecoveryContinuation: Boolean(protectedRecoveryIntent),
    protectedRecoveryContinuationDepth: protectedRecoveryIntent?.handoff_depth,
    protectedRecoveryHandoffContext,
    recoverySourceId: protectedRecoveryHandoffContext?.recoverySourceId
      ?? protectedRecoveryIntent?.source_message_id
      ?? lastMessage.id
      ?? turnId,
    recoveryGeneration: protectedRecoveryHandoffContext?.recoveryGeneration ?? 0,
    onEvent: trackedStreamingHandler,
    onTurnComplete: (turn: TurnOutput) => {
      // Turn boundary: the first turn (index 0) is the original prompt's
      // response — skip placeholder consumption so it doesn't steal a
      // placeholder that belongs to a queued follow-up.
      // Subsequent turns (index 1+) are follow-up responses and should
      // consume their corresponding placeholder.
      const isFirstTurn = turnCount === 0;
      turnCount++;
      completedReplyRowId = null;
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
          turnKind: turn.turnKind,
          cause: turn.cause,
          followedByToolUse: turn.followedByToolUse,
          terminal: turn.terminal,
          textPhase: turn.textPhase,
          buildThinkingRefBlocks: streamRuntime.buildThinkingRefBlocks,
          consumePersistedPreviewsForRow: streamRuntime.consumePersistedPreviewsForRow,
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
          if (turn.terminal === true && turn.cause === "completed_boundary" && !turn.followedByToolUse) {
            completedReplyRowId = stored;
          }
        }
      }
    },
  }));

  streamState.lastRecoveryMeta = output.recovery || null;

  // A prior process may have persisted protected handoff intent before
  // crashing. Successful replay removes that source-tagged intent in the same
  // SQLite UPDATE that clears inflight state (see finalizeSuccessfulRun), so
  // neither delete-before-commit nor commit-before-delete can lose or duplicate
  // the continuation.
  const removeStaleProtectedContinuation = !output.requiresToolEnabledContinuation;
  shouldRemoveStaleProtectedContinuation = removeStaleProtectedContinuation;

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
    // Compatibility boundary for injected/legacy AgentPool implementations.
    // Normal runtime outputs already carry this enum from attempt finalization.
    output.failureCategory ??= classifyOpaqueAgentFailure(output.error);
    if (output.toolBudgetExceeded) output.failureCategory = "tool_budget";
    if (output.failureCategory === "already_processing") {
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
      throw new Error(output.error || "Agent run is already processing");
    }

    if (output.failureCategory === "provider_unavailable" && !output.protectedRecoveryHandoff) {
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
      throw new Error(output.error || "No API provider is registered");
    }

    const errorText = output.error || "Agent error";
    const displayErrorText = sanitizeProviderErrorDetail(errorText) || "Agent error";
    const providerError = formatProviderError(displayErrorText);
    const rateLimited = output.failureCategory === "rate_limit";
    const networkFailed = output.failureCategory === "network";
    const networkDetail = networkFailed ? describeNetworkError(displayErrorText) : null;
    const markerOptions = {
      failureCategory: output.failureCategory,
      toolBudgetExceeded: output.toolBudgetExceeded,
      toolStepsUsed: output.toolStepsUsed,
      toolStepsBudget: output.toolStepsBudget,
      nextAction: output.nextAction,
      protectedRecoveryHandoff: output.protectedRecoveryHandoff,
      abortCause: output.abortCause,
      abortOperation: output.abortOperation,
    };
    const resolveContinuationThreadId = (): number | null => resolvedThreadRootId
      ?? getMessageRowIdById(chatJid, lastMessage.id ?? "");
    const queueToolBudgetContinuation = (): void => {
      if (identity || !output.toolBudgetExceeded || output.recovery?.exhausted) return;
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
    const queueProtectedRecoveryContinuation = (): {
      required: boolean;
      rowId: number | null;
      failed: boolean;
      created: boolean;
      terminalReason?: "limit" | "unprepared";
    } => {
      if (identity || !output.requiresToolEnabledContinuation) return { required: false, rowId: null, failed: false, created: false };
      if (output.protectedRecoveryHandoff?.reason === "unresolved_tool_execution") {
        return { required: false, rowId: null, failed: false, created: false, terminalReason: "unprepared" };
      }
      const currentHandoffDepth = protectedRecoveryIntent?.handoff_depth ?? 0;
      if (protectedRecoveryIntent) {
        if (currentHandoffDepth >= MAX_PROTECTED_RECOVERY_HANDOFF_DEPTH) {
          return { required: false, rowId: null, failed: false, created: false, terminalReason: "limit" };
        }
        // Repeated generic protected retries remain unsafe to chain. Only a
        // completed compact_then_retry phase establishes useful new state for
        // one final ordinary tool-enabled continuation.
        if (!isPostCompactionProtectedRecoveryHandoff(output)) {
          return { required: false, rowId: null, failed: false, created: false, terminalReason: "unprepared" };
        }
      }
      const continuationThreadId = resolveContinuationThreadId();
      if (!continuationThreadId) {
        log.warn("Could not resolve thread lineage for protected-recovery continuation", {
          operation: "process_chat.protected_recovery_auto_continue_missing_lineage",
          chatJid,
          messageId: lastMessage.id ?? null,
        });
        return { required: true, rowId: null, failed: true, created: false };
      }
      const sourceMessageId = String(lastMessage.id || "").trim();
      const sourceRowId = getMessageRowIdById(chatJid, sourceMessageId) ?? continuationThreadId;
      const existing = channel.getQueuedFollowupItems(chatJid).find((item) => (
        item.source === "auto-protected-recovery-continuation"
        && item.queuedBy?.sourceMessageId === sourceMessageId
      ));
      if (existing) return { required: true, rowId: existing.rowId, failed: false, created: false };
      try {
        const queuedAt = new Date().toISOString();
        const controlIntent = buildProtectedRecoveryControlIntentBlock({
          sourceMessageId,
          sourceRowId,
          threadId: continuationThreadId,
          handoffDepth: currentHandoffDepth + 1,
          handoff: output.protectedRecoveryHandoff,
        });
        const queuedRowId = channel.enqueueQueuedFollowupItem(
          chatJid,
          0,
          PROTECTED_RECOVERY_CONTROL_LABEL,
          continuationThreadId,
          queuedAt,
          {
            contentBlocks: [controlIntent],
            source: "auto-protected-recovery-continuation",
            queuedBy: { source: "runtime", sourceMessageId },
          },
        );
        channel.broadcastEvent("agent_followup_queued", {
          chat_jid: chatJid,
          thread_id: continuationThreadId,
          row_id: queuedRowId,
          content: PROTECTED_RECOVERY_CONTROL_LABEL,
          content_blocks: [controlIntent],
          timestamp: queuedAt,
          source: "auto-protected-recovery-continuation",
        });
        log.info("Queued one ordinary continuation after protected recovery", {
          operation: "process_chat.protected_recovery_auto_continue",
          chatJid,
          sourceMessageId,
          sourceRowId,
          threadId: continuationThreadId,
          handoffDepth: controlIntent.handoff_depth,
          queuedRowId,
        });
        return { required: true, rowId: queuedRowId, failed: false, created: true };
      } catch (error) {
        log.warn("Failed to queue ordinary continuation after protected recovery", {
          operation: "process_chat.protected_recovery_auto_continue_failed",
          chatJid,
          sourceMessageId,
          sourceRowId,
          threadId: continuationThreadId,
          err: error,
        });
        return { required: true, rowId: null, failed: true, created: false };
      }
    };
    // Persist the handoff intent before terminal/cursor finalization. A crash
    // after this point leaves a durable, source-tagged item that replay detects
    // instead of losing or duplicating the ordinary continuation.
    const protectedContinuation = queueProtectedRecoveryContinuation();
    if (protectedContinuation.failed) {
      rollbackInflightRun(chatJid, prevCursor);
      trackedEmitter.status(buildRetryStatusPayload({
        threadId,
        agentId,
        turnId,
        title: "Could not persist tool-enabled continuation — retrying",
        detail: "The protected recovery handoff was not committed; the source turn remains pending.",
      }));
      throw new Error("Protected recovery handoff persistence failed; retry the source turn.");
    }
    if (protectedContinuation.terminalReason) {
      // The runtime deliberately refuses an unbounded recovery chain. Unlike a
      // normal marker-only blank final, this terminal state must remain readable
      // even when the client cannot render structured outcome blocks.
      shouldRemoveStaleProtectedContinuation = true;
      const terminalReason = output.protectedRecoveryHandoff?.reason
        ?? (isPostCompactionProtectedRecoveryHandoff(output)
          ? "post_compaction_tools_required"
          : "continuation_generation_exhausted");
      const terminalHandoff = buildProtectedRecoveryHandoffMetadata(terminalReason, {
        recoveryAttempts: output.protectedRecoveryHandoff?.recoveryAttempts
          ?? output.recovery?.attemptsUsed
          ?? 0,
        compaction: output.protectedRecoveryHandoff?.compaction,
        toolsRequired: output.protectedRecoveryHandoff?.toolsRequired ?? true,
        retryable: output.protectedRecoveryHandoff?.retryable ?? true,
        primaryFailure: output.protectedRecoveryHandoff?.primaryFailure,
        recoverySourceId: output.protectedRecoveryHandoff?.recoverySourceId,
        recoveryGeneration: output.protectedRecoveryHandoff?.recoveryGeneration,
      });
      const presentation = terminalHandoff ? formatProtectedRecoveryHandoff(terminalHandoff) : null;
      const detail = presentation?.detail ?? (protectedContinuation.terminalReason === "limit"
        ? PROTECTED_RECOVERY_HANDOFF_LIMIT_MESSAGE
        : "Automatic recovery could not safely start another tool-enabled continuation. The session is preserved; send “continue” to resume the unfinished work.");
      const marker = buildTurnOutcomeMarker({
        kind: "recovery",
        label: presentation?.label ?? "recovery paused",
        title: presentation?.title ?? "Automatic recovery paused",
        detail,
        severity: "warning",
        attemptsUsed: output.recovery?.attemptsUsed,
        classifier: output.recovery?.lastClassifier ?? null,
        failureCategory: output.failureCategory,
        nextAction: presentation?.nextAction ?? "Send “continue” to resume from the preserved session state.",
        protectedRecoveryHandoff: terminalHandoff,
      });
      const terminalText = presentation
        ? `⚠️ ${presentation.title}\n${presentation.detail} ${presentation.nextAction}`
        : `⚠️ Automatic recovery paused\n${detail}`;
      const persisted = persistTerminalOutcome(terminalText, marker);
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
    if (protectedContinuation.required) {
      // A protected attempt intentionally has no execution tools. Its streamed
      // draft is not a terminal answer and may falsely claim tools are missing.
      // Replace that transient prose with a deterministic recovery marker while
      // the durable typed continuation resumes the work with tools restored.
      const handoffPresentation = output.protectedRecoveryHandoff
        ? formatProtectedRecoveryHandoff(output.protectedRecoveryHandoff)
        : null;
      const marker = buildTurnOutcomeMarker({
        kind: "recovery",
        label: handoffPresentation?.label ?? "recovery",
        title: output.protectedRecoveryHandoff?.primaryFailure
          ? handoffPresentation?.title ?? PROTECTED_RECOVERY_CONTROL_LABEL
          : PROTECTED_RECOVERY_CONTROL_LABEL,
        detail: handoffPresentation?.detail ?? (protectedRecoveryIntent
          ? "Compaction completed; continuing once more with execution tools restored."
          : "Continuing in an ordinary turn with execution tools restored."),
        severity: "info",
        attemptsUsed: output.recovery?.attemptsUsed,
        classifier: output.recovery?.lastClassifier ?? null,
        failureCategory: output.failureCategory,
        protectedRecoveryHandoff: output.protectedRecoveryHandoff,
      });
      const persisted = persistVisibleFailureOutcome(marker, undefined, { suppressDraft: true });
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
    const fallbackPublished = output.failureCategory === "timeout" || output.failureCategory === "stalled_work"
      ? publishDraftFallback("timeout", errorText, { markerOptions })
      : rateLimited
        ? publishDraftFallback("rate-limit", errorText, { markerOptions })
        : publishDraftFallback("error", errorText, { markerOptions });

    if (fallbackPublished) {
      // Tool-budget reservations remain after terminal persistence. Protected
      // handoff intent was already persisted above for crash safety.
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
      // Retain the durable handoff intent on terminal persistence failure.
      // rollbackChatRunWithError makes the source retryable; replay dedupes by
      // sourceMessageId and normal successful terminal persistence removes the
      // stale intent atomically with the terminal row insert.
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
      state: output.failureCategory === "auth_config" ? "blocked_auth" : "failed",
      classifier: output.recovery?.lastClassifier ?? output.failureCategory ?? "unknown",
      failure_category: output.failureCategory ?? "unknown",
      title: providerError?.title || (rateLimited ? "AI provider rate limit" : networkFailed ? networkDetail! : displayErrorText),
      detail: providerError?.detail || (rateLimited || networkFailed ? displayErrorText : undefined),
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
  const promotedCompletedReply = !hasOutput && completedReplyRowId !== null
    && promoteCompletedAgentReply(chatJid, completedReplyRowId);
  if (promotedCompletedReply && completedReplyRowId !== null) {
    const updated = getMessageByRowId(chatJid, completedReplyRowId);
    if (updated) channel.interactionBroadcaster.broadcastInteractionUpdated(updated);
  }
  const finalized = hasOutput
    ? storeAgentTurn(channel, emitter, {
        chatJid,
        text: output.result || "",
        attachments: finalAttachments as AttachmentInfo[],
        channelName,
        threadId: resolvedThreadRootId,
        skipPlaceholder: shouldRemoveStaleProtectedContinuation || turnCount === 0,
        isTerminalAgentReply: true,
        removeProtectedContinuationForSourceMessageId: shouldRemoveStaleProtectedContinuation
          ? String(lastMessage.id || "").trim() || null
          : null,
        extraContentBlocks: [
          streamRuntime.buildAgentTimingBlock(output.usage),
          ...(buildRecoveryMarkerBlocks(output.recovery) ?? []),
          ...streamRuntime.buildThinkingRefBlocks(),
        ],
        onMessageStored: (rowId, interaction) => streamRuntime.consumePersistedPreviewsForRow(
          rowId,
          interaction.data?.thread_id ?? resolvedThreadRootId,
        ),
      })
    : promotedCompletedReply
      ? true
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
