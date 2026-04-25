import {
  readAgentTurnId,
  resolveAgentPreviewRestoreState,
  shouldKeepExistingPreview,
} from './app-agent-status-refresh.js';
import { inferAgentPreviewTotalLines } from './app-agent-previews.js';
import { isMainTimelineView } from './app-realtime-timeline.js';
import { parseStatusLastEventAt } from './status-duration.js';

interface RefBox<T> {
  current: T;
}

type StateSetter<T> = (next: T | ((prev: T) => T)) => void;

export interface RefreshAgentStatusForChatOptions {
  currentChatJid: string;
  getAgentStatus: (chatJid: string) => Promise<any>;
  activeChatJidRef: RefBox<string>;
  wasAgentActiveRef: RefBox<boolean>;
  viewStateRef: RefBox<Record<string, unknown> | null | undefined>;
  refreshTimeline: () => Promise<void> | void;
  clearAgentRunState: () => void;
  agentStatusRef: RefBox<any>;
  pendingRequestRef: RefBox<any>;
  thoughtBufferRef: RefBox<string>;
  draftBufferRef: RefBox<string>;
  setAgentStatus: StateSetter<any>;
  setAgentDraft: StateSetter<any>;
  setAgentPlan: StateSetter<any>;
  setAgentThought: StateSetter<any>;
  setPendingRequest: StateSetter<any>;
  setActiveTurn: (turnId: string | null | undefined) => void;
  noteAgentActivity: (options?: Record<string, unknown>) => void;
  clearLastActivityFlag: () => void;
}

/** Refresh active agent status for the current chat while guarding against stale chat responses. */
export async function refreshAgentStatusForChat(options: RefreshAgentStatusForChatOptions): Promise<any> {
  const {
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
  } = options;

  const targetChatJid = currentChatJid;

  try {
    const response = await getAgentStatus(targetChatJid);
    if (activeChatJidRef.current !== targetChatJid) {
      return null;
    }

    if (!response || response.status !== 'active' || !response.data) {
      if (wasAgentActiveRef.current && isMainTimelineView(viewStateRef.current)) {
        void refreshTimeline();
      }

      wasAgentActiveRef.current = false;
      clearAgentRunState();
      agentStatusRef.current = null;
      setAgentStatus(null);
      setAgentDraft({ text: '', totalLines: 0 });
      setAgentPlan('');
      setAgentThought({ text: '', totalLines: 0 });
      setPendingRequest(null);
      pendingRequestRef.current = null;
      return response ?? null;
    }

    wasAgentActiveRef.current = true;
    const payload = response.data;
    agentStatusRef.current = payload;

    const activeTurn = readAgentTurnId(payload);
    if (activeTurn) setActiveTurn(activeTurn);

    noteAgentActivity({
      running: true,
      clearSilence: true,
      atMs: parseStatusLastEventAt(payload) ?? Date.now(),
    });
    clearLastActivityFlag();
    setAgentStatus(payload);

    const thoughtRestore = resolveAgentPreviewRestoreState(response.thought);
    if (thoughtRestore) {
      setAgentThought((prev) => {
        if (shouldKeepExistingPreview(prev, thoughtRestore.text)) return prev;
        thoughtBufferRef.current = thoughtRestore.text;
        return thoughtRestore;
      });
    }

    const draftRestore = resolveAgentPreviewRestoreState(response.draft);
    if (draftRestore) {
      setAgentDraft((prev) => {
        if (shouldKeepExistingPreview(prev, draftRestore.text)) return prev;
        draftBufferRef.current = draftRestore.text;
        return draftRestore;
      });
    }

    return response;
  } catch (error) {
    console.warn('Failed to fetch agent status:', error);
    return null;
  }
}

export interface ReconcileSilentTurnOptions {
  isAgentRunningRef: RefBox<boolean>;
  pendingRequestRef: RefBox<any>;
  currentTurnIdRef: RefBox<string | null>;
  silentRecoveryRef: RefBox<{ inFlight: boolean; lastAttemptAt: number; turnId: string | null }>;
  silenceRefreshMs: number;
  viewStateRef: RefBox<Record<string, unknown> | null | undefined>;
  refreshTimeline: () => Promise<void>;
  refreshQueueState: () => Promise<void>;
  refreshAgentStatus: () => Promise<any>;
  now?: () => number;
}

