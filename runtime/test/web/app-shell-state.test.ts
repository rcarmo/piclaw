import { expect, test } from 'bun:test';

import {
  BTW_SESSION_KEY,
  describeSearchScope,
  getCurrentAppAssetVersion,
  getRenameBranchFormLock,
  loadStoredBtwSession,
  readAppLocationModes,
} from '../../web/src/ui/app-shell-state.js';

function createScript(src: string) {
  return {
    getAttribute(name: string) {
      return name === 'src' ? src : null;
    },
  };
}

test('getCurrentAppAssetVersion prefers import.meta query and falls back to script src', () => {
  expect(getCurrentAppAssetVersion({ importMetaUrl: 'https://example.test/app.bundle.js?v=abc123' })).toBe('abc123');

  const version = getCurrentAppAssetVersion({
    importMetaUrl: 'https://example.test/app.bundle.js',
    origin: 'https://example.test',
    document: {
      querySelectorAll: () => [
        createScript('/static/classic/dist/other.bundle.js?v=skip'),
        createScript('/static/classic/dist/app.bundle.js?v=fallback456'),
      ],
    },
  });
  expect(version).toBe('fallback456');
  expect(getCurrentAppAssetVersion({
    importMetaUrl: 'not a valid url',
    origin: 'https://example.test',
    document: {
      querySelectorAll: () => [createScript('/static/classic/dist/app.bundle.js?v=malformed789')],
    },
  })).toBe('malformed789');
  expect(getCurrentAppAssetVersion({ importMetaUrl: null, document: { querySelectorAll: () => [] } })).toBeNull();
});

test('getRenameBranchFormLock shares the same lock object per window', () => {
  const win: Record<string, unknown> = {};
  const first = getRenameBranchFormLock({ window: win as any });
  const second = getRenameBranchFormLock({ window: win as any });

  expect(first).toBe(second);
  expect(first).toEqual({ inFlight: false, cooldownUntil: 0 });
  expect(getRenameBranchFormLock({ window: null })).toBeNull();
});

test('describeSearchScope returns stable labels', () => {
  expect(describeSearchScope('root')).toBe('Branch family');
  expect(describeSearchScope('all')).toBe('All chats');
  expect(describeSearchScope('current')).toBe('Current branch');
});

test('loadStoredBtwSession normalizes interrupted and malformed sessions', () => {
  const success = loadStoredBtwSession({
    readItem: (key) => {
      expect(key).toBe(BTW_SESSION_KEY);
      return JSON.stringify({ question: 'Q', answer: 'A', thinking: 'T', status: 'success' });
    },
  });
  expect(success).toEqual({
    question: 'Q',
    answer: 'A',
    thinking: 'T',
    error: null,
    model: null,
    status: 'success',
  });

  const interrupted = loadStoredBtwSession({
    readItem: () => JSON.stringify({ question: 'Q', status: 'running' }),
  });
  expect(interrupted?.status).toBe('error');
  expect(interrupted?.error).toBe('BTW stream interrupted. You can retry.');

  expect(loadStoredBtwSession({ readItem: () => 'not json' })).toBeNull();
  expect(loadStoredBtwSession({ readItem: () => null })).toBeNull();
});

test('readAppLocationModes parses the current shell mode flags from URL params', () => {
  const params = new URLSearchParams({
    chat_jid: 'web:branch',
    chat_only: 'yes',
    pane_popout: 'true',
    pane_path: '/tabs/vnc',
    pane_label: 'VNC',
    branch_loader: '1',
    branch_source_chat_jid: 'web:source',
  });

  expect(readAppLocationModes(params)).toEqual({
    currentChatJid: 'web:branch',
    panePopoutMode: true,
    panePopoutPath: '/tabs/vnc',
    panePopoutLabel: 'VNC',
    branchLoaderMode: true,
    branchLoaderSourceChatJid: 'web:source',
  });

  expect(readAppLocationModes(new URLSearchParams())).toEqual({
    currentChatJid: 'web:default',
    panePopoutMode: false,
    panePopoutPath: '',
    panePopoutLabel: '',
    branchLoaderMode: false,
    branchLoaderSourceChatJid: 'web:default',
  });
});
