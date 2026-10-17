/**
 * channels/web/channel-endpoint-context-factory.ts – Builds endpoint contexts for WebChannel handlers.
 */

import { getDb, getLatestTokenUsage, getTokenUsageTotals, replaceMessageContent } from "../../../db.js";
import { resolveAvatarUrl } from "../media/avatar-service.js";
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import type { AuthEndpointsContext } from "../auth/auth-endpoints.js";
import {
  createAgentStatusContext,
  createAgentsEndpointContext,
  createAvatarEndpointContext,
  createContentEndpointsContext,
  createPostMutationsContext,
  createUiEndpointsContext,
} from "./endpoint-contexts.js";
import { isProviderReadyOobeCompletedForInstance } from "../oobe-instance-state.js";
import type { AgentStatusContext, AgentTokenUsageContext } from "../agent/agent-status.js";
import type { ContentEndpointsContext } from "./content-endpoints.js";
import type { AgentsEndpointContext, AvatarEndpointContext } from "./identity-endpoints.js";
import type { PostMutationsContext } from "../post-mutations.js";
import type { UiEndpointsContext } from "./ui-endpoints.js";

/** Live identity/avatar snapshot consumed by endpoint facade/context builders. */
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

/** Lazily built endpoint contexts consumed by WebChannel handlers. */
function normalizeStoredContextUsage(value: Record<string, unknown> | null): {
  tokens: number | null;
  contextWindow: number | null;
  percent: number | null;
  sessionGeneration: string;
} | null {
  if (!value) return null;
  const sessionGeneration = typeof value.sessionGeneration === "string" ? value.sessionGeneration.trim() : "";
  if (!sessionGeneration) return null;
  const tokens = typeof value.tokens === "number" && Number.isFinite(value.tokens) ? value.tokens : null;
  const contextWindow = typeof value.contextWindow === "number" && Number.isFinite(value.contextWindow)
    ? value.contextWindow
    : null;
  const percent = typeof value.percent === "number" && Number.isFinite(value.percent) ? value.percent : null;
  return { tokens, contextWindow, percent, sessionGeneration };
}

function getTokenUsageForChat(chatJid: string): AgentTokenUsageContext | null {
  try {
    const latest = getLatestTokenUsage(chatJid);
    const totals = getTokenUsageTotals(chatJid);
    return latest || totals.runs > 0 ? { latest, totals } : null;
  } catch (error) {
    if (error instanceof Error && (error.message === "Database not initialized" || error.message.includes("closed database"))) {
      return null;
    }
    throw error;
  }
}

export interface WebChannelEndpointContexts {
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
    postMutations: () => createPostMutationsContext({
      defaultChatJid: options.defaultChatJid,
      getLastCommandInteractionId: () => channel.lastCommandInteractionId,
      json: (payload, status = 200) => channel.json(payload, status),
      replaceMessageContent: (chatJid, id, content) => replaceMessageContent(chatJid, id, content, {}) ?? null,
      setThreadId: (messageId, threadId) => {
        getDb().prepare("UPDATE messages SET thread_id = ? WHERE rowid = ?").run(threadId, messageId);
      },
      broadcastInteractionUpdated: (interaction) => {
        channel.interactionBroadcaster.broadcastInteractionUpdated(interaction);
      },
      storeMessage: (chatJid, content, isBot, mediaIds, storeOptions = {}) =>
        channel.storeMessage(chatJid, content, isBot, mediaIds, storeOptions),
      broadcastAgentResponse: (interaction) => {
        channel.interactionBroadcaster.broadcastAgentResponse(interaction);
      },
    }),

