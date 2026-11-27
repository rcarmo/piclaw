import type { Message } from "@earendil-works/pi-ai";
import type { ContextView } from "@earendil-works/pi-durable";
import { A2UI_METADATA_HEADING } from "../../src/channels/web/a2ui/transport-metadata.js";

type Source = { chatJid: string; sourceId: string; conversationId: number };

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 2048 && value === value.trim();
}

/** Project an ephemeral model view before generation or summary serialization.
 * Only the host callback can prove the exact envelope against the source row. */
export function projectA2uiContext(view: ContextView, project?: (source: Source, content: string) => string): ContextView {
  if (!project || view.entries.length !== view.contributions.length) return view;

  const candidates = new Map<Message, { index: number; source: Source; content: string }>();
  for (const [index, entry] of view.entries.entries()) {
    if (entry.kind !== "host.accepted" || !entry.model?.length) continue;
    const data = entry.data as Partial<Record<keyof Source, unknown>> | undefined;
    if (!data || typeof data !== "object" || Array.isArray(data)) continue;
    const { chatJid, sourceId, conversationId } = data;
    if (!isIdentifier(chatJid) || !chatJid.startsWith("web:") || chatJid.length === 4 || !isIdentifier(sourceId) ||
        !Number.isSafeInteger(entry.conversationId) || entry.conversationId <= 0 || conversationId !== entry.conversationId) continue;
    for (const message of view.contributions[index]!) {
      if (message.role === "user" && typeof message.content === "string" &&
          message.content.includes(A2UI_METADATA_HEADING) && entry.model.includes(message)) {
        candidates.set(message, { index, source: { chatJid, sourceId, conversationId: entry.conversationId }, content: message.content });
      }
    }
  }
  if (!candidates.size) return view;

  // An unrelated entry (even an omitted one) may share an original reference,
  // or an edit may contribute it. One object must not stand for two sources.
  for (const [index, entry] of view.entries.entries()) {
    for (const messages of [entry.model ?? [], view.contributions[index]!]) {
      for (const message of messages) {
        const candidate = candidates.get(message);
        if (candidate && candidate.index !== index) candidates.delete(message);
      }
    }
    for (const edit of entry.edits ?? []) {
      if (edit.action === "replace") for (const message of edit.messages) candidates.delete(message);
    }
  }

  const replacements = new Map<Message, Message>();
  for (const [message, { source, content }] of candidates) {
    if (message.role !== "user") continue;
    const projected = project(source, content);
    if (projected !== content) replacements.set(message, { ...message, content: projected });
  }
  if (!replacements.size) return view;

  const replace = (message: Message) => replacements.get(message) ?? message;
  return {
    ...view,
    contributions: view.contributions.map(messages => messages.some(message => replacements.has(message)) ? messages.map(replace) : messages),
    messages: view.messages.map(replace),
  };
}
