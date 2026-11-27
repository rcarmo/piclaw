/**
 * web/sse-hub.ts – SSE client connection manager.
 *
 * Manages the set of connected SSE clients and provides broadcast()
 * to push events to all of them simultaneously.
 *
 * Consumers: channels/web.ts creates a single SseHub and uses it
 *            throughout the web channel for real-time event delivery.
 */

import { broadcastEvent, handleSse, releaseSseClient, type PendingClient, type SseClientContainer, type SseAuthorisation } from "./sse.js";

/** Manages SSE client connections and provides broadcast(). */
export class SseHub implements SseClientContainer {
  clients = new Set<PendingClient>();

  handleRequest(req?: Request, authorisation?: SseAuthorisation): Response {
    return handleSse(this, req, authorisation);
  }

  broadcast(eventType: string, data: unknown): void {
    broadcastEvent(this, eventType, data);
  }

  closeAll(): void {
    for (const client of this.clients) {
      releaseSseClient(this, client, "Failed to close an SSE client controller during shutdown.");
    }
  }
}
