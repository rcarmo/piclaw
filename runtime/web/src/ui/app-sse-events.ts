import { applyThemeFromEvent } from './theme.js';
import { applyMetersFromEvent } from './meters.js';
import {
  applyDraftDeltaBuffer,
  applyThoughtDeltaBuffer,
  buildCollapsedAgentPreviewState,
  buildExpandedAgentPreviewState,
  resolveAgentPlanText,
} from './app-agent-previews.js';
import {
  resolveSteerQueuedTurnId,
  shouldAdoptIncomingTurn,
  shouldIgnoreMismatchedTurn,
} from './app-agent-turn-events.js';
import { readAgentTurnId, resolveAgentPreviewRestoreState } from './app-agent-status-refresh.js';
import { resolveLiveGeneratedWidgetEvent } from './app-generated-widget-events.js';
import {
  appendUniqueTimelinePost,
  isMainTimelineView,
  removeTimelinePostsByIds,
  replaceTimelinePostById,
  shouldAppendRealtimeTimelinePost,
  shouldMutateInteractionTimeline,
} from './app-realtime-timeline.js';
import { appendFollowupQueueItem, removeFollowupQueueRow } from './app-followup-queue.js';
import { resolveFollowupQueueRemovalPlan } from './app-followup-actions.js';
import {
  applyStatusPanelWidgetEvent,
  clearPendingPanelActionPrefix,
  shouldClearPendingPanelActions,
} from './app-extension-status.js';
import {
  resolveExtensionUiToast,
  resolveStatusPanelWidgetEventContext,
} from './app-extension-ui-sse.js';
import { dispatchExtensionUiBrowserEvent, isExtensionUiEventType } from './extension-ui-events.js';
import { clearLiveFloatingWidgetState } from './app-floating-widget.js';
import {
  isNoisyAgentSseEvent,
  resolveSseEventRoutingContext,
} from './app-sse-event-routing.js';
import { isAppChatActivationRecent } from './app-refresh-coordination.js';

type StateSetter<T> = (next: T | ((prev: T) => T)) => void;

interface RefBox<T> {
  current: T;
}

export interface HandleAppSseEventDependencies {
  currentChatJid: string;
  updateAgentProfile: (payload: any) => void;
  updateUserProfile: (payload: any) => void;

  currentTurnIdRef: RefBox<string | null>;
  activeChatJidRef: RefBox<string>;
  pendingRequestRef: RefBox<any>;
  draftBufferRef: RefBox<string>;
  thoughtBufferRef: RefBox<string>;
  steerQueuedTurnIdRef: RefBox<string | null>;
  thoughtExpandedRef: RefBox<boolean>;
  draftExpandedRef: RefBox<boolean>;
  draftThrottleRef: RefBox<number>;
  thoughtThrottleRef: RefBox<number>;
  viewStateRef: RefBox<Record<string, unknown> | null | undefined>;
  followupQueueItemsRef: RefBox<any[]>;
  dismissedQueueRowIdsRef: RefBox<Set<string | number>>;
  scrollToBottomRef: RefBox<(() => void) | null>;
  hasMoreRef: RefBox<boolean>;
  loadMoreRef: RefBox<((options?: Record<string, unknown>) => void) | null>;
  lastAgentResponseRef: RefBox<{ post: any; turnId: string | null } | null>;
  wasAgentActiveRef: RefBox<boolean>;

