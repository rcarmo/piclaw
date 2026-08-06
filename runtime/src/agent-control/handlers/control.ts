/**
 * agent-control/handlers/control.ts – Handlers for session lifecycle commands.
 *
 * Handles /restart, /compact, /auto-compact, /auto-retry, /abort,
 * /abort-retry, and /abort-bash commands that control the agent session's
 * execution state.
 *
 * Consumers: agent-control-handlers.ts dispatches to these handlers.
 */

import { spawn } from "node:child_process";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { getAgentControlConfig, getCompactionRuntimeConfig, setCompactionRuntimeConfig } from "../../core/config.js";
import type { AgentControlCommand, AgentControlResult } from "../agent-control-types.js";
import { formatCompactNumber } from "../agent-control-helpers.js";
import { createMedia, getChatCompactionBackoff } from "../../db.js";
import { getChatJid } from "../../core/chat-context.js";
import { recordAgentAbortCause } from "../../agent-pool/abort-provenance.js";
import { requestGracefulShutdown } from "../../runtime/shutdown-registry.js";
import { createLogger, debugSuppressedError } from "../../utils/logger.js";
import { isOrphanFunctionCallOutputError } from "../../utils/provider-payload-errors.js";
import { killTrackedProcesses } from "../../utils/process-tracker.js";
import { abortLiveSshCommand } from "../../extensions/ssh-core.js";
import { pruneOrphanToolResults } from "../../agent-pool/orphan-tool-results.js";
import { parsePiclawCompactionResultDetails, type PiclawCompactionResultDetails } from "../../extensions/smart-compaction/result-details.js";
import { extractRemoteCompactionReadableCheckpoint } from "../../extensions/smart-compaction/remote-compaction.js";
import {
  buildFreshContextUsageUpdateEvent,
  isCompactionCancellationError,
  getCompactionContextReport,
  getCompactionTimeoutMs,
  noteCompactionFailure,
  noteCompactionSuccess,
  runCompactionWithTimeout,
  type CompactionContextReport,
} from "../../agent-pool/compaction.js";

const log = createLogger("agent-control.control");
let killTrackedProcessesForRestart = killTrackedProcesses;

export function setKillTrackedProcessesForRestartForTests(fn: typeof killTrackedProcesses): () => void {
  const previous = killTrackedProcessesForRestart;
  killTrackedProcessesForRestart = fn;
  return () => {
    killTrackedProcessesForRestart = previous;
  };
}

type RestartCommand = Extract<AgentControlCommand, { type: "restart" }>;
type ExitCommand = Extract<AgentControlCommand, { type: "exit" }>;
type CompactCommand = Extract<AgentControlCommand, { type: "compact" }>;
type AutoCompactCommand = Extract<AgentControlCommand, { type: "auto_compact" }>;
type AutoRetryCommand = Extract<AgentControlCommand, { type: "auto_retry" }>;
type AbortCommand = Extract<AgentControlCommand, { type: "abort" }>;
type AbortRetryCommand = Extract<AgentControlCommand, { type: "abort_retry" }>;
type AbortBashCommand = Extract<AgentControlCommand, { type: "abort_bash" }>;

function scheduleProcessExit(): void {
  requestGracefulShutdown("/exit command");
}

function getAbortSettleTimeoutMs(): number {
  return getAgentControlConfig().abortSettleTimeoutMs;
}

