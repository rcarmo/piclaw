import { afterEach, beforeEach, expect, test } from "bun:test";

import {
  beginTrackedPhase,
  endTrackedPhase,
  flushProgressWatchdogState,
  getTrackedPhasesSnapshot,
  heartbeatTrackedPhase,
  registerProgressWatchdogAborter,
  resetProgressWatchdogForTests,
  resumeTrackedPhase,
  scanForStalls,
  setProgressWatchdogSnapshotPublisher,
  setProgressWatchdogTerminationHook,
  setProgressWatchdogTimeoutForTests,
  suspendTrackedPhase,
} from "../../src/runtime/progress-watchdog.js";

let restoreTimeoutOverride: (() => void) | null = null;
let restoreTerminationHook: (() => void) | null = null;
let restoreSnapshotPublisher: (() => void) | null = null;

beforeEach(() => {
  resetProgressWatchdogForTests();
});

afterEach(() => {
  restoreSnapshotPublisher?.();
  restoreSnapshotPublisher = null;
  restoreTerminationHook?.();
  restoreTerminationHook = null;
  restoreTimeoutOverride?.();
  restoreTimeoutOverride = null;
  resetProgressWatchdogForTests();
});

test("progress watchdog records and clears tracked phases", () => {
  beginTrackedPhase("web:test", "prompt", { source: "test" });

  expect(getTrackedPhasesSnapshot()).toEqual([
    expect.objectContaining({
      chatJid: "web:test",
      phase: "prompt",
      metadata: { source: "test" },
    }),
  ]);

  endTrackedPhase("web:test");
  expect(getTrackedPhasesSnapshot()).toEqual([]);
});

test("progress watchdog heartbeat refreshes the active phase", () => {
  restoreTimeoutOverride = setProgressWatchdogTimeoutForTests(50);
  beginTrackedPhase("web:test", "prompt", { source: "test" });
  const started = getTrackedPhasesSnapshot()[0];
  expect(started).toBeTruthy();

  heartbeatTrackedPhase("web:test", "streaming", { eventType: "message_update" });
  const after = getTrackedPhasesSnapshot()[0];
  expect(after?.phase).toBe("streaming");
  expect((after?.lastProgressAt ?? 0)).toBeGreaterThanOrEqual(started?.lastProgressAt ?? 0);
  expect(after?.metadata).toMatchObject({ source: "test", eventType: "message_update" });
});

test("progress watchdog suspension preserves phase state, suppresses stalls, and resumes with fresh progress", async () => {
  restoreTimeoutOverride = setProgressWatchdogTimeoutForTests(10);
  beginTrackedPhase("web:test", "prompt", { source: "test", providerEventObserved: false });
  const before = getTrackedPhasesSnapshot()[0];
  expect(before).toBeTruthy();

  suspendTrackedPhase("web:test", "ui_prompt", { kind: "confirm", title: "Continue?" });
  const suspended = getTrackedPhasesSnapshot()[0];
  expect(suspended).toEqual({
    ...before,
    suspension: expect.objectContaining({
      reason: "ui_prompt",
      metadata: { kind: "confirm", title: "Continue?" },
    }),
  });
  expect(scanForStalls((before?.lastProgressAt ?? 0) + 100)).toEqual([]);

  heartbeatTrackedPhase("web:test", "streaming", { providerEventObserved: true });
  expect(getTrackedPhasesSnapshot()[0]).toEqual(suspended);

  await Bun.sleep(2);
  resumeTrackedPhase("web:test", "ui_prompt");
  const resumed = getTrackedPhasesSnapshot()[0];
  expect(resumed?.suspension).toBeUndefined();
  expect(resumed?.phase).toBe("prompt");
  expect(resumed?.startedAt).toBe(before?.startedAt);
  expect(resumed?.metadata).toEqual(before?.metadata);
  expect(resumed?.lastProgressAt ?? 0).toBeGreaterThan(before?.lastProgressAt ?? 0);
  expect(scanForStalls(resumed?.lastProgressAt ?? 0)).toEqual([]);
});

test("progress watchdog suspension preserves the registered aborter after resume", async () => {
  restoreTimeoutOverride = setProgressWatchdogTimeoutForTests(10);
  const stalls: string[] = [];
  beginTrackedPhase("web:test", "tool_execution");
  registerProgressWatchdogAborter("web:test", (stall) => { stalls.push(stall.chatJid); });
  suspendTrackedPhase("web:test", "ui_prompt");
  resumeTrackedPhase("web:test", "ui_prompt");
  const resumed = getTrackedPhasesSnapshot()[0];

  expect(scanForStalls((resumed?.lastProgressAt ?? 0) + 20)).toHaveLength(1);
  await Bun.sleep(0);
  expect(stalls).toEqual(["web:test"]);
});

