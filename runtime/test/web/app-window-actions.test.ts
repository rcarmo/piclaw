import { afterEach, expect, test } from 'bun:test';

import {
  createSessionFromCompose,
  popOutChat,
  popOutPane,
} from '../../web/src/ui/app-window-actions.js';
import { getAppPerfTracing } from '../../web/src/ui/app-perf-tracing.js';

const originalWindow = globalThis.window;

afterEach(() => {
  getAppPerfTracing().clear();
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
});

test('createSessionFromCompose refreshes branch state and navigates to the new chat', async () => {
  const toasts: Array<[string, string, string, number]> = [];
  const navigateCalls: string[] = [];
  const refreshes: string[] = [];

  const created = await createSessionFromCompose({
    currentChatJid: 'web:root',
    chatOnlyMode: true,
    forkChatBranch: async () => ({ branch: { chat_jid: 'web:new', agent_name: 'feature' } }),
    refreshActiveChatAgents: async () => { refreshes.push('active'); },
    refreshCurrentChatBranches: async () => { refreshes.push('branches'); },
    showIntentToast: (title: string, message: string, kind: string, timeout: number) => {
      toasts.push([title, message, kind, timeout]);
    },
    navigate: (url: string) => navigateCalls.push(url),
    baseHref: 'https://example.test/?chat_jid=web%3Aroot',
  });

  expect(created).toBe(true);
  expect(refreshes.sort()).toEqual(['active', 'branches']);
  expect(toasts).toContainEqual(['New branch created', 'Switched to @feature.', 'info', 2500]);
  expect(navigateCalls[0]).toContain('chat_jid=web%3Anew');

  const traces = getAppPerfTracing().getTraces();
  expect(traces).toHaveLength(1);
  expect(traces[0]?.type).toBe('branch-create');
  expect(traces[0]?.chatJid).toBe('web:root');
  expect(traces[0]?.phases.map((phase) => phase.phase)).toEqual([
    'intent',
    'fork-request-start',
    'fork-request-ready',
    'navigation-dispatched',
  ]);
});

test('popOutPane transfers pane state and closes the source tab after navigation', async () => {
  const toastCalls: Array<[string, string, string, number]> = [];
  const closed: string[] = [];
  let prepared = 0;

  const openedWindow = {
    document: { title: '', body: { innerHTML: '' } },
    location: {
      replace: (url: string) => {
        openedWindow.lastUrl = url;
      },
    },
    lastUrl: '',
  } as any;

  globalThis.window = {
    open: () => openedWindow,
    matchMedia: () => ({ matches: false }),
    navigator: { userAgent: 'Desktop', maxTouchPoints: 0 },
  } as any;

  const result = await popOutPane({
    hasWindow: true,
    isWebAppMode: false,
    path: '/workspace/file.md',
    label: 'Preview',
    currentChatJid: 'web:branch',
    baseHref: 'https://example.test/?chat_jid=web%3Abranch',
    showIntentToast: (title: string, message: string, kind: string, timeout: number) => {
      toastCalls.push([title, message, kind, timeout]);
    },
    resolveSourceTransfer: async (panePath: string) => {
      expect(panePath).toBe('/workspace/file.md');
      prepared += 1;
      return { cursor: '123' };
    },
    closeSourcePaneIfTransferred: (panePath: string) => closed.push(panePath),
  });

  expect(result).toBe(true);
  expect(prepared).toBe(1);
  expect(closed).toEqual(['/workspace/file.md']);
  expect(openedWindow.lastUrl).toContain('pane_popout=1');
  expect(toastCalls).toEqual([]);
});

