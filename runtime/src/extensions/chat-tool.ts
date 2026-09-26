/**
 * chat-tool – relay a message from the current chat session to another session.
 *
 * The runtime implementation resolves and verifies source/destination identity,
 * then routes a message through the normal inbound-message path for the target
 * chat so queue semantics, follow-up handling, and agent execution remain unchanged.
 */
import { Type } from "typebox";
import type { AgentToolResult, ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { realpathSync, statSync } from "node:fs";
import { getChatJid } from "../core/chat-context.js";
import { readAccessConfig } from "../core/config-access.js";
import { getWorkspaceDir } from "../core/config.js";
import { getChatBranchByChatJid, getMediaById } from "../db.js";
import { localChatAddressFromSelector, parseChatAddress } from "./chat-address.js";
import {
  getChatTransportDirectories,
  sendViaChatTransport,
  setLocalChatTransport,
  type ChatTransportAttachment,
  type ChatTransportResult,
} from "./chat-transport-registry.js";

export type ChatRelayMode = "auto" | "queue" | "steer";

export type ChatRelayRequest = {
  source_chat_jid: string;
  source_agent_name?: string;
  source_agent_display_name?: string;
  target_chat_jid?: string;
  target_agent_name?: string;
  content: string;
  mode: ChatRelayMode;
  attachments?: ChatTransportAttachment[];
};

export type ChatRelayResult = {
  status?: string;
  relayed?: boolean;
  source_chat_jid: string;
  source_agent_name?: string;
  source_agent_display_name?: string;
  target_chat_jid: string;
  target_agent_name?: string;
  target_agent_display_name?: string;
  reply_to?: Record<string, unknown>;
  source_session_tree?: Record<string, unknown>;
  target_session_tree?: Record<string, unknown>;
  row_id?: number | null;
  queued?: string;
  thread_id?: number | null;
  created?: boolean;
};

export type ChatToolRelayFn = (request: ChatRelayRequest) => Promise<ChatRelayResult>;

/** Install or remove the built-in local relay behind the generic transport seam. */
export function setChatToolRelayFn(fn: ChatToolRelayFn | undefined): void {
  if (!fn) {
    setLocalChatTransport(undefined);
    return;
  }

  setLocalChatTransport({
    id: "local",
    async send(request) {
      if (request.address.kind !== "local") throw new Error("Local chat transport received a non-local address.");
      const result = await fn({
        source_chat_jid: request.source_chat_jid,
        ...(request.address.targetKind === "chat"
          ? { target_chat_jid: request.address.target }
          : { target_agent_name: request.address.target }),
        content: request.content,
        mode: request.mode,
        attachments: request.attachments,
      });
      return result;
    },
  });
}

const ChatSchema = Type.Object({
  action: Type.Optional(Type.String({ enum: ["send", "directory"], description: "Send a message (default) or list immediately usable local and remote addresses." })),
  target_address: Type.Optional(Type.String({ description: "Destination address from action=directory. Local example: '@research'. Remote examples: 'lab!inbox' or 'lab!@research'. Mutually exclusive with target_chat_jid and target_agent_name." })),
  target_chat_jid: Type.Optional(Type.String({ description: "Destination chat JID. Fallback only; prefer target_agent_name/@alias so the runtime can resolve the internal session tree." })),
  target_agent_name: Type.Optional(Type.String({ description: "Preferred destination branch handle/alias, e.g. 'research' or '@research'. Resolves through the internal session tree mapping." })),
  content: Type.Optional(Type.String({ description: "Message body. Optional when files or media_ids are attached." })),
  files: Type.Optional(Type.Array(Type.String(), { description: "Workspace files to transfer. Remote transports send bounded raw binary data, never base64 in message text." })),
  media_ids: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }), { description: "Existing local attachment IDs to transfer." })),
  mode: Type.Optional(Type.Union([
    Type.Literal("auto"),
    Type.Literal("queue"),
    Type.Literal("steer"),
  ], { description: "Use explicit 'steer' for priority/blocking messages: ownership handoffs or confirmations, blockers, stop/wait requests, and restart safety/idle coordination. Use 'queue' only for non-urgent updates that can wait until active work finishes; never queue a reply another agent needs before proceeding. 'auto' uses standard request handling. Defaults: local 'steer', remote 'queue'. Remote sends must use a mode advertised by action='directory'." })),
  idempotency_key: Type.Optional(Type.String({ description: "Optional transport idempotency key. Used by transports that support durable retry deduplication." })),
  in_reply_to: Type.Optional(Type.String({ description: "Optional opaque transport reply token or message id." })),
});

