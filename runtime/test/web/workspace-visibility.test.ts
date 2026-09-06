import { afterEach, describe, expect, test } from 'bun:test';

import {
  DESKTOP_WORKSPACE_OPEN_STORAGE_KEY,
  persistDesktopWorkspaceOpenPreference,
  readStoredDesktopWorkspaceOpenPreference,
  resolveWorkspaceLayoutBucket,
  shouldCollapseWorkspaceAfterLayoutChange,
} from '../../web/src/ui/workspace-visibility.js';

const originalWindow = (globalThis as any).window;

function createRuntime(options: {
  matchesDesktop?: boolean;
  storage?: Record<string, string>;
  readError?: boolean;
  writeError?: boolean;
} = {}) {
  const storage = new Map(Object.entries(options.storage || {}));
  return {
    localStorage: {
      getItem: (key: string) => {
        if (options.readError) throw new Error('storage blocked');
        return storage.has(key) ? storage.get(key) ?? null : null;
      },
      setItem: (key: string, value: string) => {
        if (options.writeError) throw new Error('storage blocked');
        storage.set(key, value);
      },
    },
    matchMedia: () => ({
      matches: Boolean(options.matchesDesktop),
    }),
    __storage: storage,
  } as any;
}

afterEach(() => {
  (globalThis as any).window = originalWindow;
});

describe('workspace visibility preferences', () => {
  test('resolves layout buckets from the desktop landscape media query', () => {
    expect(resolveWorkspaceLayoutBucket(createRuntime({ matchesDesktop: true }))).toBe('desktop');
    expect(resolveWorkspaceLayoutBucket(createRuntime({ matchesDesktop: false }))).toBe('narrow');
    expect(resolveWorkspaceLayoutBucket(null)).toBe('desktop');
  });

  test('entering narrow layout collapses without auto-opening when widening', () => {
    expect(shouldCollapseWorkspaceAfterLayoutChange('desktop', 'narrow')).toBe(true);
    expect(shouldCollapseWorkspaceAfterLayoutChange('narrow', 'desktop')).toBe(false);
  });

  test('reads only the desktop-scoped preference and accepts only true', () => {
    expect(readStoredDesktopWorkspaceOpenPreference(createRuntime({
      storage: { [DESKTOP_WORKSPACE_OPEN_STORAGE_KEY]: 'true' },
    }))).toBe(true);
    expect(readStoredDesktopWorkspaceOpenPreference(createRuntime({
      storage: { [DESKTOP_WORKSPACE_OPEN_STORAGE_KEY]: 'false' },
    }))).toBe(false);
    expect(readStoredDesktopWorkspaceOpenPreference(createRuntime({
      storage: { [DESKTOP_WORKSPACE_OPEN_STORAGE_KEY]: 'invalid' },
    }))).toBe(false);
    expect(readStoredDesktopWorkspaceOpenPreference(createRuntime({
      storage: { workspaceOpen: 'true', 'workspaceOpen.narrow': 'true' },
    }))).toBe(false);
  });

  test('persists explicit desktop state through the desktop-scoped key', () => {
    const runtime = createRuntime();
    persistDesktopWorkspaceOpenPreference(true, runtime);
    expect(runtime.__storage.get(DESKTOP_WORKSPACE_OPEN_STORAGE_KEY)).toBe('true');
    persistDesktopWorkspaceOpenPreference(false, runtime);
    expect(runtime.__storage.get(DESKTOP_WORKSPACE_OPEN_STORAGE_KEY)).toBe('false');
  });

  test('storage failures are ignored', () => {
    expect(readStoredDesktopWorkspaceOpenPreference(createRuntime({ readError: true }))).toBe(false);
    expect(() => persistDesktopWorkspaceOpenPreference(true, createRuntime({ writeError: true }))).not.toThrow();
    const inaccessible = {} as any;
    Object.defineProperty(inaccessible, 'localStorage', {
      get: () => { throw new Error('storage blocked'); },
    });
    expect(readStoredDesktopWorkspaceOpenPreference(inaccessible)).toBe(false);
    expect(() => persistDesktopWorkspaceOpenPreference(true, inaccessible)).not.toThrow();
  });
});
