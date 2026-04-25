/**
 * web/web-channel-contracts.ts – Structural channel contracts for web handler modules.
 *
 * This module centralizes the shared structural type used across web request/route/
 * handler layers to avoid importing `web.ts` directly and reintroducing static
 * circular dependency edges.
 */

import type { AgentPool } from "../../../agent-pool.js";
import type { SendMessageOptions } from "../messaging/message-write-flows.js";
import type { WorkspaceDispatchChannel } from "../http/dispatch-workspace.js";
import type { MediaDispatchChannel } from "../http/dispatch-media.js";
import type { RequestGuardsChannel } from "../http/request-guards.js";
import type { AuthEndpointsContext } from "../auth/auth-endpoints.js";
import type { InteractionRow } from "../../../db.js";
import type { WebAgentBufferEntry } from "../agent/agent-buffers.js";
import type { QueuedFollowupItem } from "../runtime/followup-placeholders.js";
import type { UiBridge } from "../theming/ui-bridge.js";
import type { TotpAuthContext } from "../auth/totp-auth.js";
import type { WebauthnAuthContext } from "../auth/webauthn-auth.js";
import type { WebauthnEnrolPageContext } from "../auth/webauthn-enrol-page.js";

interface AuthGatewayLike {
  isAuthEnabled(): boolean;
  isInternalSecretEnabled(): boolean;
  verifyInternalSecret(req: Request): boolean;
  isAuthenticated(req: Request): boolean;
  isTotpSession(req: Request): boolean;
  createTotpContext(): TotpAuthContext;
  createWebauthnContext(): WebauthnAuthContext;
  createWebauthnEnrolPageContext(): WebauthnEnrolPageContext;
}

interface InteractionBroadcasterLike {
  broadcastInteractionUpdated(interaction: InteractionRow): void;
  broadcastAgentResponse(interaction: InteractionRow): void;
}

interface TaskQueueLike {
  enqueue(task: () => unknown, key: string, laneKey?: string): unknown;
}

