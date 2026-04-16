import { useCallback, useEffect } from '../vendor/preact-htm.js';
import {
  applyModelStatePayload,
  loadAgentsBootstrap,
  refreshActiveChatAgents as refreshActiveChatAgentsState,
  refreshCurrentChatBranches as refreshCurrentChatBranchesState,
  refreshModelState as refreshModelStateForChat,
  updateAgentProfileFromEvent,
  updateUserProfileFromEvent,
} from './app-auth-bootstrap.js';
import { refreshModelAndQueueState as refreshModelAndQueueStateBundle } from './app-status-refresh-orchestration.js';
import { applyStoredSidebarWidth } from './app-boot-load-orchestration.js';
import {
  completeAppPerfTraceIfReady,
  getActiveAppPerfTraceId,
  markAppPerfTrace,
} from './app-perf-tracing.js';
import { prewarmTimelineSnapshots, resolveRecentTimelinePrewarmChatJids } from './app-timeline-cache.js';
import { getTimeline } from '../api.js';
import {
  noteAppChatActivation,
  runCoalescedAppRefresh,
} from './app-refresh-coordination.js';

type StateSetter<T> = (next: T | ((prev: T) => T)) => void;

interface RefBox<T> {
  current: T;
}

interface UseChatRefreshLifecycleOptions {
  getAgents: () => Promise<any>;
  setAgents: StateSetter<Record<string, unknown>>;
  setUserProfile: StateSetter<any>;
  applyBranding: (name: string, avatarUrl: string, avatarVersion?: string | null) => void;
  readStoredNumber: (key: string, fallback?: number | null) => number | null;
  sidebarWidthRef: RefBox<number>;
  appShellRef: RefBox<HTMLElement | null>;
  currentChatJid: string;
  currentRootChatJid: string;
  getAgentModels: (chatJid: string) => Promise<any>;
  getActiveChatAgents: (chatJid: string) => Promise<any>;
  getChatBranches: (chatJid: string | null, options?: Record<string, unknown>) => Promise<any>;
  activeChatJidRef: RefBox<string>;
  setActiveChatAgents: StateSetter<any[]>;
  setCurrentChatBranches: StateSetter<any[]>;
  setActiveModel: StateSetter<string | null>;
  setActiveThinkingLevel: StateSetter<string | null>;
  setSupportsThinking: StateSetter<boolean>;
  setActiveModelUsage: StateSetter<any>;
  setAgentModelsPayload: StateSetter<any>;
  setHasLoadedAgentModels: StateSetter<boolean>;
  agentsRef: RefBox<Record<string, unknown>>;
  refreshQueueState: () => void;
  refreshContextUsage: () => Promise<void>;
  refreshAutoresearchStatus: () => Promise<void>;
}

