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
  getAgentRuntimeConfig,
  getIdentityConfig,
  getRoutingConfig,
} from "../../../core/config.js";
import { parseControlCommand } from "../../../agent-control/index.js";
import {
  normalizeAgentMessagePayload,
  parseAgentMessageRequest,
  storeAgentUserMessage,
} from "../messaging/agent-message-service.js";
import { handleUiThemeCommand } from "../theming/ui-theme-commands.js";
import { handleUiMetersCommand } from "../ui-meters-commands.js";
import {
  beginChatRun,
  endChatRun,
  endChatRunWithError,
  getChatCursor,
  getInflightMessageId,
  getMessageRowIdById,
  getMessagesSince,
  getDb,
  rollbackInflightRun,
  setChatCursor,
} from "../../../db.js";
import { detectChannel, formatMessages, formatOutbound } from "../../../router.js";
import { createAgentProfileBuilder } from "../agent/agent-utils.js";
import { resolveAvatarUrl } from "../media/avatar-service.js";
import { createAgentEventEmitter, createStreamingEventHandler } from "../sse/agent-events.js";
import { broadcastInteractionUpdated } from "../cards/interaction-service.js";
import { storeAgentTurn } from "../messaging/agent-message-store.js";
import { resolveThreadId, resolveThreadRootId } from "../runtime/threading.js";
import { resolveToolStatusHints } from "../../../tool-status-hints.js";
import "../../../extensions/local-core-tool-status-hints.js";
import "../../../extensions/generic-tool-status-hints.js";
import { createUuid } from "../../../utils/ids.js";
import { createLogger } from "../../../utils/logger.js";
import type { AttachmentInfo } from "../../../agent-pool/attachments.js";
import { checkPendingShutdown } from "../../../runtime/shutdown-registry.js";

const log = createLogger("web.handlers.agent");