test("progress watchdog suspension is idempotent and endTrackedPhase clears it", () => {
  beginTrackedPhase("web:test", "tool_execution", { tool: "confirm" });
  suspendTrackedPhase("web:test", "ui_prompt", { kind: "custom" });
  const first = getTrackedPhasesSnapshot()[0];
  suspendTrackedPhase("web:test", "ui_prompt", { kind: "input" });
  expect(getTrackedPhasesSnapshot()[0]).toEqual(first);

  resumeTrackedPhase("web:test", "ui_prompt");
  const resumed = getTrackedPhasesSnapshot()[0];
  resumeTrackedPhase("web:test", "ui_prompt");
  expect(getTrackedPhasesSnapshot()[0]).toEqual(resumed);

  suspendTrackedPhase("web:test", "ui_prompt");
  endTrackedPhase("web:test");
  expect(getTrackedPhasesSnapshot()).toEqual([]);
});

test("progress watchdog publishes heartbeat snapshots when phases change", () => {
  const snapshots: Array<{ shuttingDown: boolean; entries: string[] }> = [];
  restoreSnapshotPublisher = setProgressWatchdogSnapshotPublisher((snapshot) => {
    snapshots.push({
      shuttingDown: snapshot.shuttingDown,
      entries: snapshot.entries.map((entry) => `${entry.chatJid}:${entry.phase}`),
    });
  });

  beginTrackedPhase("web:test", "prompt");
  heartbeatTrackedPhase("web:test", "streaming");
  flushProgressWatchdogState();
  endTrackedPhase("web:test");

  expect(snapshots).toEqual([
    { shuttingDown: false, entries: ["web:test:prompt"] },
    { shuttingDown: false, entries: ["web:test:streaming"] },
    { shuttingDown: false, entries: [] },
  ]);
});

test("Dream initial provider response gets a bounded grace window, but streaming does not", () => {
  restoreTimeoutOverride = setProgressWatchdogTimeoutForTests(25);
  beginTrackedPhase("dream:auto:web-default:1", "prompt", {
    source: "run_agent",
    initialProviderResponseGraceMs: 75,
    providerEventObserved: false,
    model: "test/slow-first-token",
  });
  const started = getTrackedPhasesSnapshot()[0];
  expect(started).toBeTruthy();

  expect(scanForStalls((started?.lastProgressAt ?? 0) + 30)).toEqual([]);
  const firstResponseStall = scanForStalls((started?.lastProgressAt ?? 0) + 80);
  expect(firstResponseStall).toEqual([expect.objectContaining({
    phase: "prompt",
    timeoutMs: 75,
    requestAgeMs: 80,
    providerEventObserved: false,
  })]);

  heartbeatTrackedPhase("dream:auto:web-default:1", "streaming", { providerEventObserved: true });
  const streaming = getTrackedPhasesSnapshot()[0];
  expect(scanForStalls((streaming?.lastProgressAt ?? 0) + 30)).toEqual([expect.objectContaining({
    phase: "streaming",
    timeoutMs: 25,
    providerEventObserved: true,
  })]);
});

test("progress watchdog reports stalled phases without process escalation by default", () => {
  restoreTimeoutOverride = setProgressWatchdogTimeoutForTests(25);
  const terminations: any[] = [];
  restoreTerminationHook = setProgressWatchdogTerminationHook((stall) => {
    terminations.push(stall);
  });

  beginTrackedPhase("web:test", "preprompt_compaction", { source: "test" });
  const tracked = getTrackedPhasesSnapshot()[0];
  expect(tracked).toBeTruthy();

  const results = scanForStalls((tracked?.lastProgressAt ?? 0) + 30);
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({
    chatJid: "web:test",
    phase: "preprompt_compaction",
    timeoutMs: 25,
  });
  expect(terminations).toEqual([]);
});

test("progress watchdog can escalate stalled phases when explicitly enabled", () => {
  const previous = process.env.PICLAW_PROGRESS_WATCHDOG_RESTART_ON_STALL;
  process.env.PICLAW_PROGRESS_WATCHDOG_RESTART_ON_STALL = "1";
  try {
    restoreTimeoutOverride = setProgressWatchdogTimeoutForTests(25);
    const terminations: any[] = [];
    restoreTerminationHook = setProgressWatchdogTerminationHook((stall) => {
      terminations.push(stall);
    });

    beginTrackedPhase("web:test", "preprompt_compaction", { source: "test" });
    const tracked = getTrackedPhasesSnapshot()[0];
    expect(tracked).toBeTruthy();

    const results = scanForStalls((tracked?.lastProgressAt ?? 0) + 30);
    expect(results).toHaveLength(1);
    expect(terminations).toEqual([expect.objectContaining({ chatJid: "web:test", phase: "preprompt_compaction" })]);
  } finally {
    if (previous === undefined) delete process.env.PICLAW_PROGRESS_WATCHDOG_RESTART_ON_STALL;
    else process.env.PICLAW_PROGRESS_WATCHDOG_RESTART_ON_STALL = previous;
  }
});
