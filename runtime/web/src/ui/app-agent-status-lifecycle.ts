import { useCallback, useEffect } from '../vendor/preact-htm.js';
import {
  refreshAutoresearchStatusForChat,
  refreshContextUsageForChat,
  refreshQueueStateForChat,
} from './app-status-refresh-orchestration.js';
import {
  reconcileSilentTurn as reconcileSilentTurnState,
  refreshAgentStatusForChat,
  runSilenceWatchdogTick,
} from './app-agent-status-orchestration.js';
import {
  handleConnectionStatusChangeEvent,
  handleUiVersionDriftEvent,
} from './app-connection-lifecycle.js';
import { runCoalescedAppRefresh } from './app-refresh-coordination.js';

interface RefBox<T> {
  current: T;
}

export function resolveSilenceWatchdogIntervalMs(silenceWarningMs: number): number {
  return Math.min(1000, Math.max(100, Math.floor(silenceWarningMs / 2)));
}

interface UseAgentStatusLifecycleOptions {
  currentChatJid: string;
  activeChatJidRef: RefBox<string>;
  queueRefreshGenRef: RefBox<number>;
  dismissedQueueRowIdsRef: RefBox<Set<string | number>>;
  getAgentQueueState: (chatJid: string) => Promise<any>;
  setFollowupQueueItems: (next: any) => void;
  clearQueuedSteerStateIfStale: (remainingQueueCount: number) => void;

  getAgentContext: ((chatJid: string) => Promise<any>) | null;
  setContextUsage: (next: any) => void;

  getAutoresearchStatus: ((chatJid: string) => Promise<any>) | null;
  setExtensionStatusPanels: (next: any) => void;
  setPendingExtensionPanelActions: (next: any) => void;

  getAgentStatus: (chatJid: string) => Promise<any>;
  wasAgentActiveRef: RefBox<boolean>;
  viewStateRef: RefBox<Record<string, unknown> | null | undefined>;
  refreshTimeline: () => Promise<void>;
  clearAgentRunState: () => void;
  agentStatusRef: RefBox<any>;
  pendingRequestRef: RefBox<any>;
  thoughtBufferRef: RefBox<string>;
  draftBufferRef: RefBox<string>;
  setAgentStatus: (next: any) => void;
  setAgentDraft: (next: any) => void;
  setAgentPlan: (next: any) => void;
  setAgentThought: (next: any) => void;
  setPendingRequest: (next: any) => void;
  setActiveTurn: (turnId: string | null | undefined) => void;
  noteAgentActivity: (options?: Record<string, unknown>) => void;
  clearLastActivityFlag: () => void;

  isAgentRunningRef: RefBox<boolean>;
  currentTurnIdRef: RefBox<string | null>;
  silentRecoveryRef: RefBox<{ inFlight: boolean; lastAttemptAt: number; turnId: string | null }>;
  silenceRefreshMs: number;

  lastAgentEventRef: RefBox<number | null>;
  lastSilenceNoticeRef: RefBox<number>;
  silenceWarningMs: number;
  silenceFinalizeMs: number;
  isCompactionStatus: (status: any) => boolean;

  serverVersionContext: {
    currentAppAssetVersion: string;
    staleUiVersionRef: RefBox<string | null>;
    staleUiReloadScheduledRef: RefBox<boolean>;
    tabStoreHasUnsaved: () => boolean;
    isAgentRunningRef: RefBox<boolean>;
    pendingRequestRef: RefBox<any>;
    showIntentToast: (title: string, detail?: string | null, kind?: string, durationMs?: number) => void;
  };

  setConnectionStatus: (status: string) => void;
  setPendingRequestForConnection: (next: any) => void;
  hasConnectedOnceRef: RefBox<boolean>;
}

