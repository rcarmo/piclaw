/**
 * channels/web/endpoint-contexts.ts – shared builders for WebChannel endpoint context objects.
 */

import type { AgentPool } from "../../../agent-pool.js";
import type { InteractionRow } from "../../../db.js";
import type { WebAgentBufferEntry } from "../agent/agent-buffers.js";
import type { AgentStatusContext } from "../agent/agent-status.js";
import type { ContentEndpointsContext } from "./content-endpoints.js";
import type { AgentsEndpointContext, AvatarEndpointContext } from "./identity-endpoints.js";
import type { PostMutationsContext } from "../post-mutations.js";
import type { UiEndpointsContext } from "./ui-endpoints.js";

interface JsonLike {
  json(payload: unknown, status?: number): Response;
}

/** Dependencies required to assemble the post-mutation endpoint context. */
export interface PostMutationsContextDeps extends JsonLike {
  defaultChatJid: string;
  getLastCommandInteractionId(): number | null;
  replaceMessageContent(chatJid: string, id: number, content: string): InteractionRow | null;
  setThreadId(messageId: number, threadId: number): void;
  broadcastInteractionUpdated(interaction: InteractionRow): void;
  storeMessage(
    chatJid: string,
    content: string,
    isBot: boolean,
    mediaIds: number[],
    options?: { threadId?: number }
  ): InteractionRow | null;
  broadcastAgentResponse(interaction: InteractionRow): void;
}

/** Build the post-mutation endpoint context from live channel dependencies. */
export function createPostMutationsContext(deps: PostMutationsContextDeps): PostMutationsContext {
  return {
    defaultChatJid: deps.defaultChatJid,
    lastCommandInteractionId: deps.getLastCommandInteractionId(),
    json: deps.json,
    replaceMessageContent: deps.replaceMessageContent,
    setThreadId: deps.setThreadId,
    broadcastInteractionUpdated: deps.broadcastInteractionUpdated,
    storeMessage: deps.storeMessage,
    broadcastAgentResponse: deps.broadcastAgentResponse,
  };
}

/** Dependencies required to assemble the agent-status endpoint context. */
export interface AgentStatusContextDeps extends JsonLike {
  defaultChatJid: string;
  getAgentStatus(chatJid: string): Record<string, unknown> | null;
  recoverStaleInflightRun(chatJid: string, options?: { hasActiveStatus?: boolean; minAgeMs?: number }): boolean;
  getBuffer(turnId: string, panel: "thought" | "draft"): WebAgentBufferEntry | undefined;
  getContextUsageForChat(
    chatJid: string
  ): Promise<{ tokens: number | null; contextWindow: number; percent: number | null } | null>;
  getAvailableModels(chatJid: string): Promise<unknown>;
  getProviderReadyCompletedForInstance(): boolean;
}

/** Build the agent-status endpoint context from live channel dependencies. */
export function createAgentStatusContext(deps: AgentStatusContextDeps): AgentStatusContext {
  return {
    defaultChatJid: deps.defaultChatJid,
    json: deps.json,
    getAgentStatus: deps.getAgentStatus,
    recoverStaleInflightRun: deps.recoverStaleInflightRun,
    getBuffer: deps.getBuffer,
    getContextUsageForChat: deps.getContextUsageForChat,
    getAvailableModels: deps.getAvailableModels,
    getProviderReadyCompletedForInstance: deps.getProviderReadyCompletedForInstance,
  };
}

/** Dependencies required to assemble timeline/search/thread content endpoint context. */
export interface ContentEndpointsContextDeps extends JsonLike {
  defaultChatJid: string;
  getBuffer(turnId: string, panel: "thought" | "draft"): WebAgentBufferEntry | undefined;
  getIdentity?(): { assistantName?: string | null; assistantAvatarUrl?: string | null; userName?: string | null; userAvatarUrl?: string | null; userAvatarBackground?: string | null } | null;
}

/** Build the content endpoint context from live channel dependencies. */
export function createContentEndpointsContext(deps: ContentEndpointsContextDeps): ContentEndpointsContext {
  return {
    defaultChatJid: deps.defaultChatJid,
    json: deps.json,
    getBuffer: deps.getBuffer,
    getIdentity: deps.getIdentity,
  };
}

/** Dependencies required to assemble UI endpoint context handlers/state accessors. */
export interface UiEndpointsContextDeps extends JsonLike {
  getWorkspaceVisible(): boolean;
  setWorkspaceVisible(value: boolean): void;
  getWorkspaceShowHidden(): boolean;
  setWorkspaceShowHidden(value: boolean): void;
  setPanelExpanded(turnId: string, panel: "thought" | "draft", expanded: boolean): void;
  handleUiResponse(requestId: string, outcome: unknown, chatJid?: string | null): { status: "ok" | "unknown_request" };
}

/** Build the UI endpoint context from live channel dependencies. */
export function createUiEndpointsContext(deps: UiEndpointsContextDeps): UiEndpointsContext {
  return {
    json: deps.json,
    getWorkspaceVisible: deps.getWorkspaceVisible,
    setWorkspaceVisible: deps.setWorkspaceVisible,
    getWorkspaceShowHidden: deps.getWorkspaceShowHidden,
    setWorkspaceShowHidden: deps.setWorkspaceShowHidden,
    setPanelExpanded: deps.setPanelExpanded,
    handleUiResponse: deps.handleUiResponse,
  };
}

/** Dependencies required to assemble the agents profile/identity endpoint context. */
export interface AgentsEndpointContextDeps extends JsonLike {
  agentPool: AgentPool;
  defaultChatJid: string;
  defaultAgentId: string;
  agentName: string;
  agentAvatar: string | null;
  userName: string | null;
  userAvatar: string | null;
  userAvatarBackground: string | null;
}

/** Build the agents endpoint context from live channel dependencies. */
export function createAgentsEndpointContext(deps: AgentsEndpointContextDeps): AgentsEndpointContext {
  return {
    agentPool: deps.agentPool,
    defaultChatJid: deps.defaultChatJid,
    defaultAgentId: deps.defaultAgentId,
    agentName: deps.agentName,
    agentAvatar: deps.agentAvatar,
    userName: deps.userName,
    userAvatar: deps.userAvatar,
    userAvatarBackground: deps.userAvatarBackground,
    json: deps.json,
  };
}

/** Dependencies required to assemble avatar endpoint context. */
export interface AvatarEndpointContextDeps extends JsonLike {
  assistantAvatar: string | null;
  userAvatar: string | null;
}

/** Build the avatar endpoint context from live channel dependencies. */
export function createAvatarEndpointContext(deps: AvatarEndpointContextDeps): AvatarEndpointContext {
  return {
    assistantAvatar: deps.assistantAvatar,
    userAvatar: deps.userAvatar,
    json: deps.json,
  };
}
