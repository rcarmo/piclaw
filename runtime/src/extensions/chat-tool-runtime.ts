/**
 * chat-tool-runtime – direct runtime relay for the built-in chat tool.
 *
 * This intentionally does not use the web peer relay endpoint. The chat tool is already
 * running inside a trusted session context, so the runtime resolves source and
 * destination identities itself, then delivers a normal message to the target
 * chat with a structured reply-to descriptor.
 */
import type { AgentPool } from "../agent-pool.js";
import { getIdentityConfig } from "../core/config.js";
import { createMedia, getChatBranchByAgentName, getChatBranchByChatJid } from "../db.js";
import { createLogger, debugSuppressedError } from "../utils/logger.js";
import type { ChatRelayRequest, ChatRelayResult } from "./chat-tool.js";

const log = createLogger("extensions.chat-tool-runtime");

type ChatRelayMode = "auto" | "queue" | "steer";

type ChatIdentity = {
  chat_jid: string;
  agent_name: string;
  agent_display_name: string;
  branch_id?: string | null;
  root_chat_jid?: string | null;
  parent_branch_id?: string | null;
};

type ChatBranchLike = {
  branch_id?: string | null;
  chat_jid: string;
  root_chat_jid?: string | null;
  parent_branch_id?: string | null;
  agent_name: string;
};

type ChatToolRelayAgentPool = Pick<AgentPool, "findChatByAgentName" | "getAgentHandleForChat" | "listActiveChats" | "listKnownChats">;

type DirectChatToolRelayWeb = {
  handleAgentMessage?: (req: Request, pathname: string) => Promise<Response>;
  handleRequest?: (req: Request) => Promise<Response>;
};

type DirectChatToolRelayOptions = {
  defaultAgentId?: string;
  getAgentDisplayName?: () => string | null | undefined;
  getChatBranchByChatJid?: (chatJid: string) => ChatBranchLike | null;
  getChatBranchByAgentName?: (agentName: string) => ChatBranchLike | null;
};

function fallbackPeerAgentHandle(chatJid: string): string {
  return (chatJid.split(/[:/]/).filter(Boolean).pop() || chatJid).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "agent";
}

function normalizeAgentName(value: string | undefined): string {
  return String(value || "").trim().replace(/^@+/, "").trim();
}

function getRuntimeAgentDisplayName(options?: DirectChatToolRelayOptions): string {
  const configured = options?.getAgentDisplayName?.();
  if (configured && configured.trim()) return configured.trim();
  return getIdentityConfig().assistantName || "PiClaw";
}

function identityFromBranch(branch: ChatBranchLike, displayName: string): ChatIdentity {
  return {
    chat_jid: branch.chat_jid,
    agent_name: branch.agent_name,
    agent_display_name: displayName,
    branch_id: branch.branch_id ?? null,
    root_chat_jid: branch.root_chat_jid ?? branch.chat_jid,
    parent_branch_id: branch.parent_branch_id ?? null,
  };
}

function resolveChatIdentity(
  agentPool: ChatToolRelayAgentPool,
  chatJid: string,
  displayName: string,
  options: {
    allowDerivedFallback?: boolean;
    getChatBranchByChatJid?: DirectChatToolRelayOptions["getChatBranchByChatJid"];
  } = {},
): ChatIdentity | null {
  const normalized = chatJid.trim();
  if (!normalized) return null;

  try {
    const branch = (options.getChatBranchByChatJid || getChatBranchByChatJid)(normalized);
    if (branch?.agent_name) return identityFromBranch(branch, displayName);
  } catch (error) {
    debugSuppressedError(log, "Failed to resolve chat branch while handling chat tool relay; falling back to AgentPool state.", error, {
      operation: "chat_tool_runtime.resolve_chat_branch",
      chatJid: normalized,
    });
  }

  const active = agentPool.listActiveChats().find((chat) => chat.chat_jid === normalized);
  if (active?.agent_name) return identityFromBranch(active, displayName);

  const known = agentPool.listKnownChats().find((chat) => chat.chat_jid === normalized);
  if (known?.agent_name) return identityFromBranch(known, displayName);

  if (!options.allowDerivedFallback) return null;
  const derived = agentPool.getAgentHandleForChat(normalized) || fallbackPeerAgentHandle(normalized);
  return {
    chat_jid: normalized,
    agent_name: derived,
    agent_display_name: displayName,
    branch_id: null,
    root_chat_jid: normalized,
    parent_branch_id: null,
  };
}

