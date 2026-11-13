import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function readCssRule(css: string, selector: string): string {
  const index = css.indexOf(`\n${selector} {`);
  if (index < 0) return '';
  const start = css.indexOf('{', index);
  const end = css.indexOf('}', start);
  if (start < 0 || end < 0) return '';
  return css.slice(start + 1, end);
}

import {
  installIOSBrowserKeyboardViewportFix,
  installStandaloneMobileViewportFix,
  shouldUseIOSBrowserKeyboardViewportFix,
  readViewportHeight,
  shouldUseStandaloneMobileViewportFix,
  syncStandaloneMobileViewport,
} from '../../web/src/ui/mobile-viewport.js';

test('shouldUseStandaloneMobileViewportFix only enables for standalone iOS mobile runtimes', () => {
  expect(shouldUseStandaloneMobileViewportFix({
    navigator: {
      standalone: true,
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)',
      maxTouchPoints: 5,
    },
    window: {
      matchMedia: () => ({ matches: true }),
    },
  })).toBe(true);

  expect(shouldUseStandaloneMobileViewportFix({
    navigator: {
      standalone: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36',
      maxTouchPoints: 5,
    },
    window: {
      matchMedia: () => ({ matches: true }),
    },
  })).toBe(false);

  expect(shouldUseStandaloneMobileViewportFix({
    navigator: {
      standalone: false,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',
      maxTouchPoints: 0,
    },
    window: {
      matchMedia: () => ({ matches: false }),
    },
  })).toBe(false);
});

test('index bootstraps standalone app height before loading bundled CSS', () => {
  const html = readFileSync(new URL('../../web/static/classic/index.html', import.meta.url), 'utf8');
  const bootstrapIndex = html.indexOf('iOS standalone PWA guard: set --app-height before CSS loads');
  const cssIndex = html.indexOf('rel="stylesheet" href="/static/classic/dist/app.bundle.css');
  expect(bootstrapIndex).toBeGreaterThan(0);
  expect(cssIndex).toBeGreaterThan(bootstrapIndex);
  expect(html).toContain("document.documentElement.style.setProperty('--app-height', '100vh')");
});

test('container CSS has a single --app-height height declaration', () => {
  const css = readFileSync(new URL('../../web/static/classic/css/editor.css', import.meta.url), 'utf8');
  const rule = readCssRule(css, '.container');
  // Container must not also declare height:100%; the app-height variable must win.
  expect(rule).toContain('height: var(--app-height, 100dvh);');
  expect(rule).not.toContain('height: 100%;');
});

test('body stays in normal flow and uses --app-height (not fixed/inset)', () => {
  const css = readFileSync(new URL('../../web/static/classic/css/base.css', import.meta.url), 'utf8');
  const rule = readCssRule(css, 'body');
  const declarations = rule.replace(/\/\*[\s\S]*?\*\//g, '');
  expect(declarations).toMatch(/height\s*:\s*var\(--app-height,\s*100dvh\)/);
  expect(declarations).toMatch(/min-height\s*:\s*var\(--app-height,\s*100dvh\)/);
  expect(declarations).not.toMatch(/position\s*:\s*fixed/);
  expect(declarations).not.toMatch(/inset\s*:\s*0/);
});

test('readViewportHeight prefers visualViewport height when available', () => {
  expect(readViewportHeight({
    window: {
      visualViewport: { height: 612.4 },
      innerHeight: 900,
    },
  })).toBe(612);

  expect(readViewportHeight({
    window: {
      innerHeight: 844,
    },
  })).toBe(844);
});

test('syncStandaloneMobileViewport uses standalone 100vh instead of short visual viewport gaps when keyboard is closed', () => {
  const cssVars = new Map<string, string>();
  const documentElement = {
    style: {
      setProperty: (name: string, value: string) => cssVars.set(name, value),
    },
  };

  const height = syncStandaloneMobileViewport({
    navigator: {
      standalone: true,
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)',
      maxTouchPoints: 5,
    },
    window: {
      matchMedia: () => ({ matches: true }),
      visualViewport: { height: 741 },
      innerHeight: 800,
    },
    document: {
      documentElement,
    },
  });

  expect(height).toBe(800);
  expect(cssVars.get('--app-height')).toBe('100vh');
});

