import { expect, test } from 'bun:test';

import {
  SESSIONS_DEFAULT_WIDTH,
  SESSIONS_MAX_WIDTH,
  SESSIONS_MIN_WIDTH,
  availableSessionsWidth,
  buildSessionsSidebarSections,
  clampSessionsWidth,
  buildArchivedSessions,
  resolveInitialWorkbenchView,
  selectSessionsPreviewTargets,
} from '../../web/src/components/workbench-sidebar.js';

const chats = [
  { chat_jid: 'web:default', agent_name: 'default', root_chat_jid: 'web:default' },
  { chat_jid: 'web:proxmox', agent_name: 'proxmox', root_chat_jid: 'web:proxmox', is_active: true },
  { chat_jid: 'web:lunch', agent_name: 'lunch', root_chat_jid: 'web:lunch' },
  { chat_jid: 'web:old', agent_name: 'old', root_chat_jid: 'web:old', archived_at: '2026-11-01T00:00:00Z' },
  { chat_jid: 'web:nameless', agent_name: '' },
];

test('sessions pane groups like the compose picker and leaves archived sessions out', () => {
  const sections = buildSessionsSidebarSections(chats, 'web:default', ['web:lunch']);
  expect(sections.map((section) => [section.key, section.items.map((chat) => chat.chat_jid)])).toEqual([
    ['current', ['web:default']],
    ['pinned', ['web:lunch']],
    ['active', ['web:proxmox']],
  ]);
});

test('sessions pane search uses the picker search document', () => {
  const sections = buildSessionsSidebarSections(chats, 'web:default', [], 'prox');
  expect(sections.flatMap((section) => section.items.map((chat) => chat.chat_jid))).toEqual(['web:proxmox']);
  expect(buildSessionsSidebarSections(chats, 'web:default', [], 'archived')).toEqual([]);
});

test('sessions pane width is clamped and shrinks before it hides', () => {
  expect(clampSessionsWidth('not a number')).toBe(SESSIONS_DEFAULT_WIDTH);
  expect(clampSessionsWidth(10)).toBe(SESSIONS_MIN_WIDTH);
  expect(clampSessionsWidth(5000)).toBe(SESSIONS_MAX_WIDTH);
  expect(clampSessionsWidth(5000, 300)).toBe(300);
  // The 48px activity bar always stays on wide screens.
  expect(availableSessionsWidth({ viewportWidth: 1440, rightPanesWidth: 568 })).toBe(500);
  expect(availableSessionsWidth({ viewportWidth: 1024, rightPanesWidth: 440 })).toBe(212);
  expect(availableSessionsWidth({ viewportWidth: 1024, rightPanesWidth: 488 }) < SESSIONS_MIN_WIDTH).toBe(true);
});

test('live previews poll other active sessions only, up to the limit', () => {
  const rows = [
    ...chats,
    { chat_jid: 'web:busy', agent_name: 'busy', is_active: true },
    { chat_jid: 'web:gone', agent_name: 'gone', is_active: true, archived_at: '2026-11-01T00:00:00Z' },
  ];
  expect(selectSessionsPreviewTargets(rows, 'web:proxmox')).toEqual(['web:busy']);
  expect(selectSessionsPreviewTargets(rows, 'web:default')).toEqual(['web:busy', 'web:proxmox']);
  expect(selectSessionsPreviewTargets(rows, 'web:default', 1)).toEqual(['web:busy']);
});

test('the Explorer view is selected when the workspace starts open', () => {
  expect(resolveInitialWorkbenchView(true)).toBe('explorer');
  expect(resolveInitialWorkbenchView(false)).toBe('sessions');
});

test('archived sessions are listed separately, newest first, and follow the search', () => {
  const rows = [
    ...chats,
    { chat_jid: 'web:older', agent_name: 'older', archived_at: '2026-10-01T00:00:00Z' },
  ];
  expect(buildArchivedSessions(rows, 'web:default').map((chat) => chat.chat_jid)).toEqual(['web:old', 'web:older']);
  expect(buildArchivedSessions(rows, 'web:default', 'older').map((chat) => chat.chat_jid)).toEqual(['web:older']);
});

import { ACTIVITY_BAR_HIDDEN_STORAGE_KEY, WORKBENCH_COMMAND_EVENT, dispatchWorkbenchCommand, readActivityBarHidden, resolveSessionRowContext } from '../../web/src/components/workbench-sidebar.js';
import { resolveLiveAgentId } from '../../web/src/components/chat-surface.js';

test('session rows size their context from the list, else from /agent/context, with a readable label', () => {
  expect(resolveSessionRowContext({ context_percent: 42, context_tokens: 42000, context_window: 100000 }, null)).toEqual({ percent: 42, label: 'Context 42% (42k / 100k tokens)' });
  expect(resolveSessionRowContext({}, { percent: 7.5, tokens: 1500, contextWindow: 20000 })).toEqual({ percent: 7.5, label: 'Context 8% (1.5k / 20k tokens)' });
  expect(resolveSessionRowContext({}, { tokens: 500, contextWindow: 1000 })?.percent).toBe(50);
  expect(resolveSessionRowContext({}, { percent: null, tokens: null, contextWindow: null })).toBeNull();
  expect(resolveSessionRowContext({}, undefined)).toBeNull();
});

test('the activity bar visibility is a stored preference and menu commands are window events', () => {
  const store = new Map<string, string>();
  const events: unknown[] = [];
  const previous = { localStorage: (globalThis as any).localStorage, window: (globalThis as any).window };
  const localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) };
  (globalThis as any).localStorage = localStorage;
  (globalThis as any).window = { localStorage, dispatchEvent: (event: any) => { events.push([event.type, event.detail]); return true; } };
  try {
    expect(readActivityBarHidden()).toBe(false);
    store.set(ACTIVITY_BAR_HIDDEN_STORAGE_KEY, 'true');
    expect(readActivityBarHidden()).toBe(true);
    dispatchWorkbenchCommand('view', { view: 'explorer' });
    dispatchWorkbenchCommand('activity-bar');
    expect(events).toEqual([[WORKBENCH_COMMAND_EVENT, { view: 'explorer', command: 'view' }], [WORKBENCH_COMMAND_EVENT, { command: 'activity-bar' }]]);
  } finally {
    (globalThis as any).localStorage = previous.localStorage;
    (globalThis as any).window = previous.window;
  }
});

test('the live turn posts as the latest answering agent, else the default agent', () => {
  expect(resolveLiveAgentId([{ data: { agent_id: 'default' } }, { data: {} }, { data: { agent_id: 'scout' } }, { data: {} }])).toBe('scout');
  expect(resolveLiveAgentId([{ data: {} }], { default: { name: 'Smith' } })).toBe('default');
  expect(resolveLiveAgentId([], {})).toBeNull();
});
