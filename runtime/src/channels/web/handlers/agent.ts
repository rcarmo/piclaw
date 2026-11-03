import { captureHostDatabaseBinding } from "../../../db/connection.js";
import { admitSqliteWrite } from "../../../db/sqlite-async-admission.js";
import { captureWebRequestAuthority } from "../auth/auth-gateway.js";
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
import { settledAbortStatus } from "../agent/agent-abort-status.js";
import { getAddonLocalDispatchBlock } from "../../../addons/local-dispatch.js";

import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { isSingleUserAccess } from "../../../core/config-access.js";

import {
  getIdentityConfig,
  getRoutingConfig,
} from "../../../core/config.js";
import { parseControlCommand, isSlashCommandInvocation } from "../../../agent-control/agent-control-parser.js";
import type { AgentControlResult } from "../../../agent-control/agent-control-types.js";
import { publicContextUsage } from "../context-usage.js";

import {
  normalizeAgentMessagePayload,
  parseAgentMessageRequest,
} from "../messaging/agent-message-service.js";
import { handleUiThemeCommand } from "../theming/ui-theme-commands.js";
import { handleUiMetersCommand } from "../ui-meters-commands.js";
import { getServerUiMetersConfig, admitServerUiState } from "../ui-state.js";
import { getChatCursor, getMessageRowIdById, getDb, setChatCursor, type InteractionRow } from "../../../db.js";
import { formatOutbound } from "../../../router.js";
import { isSqliteContention } from '../../../db/sqlite-async-admission.js';
import { bindInputRequestAuthority, readInputRequestAuthority, releaseInputRequestAuthority, captureInputTarget, type ValidateInputAuthority } from '../messaging/input-request-authority.js';
import { createAgentProfileBuilder } from "../agent/agent-utils.js";
import { buildGeneralSettingsProfileUpdate, getGeneralSettingsData } from "./general-settings.js";
import { resolveAvatarUrl } from "../media/avatar-service.js";

import { MODEL_COMMAND_TYPES, executeDeferredControlCommand, isDeferredControlCommand, materializeDeferredFollowups, resolveAndBroadcastModelStateForCommand, selectProcessChatMessage } from "../runtime/process-chat-control-runtime.js";
import { resolveThreadId } from "../runtime/threading.js";

import { createUuid } from "../../../utils/ids.js";
import { createLogger, debugSuppressedError } from "../../../utils/logger.js";

const log = createLogger("web.handlers.agent");
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
  steering?: boolean;
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

