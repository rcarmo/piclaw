import { useCallback, useEffect, useRef } from '../vendor/preact-htm.js';
import {
  applyModelStatePayload,
  loadAgentsBootstrap,
  refreshActiveChatAgents as refreshActiveChatAgentsState,
  refreshCurrentChatBranches as refreshCurrentChatBranchesState,
  updateAgentProfileFromEvent,
  updateUserProfileFromEvent,
} from './app-auth-bootstrap.js';
import {
  getContextSessionGeneration,
  getContextUsageRevision,
  haveSameContextUsage,
  normalizeContextUsage,
  reconcileContextUsageForChat,
  restoreContextUsage,
} from './app-status-refresh-orchestration.js';
import { refreshModelAndQueueState as refreshModelAndQueueStateBundle } from './app-status-refresh-orchestration.js';
import { applyStoredSidebarWidth } from './app-boot-load-orchestration.js';
import { clampSidebarWidth } from './use-splitters.js';
import {
  completeAppPerfTraceIfReady,
  getActiveAppPerfTraceId,
  markAppPerfTrace,
} from './app-perf-tracing.js';
import { prewarmTimelineSnapshots, resolveRecentTimelinePrewarmChatJids } from './app-timeline-cache.js';
import { getTimeline } from '../api.js';
import { mergeModelStatePayload } from './app-model-state.js';
import { createVisibleInterval } from './visible-interval.js';
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
  getAgentContext: (chatJid: string, options?: { isPeriodicCurrent?: () => boolean }) => Promise<any>;
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
  setContextUsage: StateSetter<any>;
  setExtensionWorkingState: StateSetter<{ message: string | null; indicator: unknown | null }>;
}

