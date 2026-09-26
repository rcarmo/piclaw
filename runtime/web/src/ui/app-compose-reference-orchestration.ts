import { useCallback, useEffect } from '../vendor/preact-htm.js';
import { resolveFilePillOpenAction } from './file-pill-open.js';
import {
  appendUniqueStringRef,
  normalizeComposeRefs,
  removeStringRef,
} from './app-shell-ref-utils.js';
import { scrollToTimelineMessage } from './app-timeline-actions.js';
import { buildChatWindowUrl } from './chat-window.js';
import {
  EDITOR_FILE_REFERENCE_REQUEST_EVENT,
  getEditorFileReferencePathFromEvent,
} from './editor-file-reference.js';

type StateSetter<T> = (next: T | ((prev: T) => T)) => void;

interface RefBox<T> {
  current: T;
}

export function resolveComposeSubmitErrorDetail(message: unknown): string {
  if (typeof message === 'string' && message.trim()) {
    return message.trim();
  }
  return 'Could not send your message.';
}

export interface ActivateComposeMessageRefOptions {
  id: unknown;
  targetChatJid?: string | null;
  currentChatJid: string;
  currentHashtag?: string | null;
  searchQuery?: string | null;
  searchOpen?: boolean;
  setCurrentHashtag?: (value: string | null) => void;
  setSearchQuery?: (value: string | null) => void;
  setSearchOpen?: (open: boolean) => void;
  setMessageRefs: StateSetter<string[]>;
  navigate?: (url: string, options?: unknown) => void;
  chatOnlyMode?: boolean;
  baseHref?: string;
}

export function activateComposeMessageRef(options: ActivateComposeMessageRefOptions): boolean {
  const {
    id,
    targetChatJid = null,
    currentChatJid,
    currentHashtag = null,
    searchQuery = null,
    searchOpen = false,
    setCurrentHashtag,
    setSearchQuery,
    setSearchOpen,
    setMessageRefs,
    navigate,
    chatOnlyMode,
    baseHref = typeof window !== 'undefined' ? window.location.href : 'http://localhost/',
  } = options;

  const normalizedId = String(id ?? '').trim();
  if (!normalizedId) return false;

  const resolvedTargetChatJid = typeof targetChatJid === 'string' && targetChatJid.trim()
    ? targetChatJid.trim()
    : currentChatJid;
  const shouldSwitchChat = resolvedTargetChatJid !== currentChatJid;
  const shouldExitSearchContext = Boolean(searchOpen || searchQuery || currentHashtag);

  if (!shouldSwitchChat && !shouldExitSearchContext) {
    setMessageRefs((prev) => appendUniqueStringRef(prev, normalizedId));
    return true;
  }

  setMessageRefs([normalizedId]);
  setCurrentHashtag?.(null);
  setSearchQuery?.(null);
  setSearchOpen?.(false);

  if (shouldSwitchChat && typeof navigate === 'function') {
    const nextUrl = buildChatWindowUrl(baseHref, resolvedTargetChatJid, { chatOnly: chatOnlyMode });
    navigate(nextUrl);
  }

  return true;
}

export function addEditorFileReferenceFromEvent(event: unknown, options: {
  addFileRef: (path: string) => void;
  showIntentToast?: (title: string, detail?: string | null, kind?: string, durationMs?: number) => void;
  focusCompose?: () => void;
}): boolean {
  const path = getEditorFileReferencePathFromEvent(event);
  if (!path) return false;

  options.addFileRef(path);
  options.showIntentToast?.('Reference added', path, 'info', 1800);
  options.focusCompose?.();
  return true;
}

export interface UseComposeReferenceOrchestrationOptions {
  setIntentToast: StateSetter<any>;
  intentToastTimerRef: RefBox<ReturnType<typeof setTimeout> | null>;
  editorOpen: boolean;
  openEditor: (path: string) => void;
  resolvePane: (context: Record<string, unknown>) => unknown;
  tabStripActiveId: string | null;
  setFileRefs: StateSetter<string[]>;
  setFolderRefs: StateSetter<string[]>;
  setMessageRefs: StateSetter<string[]>;
  currentChatJid: string;
  currentHashtag: string | null;
  searchQuery: string | null;
  searchOpen: boolean;
  setCurrentHashtag: (value: string | null) => void;
  setSearchQuery: (value: string | null) => void;
  setSearchOpen: (open: boolean) => void;
  navigate?: (url: string, options?: unknown) => void;
  chatOnlyMode?: boolean;
  baseHref?: string;
  getThread: (id: string | number, chatJid: string) => Promise<any>;
  setPosts: StateSetter<any[] | null>;
}

