/** Safe runtime implementation for the versioned add-on messaging ABI. */

import type {
  AddonAdvertisableAgent,
  AddonAuthenticatedPeerSource,
  AddonMessagingRuntimeHandlers,
  AddonMessagingTargetInput,
  AddonMessagingTargetResolution,
  AddonPeerMessageDeliveryRequest,
} from "./runtime-contributions.js";
import type { RuntimeAgentMessageRequest, RuntimeAgentMessageResult } from "../channels/web/core/web-channel-runtime-public-surface-service.js";
import { createHash } from "node:crypto";
import { createMedia, deleteUnreferencedMedia } from "../db.js";

const MAX_PEER_MESSAGE_BYTES = 32 * 1024;
const MAX_PEER_ATTACHMENTS = 4;
const MAX_PEER_ATTACHMENT_BYTES = 16 * 1024 * 1024;
const MAX_PEER_ATTACHMENT_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_SHORT_FIELD_CHARS = 256;
const MAX_REPLY_FIELD_CHARS = 1024;

type KnownChat = {
  chat_jid: string;
  agent_name: string;
  archived_at?: string | null;
  is_active?: boolean;
};

export interface AddonMessagingRuntimeOptions {
  listKnownChats(): KnownChat[];
  findChatByAgentName(agentName: string): { chat_jid: string; agent_name: string } | null;
  enqueueAgentMessage(request: RuntimeAgentMessageRequest): Promise<RuntimeAgentMessageResult>;
}

function normalizeAgentName(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/^@+/, "").trim() : "";
}

function requiredString(value: unknown, label: string, maxChars = MAX_SHORT_FIELD_CHARS): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > maxChars) throw new Error(`${label} exceeds ${maxChars} characters.`);
  if (/\p{Cc}/u.test(normalized)) throw new Error(`${label} contains control characters.`);
  return normalized;
}

function optionalString(value: unknown, label: string, maxChars = MAX_SHORT_FIELD_CHARS): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredString(value, label, maxChars);
}

function identifier(value: unknown, label: string, pattern: RegExp, maxChars = MAX_SHORT_FIELD_CHARS): string {
  const normalized = requiredString(value, label, maxChars);
  if (!pattern.test(normalized)) throw new Error(`${label} has an invalid format.`);
  return normalized;
}

function messageContent(value: unknown, hasAttachments = false): string {
  const content = typeof value === "string" ? value.trim() : "";
  if (!content && !hasAttachments) throw new Error("content or attachments are required.");
  if (content.includes("\0")) throw new Error("content contains a NUL character.");
  if (Buffer.byteLength(content, "utf8") > MAX_PEER_MESSAGE_BYTES) {
    throw new Error(`content exceeds ${MAX_PEER_MESSAGE_BYTES} bytes.`);
  }
  return content;
}

function normalizePeerAttachments(value: unknown): Array<{ filename: string; content_type: string; size: number; sha256: string; data: Uint8Array }> {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_PEER_ATTACHMENTS) throw new Error(`attachments must contain at most ${MAX_PEER_ATTACHMENTS} files.`);
  let total = 0;
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`attachments[${index}] is invalid.`);
    const attachment = raw as Record<string, unknown>;
    const filename = requiredString(attachment.filename, `attachments[${index}].filename`, 255);
    const contentType = requiredString(attachment.content_type, `attachments[${index}].content_type`, 255).toLowerCase();
    const data = attachment.data instanceof Uint8Array ? attachment.data : null;
    const size = Number(attachment.size);
    const sha256 = identifier(attachment.sha256, `attachments[${index}].sha256`, /^[a-f0-9]{64}$/, 64);
    if (!data || !Number.isSafeInteger(size) || size < 0 || size !== data.byteLength) throw new Error(`attachments[${index}] size does not match its data.`);
    if (size > MAX_PEER_ATTACHMENT_BYTES) throw new Error(`attachments[${index}] exceeds ${MAX_PEER_ATTACHMENT_BYTES} bytes.`);
    total += size;
    if (total > MAX_PEER_ATTACHMENT_TOTAL_BYTES) throw new Error(`attachments exceed ${MAX_PEER_ATTACHMENT_TOTAL_BYTES} bytes total.`);
    const actualHash = createHash("sha256").update(data).digest("hex");
    if (actualHash !== sha256) throw new Error(`attachments[${index}] SHA-256 does not match its data.`);
    return { filename, content_type: contentType, size, sha256, data };
  });
}

