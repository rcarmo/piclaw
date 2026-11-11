import { expect, test } from 'bun:test';

import {
  cleanSessionPreviewText,
  formatSessionActivityAge,
  formatSessionActivityStatus,
  isNewTabSessionClick,
  resolveSessionContextPercent,
  resolveSessionLivePreview,
} from '../../web/src/ui/session-activity.js';

test('activity status labels active sessions and stays empty when idle', () => {
  expect(formatSessionActivityStatus({ is_active: false, activity_status: 'streaming' })).toBe('');
  expect(formatSessionActivityStatus({ is_active: true, activity_status: 'streaming' })).toBe('Streaming');
  expect(formatSessionActivityStatus({ is_active: true, activity_status: 'bash_running' })).toBe('Running shell');
  expect(formatSessionActivityStatus({ is_active: true, activity_status: 'something-new' })).toBe('Working');
});

test('preview text drops Markdown noise and truncates to one line', () => {
  expect(cleanSessionPreviewText('## Done\n\n- **Built** `make build-web`\n- see [PR](https://x/1) ![img](a.png)')).toBe('Done Built make build-web see PR');
  const long = cleanSessionPreviewText('word '.repeat(100), 40);
  expect(long.length).toBe(40);
  expect(long.endsWith('…')).toBe(true);
  expect(cleanSessionPreviewText(null)).toBe('');
});

test('live preview prefers draft, then thinking, then the running tool', () => {
  const data = { type: 'tool_call', turn_id: 't1', tool_name: 'bash', tool_args: { command: 'make test' } };
  expect(resolveSessionLivePreview({ status: 'idle' }).preview).toBeNull();
  expect(resolveSessionLivePreview({ status: 'active', data, draft: { text: 'Draft **reply**' }, thought: { text: 'hmm' } }).preview)
    .toMatchObject({ kind: 'draft', label: 'Draft', text: 'Draft reply' });
  expect(resolveSessionLivePreview({ status: 'active', data, thought: 'Considering' }).preview).toMatchObject({ kind: 'thinking', text: 'Considering' });
  expect(resolveSessionLivePreview({ status: 'active', data }).preview).toMatchObject({ kind: 'tool', text: 'bash: make test' });
  expect(resolveSessionLivePreview({ status: 'active', data: { type: 'tool_status', title: 'Reading notes', status: 'Streaming output...' } }).preview)
    .toMatchObject({ kind: 'tool', text: 'Reading notes — Streaming output...' });
  expect(resolveSessionLivePreview({ status: 'active', data: { type: 'tool_status', title: 'Reading', status: 'done' } }).preview).toBeNull();
});

test('a finished tool falls back to the same turn draft, not an older turn', () => {
  const first = resolveSessionLivePreview({ status: 'active', data: { type: 'draft', turn_id: 't1' }, draft: 'Half written' });
  expect(first.retained).toMatchObject({ kind: 'draft', turnId: 't1' });
  const done = { status: 'active', data: { type: 'tool_status', turn_id: 't1', title: 'Grep', status: 'done' } };
  expect(resolveSessionLivePreview(done, first.retained).preview).toMatchObject({ kind: 'draft', text: 'Half written' });
  const nextTurn = { ...done, data: { ...done.data, turn_id: 't2' } };
  expect(resolveSessionLivePreview(nextTurn, first.retained)).toEqual({ preview: null, retained: null });
});

test('activity age is compact', () => {
  const now = Date.parse('2026-11-11T12:00:00Z');
  expect(formatSessionActivityAge('2026-11-11T11:59:30Z', now)).toBe('now');
  expect(formatSessionActivityAge('2026-11-11T11:55:00Z', now)).toBe('5m');
  expect(formatSessionActivityAge('2026-11-11T09:00:00Z', now)).toBe('3h');
  expect(formatSessionActivityAge('2026-11-09T12:00:00Z', now)).toBe('2d');
  expect(formatSessionActivityAge('2026-10-01T12:00:00Z', now)).not.toBe('');
  expect(formatSessionActivityAge(null, now)).toBe('');
});

test('context percent uses the reported percentage or tokens over the window', () => {
  expect(resolveSessionContextPercent({ context_percent: 42 })).toBe(42);
  expect(resolveSessionContextPercent({ context_percent: 140 })).toBe(100);
  expect(resolveSessionContextPercent({ context_tokens: 50_000, context_window: 200_000 })).toBe(25);
  expect(resolveSessionContextPercent({ context_percent: null })).toBeNull();
});

test('Ctrl/Cmd-click and middle-click open a new tab', () => {
  expect(isNewTabSessionClick({ ctrlKey: true })).toBe(true);
  expect(isNewTabSessionClick({ metaKey: true })).toBe(true);
  expect(isNewTabSessionClick({ button: 1 })).toBe(true);
  expect(isNewTabSessionClick({ button: 0 })).toBe(false);
});
