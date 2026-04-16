import {
  buildBranchLoaderUrl,
  buildChatWindowUrl,
  buildPanePopoutUrl,
  closeProvisionalChatWindow,
  describeBranchOpenError,
  getChatWindowOpenOptions,
  getPaneWindowOpenOptions,
  navigateProvisionalChatWindow,
  openProvisionalChatWindow,
  primeProvisionalChatWindow,
} from './chat-window.js';

type ToastKind = 'info' | 'warning' | 'error' | 'success';
type ToastFn = (title: string, message: string, kind: ToastKind, timeout: number) => void;
type NavigateFn = (url: string, options?: unknown) => void;

async function runOptionalRefresh<T>(refresh: (() => Promise<T> | T) | null | undefined): Promise<T | null> {
  if (typeof refresh !== 'function') return null;
  try {
    return await refresh();
  } catch {
    return null;
  }
}

interface BranchRecord {
  chat_jid?: string;
  agent_name?: string;
}

export interface CreateSessionFromComposeOptions {
  currentChatJid: string;
  chatOnlyMode?: boolean;
  forkChatBranch: (chatJid: string) => Promise<{ branch?: BranchRecord | null }>;
  refreshActiveChatAgents?: () => Promise<unknown> | unknown;
  refreshCurrentChatBranches?: () => Promise<unknown> | unknown;
  showIntentToast?: ToastFn;
  navigate?: NavigateFn;
  baseHref: string;
}

/** Create a new branch from the compose box and navigate into it. */
export async function createSessionFromCompose(options: CreateSessionFromComposeOptions): Promise<boolean> {
  const {
    currentChatJid,
    chatOnlyMode,
    forkChatBranch,
    refreshActiveChatAgents,
    refreshCurrentChatBranches,
    showIntentToast,
    navigate,
    baseHref,
  } = options;

  if (typeof navigate === 'function') {
    try {
      const loaderUrl = buildBranchLoaderUrl(baseHref, currentChatJid, { chatOnly: chatOnlyMode });
      navigate(loaderUrl);
      return true;
    } catch (error) {
      showIntentToast?.('Could not create branch', describeBranchOpenError(error), 'warning', 5000);
      return false;
    }
  }

  try {
    const response = await forkChatBranch(currentChatJid);
    const branch = response?.branch;
    const nextChatJid = typeof branch?.chat_jid === 'string' && branch.chat_jid.trim() ? branch.chat_jid.trim() : null;
    if (!nextChatJid) {
      throw new Error('Branch fork did not return a chat id.');
    }

    await Promise.allSettled([
      refreshActiveChatAgents?.(),
      refreshCurrentChatBranches?.(),
    ]);

    const label = branch?.agent_name ? `@${branch.agent_name}` : nextChatJid;
    showIntentToast?.('New branch created', `Switched to ${label}.`, 'info', 2500);
    const url = buildChatWindowUrl(baseHref, nextChatJid, { chatOnly: chatOnlyMode });
    navigate?.(url);
    return true;
  } catch (error) {
    showIntentToast?.('Could not create branch', describeBranchOpenError(error), 'warning', 5000);
    return false;
  }
}

export interface PopOutPaneOptions {
  hasWindow?: boolean;
  isWebAppMode?: boolean;
  path?: string | null;
  label?: string | null;
  showIntentToast?: ToastFn;
  resolveSourceTransfer?: (panePath: string) => Promise<Record<string, string> | null> | Record<string, string> | null;
  closeSourcePaneIfTransferred?: (panePath: string) => void;
  onPaneWindowOpened?: (panePath: string, handle: any, params: Record<string, string> | null) => void;
  currentChatJid: string;
  baseHref: string;
}

