/**
 * agent-pool/logging.ts – Write agent run summaries to log files on disk.
 *
 * After each agent run, agent-pool.ts calls writeAgentLog() to persist a
 * brief summary (chat JID, duration, result/error) into the logs directory.
 * These log files are useful for post-mortem debugging of agent behaviour.
 *
 * Consumers:
 *   - agent-pool.ts calls writeAgentLog() in the finally block of runAgent().
 */

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";

import type { AgentRecoveryMetadata } from "./contracts.js";
import type { AgentAbortProvenance } from "./abort-provenance.js";

import { createLogger, debugSuppressedError } from "../utils/logger.js";
import {
  DEFAULT_LOG_RETENTION_CAP_MS,
  cleanupEmptyParentDirs,
  clampLogRetentionMs,
  formatLogTimestampForFilename,
  getDateShardedPath,
} from "../utils/log-layout.js";

const log = createLogger("agent-pool.logging");

export const DEFAULT_AGENT_LOG_RETENTION_MS = DEFAULT_LOG_RETENTION_CAP_MS;
export const DEFAULT_AGENT_LOG_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Write a single agent run log entry to disk.
 * Filenames are timestamped to avoid collisions.
 * Errors during writing are silently ignored to avoid cascading failures.
 */
export function writeAgentLog(
  logsDir: string,
  chatJid: string,
  duration: number,
  timedOut: boolean,
  result: string | null,
  error: string | null,
  recovery: AgentRecoveryMetadata | null = null,
  abortProvenance: AgentAbortProvenance | null = null,
): void {
  try {
    const createdAt = new Date();
    const ts = formatLogTimestampForFilename(createdAt);
    const plannedInterruption = abortProvenance?.cause === "service_shutdown";
    const content = [
      `Chat: ${chatJid}`,
      `Duration: ${duration}ms`,
      `TimedOut: ${timedOut}`,
      plannedInterruption ? "Outcome: interrupted" : error ? "Outcome: error" : "Outcome: success",
      abortProvenance ? `AbortCause: ${abortProvenance.cause}` : null,
      abortProvenance ? `AbortOperation: ${abortProvenance.operation}` : null,
      error ? `Error: ${error}` : null,
      recovery ? `RecoveryAttemptsUsed: ${recovery.attemptsUsed}` : null,
      recovery ? `RecoveryRecovered: ${recovery.recovered}` : null,
      recovery ? `RecoveryExhausted: ${recovery.exhausted}` : null,
      recovery?.lastClassifier ? `RecoveryLastClassifier: ${recovery.lastClassifier}` : null,
      recovery && recovery.strategyHistory.length > 0 ? `RecoveryStrategyHistory: ${recovery.strategyHistory.join(" -> ")}` : null,
      recovery && recovery.diagnostics.length > 0 ? `RecoveryDiagnostics: ${JSON.stringify(recovery.diagnostics)}` : null,
      "",
      "=== result ===",
      result?.slice(0, 50000) ?? "(none)",
    ]
      .filter((line) => line !== null)
      .join("\n");
    const path = getDateShardedPath(logsDir, `agent-${ts}.log`, createdAt);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  } catch (error) {
    debugSuppressedError(log, "Failed to write agent run log entry.", error, {
      logsDir,
      chatJid,
      timedOut,
    });
  }
}

/**
 * Remove agent run log files older than the retention window.
 * Legacy flat files and new YYYY-MM/DD sharded files are both handled.
 */
export function pruneAgentLogs(
  logsDir: string,
  maxAgeMs = DEFAULT_AGENT_LOG_RETENTION_MS,
  nowMs = Date.now(),
): number {
  if (!existsSync(logsDir)) return 0;
  const retentionMs = clampLogRetentionMs(maxAgeMs, DEFAULT_AGENT_LOG_RETENTION_MS);
  const cutoffMs = nowMs - retentionMs;
  let removed = 0;

  const visit = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (error) {
      debugSuppressedError(log, "Failed to read an agent log directory during pruning.", error, {
        operation: "agent_log.prune.read_dir",
        dir,
      });
      return;
    }

    for (const entry of entries) {
      const path = join(dir, entry);
      let stat;
      try {
        stat = statSync(path);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        visit(path);
        cleanupEmptyParentDirs(logsDir, path);
        continue;
      }
      if (!stat.isFile() || !entry.endsWith(".log") || stat.mtimeMs >= cutoffMs) continue;

      try {
        unlinkSync(path);
        removed += 1;
        cleanupEmptyParentDirs(logsDir, dirname(path));
      } catch (error) {
        debugSuppressedError(log, "Failed to unlink an old agent log file during pruning.", error, {
          operation: "agent_log.prune.unlink",
          path,
        });
      }
    }
  };

  visit(logsDir);
  return removed;
}

let cleanupStarted = false;

/** Start periodic best-effort pruning for agent run logs. */
export function startAgentLogCleanup(
  logsDir: string,
  maxAgeMs = DEFAULT_AGENT_LOG_RETENTION_MS,
  intervalMs = DEFAULT_AGENT_LOG_CLEANUP_INTERVAL_MS,
): void {
  if (cleanupStarted) return;
  cleanupStarted = true;
  pruneAgentLogs(logsDir, maxAgeMs);
  setInterval(() => pruneAgentLogs(logsDir, maxAgeMs), intervalMs).unref();
}
