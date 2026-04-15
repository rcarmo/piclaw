// @ts-nocheck

import { isMobileBrowserMode, isStandaloneWebAppMode } from './chat-window.js';

export function shouldUseStandaloneMobileViewportFix(runtime = {}) {
  return isStandaloneWebAppMode(runtime) && isMobileBrowserMode(runtime);
}

export function readViewportHeight(runtime = {}) {
  const win = runtime.window ?? (typeof window !== 'undefined' ? window : null);
  const viewportHeight = Number(win?.visualViewport?.height || 0);
  if (Number.isFinite(viewportHeight) && viewportHeight > 0) {
    return Math.round(viewportHeight);
  }
  const innerHeight = Number(win?.innerHeight || 0);
  if (Number.isFinite(innerHeight) && innerHeight > 0) {
    return Math.round(innerHeight);
  }
  return null;
}

export function syncStandaloneMobileViewport(runtime = {}, options = {}) {
  if (!shouldUseStandaloneMobileViewportFix(runtime)) {
    return null;
  }

  const win = runtime.window ?? (typeof window !== 'undefined' ? window : null);
  const doc = runtime.document ?? (typeof document !== 'undefined' ? document : null);
  if (!win || !doc?.documentElement) {
    return null;
  }

  const height = readViewportHeight({ window: win });
  if (height && height > 0) {
    doc.documentElement.style.setProperty('--app-height', `${height}px`);
  }

  // Do not force the page back to the top during normal viewport sync.
  // On mobile, virtual keyboard / caret movement triggers visualViewport
  // resize+scroll events while typing. Resetting scroll here causes the
  // chat to jump on every keystroke. Keep scroll resets opt-in for any
  // future call sites that explicitly need a top reset.
  if (options.resetScroll === true) {
    try {
      if (typeof win.scrollTo === 'function') {
        win.scrollTo(0, 0);
      }
    } catch {}

    try {
      if (doc.scrollingElement) {
        doc.scrollingElement.scrollTop = 0;
        doc.scrollingElement.scrollLeft = 0;
      }
      if (doc.documentElement) {
        doc.documentElement.scrollTop = 0;
        doc.documentElement.scrollLeft = 0;
      }
      if (doc.body) {
        doc.body.scrollTop = 0;
        doc.body.scrollLeft = 0;
      }
    } catch {}
  }

  return height;
}

export function installStandaloneMobileViewportFix(runtime = {}) {
  if (!shouldUseStandaloneMobileViewportFix(runtime)) {
    return () => {};
  }

  const win = runtime.window ?? (typeof window !== 'undefined' ? window : null);
  const doc = runtime.document ?? (typeof document !== 'undefined' ? document : null);
  if (!win || !doc) {
    return () => {};
  }

  let rafId = 0;
  const timers = new Set();

  const clearScheduled = () => {
    if (rafId) {
      win.cancelAnimationFrame?.(rafId);
      rafId = 0;
    }
    for (const timer of timers) {
      win.clearTimeout?.(timer);
    }
    timers.clear();
  };

  const runSync = () => {
    rafId = 0;
    syncStandaloneMobileViewport({ window: win, document: doc });
  };

  const scheduleSync = () => {
    if (rafId) {
      win.cancelAnimationFrame?.(rafId);
    }
    rafId = win.requestAnimationFrame?.(runSync) ?? 0;
  };

  const scheduleSettledSync = () => {
    scheduleSync();
    for (const delay of [80, 220, 420]) {
      const timer = win.setTimeout?.(() => {
        timers.delete(timer);
        scheduleSync();
      }, delay);
      if (timer != null) {
        timers.add(timer);
      }
    }
  };

  const handleVisibility = () => {
    if (doc.visibilityState && doc.visibilityState !== 'visible') return;
    scheduleSettledSync();
  };

  const viewport = win.visualViewport;
  scheduleSettledSync();
  win.addEventListener('focus', scheduleSettledSync);
  win.addEventListener('pageshow', scheduleSettledSync);
  win.addEventListener('resize', scheduleSettledSync);
  win.addEventListener('orientationchange', scheduleSettledSync);
  doc.addEventListener('visibilitychange', handleVisibility);
  doc.addEventListener('focusin', scheduleSettledSync, true);
  viewport?.addEventListener?.('resize', scheduleSettledSync);
  viewport?.addEventListener?.('scroll', scheduleSettledSync);

  return () => {
    clearScheduled();
    win.removeEventListener('focus', scheduleSettledSync);
    win.removeEventListener('pageshow', scheduleSettledSync);
    win.removeEventListener('resize', scheduleSettledSync);
    win.removeEventListener('orientationchange', scheduleSettledSync);
    doc.removeEventListener('visibilitychange', handleVisibility);
    doc.removeEventListener('focusin', scheduleSettledSync, true);
    viewport?.removeEventListener?.('resize', scheduleSettledSync);
    viewport?.removeEventListener?.('scroll', scheduleSettledSync);
  };
}
