import { createLogger, debugSuppressedError } from "../utils/logger.js";
import { parsePositiveIntStrict } from "../utils/strict-int.js";
import type { ProgressWatchdogEntry, ProgressWatchdogSnapshot } from "./progress-watchdog.js";

const log = createLogger("runtime.progress-watchdog-monitor");
const DEFAULT_MONITOR_GRACE_MS = 5_000;
const DEFAULT_MONITOR_SCAN_MS = 2_000;

export interface ProgressWatchdogMonitorArgs {
  parentPid: number;
  scanMs: number;
  graceMs: number;
}

export interface ProgressWatchdogMonitorEvaluation {
  stalledEntry: ProgressWatchdogEntry | null;
  timeoutMs: number;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  return parsePositiveIntStrict(value, fallback);
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function parseProgressWatchdogSnapshotLine(line: string): ProgressWatchdogSnapshot | null {
  try {
    const parsed = JSON.parse(line) as ProgressWatchdogSnapshot;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function evaluateProgressWatchdogSnapshot(
  snapshot: ProgressWatchdogSnapshot | null | undefined,
  now = Date.now(),
): ProgressWatchdogMonitorEvaluation {
  if (!snapshot || snapshot.shuttingDown) {
    return { stalledEntry: null, timeoutMs: 0 };
  }
  const timeoutMs = Number.isFinite(snapshot.timeoutMs) ? Math.max(0, Number(snapshot.timeoutMs)) : 0;
  if (timeoutMs <= 0) {
    return { stalledEntry: null, timeoutMs };
  }
  const entries = Array.isArray(snapshot.entries) ? snapshot.entries : [];
  const stalledEntry = entries.find((entry) => {
    const lastProgressAt = Number(entry?.lastProgressAt);
    if (!Number.isFinite(lastProgressAt)) return false;
    return now - lastProgressAt > timeoutMs;
  }) ?? null;
  return { stalledEntry, timeoutMs };
}

async function terminateParentProcess(parentPid: number, graceMs: number): Promise<void> {
  if (!isPidAlive(parentPid)) return;
  try {
    process.kill(parentPid, "SIGTERM");
  } catch (error) {
    debugSuppressedError(log, "Failed to SIGTERM stalled runtime from watchdog monitor.", error, {
      operation: "progress_watchdog_monitor.sigterm",
      parentPid,
    });
    return;
  }

  const deadline = Date.now() + Math.max(0, graceMs);
  while (Date.now() < deadline) {
    if (!isPidAlive(parentPid)) return;
    await Bun.sleep(250);
  }

  if (!isPidAlive(parentPid)) return;
  try {
    process.kill(parentPid, "SIGKILL");
  } catch (error) {
    debugSuppressedError(log, "Failed to SIGKILL stalled runtime after watchdog grace window.", error, {
      operation: "progress_watchdog_monitor.sigkill",
      parentPid,
    });
  }
}

export function parseProgressWatchdogMonitorArgs(args = process.argv.slice(2)): ProgressWatchdogMonitorArgs {
  let parentPid = Number.NaN;
  let scanMs = DEFAULT_MONITOR_SCAN_MS;
  let graceMs = DEFAULT_MONITOR_GRACE_MS;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--parent-pid" && typeof args[index + 1] === "string") {
      parentPid = Number(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--parent-pid=")) {
      parentPid = Number(arg.slice("--parent-pid=".length));
      continue;
    }
    if (arg === "--scan-ms" && typeof args[index + 1] === "string") {
      scanMs = parsePositiveInt(args[index + 1], DEFAULT_MONITOR_SCAN_MS);
      index += 1;
      continue;
    }
    if (arg.startsWith("--scan-ms=")) {
      scanMs = parsePositiveInt(arg.slice("--scan-ms=".length), DEFAULT_MONITOR_SCAN_MS);
      continue;
    }
    if (arg === "--grace-ms" && typeof args[index + 1] === "string") {
      graceMs = parsePositiveInt(args[index + 1], DEFAULT_MONITOR_GRACE_MS);
      index += 1;
      continue;
    }
    if (arg.startsWith("--grace-ms=")) {
      graceMs = parsePositiveInt(arg.slice("--grace-ms=".length), DEFAULT_MONITOR_GRACE_MS);
    }
  }

  if (!Number.isFinite(parentPid) || parentPid <= 0) throw new Error("Missing valid --parent-pid <pid> for progress-watchdog monitor.");

  return {
    parentPid,
    scanMs: Math.max(250, scanMs),
    graceMs: Math.max(250, graceMs),
  };
}

export async function runProgressWatchdogMonitorFromArgs(args = process.argv.slice(2)): Promise<void> {
  const options = parseProgressWatchdogMonitorArgs(args);

  let latestSnapshot: ProgressWatchdogSnapshot | null = null;
  let streamEnded = false;
  let buffer = "";

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string | Buffer) => {
    buffer += String(chunk);
    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) break;
      const rawLine = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      const line = rawLine.trim();
      if (!line) continue;
      const parsed = parseProgressWatchdogSnapshotLine(line);
      if (!parsed) {
        debugSuppressedError(log, "Failed to parse progress-watchdog heartbeat snapshot line.", new Error("Invalid progress-watchdog snapshot line."), {
          operation: "progress_watchdog_monitor.parse_line",
        });
        continue;
      }
      latestSnapshot = parsed;
    }
  });
  process.stdin.on("end", () => {
    streamEnded = true;
  });
  process.stdin.on("close", () => {
    streamEnded = true;
  });
  process.stdin.resume();

  while (true) {
    if (streamEnded || !isPidAlive(options.parentPid)) return;

    const currentSnapshot: ProgressWatchdogSnapshot | null = latestSnapshot;
    const currentSnapshotPid = currentSnapshot ? (currentSnapshot as ProgressWatchdogSnapshot).pid : Number.NaN;
    if (Number.isFinite(currentSnapshotPid) && currentSnapshotPid !== options.parentPid) {
      return;
    }
    const evaluation = evaluateProgressWatchdogSnapshot(currentSnapshot, Date.now());
    if (evaluation.stalledEntry) {
      log.error("External progress-watchdog monitor detected a stale heartbeat; terminating the runtime.", {
        operation: "progress_watchdog_monitor.stall",
        parentPid: options.parentPid,
        chatJid: evaluation.stalledEntry.chatJid,
        phase: evaluation.stalledEntry.phase,
        timeoutMs: evaluation.timeoutMs,
        startedAt: new Date(evaluation.stalledEntry.startedAt).toISOString(),
        lastProgressAt: new Date(evaluation.stalledEntry.lastProgressAt).toISOString(),
        metadata: evaluation.stalledEntry.metadata,
      });
      await terminateParentProcess(options.parentPid, options.graceMs);
      return;
    }

    await Bun.sleep(options.scanMs);
  }
}

if (import.meta.main) {
  runProgressWatchdogMonitorFromArgs().catch((error) => {
    log.error("Progress-watchdog monitor failed", {
      operation: "progress_watchdog_monitor.run",
      err: error,
    });
    process.exitCode = 1;
  });
}
