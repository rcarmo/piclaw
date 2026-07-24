import { expect, test } from 'bun:test';

import {
  evaluateProgressWatchdogSnapshot,
  parseProgressWatchdogMonitorArgs,
  parseProgressWatchdogSnapshotLine,
} from '../../src/runtime/progress-watchdog-monitor.js';

test('evaluateProgressWatchdogSnapshot returns a stalled entry when heartbeat age exceeds timeout', () => {
  const now = Date.now();
  const evaluation = evaluateProgressWatchdogSnapshot({
    pid: 123,
    updatedAt: new Date(now).toISOString(),
    timeoutMs: 30_000,
    shuttingDown: false,
    entries: [{
      chatJid: 'web:test',
      phase: 'streaming',
      startedAt: now - 60_000,
      lastProgressAt: now - 31_000,
      metadata: { source: 'test' },
    }],
  }, now);

  expect(evaluation.timeoutMs).toBe(30_000);
  expect(evaluation.stalledEntry).toEqual(expect.objectContaining({
    chatJid: 'web:test',
    phase: 'streaming',
  }));
});

test('evaluateProgressWatchdogSnapshot ignores empty or shutting-down state', () => {
  expect(evaluateProgressWatchdogSnapshot(null).stalledEntry).toBeNull();
  expect(evaluateProgressWatchdogSnapshot({
    pid: 123,
    updatedAt: new Date().toISOString(),
    timeoutMs: 30_000,
    shuttingDown: true,
    entries: [{ chatJid: 'web:test', phase: 'prompt', startedAt: Date.now(), lastProgressAt: Date.now() }],
  }).stalledEntry).toBeNull();
});

test('parseProgressWatchdogSnapshotLine reads newline-delimited heartbeat payloads', () => {
  expect(parseProgressWatchdogSnapshotLine(JSON.stringify({
    pid: 321,
    updatedAt: '2026-01-01T00:00:00.000Z',
    timeoutMs: 45_000,
    shuttingDown: false,
    entries: [{ chatJid: 'web:test', phase: 'prompt', startedAt: 1, lastProgressAt: 2 }],
  }))).toEqual(expect.objectContaining({
    pid: 321,
    timeoutMs: 45_000,
    entries: [expect.objectContaining({ chatJid: 'web:test', phase: 'prompt' })],
  }));
  expect(parseProgressWatchdogSnapshotLine('{bad json')).toBeNull();
});

test('parseProgressWatchdogMonitorArgs reads explicit parent pid and timing overrides', () => {
  const parsed = parseProgressWatchdogMonitorArgs([
    '--parent-pid', '4321',
    '--scan-ms', '1500',
    '--grace-ms', '7000',
  ]);

  expect(parsed).toEqual({
    parentPid: 4321,
    scanMs: 1500,
    graceMs: 7000,
  });
});

test('parseProgressWatchdogMonitorArgs rejects malformed timing suffixes and preserves fallback clamp semantics', () => {
  expect(parseProgressWatchdogMonitorArgs([
    '--parent-pid=4321',
    '--scan-ms=1500oops',
    '--grace-ms', '7000oops',
  ])).toEqual({
    parentPid: 4321,
    scanMs: 2000,
    graceMs: 5000,
  });

  expect(parseProgressWatchdogMonitorArgs([
    '--parent-pid=4321',
    '--scan-ms=1',
    '--grace-ms=0',
  ])).toEqual({
    parentPid: 4321,
    scanMs: 250,
    graceMs: 5000,
  });
});