function normalizeMode(value: unknown): "auto" | "queue" | "steer" {
  return value === "steer" || value === "auto" || value === "queue" ? value : "queue";
}

function uniqueKnownWebChats(options: AddonMessagingRuntimeOptions): KnownChat[] {
  const byAgentName = new Map<string, KnownChat>();
  for (const chat of options.listKnownChats()) {
    const chatJid = typeof chat?.chat_jid === "string" ? chat.chat_jid.trim() : "";
    const agentName = normalizeAgentName(chat?.agent_name);
    if (!chatJid.startsWith("web:") || !agentName || chat.archived_at) continue;
    if (!byAgentName.has(agentName)) byAgentName.set(agentName, { ...chat, chat_jid: chatJid, agent_name: agentName });
  }
  return [...byAgentName.values()].sort((a, b) => a.agent_name.localeCompare(b.agent_name));
}

function resolveTarget(
  options: AddonMessagingRuntimeOptions,
  input: AddonMessagingTargetInput,
): { resolution: AddonMessagingTargetResolution; chat?: KnownChat } {
  const targetChatJid = typeof input?.target_chat_jid === "string" ? input.target_chat_jid.trim() : "";
  const targetAgentName = normalizeAgentName(input?.target_agent_name);
  if (Boolean(targetChatJid) === Boolean(targetAgentName)) {
    throw new Error("Provide exactly one of target_agent_name or target_chat_jid.");
  }

  const known = uniqueKnownWebChats(options);
  const found = targetChatJid
    ? known.find((chat) => chat.chat_jid === targetChatJid) ?? null
    : (() => {
      if (targetAgentName === "default") {
        return known.find((chat) => chat.chat_jid === "web:default")
          ?? { chat_jid: "web:default", agent_name: "default", is_active: false };
      }
      const resolved = options.findChatByAgentName(targetAgentName);
      if (!resolved?.chat_jid?.startsWith("web:")) return null;
      return known.find((chat) => chat.chat_jid === resolved.chat_jid)
        ?? { chat_jid: resolved.chat_jid, agent_name: normalizeAgentName(resolved.agent_name), is_active: false };
    })();

  if (!found?.agent_name) return { resolution: { status: "not_found" } };
  return {
    resolution: {
      status: "resolved",
      target_agent_name: found.agent_name,
      active: Boolean(found.is_active),
    },
    chat: found,
  };
}

function buildPeerSourceLabel(source: AddonAuthenticatedPeerSource): {
  sourceAgentName: string;
  sourceDisplayName: string;
  sourceAddress: string;
} {
  const peerAlias = source.peer_alias === undefined
    ? undefined
    : identifier(source.peer_alias, "source.peer_alias", /^[a-z0-9](?:[a-z0-9._-]{0,63})$/, 64);
  const sourceAgentName = source.agent_name === undefined
    ? "inbox"
    : identifier(normalizeAgentName(source.agent_name), "source.agent_name", /^[a-z0-9](?:[a-z0-9_-]{0,63})$/i, 64);
  const sourceDisplayName = optionalString(source.agent_display_name, "source.agent_display_name", 128)
    ?? (peerAlias ? `${peerAlias}!@${sourceAgentName}` : `peer!@${sourceAgentName}`);
  const sourceAddress = source.reply_address === undefined
    ? `${peerAlias ?? identifier(source.peer_fingerprint, "source.peer_fingerprint", /^[A-Za-z0-9_-]+$/, 128)}!@${sourceAgentName}`
    : identifier(source.reply_address, "source.reply_address", /^[^\s!]+![^\s!]+$/, MAX_REPLY_FIELD_CHARS);
  return { sourceAgentName, sourceDisplayName, sourceAddress };
}

