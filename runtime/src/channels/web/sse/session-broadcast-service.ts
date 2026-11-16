/**
 * web/session-broadcast-service.ts – WebChannel SSE/session broadcast seam.
 *
 * Centralizes the web channel's realtime browser wiring: SSE request handling,
 * channel-wide event fanout and chat-scoped UI requests.
 * This keeps `channels/web.ts` focused on HTTP endpoint orchestration while
 * preserving the existing public surface (`sse`, `uiBridge`, `handleSse()`,
 * and `broadcastEvent()`).
 */

import type { AgentPool } from "../../../agent-pool.js";
import type { ProviderUsageRefreshEvent } from "../../../agent-pool/runtime-facade.js";
import { SseHub } from "./sse-hub.js";
import type { SseAuthorisation } from "./sse.js";
import { UiBridge, type UiBridgeChannel } from "../theming/ui-bridge.js";

interface WebSessionBroadcastServiceOpts {
  sse?: SseHub;
  uiBridge?: UiBridge;
}

/**
 * Owns the SSE hub and extension UI bridge used by WebChannel.
 *
 * Native execution publishes watch projections separately. This service owns
 * fanout, UI request/response delivery and provider-usage notifications.
 */
export class WebSessionBroadcastService implements UiBridgeChannel {
  readonly sse: SseHub;
  readonly uiBridge: UiBridge;
  private readonly releaseProviderUsage?: () => void;
  private providerUsageActive = true;

  constructor(agentPool: AgentPool, opts: WebSessionBroadcastServiceOpts = {}) {
    this.sse = opts.sse ?? new SseHub();
    this.uiBridge = opts.uiBridge ?? new UiBridge(this);
    this.releaseProviderUsage = agentPool.setProviderUsageRefreshListener?.((event: ProviderUsageRefreshEvent) => {
      if (this.providerUsageActive) this.broadcastEvent("model_changed", event);
    });
  }

  /** Release this observer; the web gateway still owns transport/UI cleanup. */
  dispose(): void {
    this.providerUsageActive = false;
    this.releaseProviderUsage?.();
  }

  handleSse(req: Request, authorisation?: SseAuthorisation): Response {
    return this.sse.handleRequest(req, authorisation);
  }

  broadcastEvent(eventType: string, data: unknown): void {
    this.sse.broadcast(eventType, data);
  }
}
