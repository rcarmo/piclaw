import { buildAgentsMap } from './app-helpers.js';
import { mergeActiveAndBranchChats, normalizeActiveChatRows, normalizeCurrentRootBranchRows } from './app-chat-agents.js';
import { resolveModelStateUpdate } from './app-model-state.js';
import {
  resolveAgentProfilePatch,
  resolveDefaultAgentBrandingPayload,
  resolveUserProfileFromAgentsPayload,
  resolveUserProfileUpdate,
} from './app-profile-events.js';
import { shouldRefreshQueueStateFromResponse } from './app-followup-queue.js';

type StateSetter<T> = (next: T | ((prev: T) => T)) => void;

export interface UserProfileState {
  name: string;
  avatar_url: string | null;
  avatar_background: string | null;
}

export interface LoadAgentsBootstrapOptions {
  getAgents: () => Promise<any>;
  setAgents: StateSetter<Record<string, any>>;
  setUserProfile: StateSetter<UserProfileState>;
  applyBranding: (name: unknown, avatarUrl: unknown, avatarVersion?: number | null) => void;
}

export async function loadAgentsBootstrap(options: LoadAgentsBootstrapOptions): Promise<void> {
  const {
    getAgents,
    setAgents,
    setUserProfile,
    applyBranding,
  } = options;

  try {
    const data = await getAgents();
    setAgents(buildAgentsMap(data));

    const nextUser = data?.user || {};
    setUserProfile((prev) => resolveUserProfileFromAgentsPayload(prev, nextUser));

    const branding = resolveDefaultAgentBrandingPayload(data?.agents);
    applyBranding(branding.name, branding.avatarUrl);
  } catch (error) {
    console.warn('Failed to load agents:', error);
  }
}

export interface UpdateAgentProfileOptions {
  payload: Record<string, unknown> | null | undefined;
  agentsRef: { current: Record<string, any> | null | undefined };
  setAgents: StateSetter<Record<string, any>>;
  applyBranding: (name: unknown, avatarUrl: unknown, avatarVersion?: number | null) => void;
}

export function updateAgentProfileFromEvent(options: UpdateAgentProfileOptions): void {
  const {
    payload,
    agentsRef,
    setAgents,
    applyBranding,
  } = options;

  const patch = resolveAgentProfilePatch(
    payload,
    payload?.agent_id ? agentsRef.current?.[String(payload.agent_id)] || { id: String(payload.agent_id) } : null,
  );
  if (!patch) return;

  setAgents((prev) => {
    const currentEntry = prev[patch.agentId] || { id: patch.agentId };
    const updated = { ...currentEntry };
    if (patch.nameChanged) updated.name = patch.resolvedName;
    if (patch.avatarChanged) updated.avatar_url = patch.resolvedAvatar;
    return { ...prev, [patch.agentId]: updated };
  });

  if (patch.agentId === 'default') {
    applyBranding(patch.resolvedName, patch.resolvedAvatar, patch.avatarChanged ? Date.now() : null);
  }
}

export interface UpdateUserProfileOptions {
  payload: Record<string, unknown> | null | undefined;
  setUserProfile: StateSetter<UserProfileState>;
}

export function updateUserProfileFromEvent(options: UpdateUserProfileOptions): void {
  const { payload, setUserProfile } = options;
  setUserProfile((prev) => resolveUserProfileUpdate(prev, payload));
}

export interface ApplyModelStateOptions {
  payload: Record<string, unknown> | null | undefined;
  setActiveModel: StateSetter<unknown>;
  setActiveThinkingLevel: StateSetter<unknown>;
  setSupportsThinking: StateSetter<boolean>;
  setActiveModelUsage: StateSetter<unknown>;
  setAgentModelsPayload?: StateSetter<Record<string, unknown> | null>;
  setHasLoadedAgentModels?: StateSetter<boolean>;
}

export function applyModelStatePayload(options: ApplyModelStateOptions): void {
  const {
    payload,
    setActiveModel,
    setActiveThinkingLevel,
    setSupportsThinking,
    setActiveModelUsage,
    setAgentModelsPayload,
    setHasLoadedAgentModels,
  } = options;

  if (payload && typeof payload === 'object') {
    setAgentModelsPayload?.(payload as Record<string, unknown>);
    setHasLoadedAgentModels?.(true);
  }

  const modelUpdate = resolveModelStateUpdate(payload);
  if (modelUpdate.hasModel) setActiveModel(modelUpdate.model);
  if (modelUpdate.hasThinkingLevel) setActiveThinkingLevel(modelUpdate.thinkingLevelLabel ?? modelUpdate.thinkingLevel);
  if (modelUpdate.hasSupportsThinking) setSupportsThinking(modelUpdate.supportsThinking);
  if (modelUpdate.hasProviderUsage) setActiveModelUsage(modelUpdate.providerUsage);
}

