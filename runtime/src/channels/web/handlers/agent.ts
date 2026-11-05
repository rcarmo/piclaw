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
import { admitServerUiState } from "../ui-state.js";
import { getDb, setChatCursor, type InteractionRow } from "../../../db.js";
import { formatOutbound } from "../../../router.js";
import { isSqliteContention } from '../../../db/sqlite-async-admission.js';
import { bindInputRequestAuthority, readInputRequestAuthority, releaseInputRequestAuthority, captureInputTarget, type ValidateInputAuthority } from '../messaging/input-request-authority.js';
import { createAgentProfileBuilder } from "../agent/agent-utils.js";
import { buildGeneralSettingsProfileUpdate, getGeneralSettingsData } from "./general-settings.js";
import { resolveAvatarUrl } from "../media/avatar-service.js";

import { MODEL_COMMAND_TYPES } from "../../../agent-control/agent-control-types.js";
import { resolveAndBroadcastModelStateForCommand } from "../agent/command-model-state.js";
import { resolveThreadId } from "../runtime/threading.js";

import { createUuid } from "../../../utils/ids.js";
import { createLogger, debugSuppressedError } from "../../../utils/logger.js";

const log = createLogger("web.handlers.agent");
export type BrowserObservabilityContext = {
  userId?: string;
  sessionId?: string;
  clientId?: string;
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
    revalidateInputAuthority = phase => { if (phase !== undefined) binding(); request(phase); };
    revalidateInputAuthority();
  }
  catch { return channel.json({ error: 'Input authority is unavailable.' }, 403); }
  // Pin the trusted host selection to this route before any body read/await.
  // Request contents cannot select an engine or replace this SQL-only callback.
  const dispatchNative = channel.dispatchAcceptedInput?.bind(channel);
  const admitUserInput = channel.admitMessage?.bind(channel);
  const prepareAdmission = channel.prepareInputSourceAdmission?.bind(channel);
  const prepareInputText = channel.prepareInputText?.bind(channel);
  const lookupAdmission = channel.getInputSourceAdmission?.bind(channel);
  let acceptSource: ReturnType<NonNullable<WebChannelLike["getInputSourceAdmission"]>>;
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
  if (command?.type === "queue_all") return channel.json({ error: "Batch /queue-all is unavailable for SDK-managed inputs; use /queue." }, 400);
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
  if (ordinaryInput && (!lookupAdmission || !admitUserInput || !dispatchNative)) {
    return channel.json({ error: "Native input admission is unavailable." }, 503);
  }
  if (ordinaryInput) {
    try {
      revalidateInputAuthority('verify');
      await prepareAdmission?.(chatJid);
      revalidateInputAuthority('verify');
      acceptSource = lookupAdmission?.(chatJid);
    } catch { return channel.json({ error: 'Input admission could not be confirmed.' }, 503); }
  }
  if (prepareInputText && ordinaryInput) {
    try {
      revalidateInputAuthority('verify');
      const prepared = prepareInputText(chatJid, content);
      if (prepared && typeof (prepared as unknown as { then?: unknown }).then === "function") {
        void Promise.resolve(prepared).catch(error => debugSuppressedError(log, 'Rejected asynchronous input preparation.', error, { operation: 'handle_agent_message.async_preparation_rejected', chatJid }));
        throw Error("Input preparation must be synchronous");
      }
      if (!prepared || typeof prepared.text !== "string" || (!prepared.text.trim() && !hasAttachments) || isSlashCommandInvocation(prepared.text) ||
        typeof prepared.assertCurrent !== "function") throw Error("Invalid prepared input");
      const requestAuthority = revalidateInputAuthority;
      const assertCurrent = prepared.assertCurrent.bind(prepared);
      revalidateInputAuthority = phase => {
        requestAuthority(phase);
        const result = assertCurrent();
        if (result !== undefined) {
          void Promise.resolve(result).catch(error => debugSuppressedError(log, 'Rejected asynchronous input authority.', error, { operation: 'handle_agent_message.async_authority_rejected', chatJid }));
          throw Error("Prepared input authority must be synchronous");
        }
      };
      content = prepared.text;
      revalidateInputAuthority('verify');
    } catch (error) {
      log.warn("Native input preparation rejected", { operation: "handle_agent_message.preparation_rejected", chatJid, err: error });
      return channel.json({ error: "Input preparation could not be confirmed." }, 503);
    }
  }
  if (ordinaryInput && typeof acceptSource !== "function")
    return channel.json({ error: "Native input admission is unavailable." }, 503);
  if (ordinaryInput && (!mentionTarget || mentionTarget.chat_jid===chatJid)) {
    let interaction: InteractionRow | null;
    try {
      interaction = await admitUserInput(chatJid,content,false,normalized.mediaIds,{
        contentBlocks:normalized.contentBlocks,linkPreviews:normalized.linkPreviews,threadId:normalized.threadId??undefined,
        screenHint:normalized.screenHint,acceptSource,isSteeringMessage:requestMode==="steer",
      },revalidateInputAuthority,req.signal);
    } catch (error) {
      if (req.signal.aborted) return channel.json({error:"Input submission was cancelled before acceptance."},400);
      return channel.json({error:"Message admission could not be confirmed."},503);
    }
    if (!interaction) return channel.json({error:"Failed to store message"},500);
    const stored = getDb().query("SELECT id FROM messages WHERE rowid=? AND chat_jid=?").get(interaction.id,chatJid) as {id:string}|null;
    if (!stored) return channel.json({error:"Accepted input source is unavailable."},503);
    try {
      const receipt = await dispatchNative!(chatJid,stored.id,interaction.id,requestMode==="steer"?"steer":"followUp");
      if (receipt.queued) channel.broadcastEvent("agent_followup_queued",{chat_jid:chatJid,row_id:receipt.submission_id,content,thread_id:interaction.data?.thread_id??null,timestamp:interaction.timestamp,source:"native_sdk"});
      else channel.broadcastEvent("new_post",interaction);
      return channel.json({thread_id:interaction.data?.thread_id??interaction.id,row_id:interaction.id,created:true,submission_id:receipt.submission_id,
        ...(receipt.queued?{queued:requestMode==="steer"?"steer":"followup"}: {})},201);
    } catch (error) {
      // The source is committed, but its SDK placement is unproven. Only a
      // verified receipt/watch may publish it to the timeline or follow-up queue.
      // Never create another source or replay it after an uncertain admission.
      log.warn("Accepted input SDK admission could not be confirmed",{operation:"handle_agent_message.native_admission_uncertain",chatJid,err:error});
      return channel.json({error:"Input saved; SDK admission could not be confirmed.",thread_id:interaction.data?.thread_id??interaction.id,accepted:true},503);
    }
  }
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
      const patch = metersCommand.payload.mode === "toggle" ? 'toggle' as const
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
    const result = await channel.agentPool.applyControlCommand(chatJid, command);
    if (result.status !== "success") {
      return channel.json({ error: result.message, command: result, thread_id: null, ui_only: true }, 500);
    }
    return channel.json(
      {
        thread_id: null,
        command: result,
        ui_only: true,
        immediate: true,
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

  // Controls may persist their real timeline row, but never become input jobs.
  if (ordinaryInput || !admitUserInput) return channel.json({ error: 'Native input admission is unavailable.' }, 503);
  let interaction: InteractionRow | null;
  try {
    interaction = await admitUserInput(chatJid, content, false, normalized.mediaIds, {
      contentBlocks: normalized.contentBlocks, linkPreviews: normalized.linkPreviews,
      threadId: normalized.threadId ?? undefined, screenHint: normalized.screenHint,
    }, revalidateInputAuthority, req.signal);
  } catch (error) {
    if (isSqliteContention(error)) return channel.json({ error: 'Message storage is busy; this input was not accepted.' }, 503);
    if (req.signal.aborted) return channel.json({ error: 'Input submission was cancelled before acceptance.' }, 400);
    return channel.json({ error: 'Input admission could not be confirmed.' }, 503);
  }
  if (!interaction) return channel.json({ error: "Failed to store message" }, 500);

  // Publish the real control interaction at most once.
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

  // Passive context observations are not execution lifecycle transitions.
  const emitCommandContextUsage = (payload: Record<string, unknown>) => {
    channel.broadcastEvent("agent_status", withAgentProfile(payload));
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
    emitCommandContextUsage({
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
    const isCompactCommand = command.type === "compact";
    const isSessionRotateCommand = command.type === "session_rotate" || command.type === "new_session";
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
      emitCommandContextUsage({
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
      sendOptions.requirePersistence = true;
      try {
        await channel.sendMessage(responseChatJid, formatted || "", sendOptions);
        responseDelivery = "persisted";
      } catch (error) {
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

    const commandResult = result.contextUsage ? { ...result, contextUsage: {
      ...publicContextUsage(result.contextUsage),
      estimated: result.contextUsage.estimated,
      source: result.contextUsage.source,
      phase: result.contextUsage.phase,
    } } : result;
    return channel.json(
      { user_message: interaction, thread_id: threadId, command: commandResult, response_delivery: responseDelivery },
      201
    );
  }

  // If message looks like a slash command invocation, execute it directly.
  // Paths such as /workspace/piclaw or prose that merely mention /commands stay normal prompts.
  if (isSlashCommandInvocation(trimmed)) {
    broadcastNewPost();
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

    return channel.json(
      { user_message: interaction, thread_id: threadId, command: cmdResult },
      201
    );
  }

  return channel.json({ error: "Unsupported durable input." }, 400);
}
