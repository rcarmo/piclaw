/**
 * web/sse.ts – Server-Sent Events (SSE) primitives.
 *
 * Provides low-level SSE stream creation, event encoding, client
 * lifecycle management, and broadcast helpers.
 *
 * Consumers: web/sse-hub.ts builds on these primitives.
 */

import { createLogger, debugSuppressedError } from "../../../utils/logger.js";
import { getAppAssetVersion } from "../http/static.js";
import { projectPublicBranding } from "./public-branding.js";
import { getServerUiState } from "../ui-state.js";

const log = createLogger("web.sse");
const encoder = new TextEncoder();

const CHAT_SCOPED_EVENT_TYPES = new Set([
  "agent_status",
  "agent_thought",
  "agent_thought_delta",
  "agent_draft",
  "agent_draft_delta",
  "agent_preview_consumed",
  "agent_response",
  "new_post",
  "new_reply",
  "interaction_updated",
  "interaction_deleted",
  "agent_steer_queued",
  "agent_followup_queued",
  "agent_followup_consumed",
  "agent_followup_removed",
  "agent_followup_reordered",
  "model_changed",
  "extension_ui_timeout",
  "extension_ui_request",
  "extension_ui_notify",
  "extension_ui_status",
  "extension_ui_working",
  "extension_ui_working_indicator",
  "extension_ui_working_visible",
  "extension_ui_widget",
  "extension_ui_title",
  "extension_ui_editor_text",
  "extension_ui_error",
  "generated_widget_open",
  "generated_widget_delta",
  "generated_widget_final",
  "generated_widget_close",
  "generated_widget_error",
]);

export function requiresChatScopedDelivery(eventType: string): boolean {
  return CHAT_SCOPED_EVENT_TYPES.has(String(eventType || "").trim());
}

/**
 * Maximum number of concurrent SSE clients.
 * Prevents resource exhaustion from opening too many connections.
 * Each client holds a ReadableStream controller and a heartbeat interval.
 */
const MAX_SSE_CLIENTS = 50;

/** Server-created subscription authority; never populated from request payloads. */
export interface SseAuthorisation {
  readonly chatJid: string;
  readonly userId?: string;
  readonly isAuthorised: () => boolean;
  readonly project?: (eventType: string, data: unknown) => unknown | null;
}

function isAuthorised(authorisation?: SseAuthorisation): boolean {
  if (!authorisation) return true;
  try { return Boolean(authorisation.chatJid && authorisation.isAuthorised()); }
  catch { return false; }
}

/** An SSE client waiting to be registered (response + controller). */
export interface PendingClient {
  controller: ReadableStreamDefaultController<Uint8Array>;
  heartbeat: Timer;
  chatJid?: string | null;
  authorisation?: SseAuthorisation;
  removeAbortListener?: () => void;
}

/** Interface for a container that holds SSE client lists. */
export interface SseClientContainer {
  clients: Set<PendingClient>;
}

/**
 * Create an SSE response stream and register the client.
 * Returns 503 if the maximum client limit has been reached.
 */
