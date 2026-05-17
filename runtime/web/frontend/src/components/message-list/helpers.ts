// Shared helper/utility functions for message-list modules

import type { ContentBlock, Interaction } from "./types";
import { formatRelativeTime } from "../../utils/format";

export function relativeTime(isoDate: string): string {
  return formatRelativeTime(isoDate);
}

export function getBlockKey(block: ContentBlock, index: number): string {
  return block.id ?? `block-${index}`;
}

export function normalizePost(raw: Record<string, unknown>): Interaction {
  const data =
    raw.data && typeof raw.data === "object"
      ? (raw.data as Record<string, unknown>)
      : undefined;
  const rawType = raw.type ?? data?.type;

  return {
    id: Number(raw.id ?? 0),
    type: (rawType === "user" || rawType === "user_message"
      ? "user"
      : "agent") as "user" | "agent",
    content: String(raw.content ?? data?.content ?? ""),
    content_blocks: (raw.content_blocks ?? data?.content_blocks) as
      | ContentBlock[]
      | undefined,
    media_ids: (raw.media_ids ?? data?.media_ids) as number[] | undefined,
    created_at: String(raw.created_at ?? raw.timestamp ?? ""),
    data,
  };
}

export function mergeInteractions(
  existing: Interaction[],
  incoming: Interaction[]
): Interaction[] {
  const byId = new Map<number, Interaction>();
  for (const msg of existing) {
    byId.set(msg.id, msg);
  }
  for (const msg of incoming) {
    byId.set(msg.id, msg);
  }
  return Array.from(byId.values()).sort((a, b) => a.id - b.id);
}