test('syncStandaloneMobileViewport does not persist false short standalone viewport measurements when keyboard is closed', () => {
  const cssVars = new Map<string, string>();
  const documentElement = {
    style: {
      setProperty: (name: string, value: string) => cssVars.set(name, value),
    },
  };

  const height = syncStandaloneMobileViewport({
    navigator: {
      standalone: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      maxTouchPoints: 5,
    },
    window: {
      matchMedia: () => ({ matches: true }),
      visualViewport: { height: 701.9 },
      innerHeight: 812,
    },
    document: {
      documentElement,
      activeElement: null,
    },
  });

  expect(height).toBe(812);
  expect(cssVars.get('--app-height')).toBe('100vh');
});

test('syncStandaloneMobileViewport ignores focused textarea when iOS standalone viewport only has the cold-start safe-area gap', () => {
  const cssVars = new Map<string, string>();
  const documentElement = {
    style: {
      setProperty: (name: string, value: string) => cssVars.set(name, value),
    },
  };

  const height = syncStandaloneMobileViewport({
    navigator: {
      standalone: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      maxTouchPoints: 5,
    },
    window: {
      matchMedia: () => ({ matches: true }),
      visualViewport: { height: 793, offsetTop: 0 },
      innerHeight: 793,
      innerWidth: 393,
      screen: { width: 393, height: 852 },
    },
    document: {
      documentElement,
      activeElement: { tagName: 'TEXTAREA', type: 'textarea' },
    },
  });

  expect(height).toBe(793);
  expect(cssVars.get('--app-height')).toBe('100vh');
});

test('syncStandaloneMobileViewport keeps large visual viewport shrink for virtual keyboard', () => {
  const cssVars = new Map<string, string>();
  const documentElement = {
    style: {
      setProperty: (name: string, value: string) => cssVars.set(name, value),
    },
  };

  const height = syncStandaloneMobileViewport({
    navigator: {
      standalone: true,
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)',
      maxTouchPoints: 5,
    },
    window: {
      matchMedia: () => ({ matches: true }),
      visualViewport: { height: 430 },
      innerHeight: 800,
    },
    document: {
      documentElement,
      activeElement: { tagName: 'TEXTAREA', type: 'textarea' },
    },
  });

  expect(height).toBe(430);
  expect(cssVars.get('--app-height')).toBe('430px');
});

test('syncStandaloneMobileViewport does not inflate keyboard height with visualViewport offsetTop', () => {
  const cssVars = new Map<string, string>();
  const documentElement = {
    style: {
      setProperty: (name: string, value: string) => cssVars.set(name, value),
    },
  };

  const height = syncStandaloneMobileViewport({
    navigator: {
      standalone: true,
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)',
      maxTouchPoints: 5,
    },
    window: {
      matchMedia: () => ({ matches: true }),
      visualViewport: { height: 430, offsetTop: 54 },
      innerHeight: 800,
    },
    document: {
      documentElement,
      activeElement: { tagName: 'TEXTAREA', type: 'textarea' },
    },
  });

  expect(height).toBe(430);
  expect(cssVars.get('--app-height')).toBe('430px');
});

test('syncStandaloneMobileViewport writes app height without resetting page scroll by default', () => {
  const cssVars = new Map<string, string>();
  const windowScrolls: Array<[number, number]> = [];
  const scrollingElement = { scrollTop: 91, scrollLeft: 17 };
  const documentElement = {
    scrollTop: 33,
    scrollLeft: 8,
    style: {
      setProperty: (name: string, value: string) => cssVars.set(name, value),
    },
  };
  const body = { scrollTop: 19, scrollLeft: 7 };

  const height = syncStandaloneMobileViewport({
    navigator: {
      standalone: true,
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)',
      maxTouchPoints: 5,
    },
    window: {
      matchMedia: () => ({ matches: true }),
      visualViewport: { height: 701.9 },
      innerHeight: 900,
      scrollTo: (x: number, y: number) => windowScrolls.push([x, y]),
    },
    document: {
      documentElement,
      body,
      scrollingElement,
    },
  });

  expect(height).toBe(900);
  expect(cssVars.get('--app-height')).toBe('100vh');
  expect(windowScrolls).toEqual([]);
  expect(scrollingElement.scrollTop).toBe(91);
  expect(scrollingElement.scrollLeft).toBe(17);
  expect(documentElement.scrollTop).toBe(33);
  expect(documentElement.scrollLeft).toBe(8);
  expect(body.scrollTop).toBe(19);
  expect(body.scrollLeft).toBe(7);
});

