import { expect, test } from 'bun:test';

import {
  buildPanePopoutReattachRequestMessage,
  canRecoverDetachedPaneInForeground,
  consumePanePopoutReattachRequestMessage,
  invokePaneAfterAttachToHost,
  isLikelySafariBrowser,
  isWorkspaceUpdateRelevantForPath,
  removeSourcePaneAfterDetachClaim,
  shouldDelayPaneReattachAfterWindowClose,
  shouldDisableTerminalReattach,
  shouldRequireManualTerminalCloseRecovery,
  shouldRetainPaneDetachState,
} from '../../web/src/ui/app-pane-runtime-orchestration.js';

function createStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    size: () => map.size,
  };
}

test('buildPanePopoutReattachRequestMessage stores editor state for reattach recovery', () => {
  const localStorage = createStorage();
  const runtime = { localStorage } as any;

  const payload = buildPanePopoutReattachRequestMessage({
    panePath: '/workspace/notes.md',
    paneInstanceId: 'pane-inst-1',
    paneOverrideId: 'editor',
    terminalTabPath: 'piclaw://terminal',
    viewState: { cursorLine: 3, cursorCol: 5, scrollTop: 42 },
    instance: {
      getContent: () => '# Draft',
      isDirty: () => true,
      exportHostTransferState: () => ({
        kind: 'editor',
        path: '/workspace/notes.md',
        content: '# Draft',
        initialContent: '# Saved',
        mtime: '2026-04-02T12:00:00.000Z',
        dirty: true,
        viewState: { cursorLine: 3, cursorCol: 5, scrollTop: 42 },
      }),
    },
    runtime,
    nowMs: 1_000,
  });

  expect(payload).toEqual({
    type: 'piclaw-pane-reattach-request',
    panePath: '/workspace/notes.md',
    paneInstanceId: 'pane-inst-1',
    editorPopoutToken: expect.any(String),
    paneTransferToken: expect.any(String),
  });

  const restored = consumePanePopoutReattachRequestMessage({ payload, runtime, nowMs: 1_500 });
  expect(restored).toEqual({
    panePath: '/workspace/notes.md',
    paneInstanceId: 'pane-inst-1',
    allowLiveTransfer: true,
    editorTransfer: {
      path: '/workspace/notes.md',
      content: '# Draft',
      mtime: '2026-04-02T12:00:00.000Z',
      paneOverrideId: 'editor',
      viewState: { cursorLine: 3, cursorCol: 5, scrollTop: 42 },
      capturedAt: 1_000,
    },
    hostTransfer: {
      path: '/workspace/notes.md',
      payload: {
        kind: 'editor',
        path: '/workspace/notes.md',
        content: '# Draft',
        initialContent: '# Saved',
        mtime: '2026-04-02T12:00:00.000Z',
        dirty: true,
        viewState: { cursorLine: 3, cursorCol: 5, scrollTop: 42 },
      },
      capturedAt: 1_000,
    },
  });
  expect(localStorage.size()).toBe(0);
});

test('consumePanePopoutReattachRequestMessage ignores mismatched transfer payloads', () => {
  const localStorage = createStorage();
  localStorage.setItem('piclaw:editor-popout:tok-1', JSON.stringify({
    path: '/workspace/other.md',
    content: '# Wrong file',
    capturedAt: 1_000,
  }));
  localStorage.setItem('piclaw:pane-host-transfer:tok-2', JSON.stringify({
    path: '/workspace/other.md',
    payload: { kind: 'editor', content: '# Wrong file' },
    capturedAt: 1_000,
  }));
  const runtime = { localStorage } as any;

  expect(consumePanePopoutReattachRequestMessage({
    payload: {
      panePath: '/workspace/notes.md',
      editorPopoutToken: 'tok-1',
      paneTransferToken: 'tok-2',
    },
    runtime,
    nowMs: 1_500,
  })).toEqual({
    panePath: '/workspace/notes.md',
    paneInstanceId: null,
    allowLiveTransfer: true,
    editorTransfer: null,
    hostTransfer: null,
  });
});

