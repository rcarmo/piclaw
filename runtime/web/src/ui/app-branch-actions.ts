import { buildChatWindowUrl, describeBranchOpenError } from './chat-window.js';
import { describeBranchRestoreResult, getBranchHandleDraftState } from './branch-lifecycle.js';
import { RENAME_BRANCH_FORM_GUARD_MS, type RenameBranchFormLock } from './app-shell-state.js';

interface BranchRecord {
  chat_jid?: string;
  root_chat_jid?: string;
  agent_name?: string;
  archived_at?: string | null;
  is_active?: boolean;
}

interface RefBox<T> {
  current: T;
}

type ToastKind = 'info' | 'warning' | 'error' | 'success';
type ToastFn = (title: string, message: string, kind: ToastKind, timeout: number) => void;
type NavigateFn = (url: string, options?: unknown) => void;

export interface OpenRenameBranchFormOptions {
  hasWindow?: boolean;
  currentBranchRecord?: BranchRecord | null;
  renameBranchInFlight?: boolean;
  renameBranchLockUntil?: number;
  getFormLock?: () => RenameBranchFormLock | null;
  setRenameBranchNameDraft?: (value: string) => void;
  setIsRenameBranchFormOpen?: (value: boolean) => void;
  now?: number;
}

/** Open the branch-rename form when no local/global submit lock is active. */
export function openRenameBranchForm(options: OpenRenameBranchFormOptions): boolean {
  const {
    hasWindow = typeof window !== 'undefined',
    currentBranchRecord,
    renameBranchInFlight,
    renameBranchLockUntil,
    getFormLock,
    setRenameBranchNameDraft,
    setIsRenameBranchFormOpen,
    now = Date.now(),
  } = options;

  if (!hasWindow || !currentBranchRecord?.chat_jid) return false;

  const formLock = getFormLock?.() || null;
  if (!formLock) return false;
  if (
    renameBranchInFlight
    || now < Number(renameBranchLockUntil || 0)
    || formLock.inFlight
    || now < Number(formLock.cooldownUntil || 0)
  ) {
    return false;
  }

  setRenameBranchNameDraft?.(currentBranchRecord.agent_name || '');
  setIsRenameBranchFormOpen?.(true);
  return true;
}

export interface CloseRenameBranchFormOptions {
  setIsRenameBranchFormOpen?: (value: boolean) => void;
  setRenameBranchNameDraft?: (value: string) => void;
}

/** Close the branch-rename form and clear its draft. */
export function closeRenameBranchForm(options: CloseRenameBranchFormOptions): void {
  const { setIsRenameBranchFormOpen, setRenameBranchNameDraft } = options;
  setIsRenameBranchFormOpen?.(false);
  setRenameBranchNameDraft?.('');
}

export interface RenameCurrentBranchOptions {
  hasWindow?: boolean;
  currentBranchRecord?: BranchRecord | null;
  nextName?: string | null;
  openRenameForm?: () => void;
  renameBranchInFlightRef: RefBox<boolean>;
  renameBranchLockUntilRef: RefBox<number>;
  getFormLock?: () => RenameBranchFormLock | null;
  setIsRenamingBranch?: (value: boolean) => void;
  renameChatBranch: (chatJid: string, payload: { agentName: string }) => Promise<{ branch?: BranchRecord | null }>;
  refreshActiveChatAgents?: () => Promise<unknown> | unknown;
  refreshCurrentChatBranches?: () => Promise<unknown> | unknown;
  navigate?: NavigateFn;
  baseHref?: string;
  chatOnlyMode?: boolean;
  showIntentToast?: ToastFn;
  closeRenameForm?: () => void;
  now?: () => number;
}