  setActiveTurn: (turnId: string | null | undefined) => void;
  applyLiveGeneratedWidgetUpdate: (payload: any, fallbackStatus?: string) => void;
  setFloatingWidget: StateSetter<any>;
  clearLastActivityFlag: () => void;
  handleUiVersionDrift: (serverVersion: any) => boolean;
  setAgentStatus: StateSetter<any>;
  setAgentDraft: StateSetter<any>;
  setAgentPlan: StateSetter<any>;
  setAgentThought: StateSetter<any>;
  setPendingRequest: StateSetter<any>;
  clearAgentRunState: () => void;
  getAgentStatus: (chatJid: string) => Promise<any>;
  noteAgentActivity: (options?: Record<string, unknown>) => void;
  showLastActivity: (payload: any) => void;
  refreshTimeline: () => Promise<void> | void;
  refreshModelAndQueueState: () => void;
  refreshActiveChatAgents: () => Promise<unknown> | void;
  refreshCurrentChatBranches: () => Promise<unknown> | void;
  notifyForFinalResponse: (turnId: string | null | undefined) => void;
  setContextUsage: StateSetter<any>;
  refreshContextUsage: () => Promise<void> | void;
  refreshQueueState: () => Promise<void> | void;
  setFollowupQueueItems: StateSetter<any[]>;
  clearQueuedSteerStateIfStale: (remainingQueueCount: number) => void;
  setSteerQueuedTurnId: StateSetter<string | null>;
  applyModelState: (payload: any) => void;
  getAgentContext: (chatJid: string) => Promise<any>;
  setExtensionStatusPanels: StateSetter<Map<string, any>>;
  setPendingExtensionPanelActions: StateSetter<Set<string>>;
  refreshActiveEditorFromWorkspace: (updates: any) => Promise<void> | void;
  showIntentToast: (title: string, detail?: string | null, kind?: string, durationMs?: number) => void;
  removeStalledPost: () => void;
  setPosts: StateSetter<any[] | null>;
  preserveTimelineScrollTop: (mutate: () => void) => void;
}

/**
 * Handles authenticated shell SSE events while keeping routing and payload semantics stable.
 */