export function useAgentStatusLifecycle(options: UseAgentStatusLifecycleOptions) {
  const {
    currentChatJid,
    activeChatJidRef,
    queueRefreshGenRef,
    dismissedQueueRowIdsRef,
    getAgentQueueState,
    setFollowupQueueItems,
    clearQueuedSteerStateIfStale,
    getAgentContext,
    setContextUsage,
    getAutoresearchStatus,
    setExtensionStatusPanels,
    setPendingExtensionPanelActions,
    getAgentStatus,
    wasAgentActiveRef,
    viewStateRef,
    refreshTimeline,
    clearAgentRunState,
    agentStatusRef,
    pendingRequestRef,
    thoughtBufferRef,
    draftBufferRef,
    setAgentStatus,
    setAgentDraft,
    setAgentPlan,
    setAgentThought,
    setPendingRequest,
    setActiveTurn,
    noteAgentActivity,
    clearLastActivityFlag,
    isAgentRunningRef,
    currentTurnIdRef,
    silentRecoveryRef,
    silenceRefreshMs,
    lastAgentEventRef,
    lastSilenceNoticeRef,
    silenceWarningMs,
    silenceFinalizeMs,
    isCompactionStatus,
    serverVersionContext,
    setConnectionStatus,
    setPendingRequestForConnection,
    hasConnectedOnceRef,
  } = options;

  const refreshQueueState = useCallback(() => {
    return runCoalescedAppRefresh({
      kind: 'queue-state',
      chatJid: currentChatJid,
      run: async () => {
        await refreshQueueStateForChat({
          currentChatJid,
          queueRefreshGenRef,
          activeChatJidRef,
          dismissedQueueRowIdsRef,
          getAgentQueueState,
          setFollowupQueueItems,
          clearQueuedSteerStateIfStale,
        });
        return null;
      },
    });
  }, [activeChatJidRef, clearQueuedSteerStateIfStale, currentChatJid, dismissedQueueRowIdsRef, getAgentQueueState, queueRefreshGenRef, setFollowupQueueItems]);

  const refreshContextUsage = useCallback(async () => {
    await runCoalescedAppRefresh({
      kind: 'context-usage',
      chatJid: currentChatJid,
      run: async () => {
        await refreshContextUsageForChat({
          currentChatJid,
          activeChatJidRef,
          getAgentContext,
          setContextUsage,
        });
        return null;
      },
    });
  }, [activeChatJidRef, currentChatJid, getAgentContext, setContextUsage]);

  const refreshAutoresearchStatus = useCallback(async () => {
    await runCoalescedAppRefresh({
      kind: 'autoresearch-status',
      chatJid: currentChatJid,
      run: async () => {
        await refreshAutoresearchStatusForChat({
          currentChatJid,
          activeChatJidRef,
          getAutoresearchStatus,
          setExtensionStatusPanels,
          setPendingExtensionPanelActions,
        });
        return null;
      },
    });
  }, [activeChatJidRef, currentChatJid, getAutoresearchStatus, setExtensionStatusPanels, setPendingExtensionPanelActions]);

  const refreshAgentStatus = useCallback(async () => {
    return await runCoalescedAppRefresh({
      kind: 'agent-status',
      chatJid: currentChatJid,
      run: async () => {
        return await refreshAgentStatusForChat({
          currentChatJid,
          getAgentStatus,
          activeChatJidRef,
          wasAgentActiveRef,
          viewStateRef,
          refreshTimeline,
          clearAgentRunState,
          agentStatusRef,
          pendingRequestRef,
          thoughtBufferRef,
          draftBufferRef,
          setAgentStatus,
          setAgentDraft,
          setAgentPlan,
          setAgentThought,
          setPendingRequest,
          setActiveTurn,
          noteAgentActivity,
          clearLastActivityFlag,
        });
      },
    });
  }, [activeChatJidRef, agentStatusRef, clearAgentRunState, clearLastActivityFlag, currentChatJid, draftBufferRef, getAgentStatus, noteAgentActivity, pendingRequestRef, refreshTimeline, setActiveTurn, setAgentDraft, setAgentPlan, setAgentStatus, setAgentThought, setPendingRequest, thoughtBufferRef, viewStateRef, wasAgentActiveRef]);

  const reconcileSilentTurn = useCallback(async () => {
    return await reconcileSilentTurnState({
      isAgentRunningRef,
      pendingRequestRef,
      currentTurnIdRef,
      silentRecoveryRef,
      silenceRefreshMs,
      viewStateRef,
      refreshTimeline,
      refreshQueueState,
      refreshAgentStatus,
    });
  }, [currentTurnIdRef, isAgentRunningRef, pendingRequestRef, refreshAgentStatus, refreshQueueState, refreshTimeline, silenceRefreshMs, silentRecoveryRef, viewStateRef]);

  useEffect(() => {
    const intervalMs = resolveSilenceWatchdogIntervalMs(silenceWarningMs);
    const interval = setInterval(() => {
      runSilenceWatchdogTick({
        isAgentRunningRef,
        pendingRequestRef,
        lastAgentEventRef,
        lastSilenceNoticeRef,
        agentStatusRef,
        silenceWarningMs,
        silenceFinalizeMs,
        silenceRefreshMs,
        isCompactionStatus,
        setAgentStatus,
        reconcileSilentTurn,
      });
    }, intervalMs);

    return () => clearInterval(interval);
  }, [agentStatusRef, isAgentRunningRef, isCompactionStatus, lastAgentEventRef, lastSilenceNoticeRef, pendingRequestRef, reconcileSilentTurn, setAgentStatus, silenceFinalizeMs, silenceRefreshMs, silenceWarningMs]);

  const handleUiVersionDrift = useCallback((serverVersion: string) => {
    return handleUiVersionDriftEvent({
      serverVersion,
      ...serverVersionContext,
    });
  }, [serverVersionContext]);

  const handleConnectionStatusChange = useCallback((status: string) => {
    handleConnectionStatusChangeEvent({
      currentChatJid,
      status,
      setConnectionStatus,
      setAgentStatus,
      setAgentDraft,
      setAgentPlan,
      setAgentThought,
      setPendingRequest: setPendingRequestForConnection,
      pendingRequestRef,
      clearAgentRunState,
      hasConnectedOnceRef,
      viewStateRef,
      refreshTimeline,
      refreshAgentStatus,
      refreshQueueState,
      refreshContextUsage,
    });
  }, [clearAgentRunState, currentChatJid, hasConnectedOnceRef, pendingRequestRef, refreshAgentStatus, refreshContextUsage, refreshQueueState, refreshTimeline, setAgentDraft, setAgentPlan, setAgentStatus, setAgentThought, setConnectionStatus, setPendingRequestForConnection, viewStateRef]);

  return {
    refreshQueueState,
    refreshContextUsage,
    refreshAutoresearchStatus,
    refreshAgentStatus,
    handleUiVersionDrift,
    handleConnectionStatusChange,
  };
}
