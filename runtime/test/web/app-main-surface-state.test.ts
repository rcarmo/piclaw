import { expect, test } from 'bun:test';

import {
  createBranchLoaderState,
  getInitialWorkspaceOpen,
  resolveCurrentBranchRecord,
  resolveStableRootChatJid,
} from '../../web/src/ui/app-main-surface-state.js';

function createWorkspaceRuntime(matchesDesktop: boolean, storage: Record<string, string> = {}) {
  const values = new Map(Object.entries(storage));
  return {
    matchMedia: () => ({ matches: matchesDesktop }),
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
    },
  } as any;
}

test('fresh desktop load restores workspaceOpen.desktop=true', () => {
  expect(getInitialWorkspaceOpen(createWorkspaceRuntime(true, {
    'workspaceOpen.desktop': 'true',
  }))).toBe(true);
});

test('fresh desktop load stays closed for false, missing, or malformed values', () => {
  expect(getInitialWorkspaceOpen(createWorkspaceRuntime(true, {
    'workspaceOpen.desktop': 'false',
  }))).toBe(false);
  expect(getInitialWorkspaceOpen(createWorkspaceRuntime(true))).toBe(false);
  expect(getInitialWorkspaceOpen(createWorkspaceRuntime(true, {
    'workspaceOpen.desktop': 'sometimes',
  }))).toBe(false);
});

test('fresh narrow load ignores the desktop preference', () => {
  expect(getInitialWorkspaceOpen(createWorkspaceRuntime(false, {
    'workspaceOpen.desktop': 'true',
  }))).toBe(false);
});

test('fresh narrow load ignores the legacy shared preference', () => {
  expect(getInitialWorkspaceOpen(createWorkspaceRuntime(false, {
    workspaceOpen: 'true',
  }))).toBe(false);
});

test('fresh narrow load ignores the stale narrow preference', () => {
  expect(getInitialWorkspaceOpen(createWorkspaceRuntime(false, {
    'workspaceOpen.narrow': 'true',
  }))).toBe(false);
});

test('createBranchLoaderState reflects branch-loader mode', () => {
  expect(createBranchLoaderState(false)).toEqual({ status: 'idle', message: '' });
  expect(createBranchLoaderState(true)).toEqual({ status: 'running', message: 'Preparing a new chat branch…' });
});

test('resolveCurrentBranchRecord prefers current root branch rows before active chat rows', () => {
  const currentBranch = { chat_jid: 'web:default:branch:abc', root_chat_jid: 'web:default', source: 'branches' };
  const activeBranch = { chat_jid: 'web:default:branch:abc', root_chat_jid: 'wrong-root', source: 'active' };

  expect(resolveCurrentBranchRecord({
    currentChatJid: 'web:default:branch:abc',
    currentChatBranches: [currentBranch],
    activeChatAgents: [activeBranch],
  })).toEqual(currentBranch);
});

test('resolveStableRootChatJid uses branch metadata when available', () => {
  expect(resolveStableRootChatJid('web:default:branch:abc', { root_chat_jid: 'web:default' })).toBe('web:default');
});

test('resolveStableRootChatJid derives the root chat from nested branch ids before metadata arrives', () => {
  expect(resolveStableRootChatJid('web:default:branch:abc')).toBe('web:default');
  expect(resolveStableRootChatJid('web:default:branch:abc:branch:def')).toBe('web:default');
});

test('resolveStableRootChatJid leaves root chats unchanged and falls back sanely for blanks', () => {
  expect(resolveStableRootChatJid('web:default')).toBe('web:default');
  expect(resolveStableRootChatJid('')).toBe('web:default');
});
