/**
 * channels/web/channel-endpoint-context-factory.ts – Builds endpoint contexts for WebChannel handlers.
 */

import { getLatestTokenUsage, getTokenUsageTotals } from "../../../db.js";
import { updateMessagePost } from "../../../db/messages.js";
import { resolveAvatarUrl } from "../media/avatar-service.js";
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import type { AuthEndpointsContext } from "../auth/auth-endpoints.js";
import { isProviderReadyOobeCompletedForInstance } from "../oobe-instance-state.js";
import type { AgentStatusContext, AgentTokenUsageContext } from "../agent/agent-status.js";
import type { ContentEndpointsContext } from "./content-endpoints.js";
import type { AgentsEndpointContext, AvatarEndpointContext } from "./identity-endpoints.js";
import type { PostMutationsContext } from "../post-mutations.js";
import type { UiEndpointsContext } from "./ui-endpoints.js";

/** Live identity/avatar snapshot consumed by endpoint context builders. */
export interface WebChannelIdentitySnapshot {
  assistantName: string;
  assistantAvatarRaw: string | null;
  agentAvatarUrl: string | null;
  userName: string | null;
  userAvatarRaw: string | null;
  userAvatarUrl: string | null;
  userAvatarBackground: string | null;
}

/** Normalize live identity config into the shared endpoint snapshot shape. */
export function createWebChannelIdentitySnapshot(identity: {
  assistantName: string;
  assistantAvatar?: string | null;
  userName?: string | null;
  userAvatar?: string | null;
  userAvatarBackground?: string | null;
}): WebChannelIdentitySnapshot {
  return {
    assistantName: identity.assistantName,
    assistantAvatarRaw: identity.assistantAvatar || null,
    agentAvatarUrl: resolveAvatarUrl("agent", identity.assistantAvatar),
    userName: identity.userName || null,
    userAvatarRaw: identity.userAvatar || null,
    userAvatarUrl: resolveAvatarUrl("user", identity.userAvatar),
    userAvatarBackground: identity.userAvatarBackground || null,
  };
}

/** Immutable options needed to build channel endpoint contexts. */
export interface WebChannelEndpointFactoryOptions {
  defaultChatJid: string;
  defaultAgentId: string;
  getIdentitySnapshot(): WebChannelIdentitySnapshot;
}

function getTokenUsageForChat(chatJid: string): AgentTokenUsageContext | null {
  try {
    const latest = getLatestTokenUsage(chatJid);
    const totals = getTokenUsageTotals(chatJid);
    return latest || totals.runs > 0 ? { latest, totals } : null;
  } catch (error) {
    if (error instanceof Error && (error.message === "Database not initialized" || error.message.includes("closed database"))) return null;
    throw error;
  }
}

/** Lazily built endpoint contexts consumed by WebChannel handlers. */
export interface WebChannelEndpointContexts {
  identity(): WebChannelIdentitySnapshot;
  postMutations(): PostMutationsContext;
  agentStatus(): AgentStatusContext;
  content(): ContentEndpointsContext;
  ui(): UiEndpointsContext;
  agents(): AgentsEndpointContext;
  avatar(): AvatarEndpointContext;
  auth(): AuthEndpointsContext;
}