test('buildPanePopoutReattachRequestMessage can disable live transfer for close-window recovery', () => {
  const localStorage = createStorage();
  const runtime = { localStorage } as any;

  const payload = buildPanePopoutReattachRequestMessage({
    panePath: 'piclaw://terminal',
    paneInstanceId: 'pane-inst-1',
    terminalTabPath: 'piclaw://terminal',
    allowLiveTransfer: false,
    instance: {
      exportHostTransferState: () => ({
        kind: 'terminal',
        live: true,
        handoffToken: 'handoff-1',
      }),
    },
    runtime,
    nowMs: 1_000,
  });

  expect(payload).toEqual({
    type: 'piclaw-pane-reattach-request',
    panePath: 'piclaw://terminal',
    paneInstanceId: 'pane-inst-1',
    paneTransferPayload: {
      kind: 'terminal',
      live: true,
      handoffToken: 'handoff-1',
    },
    allowLiveTransfer: false,
  });

  expect(consumePanePopoutReattachRequestMessage({ payload, runtime, nowMs: 1_500 })).toEqual({
    panePath: 'piclaw://terminal',
    paneInstanceId: 'pane-inst-1',
    editorTransfer: null,
    hostTransfer: {
      path: 'piclaw://terminal',
      panePath: 'piclaw://terminal',
      payload: {
        kind: 'terminal',
        live: true,
        handoffToken: 'handoff-1',
      },
      capturedAt: 1_500,
    },
    allowLiveTransfer: false,
  });
});

test('canRecoverDetachedPaneInForeground only allows visible documents', () => {
  expect(canRecoverDetachedPaneInForeground(null)).toBe(true);
  expect(canRecoverDetachedPaneInForeground({ visibilityState: 'visible' } as any)).toBe(true);
  expect(canRecoverDetachedPaneInForeground({ visibilityState: 'hidden' } as any)).toBe(false);
});

test('isLikelySafariBrowser detects Safari-family browsers conservatively', () => {
  expect(isLikelySafariBrowser({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    vendor: 'Apple Computer, Inc.',
  } as any)).toBe(true);
  expect(isLikelySafariBrowser({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    vendor: 'Google Inc.',
  } as any)).toBe(false);
});

test('shouldDelayPaneReattachAfterWindowClose only defers terminal close recovery paths', () => {
  expect(shouldDelayPaneReattachAfterWindowClose({
    panePath: 'piclaw://terminal',
    terminalTabPath: 'piclaw://terminal',
    allowLiveTransfer: false,
    reason: 'message',
  })).toBe(true);
  expect(shouldDelayPaneReattachAfterWindowClose({
    panePath: 'piclaw://terminal',
    terminalTabPath: 'piclaw://terminal',
    allowLiveTransfer: true,
    reason: 'message',
  })).toBe(false);
  expect(shouldDelayPaneReattachAfterWindowClose({
    panePath: 'piclaw://terminal',
    terminalTabPath: 'piclaw://terminal',
    allowLiveTransfer: true,
    reason: 'closed-window',
  })).toBe(true);
  expect(shouldDelayPaneReattachAfterWindowClose({
    panePath: '/workspace/notes.md',
    terminalTabPath: 'piclaw://terminal',
    allowLiveTransfer: false,
    reason: 'closed-window',
  })).toBe(false);
});

test('shouldDisableTerminalReattach only applies to Safari terminal panes', () => {
  expect(shouldDisableTerminalReattach({
    panePath: 'piclaw://terminal',
    terminalTabPath: 'piclaw://terminal',
    runtimeNavigator: {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      vendor: 'Apple Computer, Inc.',
    } as any,
  })).toBe(true);
  expect(shouldDisableTerminalReattach({
    panePath: '/workspace/notes.md',
    terminalTabPath: 'piclaw://terminal',
    runtimeNavigator: {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      vendor: 'Apple Computer, Inc.',
    } as any,
  })).toBe(false);
});

test('shouldRequireManualTerminalCloseRecovery only applies to Safari terminal close recovery', () => {
  expect(shouldRequireManualTerminalCloseRecovery({
    panePath: 'piclaw://terminal',
    terminalTabPath: 'piclaw://terminal',
    allowLiveTransfer: false,
    reason: 'closed-window',
    runtimeNavigator: {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      vendor: 'Apple Computer, Inc.',
    } as any,
  })).toBe(true);
  expect(shouldRequireManualTerminalCloseRecovery({
    panePath: 'piclaw://terminal',
    terminalTabPath: 'piclaw://terminal',
    allowLiveTransfer: false,
    reason: 'closed-window',
    runtimeNavigator: {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      vendor: 'Google Inc.',
    } as any,
  })).toBe(false);
});

