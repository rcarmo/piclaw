interface RefBox<T> {
  current: T;
}

type RafLike = (callback: () => void) => void;

export interface ApplyStoredSidebarWidthOptions {
  readStoredNumber: (key: string, fallback?: number | null) => number | null;
  sidebarWidthRef: RefBox<number>;
  shellElement: HTMLElement | null;
  minWidth?: number;
  maxWidth?: number;
  fallbackWidth?: number;
}

/** Read and apply persisted sidebar width to shell CSS vars. */
export function applyStoredSidebarWidth(options: ApplyStoredSidebarWidthOptions): number {
  const {
    readStoredNumber,
    sidebarWidthRef,
    shellElement,
    minWidth = 160,
    maxWidth = 600,
    fallbackWidth = 280,
  } = options;

  const saved = readStoredNumber('sidebarWidth', null);
  const resolved = Number.isFinite(saved)
    ? Math.min(Math.max(Number(saved), minWidth), maxWidth)
    : fallbackWidth;

  sidebarWidthRef.current = resolved;
  if (shellElement) {
    shellElement.style.setProperty('--sidebar-width', `${resolved}px`);
  }

  return resolved;
}

export interface RunTimelineLoadFlowOptions {
  currentHashtag: string | null;
  searchQuery: string | null;
  searchScope: string;
  currentChatJid: string;
  currentRootChatJid: string;
  loadPosts: (hashtag?: string | null) => Promise<void>;
  searchPosts: (
    query: string,
    limit: number,
    offset: number,
    chatJid: string,
    scope: string,
    rootChatJid: string,
  ) => Promise<{ results?: any[] }>;
  setPosts: (next: any[] | null) => void;
  setHasMore: (next: boolean) => void;
  scrollToBottom: () => void;
  isCancelled: () => boolean;
  scheduleRaf?: RafLike;
  scheduleTimeout?: (callback: () => void, delayMs: number) => void;
  onTimelineLoadStart?: (detail?: Record<string, unknown>) => void;
  onTimelineDataReady?: (detail?: Record<string, unknown>) => void;
  onTimelineFirstPaint?: (detail?: Record<string, unknown>) => void;
  onTimelineError?: (error: unknown, detail?: Record<string, unknown>) => void;
}

/**
 * Run the timeline load/search flow for the current view state.
 * The caller owns cancellation and provides `isCancelled` checks.
 */
export async function runTimelineLoadFlow(options: RunTimelineLoadFlowOptions): Promise<void> {
  const {
    currentHashtag,
    searchQuery,
    searchScope,
    currentChatJid,
    currentRootChatJid,
    loadPosts,
    searchPosts,
    setPosts,
    setHasMore,
    scrollToBottom,
    isCancelled,
    scheduleRaf = (callback) => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(callback);
        return;
      }
      setTimeout(callback, 0);
    },
    scheduleTimeout = (callback, delayMs) => {
      setTimeout(callback, delayMs);
    },
    onTimelineLoadStart,
    onTimelineDataReady,
    onTimelineFirstPaint,
    onTimelineError,
  } = options;

  const noteFirstPaint = (detail?: Record<string, unknown>) => {
    if (isCancelled()) return;
    scheduleRaf(() => {
      if (isCancelled()) return;
      scheduleRaf(() => {
        if (isCancelled()) return;
        onTimelineFirstPaint?.(detail);
      });
    });
  };

  const safeScrollToBottom = () => {
    if (isCancelled()) return;
    scheduleRaf(() => {
      if (isCancelled()) return;
      scheduleTimeout(() => {
        if (isCancelled()) return;
        scrollToBottom();
      }, 0);
    });
  };

  if (currentHashtag) {
    onTimelineLoadStart?.({ mode: 'hashtag', hashtag: currentHashtag });
    try {
      await loadPosts(currentHashtag);
      if (isCancelled()) return;
      onTimelineDataReady?.({ mode: 'hashtag', hashtag: currentHashtag });
      noteFirstPaint({ mode: 'hashtag' });
    } catch (error) {
      if (isCancelled()) return;
      onTimelineError?.(error, { mode: 'hashtag', hashtag: currentHashtag });
      throw error;
    }
    return;
  }

  if (searchQuery) {
    onTimelineLoadStart?.({ mode: 'search', searchQuery, searchScope });
    try {
      const result = await searchPosts(searchQuery, 50, 0, currentChatJid, searchScope, currentRootChatJid);
      if (isCancelled()) return;
      setPosts(Array.isArray(result?.results) ? result.results : []);
      setHasMore(false);
      onTimelineDataReady?.({ mode: 'search', resultCount: Array.isArray(result?.results) ? result.results.length : 0 });
      noteFirstPaint({ mode: 'search' });
    } catch (error) {
      if (isCancelled()) return;
      onTimelineError?.(error, { mode: 'search', searchQuery, searchScope });
      console.error('Failed to search:', error);
      setPosts([]);
      setHasMore(false);
    }
    return;
  }

  onTimelineLoadStart?.({ mode: 'timeline' });
  try {
    await loadPosts();
    if (isCancelled()) return;
    onTimelineDataReady?.({ mode: 'timeline' });
    noteFirstPaint({ mode: 'timeline' });
    safeScrollToBottom();
  } catch (error) {
    if (isCancelled()) return;
    onTimelineError?.(error, { mode: 'timeline' });
    console.error('Failed to load timeline:', error);
  }
}
