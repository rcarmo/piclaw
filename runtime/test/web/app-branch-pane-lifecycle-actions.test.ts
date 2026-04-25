import { expect, test } from 'bun:test';

import {
  applyStoredPaneLayoutAction,
  handleBranchPickerChangeAction,
  runBranchLoaderModeEffect,
  toggleWorkspaceVisibility,
  watchPaneOpenEventBridge,
} from '../../web/src/ui/app-branch-pane-lifecycle-actions.js';

test('toggleWorkspaceVisibility flips boolean state via setter callback', () => {
  let value = true;
  toggleWorkspaceVisibility((next) => {
    value = typeof next === 'function' ? next(value) : next;
    return value;
  });
  expect(value).toBe(false);

  toggleWorkspaceVisibility((next) => {
    value = typeof next === 'function' ? next(value) : next;
    return value;
  });
  expect(value).toBe(true);
});

test('handleBranchPickerChangeAction delegates branch navigation with chat-only urls', () => {
  const calls: string[] = [];

  expect(handleBranchPickerChangeAction({
    hasWindow: true,
    nextChatJid: 'web:child',
    currentChatJid: 'web:root',
    chatOnlyMode: true,
    currentHref: 'https://example.test/?chat_jid=web%3Aroot',
    navigate: (url) => calls.push(url),
  })).toBe(true);

  expect(calls).toHaveLength(1);
  expect(calls[0]).toContain('chat_jid=web%3Achild');
});

test('runBranchLoaderModeEffect launches loader and cancellation flag flips on cleanup', () => {
  let isCancelledProbe: (() => boolean) | null = null;

  const cleanup = runBranchLoaderModeEffect({
    branchLoaderMode: true,
    branchLoaderSourceChatJid: 'web:root',
    forkChatBranch: async () => ({ status: 'ok', chat_jid: 'web:new' }),
    setBranchLoaderState: () => {},
    navigate: () => {},
    hasWindow: true,
    baseHref: 'https://example.test/',
    runBranchLoaderImpl: async ({ isCancelled }) => {
      isCancelledProbe = isCancelled;
      return null;
    },
  });

  expect(isCancelledProbe).not.toBeNull();
  expect(isCancelledProbe?.()).toBe(false);
  cleanup?.();
  expect(isCancelledProbe?.()).toBe(true);
});

test('watchPaneOpenEventBridge maps openTab/editSource/popOut events to shell handlers', () => {
  const opened: Array<{ path: string; label?: string | null; paneOverrideId?: string | null }> = [];
  const popped: Array<{ path: string; label?: string | null }> = [];

  const cleanup = watchPaneOpenEventBridge({
    openEditor: (path, options) => opened.push({
      path,
      label: (options as any)?.label ?? null,
      paneOverrideId: (options as any)?.paneOverrideId ?? null,
    }),
    popOutPane: (path, label) => popped.push({ path, label }),
    watchPaneOpenEventsImpl: ({ openTab, editSource, popOutPane }) => {
      openTab?.('/workspace/readme.md', 'README');
      editSource?.('/workspace/site/index.html', 'Home');
      popOutPane?.('/workspace/diagram.widget', 'Diagram');
      return () => {};
    },
  });

  expect(opened).toEqual([
    { path: '/workspace/readme.md', label: 'README', paneOverrideId: null },
    { path: '/workspace/site/index.html', label: 'Home', paneOverrideId: 'editor' },
  ]);
  expect(popped).toEqual([{ path: '/workspace/diagram.widget', label: 'Diagram' }]);
  expect(typeof cleanup).toBe('function');
});

test('applyStoredPaneLayoutAction hydrates css vars and ref defaults', () => {
  const styleCalls: Array<[string, string]> = [];
  const shell = {
    style: {
      setProperty: (key: string, value: string) => styleCalls.push([key, value]),
    },
  } as unknown as HTMLElement;

  const editorWidthRef = { current: 0 };
  const dockHeightRef = { current: 0 };
  const sidebarWidthRef = { current: 280 };

  applyStoredPaneLayoutAction({
    hasWindow: true,
    editorOpen: true,
    shellElement: shell,
    editorWidthRef,
    dockHeightRef,
    sidebarWidthRef,
    readStoredNumber: (key) => {
      if (key === 'editorWidth') return 320;
      if (key === 'dockHeight') return 220;
      return null;
    },
  });

  expect(editorWidthRef.current).toBe(320);
  expect(dockHeightRef.current).toBe(220);
  expect(styleCalls).toEqual([
    ['--editor-width', '320px'],
    ['--dock-height', '220px'],
  ]);
});
