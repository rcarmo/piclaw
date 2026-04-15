import { expect, test } from 'bun:test';

import {
  createBranchLoaderState,
  resolveCurrentBranchRecord,
  resolveStableRootChatJid,
} from '../../web/src/ui/app-main-surface-state.js';

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