function isRateLimitError(errorText: string | null | undefined): boolean {
  if (!errorText) return false;
  return /\b429\b|rate[ -]?limit|too many requests|retry-after/i.test(errorText);
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

  const command = parseControlCommand(content, getRoutingConfig().triggerPattern);
  const trimmed = content.trim();
  const themeCommand = handleUiThemeCommand(trimmed);
  const metersCommand = handleUiMetersCommand(trimmed);
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
    });
    if (!sourceInteraction) return channel.json({ error: "Failed to store message" }, 500);

    channel.broadcastEvent("new_post", sourceInteraction);
    setChatCursor(chatJid, sourceInteraction.timestamp);

    const sourceAgentName = typeof (channel.agentPool as { getAgentHandleForChat?: (chatJid: string) => string }).getAgentHandleForChat === "function"
      ? (channel.agentPool as { getAgentHandleForChat: (chatJid: string) => string }).getAgentHandleForChat(chatJid)
      : fallbackAgentHandle(chatJid);
    const forwardedContent = mention.remainder;
    const forwardReq = new Request(`http://internal/agent/${agentId}/message?chat_jid=${encodeURIComponent(mentionTarget.chat_jid)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: forwardedContent,
        media_ids: normalized.mediaIds,
        content_blocks: normalized.contentBlocks,
        link_previews: normalized.linkPreviews,
        mode: requestMode,
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
    extras?: { mediaIds?: number[]; contentBlocks?: unknown[]; linkPreviews?: unknown[] }
  ): Response => {
    const queuedAt = new Date().toISOString();
    // Don't inherit the active turn's thread root. Deferred followups are
    // independent messages typed while the agent was busy — they should
    // start their own thread when materialized (self-rooted via
    // storeWebMessage's default behaviour).
    const queuedThreadId: number | null = null;
    const queuedRowId = channel.enqueueQueuedFollowupItem(chatJid, 0, queuedContent, queuedThreadId, queuedAt, extras);
    channel.broadcastEvent("agent_followup_queued", {
      chat_jid: chatJid,
      thread_id: queuedThreadId,
      row_id: queuedRowId,
      content: queuedContent,
      timestamp: queuedAt,
    });
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

  if (!command && !themeCommand && !metersCommand && isStreaming && requestMode === "steer") {
    const steerResponse = await queueDeferredSteer(content, "compose");
    if (steerResponse) return steerResponse;
  }

  if ((command?.type === "queue" || command?.type === "queue_all") && isStreaming) {
    const queuedText = (command.message || "").trim();
    if (queuedText) {
      return queueDeferredFollowup(queuedText);
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
      channel.broadcastEvent("ui_theme", { chat_jid: chatJid, ...themeCommand.payload });
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
      channel.broadcastEvent("ui_meters", { chat_jid: chatJid, ...metersCommand.payload });
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

  // Model/thinking commands: execute without writing to the timeline.
  const MODEL_COMMAND_TYPES = new Set(["model", "thinking", "cycle_model", "cycle_thinking"]);
  if (command && MODEL_COMMAND_TYPES.has(command.type)) {
    const result = await channel.agentPool.applyControlCommand(chatJid, command);

    // Broadcast model state so the UI hint updates immediately
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
    } catch {
      if (typeof channel.agentPool.getCurrentModelLabel === "function") {
        nextModel = await channel.agentPool.getCurrentModelLabel(chatJid).catch(() => null);
      }
    }

    if (result.status === "success") {
      channel.broadcastEvent("model_changed", {
        chat_jid: chatJid,
        model: nextModel ?? null,
        thinking_level: thinkingLevel ?? null,
        thinking_level_label: thinkingLevelLabel ?? thinkingLevel ?? null,
        supports_thinking: supportsThinking,
      });
      if (command.type === "model" || command.type === "cycle_model") {
        channel.skipFailedOnModelSwitch(chatJid);
      }
    }

    return channel.json(
      {
        thread_id: null,
        command: { ...result, model_label: nextModel, thinking_level: thinkingLevel, thinking_level_label: thinkingLevelLabel ?? thinkingLevel, supports_thinking: supportsThinking },
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
    });

    // If we are deferring only because persisted/deferred backlog exists but
    // no run is currently active, proactively wake processChat so the backlog
    // drains instead of passively accumulating more deferred messages.
    if (hasQueuedBacklog && !isActive) {
      channel.resumeChat(chatJid);
    }

    return response;
  }

  const interaction = storeAgentUserMessage(channel, chatJid, {
    content,
    mediaIds: normalized.mediaIds,
    contentBlocks: normalized.contentBlocks,
    linkPreviews: normalized.linkPreviews,
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
    channel.updateAgentStatus(chatJid, payload);
    channel.broadcastEvent("agent_status", withAgentProfile(payload));
  };

  const queueFollowupMessage = async (): Promise<Response | null> => {
    // Web queued follow-ups are managed by the web channel itself rather than
    // AgentSession's internal follow-up queue. This guarantees the current turn
    // finalizes and publishes before the next queued user message begins.
    if (!isStreaming) {
      return null;
    }

    channel.enqueueQueuedFollowupItem(
      chatJid,
      interaction.id,
      content,
      interaction.id,
      interaction.timestamp
    );
    channel.broadcastEvent("agent_followup_queued", {
      chat_jid: chatJid,
      thread_id: interaction.data?.thread_id ?? interaction.id ?? null,
      row_id: interaction.id,
      content,
      timestamp: interaction.timestamp,
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
    const formatted = formatOutbound(result.message, "web");
    const isQueueCommand = command.type === "queue" || command.type === "queue_all";
    const isSteerCommand = command.type === "steer";

    if (formatted || result.contentBlocks?.length) {
      if (isQueueCommand && result.queued_followup) {
        return queueDeferredFollowup(((command as { message?: string }).message || content).trim());
      } else if (isSteerCommand && (result as { queued_steer?: boolean }).queued_steer) {
        const steerResponse = await queueSteerMessage("command");
        if (steerResponse) {
          return steerResponse;
        }
      } else if (isSteerCommand && (result as { queued_followup?: boolean }).queued_followup) {
        return queueDeferredFollowup(((command as { message?: string }).message || content).trim());
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
        await channel.sendMessage(chatJid, formatted || "", sendOptions);
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
      } catch {
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

    if (result.status === "success" && (command.type === "model" || command.type === "cycle_model")) {
      channel.skipFailedOnModelSwitch(chatJid);
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

  // If message looks like an extension slash command (starts with "/"), execute it directly
  if (trimmed.startsWith("/")) {
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
    await processChat(channel, chatJid, agentId, interaction.data?.thread_id ?? interaction.id);
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
  threadRootId?: number
): Promise<void> {
  const MAX_MATERIALIZE_RETRIES = 5;

  const materializeNextDeferredFollowup = (): boolean => {
    const nextQueued = channel.consumeQueuedFollowupItem(chatJid);
    if (!nextQueued) return false;

    const retries = nextQueued.materializeRetries ?? 0;

    const queuedInteraction = channel.storeMessage(
      chatJid,
      nextQueued.queuedContent,
      false,
      nextQueued.mediaIds ?? [],
      {
        contentBlocks: Array.isArray(nextQueued.contentBlocks) ? nextQueued.contentBlocks : undefined,
        linkPreviews: Array.isArray(nextQueued.linkPreviews) ? nextQueued.linkPreviews : undefined,
        threadId: nextQueued.threadId ?? undefined,
      }
    );

    if (!queuedInteraction) {
      if (retries >= MAX_MATERIALIZE_RETRIES) {
        // Too many failures — drop the item to prevent infinite loops.
        log.error("Dropping queued follow-up after repeated materialize failures", {
          operation: "process_chat.materialize_followup_drop",
          chatJid,
          retries,
          rowId: nextQueued.rowId,
          contentPreview: nextQueued.queuedContent?.slice(0, 80) ?? "",
        });
        channel.broadcastEvent("agent_followup_consumed", {
          chat_jid: chatJid,
          thread_id: nextQueued.threadId ?? null,
          row_id: nextQueued.rowId,
          content: nextQueued.queuedContent,
          timestamp: nextQueued.queuedAt,
        });
        return false;
      }
      // Preserve order and increment retry counter.
      const withRetry = { ...nextQueued, materializeRetries: retries + 1 };
      channel.prependQueuedFollowupItem(chatJid, withRetry);
      log.warn("Failed to materialize queued follow-up", {
        operation: "process_chat.materialize_followup_retry",
        chatJid,
        attempt: retries + 1,
        maxAttempts: MAX_MATERIALIZE_RETRIES,
        rowId: nextQueued.rowId,
      });
      return false;
    }

    channel.broadcastEvent("agent_followup_consumed", {
      chat_jid: chatJid,
      thread_id: nextQueued.threadId ?? null,
      row_id: nextQueued.rowId,
      content: nextQueued.queuedContent,
      timestamp: nextQueued.queuedAt,
    });
    channel.broadcastEvent("new_post", queuedInteraction);
    // Resume using the newly materialized message row id as the frontier.
    // If multiple queued follow-ups belong to the same thread root, reusing the
    // stable thread id here would cause resume-task deduplication to collapse
    // later hand-offs and stall the drain loop after one turn.
    channel.resumeChat(chatJid, queuedInteraction.id);
    return true;
  };

  const prevCursor = getChatCursor(chatJid);
  const messages = getMessagesSince(chatJid, prevCursor, getIdentityConfig().assistantName);

  if (messages.length === 0) {
    log.info("processChat found no pending messages", {
      operation: "process_chat.no_pending_messages",
      chatJid,
      cursor: prevCursor,
      threadRootId: threadRootId ?? null,
    });
    materializeNextDeferredFollowup();
    return;
  }

  // Process exactly one persisted user message per turn. Batching multiple
  // user messages into one prompt causes cross-parented replies and makes
  // queue/turn finalization ordering nondeterministic.
  const currentMessage = messages[0];
  if (!currentMessage) return;

  // Derive thread root from the actual message being processed, NOT from
  // the threadRootId parameter. The parameter comes from whichever
  // handleAgentMessage enqueued this processChat, but cursor-ordered
  // message selection may pick a DIFFERENT message. Using the parameter
  // would cross-parent the response under the wrong thread.
  const messageThreadId = currentMessage.thread_id ?? undefined;
  const effectiveThreadRootId = messageThreadId ?? threadRootId;

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

  const channelName = detectChannel(chatJid);
  const prompt = formatMessages([currentMessage], channelName);
  const lastMessage = currentMessage;

  // Atomically advance the cursor AND write an inflight marker in one SQL
  // statement. If the process is killed before endChatRun(), the next
  // startup sees the inflight marker, rolls the cursor back to prevCursor,
  // and retries this turn.
  beginChatRun(chatJid, lastMessage.timestamp, {
    prevTs: prevCursor,
    messageId: lastMessage.id,
    startedAt: new Date().toISOString(),
  });

  const threadId = lastMessage.timestamp;

  const THOUGHT_PREVIEW_LINES = 8;
  const DRAFT_PREVIEW_LINES = 8;
  const PREVIEW_MAX_CHARS_PER_LINE = 160;

  const turnId = createUuid("turn");
  const identity = getIdentityConfig();
  const withAgentProfile = createAgentProfileBuilder(
    chatJid,
    identity.assistantName,
    resolveAvatarUrl("agent", identity.assistantAvatar),
    identity.userName || null,
    resolveAvatarUrl("user", identity.userAvatar),
    identity.userAvatarBackground || null
  );
  const emitter = createAgentEventEmitter(channel, withAgentProfile);
  const trackedEmitter = {
    ...emitter,
    status: (payload: Record<string, unknown>) => {
      const isToolStatus = payload?.type === "tool_call" || payload?.type === "tool_status";
      const toolName = typeof payload?.tool_name === "string" ? payload.tool_name.trim() : "";
      let nextPayload = payload;
      if (isToolStatus && toolName) {
        nextPayload = withResolvedToolStatusHints(chatJid, payload);
      }
      channel.updateAgentStatus(chatJid, nextPayload);
      emitter.status(nextPayload);
    },
  };

  trackedEmitter.status({
    thread_id: threadId,
    agent_id: agentId,
    type: "thinking",
    title: "Thinking...",
    turn_id: turnId,
  });

  const resolvedThreadRootId = resolveThreadRootId(
    channel,
    chatJid,
    currentMessage.id ?? "",
    effectiveThreadRootId
  );


  const streamingHandler = createStreamingEventHandler({
    emitter: trackedEmitter,
    agentId,
    threadId,
    turnId,
    thoughtPreviewLines: THOUGHT_PREVIEW_LINES,
    draftPreviewLines: DRAFT_PREVIEW_LINES,
    previewMaxCharsPerLine: PREVIEW_MAX_CHARS_PER_LINE,
    includeThoughtFull: () => channel.isPanelExpanded(turnId, "thought"),
    includeDraftFull: () => channel.isPanelExpanded(turnId, "draft"),
    onThoughtBuffer: (text, totalLines) => channel.updateThoughtBuffer(turnId, text, totalLines),
    onDraftBuffer: (text, totalLines) => channel.updateDraftBuffer(turnId, text, totalLines),
  });

  const hasActiveClients = channel.sse.clients.size > 0;
  const agentRuntimeConfig = getAgentRuntimeConfig();
  const timeoutMs = hasActiveClients
    ? agentRuntimeConfig.timeoutMs
    : (agentRuntimeConfig.backgroundTimeoutMs > 0 ? agentRuntimeConfig.backgroundTimeoutMs : agentRuntimeConfig.timeoutMs);

  let turnCount = 0;
  let hadIntermediateOutput = false;
  let persistedIntermediateOutput = false;
  let intermediatePersistFailed = false;
  const isCompactionIntentActive = (): boolean => {
    const status = channel.getAgentStatus(chatJid);
    if (!status || typeof status !== "object") return false;
    const intentKey = status.intent_key ?? status.intentKey;
    return status.type === "intent" && intentKey === "compaction";
  };
  const publishDraftFallback = (reason?: "timeout" | "error" | "empty-final") => {
    // Draft fallback should publish the currently visible draft for whichever
    // turn failed to finalize, even if earlier turns in the same session were
    // already flushed via onTurnComplete(). For the very first turn we must
    // still skip placeholder consumption so an already-queued follow-up is not
    // accidentally stolen by the original response.
    const draft = channel.getBuffer(turnId, "draft");
    const draftText = typeof draft?.text === "string" ? draft.text.trim() : "";
    if (!draftText) return false;

    const compactionNote = isCompactionIntentActive()
      ? "\n\nℹ️ Context compaction was in progress."
      : "";
    const suffix =
      reason === "timeout"
        ? `\n\n⚠️ Response timed out before finalization.${compactionNote}`
        : reason === "error"
          ? `\n\n⚠️ Response ended with an error before finalization.${compactionNote}`
          : compactionNote;

    return storeAgentTurn(channel, emitter, {
      chatJid,
      text: `${draftText}${suffix}`,
      attachments: [],
      channelName,
      threadId: resolvedThreadRootId,
      skipPlaceholder: turnCount === 0,
      isTerminalAgentReply: true,
    });
  };

  const finalizeSuccessfulRun = async () => {
    // Single UPDATE: clears inflight AND clears any stale failed_run atomically.
    endChatRun(chatJid);

    const cursorAfterEnd = getChatCursor(chatJid);
    const pendingSteerTimestamp = channel.consumePendingSteering(chatJid);
    if (pendingSteerTimestamp) {
      const current = getChatCursor(chatJid);
      if (!current || current < pendingSteerTimestamp) {
        setChatCursor(chatJid, pendingSteerTimestamp);
      }
    }

    const cursorAfterSteer = getChatCursor(chatJid);

    channel.saveState();
    const contextUsage = await channel.agentPool.getContextUsageForChat(chatJid);
    trackedEmitter.status({
      thread_id: threadId,
      agent_id: agentId,
      type: "done",
      turn_id: turnId,
      context_usage: contextUsage
        ? { tokens: contextUsage.tokens, contextWindow: contextUsage.contextWindow, percent: contextUsage.percent }
        : null,
    });

    // If more persisted user messages already exist after the cursor, process
    // them before consuming deferred queued items. This preserves one-message-
    // per-turn ordering and prevents cross-thread batching.
    const cursorNow = getChatCursor(chatJid);
    const remainingPersisted = getMessagesSince(chatJid, cursorNow, getIdentityConfig().assistantName);

    log.info("finalizeSuccessfulRun advanced cursor", {
      operation: "process_chat.finalize_successful_run",
      chatJid,
      cursorAfterEnd,
      cursorAfterSteer,
      cursorNow,
      remainingCount: remainingPersisted.length,
      remainingMessages: remainingPersisted.map(m => `${m.id}@${m.timestamp}`),
    });

    if (remainingPersisted.length > 0) {
      channel.resumeChat(chatJid);
      return;
    }

    // Start the next queued follow-up only after this turn has fully finalized.
    materializeNextDeferredFollowup();

    // If the exit_process tool was called during this turn, trigger graceful
    // shutdown now that the response has been persisted and broadcast.
    checkPendingShutdown();
  };

  const output = await channel.agentPool.runAgent(prompt, chatJid, {
    timeoutMs,
    onEvent: streamingHandler,
    onTurnComplete: (turn: { text: string; attachments: unknown[] }) => {
      // Turn boundary: the first turn (index 0) is the original prompt's
      // response — skip placeholder consumption so it doesn't steal a
      // placeholder that belongs to a queued follow-up.
      // Subsequent turns (index 1+) are follow-up responses and should
      // consume their corresponding placeholder.
      const isFirstTurn = turnCount === 0;
      turnCount++;
      if (turn.text || turn.attachments.length > 0) {
        hadIntermediateOutput = true;
        const stored = storeAgentTurn(channel, emitter, {
          chatJid,
          text: turn.text,
          attachments: turn.attachments as AttachmentInfo[],
          channelName,
          threadId: resolvedThreadRootId,
          skipPlaceholder: isFirstTurn,
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

  if (output.status === "error") {
    if (output.error && output.error.includes("already processing")) {
      // A concurrent run is already handling this chat. Roll back the cursor
      // we advanced so this message stays pending, then throw so the queue
      // retries after backoff.
      rollbackInflightRun(chatJid, prevCursor);
      trackedEmitter.status({
        thread_id: threadId,
        agent_id: agentId,
        type: "intent",
        title: "Queued — waiting for current response",
        turn_id: turnId,
      });
      throw new Error(output.error);
    }

    if (output.error && output.error.includes("No API provider registered for api:")) {
      // Extension/provider registration races can happen right after restart.
      // Keep the message pending and let the queue retry automatically.
      rollbackInflightRun(chatJid, prevCursor);
      trackedEmitter.status({
        thread_id: threadId,
        agent_id: agentId,
        type: "intent",
        title: "Model provider is initializing — retrying shortly",
        detail: output.error,
        turn_id: turnId,
      });
      throw new Error(output.error);
    }

    const errorText = output.error || "Agent error";
    const rateLimited = isRateLimitError(errorText);
    const fallbackPublished = errorText.toLowerCase().includes("timed out")
      ? publishDraftFallback("timeout")
      : publishDraftFallback("error");

    if (fallbackPublished) {
      // A persisted draft fallback is a terminal outcome, not a replayable
      // failure. Clear inflight state through the normal success path so the
      // turn can drain pending work and the client receives a normal done
      // transition plus the already-persisted fallback post.
      await finalizeSuccessfulRun();
      return;
    }

    // Single UPDATE: clears inflight AND writes failed_run atomically.
    // No window exists where inflight is gone but failed_run is not yet set.
    endChatRunWithError(chatJid, {
      prevTs: prevCursor,
      failedTs: lastMessage.timestamp,
      messageId: lastMessage.id,
      threadRootId: resolvedThreadRootId ?? null,
      createdAt: new Date().toISOString(),
    });

    // Surface the error as a visible timeline message so the user can see
    // what went wrong. Previously errors were only shown as transient status
    // events which are invisible in timeline history.
    const isApiError = /invalid_request_error|400|media_type|image.*source/i.test(errorText);
    const userVisibleError = rateLimited
      ? `⚠️ AI provider rate limit after automatic retries:\n\n\`${errorText.slice(0, 500)}\`\n\nPiclaw now retries 429/rate-limit failures with exponential backoff up to 5 times before surfacing the error.`
      : isApiError
        ? `⚠️ API error — the session may be corrupted:\n\n\`${errorText.slice(0, 500)}\`\n\nThis error will repeat on every message. Try \`/new-session\` to start fresh, or manually repair the session JSONL.`
        : `⚠️ Agent error: ${errorText.slice(0, 300)}`;
    const errorNotice = channel.storeMessage(chatJid, userVisibleError, true, [], {
      threadId: resolvedThreadRootId ?? undefined,
      isTerminalAgentReply: true,
    });
    if (errorNotice) {
      channel.broadcastEvent("agent_response", errorNotice);
    }

    trackedEmitter.status({
      thread_id: threadId,
      agent_id: agentId,
      type: "error",
      title: rateLimited ? "AI provider rate limit" : errorText,
      detail: rateLimited ? errorText : undefined,
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
  const finalized = hasOutput
    ? storeAgentTurn(channel, emitter, {
        chatJid,
        text: output.result || "",
        attachments: finalAttachments as AttachmentInfo[],
        channelName,
        threadId: resolvedThreadRootId,
        skipPlaceholder: turnCount === 0,
        isTerminalAgentReply: true,
      })
    : publishDraftFallback("empty-final");

  if (!finalized && hasOutput) {
    // The agent produced output but persistence failed (DB write error).
    // Record a failed run so the message is retried on model switch.
    const errorText = "Agent completed but terminal response could not be persisted.";
    endChatRunWithError(chatJid, {
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
      endChatRunWithError(chatJid, {
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
      endChatRunWithError(chatJid, {
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

    // The agent completed normally but produced no output and there was no
    // draft buffer.  This typically happens when restart recovery replays a
    // contextless message.  Treat as a successful no-op so the cursor
    // advances and the same message is not retried endlessly.
    //
    // Post a system notice so the user can see their message was consumed
    // without a response and re-send if needed.
    log.warn("Agent completed without output; finalizing as no-op", {
      operation: "process_chat.no_output_noop",
      chatJid,
    });

    const originalContent = currentMessage.content || "";
    const preview = originalContent.length > 120
      ? originalContent.slice(0, 120) + "…"
      : originalContent;
    const noticeText = preview
      ? `⚠️ Your message was received but the agent produced no response. You may need to re-send it.\n\n> ${preview}`
      : "⚠️ Your message was received but the agent produced no response. You may need to re-send it.";

    const notice = channel.storeMessage(chatJid, noticeText, true, [], {
      threadId: resolvedThreadRootId ?? undefined,
      isTerminalAgentReply: true,
    });
    if (notice) {
      channel.broadcastEvent("agent_response", notice);
    }

    await finalizeSuccessfulRun();
    return;
  }

  await finalizeSuccessfulRun();
}
