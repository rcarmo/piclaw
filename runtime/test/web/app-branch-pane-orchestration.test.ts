import { afterEach, expect, test } from 'bun:test';

import {
  applyStoredPaneLayout,
  closeTransferredPaneSource,
  invokePaneBeforeDetachFromHost,
  navigateToSelectedBranch,
  resolvePanePopoutTransfer,
} from '../../web/src/ui/app-branch-pane-orchestration.js';
import { getAppPerfTracing } from '../../web/src/ui/app-perf-tracing.js';

afterEach(() => {
  getAppPerfTracing().clear();
});

test('navigateToSelectedBranch ignores same/blank chats and navigates when selection changes', () => {
  const calls: string[] = [];

  expect(navigateToSelectedBranch({
    hasWindow: true,
    nextChatJid: 'web:main',
    currentChatJid: 'web:main',
    chatOnlyMode: true,
    currentHref: 'https://example.test/?chat_jid=web%3Amain',
    navigate: (url) => calls.push(url),
  })).toBe(false);

  expect(navigateToSelectedBranch({
    hasWindow: true,
    nextChatJid: ' web:branch ',
    currentChatJid: 'web:main',
    chatOnlyMode: true,
    currentHref: 'https://example.test/?chat_jid=web%3Amain',
    navigate: (url) => calls.push(url),
  })).toBe(true);

  expect(calls).toHaveLength(1);
  expect(calls[0]).toContain('chat_jid=web%3Abranch');

  const traces = getAppPerfTracing().getTraces();
  expect(traces).toHaveLength(1);
  expect(traces[0]?.type).toBe('thread-switch');
  expect(traces[0]?.chatJid).toBe('web:branch');
  expect(traces[0]?.phases.map((phase) => phase.phase)).toEqual(['intent', 'navigation-dispatched']);
});

test('invokePaneBeforeDetachFromHost calls the pane detach lifecycle hook when present', async () => {
  const calls: Array<{ path?: string; target: 'popout' }> = [];
  await invokePaneBeforeDetachFromHost({
    beforeDetachFromHost: async (context) => {
      calls.push(context);
    },
  }, '/workspace/notes.md');

  expect(calls).toEqual([{ path: '/workspace/notes.md', target: 'popout' }]);
});

test('resolvePanePopoutTransfer uses active editor transfer first, then dock terminal transfer', async () => {
  const editorTransfer = async () => ({ cursor: '10' });
  const dockTransfer = async () => ({ cwd: '/workspace' });

  await expect(resolvePanePopoutTransfer({
    panePath: '/workspace/readme.md',
    tabStripActiveId: '/workspace/readme.md',
    editorInstanceRef: { current: { preparePopoutTransfer: editorTransfer } },
    dockInstanceRef: { current: { preparePopoutTransfer: dockTransfer } },
    terminalTabPath: '/__terminal__',
  })).resolves.toEqual({ cursor: '10' });

  await expect(resolvePanePopoutTransfer({
    panePath: '/__terminal__',
    tabStripActiveId: '/workspace/readme.md',
    editorInstanceRef: { current: { preparePopoutTransfer: editorTransfer } },
    dockInstanceRef: { current: { preparePopoutTransfer: dockTransfer } },
    terminalTabPath: '/__terminal__',
    resolveTab: () => null,
  })).resolves.toEqual({ cwd: '/workspace' });
});

test('resolvePanePopoutTransfer prefers the terminal tab instance when the terminal is open as a tab', async () => {
  const editorTransfer = async () => ({ live: 'terminal-tab' });
  const dockTransfer = async () => ({ live: 'dock' });

  await expect(resolvePanePopoutTransfer({
    panePath: '/__terminal__',
    tabStripActiveId: '/__terminal__',
    editorInstanceRef: { current: { preparePopoutTransfer: editorTransfer } },
    dockInstanceRef: { current: { preparePopoutTransfer: dockTransfer } },
    terminalTabPath: '/__terminal__',
    resolveTab: () => ({ dirty: false }),
  })).resolves.toEqual({ live: 'terminal-tab' });
});