test('invokePaneAfterAttachToHost calls the pane attach lifecycle hook when present', async () => {
  const calls: Array<{ path?: string; hostMode: 'main' | 'popout'; transferState?: Record<string, unknown> | null }> = [];
  await invokePaneAfterAttachToHost({
    afterAttachToHost: async (context) => {
      calls.push(context);
    },
  }, {
    path: '/workspace/notes.md',
    hostMode: 'popout',
    transferState: { kind: 'editor', dirty: true },
  });

  expect(calls).toEqual([
    {
      path: '/workspace/notes.md',
      hostMode: 'popout',
      transferState: { kind: 'editor', dirty: true },
    },
  ]);
});

test('isWorkspaceUpdateRelevantForPath treats empty update list as relevant', () => {
  expect(isWorkspaceUpdateRelevantForPath('notes/todo.md', [])).toBe(true);
  expect(isWorkspaceUpdateRelevantForPath('notes/todo.md', null)).toBe(true);
});

test('isWorkspaceUpdateRelevantForPath matches direct and wildcard paths', () => {
  expect(isWorkspaceUpdateRelevantForPath('notes/todo.md', [{ changed_paths: ['notes/todo.md'] }])).toBe(true);
  expect(isWorkspaceUpdateRelevantForPath('notes/todo.md', [{ changed_paths: ['.'] }])).toBe(true);
  expect(isWorkspaceUpdateRelevantForPath('notes/todo.md', [{ path: '.' }])).toBe(true);
});

test('isWorkspaceUpdateRelevantForPath ignores unrelated updates', () => {
  expect(isWorkspaceUpdateRelevantForPath('notes/todo.md', [{ changed_paths: ['notes/other.md'] }])).toBe(false);
  expect(isWorkspaceUpdateRelevantForPath('notes/todo.md', [{ path: 'notes/other.md' }])).toBe(false);
});

test('shouldRetainPaneDetachState keeps detached ownership even after the source tab is removed', () => {
  expect(shouldRetainPaneDetachState({
    panePath: '/workspace/foo.widget',
    openTabIds: new Set<string>(),
    pendingDetachedTabPaths: new Set<string>(),
    detachedTabPaths: new Set<string>(['/workspace/foo.widget']),
    terminalTabPath: 'piclaw://terminal',
    hasPendingDetachedDockPane: false,
    hasDetachedDockPane: false,
  })).toBe(true);

  expect(shouldRetainPaneDetachState({
    panePath: '/workspace/other.md',
    openTabIds: new Set<string>(),
    pendingDetachedTabPaths: new Set<string>(),
    detachedTabPaths: new Set<string>(),
    terminalTabPath: 'piclaw://terminal',
    hasPendingDetachedDockPane: false,
    hasDetachedDockPane: false,
  })).toBe(false);
});

test('removeSourcePaneAfterDetachClaim closes terminal tabs but hides detached dock panes', () => {
  const closed: string[] = [];
  const dockStates: boolean[] = [];

  removeSourcePaneAfterDetachClaim({
    panePath: '/workspace/foo.widget',
    terminalTabPath: 'piclaw://terminal',
    closeTab: (panePath: string) => closed.push(panePath),
    setDockVisible: (visible: boolean) => dockStates.push(visible),
  });
  removeSourcePaneAfterDetachClaim({
    panePath: 'piclaw://terminal',
    terminalTabPath: 'piclaw://terminal',
    closeTab: (panePath: string) => closed.push(panePath),
    setDockVisible: (visible: boolean) => dockStates.push(visible),
    sourceHost: 'tab',
  });
  removeSourcePaneAfterDetachClaim({
    panePath: 'piclaw://terminal',
    terminalTabPath: 'piclaw://terminal',
    closeTab: (panePath: string) => closed.push(panePath),
    setDockVisible: (visible: boolean) => dockStates.push(visible),
    sourceHost: 'dock',
  });

  expect(closed).toEqual(['/workspace/foo.widget', 'piclaw://terminal']);
  expect(dockStates).toEqual([false]);
});
