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
