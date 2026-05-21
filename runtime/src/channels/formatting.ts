/**
 * channels/formatting.ts – Per-channel formatting instruction hints.
 *
 * Maps channel names to short instructions used to keep each chat session's
 * persistent system prompt aligned with the delivery channel.
 *
 * Consumers:
 *   - agent-pool/session.ts appends channel-specific response-formatting rules
 *     to the session system prompt at creation time.
 *   - router.ts may still consult these hints for tests or fallback plumbing,
 *     but user-turn payloads should stay compact and avoid repeating them.
 */

/** Formatting hints keyed by channel name. */
export const CHANNEL_FORMATTING_HINTS: Record<string, string> = {
  web: "Use Markdown formatting in responses. Tables, headings, and links are allowed. To deliver files, use the attach_file tool on a workspace path; the UI will show a download card automatically. Use attachment:<filename> only if you want an inline embed.",
  whatsapp: "Use WhatsApp formatting only: *bold*, _italic_, • bullets, and ```code``` blocks. Avoid Markdown headings, tables, and links.",
  telegram: "Use Telegram-safe formatting: *bold*, _italic_, bullet lists, and fenced code blocks. Avoid Markdown tables and heavy heading structure.",
};

/**
 * Return the formatting instructions for a given channel, or null if
 * the channel is unknown.
 */
export function getChannelFormattingInstructions(channel?: string | null): string | null {
  if (!channel) return null;
  const key = channel.toLowerCase();
  return CHANNEL_FORMATTING_HINTS[key] ?? null;
}

function normalizeChatJidForPrompt(chatJid?: string | null): string | null {
  const normalized = typeof chatJid === "string" ? chatJid.replace(/[\r\n\t]+/g, " ").trim() : "";
  if (!normalized || /\s/.test(normalized)) return null;
  return normalized.slice(0, 200);
}

export function buildChannelSystemPromptAppendix(channel?: string | null, chatJid?: string | null): string | null {
  const normalizedChannel = typeof channel === "string" ? channel.trim().toLowerCase() : "";
  if (!normalizedChannel) return null;
  const formatting = getChannelFormattingInstructions(normalizedChannel);
  if (!formatting) return null;
  const normalizedChatJid = normalizeChatJidForPrompt(chatJid);
  return [
    "## Active delivery channel",
    `Current channel: ${normalizedChannel}`,
    ...(normalizedChatJid ? [`Current chat: ${normalizedChatJid}`] : []),
    "",
    "Use the current channel and chat to scope replies, tool calls, message lookups, and any follow-up delivery.",
    "",
    "When responding to the user, format for this channel:",
    formatting,
  ].join("\n");
}