/** Open the selected pane in a standalone browser window or tab. */
export async function popOutPane(options: PopOutPaneOptions): Promise<boolean> {
  const {
    hasWindow = typeof window !== 'undefined',
    isWebAppMode = false,
    path,
    label,
    showIntentToast,
    resolveSourceTransfer,
    closeSourcePaneIfTransferred,
    onPaneWindowOpened,
    currentChatJid,
    baseHref,
  } = options;

  if (!hasWindow || isWebAppMode) return false;
  const panePath = typeof path === 'string' && path.trim() ? path.trim() : '';
  if (!panePath) return false;

  const openOptions = getPaneWindowOpenOptions(panePath);
  if (!openOptions) {
    showIntentToast?.('Could not open pane window', 'Opening pane windows is unavailable in standalone webapp mode.', 'warning', 5000);
    return false;
  }

  const provisionalWindow = openProvisionalChatWindow(openOptions);
  if (!provisionalWindow) {
    showIntentToast?.('Could not open pane window', 'The browser blocked opening a new tab or window.', 'warning', 5000);
    return false;
  }

  primeProvisionalChatWindow(provisionalWindow, {
    title: typeof label === 'string' && label.trim() ? `Opening ${label}…` : 'Opening pane…',
    message: 'Preparing a standalone pane window. This should only take a moment.',
  });

  try {
    const popoutParams = await resolveSourceTransfer?.(panePath);
    const hasTransferPayload = Boolean(popoutParams && Object.keys(popoutParams).length > 0);
    const popoutUrl = buildPanePopoutUrl(baseHref, panePath, {
      label: typeof label === 'string' && label.trim() ? label.trim() : undefined,
      chatJid: currentChatJid,
      params: popoutParams,
    });
    navigateProvisionalChatWindow(provisionalWindow, popoutUrl);
    onPaneWindowOpened?.(panePath, provisionalWindow, popoutParams || null);
    if (hasTransferPayload && !onPaneWindowOpened) {
      closeSourcePaneIfTransferred?.(panePath);
    }
    return true;
  } catch (error) {
    closeProvisionalChatWindow(provisionalWindow);
    const detail = error instanceof Error ? error.message : 'Could not transfer pane state to the new window.';
    showIntentToast?.('Could not open pane window', detail, 'warning', 5000);
    return false;
  }
}

export interface PopOutChatOptions {
  hasWindow?: boolean;
  isWebAppMode?: boolean;
  currentChatJid: string;
  currentRootChatJid: string;
  forkChatBranch: (chatJid: string) => Promise<{ branch?: BranchRecord | null }>;
  getActiveChatAgents?: () => Promise<{ chats?: unknown[] }>;
  getChatBranches?: (rootChatJid: string) => Promise<{ chats?: unknown[] }>;
  setActiveChatAgents?: (rows: unknown[]) => void;
  setCurrentChatBranches?: (rows: unknown[]) => void;
  showIntentToast?: ToastFn;
  baseHref: string;
}

/** Open a new chat branch in a separate browser window/tab. */
export async function popOutChat(options: PopOutChatOptions): Promise<boolean> {
  const {
    hasWindow = typeof window !== 'undefined',
    isWebAppMode = false,
    currentChatJid,
    currentRootChatJid,
    forkChatBranch,
    getActiveChatAgents,
    getChatBranches,
    setActiveChatAgents,
    setCurrentChatBranches,
    showIntentToast,
    baseHref,
  } = options;

  if (!hasWindow || isWebAppMode) return false;

  const initialOpenOptions = getChatWindowOpenOptions(currentChatJid);
  if (!initialOpenOptions) {
    showIntentToast?.('Could not open branch window', 'Opening branch windows is unavailable in standalone webapp mode.', 'warning', 5000);
    return false;
  }

  if (initialOpenOptions.mode === 'tab') {
    const loaderUrl = buildBranchLoaderUrl(baseHref, currentChatJid, { chatOnly: true });
    const opened = window.open(loaderUrl, initialOpenOptions.target);
    if (!opened) {
      showIntentToast?.('Could not open branch window', 'The browser blocked opening a new tab or window.', 'warning', 5000);
      return false;
    }
    return true;
  }

  const provisionalWindow = openProvisionalChatWindow(initialOpenOptions);
  if (!provisionalWindow) {
    showIntentToast?.('Could not open branch window', 'The browser blocked opening a new tab or window.', 'warning', 5000);
    return false;
  }

  primeProvisionalChatWindow(provisionalWindow, {
    title: 'Opening branch…',
    message: 'Preparing a new chat branch. This should only take a moment.',
  });

  try {
    const response = await forkChatBranch(currentChatJid);
    const branch = response?.branch;
    const nextChatJid = typeof branch?.chat_jid === 'string' && branch.chat_jid.trim() ? branch.chat_jid.trim() : null;
    if (!nextChatJid) {
      throw new Error('Branch fork did not return a chat id.');
    }

    const active = await runOptionalRefresh(() => getActiveChatAgents?.());
    if (active) {
      setActiveChatAgents?.(Array.isArray(active?.chats) ? active.chats : []);
    }

    const branches = await runOptionalRefresh(() => getChatBranches?.(currentRootChatJid));
    if (branches) {
      setCurrentChatBranches?.(Array.isArray(branches?.chats) ? branches.chats : []);
    }

    const url = buildChatWindowUrl(baseHref, nextChatJid, { chatOnly: true });
    navigateProvisionalChatWindow(provisionalWindow, url);
    return true;
  } catch (error) {
    closeProvisionalChatWindow(provisionalWindow);
    showIntentToast?.('Could not open branch window', describeBranchOpenError(error), 'error', 5000);
    return false;
  }
}
