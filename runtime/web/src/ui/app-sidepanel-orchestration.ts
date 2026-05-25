import { useCallback, useEffect } from '../vendor/preact-htm.js';
import { parseBtwCommand, buildBtwInjectionText, resolveBtwChatJid } from './btw.js';
import {
  addPendingPanelAction,
  createPendingPanelActionKey,
  removePendingPanelAction,
  runExtensionStatusPanelAction,
} from './app-extension-status.js';
import {
  closeBtwPanelSession,
  handleBtwInterceptCommand,
  injectBtwSession,
  runBtwPromptSession,
} from './app-btw-orchestration.js';
import {
  approvePlannotatorSession,
  closePlannotatorPanelSession,
  openPlannotatorPanelSession,
  rejectPlannotatorSession,
  findLastReviewablePost,
  buildPlannotatorSessionFromPost,
} from './use-plannotator-orchestration.js';
import type { PlannotatorSession } from './plannotator-types.js';
import {
  buildFloatingWidgetDashboardData,
  closeFloatingWidgetFromHost,
  handleFloatingWidgetEventFromHost,
  openFloatingWidgetFromHost,
} from './app-floating-widget-followup.js';

type StateSetter<T> = (next: T | ((prev: T) => T)) => void;

interface RefBox<T> {
  current: T;
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  const value = typeof text === 'string' ? text : '';
  if (!value) return false;

  let clipboardApiError: unknown = null;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (error) {
      clipboardApiError = error;
    }
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    return copied;
  } catch (error) {
    console.debug('[sidepanel] Clipboard copy failed after falling back from navigator.clipboard.', error, {
      clipboardApiAvailable: Boolean(navigator.clipboard?.writeText),
      clipboardApiError,
    });
    return false;
  }
}

export function resetFloatingWidgetStateForChatChange(options: {
  dismissedLiveWidgetKeysRef: RefBox<Set<string>>;
  setFloatingWidget: StateSetter<any>;
}): void {
  const {
    dismissedLiveWidgetKeysRef,
    setFloatingWidget,
  } = options;

  dismissedLiveWidgetKeysRef.current.clear();
  setFloatingWidget(null);
}

interface UseSidepanelOrchestrationOptions {
  currentChatJid: string;
  currentRootChatJid: string;
  isComposeBoxAgentActive: boolean;
  showIntentToast: (title: string, detail?: string | null, kind?: string, durationMs?: number) => void;

  // Extension status panel actions
  setPendingExtensionPanelActions: StateSetter<Set<string>>;
  refreshAutoresearchStatus: () => Promise<void>;
  stopAutoresearch: (chatJid: string) => Promise<any>;
  dismissAutoresearch: (chatJid: string) => Promise<any>;

  // BTW panel actions
  streamSidePrompt: (prompt: string, options: Record<string, unknown>) => Promise<any>;
  btwAbortRef: RefBox<AbortController | null>;
  btwSession: any;
  setBtwSession: StateSetter<any>;
  sendAgentMessage: (
    agentId: string,
    content: string,
    threadId: string | null,
    attachments: any[],
    queueMode: string | null,
    chatJid: string,
  ) => Promise<any>;
  handleMessageResponse: (response: any) => void;

  // Plannotator panel actions
  plannotatorAbortRef: RefBox<AbortController | null>;
  plannotatorSession: PlannotatorSession | null;
  setPlannotatorSession: StateSetter<PlannotatorSession | null>;
  openEditor?: (path: string, options?: { label?: string; transferState?: Record<string, unknown> }) => void;

  // Floating widget actions
  dismissedLiveWidgetKeysRef: RefBox<Set<string>>;
  setFloatingWidget: StateSetter<any>;
  getAgentStatus: (chatJid: string) => Promise<any>;
  getAgentContext: ((chatJid: string) => Promise<any>) | null;
  getAgentQueueState: (chatJid: string) => Promise<any>;
  getAgentModels: (chatJid: string) => Promise<any>;
  getActiveChatAgents: (chatJid: string) => Promise<any>;
  getChatBranches: (chatJid: string | null, options?: Record<string, unknown>) => Promise<any>;
  getTimeline: (chatJid: string, limit: number, offset?: number) => Promise<any>;
  rawPosts: any[];
  activeChatAgents: any[];
  currentChatBranches: any[];
  contextUsage: any;
  followupQueueItemsRef: RefBox<any[]>;
  activeModel: string | null;
  activeThinkingLevel: string | null;
  supportsThinking: boolean;
  isAgentTurnActive: boolean;
}