export type ChatToolParams = {
  action?: "send" | "directory";
  target_address?: string;
  target_chat_jid?: string;
  target_agent_name?: string;
  content?: string;
  files?: string[];
  media_ids?: number[];
  mode?: ChatRelayMode;
  idempotency_key?: string;
  in_reply_to?: string;
};

const HINT = [
  "## Cross-session chat",
  "Use the chat tool when one agent session needs to message another session.",
  "Prefer target_agent_name with an @alias (for example @research). Use target_chat_jid only as a fallback when no alias exists.",
  "Call `chat({ action: 'directory' })` before remote delivery when you do not already have an exact address. Use only addresses and modes returned there.",
  "Use target_address for an explicit address. Local aliases use @name; remote addresses are one hop such as peer!inbox or peer!@agent. Multi-hop bang paths are rejected.",
  "Attach workspace files with `files` or existing attachments with `media_ids`; do not paste binary/base64 into content. Remote transports enforce their advertised limits.",
  "Use a stable idempotency_key when retrying an uncertain remote text or file delivery.",
  "@aliases are resolved through the internal Pi chat-branch/session-tree registry before delivery; do not use opaque session IDs when an alias is available.",
  "Sender identity is derived from the current chat session and cannot be supplied by the caller; destination identity is resolved before delivery.",
  "The destination receives the message through its normal inbound-message path with structured reply-to metadata.",
  "Use explicit mode='steer' for priority or blocking communications: ownership handoffs/confirmations, blockers, stop/wait requests, and restart safety/idle coordination. Steering lets a busy recipient receive the message during its current turn.",
  "Use mode='queue' only for non-urgent updates that can wait until active work finishes. Never queue a reply another agent needs before proceeding; avoid repeated confirmations after ownership is accepted.",
  "Defaults are mode='steer' for local sends and mode='queue' for remote sends; mode='auto' uses standard request handling. Remote sends must use a mode advertised by action='directory'. If remote steering is unavailable, report that limitation rather than treating a queued send as immediate delivery.",
].join("\n");

export function buildChatTransportDirectoryHint(directories: Awaited<ReturnType<typeof getChatTransportDirectories>>): string {
  const entries = directories.flatMap((directory) => directory.entries);
  if (readAccessConfig().mode !== "single-user") {
    return ["## Owner-local session directory", "Only read-only discovery is available in this access mode. Cross-session sends and remote transports are disabled until owner-bound delivery is integrated.",
      ...entries.map(entry => `- ${entry.address} — ${entry.label} (discovery only)`)].join("\n");
  }
  if (entries.length === 0) return `${HINT}\nNo remote chat addresses are currently available.`;
  const lines = entries.map((entry) => {
    const filePolicy = entry.attachments?.enabled
      ? `; files: up to ${entry.attachments.max_files} × ${Math.round(entry.attachments.max_file_bytes / 1024 / 1024)} MiB`
      : "; files: disabled";
    return `- ${entry.address} — ${entry.label}; modes: ${entry.modes.join(", ")}; ${entry.status}${filePolicy}`;
  });
  return `${HINT}\n\n### Available remote addresses\n${lines.join("\n")}`;
}

const MAX_CHAT_FILES = 4;
const MAX_CHAT_FILE_BYTES = 16 * 1024 * 1024;
const MAX_CHAT_TOTAL_BYTES = 32 * 1024 * 1024;

function err(message: string): AgentToolResult<Record<string, unknown>> {
  return {
    content: [{ type: "text", text: message }],
    details: { relayed: false, error: message },
  };
}