export function handleAppSseEvent(
  eventType: string,
  data: any,
  deps: HandleAppSseEventDependencies,
): void {
  const {
    currentChatJid,
    updateAgentProfile,
    updateUserProfile,

    currentTurnIdRef,
    activeChatJidRef,
    pendingRequestRef,
    draftBufferRef,
    thoughtBufferRef,
    steerQueuedTurnIdRef,
    thoughtExpandedRef,
    draftExpandedRef,
    draftThrottleRef,
    thoughtThrottleRef,
    viewStateRef,
    followupQueueItemsRef,
    dismissedQueueRowIdsRef,
    scrollToBottomRef,
    hasMoreRef,
    loadMoreRef,
    lastAgentResponseRef,
    wasAgentActiveRef,

    setActiveTurn,
    applyLiveGeneratedWidgetUpdate,
    setFloatingWidget,
    clearLastActivityFlag,
    handleUiVersionDrift,
    setAgentStatus,
    setAgentDraft,
    setAgentPlan,
    setAgentThought,
    setPendingRequest,
    clearAgentRunState,
    getAgentStatus,
    noteAgentActivity,
    showLastActivity,
    refreshTimeline,
    refreshModelAndQueueState,
    refreshActiveChatAgents,
    refreshCurrentChatBranches,
    notifyForFinalResponse,
    setContextUsage,
    refreshContextUsage,
    refreshQueueState,
    setFollowupQueueItems,
    clearQueuedSteerStateIfStale,
    setSteerQueuedTurnId,
    applyModelState,
    getAgentContext,
    setExtensionStatusPanels,
    setPendingExtensionPanelActions,
    refreshActiveEditorFromWorkspace,
    showIntentToast,
    removeStalledPost,
    setPosts,
    preserveTimelineScrollTop,
  } = deps;

  const { turnId, isCurrentChatEvent } = resolveSseEventRoutingContext(eventType, data, currentChatJid);

  if (isCurrentChatEvent) {
    updateAgentProfile(data);
    updateUserProfile(data);
  }

  if (eventType === 'ui_theme') {
    applyThemeFromEvent(data);
    return;
  }

  if (eventType === 'ui_meters') {
    applyMetersFromEvent(data);
    return;
  }

  const liveWidgetEvent = resolveLiveGeneratedWidgetEvent(eventType);
  if (liveWidgetEvent.kind === 'update') {
    if (!isCurrentChatEvent) return;
    if (liveWidgetEvent.shouldAdoptTurn && shouldAdoptIncomingTurn(turnId, currentTurnIdRef.current)) {
      setActiveTurn(turnId);
    }
    applyLiveGeneratedWidgetUpdate(data, liveWidgetEvent.fallbackStatus || 'streaming');
    return;
  }

  if (liveWidgetEvent.kind === 'close') {
    if (!isCurrentChatEvent) return;
    setFloatingWidget((current) => clearLiveFloatingWidgetState(current, data));
    return;
  }

  if (eventType?.startsWith('agent_') && !isNoisyAgentSseEvent(eventType)) {
    clearLastActivityFlag();
  }

  if (eventType === 'connected') {
    if (handleUiVersionDrift(data?.app_asset_version)) {
      return;
    }
    if (isAppChatActivationRecent(currentChatJid)) {
      return;
    }
    setAgentStatus(null);
    setAgentDraft({ text: '', totalLines: 0 });
    setAgentPlan('');
    setAgentThought({ text: '', totalLines: 0 });
    setPendingRequest(null);
    pendingRequestRef.current = null;
    clearAgentRunState();

    const targetChatJid = currentChatJid;
    getAgentStatus(targetChatJid)
      .then((response) => {
        if (activeChatJidRef.current !== targetChatJid) return;
        if (!response || response.status !== 'active' || !response.data) return;

        const payload = response.data;
        const activeTurn = readAgentTurnId(payload);
        if (activeTurn) setActiveTurn(activeTurn);
        setAgentStatus(payload);
        noteAgentActivity({ clearSilence: true });
        showLastActivity(payload);

        const thoughtRestore = resolveAgentPreviewRestoreState(response.thought);
        if (thoughtRestore) {
          thoughtBufferRef.current = thoughtRestore.text;
          setAgentThought(thoughtRestore);
        }
        const draftRestore = resolveAgentPreviewRestoreState(response.draft);
        if (draftRestore) {
          draftBufferRef.current = draftRestore.text;
          setAgentDraft(draftRestore);
        }
      })
      .catch((error) => {
        console.warn('Failed to fetch agent status:', error);
      });

    if (isMainTimelineView(viewStateRef.current)) {
      void refreshTimeline();
    }
    refreshModelAndQueueState();
    return;
  }

  if (eventType === 'agent_status') {
    if (!isCurrentChatEvent) {
      if (data?.type === 'done' || data?.type === 'error') {
        void refreshActiveChatAgents();
        void refreshCurrentChatBranches();
      }
      return;
    }

    if (data.type === 'done' || data.type === 'error') {
      if (shouldIgnoreMismatchedTurn(turnId, currentTurnIdRef.current)) {
        return;
      }
      if (data.type === 'done') {
        notifyForFinalResponse(turnId || currentTurnIdRef.current);
        if (isMainTimelineView(viewStateRef.current)) {
          void refreshTimeline();
        }
        if (data.context_usage) setContextUsage(data.context_usage);
      }
      void refreshContextUsage();
      wasAgentActiveRef.current = false;
      clearAgentRunState();
      dismissedQueueRowIdsRef.current.clear();
      void refreshActiveChatAgents();
      void refreshQueueState();
      setAgentDraft({ text: '', totalLines: 0 });
      setAgentPlan('');
      setAgentThought({ text: '', totalLines: 0 });
      setPendingRequest(null);
      if (data.type === 'error') {
        setAgentStatus({ type: 'error', title: data.title || 'Agent error' });
        setTimeout(() => setAgentStatus(null), 8000);
      } else {
        setAgentStatus(null);
      }
    } else {
      if (turnId) setActiveTurn(turnId);
      noteAgentActivity({ running: true, clearSilence: true });
      if (data.type === 'thinking') {
        draftBufferRef.current = '';
        thoughtBufferRef.current = '';
        setAgentDraft({ text: '', totalLines: 0 });
        setAgentPlan('');
        setAgentThought({ text: '', totalLines: 0 });
      }
      setAgentStatus(data);
    }
    return;
  }

  if (eventType === 'agent_steer_queued') {
    if (!isCurrentChatEvent) return;
    if (shouldIgnoreMismatchedTurn(turnId, currentTurnIdRef.current)) {
      return;
    }
    const targetTurn = resolveSteerQueuedTurnId(turnId, currentTurnIdRef.current);
    if (!targetTurn) return;
    steerQueuedTurnIdRef.current = targetTurn;
    setSteerQueuedTurnId(targetTurn);
    return;
  }

  if (eventType === 'agent_followup_queued') {
    if (!isCurrentChatEvent) return;
    setFollowupQueueItems((current) => appendFollowupQueueItem(current, data));
    void refreshQueueState();
    return;
  }

  if (eventType === 'agent_followup_consumed') {
    if (!isCurrentChatEvent) return;
    const optimisticRemoval = resolveFollowupQueueRemovalPlan(followupQueueItemsRef.current, data);
    if (optimisticRemoval) {
      clearQueuedSteerStateIfStale(optimisticRemoval.remainingQueueCount);
      setFollowupQueueItems((current) => removeFollowupQueueRow(current, optimisticRemoval.rowId).items);
    }
    void refreshQueueState();
    if (isMainTimelineView(viewStateRef.current)) {
      void refreshTimeline();
    }
    return;
  }

  if (eventType === 'agent_followup_removed') {
    if (!isCurrentChatEvent) return;
    const optimisticRemoval = resolveFollowupQueueRemovalPlan(followupQueueItemsRef.current, data);
    if (optimisticRemoval) {
      dismissedQueueRowIdsRef.current.add(optimisticRemoval.rowId);
      clearQueuedSteerStateIfStale(optimisticRemoval.remainingQueueCount);
      setFollowupQueueItems((current) => removeFollowupQueueRow(current, optimisticRemoval.rowId).items);
    }
    void refreshQueueState();
    return;
  }

  if (eventType === 'agent_draft_delta') {
    if (!isCurrentChatEvent) return;
    if (shouldIgnoreMismatchedTurn(turnId, currentTurnIdRef.current)) {
      return;
    }
    if (shouldAdoptIncomingTurn(turnId, currentTurnIdRef.current)) {
      setActiveTurn(turnId);
    }
    noteAgentActivity({ running: true, clearSilence: true });
    draftBufferRef.current = applyDraftDeltaBuffer(draftBufferRef.current, data);
    const now = Date.now();
    if (!draftThrottleRef.current || now - draftThrottleRef.current >= 100) {
      draftThrottleRef.current = now;
      const fullText = draftBufferRef.current;
      if (draftExpandedRef.current) {
        setAgentDraft((prev) => buildExpandedAgentPreviewState(fullText, prev));
      } else {
        setAgentDraft(buildCollapsedAgentPreviewState(fullText, null));
      }
    }
    return;
  }

  if (eventType === 'agent_draft') {
    if (!isCurrentChatEvent) return;
    if (shouldIgnoreMismatchedTurn(turnId, currentTurnIdRef.current)) {
      return;
    }
    if (shouldAdoptIncomingTurn(turnId, currentTurnIdRef.current)) {
      setActiveTurn(turnId);
    }
    noteAgentActivity({ running: true, clearSilence: true });
    const text = data.text || '';
    const mode = data.mode || (data.kind === 'plan' ? 'replace' : 'append');

    if (data.kind === 'plan') {
      setAgentPlan((prev) => resolveAgentPlanText(prev, text, mode));
    } else if (!draftExpandedRef.current) {
      draftBufferRef.current = text;
      setAgentDraft(buildCollapsedAgentPreviewState(text, data.total_lines));
    }
    return;
  }

  if (eventType === 'agent_thought_delta') {
    if (!isCurrentChatEvent) return;
    if (shouldIgnoreMismatchedTurn(turnId, currentTurnIdRef.current)) {
      return;
    }
    if (shouldAdoptIncomingTurn(turnId, currentTurnIdRef.current)) {
      setActiveTurn(turnId);
    }
    noteAgentActivity({ running: true, clearSilence: true });
    thoughtBufferRef.current = applyThoughtDeltaBuffer(thoughtBufferRef.current, data);
    const now = Date.now();
    if (thoughtExpandedRef.current && (!thoughtThrottleRef.current || now - thoughtThrottleRef.current >= 100)) {
      thoughtThrottleRef.current = now;
      const fullText = thoughtBufferRef.current;
      setAgentThought((prev) => buildExpandedAgentPreviewState(fullText, prev));
    }
    return;
  }

  if (eventType === 'agent_thought') {
    if (!isCurrentChatEvent) return;
    if (shouldIgnoreMismatchedTurn(turnId, currentTurnIdRef.current)) {
      return;
    }
    if (shouldAdoptIncomingTurn(turnId, currentTurnIdRef.current)) {
      setActiveTurn(turnId);
    }
    noteAgentActivity({ running: true, clearSilence: true });
    const text = data.text || '';
    if (!thoughtExpandedRef.current) {
      thoughtBufferRef.current = text;
      setAgentThought(buildCollapsedAgentPreviewState(text, data.total_lines));
    }
    return;
  }

  if (eventType === 'model_changed') {
    if (!isCurrentChatEvent) return;
    applyModelState(data);
    const targetChatJid = currentChatJid;
    getAgentContext(targetChatJid)
      .then((contextPayload) => {
        if (activeChatJidRef.current !== targetChatJid) return;
        if (contextPayload) setContextUsage(contextPayload);
      })
      .catch(() => {
        if (activeChatJidRef.current !== targetChatJid) return;
        setContextUsage(null);
      });
    return;
  }

  const statusPanelWidgetEvent = resolveStatusPanelWidgetEventContext(eventType, data, currentChatJid);
  if (statusPanelWidgetEvent.isStatusPanelWidgetEvent) {
    if (statusPanelWidgetEvent.eventChatJid !== currentChatJid) return;
    if (!statusPanelWidgetEvent.panelKey) return;
    setExtensionStatusPanels((prev) => applyStatusPanelWidgetEvent(prev, data));
    if (shouldClearPendingPanelActions(data)) {
      setPendingExtensionPanelActions((prev) => clearPendingPanelActionPrefix(prev, statusPanelWidgetEvent.panelKey));
    }
    dispatchExtensionUiBrowserEvent(eventType, data);
    return;
  }

  if (eventType === 'workspace_update') {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('workspace-update', { detail: data }));
    }
    void refreshActiveEditorFromWorkspace(data?.updates);
    return;
  }

  if (isExtensionUiEventType(eventType)) {
    if (!isCurrentChatEvent) return;
    dispatchExtensionUiBrowserEvent(eventType, data);
    const toast = resolveExtensionUiToast(eventType, data);
    if (toast) {
      showIntentToast(toast.title, toast.detail, toast.kind, toast.durationMs);
    }
    return;
  }

  const onMainTimeline = isMainTimelineView(viewStateRef.current);
  if (eventType === 'agent_response') {
    if (!isCurrentChatEvent) return;
    removeStalledPost();
    lastAgentResponseRef.current = {
      post: data,
      turnId: currentTurnIdRef.current,
    };
  }
  if (shouldAppendRealtimeTimelinePost(eventType, isCurrentChatEvent, onMainTimeline)) {
    setPosts((prev) => appendUniqueTimelinePost(prev, data));
    scrollToBottomRef.current?.();
  }
  if (eventType === 'interaction_updated') {
    if (!shouldMutateInteractionTimeline(isCurrentChatEvent, onMainTimeline)) return;
    setPosts((prev) => replaceTimelinePostById(prev, data));
  }
  if (eventType === 'interaction_deleted') {
    if (!shouldMutateInteractionTimeline(isCurrentChatEvent, onMainTimeline)) return;
    const ids = data?.ids || [];
    if (ids.length) {
      preserveTimelineScrollTop(() => {
        setPosts((prev) => removeTimelinePostsByIds(prev, ids));
      });
      if (hasMoreRef.current) {
        loadMoreRef.current?.({ preserveScroll: true, preserveMode: 'top' });
      }
    }
  }
}