    agentStatus: () => {
      if (!agentStatusContext) {
        agentStatusContext = createAgentStatusContext({
          defaultChatJid: options.defaultChatJid,
          json: (payload, status = 200) => channel.json(payload, status),
          getAgentStatus: (chatJid) => channel.getAgentStatus(chatJid),
          getExtensionWorkingState: (chatJid) => channel.getExtensionWorkingState?.(chatJid) ?? null,
          recoverStaleInflightRun: (chatJid, recoveryOptions) => channel.recoverStaleInflightRun(chatJid, recoveryOptions),
          getBuffer: (turnId, panel) => channel.getBuffer(turnId, panel),
          getContextUsageForChat: async (chatJid) => {
            const runtimeUsage = await channel.agentPool.getContextUsageForChat(chatJid).catch(() => null);
            const currentGeneration = typeof channel.agentPool.getSessionGenerationForChat === "function"
              ? channel.agentPool.getSessionGenerationForChat(chatJid)
              : null;
            const runtimeGeneration = typeof runtimeUsage?.sessionGeneration === "string"
              ? runtimeUsage.sessionGeneration.trim()
              : "";
            const storedUsage = normalizeStoredContextUsage(
              typeof channel.getContextUsage === "function" ? channel.getContextUsage(chatJid) : null,
            );
            const authoritativeGeneration = currentGeneration || runtimeGeneration || storedUsage?.sessionGeneration || null;
            const currentRuntimeUsage = runtimeUsage && (!authoritativeGeneration || runtimeGeneration === authoritativeGeneration)
              ? runtimeUsage
              : null;
            const currentStoredUsage = storedUsage && (!authoritativeGeneration || storedUsage.sessionGeneration === authoritativeGeneration)
              ? storedUsage
              : null;

            // Durable readers know that current counts are unknown, including after
            // compaction. A same-session stored estimate cannot make them current.
            if (currentRuntimeUsage?.tokensAreAuthoritative) return currentRuntimeUsage;
            if (currentRuntimeUsage?.tokens !== null && currentRuntimeUsage?.tokens !== undefined) return currentRuntimeUsage;
            if (currentStoredUsage?.tokens !== null && currentStoredUsage?.tokens !== undefined) return currentStoredUsage;
            if (currentRuntimeUsage) return currentRuntimeUsage;
            if (currentStoredUsage) return currentStoredUsage;
            return authoritativeGeneration
              ? { tokens: null, contextWindow: null, percent: null, sessionGeneration: authoritativeGeneration }
              : null;
          },
          getSessionTreeSummaryForChat: typeof channel.agentPool.getSessionTreeSummaryForChat === "function"
            ? (chatJid) => channel.agentPool.getSessionTreeSummaryForChat(chatJid)
            : undefined,
          getTokenUsageForChat,
          getAvailableModels: (chatJid, modelOptions) => channel.agentPool.getAvailableModels(chatJid, modelOptions),
          getProviderReadyCompletedForInstance: () => isProviderReadyOobeCompletedForInstance(),
        });
      }
      return agentStatusContext;
    },

    content: () => {
      if (!contentContext) {
        contentContext = createContentEndpointsContext({
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
        });
      }
      return contentContext;
    },

    ui: () => {
      if (!uiContext) {
        uiContext = createUiEndpointsContext({
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
        });
      }
      return uiContext;
    },

    agents: () => {
      const identity = options.getIdentitySnapshot();
      return createAgentsEndpointContext({
        agentPool: channel.agentPool,
        defaultChatJid: options.defaultChatJid,
        defaultAgentId: options.defaultAgentId,
        agentName: identity.assistantName,
        agentAvatar: identity.agentAvatarUrl,
        userName: identity.userName,
        userAvatar: identity.userAvatarUrl,
        userAvatarBackground: identity.userAvatarBackground,
        json: (payload, status = 200) => channel.json(payload, status),
      });
    },

    avatar: () => {
      const identity = options.getIdentitySnapshot();
      return createAvatarEndpointContext({
        assistantAvatar: identity.assistantAvatarRaw,
        userAvatar: identity.userAvatarRaw,
        json: (payload, status = 200) => channel.json(payload, status),
      });
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
