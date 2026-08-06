/**
 * runtime/progress-watchdog.ts – Detect active chat runs that stop making progress.
 *
 * Maintains both an in-process watchdog and a lightweight heartbeat snapshot that
 * can be streamed to an external helper process over a pipe. Callers mark the
 * current phase for a chat (prompt, streaming, tool execution, recovery, etc.)
 * and periodically heartbeat it while work is progressing.
 */

import { getCompactionRuntimeConfig, getProgressWatchdogConfig } from "../core/config.js";
import { createLogger, debugSuppressedError } from "../utils/logger.js";

const log = createLogger("runtime.progress-watchdog");

export type ProgressWatchdogPhase =
  | "preprompt_compaction"
  | "prompt"
  | "streaming"
  | "tool_execution"
  | "recovery";

export interface ProgressWatchdogEntry {
  chatJid: string;
  phase: ProgressWatchdogPhase;
  startedAt: number;
  lastProgressAt: number;
  metadata?: Record<string, unknown>;
}

export interface ProgressWatchdogStall extends ProgressWatchdogEntry {
  ageMs: number;
  timeoutMs: number;
  requestAgeMs: number;
  providerEventObserved: boolean;
}

export interface ProgressWatchdogSnapshot {
  pid: number;
  updatedAt: string;
  timeoutMs: number;
  shuttingDown: boolean;
  entries: ProgressWatchdogEntry[];
}

const MIN_SCAN_INTERVAL_MS = 1_000;
const MAX_SCAN_INTERVAL_MS = 5_000;
const SNAPSHOT_PUBLISH_DEBOUNCE_MS = 250;

const activeByChat = new Map<string, ProgressWatchdogEntry & { stallReported?: boolean; abortAttempted?: boolean }>();
const abortersByChat = new Map<string, (stall: ProgressWatchdogStall) => void | Promise<void>>();

let scanTimer: ReturnType<typeof setInterval> | null = null;
let publishTimer: ReturnType<typeof setTimeout> | null = null;
let terminateProcess: (stall: ProgressWatchdogStall) => void = (_stall) => {
  process.exit(1);
};
let publishSnapshot: ((snapshot: ProgressWatchdogSnapshot) => void) | null = null;
let progressWatchdogTimeoutOverrideMs: number | null = null;

function shouldEscalateProgressWatchdogStall(): boolean {
  return getProgressWatchdogConfig().escalateOnStall;
}

function getProgressWatchdogScanIntervalMs(timeoutMs: number): number {
  if (timeoutMs <= 0) return 0;
  return Math.max(MIN_SCAN_INTERVAL_MS, Math.min(MAX_SCAN_INTERVAL_MS, Math.floor(timeoutMs / 4)));
}

export function getProgressWatchdogTimeoutMs(): number {
  if (progressWatchdogTimeoutOverrideMs !== null) return progressWatchdogTimeoutOverrideMs;
  const config = getCompactionRuntimeConfig();
  return config.progressWatchdogEnabled ? config.progressWatchdogTimeoutMs : 0;
}

export function buildProgressWatchdogSnapshot(shuttingDown = false): ProgressWatchdogSnapshot {
  return {
    pid: process.pid,
    updatedAt: new Date().toISOString(),
    timeoutMs: getProgressWatchdogTimeoutMs(),
    shuttingDown,
    entries: getTrackedPhasesSnapshot(),
  };
}

function publishProgressWatchdogSnapshotNow(shuttingDown = false): void {
  const publisher = publishSnapshot;
  if (!publisher) return;
  try {
    publisher(buildProgressWatchdogSnapshot(shuttingDown));
  } catch (error) {
    debugSuppressedError(log, "Failed to publish progress-watchdog heartbeat snapshot.", error, {
      operation: "progress_watchdog.publish_snapshot",
      shuttingDown,
    });
  }
}

function schedulePublishProgressWatchdogSnapshot(): void {
  if (publishTimer) return;
  publishTimer = setTimeout(() => {
    publishTimer = null;
    publishProgressWatchdogSnapshotNow(false);
  }, SNAPSHOT_PUBLISH_DEBOUNCE_MS);
  if (typeof publishTimer.unref === "function") publishTimer.unref();
}