test('syncStandaloneMobileViewport can reset page scroll when explicitly requested', () => {
  const cssVars = new Map<string, string>();
  const windowScrolls: Array<[number, number]> = [];
  const scrollingElement = { scrollTop: 91, scrollLeft: 17 };
  const documentElement = {
    scrollTop: 33,
    scrollLeft: 8,
    style: {
      setProperty: (name: string, value: string) => cssVars.set(name, value),
    },
  };
  const body = { scrollTop: 19, scrollLeft: 7 };

  const height = syncStandaloneMobileViewport({
    navigator: {
      standalone: true,
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)',
      maxTouchPoints: 5,
    },
    window: {
      matchMedia: () => ({ matches: true }),
      visualViewport: { height: 701.9 },
      innerHeight: 900,
      scrollTo: (x: number, y: number) => windowScrolls.push([x, y]),
    },
    document: {
      documentElement,
      body,
      scrollingElement,
    },
  }, { resetScroll: true });

  expect(height).toBe(900);
  expect(cssVars.get('--app-height')).toBe('100vh');
  expect(windowScrolls).toEqual([[0, 0]]);
  expect(scrollingElement.scrollTop).toBe(0);
  expect(scrollingElement.scrollLeft).toBe(0);
  expect(documentElement.scrollTop).toBe(0);
  expect(documentElement.scrollLeft).toBe(0);
  expect(body.scrollTop).toBe(0);
  expect(body.scrollLeft).toBe(0);
});

test('installStandaloneMobileViewportFix is inert on Android standalone so native keyboard scroll can settle', () => {
  const cssVars = new Map<string, string>();
  const added: string[] = [];
  const documentElement = {
    style: {
      setProperty: (name: string, value: string) => cssVars.set(name, value),
      removeProperty: (name: string) => cssVars.delete(name),
    },
    removeAttribute: () => {},
  };
  const document = {
    documentElement,
    addEventListener: (type: string) => added.push(`doc:${type}`),
    removeEventListener: () => {},
  };
  const window = {
    matchMedia: () => ({ matches: true }),
    visualViewport: {
      height: 640,
      addEventListener: (type: string) => added.push(`vv:${type}`),
      removeEventListener: () => {},
    },
    innerHeight: 800,
    addEventListener: (type: string) => added.push(`win:${type}`),
    removeEventListener: () => {},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
  };

  const dispose = installStandaloneMobileViewportFix({
    navigator: {
      standalone: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36',
      maxTouchPoints: 5,
    },
    window,
    document,
  });

  expect(cssVars.get('--app-height')).toBeUndefined();
  expect(added).toEqual([]);

  dispose();
});

test('installStandaloneMobileViewportFix restores standalone 100vh on focusout after keyboard sizing', () => {
  const cssVars = new Map<string, string>();
  type VoidListener = () => void;
  const listeners = new Map<string, Set<VoidListener>>();
  const addEventListener = (type: string, listener: VoidListener) => {
    const set = listeners.get(type) ?? new Set<VoidListener>();
    set.add(listener);
    listeners.set(type, set);
  };
  const removeEventListener = (type: string, listener: VoidListener) => {
    listeners.get(type)?.delete(listener);
  };
  const dispatch = (type: string) => {
    for (const listener of listeners.get(type) ?? []) listener();
  };
  const documentElement = {
    style: {
      setProperty: (name: string, value: string) => cssVars.set(name, value),
    },
  };
  const document = {
    documentElement,
    activeElement: { tagName: 'TEXTAREA', type: 'textarea' } as any,
    addEventListener,
    removeEventListener,
  };
  const timeoutCallbacks: Array<() => void> = [];
  const window = {
    matchMedia: () => ({ matches: true }),
    visualViewport: { height: 430, addEventListener, removeEventListener },
    innerHeight: 800,
    addEventListener,
    removeEventListener,
    requestAnimationFrame: (callback: () => void) => {
      callback();
      return 1;
    },
    cancelAnimationFrame: () => {},
    setTimeout: (callback: () => void) => {
      timeoutCallbacks.push(callback);
      return timeoutCallbacks.length;
    },
    clearTimeout: () => {},
  };

  const dispose = installStandaloneMobileViewportFix({
    navigator: {
      standalone: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      maxTouchPoints: 5,
    },
    window,
    document,
  });

  expect(cssVars.get('--app-height')).toBe('430px');

  document.activeElement = null;
  dispatch('focusout');

  expect(cssVars.get('--app-height')).toBe('100vh');

  dispose();
});