export interface ComposeReferenceActions {
  clearIntentToast: () => void;
  addFileRef: (path: unknown) => void;
  removeFileRef: (path: unknown) => void;
  clearFileRefs: () => void;
  setFileRefsFromCompose: (next: unknown) => void;
  addFolderRef: (path: unknown) => void;
  removeFolderRef: (path: unknown) => void;
  clearFolderRefs: () => void;
  setFolderRefsFromCompose: (next: unknown) => void;
  showIntentToast: (title: string, detail?: string | null, kind?: string, durationMs?: number) => void;
  openFileFromPill: (path: unknown) => void;
  openTimelineFileFromPill: (path: unknown) => void;
  attachActiveEditorFile: () => void;
  addMessageRef: (id: unknown, targetChatJid?: string | null) => void;
  scrollToMessage: (id: string | number, targetChatJid?: string | null) => Promise<void>;
  removeMessageRef: (id: unknown) => void;
  clearMessageRefs: () => void;
  setMessageRefsFromCompose: (next: unknown) => void;
  handleComposeSubmitError: (message: unknown) => void;
}
export type RemoveFileReference = ComposeReferenceActions['removeFileRef'];
export type RemoveFileReferenceRef = { current: RemoveFileReference | null };

export function useComposeReferenceOrchestration(options: UseComposeReferenceOrchestrationOptions): ComposeReferenceActions {
  const {
    setIntentToast,
    intentToastTimerRef,
    editorOpen,
    openEditor,
    resolvePane,
    tabStripActiveId,
    setFileRefs,
    setFolderRefs,
    setMessageRefs,
    currentChatJid,
    currentHashtag,
    searchQuery,
    searchOpen,
    setCurrentHashtag,
    setSearchQuery,
    setSearchOpen,
    navigate,
    chatOnlyMode,
    baseHref,
    getThread,
    setPosts,
  } = options;

  const clearIntentToast = useCallback(() => {
    if (intentToastTimerRef.current) {
      clearTimeout(intentToastTimerRef.current);
      intentToastTimerRef.current = null;
    }
    setIntentToast(null);
  }, [intentToastTimerRef, setIntentToast]);

  useEffect(() => {
    return () => {
      clearIntentToast();
    };
  }, [clearIntentToast]);

  const addFileRef = useCallback((path: unknown) => {
    setFileRefs((prev) => appendUniqueStringRef(prev, path));
  }, [setFileRefs]);

  const removeFileRef = useCallback((path: unknown) => {
    setFileRefs((prev) => removeStringRef(prev, path));
  }, [setFileRefs]);

  const clearFileRefs = useCallback(() => {
    setFileRefs([]);
  }, [setFileRefs]);

  const setFileRefsFromCompose = useCallback((next: unknown) => {
    setFileRefs(normalizeComposeRefs(next));
  }, [setFileRefs]);

  const addFolderRef = useCallback((path: unknown) => {
    setFolderRefs((prev) => appendUniqueStringRef(prev, path));
  }, [setFolderRefs]);

  const removeFolderRef = useCallback((path: unknown) => {
    setFolderRefs((prev) => removeStringRef(prev, path));
  }, [setFolderRefs]);

  const clearFolderRefs = useCallback(() => {
    setFolderRefs([]);
  }, [setFolderRefs]);

  const setFolderRefsFromCompose = useCallback((next: unknown) => {
    setFolderRefs(normalizeComposeRefs(next));
  }, [setFolderRefs]);

  const showIntentToast = useCallback((title: string, detail: string | null = null, kind = 'info', durationMs = 3000) => {
    clearIntentToast();
    setIntentToast({ title, detail: detail || null, kind: kind || 'info' });
    intentToastTimerRef.current = setTimeout(() => {
      setIntentToast((current: any) => (current?.title === title ? null : current));
    }, durationMs);
  }, [clearIntentToast, intentToastTimerRef, setIntentToast]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const focusCompose = () => {
      const run = () => {
        const textarea = document.querySelector('.compose-box textarea') as HTMLTextAreaElement | null;
        textarea?.focus?.();
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
      else setTimeout(run, 0);
    };
    const handleEditorFileReference = (event: Event) => {
      addEditorFileReferenceFromEvent(event, {
        addFileRef,
        showIntentToast,
        focusCompose,
      });
    };
    window.addEventListener(EDITOR_FILE_REFERENCE_REQUEST_EVENT, handleEditorFileReference);
    return () => window.removeEventListener(EDITOR_FILE_REFERENCE_REQUEST_EVENT, handleEditorFileReference);
  }, [addFileRef, showIntentToast]);

  const openFileFromPillWithMode = useCallback((rawPath: unknown, { autoOpenEditor = false } = {}) => {
    const result = resolveFilePillOpenAction(rawPath, {
      editorOpen,
      autoOpenEditor,
      resolvePane,
    });

    if (result.kind === 'open') {
      openEditor(result.path);
      return;
    }

    if (result.kind === 'toast') {
      showIntentToast(result.title, result.detail, result.level);
    }
  }, [editorOpen, openEditor, resolvePane, showIntentToast]);

  const openFileFromPill = useCallback((rawPath: unknown) => {
    openFileFromPillWithMode(rawPath, { autoOpenEditor: false });
  }, [openFileFromPillWithMode]);

  const openTimelineFileFromPill = useCallback((rawPath: unknown) => {
    openFileFromPillWithMode(rawPath, { autoOpenEditor: true });
  }, [openFileFromPillWithMode]);

  const attachActiveEditorFile = useCallback(() => {
    const activeId = tabStripActiveId;
    if (activeId) addFileRef(activeId);
  }, [addFileRef, tabStripActiveId]);

  const addMessageRef = useCallback((id: unknown, targetChatJid: string | null = null) => {
    activateComposeMessageRef({
      id,
      targetChatJid,
      currentChatJid,
      currentHashtag,
      searchQuery,
      searchOpen,
      setCurrentHashtag,
      setSearchQuery,
      setSearchOpen,
      setMessageRefs,
      navigate,
      chatOnlyMode,
      baseHref,
    });
  }, [baseHref, chatOnlyMode, currentChatJid, currentHashtag, navigate, searchOpen, searchQuery, setCurrentHashtag, setMessageRefs, setSearchOpen, setSearchQuery]);

  const scrollToMessage = useCallback(async (id: string | number, targetChatJid: string | null = null) => {
    await scrollToTimelineMessage({
      id,
      targetChatJid,
      currentChatJid,
      getThread,
      setPosts,
    });
  }, [currentChatJid, getThread, setPosts]);

  const removeMessageRef = useCallback((id: unknown) => {
    setMessageRefs((prev) => removeStringRef(prev, id));
  }, [setMessageRefs]);

  const clearMessageRefs = useCallback(() => {
    setMessageRefs([]);
  }, [setMessageRefs]);

  const setMessageRefsFromCompose = useCallback((next: unknown) => {
    setMessageRefs(normalizeComposeRefs(next));
  }, [setMessageRefs]);

  const handleComposeSubmitError = useCallback((message: unknown) => {
    showIntentToast('Compose failed', resolveComposeSubmitErrorDetail(message), 'error', 5000);
  }, [showIntentToast]);

  return {
    clearIntentToast,
    addFileRef,
    removeFileRef,
    clearFileRefs,
    setFileRefsFromCompose,
    addFolderRef,
    removeFolderRef,
    clearFolderRefs,
    setFolderRefsFromCompose,
    showIntentToast,
    openFileFromPill,
    openTimelineFileFromPill,
    attachActiveEditorFile,
    addMessageRef,
    scrollToMessage,
    removeMessageRef,
    clearMessageRefs,
    setMessageRefsFromCompose,
    handleComposeSubmitError,
  };
}