export function flushProgressWatchdogState(): void {
  if (publishTimer) {
    clearTimeout(publishTimer);
    publishTimer = null;
  }
  publishProgressWatchdogSnapshotNow(false);
}

export function markProgressWatchdogShuttingDown(): void {
  if (publishTimer) {
    clearTimeout(publishTimer);
    publishTimer = null;
  }
  publishProgressWatchdogSnapshotNow(true);
}

export function setProgressWatchdogSnapshotPublisher(
  publisher: ((snapshot: ProgressWatchdogSnapshot) => void) | null,
): () => void {
  const previous = publishSnapshot;
  publishSnapshot = publisher;
  return () => {
    publishSnapshot = previous;
  };
}

export function setProgressWatchdogTimeoutForTests(timeoutMs: number | null): () => void {
  const previous = progressWatchdogTimeoutOverrideMs;
  progressWatchdogTimeoutOverrideMs = timeoutMs === null ? null : Math.max(0, Math.round(timeoutMs));
  return () => {
    progressWatchdogTimeoutOverrideMs = previous;
  };
}

function ensureScanLoop(): void {
  if (scanTimer || activeByChat.size === 0) return;
  const timeoutMs = getProgressWatchdogTimeoutMs();
  if (timeoutMs <= 0) return;
  const intervalMs = getProgressWatchdogScanIntervalMs(timeoutMs);
  scanTimer = setInterval(() => {
    scanForStalls();
  }, intervalMs);
  if (typeof scanTimer.unref === "function") scanTimer.unref();
}

function stopScanLoopIfIdle(): void {
  if (activeByChat.size > 0 || !scanTimer) return;
  clearInterval(scanTimer);
  scanTimer = null;
}

export function beginTrackedPhase(
  chatJid: string,
  phase: ProgressWatchdogPhase,
  metadata?: Record<string, unknown>,
): void {
  const now = Date.now();
  activeByChat.set(chatJid, {
    chatJid,
    phase,
    startedAt: now,
    lastProgressAt: now,
    metadata: metadata ? { ...metadata } : undefined,
    stallReported: false,
  });
  ensureScanLoop();
  flushProgressWatchdogState();
}

export function heartbeatTrackedPhase(
  chatJid: string,
  phase?: ProgressWatchdogPhase,
  metadata?: Record<string, unknown>,
): void {
  const now = Date.now();
  const current = activeByChat.get(chatJid);
  if (!current) {
    if (!phase) return;
    activeByChat.set(chatJid, {
      chatJid,
      phase,
      startedAt: now,
      lastProgressAt: now,
      metadata: metadata ? { ...metadata } : undefined,
      stallReported: false,
    });
    ensureScanLoop();
    flushProgressWatchdogState();
    return;
  }

  activeByChat.set(chatJid, {
    ...current,
    phase: phase ?? current.phase,
    lastProgressAt: now,
    metadata: metadata ? { ...(current.metadata || {}), ...metadata } : current.metadata,
    stallReported: false,
  });
  schedulePublishProgressWatchdogSnapshot();
}

export function endTrackedPhase(chatJid: string): void {
  activeByChat.delete(chatJid);
  abortersByChat.delete(chatJid);
  stopScanLoopIfIdle();
  flushProgressWatchdogState();
}

export function registerProgressWatchdogAborter(
  chatJid: string,
  aborter: (stall: ProgressWatchdogStall) => void | Promise<void>,
): () => void {
  abortersByChat.set(chatJid, aborter);
  return () => {
    if (abortersByChat.get(chatJid) === aborter) abortersByChat.delete(chatJid);
  };
}

export function getTrackedPhasesSnapshot(): ProgressWatchdogEntry[] {
  return Array.from(activeByChat.values()).map(({ stallReported: _stallReported, abortAttempted: _abortAttempted, ...entry }) => ({ ...entry }));
}

