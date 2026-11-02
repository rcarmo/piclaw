/** Outgoing web message writes and dashboard publication. */
import type { InteractionRow } from "../../db.js";
import { postDashboardWidget as postDashboardWidgetMessage } from "./dashboard-widget.js";

/** Supported send forms; numeric thread IDs still have live callers. */
export type SendMessageOptions =
  | number
  | null
  | {
      threadId?: number | null;
      forceRoot?: boolean;
      /** Truthful reply-delivery failure; does not change command acceptance. */
      requirePersistence?: boolean;
      /** Host-only authority and cancellation; never copied from request JSON. */
      authorise?: (phase?: "before" | "after") => void;
      signal?: AbortSignal;
      source?: string;
      mediaIds?: number[];
      contentBlocks?: Array<Record<string, unknown>>;
    };

export interface WebMessageWriteServiceDeps {
  admitMessage(
    chatJid: string,
    content: string,
    isBot: boolean,
    mediaIds: number[],
    options: { threadId?: number; threadToSelf?: boolean; contentBlocks?: unknown[]; isTerminalAgentReply?: boolean },
    authorise?: (phase?: "before" | "after") => void, signal?: AbortSignal
  ): Promise<InteractionRow | null>;
  broadcastAgentResponse(interaction: InteractionRow): void;
}

export class WebMessageWriteService {
  constructor(private readonly deps: WebMessageWriteServiceDeps) {}

  async sendMessage(chatJid: string, text: string, options?: SendMessageOptions): Promise<void> {
    const normalized = typeof options === "number" || options === null ? { threadId: options ?? null } : (options ?? {});
    const threadId = normalized.threadId ?? null;
    const forceRoot = Boolean(normalized.forceRoot);
    const mediaIds = Array.isArray(normalized.mediaIds) ? normalized.mediaIds.filter(id => Number.isFinite(id) && id > 0) : [];
    const contentBlocks = Array.isArray(normalized.contentBlocks)
      ? normalized.contentBlocks.filter(block => block && typeof block === "object") : undefined;
    const interaction = await this.deps.admitMessage(chatJid, text, true, mediaIds, {
      ...(threadId !== null ? { threadId } : {}),
      ...(forceRoot && !threadId ? { threadToSelf: true } : {}),
      ...(contentBlocks && contentBlocks.length ? { contentBlocks } : {}),
    }, normalized.authorise, normalized.signal);
    if (!interaction) {
      if (typeof options === "object" && options?.requirePersistence) throw new Error("Agent reply could not be persisted.");
      return;
    }
    // The store resolved root threading in its original transaction, before any receipt.
    if (forceRoot && !threadId) interaction.data.thread_id = interaction.id;
    this.deps.broadcastAgentResponse(interaction);
  }

  async postDashboardWidget(
    chatJid: string,
    options?: { threadId?: number | null; text?: string; widgetId?: string },
  ): Promise<void> {
    await postDashboardWidgetMessage(this, {
      chatJid,
      threadId: options?.threadId,
      text: options?.text,
      widgetId: options?.widgetId,
    });
  }
}
