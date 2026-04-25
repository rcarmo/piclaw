import { expect, test } from 'bun:test';

import {
  WORKSPACE_QUICK_ACTIONS_CATALOG,
  buildTimelineQuickActionItems,
  normalizeTimelineQuickActionsSettingsData,
} from '../../web/src/ui/timeline-quick-actions.js';

test('normalizeTimelineQuickActionsSettingsData dedupes configured ids and command names', () => {
  expect(normalizeTimelineQuickActionsSettingsData({
    workspaceCommands: ['open-settings', 'open-settings', 'toggle-workspace'],
    slashCommands: ['/model', '/model', '/settings'],
  })).toEqual({
    workspaceCommands: ['open-settings', 'toggle-workspace'],
    slashCommands: ['/model', '/settings'],
  });
});

test('buildTimelineQuickActionItems keeps pinned ordering agents then workspace then slash commands', () => {
  const items = buildTimelineQuickActionItems({
    agents: [
      { chat_jid: 'web:alpha', agent_name: 'alpha', session_name: 'Alpha session', is_active: true },
    ],
    workspaceCommands: [
      WORKSPACE_QUICK_ACTIONS_CATALOG.find((entry) => entry.id === 'open-settings')!,
    ],
    slashCommands: [
      { name: '/model', description: 'Select model' },
    ],
    settings: { workspaceCommands: ['open-settings'], slashCommands: ['/model'] },
    query: '',
  });

  expect(items.map((item) => item.kind)).toEqual(['agent', 'workspace', 'slash']);
  expect(items[0]?.title).toBe('@alpha');
  expect(items[1]?.commandId).toBe('open-settings');
  expect(items[2]?.commandName).toBe('/model');
});

test('buildTimelineQuickActionItems filters slash commands by name and description', () => {
  const items = buildTimelineQuickActionItems({
    agents: [],
    workspaceCommands: [],
    slashCommands: [
      { name: '/model', description: 'Select model or list available models' },
      { name: '/settings', description: 'Open the settings pane' },
    ],
    settings: { workspaceCommands: null, slashCommands: ['/model', '/settings'] },
    query: 'available models',
  });

  expect(items).toHaveLength(1);
  expect(items[0]?.commandName).toBe('/model');
});

test('buildTimelineQuickActionItems excludes archived agents and disabled commands', () => {
  const items = buildTimelineQuickActionItems({
    agents: [
      { chat_jid: 'web:archived', agent_name: 'archived', archived_at: '2026-01-01T00:00:00Z' },
      { chat_jid: 'web:active', agent_name: 'active' },
    ],
    workspaceCommands: WORKSPACE_QUICK_ACTIONS_CATALOG.filter((entry) => entry.id === 'open-settings' || entry.id === 'toggle-workspace'),
    slashCommands: [
      { name: '/model', description: 'Select model' },
      { name: '/settings', description: 'Open settings' },
    ],
    settings: { workspaceCommands: ['toggle-workspace'], slashCommands: ['/settings'] },
    query: '',
  });

  expect(items.map((item) => item.key)).toEqual([
    'agent:web:active',
    'workspace:toggle-workspace',
    'slash:/settings',
  ]);
});
