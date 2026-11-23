import { useEffect, useRef } from '../vendor/preact-htm.js';
import { SSEClient } from '../api.js';

type SseWakeRuntime = {
  window?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  document?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
  now?: () => number;
  useFocusReconnect?: boolean;
};

export function bindSseWakeLifecycle({ sse, onWake }, runtime: SseWakeRuntime = {}) {
  const win = runtime.window ?? (typeof window !== 'undefined' ? window : null);
  const doc = runtime.document ?? (typeof document !== 'undefined' ? document : null);
  if (!win || !doc || !sse) {
    return () => {};
  }

  const now = runtime.now ?? Date.now;
  let lastWakeAt = -Infinity;
  const reconnectAfterReturn = () => {
    // Some browsers emit pageshow, visibilitychange and online together.
    if (now() - lastWakeAt < 500) return;
    lastWakeAt = now();
    if (typeof sse.forceReconnect === 'function') {
      sse.forceReconnect({ immediate: true });
    } else {
      sse.reconnectIfNeeded({ immediate: true });
    }
    onWake?.();
  };

  // A healthy connection is left alone, including on mobile keyboard focus.
  const shouldUseFocusReconnect = runtime.useFocusReconnect !== false;
  let pendingWake = doc.visibilityState && doc.visibilityState !== 'visible';

  const handleHiddenState = () => {
    if (doc.visibilityState && doc.visibilityState !== 'visible') {
      pendingWake = true;
      return true;
    }
    return false;
  };

  const handleVisibleReturn = () => {
    if (handleHiddenState()) return;
    if (pendingWake) {
      pendingWake = false;
      reconnectAfterReturn();
    }
  };

  const handleWindowFocus = () => {
    if (handleHiddenState()) return;
    if (pendingWake) {
      handleVisibleReturn();
      return;
    }
    if (shouldUseFocusReconnect) {
      if (sse.reconnectIfNeeded({ immediate: true })) onWake?.();
    }
  };

  const handlePageShow = (event) => {
    if (event?.persisted) pendingWake = true;
    handleVisibleReturn();
  };

  const handleOnline = () => {
    pendingWake = true;
    handleVisibleReturn();
  };

  const handleVisibilityChange = () => {
    handleVisibleReturn();
  };

  win.addEventListener('focus', handleWindowFocus);
  win.addEventListener('pageshow', handlePageShow);
  win.addEventListener('online', handleOnline);
  doc.addEventListener('visibilitychange', handleVisibilityChange);

  return () => {
    win.removeEventListener('focus', handleWindowFocus);
    win.removeEventListener('pageshow', handlePageShow);
    win.removeEventListener('online', handleOnline);
    doc.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}

/**
 * Manages the SSE connection lifecycle.
 *
 * All callbacks are accessed via refs so the EventSource is created exactly
 * once and never torn down due to callback identity changes in the parent
 * component.  This breaks the re-render cascade that previously caused an
 * infinite SSE reconnect loop when queue/filter state changed.
 */
export function useSseConnection({ handleSseEvent, handleConnectionStatusChange, loadPosts, onWake, chatJid }) {
  const sseEventRef = useRef(handleSseEvent);
  sseEventRef.current = handleSseEvent;

  const statusChangeRef = useRef(handleConnectionStatusChange);
  statusChangeRef.current = handleConnectionStatusChange;

  const loadPostsRef = useRef(loadPosts);
  loadPostsRef.current = loadPosts;

  const onWakeRef = useRef(onWake);
  onWakeRef.current = onWake;

  useEffect(() => {
    const sse = new SSEClient(
      (type, data) => sseEventRef.current(type, data),
      (status) => statusChangeRef.current(status),
      { chatJid, enableA2uiRpc:true },
    );
    sse.connect();

    const disposeWakeLifecycle = bindSseWakeLifecycle({
      sse,
      onWake: () => onWakeRef.current?.(),
    });

    return () => {
      disposeWakeLifecycle();
      sse.disconnect();
    };
  }, [chatJid]);
}
