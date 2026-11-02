/**
 * web/web-channel-contracts.ts – Structural channel contracts for web handler modules.
 *
 * This module centralizes the shared structural type used across web request/route/
 * handler layers to avoid importing `web.ts` directly and reintroducing static
 * circular dependency edges.
 */

import type { AgentPool } from "../../../agent-pool.js";
import type { SendMessageOptions } from "../message-write-service.js";
import type { WorkspaceDispatchChannel } from "../http/dispatch-workspace.js";
import type { MediaDispatchChannel } from "../http/dispatch-media.js";
import type { RequestGuardsChannel } from "../http/request-guards.js";
import type { AuthEndpointsContext } from "../auth/auth-endpoints.js";
import type { InteractionRow } from "../../../db.js";
import type { WebAgentBufferEntry } from "../agent/agent-buffers.js";
import type { QueuedFollowupItem } from "../../../queued-followups.js";
import type { UiBridge } from "../theming/ui-bridge.js";
import type { TotpAuthContext } from "../auth/totp-auth.js";
import type { WebauthnAuthContext } from "../auth/webauthn-auth.js";
import type { WebauthnEnrolPageContext } from "../auth/webauthn-enrol-page.js";
import type { getAddonApiHealthSnapshot } from "../../../addons/addon-api-health.js";
import type { getMcpStartupDiagnostics } from "../../../secure/mcp-keychain.js";
import type { StoreWebMessageOptions } from "../messaging/message-store.js";

export interface TokenUsageCounterSummary {
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens?: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  cost_total: number;
  runs: number;
  provider_reported_cost_runs?: number;
  catalogue_estimate_cost_runs?: number;
  unavailable_cost_runs?: number;
  legacy_cost_runs?: number;
}

export interface LatestTokenUsageCounterSummary extends TokenUsageCounterSummary {
  cache_read_reported?: number | null;
  cache_write_reported?: number | null;
  provider_cost_total?: number | null;
  catalogue_cost_total?: number | null;
  cost_provenance?: string | null;
  model?: string | null;
  response_model?: string | null;
  provider?: string | null;
  api?: string | null;
  turns?: number | null;
  run_at?: string | null;
}

export interface AgentTokenUsageContext {
  latest: LatestTokenUsageCounterSummary | null;
  totals: TokenUsageCounterSummary | null;
}

/** Context contract used by web agent status/context/model endpoint handlers. */
export interface AgentStatusContext {
  defaultChatJid: string;
  json(payload: unknown, status?: number): Response;
  getAgentStatus(chatJid: string): Record<string, unknown> | null;
  getExtensionWorkingState(chatJid: string): Record<string, unknown> | null;
  getBuffer(turnId: string, panel: "thought" | "draft"): WebAgentBufferEntry | undefined;
  getContextUsageForChat(
    chatJid: string
  ): Promise<{ tokens: number | null; contextWindow: number | null; percent: number | null; sessionGeneration?: string } | null>;
  getSessionTreeSummaryForChat?(chatJid: string): Promise<{ leafId: string | null; total: number } | null>;
  getTokenUsageForChat(chatJid: string): AgentTokenUsageContext | null;
  getAvailableModels(chatJid: string, options?: { includeProviderDiagnostics?: boolean; includeCatalogue?: boolean }): Promise<unknown>;
  getProviderReadyCompletedForInstance(): boolean;
  getAddonApiHealthSnapshot?: typeof getAddonApiHealthSnapshot;
  getMcpStartupDiagnostics?: typeof getMcpStartupDiagnostics;
}


interface AuthGatewayLike {
  isAuthEnabled(): boolean;
  isInternalSecretEnabled(): boolean;
  verifyInternalSecret(req: Request): boolean;
  isAuthenticated(req: Request): boolean;
  getPrincipal?(req: Request, refresh?: boolean): import("../auth/principal.js").AuthenticatedPrincipal | null;
  preparePrincipal?(req: Request): Promise<void>;
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
  isLaneBusy?(laneKey: string): boolean;
  enqueue(task: () => unknown, key: string, laneKey?: string): unknown;
}

