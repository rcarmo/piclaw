import { expect, test } from 'bun:test';

import {
  hydrateThreadStateAfterTimelineLoad,
  resetExtensionPanelStateForChat,
} from '../../web/src/ui/app-view-refresh-lifecycle.js';

test('resetExtensionPanelStateForChat clears extension panels and pending action keys', () => {
  let panels = new Map<string, unknown>([['autoresearch', { status: 'running' }]]);
  let pending = new Set<string>(['autoresearch:stop']);

  resetExtensionPanelStateForChat({
    setExtensionStatusPanels: (next) => {
      panels = typeof next === 'function' ? next(panels) : next;
      return panels;
    },
    setPendingExtensionPanelActions: (next) => {
      pending = typeof next === 'function' ? next(pending) : next;
      return pending;
    },
  });

  expect(panels.size).toBe(0);
  expect(pending.size).toBe(0);
});

test('hydrateThreadStateAfterTimelineLoad refreshes thread state after timeline success or failure', async () => {
  const calls: string[] = [];

  hydrateThreadStateAfterTimelineLoad({
    refreshPostPaintThreadState: () => {
      calls.push('post-paint');
    },
    refreshAgentStatus: async () => {
      calls.push('agent-status');
      return null;
    },
  });

  await Promise.resolve();
  expect(calls).toEqual(['post-paint', 'agent-status']);
});