function buildPeerMessageBlock(input: {
  source: AddonAuthenticatedPeerSource;
  target: KnownChat;
  body: string;
}): Record<string, unknown> {
  const peerInstanceId = identifier(input.source.peer_instance_id, "source.peer_instance_id", /^[A-Za-z0-9_-]{16,128}$/);
  const peerFingerprint = identifier(input.source.peer_fingerprint, "source.peer_fingerprint", /^[A-Za-z0-9_-]+$/, 128);
  const messageId = identifier(input.source.message_id, "source.message_id", /^[A-Za-z0-9._:-]+$/, 128);
  const peerAlias = input.source.peer_alias === undefined
    ? undefined
    : identifier(input.source.peer_alias, "source.peer_alias", /^[a-z0-9](?:[a-z0-9._-]{0,63})$/, 64);
  const inReplyTo = input.source.in_reply_to === undefined
    ? undefined
    : identifier(input.source.in_reply_to, "source.in_reply_to", /^[A-Za-z0-9._:-]+$/, 128);
  const labels = buildPeerSourceLabel(input.source);
  return {
    type: "peer_message",
    relay: "addon.peer-message",
    source_chat_jid: `remote:${peerInstanceId}`,
    source_agent_name: labels.sourceAgentName,
    source_agent_display_name: labels.sourceDisplayName,
    source_peer_instance_id: peerInstanceId,
    source_peer_fingerprint: peerFingerprint,
    ...(peerAlias ? { source_peer_alias: peerAlias } : {}),
    source_address: labels.sourceAddress,
    target_chat_jid: input.target.chat_jid,
    target_agent_name: input.target.agent_name,
    message_id: messageId,
    ...(inReplyTo ? { in_reply_to: inReplyTo } : {}),
    reply_to: {
      address: labels.sourceAddress,
      message_id: messageId,
    },
    body: input.body,
  };
}

function buildForwardedContent(source: AddonAuthenticatedPeerSource, target: KnownChat, body: string): string {
  const labels = buildPeerSourceLabel(source);
  return [
    `From: ${labels.sourceDisplayName} <addr:${labels.sourceAddress}>`,
    `Reply-To: ${labels.sourceAddress}`,
    `To: @${target.agent_name}`,
    "",
    body,
  ].join("\n");
}

export function createAddonMessagingRuntimeHandlers(options: AddonMessagingRuntimeOptions): AddonMessagingRuntimeHandlers {
  return {
    listAdvertisableAgents(): AddonAdvertisableAgent[] {
      return uniqueKnownWebChats(options).map((chat) => ({
        agent_name: chat.agent_name,
        active: Boolean(chat.is_active),
      }));
    },

    resolveLocalTarget(input): AddonMessagingTargetResolution {
      return resolveTarget(options, input).resolution;
    },

    async deliverPeerMessage(input: AddonPeerMessageDeliveryRequest): Promise<RuntimeAgentMessageResult> {
      const attachments = normalizePeerAttachments(input?.attachments);
      const body = messageContent(input?.content, attachments.length > 0);
      const resolved = resolveTarget(options, input);
      if (resolved.resolution.status !== "resolved" || !resolved.chat) {
        throw new Error("Peer-message target was not found.");
      }
      const block = buildPeerMessageBlock({ source: input.source, target: resolved.chat, body });
      const mediaIds: number[] = [];
      try {
        for (const attachment of attachments) {
          mediaIds.push(createMedia(
            attachment.filename,
            attachment.content_type,
            attachment.data,
            null,
            { size: attachment.size, sha256: attachment.sha256, source: "remote-peer" },
          ));
        }
        const attachmentBlocks = attachments.map((attachment) => ({
          type: attachment.content_type.startsWith("image/") ? "image" : "file",
          name: attachment.filename,
          filename: attachment.filename,
          mime_type: attachment.content_type,
          size: attachment.size,
          sha256: attachment.sha256,
        }));
        return await options.enqueueAgentMessage({
          chatJid: resolved.chat.chat_jid,
          content: buildForwardedContent(input.source, resolved.chat, body),
          contentBlocks: [block, ...attachmentBlocks],
          ...(mediaIds.length ? { mediaIds } : {}),
          mode: normalizeMode(input.mode),
          ...(input.thread_id !== undefined ? { threadId: input.thread_id } : {}),
          source: "addon.peer-message",
          queuedBy: {
            source: "addon.peer-message",
            clientId: identifier(input.source.peer_instance_id, "source.peer_instance_id", /^[A-Za-z0-9_-]{16,128}$/),
          },
        });
      } catch (error) {
        deleteUnreferencedMedia(mediaIds);
        throw error;
      }
    },
  };
}