export interface PreparedInputText {
  readonly text: string;
  assertCurrent(): void;
}

export interface WebChannelLike
  extends RequestGuardsChannel,
    WorkspaceDispatchChannel,
    MediaDispatchChannel {

  /** Auth/session helper layer. */
  authGateway: AuthGatewayLike;

  endpointContexts: RequestGuardsChannel["endpointContexts"] & {
    auth(): AuthEndpointsContext;
    agentStatus(): AgentStatusContext;
  };

  /** Runtime dependencies and state services used across web layers. */
  queue: TaskQueueLike;
  /** Trusted host-only selection, captured before reading HTTP input; absent by default. */
  prepareInputSourceAdmission?(chatJid: string): Promise<void>;
  prepareInputText?(chatJid: string, text: string): PreparedInputText;
  /** Trusted host lifecycle retirement; never selected from request fields. */
  expireQueuedInput?(chatJid: string, item: Readonly<QueuedFollowupItem>): Promise<boolean>;
  getInputSourceAdmission?(chatJid: string): StoreWebMessageOptions["acceptSource"];
  /** Default-off trusted SQL materialization binding; not an HTTP selection. */
  getAcceptedQueuedSteering?(chatJid: string, assertCurrent?: () => void): import('../../../agent-pool/durable-queued-steering.js').AcceptedQueuedSteering | undefined;
  getQueuedInputMaterialization?(chatJid: string): import('../messaging/message-store.js').QueuedInputMaterialization | undefined;
  getQueuedInputSourceWithdrawal?(chatJid: string): import("../runtime/queued-followup-lifecycle-service.js").QueuedInputSourceAdmission | undefined;
  getQueuedInputSourceAdmission?(chatJid: string): import("../runtime/queued-followup-lifecycle-service.js").QueuedInputSourceAdmission | undefined;
  dispatchAcceptedInput?: import("../../../agent-pool/durable-queue-dispatch.js").AcceptedQueueDispatch;
  admitMessage(chatJid: string, content: string, isBot: boolean, mediaIds: number[], options: StoreWebMessageOptions,
    authorise?: (phase?: "before" | "after") => void, signal?: AbortSignal, deferBeforeInsert?: () => boolean): Promise<InteractionRow | null>;
  agentPool: AgentPool & {
    resolveBudgetProviderAccountRef?(providerId: string): Promise<string | null>;
  };
  uiBridge: UiBridge;
  interactionBroadcaster: InteractionBroadcasterLike;

  sendMessage(chatJid: string, text: string, options?: SendMessageOptions): Promise<void>;
  postDashboardWidget(chatJid: string, options?: { threadId?: number | null; text?: string; widgetId?: string }): Promise<void>;
  updateAgentStatus(chatJid: string, status: Record<string, unknown>): void;
  getAgentStatus(chatJid: string): Record<string, unknown> | null;
  getExtensionWorkingState?(chatJid: string): Record<string, unknown> | null;
  getBuffer(turnId: string, panel: "thought" | "draft"): WebAgentBufferEntry | undefined;
  getThreadRootId(chatJid: string, messageId: string): number | null;

  setPanelExpanded(turnId: string, panel: "thought" | "draft", expanded: boolean): void;
  isPanelExpanded(turnId: string, panel: "thought" | "draft"): boolean;
  updateThoughtBuffer(turnId: string, text: string, totalLines: number): void;
  updateDraftBuffer(turnId: string, text: string, totalLines: number): void;

  enqueueQueuedFollowupItem(
    chatJid: string,
    rowId: number,
    queuedContent: string,
    threadId?: number | null,
    queuedAt?: string,
    extras?: { mediaIds?: number[]; contentBlocks?: unknown[]; linkPreviews?: unknown[]; screenHint?: string; source?: string; queuedBy?: QueuedFollowupItem["queuedBy"] }
  ): number;
  getQueuedFollowupCount(chatJid: string): number;
  admitQueuedFollowupItem(args: Parameters<WebChannelLike['enqueueQueuedFollowupItem']>, authorise: () => void, signal: AbortSignal, acceptSource?: import("../runtime/queued-followup-lifecycle-service.js").QueuedInputSourceAdmission): Promise<number>;
  getQueuedFollowupItems(chatJid: string): QueuedFollowupItem[];
  peekQueuedFollowupItem(chatJid: string): QueuedFollowupItem | null;
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
  serveStatic(relPath: string, req?: Request): Promise<Response>;
  serveDocsStatic(relPath: string): Promise<Response>;
  handleManifest(req: Request): Promise<Response>;
  handleAvatar(kind: "agent" | "user", req: Request): Promise<Response>;
  handleSse(req: Request, authorisation?: import("../sse/sse.js").SseAuthorisation): Response;
  handleTerminalSession(req: Request): Response;
  handleTerminalHandoff(req: Request): Promise<Response>;
  handleVncSession(req: Request): Promise<Response>;
  handleVncHandoff(req: Request): Promise<Response>;
  handleAgents(): Promise<Response>;

  handleWorkspaceVisibility(req: Request): Promise<Response>;
  handleTimeline(limit: number, before?: number, chatJid?: string): Response;
  handleHashtag(tag: string, limit: number, offset: number, chatJid?: string): Response;
  handleSearch(query: string, limit: number, offset: number, chatJid?: string, searchScope?: "current" | "root" | "all", rootChatJid?: string, filters?: { images?: boolean; attachments?: boolean } | null): Response;
  handleThread(id: number | null, chatJid?: string): Response;
  handleThought(panel: string | null, turnId: string | null): Response;
  handleThoughtVisibility(req: Request): Promise<Response>;
  handleDeletePost(req: Request, id: number | null, cascade: boolean): Response;
  handleUpdatePost(req: Request, id: number | null): Promise<Response>;
  handleUpdatePostAnnotations(req: Request, id: number): Promise<Response>;
  handleInternalPost(req: Request): Promise<Response>;
  handlePost(req: Request, isReply: boolean): Promise<Response>;

  handleAgentStatus(req: Request): Response | Promise<Response>;
  handleAgentContext(req: Request): Promise<Response>;
  handleAgentDebug(req: Request): Promise<Response>;
  handleAgentCommands(req: Request): Promise<Response>;
  handleAutoresearchStatus(req: Request): Promise<Response>;
  handleAutoresearchStop(req: Request): Promise<Response>;
  handleAutoresearchDismiss(req: Request): Promise<Response>;
  handleAgentOobeComplete(req: Request): Promise<Response>;
  handleAgentQueueState(req: Request): Promise<Response>;
  handleAgentRuns(req: Request): Promise<Response>;
  handleAgentRunAbort(req: Request): Promise<Response>;
  handleAgentRunClearStale(req: Request): Promise<Response>;
  handleAgentRunDrainQueue(req: Request): Promise<Response>;
  handleAgentQueueRemove(req: Request): Promise<Response>;
  handleAgentQueueSteer(req: Request): Promise<Response>;
  handleAgentQueueReorder(req: Request): Promise<Response>;
  handleAgentModels(req: Request): Promise<Response>;
  handleSystemMetrics(req: Request): Response;
  handleAgentActiveChats(req: Request): Promise<Response>;
  handleAgentBranches(req: Request): Promise<Response>;
  handleAgentBranchFork(req: Request): Promise<Response>;
  handleAgentRootSessionCreate(req: Request): Promise<Response>;
  handleAgentBranchRename(req: Request): Promise<Response>;
  handleAgentRenameJid(req: Request): Promise<Response>;
  handleAgentBranchMergeParent(req: Request): Promise<Response>;
  handleAgentBranchPrune(req: Request): Promise<Response>;
  handleAgentBranchDownload(req: Request): Response;
  handleAgentBranchPurge(req: Request): Promise<Response>;
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

  /** Compatibility for legacy channel-wide SSE event emitter. */
  broadcastEvent(eventType: string, data: unknown): void;
}