export interface RefreshModelStateOptions {
  currentChatJid: string;
  getAgentModels: (chatJid: string) => Promise<any>;
  activeChatJidRef: { current: string };
  applyModelState: (payload: Record<string, unknown> | null | undefined) => void;
}

export function refreshModelState(options: RefreshModelStateOptions): void {
  const {
    currentChatJid,
    getAgentModels,
    activeChatJidRef,
    applyModelState,
  } = options;

  const targetChatJid = currentChatJid;
  getAgentModels(targetChatJid)
    .then((payload) => {
      if (activeChatJidRef.current && activeChatJidRef.current !== targetChatJid) return;
      if (payload) applyModelState(payload);
    })
    .catch(() => {
      if (activeChatJidRef.current && activeChatJidRef.current !== targetChatJid) return;
      applyModelState(null);
    });
}

export interface RefreshActiveChatAgentsOptions {
  currentChatJid: string;
  getActiveChatAgents: () => Promise<{ chats?: unknown[] }>;
  getChatBranches: (rootChatJid: string | null, options?: Record<string, unknown>) => Promise<{ chats?: unknown[] }>;
  activeChatJidRef: { current: string };
  setActiveChatAgents: StateSetter<any[]>;
}

export function refreshActiveChatAgents(options: RefreshActiveChatAgentsOptions): void {
  const {
    currentChatJid,
    getActiveChatAgents,
    getChatBranches,
    activeChatJidRef,
    setActiveChatAgents,
  } = options;

  const targetChatJid = currentChatJid;

  Promise.all([
    getActiveChatAgents().catch(() => ({ chats: [] /* expected: active-agent refresh is best-effort. */ })),
    getChatBranches(null, { includeArchived: true }).catch(() => ({ chats: [] /* expected: archived-branch refresh is best-effort. */ })),
  ])
    .then(([activePayload, branchPayload]) => {
      if (activeChatJidRef.current !== targetChatJid) return;

      const activeChats = normalizeActiveChatRows(activePayload?.chats);
      const branchChats = normalizeActiveChatRows(branchPayload?.chats);
      setActiveChatAgents(mergeActiveAndBranchChats(activeChats, branchChats, targetChatJid));
    })
    .catch(() => {
      if (activeChatJidRef.current !== targetChatJid) return;
      setActiveChatAgents([]);
    });
}

export interface RefreshCurrentChatBranchesOptions {
  currentRootChatJid: string;
  getChatBranches: (rootChatJid: string | null, options?: Record<string, unknown>) => Promise<{ chats?: unknown[] }>;
  setCurrentChatBranches: StateSetter<any[]>;
}

export function refreshCurrentChatBranches(options: RefreshCurrentChatBranchesOptions): void {
  const {
    currentRootChatJid,
    getChatBranches,
    setCurrentChatBranches,
  } = options;

  getChatBranches(currentRootChatJid)
    .then((payload) => {
      setCurrentChatBranches(normalizeCurrentRootBranchRows(payload?.chats));
    })
    .catch(() => {
      setCurrentChatBranches([]);
    });
}

export interface HandleMessageResponseOptions {
  response: Record<string, unknown> | null | undefined;
  refreshActiveChatAgents: () => void;
  refreshCurrentChatBranches: () => void;
  refreshContextUsage: () => void;
  refreshAutoresearchStatus: () => void;
  refreshQueueState: () => void;
}

export function handleMessageResponseRefresh(options: HandleMessageResponseOptions): void {
  const {
    response,
    refreshActiveChatAgents,
    refreshCurrentChatBranches,
    refreshContextUsage,
    refreshAutoresearchStatus,
    refreshQueueState,
  } = options;

  if (!response || typeof response !== 'object') return;

  refreshActiveChatAgents();
  refreshCurrentChatBranches();
  void refreshContextUsage();
  void refreshAutoresearchStatus();

  if (shouldRefreshQueueStateFromResponse(response)) {
    refreshQueueState();
  }
}