/** Rename the current chat branch and refresh local branch caches. */
export async function renameCurrentBranch(options: RenameCurrentBranchOptions): Promise<boolean> {
  const {
    hasWindow = typeof window !== 'undefined',
    currentBranchRecord,
    nextName,
    openRenameForm,
    renameBranchInFlightRef,
    renameBranchLockUntilRef,
    getFormLock,
    setIsRenamingBranch,
    renameChatBranch,
    refreshActiveChatAgents,
    refreshCurrentChatBranches,
    navigate,
    baseHref,
    chatOnlyMode,
    showIntentToast,
    closeRenameForm,
    now = () => Date.now(),
  } = options;

  if (!hasWindow || !currentBranchRecord?.chat_jid) return false;
  if (typeof nextName !== 'string') {
    openRenameForm?.();
    return false;
  }

  const currentNow = now();
  const formLock = getFormLock?.() || null;
  if (!formLock) return false;

  if (
    renameBranchInFlightRef.current
    || currentNow < Number(renameBranchLockUntilRef.current || 0)
    || formLock.inFlight
    || currentNow < Number(formLock.cooldownUntil || 0)
  ) {
    return false;
  }

  renameBranchInFlightRef.current = true;
  formLock.inFlight = true;
  setIsRenamingBranch?.(true);

  try {
    const currentHandle = currentBranchRecord.agent_name || '';
    const draftState = getBranchHandleDraftState(nextName, currentHandle);
    if (!draftState.canSubmit) {
      showIntentToast?.('Could not rename branch', draftState.message || 'Enter a valid branch handle.', 'warning', 4000);
      return false;
    }

    const nextAgentName = draftState.normalized || currentHandle;
    const response = await renameChatBranch(currentBranchRecord.chat_jid, { agentName: nextAgentName });
    await Promise.allSettled([
      refreshActiveChatAgents?.(),
      refreshCurrentChatBranches?.(),
    ]);
    const savedHandle = response?.branch?.agent_name || nextAgentName || currentHandle;
    // If the server renamed the JID (agent_name → web:<agent>), navigate to it.
    const newChatJid = response?.branch?.chat_jid;
    if (newChatJid && newChatJid !== currentBranchRecord.chat_jid) {
      const nextUrl = buildChatWindowUrl(baseHref, newChatJid, { chatOnly: chatOnlyMode });
      navigate?.(nextUrl);
    }
    showIntentToast?.('Branch renamed', `@${savedHandle}`, 'info', 3500);
    closeRenameForm?.();
    return true;
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error || 'Could not rename branch.');
    const message = /already in use/i.test(rawMessage || '')
      ? `${rawMessage} Switch to or restore that existing session from the session manager.`
      : rawMessage;
    showIntentToast?.('Could not rename branch', message || 'Could not rename branch.', 'warning', 5000);
    return false;
  } finally {
    renameBranchInFlightRef.current = false;
    setIsRenamingBranch?.(false);
    const unlockedAt = now() + RENAME_BRANCH_FORM_GUARD_MS;
    renameBranchLockUntilRef.current = unlockedAt;
    const formLockRef = getFormLock?.() || null;
    if (formLockRef) {
      formLockRef.inFlight = false;
      formLockRef.cooldownUntil = unlockedAt;
    }
  }
}

export interface PruneCurrentBranchOptions {
  hasWindow?: boolean;
  targetChatJid?: string | null;
  currentChatJid?: string | null;
  currentBranchRecord?: BranchRecord | null;
  currentChatBranches?: BranchRecord[];
  activeChatAgents?: BranchRecord[];
  pruneChatBranch: (chatJid: string) => Promise<unknown>;
  refreshActiveChatAgents?: () => Promise<unknown> | unknown;
  refreshCurrentChatBranches?: () => Promise<unknown> | unknown;
  showIntentToast?: ToastFn;
  baseHref: string;
  chatOnlyMode?: boolean;
  navigate?: NavigateFn;
  confirm?: (message: string) => boolean;
}

/** Archive the selected branch and navigate back to its root chat. */
export async function pruneCurrentBranch(options: PruneCurrentBranchOptions): Promise<boolean> {
  const {
    hasWindow = typeof window !== 'undefined',
    targetChatJid = null,
    currentChatJid,
    currentBranchRecord,
    currentChatBranches = [],
    activeChatAgents = [],
    pruneChatBranch,
    refreshActiveChatAgents,
    refreshCurrentChatBranches,
    showIntentToast,
    baseHref,
    chatOnlyMode,
    navigate,
    confirm = (message: string) => window.confirm(message),
  } = options;

  if (!hasWindow) return false;

  const requestedChatJid = typeof targetChatJid === 'string' && targetChatJid.trim() ? targetChatJid.trim() : '';
  const fallbackCurrentChatJid = typeof currentChatJid === 'string' && currentChatJid.trim() ? currentChatJid.trim() : '';
  const chatJid = requestedChatJid || currentBranchRecord?.chat_jid || fallbackCurrentChatJid;
  if (!chatJid) {
    showIntentToast?.('Could not prune branch', 'No active session is selected yet.', 'warning', 4000);
    return false;
  }

  const branch = (currentBranchRecord?.chat_jid === chatJid ? currentBranchRecord : null)
    || currentChatBranches.find((item) => item?.chat_jid === chatJid)
    || activeChatAgents.find((item) => item?.chat_jid === chatJid)
    || null;

  const isRootBranch = branch?.chat_jid === (branch?.root_chat_jid || branch?.chat_jid);
  const isDefaultRootSession = Boolean(isRootBranch && chatJid === 'web:default');
  const hasActiveChildBranches = Boolean(
    isRootBranch
    && currentChatBranches.some((item) => {
      const itemChatJid = typeof item?.chat_jid === 'string' ? item.chat_jid.trim() : '';
      const itemRootChatJid = typeof item?.root_chat_jid === 'string' ? item.root_chat_jid.trim() : itemChatJid;
      return itemChatJid
        && itemChatJid !== chatJid
        && itemRootChatJid === chatJid
        && !item?.archived_at;
    })
  );

  if (isDefaultRootSession) {
    showIntentToast?.('Cannot archive session', 'The default chat session cannot be archived.', 'warning', 4000);
    return false;
  }
  if (hasActiveChildBranches) {
    showIntentToast?.('Cannot archive session', 'Archive or delete the child branch sessions first.', 'warning', 4500);
    return false;
  }

  const label = `@${branch?.agent_name || chatJid}${branch?.chat_jid ? ` — ${branch.chat_jid}` : ''}`;
  const confirmed = confirm(
    isRootBranch
      ? `Archive ${label}?\n\nThis removes the session from the session picker. Chat history is preserved.`
      : `Prune ${label}?\n\nThis archives the branch agent and removes it from the branch picker. Chat history is preserved.`
  );
  if (!confirmed) return false;

  try {
    await pruneChatBranch(chatJid);
    await Promise.allSettled([
      refreshActiveChatAgents?.(),
      refreshCurrentChatBranches?.(),
    ]);
    const fallbackChatJid = isRootBranch ? 'web:default' : (branch?.root_chat_jid || 'web:default');
    showIntentToast?.(isRootBranch ? 'Session archived' : 'Branch pruned', `${label} has been archived.`, 'info', 3000);
    const nextUrl = buildChatWindowUrl(baseHref, fallbackChatJid, { chatOnly: chatOnlyMode });
    navigate?.(nextUrl);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'Could not prune branch.');
    showIntentToast?.('Could not prune branch', message || 'Could not prune branch.', 'warning', 5000);
    return false;
  }
}