async function waitForAbortToSettle(abortPromise: Promise<void>): Promise<"settled" | "timed_out"> {
  const timeoutMs = getAbortSettleTimeoutMs();
  if (timeoutMs <= 0) return "timed_out";
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      abortPromise.then(() => "settled" as const),
      new Promise<"timed_out">((resolve) => {
        timeoutHandle = setTimeout(() => resolve("timed_out"), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function toCompactReportFilename(timestamp: string): string {
  return `compaction-report-${timestamp.replace(/[:.]/g, "-")}.md`;
}

function formatReductionPercent(value: number | null): string | null {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : null;
}

function formatCompactionPercentChange(value: number | null): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value < 0
    ? `${Math.abs(value).toFixed(1)}% increase`
    : `${value.toFixed(1)}% reduction`;
}

function formatCompactionTokenDelta(report: CompactionContextReport): string {
  const source = report.estimatedTokensAfterSource === "upstream" ? "upstream" : "Piclaw";
  const change = formatCompactionPercentChange(report.reductionPercent);
  return [
    `${formatCompactNumber(report.estimatedTokensAfter)} (${source} estimate)`,
    change,
  ].filter(Boolean).join(" · ");
}

function contextUsageFromEvent(event: unknown): AgentControlResult["contextUsage"] | undefined {
  if (!event || typeof event !== "object") return undefined;
  const record = event as Record<string, unknown>;
  return {
    tokens: typeof record.tokens === "number" && Number.isFinite(record.tokens) ? record.tokens : null,
    contextWindow: typeof record.contextWindow === "number" && Number.isFinite(record.contextWindow) ? record.contextWindow : null,
    percent: typeof record.percent === "number" && Number.isFinite(record.percent) ? record.percent : null,
    estimated: record.estimated === true,
    source: typeof record.source === "string" ? record.source : undefined,
    phase: typeof record.phase === "string" ? record.phase : undefined,
  };
}

export function resolveManualCompactionContextUsage(
  measured: AgentControlResult["contextUsage"] | undefined,
  contextReport: CompactionContextReport,
): NonNullable<AgentControlResult["contextUsage"]> {
  if (measured?.tokens !== null && measured?.tokens !== undefined) return measured;
  const contextWindow = measured?.contextWindow ?? null;
  return {
    tokens: contextReport.safetyAdjustedTokensAfter,
    contextWindow,
    percent: contextWindow && contextWindow > 0
      ? (contextReport.safetyAdjustedTokensAfter / contextWindow) * 100
      : null,
    estimated: true,
    source: "compaction_report",
    phase: "after_manual_compaction",
  };
}

function capitalizeLabel(value: string): string {
  return value.split("_").map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(" ");
}

function formatCompactionPath(details: PiclawCompactionResultDetails | null): {
  method: string;
  execution: string;
  remote: string;
} {
  if (details?.kind === "piclaw.remote_compaction") {
    return { method: "Provider-native", execution: "Provider-native", remote: "Success" };
  }
  if (details?.kind === "piclaw.smart_compaction") {
    const remote = capitalizeLabel(details.remoteCompaction.outcome)
      + (details.remoteCompaction.reason ? ` — ${details.remoteCompaction.reason}` : "");
    return {
      method: capitalizeLabel(details.method),
      execution: capitalizeLabel(details.execution),
      remote,
    };
  }
  return {
    method: "Unreported by compaction provider",
    execution: "Unreported by compaction provider",
    remote: "Unreported by compaction provider",
  };
}

function buildCompactReport(
  summary: string,
  tokensBefore: number,
  firstKeptEntryId: string | number | null | undefined,
  timestamp: string,
  contextReport: CompactionContextReport,
  details: PiclawCompactionResultDetails | null,
): string {
  const reduction = formatReductionPercent(contextReport.reductionPercent);
  const increase = typeof contextReport.reductionPercent === "number" && Number.isFinite(contextReport.reductionPercent) && contextReport.reductionPercent < 0
    ? `${Math.abs(contextReport.reductionPercent).toFixed(1)}% increase`
    : null;
  const path = formatCompactionPath(details);
  const readableCheckpoint = details?.kind === "piclaw.remote_compaction"
    ? extractRemoteCompactionReadableCheckpoint(details)
    : null;
  const summaryHeading = details?.kind === "piclaw.remote_compaction"
    ? (readableCheckpoint ? "## Readable continuity checkpoint" : "## Provider-native context")
    : "## Summary";
  const summaryContent = details?.kind === "piclaw.remote_compaction"
    ? (readableCheckpoint
      ?? "No human-readable checkpoint was returned. Continuity is preserved in encrypted provider-native state, which is intentionally omitted from this report.")
    : (summary.trim() || "(empty summary)");
  return [
    "# Compaction report",
    "",
    `Generated: ${timestamp}`,
    `Tokens before: ${formatCompactNumber(tokensBefore)}`,
    `Estimated tokens after: ${formatCompactNumber(contextReport.estimatedTokensAfter)} (${contextReport.estimatedTokensAfterSource})`,
    `Safety-adjusted tokens after: ${formatCompactNumber(contextReport.safetyAdjustedTokensAfter)}`,
    increase ? `Estimated change: ${increase}` : reduction ? `Estimated reduction: ${reduction}` : null,
    `First kept entry: ${firstKeptEntryId ?? "unknown"}`,
    `Method: ${path.method}`,
    `Execution: ${path.execution}`,
    `Provider-native pre-pass: ${path.remote}`,
    "",
    summaryHeading,
    "",
    summaryContent,
    "",
  ].filter((line): line is string => line !== null).join("\n");
}

function createCompactReportAttachment(
  summary: string,
  tokensBefore: number,
  firstKeptEntryId: string | number | null | undefined,
  timestamp: string,
  contextReport: CompactionContextReport,
  details: PiclawCompactionResultDetails | null,
): number | null {
  try {
    const filename = toCompactReportFilename(timestamp);
    const content = buildCompactReport(summary, tokensBefore, firstKeptEntryId, timestamp, contextReport, details);
    const path = formatCompactionPath(details);
    return createMedia(
      filename,
      "text/markdown",
      new TextEncoder().encode(content),
      null,
      {
        source: "compact",
        generated_at: timestamp,
        tokens_before: tokensBefore,
        estimated_tokens_after: contextReport.estimatedTokensAfter,
        estimated_tokens_after_source: contextReport.estimatedTokensAfterSource,
        safety_adjusted_tokens_after: contextReport.safetyAdjustedTokensAfter,
        reduction_percent: contextReport.reductionPercent,
        first_kept_entry_id: firstKeptEntryId ?? null,
        compaction_method: path.method,
        compaction_execution: path.execution,
        remote_compaction_outcome: path.remote,
      }
    );
  } catch (error) {
    log.warn("Failed to create /compact report attachment", {
      operation: "agent_control.create_compact_report_attachment",
      err: error,
    });
    return null;
  }
}

function isSessionCorruptionError(message: string | null | undefined): boolean {
  if (!message) return false;
  return isOrphanFunctionCallOutputError(message)
    || /invalid_request_error|\b400\b.*(?:image|media_type|content|base64|tool_use_id|tool_result|tool_use)|media_type|image.*source|unexpected [`'\"]?tool_use_id[`'\"]?|tool_result.*corresponding.*tool_use/i.test(message);
}

function formatCompactFailureMessage(message: string): string {
  if (!isSessionCorruptionError(message)) return message;
  return `⚠️ API error — the session may be corrupted:\n\n\`${message.slice(0, 500)}\`\n\nPiClaw prunes orphaned agent tool results, corrupt image blocks, and orphan OpenAI Responses outputs before the repaired context is sent. Run \`/compact\`; if the rewritten session still fails, use \`/new-session\` to start fresh.`;
}

function getActiveCompactionBackoffMessage(chatJid: string, now = Date.now()): string | null {
  const backoff = getChatCompactionBackoff(chatJid);
  if (!backoff?.backoffUntil) return null;
  const untilMs = Date.parse(backoff.backoffUntil);
  if (!Number.isFinite(untilMs) || untilMs <= now) return null;
  const detail = backoff.lastErrorMessage ? ` Last error: ${backoff.lastErrorMessage.slice(0, 300)}` : "";
  return `Compaction is in backoff for this chat until ${backoff.backoffUntil} after ${backoff.failureCount} failed attempt${backoff.failureCount === 1 ? "" : "s"}.${detail}`;
}

const MANUAL_COMPACTION_FAILSAFE_GRACE_MS = 15_000;

function startManualCompactionExternalFailsafe(chatJid: string): (() => void) | null {
  if (process.env.NODE_ENV === "test") return null;
  const timeoutMs = getCompactionTimeoutMs();
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return null;

  const graceMs = MANUAL_COMPACTION_FAILSAFE_GRACE_MS;
  const delaySec = Math.max(1, Math.ceil((timeoutMs + graceMs) / 1000));
  const pid = process.pid;
  const marker = `/tmp/piclaw-manual-compact-${pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.watchdog`;
  try {
    writeFileSync(marker, JSON.stringify({ pid, chatJid, startedAt: new Date().toISOString(), timeoutMs, graceMs }) + "\n", { mode: 0o600 });
    const script = [
      `sleep ${delaySec}`,
      `if [ -e '${marker}' ] && kill -0 ${pid} 2>/dev/null; then`,
      `  echo 'Piclaw manual /compact external failsafe terminating pid ${pid} for ${chatJid}' >&2`,
      `  kill -TERM ${pid} 2>/dev/null || true`,
      `  sleep 5`,
      `  kill -KILL ${pid} 2>/dev/null || true`,
      `fi`,
    ].join("\n");
    const child = spawn("/bin/sh", ["-c", script], { detached: true, stdio: "ignore" });
    child.unref();
    log.warn("Started manual /compact external failsafe", {
      operation: "agent_control.manual_compact.external_failsafe.start",
      chatJid,
      pid,
      marker,
      timeoutMs,
      graceMs,
      delaySec,
    });
    return () => {
      try {
        if (existsSync(marker)) unlinkSync(marker);
      } catch (error) {
        debugSuppressedError(log, "Failed to clear manual /compact external failsafe marker", error, {
          operation: "agent_control.manual_compact.external_failsafe.clear",
          chatJid,
          marker,
        });
      }
    };
  } catch (error) {
    debugSuppressedError(log, "Failed to start manual /compact external failsafe", error, {
      operation: "agent_control.manual_compact.external_failsafe.start_failed",
      chatJid,
      pid,
    });
    return null;
  }
}

/** Handle /restart: reload the agent session from disk. */
export async function handleRestart(session: AgentSession, _command: RestartCommand): Promise<AgentControlResult> {
  try {
    recordAgentAbortCause(getChatJid("control:/restart"), "service_shutdown", "agent_control.restart");
    await session.abort();
  } catch (err) {
    debugSuppressedError(log, "Failed to abort session before restart; continuing with reload.", err, {
      operation: "agent_control.restart.abort_before_reload",
    });
  }

  let killed = 0;

  try {
    await session.reload({
      beforeSessionStart: () => {
        killed = killTrackedProcessesForRestart();
      },
    } as unknown as Parameters<typeof session.reload>[0]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: "error",
      message: `Restart failed after killing ${killed} subprocess${killed === 1 ? "" : "es"}: ${message}`,
    };
  }

  const killedLabel = killed === 1 ? "1 subprocess" : `${killed} subprocesses`;
  return {
    status: "success",
    message: `Agent restarted. Killed ${killedLabel}.`,
    refresh_runtime: true,
  };
}

/** Handle /exit: terminate the process so supervisor can restart piclaw. */
export async function handleExit(session: AgentSession, _command: ExitCommand): Promise<AgentControlResult> {
  try {
    recordAgentAbortCause(getChatJid("control:/exit"), "service_shutdown", "agent_control.exit");
    await session.abort();
  } catch (err) {
    debugSuppressedError(log, "Failed to abort session before exit; continuing with shutdown.", err, {
      operation: "agent_control.exit.abort_before_shutdown",
    });
  }

  killTrackedProcesses();
  scheduleProcessExit();

  return {
    status: "success",
    message: "Exiting now so supervisor can restart piclaw.",
  };
}

/** Handle /compact: manually trigger conversation compaction. */
export async function handleCompact(session: AgentSession, command: CompactCommand): Promise<AgentControlResult> {
  try {
    const chatJid = getChatJid("control:/compact");
    const backoffMessage = getActiveCompactionBackoffMessage(chatJid);
    if (backoffMessage) {
      return {
        status: "error",
        message: `${backoffMessage}\n\nManual /compact is disabled while compaction backoff is active so a failed compaction cannot poison restart recovery. Use /session-rotate or wait for the backoff to expire.`,
      };
    }

    const clearExternalFailsafe = startManualCompactionExternalFailsafe(chatJid);
    let keepExternalFailsafeArmed = false;
    let compactionResult: Awaited<ReturnType<typeof runCompactionWithTimeout>>;
    try {
      const prunedToolResults = pruneOrphanToolResults(session, chatJid);
      compactionResult = await runCompactionWithTimeout(
        session,
        chatJid,
        {
          onWarn: (message, details) => {
            log.warn(message, details);
          },
        },
        async () => await session.compact(command.instructions?.trim() || undefined),
        "manual",
        { trigger: "manual", willRetry: false, source: "compact_command" },
      );
      if (!compactionResult.ok) {
        if (!compactionResult.joined && !isCompactionCancellationError(compactionResult.errorMessage)) {
          noteCompactionFailure(chatJid, compactionResult.errorMessage);
        }
        const timedOut = /timed out/i.test(compactionResult.errorMessage);
        keepExternalFailsafeArmed = timedOut;
        return {
          status: "error",
          message: timedOut
            ? `${compactionResult.errorMessage}. The physical compaction may still be settling; the external failsafe remains armed to prevent unsafe reuse.`
            : formatCompactFailureMessage(compactionResult.errorMessage),
        };
      }

      if (!compactionResult.joined) {
        noteCompactionSuccess(session, chatJid, "manual", {
          onInfo: (message, details) => log.info(message, details),
          onWarn: (message, details) => log.warn(message, details),
          countSuccess: false,
        });
      }
      const compactResult = compactionResult.result as { summary: string; tokensBefore: number; firstKeptEntryId: string | number | null | undefined; estimatedTokensAfter?: number; details?: unknown };
      const compactionDetails = parsePiclawCompactionResultDetails(compactResult.details);
      const compactionPath = formatCompactionPath(compactionDetails);
      const contextReport = getCompactionContextReport(session, compactResult);
      const measuredContextUsage = contextUsageFromEvent(buildFreshContextUsageUpdateEvent(session, chatJid, "after_manual_compaction", {
        source: "compact_command",
      }));
      const freshContextUsage = resolveManualCompactionContextUsage(measuredContextUsage, contextReport);
      const generatedAt = new Date().toISOString();
      const attachmentId = createCompactReportAttachment(
        compactResult.summary,
        compactResult.tokensBefore,
        compactResult.firstKeptEntryId,
        generatedAt,
        contextReport,
        compactionDetails,
      );
      const lines = [
        "Compaction complete.",
        `Method: ${compactionPath.method}`,
        `Execution: ${compactionPath.execution}`,
        `Provider-native pre-pass: ${compactionPath.remote}`,
        prunedToolResults > 0 ? `Removed ${prunedToolResults} orphaned tool-result block${prunedToolResults === 1 ? "" : "s"} before rewriting the session.` : null,
        `Tokens before: ${formatCompactNumber(compactResult.tokensBefore)}`,
        `Estimated after: ${formatCompactionTokenDelta(contextReport)}`,
        `Safety-adjusted after: ${formatCompactNumber(contextReport.safetyAdjustedTokensAfter)}`,
        `First kept entry: ${compactResult.firstKeptEntryId}`,
        attachmentId ? "Attached: full compaction report (.md)." : "Full compaction report attachment unavailable.",
      ].filter(Boolean) as string[];
      return {
        status: "success",
        message: lines.join("\n"),
        ...(attachmentId ? { mediaIds: [attachmentId] } : {}),
        ...(freshContextUsage ? { contextUsage: freshContextUsage } : {}),
      };
    } finally {
      if (!keepExternalFailsafeArmed) clearExternalFailsafe?.();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "error", message: formatCompactFailureMessage(message) };
  }
}

/** Handle /auto-compact: toggle automatic compaction on/off. */
export async function handleAutoCompact(session: AgentSession, command: AutoCompactCommand): Promise<AgentControlResult> {
  const hasArgs = command.raw.trim().split(/\s+/).length > 1;
  if (command.enabled === undefined) {
    if (hasArgs) {
      return { status: "error", message: "Usage: /auto-compact on|off" };
    }
    return {
      status: "success",
      message: `Auto-compaction is ${getCompactionRuntimeConfig().autoCompactionEnabled ? "on" : "off"}.`,
    };
  }
  setCompactionRuntimeConfig({ autoCompactionEnabled: command.enabled });
  if (typeof session.setAutoCompactionEnabled === "function") session.setAutoCompactionEnabled(false);
  return {
    status: "success",
    message: `Auto-compaction turned ${command.enabled ? "on" : "off"}.`,
  };
}

/** Handle /auto-retry: toggle automatic retry on/off. */
export async function handleAutoRetry(session: AgentSession, command: AutoRetryCommand): Promise<AgentControlResult> {
  const hasArgs = command.raw.trim().split(/\s+/).length > 1;
  if (command.enabled === undefined) {
    if (hasArgs) {
      return { status: "error", message: "Usage: /auto-retry on|off" };
    }
    return {
      status: "success",
      message: `Auto-retry is ${session.autoRetryEnabled ? "on" : "off"}.`,
    };
  }
  session.setAutoRetryEnabled(command.enabled);
  return {
    status: "success",
    message: `Auto-retry turned ${command.enabled ? "on" : "off"}.`,
  };
}

/** Handle /abort: cancel the current agent response and kill tracked tools. */
export async function handleAbort(session: AgentSession, _command: AbortCommand): Promise<AgentControlResult> {
  try {
    if (session.isCompacting) {
      session.abortCompaction();
      const killed = killTrackedProcesses();
      const killedLabel = killed > 0 ? ` Killed ${killed} tracked tool process${killed === 1 ? "" : "es"}.` : "";
      return { status: "success", message: `Compaction aborted.${killedLabel}` };
    }
    const chatJid = getChatJid("control:/abort");
    recordAgentAbortCause(chatJid, "user_command", "agent_control.abort");
    const abortPromise = Promise.resolve().then(() => session.abort());
    const sshAborted = abortLiveSshCommand(chatJid);
    const killed = killTrackedProcesses();
    const abortState = await waitForAbortToSettle(abortPromise);
    if (abortState === "timed_out") {
      abortPromise.catch((err) => {
        debugSuppressedError(log, "Session abort settled late after /abort response.", err, {
          operation: "agent_control.abort.late_settle",
          chatJid,
        });
      });
    }
    const sshLabel = sshAborted ? " Interrupted active SSH command." : "";
    const killedLabel = killed > 0 ? ` Killed ${killed} tracked tool process${killed === 1 ? "" : "es"}.` : "";
    const pendingLabel = abortState === "timed_out" ? ` Abort is still settling after ${getAbortSettleTimeoutMs()}ms.` : "";
    return { status: "success", message: `Aborted current response.${sshLabel}${killedLabel}${pendingLabel}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "error", message };
  }
}

/** Handle /abort: cancel the current agent response. */
export async function handleAbortRetry(session: AgentSession, _command: AbortRetryCommand): Promise<AgentControlResult> {
  session.abortRetry();
  return { status: "success", message: "Retry aborted." };
}

/** Handle /abort: cancel the current agent response. */
export async function handleAbortBash(session: AgentSession, _command: AbortBashCommand): Promise<AgentControlResult> {
  if (!session.isBashRunning) {
    return { status: "success", message: "No bash command is running." };
  }
  session.abortBash();
  return { status: "success", message: "Bash command aborted." };
}