function resolveTargetIdentity(
  agentPool: ChatToolRelayAgentPool,
  request: ChatRelayRequest,
  displayName: string,
  options: DirectChatToolRelayOptions,
): ChatIdentity | null {
  const targetChatJid = request.target_chat_jid?.trim() || "";
  if (targetChatJid) return resolveChatIdentity(agentPool, targetChatJid, displayName, {
    getChatBranchByChatJid: options.getChatBranchByChatJid,
  });

  const targetAgentName = normalizeAgentName(request.target_agent_name);
  if (!targetAgentName) return null;

  try {
    const branch = (options.getChatBranchByAgentName || getChatBranchByAgentName)(targetAgentName);
    if (branch?.agent_name) return identityFromBranch(branch, displayName);
  } catch (error) {
    debugSuppressedError(log, "Failed to resolve chat branch alias while handling chat tool relay; falling back to AgentPool state.", error, {
      operation: "chat_tool_runtime.resolve_agent_alias",
      agentName: targetAgentName,
    });
  }

  const found = agentPool.findChatByAgentName(targetAgentName);
  if (!found?.chat_jid || !found.agent_name) return null;
  return resolveChatIdentity(agentPool, found.chat_jid, displayName, {
    getChatBranchByChatJid: options.getChatBranchByChatJid,
  }) || identityFromBranch(found, displayName);
}

function buildSessionTreeDescriptor(identity: ChatIdentity): Record<string, unknown> {
  return {
    branch_id: identity.branch_id ?? null,
    chat_jid: identity.chat_jid,
    root_chat_jid: identity.root_chat_jid ?? identity.chat_jid,
    parent_branch_id: identity.parent_branch_id ?? null,
    agent_name: identity.agent_name,
  };
}

function buildReplyToDescriptor(source: ChatIdentity): Record<string, unknown> {
  return {
    chat_jid: source.chat_jid,
    agent_name: source.agent_name,
    agent_display_name: source.agent_display_name,
    session_tree: buildSessionTreeDescriptor(source),
  };
}

function buildPeerRelayBlock(input: {
  source: ChatIdentity;
  target: ChatIdentity;
  body: string;
}): Record<string, unknown> {
  return {
    type: "peer_message",
    relay: "chat_tool",
    source_chat_jid: input.source.chat_jid,
    source_agent_name: input.source.agent_name,
    source_agent_display_name: input.source.agent_display_name,
    target_chat_jid: input.target.chat_jid,
    target_agent_name: input.target.agent_name,
    target_agent_display_name: input.target.agent_display_name,
    reply_to: buildReplyToDescriptor(input.source),
    source_session_tree: buildSessionTreeDescriptor(input.source),
    target_session_tree: buildSessionTreeDescriptor(input.target),
    body: input.body,
  };
}

function buildForwardedContent(source: ChatIdentity, target: ChatIdentity, content: string): string {
  return [
    `From: ${source.agent_display_name} (@${source.agent_name}) <jid:${source.chat_jid}>`,
    `Reply-To: @${source.agent_name} <jid:${source.chat_jid}>`,
    `To: @${target.agent_name} <jid:${target.chat_jid}>`,
    "",
    content,
  ].join("\n");
}

function normalizeMode(mode: ChatRelayMode | undefined): ChatRelayMode {
  return mode === "queue" || mode === "steer" || mode === "auto" ? mode : "auto";
}

function readForwardedMessageRowId(responseBody: Record<string, unknown>): number | null {
  if (Number.isInteger(responseBody.row_id) && Number(responseBody.row_id) > 0) return Number(responseBody.row_id);
  const userMessage = responseBody.user_message;
  if (userMessage && typeof userMessage === "object") {
    const id = (userMessage as { id?: unknown }).id;
    if (Number.isInteger(id) && Number(id) > 0) return Number(id);
  }
  return null;
}