/** Re-sync timeline/queue/status after quiet SSE periods while throttling duplicate probes. */
export async function reconcileSilentTurn(options: ReconcileSilentTurnOptions): Promise<any> {
  const {
    isAgentRunningRef,
    pendingRequestRef,
    currentTurnIdRef,
    silentRecoveryRef,
    silenceRefreshMs,
    viewStateRef,
    refreshTimeline,
    refreshQueueState,
    refreshAgentStatus,
    now = () => Date.now(),
  } = options;

  if (!isAgentRunningRef.current) return null;
  if (pendingRequestRef.current) return null;

  const activeTurnId = currentTurnIdRef.current || null;
  const probe = silentRecoveryRef.current;
  const currentNow = now();

  if (probe.inFlight) return null;
  if (probe.turnId === activeTurnId && currentNow - probe.lastAttemptAt < silenceRefreshMs) {
    return null;
  }

  probe.inFlight = true;
  probe.lastAttemptAt = currentNow;
  probe.turnId = activeTurnId;

  try {
    if (isMainTimelineView(viewStateRef.current)) {
      await refreshTimeline();
    }
    await refreshQueueState();
    return await refreshAgentStatus();
  } finally {
    probe.inFlight = false;
  }
}

export interface RunSilenceWatchdogTickOptions {
  isAgentRunningRef: RefBox<boolean>;
  pendingRequestRef: RefBox<any>;
  lastAgentEventRef: RefBox<number | null>;
  lastSilenceNoticeRef: RefBox<number>;
  agentStatusRef: RefBox<any>;
  silenceWarningMs: number;
  silenceFinalizeMs: number;
  silenceRefreshMs: number;
  isCompactionStatus: (status: any) => boolean;
  setAgentStatus: StateSetter<any>;
  reconcileSilentTurn: () => Promise<unknown> | unknown;
  now?: () => number;
}

function shouldPreserveVisibleStatusDuringSilence(status: any): boolean {
  if (!status || typeof status !== 'object') return false;
  const type = typeof status.type === 'string' ? status.type : '';
  if (type === 'tool_call' || type === 'tool_status' || type === 'intent') return true;
  return Boolean(status.tool_name || status.tool_args);
}

/** Run one silence-watchdog evaluation tick and trigger quiet-period re-sync when needed. */
export function runSilenceWatchdogTick(options: RunSilenceWatchdogTickOptions): void {
  const {
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
    now = () => Date.now(),
  } = options;

  if (!isAgentRunningRef.current) return;
  if (pendingRequestRef.current) return;

  const lastEvent = lastAgentEventRef.current;
  if (!lastEvent) return;

  const currentNow = now();
  const silenceMs = currentNow - lastEvent;
  const currentStatus = agentStatusRef.current;
  const compactionActive = isCompactionStatus(currentStatus);
  const preserveVisibleStatus = shouldPreserveVisibleStatusDuringSilence(currentStatus);

  if (silenceMs >= silenceFinalizeMs) {
    if (!compactionActive && !preserveVisibleStatus) {
      setAgentStatus({
        type: 'waiting',
        title: 'Re-syncing after a quiet period…',
      });
    }
    void reconcileSilentTurn();
    return;
  }

  if (silenceMs >= silenceWarningMs && currentNow - lastSilenceNoticeRef.current >= silenceRefreshMs) {
    if (!compactionActive && !preserveVisibleStatus) {
      const seconds = Math.floor(silenceMs / 1000);
      setAgentStatus({
        type: 'waiting',
        title: `Waiting for model… No events for ${seconds}s`,
      });
    }
    lastSilenceNoticeRef.current = currentNow;
    void reconcileSilentTurn();
  }
}

export interface FinalizeStalledResponseOptions {
  isAgentRunningRef: RefBox<boolean>;
  lastSilenceNoticeRef: RefBox<number>;
  lastAgentEventRef: RefBox<number | null>;
  currentTurnIdRef: RefBox<string | null>;
  thoughtExpandedRef: RefBox<boolean>;
  draftExpandedRef: RefBox<boolean>;
  draftBufferRef: RefBox<string>;
  thoughtBufferRef: RefBox<string>;
  pendingRequestRef: RefBox<any>;
  lastAgentResponseRef: RefBox<any>;
  agentStatusRef: RefBox<any>;
  stalledPostIdRef: RefBox<string | number | null>;
  scrollToBottomRef: RefBox<(() => void) | null>;
  setCurrentTurnId: (value: string | null) => void;
  setAgentDraft: StateSetter<any>;
  setAgentPlan: StateSetter<any>;
  setAgentThought: StateSetter<any>;
  setPendingRequest: StateSetter<any>;
  setAgentStatus: StateSetter<any>;
  setPosts: StateSetter<any[] | null>;
  dedupePosts: (posts: any[]) => any[];
  now?: () => number;
  nowIso?: () => string;
}

