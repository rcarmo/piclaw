import { isAppChatActivationRecent } from './app-refresh-coordination.js';
import { invalidateAgentUiSnapshot } from './agent-ui-snapshot.js';

export interface AgentStatusConnectionState {
  // Undefined preserves cold-open/legacy refreshes before the first SSE callback.
  status: string | undefined;
  generation: number;
}

type ViewStateLike = {
  currentHashtag?: unknown;
  searchQuery?: unknown;
  searchOpen?: boolean;
};

type ToastFn = (title: string, detail?: string | null, kind?: 'info' | 'warning' | 'error' | 'success', durationMs?: number) => void;

export interface HandleUiVersionDriftOptions {
  serverVersion: unknown;
  currentAppAssetVersion: string | null;
  staleUiVersionRef: { current: string | null };
  staleUiReloadScheduledRef: { current: boolean };
  tabStoreHasUnsaved: () => boolean;
  isAgentRunningRef: { current: boolean };
  pendingRequestRef: { current: unknown };
  showIntentToast: ToastFn;
}

export function handleUiVersionDriftEvent(options: HandleUiVersionDriftOptions): boolean {
  const {
    serverVersion,
    currentAppAssetVersion,
    staleUiVersionRef,
    staleUiReloadScheduledRef,
    tabStoreHasUnsaved,
    isAgentRunningRef,
    pendingRequestRef,
    showIntentToast,
  } = options;

  const normalizedServerVersion = typeof serverVersion === 'string' && serverVersion.trim() ? serverVersion.trim() : null;
  if (!normalizedServerVersion || !currentAppAssetVersion || normalizedServerVersion === currentAppAssetVersion) {
    return false;
  }
  if (staleUiVersionRef.current === normalizedServerVersion) {
    return true;
  }
  staleUiVersionRef.current = normalizedServerVersion;

  const composeDraft = typeof document !== 'undefined'
    ? String(document.querySelector('.compose-box textarea')?.value || '').trim()
    : '';
  const canAutoReload = !tabStoreHasUnsaved()
    && !composeDraft
    && !isAgentRunningRef.current
    && !pendingRequestRef.current;

  if (canAutoReload && !staleUiReloadScheduledRef.current) {
    // Disabled auto-reload — it caused cascading reloads during compaction/reconnect.
    // Show toast instead and let the user reload manually.
  }

  showIntentToast('New UI available', 'Reload this page to apply the latest interface update.', 'warning', 8000);
  return true;
}

export interface HandleConnectionStatusChangeOptions {
  currentChatJid: string;
  status: string;
  connectionStateRef?: { current: AgentStatusConnectionState };
  setConnectionStatus: (status: string) => void;
  setAgentStatus: (status: Record<string, unknown> | null) => void;
  setAgentDraft: (draft: { text: string; totalLines: number }) => void;
  setAgentPlan: (plan: string) => void;
  setAgentThought: (thought: { text: string; totalLines: number }) => void;
  setPendingRequest: (request: unknown) => void;
  pendingRequestRef: { current: unknown };
  clearAgentRunState: () => void;
  hasConnectedOnceRef: { current: boolean };
  viewStateRef: { current: ViewStateLike | null | undefined };
  refreshTimeline: () => void;
  refreshAgentStatus: () => void;
  refreshQueueState: () => void;
  refreshContextUsage: () => void;
}

function shouldRefreshMainTimeline(viewState: ViewStateLike | null | undefined): boolean {
  const {
    currentHashtag: activeHashtag,
    searchQuery: activeSearch,
    searchOpen: activeSearchOpen,
  } = viewState || {};
  return !activeHashtag && !activeSearch && !activeSearchOpen;
}

export function handleConnectionStatusChangeEvent(options: HandleConnectionStatusChangeOptions): void {
  const {
    currentChatJid,
    status,
    setConnectionStatus,
    setAgentStatus,
    setAgentDraft,
    setAgentPlan,
    setAgentThought,
    setPendingRequest,
    pendingRequestRef,
    clearAgentRunState,
    hasConnectedOnceRef,
    viewStateRef,
    refreshTimeline,
    refreshAgentStatus,
    refreshQueueState,
    refreshContextUsage,
  } = options;

  // Fence requests synchronously, before clearing refs (which can be null both
  // before and after a disconnect) or starting the reconnect refresh bundle.
  if (options.connectionStateRef) {
    options.connectionStateRef.current = {
      status,
      generation: options.connectionStateRef.current.generation + 1,
    };
  }
  invalidateAgentUiSnapshot(currentChatJid);
  setConnectionStatus(status);
  if (status !== 'connected') {
    setAgentStatus(null);
    setAgentDraft({ text: '', totalLines: 0 });
    setAgentPlan('');
    setAgentThought({ text: '', totalLines: 0 });
    setPendingRequest(null);
    pendingRequestRef.current = null;
    clearAgentRunState();
    return;
  }

  if (!hasConnectedOnceRef.current) {
    hasConnectedOnceRef.current = true;
    setAgentStatus(null);
    setAgentDraft({ text: '', totalLines: 0 });
    setAgentPlan('');
    setAgentThought({ text: '', totalLines: 0 });
    setPendingRequest(null);
    pendingRequestRef.current = null;
    clearAgentRunState();
    if (isAppChatActivationRecent(currentChatJid)) return;
    if (shouldRefreshMainTimeline(viewStateRef.current)) {
      refreshTimeline();
    }
    refreshAgentStatus();
    refreshQueueState();
    refreshContextUsage();
    return;
  }

  if (shouldRefreshMainTimeline(viewStateRef.current)) {
    refreshTimeline();
  }
  refreshAgentStatus();
  refreshQueueState();
  refreshContextUsage();
}

export interface RunBackstopRefreshTickOptions {
  viewStateRef: { current: ViewStateLike | null | undefined };
  isAgentActive: boolean;
  refreshTimeline: () => void;
  refreshQueueState: () => void;
  refreshAgentStatus: () => Promise<any>;
  shouldRefreshContext: (status: any) => boolean;
  refreshContextUsage: () => void;
  refreshAutoresearchStatus: () => void;
}

export function runBackstopRefreshTick(options: RunBackstopRefreshTickOptions): void {
  const {
    viewStateRef,
    isAgentActive,
    refreshTimeline,
    refreshQueueState,
    refreshAgentStatus,
    shouldRefreshContext,
    refreshContextUsage,
    refreshAutoresearchStatus,
  } = options;

  if (shouldRefreshMainTimeline(viewStateRef.current)) refreshTimeline();
  if (isAgentActive) refreshQueueState();
  void refreshAgentStatus().then(status => {
    if (status && shouldRefreshContext(status)) refreshContextUsage();
  }).catch(() => { /* The next tick or reconnect can recover. */ });
  refreshAutoresearchStatus();
}