function readForwardedCreated(responseBody: Record<string, unknown>): boolean | undefined {
  if (typeof responseBody.created === "boolean") return responseBody.created;
  return responseBody.user_message && typeof responseBody.user_message === "object" ? true : undefined;
}

export function createDirectChatToolRelayHandler(
  agentPool: ChatToolRelayAgentPool,
  web: DirectChatToolRelayWeb,
  options: DirectChatToolRelayOptions = {},
): (request: ChatRelayRequest) => Promise<ChatRelayResult> {
  const defaultAgentId = options.defaultAgentId || "default";
  return async (request) => {
    const displayName = getRuntimeAgentDisplayName(options);
    const source = resolveChatIdentity(agentPool, request.source_chat_jid, displayName, {
      allowDerivedFallback: true,
      getChatBranchByChatJid: options.getChatBranchByChatJid,
    });
    if (!source) throw new Error(`Unknown source chat: ${request.source_chat_jid}`);

    const target = resolveTargetIdentity(agentPool, request, displayName, options);
    if (!target) {
      throw new Error(request.target_agent_name
        ? `Unknown target agent: ${normalizeAgentName(request.target_agent_name)}`
        : `Unknown target chat: ${request.target_chat_jid || ""}`);
    }
    if (source.chat_jid === target.chat_jid) throw new Error("source_chat_jid and target chat must differ");

    const content = request.content.trim();
    const mediaIds = (request.attachments || []).map((attachment) => attachment.source_media_id || createMedia(
      attachment.filename,
      attachment.content_type,
      attachment.data,
      null,
      { size: attachment.size, sha256: attachment.sha256, source: "chat" },
    ));
    const replyTo = buildReplyToDescriptor(source);
    const contentBlocks = [buildPeerRelayBlock({ source, target, body: content })];
    const pathname = `/agent/${defaultAgentId}/message`;
    const headers = new Headers({
      "Content-Type": "application/json",
      "Reply-To": `@${source.agent_name} <jid:${source.chat_jid}>`,
      "X-Piclaw-Source-Chat-Jid": source.chat_jid,
      "X-Piclaw-Source-Agent-Name": source.agent_name,
      "X-Piclaw-Reply-To-Chat-Jid": source.chat_jid,
      "X-Piclaw-Persist-Steer": "1",
    });
    const forwardReq = new Request(
      `http://internal${pathname}?chat_jid=${encodeURIComponent(target.chat_jid)}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          content: buildForwardedContent(source, target, content),
          content_blocks: contentBlocks,
          ...(mediaIds.length ? { media_ids: mediaIds } : {}),
          mode: normalizeMode(request.mode),
          persist_steer: true,
        }),
      },
    );

    const forwardRes = typeof web.handleAgentMessage === "function"
      ? await web.handleAgentMessage(forwardReq, pathname)
      : await web.handleRequest?.(forwardReq);
    if (!forwardRes) throw new Error("Cross-session chat relay is unavailable in this runtime.");
    if (!forwardRes.ok) {
      const body = await forwardRes.json().catch(() => ({} as Record<string, unknown>));
      const message = typeof body.error === "string" ? body.error : `Cross-session chat relay failed (${forwardRes.status}).`;
      throw new Error(message);
    }

    const responseBody = await forwardRes.json().catch(() => ({} as Record<string, unknown>));
    const rowId = readForwardedMessageRowId(responseBody);
    const created = readForwardedCreated(responseBody);
    return {
      status: "ok",
      ...responseBody,
      ...(rowId ? { row_id: rowId } : {}),
      ...(created !== undefined ? { created } : {}),
      source_chat_jid: source.chat_jid,
      source_agent_name: source.agent_name,
      source_agent_display_name: source.agent_display_name,
      target_chat_jid: target.chat_jid,
      target_agent_name: target.agent_name,
      target_agent_display_name: target.agent_display_name,
      reply_to: replyTo,
      source_session_tree: buildSessionTreeDescriptor(source),
      target_session_tree: buildSessionTreeDescriptor(target),
      relayed: true,
    };
  };
}

export const __chatToolRuntimeInternals = {
  buildForwardedContent,
  buildPeerRelayBlock,
  buildReplyToDescriptor,
};