test('resolvePanePopoutTransfer activates an inactive tab before requesting transfer state', async () => {
  let activeTabId = '/workspace/readme.md';
  const staleTransfer = async () => ({ stale: '1' });
  const nextTransfer = async () => ({ pane_path: 'piclaw://vnc/lab' });
  const editorInstanceRef = { current: { preparePopoutTransfer: staleTransfer } };
  const activateCalls: string[] = [];

  const resultPromise = resolvePanePopoutTransfer({
    panePath: 'piclaw://vnc/lab',
    tabStripActiveId: '/workspace/readme.md',
    editorInstanceRef,
    dockInstanceRef: { current: null },
    terminalTabPath: '/__terminal__',
    activateTab: (path) => {
      activateCalls.push(path);
      setTimeout(() => {
        activeTabId = path;
        editorInstanceRef.current = { preparePopoutTransfer: nextTransfer };
      }, 0);
    },
    getActiveTabId: () => activeTabId,
  });

  await expect(resultPromise).resolves.toEqual({ pane_path: 'piclaw://vnc/lab' });
  expect(activateCalls).toEqual(['piclaw://vnc/lab']);
});

test('resolvePanePopoutTransfer runs beforeDetachFromHost before preparing transfer data', async () => {
  const order: string[] = [];
  await expect(resolvePanePopoutTransfer({
    panePath: '/workspace/notes.md',
    tabStripActiveId: '/workspace/notes.md',
    editorInstanceRef: { current: {
      beforeDetachFromHost: async () => { order.push('before'); },
      preparePopoutTransfer: async () => {
        order.push('prepare');
        return { editor_popout: 'token-1' };
      },
    } },
    dockInstanceRef: { current: null },
    terminalTabPath: '/__terminal__',
  })).resolves.toEqual({ editor_popout: 'token-1' });

  expect(order).toEqual(['before', 'prepare']);
});

test('resolvePanePopoutTransfer falls back to generic editor transfer payloads', async () => {
  const buildEditorPopoutTransfer = (panePath: string) => ({ editor_popout: `token:${panePath}` });

  await expect(resolvePanePopoutTransfer({
    panePath: '/workspace/notes.md',
    tabStripActiveId: '/workspace/notes.md',
    editorInstanceRef: { current: { getContent: () => '# Draft', isDirty: () => true } },
    dockInstanceRef: { current: null },
    terminalTabPath: '/__terminal__',
    buildEditorPopoutTransfer,
  })).resolves.toEqual({ editor_popout: 'token:/workspace/notes.md' });
});

test('closeTransferredPaneSource closes clean tabs and falls back to hiding dock for terminal', () => {
  const closed: string[] = [];
  const dockVisibility: boolean[] = [];

  closeTransferredPaneSource({
    panePath: '/workspace/a.md',
    terminalTabPath: '/__terminal__',
    dockVisible: true,
    resolveTab: () => ({ dirty: false }),
    closeTab: (path) => closed.push(path),
    setDockVisible: (next) => dockVisibility.push(next),
  });

  closeTransferredPaneSource({
    panePath: '/__terminal__',
    terminalTabPath: '/__terminal__',
    dockVisible: true,
    resolveTab: () => null,
    closeTab: (path) => closed.push(path),
    setDockVisible: (next) => dockVisibility.push(next),
  });

  expect(closed).toEqual(['/workspace/a.md']);
  expect(dockVisibility).toEqual([false]);
});

test('applyStoredPaneLayout hydrates editor/dock css vars from storage fallback rules', () => {
  const styleCalls: Array<[string, string]> = [];
  const shell = {
    style: {
      setProperty: (key: string, value: string) => styleCalls.push([key, value]),
    },
  } as unknown as HTMLElement;

  const editorWidthRef = { current: 0 };
  const dockHeightRef = { current: 0 };
  const sidebarWidthRef = { current: 320 };

  applyStoredPaneLayout({
    hasWindow: true,
    editorOpen: true,
    shellElement: shell,
    editorWidthRef,
    dockHeightRef,
    sidebarWidthRef,
    readStoredNumber: (key) => {
      if (key === 'editorWidth') return null;
      if (key === 'dockHeight') return 250;
      return null;
    },
  });

  expect(editorWidthRef.current).toBe(320);
  expect(dockHeightRef.current).toBe(250);
  expect(styleCalls).toEqual([
    ['--editor-width', '320px'],
    ['--dock-height', '250px'],
  ]);
});
