
import { isMobileBrowserMode, isStandaloneWebAppMode } from './chat-window.js';

function isIOSStandaloneRuntime(runtime = {}): boolean {
  const nav = runtime.navigator ?? (typeof navigator !== 'undefined' ? navigator : null);
  const userAgent = String(nav?.userAgent || '');
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  return String(nav?.platform || '') === 'MacIntel' && Number(nav?.maxTouchPoints || 0) > 1;
}

export function shouldUseStandaloneMobileViewportFix(runtime = {}) {
  // This fix writes --app-height and forcibly resets the root/page scroll to
  // counter iOS standalone PWA visualViewport drift. Android Chrome already
  // keeps the page/visual viewport in sync around the soft keyboard; applying
  // the iOS reset loop there fights native settling and can leave compose
  // bouncing instead of pinned at the bottom.
  return isStandaloneWebAppMode(runtime) && isMobileBrowserMode(runtime) && isIOSStandaloneRuntime(runtime);
}

function shouldUseIphoneStandaloneComposeInset(runtime = {}): boolean {
  if (!shouldUseStandaloneMobileViewportFix(runtime)) return false;
  return isIOSStandaloneRuntime(runtime);
}

function readIphoneStandaloneViewportCompensation(win: any, options: { keyboardActive?: boolean } = {}): number {
  if (options.keyboardActive) return 0;

  const screenHeight = readCurrentScreenHeight(win);
  if (!screenHeight || screenHeight <= 0) return 0;

  const viewportHeight = Number(win?.visualViewport?.height || 0);
  const innerHeight = Number(win?.innerHeight || 0);
  const candidateHeight = Number.isFinite(viewportHeight) && viewportHeight > 0
    ? viewportHeight
    : (Number.isFinite(innerHeight) && innerHeight > 0 ? innerHeight : 0);

  if (!candidateHeight || candidateHeight <= 0) return 0;

  const gap = Math.round(screenHeight - candidateHeight);
  const maxExpectedGap = Math.max(120, Math.round(screenHeight * 0.2));
  if (!Number.isFinite(gap) || gap <= 0 || gap > maxExpectedGap) return 0;
  return gap;
}