export interface RestoreBranchOptions {
  targetChatJid?: string | null;
  restoreChatBranch?: (chatJid: string) => Promise<{ branch?: BranchRecord | null }>;
  currentChatBranches?: BranchRecord[];
  refreshActiveChatAgents?: () => Promise<unknown> | unknown;
  refreshCurrentChatBranches?: () => Promise<unknown> | unknown;
  showIntentToast?: ToastFn;
  baseHref: string;
  chatOnlyMode?: boolean;
  navigate?: NavigateFn;
}

/** Restore an archived branch and navigate to the restored chat window. */
export async function restoreBranch(options: RestoreBranchOptions): Promise<boolean> {
  const {
    targetChatJid,
    restoreChatBranch,
    currentChatBranches = [],
    refreshActiveChatAgents,
    refreshCurrentChatBranches,
    showIntentToast,
    baseHref,
    chatOnlyMode,
    navigate,
  } = options;

  const normalized = typeof targetChatJid === 'string' ? targetChatJid.trim() : '';
  if (!normalized || typeof restoreChatBranch !== 'function') return false;

  try {
    const previousBranch = currentChatBranches.find((item) => item?.chat_jid === normalized) || null;
    const response = await restoreChatBranch(normalized);
    await Promise.allSettled([
      refreshActiveChatAgents?.(),
      refreshCurrentChatBranches?.(),
    ]);
    const branch = response?.branch;
    const nextChatJid = typeof branch?.chat_jid === 'string' && branch.chat_jid.trim() ? branch.chat_jid.trim() : normalized;
    const restoreDetail = describeBranchRestoreResult(previousBranch?.agent_name, branch?.agent_name, nextChatJid);
    showIntentToast?.('Branch restored', restoreDetail, 'info', 4200);
    const nextUrl = buildChatWindowUrl(baseHref, nextChatJid, { chatOnly: chatOnlyMode });
    navigate?.(nextUrl);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'Could not restore branch.');
    showIntentToast?.('Could not restore branch', message || 'Could not restore branch.', 'warning', 5000);
    return false;
  }
}

export interface RunBranchLoaderOptions {
  branchLoaderSourceChatJid: string;
  forkChatBranch: (chatJid: string) => Promise<{ branch?: BranchRecord | null }>;
  setBranchLoaderState?: (state: { status: string; message: string }) => void;
  navigate?: NavigateFn;
  baseHref: string;
  isCancelled?: () => boolean;
}

/** Kick off the lightweight branch-loader flow used by chat-only popup windows. */
export async function runBranchLoader(options: RunBranchLoaderOptions): Promise<boolean> {
  const {
    branchLoaderSourceChatJid,
    forkChatBranch,
    setBranchLoaderState,
    navigate,
    baseHref,
    isCancelled = () => false,
  } = options;

  try {
    setBranchLoaderState?.({ status: 'running', message: 'Preparing a new chat branch…' });
    const response = await forkChatBranch(branchLoaderSourceChatJid);
    if (isCancelled()) return false;
    const branch = response?.branch;
    const nextChatJid = typeof branch?.chat_jid === 'string' && branch.chat_jid.trim() ? branch.chat_jid.trim() : null;
    if (!nextChatJid) {
      throw new Error('Branch fork did not return a chat id.');
    }
    const url = buildChatWindowUrl(baseHref, nextChatJid, { chatOnly: true });
    navigate?.(url, { replace: true });
    return true;
  } catch (error) {
    if (isCancelled()) return false;
    setBranchLoaderState?.({
      status: 'error',
      message: describeBranchOpenError(error),
    });
    return false;
  }
}