export function startModelAndQueueRefreshEffect(options: {
  refreshModelAndQueueState: () => void;
  refreshModelState: () => void;
  refreshActiveChatAgents: () => void;
  refreshCurrentChatBranches: () => void;
  refreshQueueState: () => void;
  runImmediately?: boolean;
  intervalMs?: number;
  scheduleInterval?: (handler: () => void, intervalMs: number) => unknown;
  clearScheduledInterval?: (handle: unknown) => void;
}): () => void {
  const {
    refreshModelAndQueueState,
    refreshModelState,
    refreshActiveChatAgents,
    refreshCurrentChatBranches,
    refreshQueueState,
    runImmediately = true,
    intervalMs = 60_000,
    scheduleInterval = (handler, delay) => setInterval(handler, delay),
    clearScheduledInterval = (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  } = options;

  if (runImmediately) {
    refreshModelAndQueueState();
  }
  const intervalHandle = scheduleInterval(() => {
    refreshModelState();
    refreshActiveChatAgents();
    refreshCurrentChatBranches();
    refreshQueueState();
  }, intervalMs);

  return () => {
    clearScheduledInterval(intervalHandle);
  };
}

export function refreshPostPaintThreadHydration(options: {
  refreshModelState: () => void;
  refreshActiveChatAgents: (options?: { prewarmRecent?: boolean; prewarmLimit?: number }) => void;
  refreshCurrentChatBranches: () => void;
  refreshQueueState: () => void;
  refreshContextUsage: () => Promise<void>;
  refreshAutoresearchStatus: () => Promise<void>;
  prewarmLimit?: number;
}): void {
  const {
    refreshModelState,
    refreshActiveChatAgents,
    refreshCurrentChatBranches,
    refreshQueueState,
    refreshContextUsage,
    refreshAutoresearchStatus,
    prewarmLimit = 5,
  } = options;

  refreshModelState();
  refreshActiveChatAgents({
    prewarmRecent: true,
    prewarmLimit,
  });
  refreshCurrentChatBranches();
  refreshQueueState();
  void refreshContextUsage();
  void refreshAutoresearchStatus();
}

export function prewarmRecentTimelineChats(options: {
  chats: unknown;
  currentChatJid: string;
  prewarmLimit?: number;
  fetchTimeline?: (chatJid: string) => Promise<{ posts?: any[]; has_more?: boolean }>;
}): void {
  const chatJids = resolveRecentTimelinePrewarmChatJids(options.chats, options.currentChatJid, options.prewarmLimit ?? 5);
  if (chatJids.length === 0) return;
  void prewarmTimelineSnapshots({
    chatJids,
    fetchTimeline: options.fetchTimeline ?? ((chatJid) => getTimeline(10, null, chatJid)),
  });
}

export function useChatRefreshLifecycle(options: UseChatRefreshLifecycleOptions) {
  const {
    getAgents,
    setAgents,
    setUserProfile,
    applyBranding,
    readStoredNumber,
    sidebarWidthRef,
    appShellRef,
    currentChatJid,
    currentRootChatJid,
    getAgentModels,
    getActiveChatAgents,
    getChatBranches,
    activeChatJidRef,
    setActiveChatAgents,
    setCurrentChatBranches,
    setActiveModel,
    setActiveThinkingLevel,
    setSupportsThinking,
    setActiveModelUsage,
    setAgentModelsPayload,
    setHasLoadedAgentModels,
    agentsRef,
    refreshQueueState,
    refreshContextUsage,
    refreshAutoresearchStatus,
  } = options;

  const loadAgents = useCallback(async () => {
    await loadAgentsBootstrap({
      getAgents,
      setAgents,
      setUserProfile,
      applyBranding,
    });
  }, [applyBranding, getAgents, setAgents, setUserProfile]);

  useEffect(() => {
    loadAgents();
    applyStoredSidebarWidth({
      readStoredNumber,
      sidebarWidthRef,
      shellElement: appShellRef.current,
    });
  }, [appShellRef, loadAgents, readStoredNumber, sidebarWidthRef]);

  useEffect(() => {
    noteAppChatActivation({ chatJid: currentChatJid });
  }, [currentChatJid]);

  const updateAgentProfile = useCallback((payload: any) => {
    updateAgentProfileFromEvent({
      payload,
      agentsRef,
      setAgents,
      applyBranding,
    });
  }, [agentsRef, applyBranding, setAgents]);

  const updateUserProfile = useCallback((payload: any) => {
    updateUserProfileFromEvent({
      payload,
      setUserProfile,
    });
  }, [setUserProfile]);

  const applyModelState = useCallback((payload: any) => {
    applyModelStatePayload({
      payload,
      setActiveModel,
      setActiveThinkingLevel,
      setSupportsThinking,
      setActiveModelUsage,
      setAgentModelsPayload,
      setHasLoadedAgentModels,
    });
  }, [setActiveModel, setActiveModelUsage, setActiveThinkingLevel, setAgentModelsPayload, setHasLoadedAgentModels, setSupportsThinking]);

  const getThreadSwitchTraceId = useCallback(() => getActiveAppPerfTraceId('thread-switch', currentChatJid), [currentChatJid]);

  const refreshModelState = useCallback(() => {
    return runCoalescedAppRefresh({
      kind: 'model-state',
      chatJid: currentChatJid,
      run: async () => {
        const traceId = getThreadSwitchTraceId();
        if (traceId) {
          markAppPerfTrace(traceId, 'runtime-hydration-start', {
            phase: 'model-state',
          });
        }
        await refreshModelStateForChat({
          currentChatJid,
          getAgentModels: async (chatJid: string) => {
            const activeTraceId = traceId || getThreadSwitchTraceId();
            if (activeTraceId) {
              markAppPerfTrace(activeTraceId, 'model-request-start', {
                chatJid,
              });
            }
            const payload = await getAgentModels(chatJid);
            if (activeTraceId) {
              markAppPerfTrace(activeTraceId, 'model-request-ready', {
                chatJid,
                hasCurrent: Boolean(payload?.current),
                modelCount: Array.isArray(payload?.models) ? payload.models.length : 0,
              });
            }
            return payload;
          },
          activeChatJidRef,
          applyModelState,
        });
        const activeTraceId = traceId || getThreadSwitchTraceId();
        if (activeTraceId) {
          markAppPerfTrace(activeTraceId, 'runtime-hydration-ready', {
            chatJid: currentChatJid,
          });
          completeAppPerfTraceIfReady(activeTraceId, ['runtime-hydration-ready', 'timeline-first-paint'], 'settled', {
            chatJid: currentChatJid,
          });
        }
        return null;
      },
    });
  }, [activeChatJidRef, applyModelState, currentChatJid, getAgentModels, getThreadSwitchTraceId]);

  const refreshActiveChatAgents = useCallback((options?: {
    prewarmRecent?: boolean;
    prewarmLimit?: number;
  }) => {
    const prewarmRecent = Boolean(options?.prewarmRecent);
    const prewarmLimit = Number.isFinite(options?.prewarmLimit) ? Number(options?.prewarmLimit) : 5;
    return runCoalescedAppRefresh({
      kind: 'active-chat-agents',
      chatJid: currentChatJid,
      run: async () => {
        const traceId = getThreadSwitchTraceId();
        const mergedChats = await refreshActiveChatAgentsState({
          currentChatJid,
          getActiveChatAgents: async () => {
            if (traceId) {
              markAppPerfTrace(traceId, 'active-chat-list-request-start', {
                chatJid: currentChatJid,
              });
            }
            const payload = await getActiveChatAgents(currentChatJid);
            if (traceId) {
              markAppPerfTrace(traceId, 'active-chat-list-request-ready', {
                rowCount: Array.isArray(payload?.chats) ? payload.chats.length : 0,
              });
            }
            return payload;
          },
          getChatBranches: async (rootChatJid: string | null, branchOptions?: Record<string, unknown>) => {
            if (traceId) {
              markAppPerfTrace(traceId, 'branch-list-request-start', {
                rootChatJid,
              });
            }
            const payload = await getChatBranches(rootChatJid, branchOptions);
            if (traceId) {
              markAppPerfTrace(traceId, 'branch-list-request-ready', {
                rootChatJid,
                rowCount: Array.isArray(payload?.chats) ? payload.chats.length : 0,
              });
            }
            return payload;
          },
          activeChatJidRef,
          setActiveChatAgents,
        });
        if (prewarmRecent) {
          prewarmRecentTimelineChats({
            chats: mergedChats,
            currentChatJid,
            prewarmLimit,
          });
        }
        return null;
      },
    });
  }, [activeChatJidRef, currentChatJid, getActiveChatAgents, getChatBranches, getThreadSwitchTraceId, setActiveChatAgents]);

  const refreshCurrentChatBranches = useCallback(() => {
    return runCoalescedAppRefresh({
      kind: 'current-chat-branches',
      chatJid: currentChatJid,
      run: async () => {
        const traceId = getThreadSwitchTraceId();
        await refreshCurrentChatBranchesState({
          currentRootChatJid,
          getChatBranches: async (rootChatJid: string | null, branchOptions?: Record<string, unknown>) => {
            if (traceId) {
              markAppPerfTrace(traceId, 'root-branch-request-start', {
                rootChatJid,
              });
            }
            const payload = await getChatBranches(rootChatJid, branchOptions);
            if (traceId) {
              markAppPerfTrace(traceId, 'root-branch-request-ready', {
                rootChatJid,
                rowCount: Array.isArray(payload?.chats) ? payload.chats.length : 0,
              });
            }
            return payload;
          },
          setCurrentChatBranches,
        });
        return null;
      },
    });
  }, [currentChatJid, currentRootChatJid, getChatBranches, getThreadSwitchTraceId, setCurrentChatBranches]);

  const refreshModelAndQueueState = useCallback(() => {
    refreshModelAndQueueStateBundle({
      refreshModelState,
      refreshActiveChatAgents,
      refreshCurrentChatBranches,
      refreshQueueState,
      refreshContextUsage,
      refreshAutoresearchStatus,
    });
  }, [refreshActiveChatAgents, refreshAutoresearchStatus, refreshContextUsage, refreshCurrentChatBranches, refreshModelState, refreshQueueState]);

  const refreshPostPaintThreadState = useCallback(() => {
    refreshPostPaintThreadHydration({
      refreshModelState,
      refreshActiveChatAgents,
      refreshCurrentChatBranches,
      refreshQueueState,
      refreshContextUsage,
      refreshAutoresearchStatus,
      prewarmLimit: 5,
    });
  }, [refreshActiveChatAgents, refreshAutoresearchStatus, refreshContextUsage, refreshCurrentChatBranches, refreshModelState, refreshQueueState]);

  useEffect(() => startModelAndQueueRefreshEffect({
    refreshModelAndQueueState,
    refreshModelState,
    refreshActiveChatAgents,
    refreshCurrentChatBranches,
    refreshQueueState,
    runImmediately: false,
  }), [refreshActiveChatAgents, refreshCurrentChatBranches, refreshModelAndQueueState, refreshModelState, refreshQueueState]);

  return {
    updateAgentProfile,
    updateUserProfile,
    applyModelState,
    refreshModelState,
    refreshActiveChatAgents,
    refreshCurrentChatBranches,
    refreshModelAndQueueState,
    refreshPostPaintThreadState,
  };
}