function measureSafeAreaInset(doc: any, edge: 'top' | 'bottom'): number {
  if (!doc?.body || typeof doc.createElement !== 'function') return 0;
  const view = doc.defaultView ?? (typeof window !== 'undefined' ? window : null);
  const probe = doc.createElement('div');
  probe.style.cssText = [
    'position:fixed',
    'visibility:hidden',
    'pointer-events:none',
    'width:0',
    'height:0',
    'overflow:hidden',
    'padding:0',
    'border:0',
    edge === 'top' ? 'top:0;left:0;padding-top:env(safe-area-inset-top,0px)' : 'left:0;bottom:0;padding-bottom:env(safe-area-inset-bottom,0px)',
  ].join(';');
  doc.body.appendChild(probe);
  const computedStyle = view && typeof view.getComputedStyle === 'function' ? view.getComputedStyle(probe) : null;
  const computed = edge === 'top'
    ? Number.parseFloat(String(computedStyle?.paddingTop ?? '0'))
    : Number.parseFloat(String(computedStyle?.paddingBottom ?? '0'));
  const fallback = probe.offsetHeight;
  probe.remove();
  const value = Number.isFinite(computed) ? computed : fallback;
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function readIphoneStandaloneBottomSafeArea(win: any, doc: any, options: { keyboardActive?: boolean } = {}): number {
  if (options.keyboardActive) return 0;
  const measuredBottom = measureSafeAreaInset(doc, 'bottom');
  if (measuredBottom > 0) return measuredBottom;
  return 0;
}

function buildIphoneStandaloneComposeInsetValue(win: any, doc: any, options: { keyboardActive?: boolean } = {}): string {
  if (options.keyboardActive) return '0px';
  const compensation = readIphoneStandaloneViewportCompensation(win, options);
  const safeBottom = readIphoneStandaloneBottomSafeArea(win, doc, options);
  const totalInset = Math.max(0, compensation) + Math.max(0, safeBottom);
  if (totalInset > 0) {
    return `${totalInset}px`;
  }
  return 'env(safe-area-inset-bottom, 0px)';
}

function buildStandaloneComposeInsetBootstrapValue(_win: any): string {
  return 'env(safe-area-inset-bottom, 0px)';
}

function isTextEntryFocused(doc: any): boolean {
  const active = doc?.activeElement;
  if (!active) return false;
  const tagName = String(active.tagName || active.nodeName || '').toLowerCase();
  if (tagName === 'textarea' || tagName === 'select') return true;
  if (tagName === 'input') {
    const type = String(active.type || 'text').toLowerCase();
    return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(type);
  }
  if (active.isContentEditable === true) return true;
  if (typeof active.closest === 'function') {
    try {
      return Boolean(active.closest('[contenteditable="true"], [contenteditable="plaintext-only"]'));
    } catch (error) {
      console.debug('[mobile-viewport] Ignoring activeElement.closest failure during keyboard detection.', error);
    }
  }
  return false;
}

export function readViewportHeight(runtime = {}, options = {}) {
  const win = runtime.window ?? (typeof window !== 'undefined' ? window : null);
  const viewportHeight = Number(win?.visualViewport?.height || 0);
  const innerHeight = Number(win?.innerHeight || 0);
  const hasViewportHeight = Number.isFinite(viewportHeight) && viewportHeight > 0;
  const hasInnerHeight = Number.isFinite(innerHeight) && innerHeight > 0;

  if (hasViewportHeight) {
    if (options.keyboardActive === true) {
      // When the software keyboard is visible, visualViewport.height already
      // represents the usable space above it. Do not add offsetTop here.
      // Inflating the measurement leaves the compose box partly under the
      // keyboard on iOS. The PWA doc says to sync from visualViewport.height.
      return Math.round(viewportHeight);
    }
    if (options.ignoreStandaloneChromeGap === true && hasInnerHeight && innerHeight > viewportHeight) {
      return Math.round(innerHeight);
    }
    return Math.round(viewportHeight);
  }
  if (hasInnerHeight) {
    return Math.round(innerHeight);
  }
  return null;
}

function readCurrentScreenHeight(win: any): number | null {
  const screenWidth = Number(win?.screen?.width || 0);
  const screenHeight = Number(win?.screen?.height || 0);
  if (!Number.isFinite(screenWidth) || !Number.isFinite(screenHeight) || screenWidth <= 0 || screenHeight <= 0) {
    return null;
  }

  const innerWidth = Number(win?.innerWidth || 0);
  const innerHeight = Number(win?.innerHeight || 0);
  const isLandscape = Number.isFinite(innerWidth) && Number.isFinite(innerHeight) && innerWidth > innerHeight;
  return Math.round(isLandscape ? Math.min(screenWidth, screenHeight) : Math.max(screenWidth, screenHeight));
}

function isVirtualKeyboardLikelyVisible(win: any): boolean {
  const viewportHeight = Number(win?.visualViewport?.height || 0);
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return false;

  const innerHeight = Number(win?.innerHeight || 0);
  if (Number.isFinite(innerHeight) && innerHeight > 0) {
    // Primary signal: while the keyboard is open, visualViewport.height becomes
    // materially smaller than innerHeight. This is more reliable than screen-
    // based thresholds on iPad/tablet layouts and avoids treating the cold-start
    // standalone chrome gap as a keyboard.
    if (viewportHeight < innerHeight - 20) return true;
  }

  const screenHeight = readCurrentScreenHeight(win);
  if (screenHeight && screenHeight > 0) {
    // Fallback: ignore the small cold-start standalone lie (~safe-area-top), but
    // treat larger shrinks as an active keyboard.
    const keyboardThreshold = Math.max(120, Math.round(screenHeight * 0.16));
    return viewportHeight < screenHeight - keyboardThreshold;
  }

  return false;
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

  const textEntryFocused = isTextEntryFocused(doc);
  const keyboardActive = textEntryFocused && isVirtualKeyboardLikelyVisible(win);

  if (shouldUseIphoneStandaloneComposeInset({ window: win, navigator: runtime.navigator ?? win.navigator })) {
    doc.documentElement.style.setProperty(
      '--iphone-standalone-compose-safe-area-bottom',
      buildIphoneStandaloneComposeInsetValue(win, doc, { keyboardActive }),
    );
    doc.documentElement?.setAttribute?.('data-iphone-standalone-compose-inset', '1');
  } else {
    doc.documentElement?.style?.removeProperty?.('--iphone-standalone-compose-safe-area-bottom');
    doc.documentElement?.removeAttribute?.('data-iphone-standalone-compose-inset');
  }
  const height = readViewportHeight({ window: win }, { ignoreStandaloneChromeGap: true, keyboardActive });
  if (keyboardActive) {
    if (height && height > 0) {
      doc.documentElement.style.setProperty('--app-height', `${height}px`);
    }
  } else {
    // In iOS standalone, both visualViewport.height and innerHeight can briefly
    // under-report after app resume or keyboard dismissal. Do not persist that
    // false short measurement into the app shell; use standalone 100vh while the
    // keyboard is closed so the compose box remains flush with the viewport.
    doc.documentElement.style.setProperty('--app-height', '100vh');
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
    } catch (error) {
      console.debug('[mobile-viewport] Ignoring scrollTo failure during standalone viewport reset.', error);
    }

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
    } catch (error) {
      console.debug('[mobile-viewport] Ignoring DOM scroll reset failure during standalone viewport sync.', error);
    }
  }

  return height;
}