export interface WebChannelLike
  extends RequestGuardsChannel,
    WorkspaceDispatchChannel,
    MediaDispatchChannel {

  /** Auth/session helper layer. */
  authGateway: AuthGatewayLike;

  endpointContexts: RequestGuardsChannel["endpointContexts"] & {
    auth(): AuthEndpointsContext;
  };

  /** Runtime dependencies and state services used across web layers. */
  queue: TaskQueueLike;
  uiBridge: UiBridge;
  interactionBroadcaster: InteractionBroadcasterLike;

  /** Message persistence and thread state. */
  storeMessage(
    chatJid: string,
    content: string,
    isBot: boolean,
    mediaIds: number[],
    options?: {
      contentBlocks?: unknown[];
      linkPreviews?: unknown[];
      threadId?: number;
      isTerminalAgentReply?: boolean;
      isSteeringMessage?: boolean;
    }
  ): InteractionRow | null;

  sendMessage(chatJid: string, text: string, options?: SendMessageOptions): Promise<void>;
  postDashboardWidget(chatJid: string, options?: { threadId?: number | null; text?: string; widgetId?: string }): Promise<void>;
  updateAgentStatus(chatJid: string, status: Record<string, unknown>): void;
  getAgentStatus(chatJid: string): Record<string, unknown> | null;
  setContextUsage(chatJid: string, usage: Record<string, unknown> | null): void;
  getContextUsage(chatJid: string): Record<string, unknown> | null;
  getBuffer(turnId: string, panel: "thought" | "draft"): WebAgentBufferEntry | undefined;
  getThreadRootId(chatJid: string, messageId: string): number | null;
  saveState(): void;
  skipFailedOnModelSwitch(chatJid: string): boolean;
  retryFailedOnModelSwitch(chatJid: string): boolean;
  recoverStaleInflightRun(chatJid: string, options?: { hasActiveStatus?: boolean; minAgeMs?: number }): boolean;

  setPanelExpanded(turnId: string, panel: "thought" | "draft", expanded: boolean): void;
  isPanelExpanded(turnId: string, panel: "thought" | "draft"): boolean;
  updateThoughtBuffer(turnId: string, text: string, totalLines: number): void;
  updateDraftBuffer(turnId: string, text: string, totalLines: number): void;

  queueFollowupPlaceholder(chatJid: string, text: string, threadId?: number, queuedContent?: string): InteractionRow | null;
  enqueueQueuedFollowupItem(
    chatJid: string,
    rowId: number,
    queuedContent: string,
    threadId?: number | null,
    queuedAt?: string,
    extras?: { mediaIds?: number[]; contentBlocks?: unknown[]; linkPreviews?: unknown[] }
  ): number;
  getQueuedFollowupCount(chatJid: string): number;
  getQueuedFollowupItems(chatJid: string): QueuedFollowupItem[];
  removeQueuedFollowupItem(chatJid: string, rowId: number): QueuedFollowupItem | null;
  consumeQueuedFollowupItem(chatJid: string): QueuedFollowupItem | null;
  prependQueuedFollowupItem(chatJid: string, item: QueuedFollowupItem): void;
  consumeQueuedFollowupPlaceholder(chatJid: string): number | null;
  replaceQueuedFollowupPlaceholder(
    chatJid: string,
    rowId: number,
    text: string,
    mediaIds: number[],
    contentBlocks: Array<Record<string, unknown>> | undefined,
    threadId?: number,
    isTerminalAgentReply?: boolean
  ): InteractionRow | null;
  queuePendingSteering(chatJid: string, timestamp: string | undefined): void;
  consumePendingSteering(chatJid: string): string[];

  /** UI/runtime state consumed by endpoint contexts. */
  workspaceVisible: boolean;
  workspaceShowHidden: boolean;

  /** SSE runtime handle. */
  sse: {
    clients: { size: number };
  };

  /** Last command interaction id used for slash-command follow-up behavior. */
  lastCommandInteractionId: number | null;

  /** General endpoint handlers. */
  serveStatic(relPath: string): Promise<Response>;
  serveDocsStatic(relPath: string): Promise<Response>;
  handleRemote(req: Request): Promise<Response>;
  handleManifest(req: Request): Promise<Response>;
  handleAvatar(kind: "agent" | "user", req: Request): Promise<Response>;
  handleSse(req: Request): Response;
  handleTerminalSession(req: Request): Response;
  handleTerminalHandoff(req: Request): Promise<Response>;
  handleVncSession(req: Request): Response;
  handleVncHandoff(req: Request): Promise<Response>;
  handleAgents(): Promise<Response>;

  handleWorkspaceVisibility(req: Request): Promise<Response>;
  handleTimeline(limit: number, before?: number, chatJid?: string): Response;
  handleHashtag(tag: string, limit: number, offset: number, chatJid?: string): Response;
  handleSearch(query: string, limit: number, offset: number, chatJid?: string, searchScope?: "current" | "root" | "all", rootChatJid?: string): Response;
  handleThread(id: number | null, chatJid?: string): Response;
  handleThought(panel: string | null, turnId: string | null): Response;
  handleThoughtVisibility(req: Request): Promise<Response>;
  handleDeletePost(req: Request, id: number | null, cascade: boolean): Response;
  handleUpdatePost(req: Request, id: number | null): Promise<Response>;
  handleInternalPost(req: Request): Promise<Response>;
  handlePost(req: Request, isReply: boolean): Promise<Response>;

  handleAgentStatus(req: Request): Response;
  handleAgentContext(req: Request): Promise<Response>;
  handleAgentDebug(req: Request): Promise<Response>;
  handleAgentCommands(req: Request): Promise<Response>;
  handleAutoresearchStatus(req: Request): Promise<Response>;
  handleAutoresearchStop(req: Request): Promise<Response>;
  handleAutoresearchDismiss(req: Request): Promise<Response>;
  handleAgentOobeComplete(req: Request): Promise<Response>;
  handleAgentQueueState(req: Request): Promise<Response>;
  handleAgentQueueRemove(req: Request): Promise<Response>;
  handleAgentQueueSteer(req: Request): Promise<Response>;
  handleAgentQueueReorder(req: Request): Promise<Response>;
  handleAgentModels(req: Request): Promise<Response>;
  handleSessionTree(req: Request): Response;
  handleSystemMetrics(req: Request): Response;
  handleAgentActiveChats(req: Request): Promise<Response>;
  handleAgentBranches(req: Request): Promise<Response>;
  handleAgentBranchFork(req: Request): Promise<Response>;
  handleAgentBranchRename(req: Request): Promise<Response>;
  handleAgentRenameJid(req: Request): Promise<Response>;
  handleAgentBranchPrune(req: Request): Promise<Response>;
  handleAgentBranchRestore(req: Request): Promise<Response>;
  handleAgentPeerMessage(req: Request): Promise<Response>;
  handleAgentRespond(req: Request): Promise<Response>;
  handleAdaptiveCardAction(req: Request): Promise<Response>;
  handleAgentSidePrompt(req: Request): Promise<Response>;
  handleAgentSidePromptStream(req: Request): Promise<Response>;
  handleAgentMessage(req: Request, pathname: string): Promise<Response>;
  resumeChat(chatJid: string, threadRootId?: number | null): void;

  /** Utility helpers shared via request helpers and helpers. */
  parseOptionalInt(value: string | null): number | null;
  clampInt(value: string | null, fallback: number, min: number, max: number): number;

  /** Agent pool used by routing handlers and endpoint contexts. */
  agentPool: AgentPool;

  /** Compatibility for legacy channel-wide SSE event emitter. */
  broadcastEvent(eventType: string, data: unknown): void;
}
