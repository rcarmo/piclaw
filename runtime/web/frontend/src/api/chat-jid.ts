/**
 * chat-jid.ts — Shared chat JID resolution from URL params.
 */

import { safeGetItem, safeSetItem } from "../utils/storage";

const LAST_CHAT_KEY = "piclaw:last-chat-jid";

/** Get the active chat_jid from URL params, falling back to last persisted, then "web:default". */
export function getChatJid(): string {
  if (typeof window === "undefined") return "web:default";
  const params = new URLSearchParams(window.location.search);
  return params.get("chat_jid") || safeGetItem(LAST_CHAT_KEY) || "web:default";
}

/** Persist the active chat_jid so it can be restored on fresh load. */
export function persistChatJid(jid: string): void {
  safeSetItem(LAST_CHAT_KEY, jid);
}

/** Build the message POST URL for the current chat. */
export function getMessageUrl(): string {
  const chatJid = getChatJid();
  return `/agent/${encodeURIComponent(chatJid)}/message?chat_jid=${encodeURIComponent(chatJid)}`;
}

/** Build a URL with ?chat_jid= (and optional extra params) for the current chat. */
export function buildChatUrl(path: string, params?: Record<string, string>): string {
  const qs = new URLSearchParams({ chat_jid: getChatJid(), ...params });
  return `${path}?${qs}`;
}

/** Alias for buildChatUrl — matches upstream API name (chat_jid appended last). */
export function buildChatScopedUrl(path: string, params?: Record<string, number | string>): string {
  const qs = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  }
  qs.set("chat_jid", getChatJid());
  return `${path}?${qs}`;
}