export function useSidepanelOrchestration(options: UseSidepanelOrchestrationOptions) {
  const {
    currentChatJid,
    currentRootChatJid,
    isComposeBoxAgentActive,
    showIntentToast,

    setPendingExtensionPanelActions,
    refreshAutoresearchStatus,
    stopAutoresearch,
    dismissAutoresearch,

    streamSidePrompt,
    btwAbortRef,
    btwSession,
    setBtwSession,
    sendAgentMessage,
    handleMessageResponse,

    plannotatorAbortRef,
    plannotatorSession,
    setPlannotatorSession,
    openEditor,

    dismissedLiveWidgetKeysRef,
    setFloatingWidget,
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
    followupQueueItemsRef,
    activeModel,
    activeThinkingLevel,
    supportsThinking,
    isAgentTurnActive,
  } = options;

  const handleExtensionPanelAction = useCallback(async (panel: any, action: any) => {
    const panelKey = typeof panel?.key === 'string' ? panel.key : '';
    const actionKey = typeof action?.key === 'string' ? action.key : '';
    const pendingKey = createPendingPanelActionKey(panelKey, actionKey);
    if (!panelKey || !actionKey) return;

    setPendingExtensionPanelActions((prev) => addPendingPanelAction(prev, panelKey, actionKey));
    try {
      const result = await runExtensionStatusPanelAction({
        panel,
        action,
        currentChatJid,
        stopAutoresearch,
        dismissAutoresearch,
        writeClipboard: async (text) => {
          const copied = await copyTextToClipboard(text);
          if (!copied) throw new Error('Clipboard access is unavailable.');
        },
      });
      if (result.refreshAutoresearchStatus) {
        void refreshAutoresearchStatus();
      }
      if (result.toast) {
        showIntentToast(result.toast.title, result.toast.detail, result.toast.kind, result.toast.durationMs);
      }
    } catch (error: any) {
      showIntentToast('Panel action failed', error?.message || 'Could not complete that action.', 'warning');
    } finally {
      setPendingExtensionPanelActions((prev) => removePendingPanelAction(prev, pendingKey));
    }
  }, [currentChatJid, dismissAutoresearch, refreshAutoresearchStatus, setPendingExtensionPanelActions, showIntentToast, stopAutoresearch]);

  const closeBtwPanel = useCallback(() => {
    closeBtwPanelSession({
      btwAbortRef,
      setBtwSession,
    });
  }, [btwAbortRef, setBtwSession]);

  const runBtwPrompt = useCallback(async (question: unknown) => {
    return await runBtwPromptSession({
      question,
      currentChatJid,
      streamSidePrompt,
      resolveBtwChatJid,
      showIntentToast,
      btwAbortRef,
      setBtwSession,
    });
  }, [btwAbortRef, currentChatJid, setBtwSession, showIntentToast, streamSidePrompt]);

  const handleBtwIntercept = useCallback(async ({ content }: { content: unknown }) => {
    return await handleBtwInterceptCommand({
      content,
      parseBtwCommand,
      closeBtwPanel,
      runBtwPrompt,
      showIntentToast,
    });
  }, [closeBtwPanel, runBtwPrompt, showIntentToast]);

  const handleBtwRetry = useCallback(() => {
    if (btwSession?.question) {
      void runBtwPrompt(btwSession.question);
    }
  }, [btwSession, runBtwPrompt]);

  const handleBtwInject = useCallback(async () => {
    await injectBtwSession({
      btwSession,
      buildBtwInjectionText,
      isComposeBoxAgentActive,
      currentChatJid,
      sendAgentMessage,
      handleMessageResponse,
      showIntentToast,
    });
  }, [btwSession, currentChatJid, handleMessageResponse, isComposeBoxAgentActive, sendAgentMessage, showIntentToast]);

  // ── Plannotator ──────────────────────────────────────────────────────────

  const closePlannotatorPanel = useCallback(() => {
    closePlannotatorPanelSession({ plannotatorAbortRef, setPlannotatorSession });
  }, [plannotatorAbortRef, setPlannotatorSession]);

  const handleOpenPlannotator = useCallback((session: PlannotatorSession) => {
    openPlannotatorPanelSession({ session, setPlannotatorSession });
  }, [setPlannotatorSession]);

  const handlePlannotatorOpenTab = useCallback(() => {
    if (!plannotatorSession) return;
    if (typeof openEditor === 'function') {
      openEditor('piclaw://plannotator', {
        label: 'Plannotator',
        transferState: plannotatorSession as unknown as Record<string, unknown>,
      });
    }
    closePlannotatorPanel();
  }, [closePlannotatorPanel, openEditor, plannotatorSession]);

  const handlePlannotatorApprove = useCallback(async (comment = '') => {
    await approvePlannotatorSession({
      plannotatorSession,
      currentChatJid,
      isComposeBoxAgentActive,
      sendAgentMessage,
      handleMessageResponse,
      setPlannotatorSession,
      showIntentToast,
    });
  }, [currentChatJid, handleMessageResponse, isComposeBoxAgentActive, plannotatorSession, sendAgentMessage, setPlannotatorSession, showIntentToast]);

  const handlePlannotatorReject = useCallback(async (comment = '') => {
    await rejectPlannotatorSession({
      plannotatorSession,
      comment,
      currentChatJid,
      isComposeBoxAgentActive,
      sendAgentMessage,
      handleMessageResponse,
      setPlannotatorSession,
      showIntentToast,
    });
  }, [currentChatJid, handleMessageResponse, isComposeBoxAgentActive, plannotatorSession, sendAgentMessage, setPlannotatorSession, showIntentToast]);

  /** Called by slash commands /plannotate and /review */
  const handlePlannotatorIntercept = useCallback(async ({ content }: { content: unknown }) => {
    const text = typeof content === 'string' ? content.trim() : '';
    if (text !== '/plannotate' && text !== '/review') return false;
    const post = findLastReviewablePost(rawPosts);
    if (!post) {
      showIntentToast('Plannotator', 'Nenhum plano disponível nesta sessão.', 'info', 3000);
      return true;
    }
    const session = buildPlannotatorSessionFromPost(post);
    if (session) openPlannotatorPanelSession({ session, setPlannotatorSession });
    return true;
  }, [rawPosts, setPlannotatorSession, showIntentToast]);

  const buildFloatingWidgetDashboardSnapshot = useCallback(async (requestPayload: any = null) => {
    return buildFloatingWidgetDashboardData({
      requestPayload,
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
      followupQueueItems: followupQueueItemsRef.current,
      activeModel,
      activeThinkingLevel,
      supportsThinking,
      isAgentTurnActive,
    });
  }, [activeChatAgents, activeModel, activeThinkingLevel, contextUsage, currentChatBranches, currentChatJid, currentRootChatJid, followupQueueItemsRef, getActiveChatAgents, getAgentContext, getAgentModels, getAgentQueueState, getAgentStatus, getChatBranches, getTimeline, isAgentTurnActive, rawPosts, supportsThinking]);

  const handleOpenFloatingWidget = useCallback((widget: any) => {
    openFloatingWidgetFromHost({
      widget,
      dismissedLiveWidgetKeysRef,
      setFloatingWidget,
    });
  }, [dismissedLiveWidgetKeysRef, setFloatingWidget]);

  const handleCloseFloatingWidget = useCallback(() => {
    closeFloatingWidgetFromHost({
      dismissedLiveWidgetKeysRef,
      setFloatingWidget,
    });
  }, [dismissedLiveWidgetKeysRef, setFloatingWidget]);

  const handleFloatingWidgetEvent = useCallback((event: any, widget: any) => {
    handleFloatingWidgetEventFromHost({
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
    });
  }, [buildFloatingWidgetDashboardSnapshot, currentChatJid, handleCloseFloatingWidget, handleMessageResponse, isComposeBoxAgentActive, sendAgentMessage, setFloatingWidget, showIntentToast]);

  useEffect(() => {
    resetFloatingWidgetStateForChatChange({
      dismissedLiveWidgetKeysRef,
      setFloatingWidget,
    });
  }, [currentChatJid, dismissedLiveWidgetKeysRef, setFloatingWidget]);

  return {
    handleExtensionPanelAction,
    closeBtwPanel,
    handleBtwIntercept,
    handleBtwRetry,
    handleBtwInject,
    closePlannotatorPanel,
    handleOpenPlannotator,
    handlePlannotatorOpenTab,
    handlePlannotatorApprove,
    handlePlannotatorReject,
    handlePlannotatorIntercept,
    handleOpenFloatingWidget,
    handleCloseFloatingWidget,
    handleFloatingWidgetEvent,
  };
}