// iPad and iPhone Safari (browser mode, not installed): the keyboard or the
// hardware-keyboard shortcut bar shrinks the visual viewport but not 100dvh, so
// Safari pans the page up and leaves a blank band under the status bar. While a
// text field is focused the app is sized to the visible area instead.
function fakeIOSBrowser({ height = 860, focused = true } = {}) {
  const cssVars = new Map<string, string>();
  const attrs = new Map<string, string>();
  type Listener = () => void;
  const listeners = new Map<string, Set<Listener>>();
  const on = (type: string, listener: Listener) => { const set = listeners.get(type) ?? new Set<Listener>(); set.add(listener); listeners.set(type, set); };
  const off = (type: string, listener: Listener) => { listeners.get(type)?.delete(listener); };
  const scrolls: number[] = [];
  const documentElement = {
    style: { setProperty: (n: string, v: string) => cssVars.set(n, v), removeProperty: (n: string) => cssVars.delete(n) },
    setAttribute: (n: string, v: string) => attrs.set(n, v), removeAttribute: (n: string) => attrs.delete(n),
    scrollTop: 0, scrollLeft: 0,
  };
  const document = {
    documentElement,
    activeElement: focused ? ({ tagName: 'TEXTAREA', type: 'textarea' } as any) : null,
    addEventListener: (t: string, l: Listener) => on(`doc:${t}`, l), removeEventListener: (t: string, l: Listener) => off(`doc:${t}`, l),
  };
  const window = {
    matchMedia: () => ({ matches: false }),
    visualViewport: { height, addEventListener: (t: string, l: Listener) => on(`vv:${t}`, l), removeEventListener: (t: string, l: Listener) => off(`vv:${t}`, l) },
    innerHeight: 950,
    addEventListener: (t: string, l: Listener) => on(`win:${t}`, l), removeEventListener: (t: string, l: Listener) => off(`win:${t}`, l),
    requestAnimationFrame: (cb: () => void) => { cb(); return 1; }, cancelAnimationFrame: () => {},
    setTimeout: () => 0, clearTimeout: () => {},
    scrollTo: (_x: number, y: number) => scrolls.push(y),
  };
  const navigator = { standalone: false, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 };
  const dispatch = (key: string) => { for (const l of listeners.get(key) ?? []) l(); };
  return { cssVars, attrs, scrolls, document, window, navigator, dispatch, listeners };
}

test('the iOS browser keyboard viewport fix applies to iPad/iPhone Safari only, not installed apps, Android or desktops', () => {
  const ipad = fakeIOSBrowser();
  expect(shouldUseIOSBrowserKeyboardViewportFix({ window: ipad.window, navigator: ipad.navigator })).toBe(true);
  expect(shouldUseIOSBrowserKeyboardViewportFix({ window: { matchMedia: () => ({ matches: true }) }, navigator: { ...ipad.navigator, standalone: true } })).toBe(false);
  expect(shouldUseIOSBrowserKeyboardViewportFix({ window: ipad.window, navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/124 Mobile Safari/537.36', maxTouchPoints: 5 } })).toBe(false);
  expect(shouldUseIOSBrowserKeyboardViewportFix({ window: ipad.window, navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)', platform: 'MacIntel', maxTouchPoints: 0 } })).toBe(false);
});

test('iPad Safari sizes the app to the visible area while a text field is focused and stops the page panning', () => {
  const env = fakeIOSBrowser({ height: 858 });
  const dispose = installIOSBrowserKeyboardViewportFix({ window: env.window, document: env.document, navigator: env.navigator });
  env.dispatch('doc:focusin');
  expect(env.cssVars.get('--app-height')).toBe('858px');
  expect(env.attrs.get('data-ios-keyboard-viewport')).toBe('1');
  expect(env.scrolls.length).toBeGreaterThan(0);
  // Safari panning the visual viewport while the keyboard is up is undone.
  env.scrolls.length = 0;
  env.dispatch('vv:scroll');
  expect(env.scrolls).toEqual([0]);
  // The keyboard closing restores the stylesheet's 100dvh and normal panning.
  env.document.activeElement = null;
  env.dispatch('doc:focusout');
  expect(env.cssVars.has('--app-height')).toBe(false);
  expect(env.attrs.has('data-ios-keyboard-viewport')).toBe(false);
  env.scrolls.length = 0;
  env.dispatch('vv:scroll');
  expect(env.scrolls).toEqual([]);
  dispose();
  expect([...env.listeners.values()].every((set) => set.size === 0)).toBe(true);
});

test('the iOS browser keyboard viewport fix is inert elsewhere', () => {
  const env = fakeIOSBrowser();
  const dispose = installIOSBrowserKeyboardViewportFix({ window: env.window, document: env.document, navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)', platform: 'MacIntel', maxTouchPoints: 0 } });
  expect(env.listeners.size).toBe(0);
  dispose();
});