export function startModelAndQueueRefreshEffect(options: {
  refreshModelAndQueueState: () => void;
  refreshModelState: (options?: { periodic?: boolean }) => void;
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
    scheduleInterval = (handler, delay) => createVisibleInterval(handler, delay, { refreshOnVisible: false }),
    clearScheduledInterval = (handle) => {
      if (typeof handle === 'function') (handle as () => void)();
      else clearInterval(handle as ReturnType<typeof setInterval>);
    },
  } = options;

  if (runImmediately) {
    refreshModelAndQueueState();
  }
  const intervalHandle = scheduleInterval(() => {
    refreshModelState({ periodic: true });
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
    getAgentContext,
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
    setContextUsage,
    setExtensionWorkingState,
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
      maxWidth: clampSidebarWidth(Number.POSITIVE_INFINITY),
    });
  }, [appShellRef, loadAgents, readStoredNumber, sidebarWidthRef]);

  const modelStateRef = useRef<{ chatJid: string; payload: any; revision: number }>({ chatJid: currentChatJid, payload: null, revision: 0 });
  const activatedChatRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const explicitModelRefreshSequenceRef = useRef(0);
  const periodicScopeRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    const visibilityChanged = () => {
      if (document.visibilityState === 'hidden') periodicScopeRef.current++;
    };
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      mountedRef.current = false;
      periodicScopeRef.current++;
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, []);
  const applyModelState = useCallback((payload: any) => {
    if (!payload || activeChatJidRef.current !== currentChatJid) return;
    const previous = modelStateRef.current.chatJid === currentChatJid ? modelStateRef.current.payload : null;
    payload = mergeModelStatePayload(previous, payload);
    modelStateRef.current = { chatJid: currentChatJid, payload, revision: modelStateRef.current.revision + 1 };
    applyModelStatePayload({
      payload,
      setActiveModel,
      setActiveThinkingLevel,
      setSupportsThinking,
      setActiveModelUsage,
      setAgentModelsPayload,
      setHasLoadedAgentModels,
    });
  }, [currentChatJid, activeChatJidRef, setActiveModel, setActiveModelUsage, setActiveThinkingLevel, setAgentModelsPayload, setHasLoadedAgentModels, setSupportsThinking]);

  const getThreadSwitchTraceId = useCallback(() => getActiveAppPerfTraceId('thread-switch', currentChatJid), [currentChatJid]);

  const refreshModelState = useCallback((refreshOptions: { periodic?: boolean } = {}) => {
    const periodic = refreshOptions.periodic === true;
    const targetChatJid = currentChatJid;
    const periodicScope = periodicScopeRef.current;
    const scheduledRevision = modelStateRef.current.revision;
    // Keep explicit/full work in a different coalescing lane, and fence a
    // periodic response if an explicit request overtakes it.
    const explicitSequence = periodic
      ? explicitModelRefreshSequenceRef.current
      : ++explicitModelRefreshSequenceRef.current;
    const isPeriodicCurrent = () => (
      mountedRef.current
      && activeChatJidRef.current === targetChatJid
      && document.visibilityState !== 'hidden'
      && periodicScope === periodicScopeRef.current
      && scheduledRevision === modelStateRef.current.revision
      && explicitSequence === explicitModelRefreshSequenceRef.current
    );
    return runCoalescedAppRefresh({
      kind: periodic ? 'model-state-periodic' : 'model-state',
      chatJid: targetChatJid,
      run: async () => {
        if (periodic && !isPeriodicCurrent()) return null;
        const traceId = getThreadSwitchTraceId();
        if (traceId) {
          markAppPerfTrace(traceId, 'runtime-hydration-start', {
            phase: 'model-state',
          });
        }

        const revision = modelStateRef.current.revision;
        const expectedSessionGeneration = getContextSessionGeneration(targetChatJid);
        const expectedRevision = getContextUsageRevision(targetChatJid);
        try {
          const [modelPayload, contextPayloadRaw] = await Promise.all([
            (async () => {
              const activeTraceId = traceId || getThreadSwitchTraceId();
              if (activeTraceId) {
                markAppPerfTrace(activeTraceId, 'model-request-start', { chatJid: targetChatJid });
              }
              const payload = await getAgentModels(targetChatJid);
              if (activeTraceId) {
                markAppPerfTrace(activeTraceId, 'model-request-ready', {
                  chatJid: targetChatJid,
                  hasCurrent: Boolean(payload?.current),
                  modelCount: Array.isArray(payload?.models) ? payload.models.length : 0,
                });
              }
              return payload;
            })(),
            getAgentContext(targetChatJid, periodic ? { isPeriodicCurrent } : undefined).catch(() => null),
          ]);

          if (!mountedRef.current) return null;
          if (activeChatJidRef.current && activeChatJidRef.current !== targetChatJid) return null;
          if (revision !== modelStateRef.current.revision || (periodic && !isPeriodicCurrent())) return null;
          applyModelState(modelPayload);

          const contextPayload = normalizeContextUsage(contextPayloadRaw);
          setContextUsage((prev) => {
            const merged = reconcileContextUsageForChat(targetChatJid, prev, contextPayload, {
              authoritative: true,
              expectedSessionGeneration,
              expectedRevision,
            });
            if (haveSameContextUsage(prev, merged)) return prev;
            return merged;
          });
        } catch {
          if (!mountedRef.current || (activeChatJidRef.current && activeChatJidRef.current !== targetChatJid)) return null;
          if (periodic && !isPeriodicCurrent()) return null;
          // A failed/omitted snapshot is not an explicit selection clear.
          // Keep this chat's last successful metadata until recovery.
        }

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
  }, [activeChatJidRef, applyModelState, currentChatJid, getAgentContext, getAgentModels, getThreadSwitchTraceId, setContextUsage]);

  useEffect(() => {
    // Callback identities may change on a same-chat rerender. Only a real
    // activation may clear the display, not an otherwise unrelated render.
    if (activatedChatRef.current === currentChatJid) return;
    activatedChatRef.current = currentChatJid;
    modelStateRef.current = { chatJid: currentChatJid, payload: null, revision: modelStateRef.current.revision + 1 };
    noteAppChatActivation({ chatJid: currentChatJid });

    // Reset model/context state immediately so stale values from the
    // previous chat don't linger while async refreshes are in flight.
    setActiveModel(null);
    setActiveThinkingLevel(null);
    setSupportsThinking(false);
    setActiveModelUsage(null);
    setHasLoadedAgentModels(false);
    setAgentModelsPayload(null);
    setExtensionWorkingState({ message: null, indicator: null, visible: true });

    // Reuse only a value accepted in this page lifetime, then refresh from the SDK.
    const stored = restoreContextUsage(currentChatJid);
    if (stored) {
      setContextUsage(stored);
    } else {
      setContextUsage(null);
    }
    void refreshModelState();
  }, [currentChatJid, refreshModelState, setActiveModel, setActiveModelUsage, setActiveThinkingLevel, setAgentModelsPayload, setContextUsage, setExtensionWorkingState, setHasLoadedAgentModels, setSupportsThinking]);

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

  useEffect(() => createVisibleInterval(() => {
    void refreshModelState({ periodic: true });
  }, 5_000, { refreshOnVisible: false }), [refreshModelState]);

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
