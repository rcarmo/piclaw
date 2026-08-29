import { expect, test } from 'bun:test';

import { resolveAgentStatusContent, resolveIntentElapsedLabel, resolveStatusActivityAgeLabel, shouldTickIntentElapsed, shouldTickStatusActivityAge } from '../../web/src/components/status.ts';

test('resolveAgentStatusContent preserves the last visible tool activity label without inlining age text', () => {
  expect(resolveAgentStatusContent({ type: 'tool_call', title: 'bash', last_activity: true, last_event_at: '2026-04-22T06:00:00.000Z' })).toBe('Recent activity: Running: bash');
  expect(resolveAgentStatusContent({ type: 'tool_status', title: 'bash', status: 'Working...', last_activity: true, last_event_at: '2026-04-22T06:00:00.000Z' })).toBe('Recent activity: bash: Working...');
  expect(resolveAgentStatusContent({ type: 'tool_status', title: 'bash', status: 'Streaming output...', last_activity: true, last_event_at: '2026-04-22T06:00:00.000Z' })).toBe('Recent activity: bash');
});

test('resolveAgentStatusContent omits redundant streaming-output suffixes when output is already shown below', () => {
  expect(resolveAgentStatusContent({ type: 'tool_status', title: 'bash', status: 'Streaming output...' })).toBe('bash');
  expect(resolveAgentStatusContent({ type: 'tool_status', title: 'read: /workspace/file.txt', status: 'Streaming output...' })).toBe('read: /workspace/file.txt');
});

test('resolveAgentStatusContent reports concurrent active tools without hiding the primary tool', () => {
  expect(resolveAgentStatusContent({ type: 'tool_call', title: 'bash', active_tool_count: 3 })).toBe('Running: bash · 3 tools active');
  expect(resolveAgentStatusContent({ type: 'tool_status', title: 'read', status: 'Working...', active_tool_count: 2 })).toBe('read: Working... · 2 tools active');
});

test('resolveAgentStatusContent remains auditable when tool status title is missing', () => {
  expect(resolveAgentStatusContent({ type: 'tool_call', tool_name: 'bash', tool_args: { command: 'echo hi' } })).toBe('Running: bash: echo hi');
  expect(resolveAgentStatusContent({ type: 'tool_call', tool_name: 'mcp', tool_args: { server: 'memento', tool: 'memory_search' } })).toBe('Running: mcp: memento → memory_search');
  expect(resolveAgentStatusContent({ type: 'tool_status', title: 'mcp: memento → memory_search', status: 'Working...', tool_name: 'mcp', tool_args: { server: 'memento', tool: 'memory_search' } })).toBe('mcp: memento → memory_search: Working...');
  expect(resolveAgentStatusContent({ type: 'tool_status', status: 'Working...', tool_name: 'read', tool_args: { path: '/workspace/AGENTS.md' } })).toBe('read: /workspace/AGENTS.md: Working...');
  expect(resolveAgentStatusContent({ type: 'tool_status', status: 'Streaming output...', tool_name: 'portainer' })).toBe('portainer');
});

test('resolveStatusActivityAgeLabel formats the activity age for recent activity and tool output meta rows after the clutter threshold', () => {
  expect(resolveStatusActivityAgeLabel({ type: 'tool_call', last_event_at: '2026-04-22T06:00:00.000Z' }, Date.parse('2026-04-22T06:00:05.000Z'))).toBeNull();
  expect(resolveStatusActivityAgeLabel({ type: 'tool_call', last_event_at: '2026-04-22T06:00:00.000Z' }, Date.parse('2026-04-22T06:00:10.000Z'))).toBe('10s ago');
  expect(resolveStatusActivityAgeLabel({ type: 'tool_status', last_event_at: '2026-04-22T06:00:00.000Z' }, Date.parse('2026-04-22T06:02:03.000Z'))).toBe('2m 3s ago');
  expect(resolveStatusActivityAgeLabel({ type: 'tool_status', last_event_at: '2026-04-22T06:00:00.000Z' }, Date.parse('2026-04-22T08:03:04.000Z'))).toBe('2h 3m ago');
  expect(resolveStatusActivityAgeLabel({ last_activity: true, last_event_at: '2026-04-22T06:00:00.000Z' }, Date.parse('2026-04-22T06:00:09.000Z'))).toBeNull();
  expect(resolveStatusActivityAgeLabel({ last_activity: true, last_event_at: '2026-04-22T06:00:00.000Z' }, Date.parse('2026-04-22T06:00:10.000Z'))).toBe('10s ago');
});

test('shouldTickStatusActivityAge opts live tool statuses into clock updates', () => {
  expect(shouldTickStatusActivityAge({ type: 'tool_call', last_event_at: '2026-04-22T06:00:00.000Z' })).toBe(true);
  expect(shouldTickStatusActivityAge({ type: 'tool_status', started_at: '2026-04-22T06:00:00.000Z' })).toBe(true);
  expect(shouldTickStatusActivityAge({ last_activity: true, last_event_at: '2026-04-22T06:00:00.000Z' })).toBe(true);
  expect(shouldTickStatusActivityAge({ type: 'tool_status' })).toBe(false);
  expect(shouldTickStatusActivityAge({ type: 'intent', last_event_at: '2026-04-22T06:00:00.000Z' })).toBe(false);
});

test('intent elapsed labels tick for all intents and appear immediately', () => {
  expect(shouldTickIntentElapsed({ type: 'intent', started_at: '2026-04-22T06:00:00.000Z' })).toBe(true);
  expect(shouldTickIntentElapsed({ type: 'tool_status', started_at: '2026-04-22T06:00:00.000Z' })).toBe(false);
  expect(resolveIntentElapsedLabel({ type: 'intent', started_at: '2026-04-22T06:00:00.000Z' }, Date.parse('2026-04-22T06:00:09.000Z'))).toBe('0:09');
  expect(resolveIntentElapsedLabel({ type: 'intent', started_at: '2026-04-22T06:00:00.000Z' }, Date.parse('2026-04-22T06:00:10.000Z'))).toBe('0:10');
  expect(resolveIntentElapsedLabel({ type: 'intent', started_at: '2026-04-22T06:00:00.000Z' }, Date.parse('2026-04-22T06:02:03.000Z'))).toBe('2:03');
  expect(resolveIntentElapsedLabel({ type: 'intent', started_at: '2026-04-22T06:00:00.000Z' }, Date.parse('2026-04-22T08:03:04.000Z'))).toBe('2:03:04');
});

test('resolveAgentStatusContent falls back to generic last-activity copy when no prior status is available', () => {
  expect(resolveAgentStatusContent({ type: 'active', last_activity: true, last_event_at: '2026-04-22T06:00:00.000Z' })).toBe('Last activity');
  expect(resolveStatusActivityAgeLabel({}, Date.parse('2026-04-22T06:00:09.000Z'))).toBeNull();
  expect(resolveStatusActivityAgeLabel({ type: 'intent', last_event_at: '2026-04-22T06:00:00.000Z' }, Date.parse('2026-04-22T06:00:09.000Z'))).toBeNull();
  expect(resolveIntentElapsedLabel({ type: 'tool_status', started_at: '2026-04-22T06:00:00.000Z' }, Date.parse('2026-04-22T06:00:10.000Z'))).toBeNull();
});
