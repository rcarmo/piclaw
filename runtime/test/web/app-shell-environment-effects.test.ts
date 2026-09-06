import { afterEach, expect, test } from 'bun:test';

import {
  RESUME_LAYOUT_SETTLING_CLASS,
  applyWorkspaceLayoutChange,
  applyBrandingIconLinks,
  persistBtwSession,
  scheduleResumeLayoutSettling,
  shouldApplyBrandingDocumentTitle,
} from '../../web/src/ui/app-shell-environment-effects.js';
import {
  DESKTOP_WORKSPACE_OPEN_STORAGE_KEY,
  persistDesktopWorkspaceOpenPreference,
} from '../../web/src/ui/workspace-visibility.js';
import { BTW_SESSION_KEY } from '../../web/src/ui/app-shell-state.js';
import { formatSessionBrowserTitle } from '../../web/src/ui/browser-title.js';

const originalWindow = (globalThis as any).window;

afterEach(() => {
  (globalThis as any).window = originalWindow;
});

test('persistBtwSession stores normalized side-session payload', () => {
  const writes = new Map<string, string>();
  (globalThis as any).window = {
    localStorage: {
      setItem: (key: string, value: string) => {
        writes.set(key, value);
      },
    },
  };

  persistBtwSession({
    question: 'Q',
    answer: 'A',
    thinking: 'T',
    error: null,
    status: 'running',
  });

  expect(writes.has(BTW_SESSION_KEY)).toBe(true);
  const parsed = JSON.parse(writes.get(BTW_SESSION_KEY) || '{}');
  expect(parsed).toEqual({
    question: 'Q',
    answer: 'A',
    thinking: 'T',
    error: null,
    status: 'running',
  });
});

test('formatSessionBrowserTitle appends a normalized session handle', () => {
  expect(formatSessionBrowserTitle('Smith', 'research')).toBe('Smith - @research');
  expect(formatSessionBrowserTitle(' Smith ', '@research')).toBe('Smith - @research');
  expect(formatSessionBrowserTitle('Smith', '  ')).toBe('Smith');
  expect(formatSessionBrowserTitle('', null)).toBe('PiClaw');
});

test('shouldApplyBrandingDocumentTitle skips title overrides in pane popouts', () => {
  expect(shouldApplyBrandingDocumentTitle()).toBe(true);
  expect(shouldApplyBrandingDocumentTitle({ panePopoutMode: true })).toBe(false);
  expect(shouldApplyBrandingDocumentTitle({ search: '?pane_popout=1&pane_path=AGENTS.md' })).toBe(false);
});

test('scheduleResumeLayoutSettling applies and later clears the settling class', () => {
  const classes = new Set<string>();
  const element = {
    classList: {
      add: (value: string) => { classes.add(value); },
      remove: (value: string) => { classes.delete(value); },
    },
  } as any;
  const queued: Array<() => void> = [];

  scheduleResumeLayoutSettling(element, {
    durationMs: 220,
    scheduleTimeout: ((callback: () => void) => {
      queued.push(callback);
      return callback as any;
    }) as any,
    clearScheduledTimeout: (() => {}) as any,
  });

  expect(classes.has(RESUME_LAYOUT_SETTLING_CLASS)).toBe(true);
  queued.shift()?.();
  expect(classes.has(RESUME_LAYOUT_SETTLING_CLASS)).toBe(false);
});

test('applyBrandingIconLinks updates manifest, favicon, and apple-touch hrefs with a shared cache buster', () => {
  const links = new Map<string, { href: string }>([
    ['dynamic-manifest', { href: '/manifest.json' }],
    ['dynamic-favicon', { href: '/favicon.ico' }],
    ['dynamic-apple-touch-icon', { href: '/apple-touch-icon.png' }],
    ['dynamic-apple-touch-icon-180', { href: '/apple-touch-icon-180x180.png' }],
    ['dynamic-apple-touch-icon-167', { href: '/apple-touch-icon-167x167.png' }],
    ['dynamic-apple-touch-icon-152', { href: '/apple-touch-icon-152x152.png' }],
    ['dynamic-apple-touch-icon-precomposed', { href: '/apple-touch-icon-precomposed.png' }],
  ]);

  applyBrandingIconLinks({
    getElementById: (id: string) => links.get(id) || null,
  }, '2026-04-29T14:00:00.000Z');

  expect(links.get('dynamic-manifest')?.href).toBe('/manifest.json?v=2026-04-29T14%3A00%3A00.000Z');
  expect(links.get('dynamic-favicon')?.href).toBe('/favicon.ico?v=2026-04-29T14%3A00%3A00.000Z');
  expect(links.get('dynamic-apple-touch-icon')?.href).toBe('/apple-touch-icon.png?v=2026-04-29T14%3A00%3A00.000Z');
  expect(links.get('dynamic-apple-touch-icon-180')?.href).toBe('/apple-touch-icon-180x180.png?v=2026-04-29T14%3A00%3A00.000Z');
  expect(links.get('dynamic-apple-touch-icon-167')?.href).toBe('/apple-touch-icon-167x167.png?v=2026-04-29T14%3A00%3A00.000Z');
  expect(links.get('dynamic-apple-touch-icon-152')?.href).toBe('/apple-touch-icon-152x152.png?v=2026-04-29T14%3A00%3A00.000Z');
  expect(links.get('dynamic-apple-touch-icon-precomposed')?.href).toBe('/apple-touch-icon-precomposed.png?v=2026-04-29T14%3A00%3A00.000Z');
});

test('persistBtwSession clears storage when no session exists', () => {
  const writes = new Map<string, string>();
  (globalThis as any).window = {
    localStorage: {
      setItem: (key: string, value: string) => {
        writes.set(key, value);
      },
    },
  };

  persistBtwSession(null);
  expect(writes.get(BTW_SESSION_KEY)).toBe('');
});

test('desktop to narrow closes without overwriting the desktop preference', () => {
  const storage = new Map<string, string>();
  const runtime = {
    localStorage: {
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  };
  persistDesktopWorkspaceOpenPreference(true, runtime);

  let workspaceOpen = true;
  applyWorkspaceLayoutChange('desktop', 'narrow', (next) => {
    workspaceOpen = next;
  });

  expect(workspaceOpen).toBe(false);
  expect(storage.get(DESKTOP_WORKSPACE_OPEN_STORAGE_KEY)).toBe('true');
});

test('narrow to desktop does not auto-open during the current page', () => {
  let calls = 0;
  applyWorkspaceLayoutChange('narrow', 'desktop', () => {
    calls += 1;
  });
  expect(calls).toBe(0);
});