/** Create endpoint-context builders bound to the current WebChannel instance. */
export function createWebChannelEndpointContexts(
  channel: WebChannelLike,
  options: WebChannelEndpointFactoryOptions
): WebChannelEndpointContexts {
  let agentStatusContext: AgentStatusContext | null = null;
  let contentContext: ContentEndpointsContext | null = null;
  let uiContext: UiEndpointsContext | null = null;
  let authContext: AuthEndpointsContext | null = null;

  return {
    identity: () => options.getIdentitySnapshot(),
    postMutations: () => ({
      defaultChatJid: options.defaultChatJid,
      lastCommandInteractionId: channel.lastCommandInteractionId,
      authGateway: channel.authGateway,
      json: (payload, status = 200) => channel.json(payload, status),
      replaceMessageContent: (chatJid, id, content, threadId) => updateMessagePost(chatJid, id, content, threadId) ?? null,
      broadcastInteractionUpdated: (interaction) => {
        channel.interactionBroadcaster.broadcastInteractionUpdated(interaction);
      },
      admitMessage: channel.admitMessage.bind(channel),
      broadcastAgentResponse: (interaction) => {
        channel.interactionBroadcaster.broadcastAgentResponse(interaction);
      },
    }),

    agentStatus: () => {
      if (!agentStatusContext) {
        agentStatusContext = {
          defaultChatJid: options.defaultChatJid,
          json: (payload, status = 200) => channel.json(payload, status),
          getAgentStatus: (chatJid) => channel.getAgentStatus(chatJid),
          getExtensionWorkingState: (chatJid) => channel.getExtensionWorkingState?.(chatJid) ?? null,
          getBuffer: (turnId, panel) => channel.getBuffer(turnId, panel),
          getContextUsageForChat: async (chatJid) => {
            const generation = () => channel.agentPool.getSessionGenerationForChat?.(chatJid) ?? null;
            const before = generation();
            let usage;
            try { usage = await channel.agentPool.getContextUsageForChat(chatJid); }
            catch { usage = null; }
            const current = generation();
            if (before === current && usage && (!current || usage.sessionGeneration === current)) return usage;
            return current ? {tokens:null,contextWindow:null,percent:null,sessionGeneration:current,tokensAreAuthoritative:true as const} : null;
          },
          getSessionTreeSummaryForChat: typeof channel.agentPool.getSessionTreeSummaryForChat === "function"
            ? (chatJid) => channel.agentPool.getSessionTreeSummaryForChat(chatJid)
            : undefined,
          getTokenUsageForChat,
          getAvailableModels: (chatJid, modelOptions) => channel.agentPool.getAvailableModels(chatJid, modelOptions),
          getProviderReadyCompletedForInstance: () => isProviderReadyOobeCompletedForInstance(),
        };
      }
      return agentStatusContext;
    },

    content: () => {
      if (!contentContext) {
        contentContext = {
          defaultChatJid: options.defaultChatJid,
          json: (payload, status = 200) => channel.json(payload, status),
          getBuffer: (turnId, panel) => channel.getBuffer(turnId, panel),
          getIdentity: () => {
            const identity = options.getIdentitySnapshot();
            return {
              assistantName: identity.assistantName,
              assistantAvatarUrl: identity.agentAvatarUrl,
              userName: identity.userName,
              userAvatarUrl: identity.userAvatarUrl,
              userAvatarBackground: identity.userAvatarBackground,
            };
          },
        };
      }
      return contentContext;
    },

    ui: () => {
      if (!uiContext) {
        uiContext = {
          json: (payload, status = 200) => channel.json(payload, status),
          getWorkspaceVisible: () => channel.workspaceVisible,
          setWorkspaceVisible: (value) => {
            channel.workspaceVisible = value;
            (channel as WebChannelLike & { syncWorkspaceWatcher?: () => void }).syncWorkspaceWatcher?.();
          },
          getWorkspaceShowHidden: () => channel.workspaceShowHidden,
          setWorkspaceShowHidden: (value) => {
            channel.workspaceShowHidden = value;
            (channel as WebChannelLike & { syncWorkspaceWatcher?: () => void }).syncWorkspaceWatcher?.();
          },
          setPanelExpanded: (turnId, panel, expanded) => {
            channel.setPanelExpanded(turnId, panel, expanded);
          },
          handleUiResponse: (requestId, outcome, chatJid) => channel.uiBridge.handleUiResponse(requestId, outcome, chatJid),
        };
      }
      return uiContext;
    },

    agents: () => {
      const identity = options.getIdentitySnapshot();
      return {
        agentPool: channel.agentPool,
        defaultChatJid: options.defaultChatJid,
        defaultAgentId: options.defaultAgentId,
        agentName: identity.assistantName,
        agentAvatar: identity.agentAvatarUrl,
        userName: identity.userName,
        userAvatar: identity.userAvatarUrl,
        userAvatarBackground: identity.userAvatarBackground,
        json: (payload, status = 200) => channel.json(payload, status),
      };
    },

    avatar: () => {
      const identity = options.getIdentitySnapshot();
      return {
        assistantAvatar: identity.assistantAvatarRaw,
        userAvatar: identity.userAvatarRaw,
        json: (payload, status = 200) => channel.json(payload, status),
      };
    },

    auth: () => {
      if (!authContext) {
        authContext = {
          createTotpContext: () => channel.authGateway.createTotpContext(),
          createWebauthnContext: () => channel.authGateway.createWebauthnContext(),
          createWebauthnEnrolPageContext: () => channel.authGateway.createWebauthnEnrolPageContext(),
          serveStatic: (relPath, req) => channel.serveStatic(relPath, req),
        };
      }
      return authContext;
    },
  };
}