function normalizeTargetAgentName(value: string | undefined): string {
  return String(value || "").trim().replace(/^@+/, "").trim();
}

function resolveWorkspaceFile(path: string): string {
  const workspace = realpathSync(getWorkspaceDir());
  const lexical = resolve(workspace, path);
  const rel = relative(workspace, lexical);
  if (rel.startsWith("..") || rel.startsWith("/") || isAbsolute(rel)) throw new Error(`Chat file must be inside the workspace: ${path}`);
  const canonical = realpathSync(lexical);
  const canonicalRel = relative(workspace, canonical);
  if (canonicalRel.startsWith("..") || canonicalRel.startsWith("/") || isAbsolute(canonicalRel)) throw new Error(`Chat file escapes the workspace: ${path}`);
  if (!statSync(canonical).isFile()) throw new Error(`Chat file is not a regular file: ${path}`);
  return canonical;
}

async function attachmentFromPath(path: string): Promise<ChatTransportAttachment> {
  const resolved = resolveWorkspaceFile(path);
  const file = Bun.file(resolved);
  const data = new Uint8Array(await file.arrayBuffer());
  return {
    filename: basename(resolved),
    content_type: (file.type || "application/octet-stream").split(";", 1)[0].toLowerCase(),
    size: data.byteLength,
    sha256: createHash("sha256").update(data).digest("hex"),
    data,
  };
}

function attachmentFromMediaId(id: number): ChatTransportAttachment {
  const media = getMediaById(id);
  if (!media) throw new Error(`Chat attachment ${id} was not found.`);
  return {
    filename: media.filename || `attachment-${id}`,
    content_type: media.content_type || "application/octet-stream",
    size: media.data.byteLength,
    sha256: createHash("sha256").update(media.data).digest("hex"),
    data: media.data,
    source_media_id: id,
  };
}

async function prepareChatAttachments(params: ChatToolParams): Promise<ChatTransportAttachment[]> {
  const files = Array.isArray(params.files) ? params.files : [];
  const mediaIds = Array.isArray(params.media_ids) ? params.media_ids : [];
  if (files.length + mediaIds.length > MAX_CHAT_FILES) throw new Error(`Chat supports at most ${MAX_CHAT_FILES} attachments per message.`);
  const attachments = [...await Promise.all(files.map(attachmentFromPath)), ...mediaIds.map(attachmentFromMediaId)];
  let total = 0;
  for (const attachment of attachments) {
    if (attachment.size > MAX_CHAT_FILE_BYTES) throw new Error(`Chat attachment ${attachment.filename} exceeds ${MAX_CHAT_FILE_BYTES / 1024 / 1024} MiB.`);
    total += attachment.size;
  }
  if (total > MAX_CHAT_TOTAL_BYTES) throw new Error(`Chat attachments exceed ${MAX_CHAT_TOTAL_BYTES / 1024 / 1024} MiB total.`);
  return attachments;
}

function describeTarget(result: ChatTransportResult): string {
  if (result.target_agent_name && result.target_chat_jid) {
    return `@${result.target_agent_name} (${result.target_chat_jid})`;
  }
  return result.target_address
    ? String(result.target_address)
    : result.target_chat_jid
      ? String(result.target_chat_jid)
      : result.target_agent_name
        ? `@${result.target_agent_name}`
        : "destination";
}

