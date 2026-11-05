import {
  getGeneratedWidgetSessionKey,
  getGeneratedWidgetShouldCloseOnSubmit,
  getGeneratedWidgetSubmissionText,
} from './generated-widget.js';
import { resolveQueueActionChatJid } from './queue-state.js';
import {
  applyFloatingWidgetDashboardFailure,
  applyFloatingWidgetDashboardResult,
  applyFloatingWidgetHostEvent,
  applyFloatingWidgetSubmitPending,
  applyFloatingWidgetSubmitResult,
  closeFloatingWidgetState,
  openFloatingWidgetState,
} from './app-floating-widget.js';
import { resolveFollowupActionFailureToast, resolveFollowupQueueRemovalPlan } from './app-followup-actions.js';
import { removeFollowupQueueRow } from './app-followup-queue.js';
import {
  buildFloatingWidgetDashboardSnapshot,
  readFulfilledResult,
} from './app-floating-widget-dashboard.js';
import {
  resolveFloatingWidgetDashboardBuiltToast,
  resolveFloatingWidgetDashboardFailureToast,
  resolveFloatingWidgetHostRefreshContext,
  resolveFloatingWidgetRefreshAckToast,
  resolveFloatingWidgetSubmitFailureToast,
  resolveFloatingWidgetSubmitToast,
} from './app-floating-widget-events.js';

type StateSetter<T> = (next: T | ((prev: T) => T)) => void;

type ToastKind = 'info' | 'warning' | 'error' | 'success';
type ToastFn = (title: string, detail?: string | null, kind?: ToastKind, durationMs?: number) => void;

export interface BuildFloatingWidgetDashboardDataOptions {
  requestPayload?: unknown;
  currentChatJid: string;
  currentRootChatJid: string;
  getAgentStatus: (chatJid: string) => Promise<unknown>;
  getAgentContext: (chatJid: string) => Promise<unknown>;
  getAgentQueueState: (chatJid: string) => Promise<unknown>;
  getAgentModels: (chatJid: string) => Promise<unknown>;
  getActiveChatAgents: () => Promise<unknown>;
  getChatBranches: (chatJid: string) => Promise<unknown>;
  getTimeline: (limit: number, cursor: unknown, chatJid: string) => Promise<unknown>;
  rawPosts: unknown[] | null;
  activeChatAgents: unknown[];
  currentChatBranches: unknown[];
  contextUsage: unknown;
  followupQueueItems: unknown[];
  activeModel: unknown;
  activeThinkingLevel: unknown;
  supportsThinking: boolean;
  isAgentTurnActive: boolean;
}

export async function buildFloatingWidgetDashboardData(options: BuildFloatingWidgetDashboardDataOptions): Promise<unknown> {
  const {
    requestPayload = null,
    currentChatJid,
    currentRootChatJid,
    getAgentStatus,
    getAgentContext,
    getAgentQueueState,
    getAgentModels,
    getActiveChatAgents,
    getChatBranches,
    getTimeline,
    rawPosts,
    activeChatAgents,
    currentChatBranches,
    contextUsage,
    followupQueueItems,
    activeModel,
    activeThinkingLevel,
    supportsThinking,
    isAgentTurnActive,
  } = options;

  const [statusRes, contextRes, queueRes, modelsRes, activeChatsRes, branchesRes, timelineRes] = await Promise.allSettled([
    getAgentStatus(currentChatJid),
    getAgentContext(currentChatJid),
    getAgentQueueState(currentChatJid),
    getAgentModels(currentChatJid),
    getActiveChatAgents(),
    getChatBranches(currentRootChatJid),
    getTimeline(20, null, currentChatJid),
  ]);

  return buildFloatingWidgetDashboardSnapshot({
    generatedAt: new Date().toISOString(),
    request: requestPayload,
    currentChatJid,
    currentRootChatJid,
    statusPayload: readFulfilledResult(statusRes),
    contextPayload: readFulfilledResult(contextRes),
    queuePayload: readFulfilledResult(queueRes),
    modelsPayload: readFulfilledResult(modelsRes),
    activeChatsPayload: readFulfilledResult(activeChatsRes),
    branchesPayload: readFulfilledResult(branchesRes),
    timelinePayload: readFulfilledResult(timelineRes),
    rawPosts,
    activeChatAgents,
    currentChatBranches,
    contextUsage,
    followupQueueItems,
    activeModel,
    activeThinkingLevel,
    supportsThinking,
    isAgentTurnActive,
  });
}