export function describeTimedOutToolAction(status: any): { summary: string; title: string | null; toolName: string | null; statusText: string | null } | null {
  if (!status || typeof status !== 'object') return null;
  const type = typeof status.type === 'string' ? status.type : '';
  const title = typeof status.title === 'string' && status.title.trim() ? status.title.trim() : null;
  const toolName = typeof status.tool_name === 'string' && status.tool_name.trim() ? status.tool_name.trim() : null;
  const statusText = typeof status.status === 'string' && status.status.trim() ? status.status.trim() : null;

  if (type === 'tool_call') {
    const label = title || toolName || 'tool';
    return {
      summary: `Timed out while running ${label}`,
      title,
      toolName,
      statusText,
    };
  }

  if (type === 'tool_status') {
    const label = title || toolName || 'tool';
    return {
      summary: statusText ? `Timed out after ${label}: ${statusText}` : `Timed out after ${label}`,
      title,
      toolName,
      statusText,
    };
  }

  if (toolName || title) {
    const label = title || toolName || 'tool';
    return {
      summary: `Timed out after ${label}`,
      title,
      toolName,
      statusText,
    };
  }

  return null;
}

/** Finalize a stalled run by either surfacing an error status or appending a local warning post. */
export function finalizeStalledResponse(options: FinalizeStalledResponseOptions): void {
  const {
    isAgentRunningRef,
    lastSilenceNoticeRef,
    lastAgentEventRef,
    currentTurnIdRef,
    thoughtExpandedRef,
    draftExpandedRef,
    draftBufferRef,
    thoughtBufferRef,
    pendingRequestRef,
    lastAgentResponseRef,
    agentStatusRef,
    stalledPostIdRef,
    scrollToBottomRef,
    setCurrentTurnId,
    setAgentDraft,
    setAgentPlan,
    setAgentThought,
    setPendingRequest,
    setAgentStatus,
    setPosts,
    dedupePosts,
    now = () => Date.now(),
    nowIso = () => new Date().toISOString(),
  } = options;

  if (!isAgentRunningRef.current) return;

  const timedOutToolAction = describeTimedOutToolAction(agentStatusRef.current);

  isAgentRunningRef.current = false;
  lastSilenceNoticeRef.current = 0;
  lastAgentEventRef.current = null;
  agentStatusRef.current = null;
  currentTurnIdRef.current = null;
  setCurrentTurnId(null);
  thoughtExpandedRef.current = false;
  draftExpandedRef.current = false;

  const partial = (draftBufferRef.current || '').trim();
  draftBufferRef.current = '';
  thoughtBufferRef.current = '';
  setAgentPlan('');
  setAgentThought({ text: '', totalLines: 0 });
  setPendingRequest(null);
  pendingRequestRef.current = null;
  lastAgentResponseRef.current = null;

  if (!partial) {
    setAgentDraft({ text: '', totalLines: 0 });
    setAgentStatus({ type: 'error', title: 'Response stalled - No content received' });
    return;
  }

  setAgentDraft({
    text: partial,
    totalLines: inferAgentPreviewTotalLines(partial, null),
    fullText: partial,
  });

  const content = partial;
  const id = now();
  const timestamp = nowIso();
  const localPost = {
    id,
    timestamp,
    data: {
      type: 'agent_response',
      content,
      content_blocks: [
        {
          type: 'timeout_marker',
          timed_out: true,
          title: 'Timed out',
          tool_action_summary: timedOutToolAction?.summary || '',
          tool_title: timedOutToolAction?.title || '',
          tool_name: timedOutToolAction?.toolName || '',
          tool_status: timedOutToolAction?.statusText || '',
          draft_recovered: true,
        },
      ],
      agent_id: 'default',
      is_local_stall: true,
    },
  };

  stalledPostIdRef.current = id;
  setPosts((prev) => (prev ? dedupePosts([...prev, localPost]) : [localPost]));
  scrollToBottomRef.current?.();
  setAgentStatus(null);
}
