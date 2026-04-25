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

function haveSameJsonValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
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
    setAgentModelsPayload?.((prev) => haveSameJsonValue(prev, payload) ? prev : (payload as Record<string, unknown>));
    setHasLoadedAgentModels?.(true);
  }

  const modelUpdate = resolveModelStateUpdate(payload);
  if (modelUpdate.hasModel) setActiveModel((prev) => Object.is(prev, modelUpdate.model) ? prev : modelUpdate.model);
  if (modelUpdate.hasThinkingLevel) {
    const nextThinkingLevel = modelUpdate.thinkingLevelLabel ?? modelUpdate.thinkingLevel;
    setActiveThinkingLevel((prev) => Object.is(prev, nextThinkingLevel) ? prev : nextThinkingLevel);
  }
  if (modelUpdate.hasSupportsThinking) setSupportsThinking((prev) => prev === modelUpdate.supportsThinking ? prev : modelUpdate.supportsThinking);
  if (modelUpdate.hasProviderUsage) setActiveModelUsage((prev) => haveSameJsonValue(prev, modelUpdate.providerUsage) ? prev : modelUpdate.providerUsage);
}

export interface RefreshModelStateOptions {
  currentChatJid: string;
  getAgentModels: (chatJid: string) => Promise<any>;
  activeChatJidRef: { current: string };
  applyModelState: (payload: Record<string, unknown> | null | undefined) => void;
}

export async function refreshModelState(options: RefreshModelStateOptions): Promise<void> {
  const {
    currentChatJid,
    getAgentModels,
    activeChatJidRef,
    applyModelState,
  } = options;

  const targetChatJid = currentChatJid;
  try {
    const payload = await getAgentModels(targetChatJid);
    if (activeChatJidRef.current && activeChatJidRef.current !== targetChatJid) return;
    if (payload) applyModelState(payload);
  } catch {
    if (activeChatJidRef.current && activeChatJidRef.current !== targetChatJid) return;
    applyModelState(null);
  }
}

export interface RefreshActiveChatAgentsOptions {
  currentChatJid: string;
  getActiveChatAgents: () => Promise<{ chats?: unknown[] }>;
  getChatBranches: (rootChatJid: string | null, options?: Record<string, unknown>) => Promise<{ chats?: unknown[] }>;
  activeChatJidRef: { current: string };
  setActiveChatAgents: StateSetter<any[]>;
}

export async function refreshActiveChatAgents(options: RefreshActiveChatAgentsOptions): Promise<any[]> {
  const {
    currentChatJid,
    getActiveChatAgents,
    getChatBranches,
    activeChatJidRef,
    setActiveChatAgents,
  } = options;

  const targetChatJid = currentChatJid;

  try {
    const [activePayload, branchPayload] = await Promise.all([
      getActiveChatAgents().catch(() => ({ chats: [] /* expected: active-agent refresh is best-effort. */ })),
      getChatBranches(null, { includeArchived: true }).catch(() => ({ chats: [] /* expected: archived-branch refresh is best-effort. */ })),
    ]);

    if (activeChatJidRef.current !== targetChatJid) return [];

    const activeChats = normalizeActiveChatRows(activePayload?.chats);
    const branchChats = normalizeActiveChatRows(branchPayload?.chats);
    const mergedChats = mergeActiveAndBranchChats(activeChats, branchChats, targetChatJid);
    setActiveChatAgents(mergedChats);
    return mergedChats;
  } catch {
    if (activeChatJidRef.current !== targetChatJid) return [];
    setActiveChatAgents([]);
    return [];
  }
}

export interface RefreshCurrentChatBranchesOptions {
  currentRootChatJid: string;
  getChatBranches: (rootChatJid: string | null, options?: Record<string, unknown>) => Promise<{ chats?: unknown[] }>;
  setCurrentChatBranches: StateSetter<any[]>;
}

export async function refreshCurrentChatBranches(options: RefreshCurrentChatBranchesOptions): Promise<void> {
  const {
    currentRootChatJid,
    getChatBranches,
    setCurrentChatBranches,
  } = options;

  try {
    const payload = await getChatBranches(currentRootChatJid);
    setCurrentChatBranches(normalizeCurrentRootBranchRows(payload?.chats));
  } catch {
    setCurrentChatBranches([]);
  }
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
