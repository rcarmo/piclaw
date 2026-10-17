/**
 * web/state-api.ts — Read-only state snapshot and SSE feed for native widgets.
 */

import { getIdentityConfig, getOrCreateWebWidgetToken, getWebRuntimeConfig } from "../../core/config.js";
import { safeEqual } from "./auth/auth.js";
import { publicContextUsage } from "./context-usage.js";
import type { WebChannelLike } from "./core/web-channel-contracts.js";

export const PICLAW_STATE_SCHEMA = "piclaw.state.v1";
const STATE_EVENT_NAME = PICLAW_STATE_SCHEMA;
const STATE_EVENTS_INTERVAL_MS = 5_000;
const STATE_EVENTS_HEARTBEAT_MS = 30_000;

interface WidgetStateChat {
  chat_jid: string;
  agent_name: string | null;
  model: string | null;
  session_id: string | null;
  session_name: string | null;
  branch_id: string | null;
  root_chat_jid: string | null;
  is_active: boolean;
  has_side_session: boolean;
  queued_followups: number;
  status: Record<string, unknown> | null;
  context: Record<string, unknown> | null;
}

export interface PiclawStateSnapshot {
  schema: typeof PICLAW_STATE_SCHEMA;
  generated_at: string;
  instance: {
    assistant_name: string;
    pid: number;
    platform: NodeJS.Platform;
    sse_clients: number;
  };
  chats: WidgetStateChat[];
}

function readBearerToken(req: Request): string {
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

export function isAuthorizedWidgetStateRequest(req: Request): boolean {
  const expected = (getWebRuntimeConfig().widgetToken || getOrCreateWebWidgetToken()).trim();
  const actual = readBearerToken(req);
  return Boolean(expected && actual && safeEqual(actual, expected));
}

function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "WWW-Authenticate": 'Bearer realm="piclaw-state"',
      "Cache-Control": "no-store",
    },
  });
}

function methodNotAllowedResponse(): Response {
  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Allow: "GET",
      "Cache-Control": "no-store",
    },
  });
}

export async function buildPiclawStateSnapshot(channel: WebChannelLike): Promise<PiclawStateSnapshot> {
  const identity = getIdentityConfig();
  const activeChats = channel.agentPool.listActiveChats();
  const chats: WidgetStateChat[] = [];

  for (const chat of activeChats) {
    const record = chat as unknown as Record<string, unknown>;
    const chatJid = String(record.chat_jid || "").trim();
    if (!chatJid) continue;
    const runtimeContext = await channel.agentPool.getContextUsageForChat(chatJid).catch(() => null);
    const storedContext = channel.getContextUsage(chatJid);
    const currentGeneration = (typeof channel.agentPool.getSessionGenerationForChat === "function"
      ? channel.agentPool.getSessionGenerationForChat(chatJid)
      : null)
      ?? (typeof record.session_id === "string" ? record.session_id : null)
      ?? (typeof runtimeContext?.sessionGeneration === "string" ? runtimeContext.sessionGeneration : null);
    const runtimeGeneration = typeof runtimeContext?.sessionGeneration === "string" ? runtimeContext.sessionGeneration : null;
    const storedGeneration = typeof storedContext?.sessionGeneration === "string" ? storedContext.sessionGeneration : null;
    const context = runtimeContext && (!runtimeGeneration || !currentGeneration || runtimeGeneration === currentGeneration)
      ? { ...runtimeContext, ...(currentGeneration ? { sessionGeneration: currentGeneration } : {}) }
      : storedContext && (!currentGeneration || storedGeneration === currentGeneration)
        ? storedContext
        : currentGeneration
          ? { tokens: null, contextWindow: null, percent: null, sessionGeneration: currentGeneration }
          : null;
    chats.push({
      chat_jid: chatJid,
      agent_name: typeof record.agent_name === "string" ? record.agent_name : null,
      model: typeof record.model === "string" ? record.model : null,
      session_id: typeof record.session_id === "string" ? record.session_id : null,
      session_name: typeof record.session_name === "string" ? record.session_name : null,
      branch_id: typeof record.branch_id === "string" ? record.branch_id : null,
      root_chat_jid: typeof record.root_chat_jid === "string" ? record.root_chat_jid : null,
      is_active: Boolean(record.is_active),
      has_side_session: Boolean(record.has_side_session),
      queued_followups: channel.getQueuedFollowupCount(chatJid),
      status: channel.getAgentStatus(chatJid),
      context: publicContextUsage(context),
    });
  }

  chats.sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.chat_jid.localeCompare(b.chat_jid));

  return {
    schema: PICLAW_STATE_SCHEMA,
    generated_at: new Date().toISOString(),
    instance: {
      assistant_name: identity.assistantName || "PiClaw",
      pid: process.pid,
      platform: process.platform,
      sse_clients: channel.sse.clients.size,
    },
    chats,
  };
}

async function snapshotJsonResponse(channel: WebChannelLike): Promise<Response> {
  return channel.json(await buildPiclawStateSnapshot(channel), 200);
}

export async function handleWidgetStateRoutes(
  channel: WebChannelLike,
  req: Request,
  pathname: string,
): Promise<Response | null> {
  if (pathname !== "/api/state" && pathname !== "/api/state/events") return null;
  if (req.method !== "GET") return methodNotAllowedResponse();
  if (!isAuthorizedWidgetStateRequest(req)) return unauthorizedResponse();

  if (pathname === "/api/state") {
    return await snapshotJsonResponse(channel);
  }

  return handleWidgetStateEvents(channel);
}

function encodeSse(eventType: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
}

function handleWidgetStateEvents(channel: WebChannelLike): Response {
  let closed = false;
  let snapshotTimer: Timer | null = null;
  let heartbeatTimer: Timer | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const sendSnapshot = async () => {
        if (closed) return;
        try {
          controller.enqueue(encodeSse(STATE_EVENT_NAME, await buildPiclawStateSnapshot(channel)));
        } catch {
          closed = true;
          if (snapshotTimer) clearInterval(snapshotTimer);
          if (heartbeatTimer) clearInterval(heartbeatTimer);
        }
      };

      void sendSnapshot();
      snapshotTimer = setInterval(() => { void sendSnapshot(); }, STATE_EVENTS_INTERVAL_MS);
      heartbeatTimer = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(new TextEncoder().encode(`: heartbeat ${Date.now()}\n\n`));
        } catch {
          closed = true;
          if (snapshotTimer) clearInterval(snapshotTimer);
          if (heartbeatTimer) clearInterval(heartbeatTimer);
        }
      }, STATE_EVENTS_HEARTBEAT_MS);
    },
    cancel() {
      closed = true;
      if (snapshotTimer) clearInterval(snapshotTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
