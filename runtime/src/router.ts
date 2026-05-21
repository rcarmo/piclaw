/**
 * router.ts – Message routing and formatting for the agent pipeline.
 *
 * Responsible for:
 *   - Detecting the channel type (web, whatsapp) from a chat JID.
 *   - Formatting arrays of NewMessage objects into a compact transcript for the agent prompt.
 *   - Stripping `<internal>…</internal>` tags from agent output before delivery.
 *   - Applying channel-specific output escaping (HTML entities for web).
 *
 * Consumers:
 *   - runtime/message-loop.ts calls formatMessages() to build the user-turn
 *     content for the agent.
 *   - agent-pool.ts calls formatOutbound() / stripInternalTags() when
 *     delivering the agent's response to channels.
 *   - channels/web.ts and channels/whatsapp.ts use detectChannel() to
 *     determine formatting rules.
 *   - agent-control uses detectChannel() to scope command execution.
 */

import { isAbsolute, resolve } from "node:path";

import { WORKSPACE_DIR } from "./core/config.js";
import type { NewMessage } from "./types.js";

/** Recognised channel types. */
export type ChatChannel = "web" | "whatsapp" | "telegram" | "unknown";

/** Infer the channel from a chat JID string. */
export function detectChannel(chatJid: string | null | undefined): ChatChannel {
  if (!chatJid) return "unknown";
  if (chatJid.startsWith("web:")) return "web";
  if (chatJid.startsWith("telegram:")) return "telegram";
  if (chatJid.includes("@s.whatsapp.net") || chatJid.endsWith("@g.us")) return "whatsapp";
  return "unknown";
}

