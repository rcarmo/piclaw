import { expect, test } from 'bun:test';

import {
  buildSessionPickerSearchDocument,
  canUseComposeSessionSwitcher,
  filterSessionPickerChats,
  formatSessionPickerMetrics,
  groupSessionPickerChats,
  matchesSessionPickerSearch,
  moveSessionPickerIndex,
  resolveSessionPickerSearchInitialIndex,
  shouldOpenSessionSwitcherFromBlankCompose,
  shouldRouteComposeValueToSessionSwitcher,
} from '../../web/src/ui/compose-session-switcher.js';

const chats = [
  { chat_jid: 'web:root', root_chat_jid: 'web:root', branch_id: 'root', agent_name: 'ops', model: 'openai/gpt-5', is_active: false },
  { chat_jid: 'web:root:branch:a', root_chat_jid: 'web:root', branch_id: 'a', parent_branch_id: 'root', agent_name: 'worker', model: 'local/qwen', is_active: true },
  { chat_jid: 'web:root:branch:b', root_chat_jid: 'web:root', branch_id: 'b', parent_branch_id: 'a', agent_name: 'worker', model: 'local/llama', is_active: false },
  { chat_jid: 'web:other', root_chat_jid: 'web:other', branch_id: 'other', agent_name: 'other', model: 'anthropic/claude', is_active: false },
  { chat_jid: 'web:archived', root_chat_jid: 'web:archived', branch_id: 'archived', agent_name: 'old', model: 'local/qwen', is_active: true, archived_at: '2026-08-30T00:00:00Z' },
];

test('session picker search covers handle, JID, lifecycle state, and model while preserving ancestors', () => {
  expect(buildSessionPickerSearchDocument(chats[1])).toContain('@worker');
  const filtered = filterSessionPickerChats(chats, 'local llama');
  expect(filtered.map(chat => chat.chat_jid)).toEqual(['web:root', 'web:root:branch:a', 'web:root:branch:b']);
  expect(matchesSessionPickerSearch(filtered[0], 'local llama')).toBe(false);
  expect(resolveSessionPickerSearchInitialIndex(filtered, 'local llama')).toBe(2);
  expect(filterSessionPickerChats(chats, 'web:other').map(chat => chat.chat_jid)).toEqual(['web:other']);
  expect(filterSessionPickerChats(chats, 'archived').map(chat => chat.chat_jid)).toEqual(['web:archived']);
  expect(filterSessionPickerChats(chats, 'worker')).toHaveLength(3);
});

test('session picker formats model and bounded context metrics without inventing missing values', () => {
  expect(formatSessionPickerMetrics({
    model: 'openai/gpt-5',
    context_tokens: 42_000,
    context_window: 128_000,
    context_percent: 32.8125,
  })).toBe('openai/gpt-5 · 42K / 128K (33% context)');
  expect(formatSessionPickerMetrics({ model: 'local/qwen' })).toBe('local/qwen');
  expect(formatSessionPickerMetrics({ context_percent: 140 })).toBe('100% context');
  expect(formatSessionPickerMetrics({ context_tokens: -1, context_window: 0 })).toBe('');
});

test('session picker grouping uses current-pinned-active-tree-other-archived precedence', () => {
  const sections = groupSessionPickerChats(chats, 'web:root', ['web:root', 'web:root:branch:a', 'web:other', 'web:archived']);
  expect(sections.map(section => section.key)).toEqual(['current', 'pinned', 'tree', 'archived']);
  expect(sections.find(section => section.key === 'current')?.items.map(chat => chat.chat_jid)).toEqual(['web:root']);
  expect(sections.find(section => section.key === 'pinned')?.items.map(chat => chat.chat_jid)).toEqual(['web:root:branch:a', 'web:other']);
  expect(sections.find(section => section.key === 'archived')?.items[0].chat_jid).toBe('web:archived');
  const orderedChatJids = sections.flatMap(section => section.items).map(chat => chat.chat_jid);
  expect(orderedChatJids).toEqual([
    'web:root',
    'web:root:branch:a',
    'web:other',
    'web:root:branch:b',
    'web:archived',
  ]);
  expect(new Set(orderedChatJids).size).toBe(chats.length);
});

test('session picker navigation supports arrows, home/end, and paging', () => {
  expect(moveSessionPickerIndex(0, 20, 'ArrowDown')).toBe(1);
  expect(moveSessionPickerIndex(0, 20, 'ArrowUp')).toBe(19);
  expect(moveSessionPickerIndex(8, 20, 'Home')).toBe(0);
  expect(moveSessionPickerIndex(8, 20, 'End')).toBe(19);
  expect(moveSessionPickerIndex(8, 20, 'PageDown')).toBe(16);
  expect(moveSessionPickerIndex(8, 20, 'PageUp')).toBe(0);
});

test('opens the session switcher when @ is typed into a blank compose box', () => {
  expect(shouldOpenSessionSwitcherFromBlankCompose({ key: '@' } as any, '', {
    searchMode: false,
    showSessionSwitcherButton: true,
  })).toBe(true);
});

test('does not open the session switcher when compose already has content', () => {
  expect(shouldOpenSessionSwitcherFromBlankCompose({ key: '@' } as any, 'hello', {
    searchMode: false,
    showSessionSwitcherButton: true,
  })).toBe(false);
});

test('does not open the session switcher when searching or when no switcher is available', () => {
  expect(shouldOpenSessionSwitcherFromBlankCompose({ key: '@' } as any, '', {
    searchMode: true,
    showSessionSwitcherButton: true,
  })).toBe(false);
  expect(shouldOpenSessionSwitcherFromBlankCompose({ key: '@' } as any, '', {
    searchMode: false,
    showSessionSwitcherButton: false,
  })).toBe(false);
});

test('ignores modified keystrokes and non-@ characters', () => {
  expect(shouldOpenSessionSwitcherFromBlankCompose({ key: '@', ctrlKey: true } as any, '', {
    searchMode: false,
    showSessionSwitcherButton: true,
  })).toBe(false);
  expect(shouldOpenSessionSwitcherFromBlankCompose({ key: 'a' } as any, '', {
    searchMode: false,
    showSessionSwitcherButton: true,
  })).toBe(false);
});

test('routes a bare @ compose value to the session switcher popup', () => {
  expect(shouldRouteComposeValueToSessionSwitcher('@', {
    searchMode: false,
    showSessionSwitcherButton: true,
  })).toBe(true);
  expect(shouldRouteComposeValueToSessionSwitcher('@agent', {
    searchMode: false,
    showSessionSwitcherButton: true,
  })).toBe(false);
  expect(shouldRouteComposeValueToSessionSwitcher('@', {
    searchMode: true,
    showSessionSwitcherButton: true,
  })).toBe(false);
});

test('session switcher is only available when not searching and when the button is shown', () => {
  expect(canUseComposeSessionSwitcher({ searchMode: false, showSessionSwitcherButton: true })).toBe(true);
  expect(canUseComposeSessionSwitcher({ searchMode: true, showSessionSwitcherButton: true })).toBe(false);
  expect(canUseComposeSessionSwitcher({ searchMode: false, showSessionSwitcherButton: false })).toBe(false);
});
