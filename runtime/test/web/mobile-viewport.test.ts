import { expect, test } from 'bun:test';

import {
  readViewportHeight,
  shouldUseStandaloneMobileViewportFix,
  syncStandaloneMobileViewport,
} from '../../web/src/ui/mobile-viewport.js';

test('shouldUseStandaloneMobileViewportFix only enables for standalone mobile runtimes', () => {
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
      standalone: false,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',
      maxTouchPoints: 0,
    },
    window: {
      matchMedia: () => ({ matches: false }),
    },
  })).toBe(false);
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

  expect(height).toBe(702);
  expect(cssVars.get('--app-height')).toBe('702px');
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

  expect(height).toBe(702);
  expect(cssVars.get('--app-height')).toBe('702px');
  expect(windowScrolls).toEqual([[0, 0]]);
  expect(scrollingElement.scrollTop).toBe(0);
  expect(scrollingElement.scrollLeft).toBe(0);
  expect(documentElement.scrollTop).toBe(0);
  expect(documentElement.scrollLeft).toBe(0);
  expect(body.scrollTop).toBe(0);
  expect(body.scrollLeft).toBe(0);
});