export function handleSse(channel: SseClientContainer, req?: Request, authorisation?: SseAuthorisation): Response {
  if (!isAuthorised(authorisation)) {
    return new Response(JSON.stringify({ error: "Session access denied." }), {
      status: 403, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
    });
  }
  // Guard against connection exhaustion — reject if at capacity
  if (channel.clients.size >= MAX_SSE_CLIENTS) {
    return new Response(JSON.stringify({ error: "Too many connections" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  const chatJid = authorisation?.chatJid ?? (req ? (new URL(req.url).searchParams.get("chat_jid") || "").trim() || null : null);
  const signal = req?.signal;
  let clientRef: PendingClient | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      if (signal?.aborted) {
        controller.close();
        return;
      }
      const connected = encoder.encode(`event: connected\ndata: ${JSON.stringify({ app_asset_version: getAppAssetVersion(), ...(authorisation ? {} : getServerUiState()), ...(chatJid ? { chat_jid: chatJid } : {}) })}\n\n`);
      const heartbeat = setInterval(() => {
        const client = clientRef;
        if (!client || !revalidateSseClient(channel, client)) return;
        // Skip the whole heartbeat when backed up; real events still queue in order.
        if ((controller.desiredSize ?? 0) <= 0) return;
        const comment = encoder.encode(": heartbeat\n\n");
        const event = encoder.encode(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now(), ...(chatJid ? { chat_jid: chatJid } : {}) })}\n\n`);
        if (!channel.clients.has(client)) return;
        try {
          controller.enqueue(comment);
          if (channel.clients.has(client)) controller.enqueue(event);
        } catch (error) {
          debugSuppressedError(log, "Failed to enqueue an SSE frame.", error);
          releaseSseClient(channel, client, "Failed to close an SSE client after an enqueue error.");
        }
      }, 30000);
      const onAbort = () => {
        if (clientRef) releaseSseClient(channel, clientRef, "Aborted SSE client already closed.");
      };
      const client: PendingClient = {
        controller, heartbeat, chatJid, authorisation,
        removeAbortListener: signal && (() => signal.removeEventListener("abort", onAbort)),
      };
      clientRef = client;
      channel.clients.add(client);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      if (!channel.clients.has(client)) return;
      try { controller.enqueue(connected); }
      catch (error) {
        debugSuppressedError(log, "Failed to enqueue an SSE frame.", error);
        releaseSseClient(channel, client, "Failed to close an SSE client after an enqueue error.");
      }
    },
    cancel: () => {
      if (clientRef) releaseSseClient(channel, clientRef);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": authorisation ? "private, no-store" : "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/** Release a registered client once, optionally closing its existing stream. */
export function releaseSseClient(channel: SseClientContainer, client: PendingClient, closeReason?: string): void {
  if (!channel.clients.delete(client)) return;
  client.removeAbortListener?.();
  clearInterval(client.heartbeat);
  if (!closeReason) return;
  try { client.controller.close(); }
  catch (error) { debugSuppressedError(log, closeReason, error); }
}

/** Revoke before delivery, including silent and backed-up streams. */
function revalidateSseClient(channel: SseClientContainer, client: PendingClient): boolean {
  if (!channel.clients.has(client)) return false;
  if (isAuthorised(client.authorisation)) return channel.clients.has(client);
  releaseSseClient(channel, client, "Revoked SSE client already closed.");
  return false;
}

function projectScopedEvent(authorisation: SseAuthorisation, eventType: string, data: unknown): unknown | null {
  if (typeof authorisation.project !== "function") return data;
  try { return authorisation.project(eventType, data); }
  catch { return null; }
}

export function broadcastEvent(channel: SseClientContainer, eventType: string, data: unknown): void {
  const eventChatJid = data && typeof data === "object" && typeof (data as Record<string, unknown>).chat_jid === "string"
    ? String((data as Record<string, unknown>).chat_jid || "").trim() || null
    : null;

  if (requiresChatScopedDelivery(eventType) && !eventChatJid) {
    log.warn("Dropping chat-scoped event without chat_jid", {
      operation: "web_sse.broadcast_event.missing_chat_jid",
      eventType,
    });
    return;
  }

  for (const client of channel.clients) {
    if (!revalidateSseClient(channel, client)) continue;

    let projected: unknown = data;
    if (eventType === 'picker_pins_changed') {
      const payload = data as { user_id?: string; operator?: boolean };
      const allowed = client.authorisation ? Boolean(client.authorisation.userId && payload?.user_id === client.authorisation.userId) : payload?.operator === true;
      if (!allowed) continue;
      projected = {};
    } else {
      // Only the allowlisted public instance branding may cross the scoped-client boundary.
      if (client.authorisation && eventType !== 'profile_update' && (!eventChatJid || !requiresChatScopedDelivery(eventType))) continue;
      if (eventChatJid && client.chatJid !== eventChatJid) continue;
      if (client.authorisation) {
        projected = eventType === 'profile_update'
          ? projectPublicBranding(data)
          : projectScopedEvent(client.authorisation, eventType, data);
      }
      if (projected === null) continue;
    }

    const bytes = encoder.encode(`event: ${eventType}\ndata: ${JSON.stringify(projected)}\n\n`);
    if (!channel.clients.has(client)) continue;
    try { client.controller.enqueue(bytes); }
    catch (error) {
      debugSuppressedError(log, "Failed to enqueue an SSE frame.", error);
      releaseSseClient(channel, client, "Failed to close an SSE client after an enqueue error.");
    }
  }
}
