/**
 * channels/web/agent-status.ts – Agent status/context/models endpoint helpers.
 */

import type { WebAgentBufferEntry } from "./agent-buffers.js";
import { appendServerTiming, measureAsync, measureSync } from "../http/server-timing.js";

/** Context contract used by web agent status/context/model endpoint handlers. */
export interface AgentStatusContext {
  defaultChatJid: string;
  json(payload: unknown, status?: number): Response;
  getAgentStatus(chatJid: string): Record<string, unknown> | null;
  getBuffer(turnId: string, panel: "thought" | "draft"): WebAgentBufferEntry | undefined;
  getContextUsageForChat(
    chatJid: string
  ): Promise<{ tokens: number | null; contextWindow: number; percent: number | null } | null>;
  getAvailableModels(chatJid: string): Promise<unknown>;
}

function resolveChatJid(req: Request, defaultChatJid: string): string {
  const url = new URL(req.url);
  return (url.searchParams.get("chat_jid") || defaultChatJid).trim() || defaultChatJid;
}

/** Return active/idle agent status plus streamed thought/draft buffers when available. */
export function handleAgentStatusRequest(req: Request, ctx: AgentStatusContext): Response {
  const { result, durationMs } = measureSync(() => {
    const chatJid = resolveChatJid(req, ctx.defaultChatJid);
    const status = ctx.getAgentStatus(chatJid);
    if (!status) {
      return ctx.json({ status: "idle", data: null });
    }

    const turnId = (status.turn_id || status.turnId) as string | undefined;
    let thought: { text: string; totalLines: number } | undefined;
    let draft: { text: string; totalLines: number } | undefined;
    if (turnId) {
      const tb = ctx.getBuffer(turnId, "thought");
      if (tb) thought = { text: tb.text, totalLines: tb.totalLines };
      const db = ctx.getBuffer(turnId, "draft");
      if (db) draft = { text: db.text, totalLines: db.totalLines };
    }

    return ctx.json({ status: "active", data: status, thought, draft });
  });
  return appendServerTiming(result, {
    name: "agent_status",
    durationMs,
  });
}

/** Return context window usage metrics for the requested/default chat. */
export async function handleAgentContextRequest(req: Request, ctx: AgentStatusContext): Promise<Response> {
  const { result, durationMs } = await measureAsync(async () => {
    const chatJid = resolveChatJid(req, ctx.defaultChatJid);
    const usage = await ctx.getContextUsageForChat(chatJid);
    if (!usage) {
      return ctx.json({ tokens: null, contextWindow: null, percent: null });
    }

    return ctx.json({
      tokens: usage.tokens,
      contextWindow: usage.contextWindow,
      percent: usage.percent,
    });
  });
  return appendServerTiming(result, {
    name: "agent_context",
    durationMs,
  });
}

/** Return available model options for the requested/default chat. */
export async function handleAgentModelsRequest(req: Request, ctx: AgentStatusContext): Promise<Response> {
  const { result, durationMs } = await measureAsync(async () => {
    const chatJid = resolveChatJid(req, ctx.defaultChatJid);
    const payload = await ctx.getAvailableModels(chatJid);
    return ctx.json(payload, 200);
  });
  return appendServerTiming(result, {
    name: "agent_models",
    durationMs,
  });
}