export function stripMarkdownCodeFenceMarkers(value: string): string {
  return value
    .replace(/^```[a-zA-Z0-9_-]*\s*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .trim();
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

// Only in-process forwarding can share the original guarded request authority.
// No request body/header can supply or replace this capability.
function captureInputAuthority(channel: WebChannelLike, req: Request): () => void {
  const gateway = channel.authGateway, check = captureWebRequestAuthority(gateway, req);
  return () => { if (!isSingleUserAccess() || channel.authGateway !== gateway) throw Error("Incoming request authority changed."); check(); };
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
  if (!isSingleUserAccess()) return channel.json({ error: "Single-user message admission is required." }, 403);
  let internalAuthority: ReturnType<typeof readInputRequestAuthority>;
  let revalidateInputAuthority: ValidateInputAuthority;
  try {
    const binding = captureHostDatabaseBinding();
    internalAuthority = readInputRequestAuthority(req, chatJid, pathname);
    const request = internalAuthority?.validate ?? captureInputAuthority(channel, req);
    revalidateInputAuthority = phase => { if (phase === 'before' || phase === 'after') binding(); request(phase); };
    revalidateInputAuthority();
  }
  catch { return channel.json({ error: 'Input authority is unavailable.' }, 403); }
  // Pin the trusted host selection to this route before any body read/await.
  // Request contents cannot select an engine or replace this SQL-only callback.
  const nativeRuntime = channel.agentPool?.isDurableRuntime?.() === true;
  const selectSteering = channel.getAcceptedQueuedSteering?.bind(channel);
  const admitQueuedInput = channel.admitQueuedFollowupItem?.bind(channel);
  const admitUserInput = channel.admitMessage?.bind(channel);
  const prepareAdmission = channel.prepareInputSourceAdmission?.bind(channel);
  const prepareInputText = channel.prepareInputText?.bind(channel);
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

  let requestMode = normalized.mode ?? "auto";
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

  let command = parseControlCommand(content, getRoutingConfig().triggerPattern);
  // Operator process controls precede session/queue/Goal inspection. A wedged
  // harness or missing conversation must not prevent the host from stopping.
  if ((command?.type === "exit" || command?.type === "restart") && !hasAttachments) {
    revalidateInputAuthority();
    const result = await channel.agentPool.applyControlCommand(chatJid, command);
    return channel.json({ thread_id: null, command: result, ui_only: true, immediate: true }, 200);
  }
  const manualQueue = command?.type === "queue";
  if (command?.type === "queue_all") return channel.json({ error: "Native inputs use FIFO operation settlement. Batch /queue-all is unavailable; use /queue." }, 400);
  // Native queued commands are accepted input, not display-only controls or
  // legacy session.prompt calls. Use the same preparation/admission as modes.
  if (command?.type === "queue" || command?.type === "steer") {
    const message = command.message?.trim();
    if (!message || isSlashCommandInvocation(message)) {
      return channel.json({ error: "Native /queue and /steer require message text, not another slash command." }, 400);
    }
    requestMode = command.type === "queue" ? "queue" : "steer";
    content = message;
    command = null;
  }
  const trimmed = content.trim();
  const themeCommand = handleUiThemeCommand(trimmed);
  const metersCommand = handleUiMetersCommand(trimmed);
  const isSettingsCommand = /^\/settings\s*$/i.test(trimmed);
  const ordinaryInput = !command && !themeCommand && !metersCommand && !isSettingsCommand && !isSlashCommandInvocation(content);
  if (nativeRuntime && ordinaryInput && (!lookupAdmission || !lookupQueuedAdmission
    || !admitUserInput || !admitQueuedInput || !selectSteering)) {
    return channel.json({ error: "Native input admission is unavailable." }, 503);
  }
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
  if (prepareInputText && !command && !themeCommand && !metersCommand && !isSettingsCommand && !isSlashCommandInvocation(content)) {
    try {
      const prepared = prepareInputText(chatJid, content);
      if (prepared && typeof (prepared as unknown as { then?: unknown }).then === "function") {
        void Promise.resolve(prepared).catch(error => debugSuppressedError(log, 'Rejected asynchronous input preparation.', error, { operation: 'handle_agent_message.async_preparation_rejected', chatJid }));
        throw Error("Input preparation must be synchronous");
      }
      if (!prepared || typeof prepared.text !== "string" || !prepared.text.trim() || isSlashCommandInvocation(prepared.text) ||
        typeof prepared.assertCurrent !== "function") throw Error("Invalid prepared input");
      const requestAuthority = revalidateInputAuthority;
      const assertCurrent = prepared.assertCurrent.bind(prepared);
      revalidateInputAuthority = () => {
        requestAuthority();
        const result = assertCurrent();
        if (result !== undefined) {
          void Promise.resolve(result).catch(error => debugSuppressedError(log, 'Rejected asynchronous input authority.', error, { operation: 'handle_agent_message.async_authority_rejected', chatJid }));
          throw Error("Prepared input authority must be synchronous");
        }
      };
      content = prepared.text;
      revalidateInputAuthority();
    } catch (error) {
      log.warn("Native input preparation rejected", { operation: "handle_agent_message.preparation_rejected", chatJid, err: error });
      return channel.json({ error: "Input preparation could not be confirmed." }, 503);
    }
  }
  if (nativeRuntime && ordinaryInput && (typeof acceptSource !== "function" || typeof acceptQueuedSource !== "function"))
    return channel.json({ error: "Native input admission is unavailable." }, 503);
  let nativeSteering: ReturnType<NonNullable<WebChannelLike["getAcceptedQueuedSteering"]>>;
  try { nativeSteering = selectSteering?.(chatJid, revalidateInputAuthority); }
  catch { return channel.json({ error: "Native steering authority is unavailable." }, 503); }
  const isStreaming = Boolean(nativeSteering) || (typeof channel.agentPool.isStreaming === "function"
    ? channel.agentPool.isStreaming(chatJid)
    : false);
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
    const sourceOptions = { contentBlocks: normalized.contentBlocks, linkPreviews: normalized.linkPreviews, screenHint: normalized.screenHint,
      // The source is consumed by this forwarding handoff. Its cursor belongs
      // to the same commit, before publication can cancel/revoke the request.
      acceptSource: ({ message }: { message: { timestamp: string } }) => setChatCursor(chatJid, message.timestamp),
    };
    let sourceInteraction: InteractionRow | null;
    try {
      // Mentions commit the source before forwarding, but creation and its
      // authority proof still belong to that source's own admission TX.
      sourceInteraction = await admitUserInput(chatJid, sourceContent, false, normalized.mediaIds, sourceOptions, revalidateInputAuthority, req.signal);
    } catch (error) {
      if (req.signal.aborted) return channel.json({ error: 'Input submission was cancelled before acceptance.' }, 400);
      if (isSqliteContention(error)) return channel.json({ error: 'Message storage is busy; this input was not accepted.' }, 503);
      return channel.json({ error: 'Source input admission could not be confirmed.' }, 503);
    }
    if (!sourceInteraction) return channel.json({ error: "Failed to store message" }, 500);

    channel.broadcastEvent("new_post", sourceInteraction);

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
      screen_hint: normalized.screenHint,
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
    if (!admitQueuedInput) return channel.json({ error: "Queued input admission is unavailable." }, 503);
    const queuedAt = new Date().toISOString();
    // Never inherit the active turn's root. Preserve an explicitly selected
    // thread; ordinary compose input remains self-rooted when materialized.
    const queuedThreadId: number | null = normalized.threadId ?? null;
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
      const acceptedInput = (extras.steering || ordinaryInput)
        && (extras.source === "web.compose" || extras.source === "web.steer_startup_fallback");
      const accept = acceptedInput ? acceptQueuedSource : undefined;
      if ((nativeRuntime && acceptedInput) || extras.steering) {
        if (!accept || (extras.steering && !selectSteering))
          throw Error("Atomic native queue admission is unavailable.");
      }
      queuedRowId = await admitQueuedInput(args, revalidateQueuedAdmission, req.signal, accept);
    } catch (error) {
      if (isSqliteContention(error)) return channel.json({ error: 'Queue storage is busy; this input was not accepted.' }, 503);
      if (req.signal.aborted) return channel.json({ error: 'Input submission was cancelled before acceptance.' }, 400);
      return channel.json({ error: 'Queued input could not be accepted.' }, 403);
    }
    if (extras.steering) {
      const host = nativeSteering;
      if (host) {
        try {
          const accepted = await host.accept(queuedRowId);
          void accepted.dispatch().catch(error => log.warn("Native steering remains pending", { operation: "native_steer.pending", err: error }));
          try {
            channel.broadcastEvent("agent_followup_removed", { chat_jid: chatJid, row_id: queuedRowId, thread_id: null });
            channel.broadcastEvent("new_post", accepted.interaction);
            channel.broadcastEvent("agent_steer_queued", { chat_jid: chatJid, thread_id: null, source: "compose", timestamp: queuedAt });
          } catch (error) {
        // Publication cannot revoke committed native input.
        log.warn("Native steering publication deferred", { operation: "handle_agent_message.native_steer_publication", chatJid, err: error });
      }
          return channel.json({ queued: "steer", user_message: accepted.interaction,
            thread_id: accepted.interaction.data?.thread_id ?? null, steering_delivery: "pending" }, 201);
        } catch (error) {
          // Admission already committed. Preserve the accepted follow-up if the
          // selected operation ended; never reject it or send it through legacy.
          log.warn("Native steering deferred after admission", { operation: "native_steer.deferred", err: error });
        }
      }
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
    if (extras.wakeIfIdle && !manualQueue && !stillActive) {
      channel.resumeChat(chatJid);
    }
    return channel.json({ queued: "followup", thread_id: queuedThreadId }, 201);
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

  if (ordinaryInput && isStreaming && requestMode === "steer") {
    return queueDeferredFollowup(content, { source: "web.compose", steering: true,
      browserContext: browserObservability, wakeIfIdle: true, mediaIds: normalized.mediaIds,
      contentBlocks: normalized.contentBlocks, linkPreviews: normalized.linkPreviews, screenHint: normalized.screenHint });
  }

  if (themeCommand) {
    if (themeCommand.payload) {
      const uiTheme = (await admitServerUiState({ ui_theme: { theme: themeCommand.payload.theme, tint: themeCommand.payload.tint ?? null } }, revalidateInputAuthority, req.signal)).ui_theme;
      try { channel.broadcastEvent("ui_theme", { ...uiTheme }); }
      catch (error) { try { log.warn('Committed theme awaiting publication', { error }); } catch { return channel.json({ thread_id: null, command: themeCommand, ui_only: true, response_delivery: 'failed' }, 200); } }
    }

    let themeResponseDelivered = true;
    const formattedThemeMessage = formatOutbound(themeCommand.message, "web");
    if (formattedThemeMessage) {
      try {
        // Keep /theme purely UI-scope but still surface the command output to the
        // timeline so users can see the theme list/output immediately.
        await channel.sendMessage(chatJid, formattedThemeMessage, { forceRoot: true, requirePersistence: true, authorise: revalidateInputAuthority, signal: req.signal });
      } catch (error) {
        themeResponseDelivered = false;
        try { log.error("Failed to send /theme response", { operation: "handle_agent_message.theme_response", chatJid, err: error }); }
        catch { return channel.json({ thread_id: null, command: themeCommand, ui_only: true, response_delivery: 'failed' }, 200); }
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
      const patch = metersCommand.payload.mode === "toggle" ? { enabled: !currentMeters.enabled }
        : metersCommand.payload.mode === "set" ? { enabled: metersCommand.payload.enabled } : { collapsed: metersCommand.payload.collapsed };
      const nextMeters = (await admitServerUiState({ ui_meters: patch }, revalidateInputAuthority, req.signal)).ui_meters;
      try { channel.broadcastEvent("ui_meters", { chat_jid: chatJid, mode: "set", ...nextMeters }); }
      catch (error) { try { log.warn('Committed meters awaiting publication', { error }); } catch { return channel.json({ thread_id: null, command: metersCommand, ui_only: true }, 200); } }
    }

    const formattedMetersMessage = formatOutbound(metersCommand.message, "web");
    if (formattedMetersMessage) {
      try {
        await channel.sendMessage(chatJid, formattedMetersMessage, { forceRoot: true, authorise: revalidateInputAuthority, signal: req.signal });
      } catch (error) {
        try { log.error("Failed to send /meters response", { operation: "handle_agent_message.meters_response", chatJid, err: error }); }
        catch { return channel.json({ thread_id: null, command: metersCommand, ui_only: true }, 200); }
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
    const captured = JSON.stringify(channel.getAgentStatus?.(chatJid) ?? null);
    const result = await channel.agentPool.applyControlCommand(chatJid, command);
    if (result.status !== "success") {
      return channel.json({ error: result.message, command: result, thread_id: null, ui_only: true }, 500);
    }
    const terminal = settledAbortStatus(captured, channel.getAgentStatus?.(chatJid) ?? null, result.message);
    if (terminal) {
      channel.updateAgentStatus?.(chatJid, terminal);
      channel.broadcastEvent("agent_status", { ...terminal, chat_jid: chatJid });
    }
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

  // Native compaction uses SDK conversation ordering, even during an active turn.
  // Keep legacy deferral separate; a native slash command is never model input.
  if (command?.type === "compact" && isActive && !prepareInputText) {
    if (acceptSource !== undefined) return queueDeferredFollowup(content, { source: "web.compose", browserContext: browserObservability, wakeIfIdle: true });
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
    }

    // Bare /model (list) or bare /thinking (query) — write output to the timeline
    const isBareModelList = command.type === "model" && !(command as any).modelId && !(command as any).provider;
    const isBareThinkingQuery = command.type === "thinking" && !(command as any).level;
    if ((isBareModelList || isBareThinkingQuery) && result.message) {
      const formattedMessage = formatOutbound(result.message, "web");
      if (formattedMessage) {
        try {
          await channel.sendMessage(chatJid, formattedMessage, { forceRoot: true, authorise: revalidateInputAuthority, signal: req.signal });
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

  // Defer before publishing a timeline row. Queue acceptance is persisted here;
  // materialisation admits the timeline row and source in their shared transaction.
  const shouldDeferQueuedFollowup =
    !command &&
    !themeCommand &&
    !metersCommand &&
    !isSlashCommandInvocation(trimmed) &&
    (manualQueue || isActive || hasQueuedBacklog) &&
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
  let interaction: InteractionRow | null;
  // Only ordinary input creates SDK sources or defers into the input queue.
  // Control rows share SQL admission without becoming model input.
  try {
    interaction = await admitUserInput(chatJid, content, false, normalized.mediaIds, {
      contentBlocks: normalized.contentBlocks, linkPreviews: normalized.linkPreviews,
      threadId: normalized.threadId ?? undefined, screenHint: normalized.screenHint,
      acceptSource: ordinaryInput ? acceptSource : undefined,
    }, revalidateQueuedAdmission, req.signal, ordinaryInput ? () => {
      const busy = isChatActive();
      queuedDuringAdmission = busy || channel.getQueuedFollowupCount(chatJid) > 0;
      if (!queuedDuringAdmission) return false;
      deferredAt = new Date().toISOString();
      deferredRowId = channel.enqueueQueuedFollowupItem(chatJid, 0, content,
        normalized.threadId ?? null, deferredAt, {
          source: deferredSource, mediaIds: normalized.mediaIds, contentBlocks: normalized.contentBlocks,
          linkPreviews: normalized.linkPreviews, screenHint: normalized.screenHint,
          queuedBy: { ...(browserObservability.userId ? { userId: browserObservability.userId } : {}),
            ...(browserObservability.sessionId ? { sessionId: browserObservability.sessionId } : {}),
            ...(browserObservability.clientId ? { clientId: browserObservability.clientId } : {}) },
        });
      if (acceptQueuedSource)
        acceptQueuedInputSource(chatJid, deferredRowId, getDb(), acceptQueuedSource);
      return true;
    } : undefined);
  } catch (error) {
    if (isSqliteContention(error)) return channel.json({ error: 'Message storage is busy; this input was not accepted.' }, 503);
    if (req.signal.aborted) return channel.json({ error: 'Input submission was cancelled before acceptance.' }, 400);
    return channel.json({ error: 'Input admission could not be confirmed.' }, 503);
  }

  if (queuedDuringAdmission) {
    channel.broadcastEvent('agent_followup_queued', { chat_jid: chatJid, row_id: deferredRowId, content,
      thread_id: normalized.threadId ?? null, timestamp: deferredAt, source: deferredSource });
    if (!manualQueue && !isChatActive()) channel.resumeChat(chatJid);
    return channel.json({ thread_id: normalized.threadId ?? null, queued: 'followup' }, 201);
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
    // Concurrent native compaction must not claim or clear the running turn's
    // lifecycle surface. Its context update remains a side-channel event.
    if (prepareInputText && command?.type === "compact" && isActive && payload.type !== "context_usage") return;
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
    result: Pick<AgentControlResult, "contextUsage">,
    payload: { threadId: string | number | null; turnId: string },
  ): Promise<void> => {
    let contextUsage = result.contextUsage;
    if (!contextUsage?.tokensAreAuthoritative && (contextUsage?.tokens === null || contextUsage?.tokens === undefined)) {
      const current = typeof channel.agentPool.getContextUsageForChat === "function"
        ? await channel.agentPool.getContextUsageForChat(chatJid).catch(() => null)
        : null;
      if (current?.tokens !== null && current?.tokens !== undefined) {
        contextUsage = {
          tokens: current.tokens,
          contextWindow: current.contextWindow,
          percent: current.percent,
          ...(typeof current.sessionGeneration === "string" ? { sessionGeneration: current.sessionGeneration } : {}),
          source: "agent_pool",
          phase: "after_command",
        };
      }
    }
    if (!contextUsage || contextUsage.tokens === null && !contextUsage.tokensAreAuthoritative) return;
    const contextUsageRecord = contextUsage as unknown as { sessionGeneration?: unknown };
    const usageGeneration = typeof contextUsageRecord.sessionGeneration === "string"
      ? contextUsageRecord.sessionGeneration
      : null;
    const activeGeneration = typeof channel.agentPool.getSessionGenerationForChat === "function"
      ? channel.agentPool.getSessionGenerationForChat(chatJid)
      : null;
    if (usageGeneration && activeGeneration && usageGeneration !== activeGeneration) return;
    const sessionGeneration = usageGeneration ?? activeGeneration;
    const contextSnapshot = {
      tokens: contextUsage.tokens,
      contextWindow: contextUsage.contextWindow,
      percent: contextUsage.percent,
      ...(sessionGeneration ? { sessionGeneration } : {}),
      contextUpdate: "replace",
    };
    const statusUsage = {
      ...contextSnapshot,
      estimated: contextUsage.estimated === true,
      source: contextUsage.source ?? null,
      phase: contextUsage.phase ?? null,
    };
    emitCommandStatus({
      thread_id: payload.threadId,
      agent_id: agentId,
      turn_id: payload.turnId,
      type: "context_usage",
      context_usage: statusUsage,
    });
  };

  if (command) {
    broadcastNewPost();
    const commandTurnId = createUuid("turn");
    const commandTitle = content.trim().split(/\s+/, 1)[0] || "command";
    const isCompactCommand = command.type === "compact";
    const isSessionRotateCommand = command.type === "session_rotate" || command.type === "new_session";
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
        contextUpdate: "replace",
      };
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

    const rollupTargetChatJid = command.type === "rollup" && result.status === "success" && typeof (result as { rolled_up_to?: unknown }).rolled_up_to === "string"
      ? String((result as { rolled_up_to?: string }).rolled_up_to || "").trim()
      : "";
    const responseChatJid = rollupTargetChatJid || chatJid;
    let responseDelivery: "not_needed" | "persisted" | "failed" = "not_needed";

    if (formatted || result.contentBlocks?.length) {
      const sendOptions: Record<string, unknown> = { threadId: interaction.id, authorise: revalidateInputAuthority, signal: req.signal };
      if (result.mediaIds?.length) {
        sendOptions.mediaIds = result.mediaIds;
      }
      if (result.contentBlocks?.length) {
        sendOptions.contentBlocks = result.contentBlocks;
      }
      if (prepareInputText) sendOptions.requirePersistence = true;
      try {
        await channel.sendMessage(responseChatJid, formatted || "", sendOptions);
        responseDelivery = "persisted";
      } catch (error) {
        if (!prepareInputText) throw error;
        // Execution already completed. Do not turn publication failure into
        // permission to repeat a non-idempotent command or open a legacy session.
        responseDelivery = "failed";
        log.error("Native command reply could not be persisted", { operation: "native_command.reply_delivery", chatJid, command: command.type, err: error });
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

    emitCommandStatus({
      thread_id: interaction.timestamp,
      agent_id: agentId,
      turn_id: commandTurnId,
      type: result.status === "success" ? "done" : "error",
      title: result.status === "success"
        ? "Completed " + commandTitle
        : summarizeCommandStatusTitle(result.message, "Command failed"),
    });

    const commandResult = result.contextUsage ? { ...result, contextUsage: {
      ...publicContextUsage(result.contextUsage),
      estimated: result.contextUsage.estimated,
      source: result.contextUsage.source,
      phase: result.contextUsage.phase,
    } } : result;
    return channel.json(
      { user_message: interaction, thread_id: threadId, command: commandResult, ...(prepareInputText ? { response_delivery: responseDelivery } : {}) },
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
      if (formatted) await channel.sendMessage(chatJid, formatted, { threadId: interaction.id, authorise: revalidateInputAuthority, signal: req.signal });
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
  if (coordinator !== undefined && typeof coordinator !== "function") {
    throw new Error("Accepted dispatch coordinator must be callable");
  }
  const pendingIdentity = Object.freeze({ chatJid, messageId: currentMessage.id,
    rowId: getMessageRowIdById(chatJid, currentMessage.id) ?? 0 });
  const waitForPendingRaw = coordinator?.waitForPending;
  if (waitForPendingRaw !== undefined && typeof waitForPendingRaw !== "function") {
    throw new Error("Accepted pending observer must be callable");
  }
  const waitForPending = typeof waitForPendingRaw === "function"
    ? waitForPendingRaw.bind(coordinator)
    : undefined;
  let acceptedDispatchRaw: unknown;
  try {
    acceptedDispatchRaw = coordinator?.(chatJid, currentMessage.id, pendingIdentity.rowId);
  } catch {
    // A fenced or unreadable persisted selection is not evidence of legacy ownership.
    acceptedDispatchRaw = async () => "pending";
  }
  if (acceptedDispatchRaw !== undefined && typeof acceptedDispatchRaw !== "function") {
    throw new Error("Accepted dispatch must be callable");
  }
  const acceptedDispatch = acceptedDispatchRaw as (() => Promise<"settled" | "pending">) | undefined;
  if (acceptedDispatch) {
    const { setChatCursor } = await import("../../../db/chat-cursors.js");
    if (channel.updateAgentStatus !== undefined && typeof channel.updateAgentStatus !== "function") {
      throw new Error("Native status updater must be callable");
    }
    if (typeof channel.broadcastEvent !== "function") {
      throw new Error("Native status broadcaster must be callable");
    }
    if (typeof channel.resumeChat !== "function") {
      throw new Error("Native resume hook must be callable");
    }
    const startedAt = new Date().toISOString();
    const nativeStatus = (type: "intent" | "done") => {
      const payload = { chat_jid: chatJid, turn_id: `durable:${pendingIdentity.rowId}`, thread_id: effectiveThreadRootId,
        type: type === "intent" ? "thinking" : type, kind: "info", source: "durable_runtime", intent_key: "native_task", blocking: false,
        title: type === "done" ? "Idle" : "Thinking...", started_at: startedAt };
      try {
        channel.updateAgentStatus?.(chatJid, payload);
      } catch (error) {
        debugSuppressedError(log, "Native status updater failed after accepted dispatch admission.", error, {
          operation: "process_chat.native_status_updater_failed",
          chatJid,
          type,
        });
      }
      try {
        channel.broadcastEvent("agent_status", payload);
      } catch (error) {
        debugSuppressedError(log, "Native status broadcaster failed after accepted dispatch admission.", error, {
          operation: "process_chat.native_status_broadcast_failed",
          chatJid,
          type,
        });
      }
    };
    // Native operations/submissions own recovery. A legacy inflight marker
    // would falsely advertise every live SDK turn as interrupted after reload.
    nativeStatus("intent");
    let result = await Promise.resolve()
      .then(() => acceptedDispatch())
      .catch(() => "pending" as const);
    if (result !== "settled" && result !== "pending") {
      throw new Error("Accepted dispatch returned invalid status");
    }
    if (result === "pending") {
      // The captured host port owns observation only. Shutdown must retain the recovery marker.
      if (!waitForPending) throw new Error("Accepted dispatch requires host pending observation");
      result = await Promise.resolve()
        .then(() => waitForPending(pendingIdentity))
        .catch(() => "pending" as const);
      if (result !== "settled" && result !== "pending") {
        throw new Error("Accepted pending observer returned invalid status");
      }
      if (result === "pending") return;
    }
    await admitSqliteWrite(getDb(), () => setChatCursor(chatJid, currentMessage.timestamp));
    nativeStatus("done");
    try {
      channel.resumeChat(chatJid);
    } catch (error) {
      debugSuppressedError(log, "Native resume hook failed after accepted dispatch settlement.", error, {
        operation: "process_chat.native_resume_failed",
        chatJid,
      });
    }
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

  if (coordinator) throw new Error("Native input has no admitted source");
  throw new Error("Native input dispatch is unavailable");
}