test('popOutPane allows transfer params to replace the pane path', async () => {
  const openedWindow = {
    document: { title: '', body: { innerHTML: '' } },
    location: {
      replace: (url: string) => {
        openedWindow.lastUrl = url;
      },
    },
    lastUrl: '',
  } as any;

  globalThis.window = {
    open: () => openedWindow,
    matchMedia: () => ({ matches: false }),
    navigator: { userAgent: 'Desktop', maxTouchPoints: 0 },
  } as any;

  const result = await popOutPane({
    hasWindow: true,
    isWebAppMode: false,
    path: 'piclaw://vnc',
    label: 'VNC',
    currentChatJid: 'web:branch',
    baseHref: 'https://example.test/?chat_jid=web%3Abranch',
    resolveSourceTransfer: async () => ({
      pane_path: 'piclaw://vnc/lab',
    }),
    closeSourcePaneIfTransferred: () => undefined,
  });

  expect(result).toBe(true);
  expect(openedWindow.lastUrl).toContain('pane_path=piclaw%3A%2F%2Fvnc%2Flab');
  expect(openedWindow.lastUrl).not.toContain('vnc_handoff=');
});

test('popOutPane keeps the source pane open when no transferable session state exists', async () => {
  const closed: string[] = [];
  const openedWindow = {
    document: { title: '', body: { innerHTML: '' } },
    location: {
      replace: (url: string) => {
        openedWindow.lastUrl = url;
      },
    },
    lastUrl: '',
  } as any;

  globalThis.window = {
    open: () => openedWindow,
    matchMedia: () => ({ matches: false }),
    navigator: { userAgent: 'Desktop', maxTouchPoints: 0 },
  } as any;

  const result = await popOutPane({
    hasWindow: true,
    isWebAppMode: false,
    path: 'piclaw://vnc/lab',
    label: 'Lab',
    currentChatJid: 'web:branch',
    baseHref: 'https://example.test/?chat_jid=web%3Abranch',
    resolveSourceTransfer: async () => null,
    closeSourcePaneIfTransferred: (panePath: string) => closed.push(panePath),
  });

  expect(result).toBe(true);
  expect(closed).toEqual([]);
  expect(openedWindow.lastUrl).toContain('pane_popout=1');
});

test('popOutPane reports the opened window to detach-aware callers instead of closing the source pane', async () => {
  const closed: string[] = [];
  const openedCalls: Array<{ panePath: string; params: Record<string, string> | null }> = [];
  const openedWindow = {
    document: { title: '', body: { innerHTML: '' } },
    location: {
      replace: (url: string) => {
        openedWindow.lastUrl = url;
      },
    },
    lastUrl: '',
  } as any;

  globalThis.window = {
    open: () => openedWindow,
    matchMedia: () => ({ matches: false }),
    navigator: { userAgent: 'Desktop', maxTouchPoints: 0 },
  } as any;

  const result = await popOutPane({
    hasWindow: true,
    isWebAppMode: false,
    path: '/workspace/file.md',
    label: 'Notes',
    currentChatJid: 'web:branch',
    baseHref: 'https://example.test/?chat_jid=web%3Abranch',
    resolveSourceTransfer: async () => ({
      pane_instance_id: 'pane-inst-1',
      pane_window_id: 'pane-win-2',
    }),
    closeSourcePaneIfTransferred: (panePath: string) => closed.push(panePath),
    onPaneWindowOpened: (panePath: string, _handle: any, params: Record<string, string> | null) => {
      openedCalls.push({ panePath, params });
    },
  });

  expect(result).toBe(true);
  expect(closed).toEqual([]);
  expect(openedCalls).toEqual([
    {
      panePath: '/workspace/file.md',
      params: {
        pane_instance_id: 'pane-inst-1',
        pane_window_id: 'pane-win-2',
      },
    },
  ]);
});

test('popOutChat opens a loader tab on mobile-like window mode', async () => {
  const openCalls: Array<[string, string | undefined]> = [];
  globalThis.window = {
    open: (url: string, target?: string) => {
      openCalls.push([url, target]);
      return {};
    },
    matchMedia: (query: string) => ({ matches: query.includes('pointer: coarse') }),
    navigator: { userAgent: 'iPhone', maxTouchPoints: 5 },
  } as any;

  const ok = await popOutChat({
    hasWindow: true,
    isWebAppMode: false,
    currentChatJid: 'web:root',
    currentRootChatJid: 'web:root',
    forkChatBranch: async () => ({ branch: { chat_jid: 'web:new' } }),
    getActiveChatAgents: async () => ({ chats: [] }),
    getChatBranches: async () => ({ chats: [] }),
    setActiveChatAgents: () => undefined,
    setCurrentChatBranches: () => undefined,
    showIntentToast: () => undefined,
    baseHref: 'https://example.test/?chat_jid=web%3Aroot',
  });

  expect(ok).toBe(true);
  expect(openCalls[0]?.[0]).toContain('branch_loader=1');
});