/** Built-in tool for cross-session chat relay. */
export const chatTool: ExtensionFactory = (pi: ExtensionAPI) => {
  pi.on("before_agent_start", async (event) => {
    let hint: string;
    try { hint = buildChatTransportDirectoryHint(await getChatTransportDirectories()); }
    catch { hint = readAccessConfig().mode === "single-user"
      ? `${HINT}\nRemote directory refresh failed; call chat action=directory before remote delivery.`
      : "## Owner-local session directory\nNo authorised directory is available. Cross-session sends and remote transports are disabled."; }
    return { systemPrompt: `${event.systemPrompt}\n\n${hint}` };
  });

  pi.registerTool({
    name: "chat",
    label: "chat",
    description: "List usable chat destinations or send text and files to a local session or installed one-hop transport. Use explicit mode='steer' for priority/blocking messages (handoffs, confirmations, blockers, stop/wait and restart coordination); use mode='queue' only for non-urgent updates. Never queue a reply the recipient needs before proceeding. Remote modes must be advertised by action='directory'.",
    promptSnippet: "chat: discover destinations with action='directory'; send text/files with mode='steer' for priority/blocking coordination, or 'queue' only for non-urgent updates. Respect advertised remote modes.",
    parameters: ChatSchema,
    async execute(_toolCallId, params: ChatToolParams) {
      if ((params.action || "send") === "directory") {
        const directories = await getChatTransportDirectories();
        const entries = directories.flatMap((directory) => directory.entries);
        const text = entries.length
          ? [readAccessConfig().mode === "single-user" ? "Available remote chat addresses:" : "Owner-local sessions (discovery only; sends disabled):", ...entries.map((entry) => `- ${entry.address} — ${entry.label}; modes=${entry.modes.join(",")}; status=${entry.status}${entry.attachments?.enabled ? `; files≤${entry.attachments.max_files}, ${Math.round(entry.attachments.max_file_bytes / 1024 / 1024)} MiB each` : "; files=disabled"}`)].join("\n")
          : "No remote chat addresses are currently available. Pair and configure a transport in Settings first.";
        return { content: [{ type: "text", text }], details: { action: "directory", directories, entries } };
      }

      if (readAccessConfig().mode !== "single-user") return err("Cross-session sends are disabled until owner-bound queue delivery is available.");
      const sourceChatJid = getChatJid("").trim();
      if (!sourceChatJid) return err("Cannot determine the source chat. The chat tool requires an active chat context.");

      const targetAddress = params.target_address?.trim() || "";
      const targetChatJid = params.target_chat_jid?.trim() || "";
      const targetAgentName = normalizeTargetAgentName(params.target_agent_name);
      const selectorCount = Number(Boolean(targetAddress)) + Number(Boolean(targetChatJid)) + Number(Boolean(targetAgentName));
      if (selectorCount === 0) {
        return err("Provide target_address, target_agent_name (@alias preferred), or target_chat_jid.");
      }
      if (selectorCount > 1) {
        return err("Provide only one target selector: target_address, target_chat_jid, or target_agent_name.");
      }

      const content = params.content?.trim() || "";

      try {
        const attachments = await prepareChatAttachments(params);
        if (!content && attachments.length === 0) return err("Provide content, files, or media_ids.");
        const address = targetAddress
          ? parseChatAddress(targetAddress)
          : localChatAddressFromSelector({ targetChatJid, targetAgentName });
        const sourceBranch = getChatBranchByChatJid(sourceChatJid);
        const result = await sendViaChatTransport({
          source_chat_jid: sourceChatJid,
          ...(sourceBranch?.agent_name ? { source_agent_name: sourceBranch.agent_name } : {}),
          address,
          content,
          mode: params.mode || (targetAddress.includes("!") ? "queue" : "steer"),
          ...(attachments.length ? { attachments } : {}),
          ...(params.idempotency_key?.trim() ? { idempotency_key: params.idempotency_key.trim() } : {}),
          ...(params.in_reply_to?.trim() ? { in_reply_to: params.in_reply_to.trim() } : {}),
        }, { annotate: Boolean(targetAddress) });

        const target = describeTarget(result);
        const attachmentNote = attachments.length ? ` with ${attachments.length} attachment${attachments.length === 1 ? "" : "s"}` : "";
        const statusText = result.queued === "followup"
          ? `Relayed to ${target}${attachmentNote} and queued as a follow-up.`
          : `Relayed to ${target}${attachmentNote}.`;

        return {
          content: [{ type: "text", text: statusText }],
          details: {
            tool: "chat",
            relayed: true,
            ...result,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || "Cross-session chat relay failed.");
        return err(message || "Cross-session chat relay failed.");
      }
    },
  });
};