export interface FollowupActionOptions {
  queuedItem: Record<string, unknown> | null | undefined;
  followupQueueItemsRef: { current: any[] };
  dismissedQueueRowIdsRef: { current: Set<string | number> };
  currentChatJid: string;
  refreshQueueState: () => void | Promise<unknown>;
  setFollowupQueueItems: StateSetter<any[]>;
  showIntentToast: ToastFn;
  clearQueuedSteerStateIfStale?: (remainingQueueCount: number) => void;
  steerAgentQueueItem: (rowId: string | number, chatJid: string | null) => Promise<unknown>;
  removeAgentQueueItem: (rowId: string | number, chatJid: string | null) => Promise<unknown>;
}

export function handleInjectQueuedFollowupAction(options: FollowupActionOptions): void {
  const {
    queuedItem,
    followupQueueItemsRef,
    dismissedQueueRowIdsRef,
    currentChatJid,
    refreshQueueState,
    setFollowupQueueItems,
    showIntentToast,
    steerAgentQueueItem,
  } = options;

  const optimisticRemoval = resolveFollowupQueueRemovalPlan(followupQueueItemsRef.current, queuedItem);
  if (!optimisticRemoval) return;
  const { rowId } = optimisticRemoval;

  steerAgentQueueItem(rowId, resolveQueueActionChatJid(currentChatJid))
    .then((response: any) => {
      if(response?.queued!=='steer')throw Error('Queue changed before steering');
      void refreshQueueState();
    })
    .catch((error) => {
      console.warn('[queue] Failed to steer queued item:', error);
      const failureToast = resolveFollowupActionFailureToast('steer');
      showIntentToast(failureToast.title, failureToast.detail, 'warning');
      dismissedQueueRowIdsRef.current.delete(rowId);
      void refreshQueueState();
    });
}

export function handleRemoveQueuedFollowupAction(options: FollowupActionOptions): void {
  const {
    queuedItem,
    followupQueueItemsRef,
    dismissedQueueRowIdsRef,
    currentChatJid,
    refreshQueueState,
    setFollowupQueueItems,
    showIntentToast,
    clearQueuedSteerStateIfStale,
    removeAgentQueueItem,
  } = options;

  const optimisticRemoval = resolveFollowupQueueRemovalPlan(followupQueueItemsRef.current, queuedItem);
  if (!optimisticRemoval) return;
  const { rowId } = optimisticRemoval;

  removeAgentQueueItem(rowId, resolveQueueActionChatJid(currentChatJid))
    .then((response: any) => {
      if(response?.removed!==true)throw Error('Queue changed before removal');
      dismissedQueueRowIdsRef.current.add(rowId);
      clearQueuedSteerStateIfStale?.(optimisticRemoval.remainingQueueCount);
      setFollowupQueueItems((current) => removeFollowupQueueRow(current,rowId).items);
      void refreshQueueState();
    })
    .catch((error) => {
      console.warn('[queue] Failed to remove queued item:', error);
      const failureToast = resolveFollowupActionFailureToast('remove');
      showIntentToast(failureToast.title, failureToast.detail, 'warning');
      dismissedQueueRowIdsRef.current.delete(rowId);
      void refreshQueueState();
    });
}

export interface OpenFloatingWidgetOptions {
  widget: Record<string, unknown> | null | undefined;
  dismissedLiveWidgetKeysRef: { current: Set<string> };
  setFloatingWidget: StateSetter<Record<string, unknown> | null>;
}

export function openFloatingWidgetFromHost(options: OpenFloatingWidgetOptions): void {
  const { widget, dismissedLiveWidgetKeysRef, setFloatingWidget } = options;
  if (!widget || typeof widget !== 'object') return;
  const sessionKey = getGeneratedWidgetSessionKey(widget);
  if (sessionKey) {
    dismissedLiveWidgetKeysRef.current.delete(sessionKey);
  }
  setFloatingWidget(openFloatingWidgetState(widget, new Date().toISOString()));
}

export interface CloseFloatingWidgetOptions {
  dismissedLiveWidgetKeysRef: { current: Set<string> };
  setFloatingWidget: StateSetter<Record<string, unknown> | null>;
}

export function closeFloatingWidgetFromHost(options: CloseFloatingWidgetOptions): void {
  const { dismissedLiveWidgetKeysRef, setFloatingWidget } = options;
  setFloatingWidget((current) => {
    const result = closeFloatingWidgetState(current);
    if (result.dismissedSessionKey) {
      dismissedLiveWidgetKeysRef.current.add(result.dismissedSessionKey);
    }
    return result.nextWidget;
  });
}

export interface HandleFloatingWidgetEventOptions {
  event: Record<string, unknown> | null | undefined;
  widget: Record<string, unknown> | null | undefined;
  currentChatJid: string;
  isComposeBoxAgentActive: boolean;
  setFloatingWidget: StateSetter<Record<string, unknown> | null>;
  handleCloseFloatingWidget: () => void;
  handleMessageResponse: (response: Record<string, unknown> | null | undefined) => void;
  showIntentToast: ToastFn;
  sendAgentMessage: (agentId: string, content: string, turnId: string | null, fileRefs: string[], queued: 'queue' | null, chatJid: string) => Promise<any>;
  buildFloatingWidgetDashboardSnapshot: (requestPayload?: unknown) => Promise<unknown>;
}