test('popOutChat opens a provisional popup and navigates it after branch creation', async () => {
  const toastCalls: Array<[string, string, string, number]> = [];
  const openedWindow = {
    document: { title: '', body: { innerHTML: '' } },
    location: {
      replace: (url: string) => {
        openedWindow.lastUrl = url;
      },
    },
    close: () => {
      openedWindow.closed = true;
    },
    lastUrl: '',
    closed: false,
  } as any;

  globalThis.window = {
    open: () => openedWindow,
    matchMedia: () => ({ matches: false }),
    navigator: { userAgent: 'Desktop', maxTouchPoints: 0 },
  } as any;

  const activeSets: unknown[] = [];
  const branchSets: unknown[] = [];
  const ok = await popOutChat({
    hasWindow: true,
    isWebAppMode: false,
    currentChatJid: 'web:root',
    currentRootChatJid: 'web:root',
    forkChatBranch: async () => ({ branch: { chat_jid: 'web:new' } }),
    getActiveChatAgents: async () => ({ chats: [{ chat_jid: 'web:new' }] }),
    getChatBranches: async () => ({ chats: [{ chat_jid: 'web:new' }] }),
    setActiveChatAgents: (rows: unknown) => activeSets.push(rows),
    setCurrentChatBranches: (rows: unknown) => branchSets.push(rows),
    showIntentToast: (title: string, message: string, kind: string, timeout: number) => {
      toastCalls.push([title, message, kind, timeout]);
    },
    baseHref: 'https://example.test/?chat_jid=web%3Aroot',
  });

  expect(ok).toBe(true);
  expect(activeSets).toEqual([[{ chat_jid: 'web:new' }]]);
  expect(branchSets).toEqual([[{ chat_jid: 'web:new' }]]);
  expect(openedWindow.lastUrl).toContain('chat_jid=web%3Anew');
  expect(toastCalls).toEqual([]);
});

test('popOutChat tolerates refresh races and still navigates the provisional popup', async () => {
  const openedWindow = {
    document: { title: '', body: { innerHTML: '' } },
    location: {
      replace: (url: string) => {
        openedWindow.lastUrl = url;
      },
    },
    close: () => {
      openedWindow.closed = true;
    },
    lastUrl: '',
    closed: false,
  } as any;

  globalThis.window = {
    open: () => openedWindow,
    matchMedia: () => ({ matches: false }),
    navigator: { userAgent: 'Desktop', maxTouchPoints: 0 },
  } as any;

  const activeSets: unknown[] = [];
  const branchSets: unknown[] = [];
  const ok = await popOutChat({
    hasWindow: true,
    isWebAppMode: false,
    currentChatJid: 'web:root',
    currentRootChatJid: 'web:root',
    forkChatBranch: async () => ({ branch: { chat_jid: 'web:new' } }),
    getActiveChatAgents: async () => {
      throw new Error('active refresh raced');
    },
    getChatBranches: async () => {
      throw new Error('branch refresh raced');
    },
    setActiveChatAgents: (rows: unknown) => activeSets.push(rows),
    setCurrentChatBranches: (rows: unknown) => branchSets.push(rows),
    showIntentToast: () => undefined,
    baseHref: 'https://example.test/?chat_jid=web%3Aroot',
  });

  expect(ok).toBe(true);
  expect(activeSets).toEqual([]);
  expect(branchSets).toEqual([]);
  expect(openedWindow.lastUrl).toContain('chat_jid=web%3Anew');
});