function getEffectiveEntryTimeoutMs(entry: ProgressWatchdogEntry, defaultTimeoutMs: number): number {
  const initialResponseGraceMs = Number(entry.metadata?.initialProviderResponseGraceMs);
  const providerEventObserved = entry.metadata?.providerEventObserved === true;
  if (
    entry.phase === "prompt"
    && !providerEventObserved
    && Number.isFinite(initialResponseGraceMs)
    && initialResponseGraceMs > defaultTimeoutMs
  ) {
    return Math.round(initialResponseGraceMs);
  }
  return defaultTimeoutMs;
}

export function scanForStalls(now = Date.now()): ProgressWatchdogStall[] {
  const timeoutMs = getProgressWatchdogTimeoutMs();
  if (timeoutMs <= 0) return [];

  const stalls: ProgressWatchdogStall[] = [];
  for (const [chatJid, current] of activeByChat) {
    const ageMs = Math.max(0, now - current.lastProgressAt);
    const effectiveTimeoutMs = getEffectiveEntryTimeoutMs(current, timeoutMs);
    if (ageMs < effectiveTimeoutMs) continue;

    const stall: ProgressWatchdogStall = {
      chatJid,
      phase: current.phase,
      startedAt: current.startedAt,
      lastProgressAt: current.lastProgressAt,
      metadata: current.metadata,
      ageMs,
      timeoutMs: effectiveTimeoutMs,
      requestAgeMs: Math.max(0, now - current.startedAt),
      providerEventObserved: current.metadata?.providerEventObserved === true,
    };
    stalls.push(stall);

    if (current.stallReported) continue;

    activeByChat.set(chatJid, { ...current, stallReported: true, abortAttempted: true });
    log.warn("Progress watchdog detected a stalled active phase; requesting best-effort run abort.", {
      operation: "progress_watchdog.stall",
      chatJid,
      phase: current.phase,
      ageMs,
      timeoutMs: effectiveTimeoutMs,
      configuredTimeoutMs: timeoutMs,
      requestAgeMs: stall.requestAgeMs,
      providerEventObserved: stall.providerEventObserved,
      startedAt: new Date(current.startedAt).toISOString(),
      lastProgressAt: new Date(current.lastProgressAt).toISOString(),
      metadata: current.metadata,
      escalationEnabled: shouldEscalateProgressWatchdogStall(),
    });

    const aborter = abortersByChat.get(chatJid);
    if (aborter) {
      Promise.resolve()
        .then(() => aborter(stall))
        .then(() => {
          log.warn("Progress watchdog abort request completed.", {
            operation: "progress_watchdog.abort_completed",
            chatJid,
            phase: current.phase,
            ageMs,
            timeoutMs,
          });
        })
        .catch((error) => {
          log.error("Progress watchdog abort request failed.", {
            operation: "progress_watchdog.abort_failed",
            chatJid,
            phase: current.phase,
            ageMs,
            timeoutMs,
            err: error,
            escalationEnabled: shouldEscalateProgressWatchdogStall(),
          });
          if (!shouldEscalateProgressWatchdogStall()) return;
          try {
            terminateProcess(stall);
          } catch (terminationError) {
            debugSuppressedError(log, "Progress watchdog termination hook threw unexpectedly.", terminationError, {
              operation: "progress_watchdog.termination_hook",
              chatJid,
              phase: current.phase,
            });
          }
        });
      continue;
    }

    if (!shouldEscalateProgressWatchdogStall()) continue;
    try {
      terminateProcess(stall);
    } catch (error) {
      debugSuppressedError(log, "Progress watchdog termination hook threw unexpectedly.", error, {
        operation: "progress_watchdog.termination_hook",
        chatJid,
        phase: current.phase,
      });
    }
  }

  return stalls;
}

export function setProgressWatchdogTerminationHook(
  hook: ((stall: ProgressWatchdogStall) => void) | null,
): () => void {
  const previous = terminateProcess;
  terminateProcess = hook || ((_stall) => {
    process.exit(1);
  });
  return () => {
    terminateProcess = previous;
  };
}

export function resetProgressWatchdogForTests(): void {
  activeByChat.clear();
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
  if (publishTimer) {
    clearTimeout(publishTimer);
    publishTimer = null;
  }
  abortersByChat.clear();
  terminateProcess = () => {
    process.exit(1);
  };
  publishSnapshot = null;
  progressWatchdogTimeoutOverrideMs = null;
}