export function handleFloatingWidgetEventFromHost(options: HandleFloatingWidgetEventOptions): void {
  const {
    event,
    widget,
    currentChatJid,
    isComposeBoxAgentActive,
    setFloatingWidget,
    handleCloseFloatingWidget,
    handleMessageResponse,
    showIntentToast,
    sendAgentMessage,
    buildFloatingWidgetDashboardSnapshot,
  } = options;

  const kind = typeof event?.kind === 'string' ? event.kind : '';
  const sessionKey = getGeneratedWidgetSessionKey(widget);
  if (!kind || !sessionKey) return;

  if (kind === 'widget.close') {
    handleCloseFloatingWidget();
    return;
  }

  if (kind === 'widget.submit') {
    const submissionText = getGeneratedWidgetSubmissionText(event?.payload);
    const closeAfterSubmit = getGeneratedWidgetShouldCloseOnSubmit(event?.payload);
    const submittedAt = new Date().toISOString();

    setFloatingWidget((current) => applyFloatingWidgetSubmitPending(current, sessionKey, {
      kind,
      payload: event?.payload || null,
      submittedAt,
      submissionText,
    }));

    if (!submissionText) {
      showIntentToast('Widget submission received', 'The widget submitted data without a message payload yet.', 'info', 3500);
      if (closeAfterSubmit) handleCloseFloatingWidget();
      return;
    }

    (async () => {
      try {
        const response = await sendAgentMessage('default', submissionText, null, [], isComposeBoxAgentActive ? 'queue' : null, currentChatJid);
        handleMessageResponse(response);
        setFloatingWidget((current) => applyFloatingWidgetSubmitResult(current, sessionKey, {
          submittedAt,
          submissionText,
          queued: response?.queued || null,
        }));
        const submitToast = resolveFloatingWidgetSubmitToast(response?.queued);
        showIntentToast(submitToast.title, submitToast.detail, submitToast.kind, submitToast.durationMs);
        if (closeAfterSubmit) handleCloseFloatingWidget();
      } catch (error) {
        setFloatingWidget((current) => applyFloatingWidgetSubmitResult(current, sessionKey, {
          submittedAt,
          submissionText,
          errorMessage: error?.message || 'Could not send the widget message.',
        }));
        const submitFailureToast = resolveFloatingWidgetSubmitFailureToast(error?.message);
        showIntentToast(submitFailureToast.title, submitFailureToast.detail, submitFailureToast.kind, submitFailureToast.durationMs);
      }
    })();
    return;
  }

  if (kind === 'widget.ready' || kind === 'widget.request_refresh') {
    const eventAt = new Date().toISOString();
    const refreshContext = resolveFloatingWidgetHostRefreshContext(event?.payload || null, widget?.runtimeState?.refreshCount);
    setFloatingWidget((current) => applyFloatingWidgetHostEvent(current, sessionKey, {
      kind,
      payload: event?.payload || null,
      eventAt,
      nextRefreshCount: refreshContext.nextRefreshCount,
      shouldBuildDashboard: refreshContext.shouldBuildDashboard,
    }));

    if (kind === 'widget.request_refresh') {
      if (refreshContext.shouldBuildDashboard) {
        (async () => {
          try {
            const dashboard = await buildFloatingWidgetDashboardSnapshot(event?.payload || null);
            setFloatingWidget((current) => applyFloatingWidgetDashboardResult(current, sessionKey, {
              dashboard,
              at: new Date().toISOString(),
              count: refreshContext.nextRefreshCount,
              echo: event?.payload || null,
            }));
            const successToast = resolveFloatingWidgetDashboardBuiltToast();
            showIntentToast(successToast.title, successToast.detail, successToast.kind, successToast.durationMs);
          } catch (error) {
            setFloatingWidget((current) => applyFloatingWidgetDashboardFailure(current, sessionKey, {
              errorMessage: error?.message || 'Could not build dashboard.',
              at: new Date().toISOString(),
              count: refreshContext.nextRefreshCount,
            }));
            const failureToast = resolveFloatingWidgetDashboardFailureToast(error?.message);
            showIntentToast(failureToast.title, failureToast.detail, failureToast.kind, failureToast.durationMs);
          }
        })();
      } else {
        const ackToast = resolveFloatingWidgetRefreshAckToast();
        showIntentToast(ackToast.title, ackToast.detail, ackToast.kind, ackToast.durationMs);
      }
    }
  }
}