/** Escape special XML characters in a string for safe embedding in XML tags. */
export function escapeXml(s: string): string {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function normalizePromptHeaderValue(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizePromptSenderName(message: NewMessage): string {
  const senderName = normalizePromptHeaderValue(message.sender_name);
  if (senderName) return senderName;
  const sender = normalizePromptHeaderValue(message.sender);
  return sender || "User";
}

function normalizePromptScreenHint(message: NewMessage): string {
  const raw = normalizePromptHeaderValue(message.screen_hint).toLowerCase();
  if (!raw) return "";
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(raw)) return "";
  return raw;
}

function normalizePromptChatJid(value: unknown): string {
  const raw = normalizePromptHeaderValue(value);
  if (!raw) return "";
  if (/\s/.test(raw)) return "";
  return raw.slice(0, 200);
}

function inferPromptChatJid(messages: NewMessage[]): string {
  const chatJids = Array.from(new Set(messages.map((message) => normalizePromptChatJid(message.chat_jid)).filter(Boolean)));
  return chatJids.length === 1 ? chatJids[0] : "";
}

function absolutizeWorkspaceReference(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (/^(?:[a-z][a-z0-9+.-]*:|attachment:)/i.test(trimmed)) return trimmed;
  if (isAbsolute(trimmed)) return trimmed;
  return resolve(WORKSPACE_DIR, trimmed.replace(/^\.\//, ""));
}

function absolutizePromptFileReferenceBlocks(content: string): string {
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let inReferenceBlock = false;
  return lines.map((line) => {
    const header = line.trim();
    if (/^(?:files|folders):$/i.test(header)) {
      inReferenceBlock = true;
      return line;
    }
    if (inReferenceBlock) {
      const match = line.match(/^(\s*-\s+)(.+?)\s*$/);
      if (match) return `${match[1]}${absolutizeWorkspaceReference(match[2] ?? "")}`;
      if (header === "") return line;
      inReferenceBlock = false;
    }
    return line;
  }).join("\n");
}

function formatPromptMessage(message: NewMessage): string {
  const sender = normalizePromptSenderName(message);
  const timestamp = normalizePromptHeaderValue(message.timestamp);
  const screenHint = normalizePromptScreenHint(message);
  const screenSuffix = screenHint ? ` (from ${screenHint})` : "";
  const content = typeof message.content === "string" ? absolutizePromptFileReferenceBlocks(message.content) : "";
  const header = timestamp ? `${sender} @ ${timestamp}${screenSuffix}:` : `${sender}${screenSuffix}:`;
  if (!content) return header;
  const indented = content.split("\n").map((line) => `  ${line}`).join("\n");
  return `${header}\n${indented}`;
}

/**
 * Serialise an array of NewMessage objects into a compact transcript block
 * for the agent prompt. Includes channel metadata when the channel is known,
 * but keeps stable formatting instructions in persistent session context.
 */
export function formatMessages(messages: NewMessage[], channel?: ChatChannel, chatJid?: string): string {
  const knownChannel = channel && channel !== "unknown" ? channel : undefined;
  const knownChatJid = normalizePromptChatJid(chatJid) || inferPromptChatJid(messages);
  const sections: string[] = [];
  if (knownChannel) sections.push(`Channel: ${knownChannel}`);
  if (knownChatJid) sections.push(`Chat: ${knownChatJid}`);
  if (messages.length > 0) {
    const body = messages.map((message) => formatPromptMessage(message)).join("\n\n");
    sections.push(messages.length > 1 ? `Messages:\n${body}` : body);
  }
  return sections.join("\n\n");
}

const INTERNAL_OPEN_PLACEHOLDER = "\u0000PICLAW_INTERNAL_OPEN\u0000";
const INTERNAL_CLOSE_PLACEHOLDER = "\u0000PICLAW_INTERNAL_CLOSE\u0000";

function protectInternalTagsInsideMarkdownCode(text: string): string {
  let result = "";
  let i = 0;

  while (i < text.length) {
    if (text[i] !== "`") {
      result += text[i];
      i += 1;
      continue;
    }

    let tickCount = 1;
    while (i + tickCount < text.length && text[i + tickCount] === "`") tickCount += 1;
    const delimiter = "`".repeat(tickCount);
    const closeIndex = text.indexOf(delimiter, i + tickCount);

    if (closeIndex < 0) {
      result += text.slice(i);
      break;
    }

    const segment = text.slice(i, closeIndex + tickCount)
      .replaceAll("<internal>", INTERNAL_OPEN_PLACEHOLDER)
      .replaceAll("</internal>", INTERNAL_CLOSE_PLACEHOLDER);
    result += segment;
    i = closeIndex + tickCount;
  }

  return result;
}

function restoreProtectedInternalTagPlaceholders(text: string): string {
  return text
    .replaceAll(INTERNAL_OPEN_PLACEHOLDER, "<internal>")
    .replaceAll(INTERNAL_CLOSE_PLACEHOLDER, "</internal>");
}

/**
 * Remove `<internal>…</internal>` blocks from agent output.
 * Content inside these tags is logged but not sent to the user.
 *
 * Handles nested tags and malformed blocks by treating <internal> as a
 * depth counter and discarding anything inside. Unclosed tags discard the
 * remainder of the string (safer than leaking hidden content).
 *
 * Literal tag examples inside Markdown code spans/fences are preserved so the
 * agent can explain the control markup without the explanation disappearing.
 */
export function stripInternalTags(text: string): string {
  if (!text) return "";
  const protectedText = protectInternalTagsInsideMarkdownCode(text);
  let result = "";
  let depth = 0;
  let i = 0;
  while (i < protectedText.length) {
    if (protectedText.startsWith("<internal>", i)) {
      depth += 1;
      i += "<internal>".length;
      continue;
    }
    if (protectedText.startsWith("</internal>", i)) {
      if (depth > 0) depth -= 1;
      i += "</internal>".length;
      continue;
    }
    if (depth === 0) {
      result += protectedText[i];
    }
    i += 1;
  }
  return restoreProtectedInternalTagPlaceholders(result).trim();
}

/**
 * Prepare agent output text for delivery on the given channel.
 * Strips internal tags and applies HTML-entity escaping for the web channel.
 */
export function formatOutbound(rawText: string, channel?: ChatChannel): string {
  const text = stripInternalTags(rawText);
  if (!text) return "";
  if (channel === "web") {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  return text;
}