export function installStandaloneMobileViewportFix(runtime = {}) {
  if (!shouldUseStandaloneMobileViewportFix(runtime)) {
    return () => {};
  }

  const win = runtime.window ?? (typeof window !== 'undefined' ? window : null);
  const doc = runtime.document ?? (typeof document !== 'undefined' ? document : null);
  const nav = runtime.navigator ?? win?.navigator ?? (typeof navigator !== 'undefined' ? navigator : null);
  if (!win || !doc) {
    return () => {};
  }

  // Keep this paired with the pre-CSS bootstrap in static/index.html.
  // 100dvh is correct for browser chrome, but iOS standalone PWAs can
  // cold-start it ~safe-area-top too short, leaving a bottom gap below compose.
  // Standalone mode has no URL bar, so 100vh is the stable full-screen unit.
  // See docs/PWA.md before changing this path.
  doc.documentElement?.style?.setProperty?.('--app-height', '100vh');
  if (shouldUseIphoneStandaloneComposeInset({ window: win, navigator: nav })) {
    doc.documentElement?.style?.setProperty?.(
      '--iphone-standalone-compose-safe-area-bottom',
      buildStandaloneComposeInsetBootstrapValue({ ...win, navigator: nav }),
    );
    doc.documentElement?.setAttribute?.('data-iphone-standalone-compose-inset', '1');
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
    syncStandaloneMobileViewport({ window: win, document: doc, navigator: nav });
  };

  const scheduleSync = () => {
    if (rafId) {
      win.cancelAnimationFrame?.(rafId);
    }
    rafId = win.requestAnimationFrame?.(runSync) ?? 0;
  };

  const scheduleSettledSync = () => {
    scheduleSync();
    for (const delay of [80, 220, 420, 800, 1200]) {
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

  // On iOS standalone without a fixed root, the visual viewport can scroll
  // when the keyboard opens. Aggressively reset scroll on focus events to
  // counteract this. The --app-height sync handles resizing the shell.
  const resetScroll = () => {
    try {
      if (typeof win.scrollTo === 'function') win.scrollTo(0, 0);
      if (doc.scrollingElement) { doc.scrollingElement.scrollTop = 0; doc.scrollingElement.scrollLeft = 0; }
      if (doc.documentElement) { doc.documentElement.scrollTop = 0; doc.documentElement.scrollLeft = 0; }
      if (doc.body) { doc.body.scrollTop = 0; doc.body.scrollLeft = 0; }
    } catch (e) {
      console.debug('[mobile-viewport] Ignoring scroll reset failure.', e);
    }
  };

  const handleFocusIn = () => {
    resetScroll();
    scheduleSettledSync();
    // iOS may scroll the visual viewport after focusin with a slight delay.
    // Fire additional resets to counteract.
    for (const delay of [16, 50, 100, 200]) {
      const t = win.setTimeout?.(() => { timers.delete(t); resetScroll(); }, delay);
      if (t != null) timers.add(t);
    }
  };

  const handleFocusOut = () => {
    resetScroll();
    scheduleSettledSync();
    for (const delay of [16, 50, 100]) {
      const t = win.setTimeout?.(() => { timers.delete(t); resetScroll(); }, delay);
      if (t != null) timers.add(t);
    }
  };

  const viewport = win.visualViewport;
  scheduleSettledSync();
  win.addEventListener('focus', scheduleSettledSync);
  win.addEventListener('pageshow', scheduleSettledSync);
  win.addEventListener('resize', scheduleSettledSync);
  win.addEventListener('orientationchange', scheduleSettledSync);
  doc.addEventListener('visibilitychange', handleVisibility);
  doc.addEventListener('focusin', handleFocusIn, true);
  doc.addEventListener('focusout', handleFocusOut, true);
  viewport?.addEventListener?.('resize', scheduleSettledSync);
  viewport?.addEventListener?.('scroll', resetScroll);

  return () => {
    clearScheduled();
    win.removeEventListener('focus', scheduleSettledSync);
    win.removeEventListener('pageshow', scheduleSettledSync);
    win.removeEventListener('resize', scheduleSettledSync);
    win.removeEventListener('orientationchange', scheduleSettledSync);
    doc.removeEventListener('visibilitychange', handleVisibility);
    doc.removeEventListener('focusin', handleFocusIn, true);
    doc.removeEventListener('focusout', handleFocusOut, true);
    viewport?.removeEventListener?.('resize', scheduleSettledSync);
    viewport?.removeEventListener?.('scroll', resetScroll);
    doc.documentElement?.style?.removeProperty?.('--iphone-standalone-compose-safe-area-bottom');
    doc.documentElement?.removeAttribute?.('data-iphone-standalone-compose-inset');
  };
}

/**
 * iPad and iPhone Safari in browser mode (not installed to the home screen).
 * The software keyboard, or the shortcut bar shown with a hardware keyboard,
 * shrinks the visual viewport but not 100dvh, so Safari pans the page up to
 * keep the focused field visible. That hides the top of the app and leaves a
 * blank band under the status bar that the whole page can be scrolled into.
 * While a text field is focused, size the app to the visible area and undo the
 * panning; on blur, hand height back to the stylesheet's 100dvh.
 */
export function shouldUseIOSBrowserKeyboardViewportFix(runtime: { window?: any; navigator?: any } = {}) {
  return isIOSStandaloneRuntime(runtime) && !isStandaloneWebAppMode(runtime);
}

export function installIOSBrowserKeyboardViewportFix(runtime: { window?: any; document?: any; navigator?: any } = {}) {
  if (!shouldUseIOSBrowserKeyboardViewportFix(runtime)) return () => {};
  const win = runtime.window ?? (typeof window !== 'undefined' ? window : null);
  const doc = runtime.document ?? (typeof document !== 'undefined' ? document : null);
  const root = doc?.documentElement;
  if (!win || !root) return () => {};

  let active = false;
  const timers = new Set();
  const resetScroll = () => {
    try {
      win.scrollTo?.(0, 0);
      if (doc.scrollingElement) doc.scrollingElement.scrollTop = 0;
      root.scrollTop = 0;
      if (doc.body) doc.body.scrollTop = 0;
    } catch (error) {
      console.debug('[mobile-viewport] Ignoring scroll reset failure.', error);
    }
  };
  const sync = () => {
    const height = Math.round(Number(win.visualViewport?.height || 0));
    active = isTextEntryFocused(doc) && height > 0;
    if (active) {
      root.style.setProperty('--app-height', `${height}px`);
      root.setAttribute?.('data-ios-keyboard-viewport', '1');
      resetScroll();
    } else {
      root.style.removeProperty?.('--app-height');
      root.removeAttribute?.('data-ios-keyboard-viewport');
    }
  };
  // The keyboard animates in and out after focus changes; settle a few times.
  const settle = () => {
    sync();
    for (const delay of [50, 150, 300, 600]) {
      const timer = win.setTimeout?.(() => { timers.delete(timer); sync(); }, delay);
      if (timer) timers.add(timer);
    }
  };
  const onViewportScroll = () => { if (active) resetScroll(); };

  const viewport = win.visualViewport;
  doc.addEventListener('focusin', settle, true);
  doc.addEventListener('focusout', settle, true);
  viewport?.addEventListener?.('resize', sync);
  viewport?.addEventListener?.('scroll', onViewportScroll);
  return () => {
    for (const timer of timers) win.clearTimeout?.(timer);
    timers.clear();
    doc.removeEventListener('focusin', settle, true);
    doc.removeEventListener('focusout', settle, true);
    viewport?.removeEventListener?.('resize', sync);
    viewport?.removeEventListener?.('scroll', onViewportScroll);
    root.style.removeProperty?.('--app-height');
    root.removeAttribute?.('data-ios-keyboard-viewport');
  };
}
