/**
 * agent-pool/prompt-utils.ts – Shared prompt/assistant text helpers.
 */

import { parsePositiveIntStrict } from "../utils/strict-int.js";

/** Lightweight assistant message metadata used by side-prompt helpers. */
export interface SideAssistantMessage {
  stopReason?: string;
  errorMessage?: string;
  usage?: unknown;
  content?: unknown[];
  provider?: string;
  model?: string;
  api?: string;
}

/** Format a timeout in a compact human-readable form. */
export function formatTimeoutDuration(timeoutMs: number): string {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return `${timeoutMs}ms`;
  if (timeoutMs % 1000 === 0) return `${Math.round(timeoutMs / 1000)}s`;
  return `${(timeoutMs / 1000).toFixed(1)}s`;
}

/** Extract assistant text blocks from a rich content message. */
export function extractAssistantText(message: { content?: unknown[] } | null | undefined): string {
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .map((block) => block && typeof block === "object" && (block as { type?: unknown }).type === "text"
      ? String((block as { text?: unknown }).text ?? "")
      : "")
    .join("")
    .trim();
}

/** Extract assistant thinking blocks from a rich content message. */
export function extractAssistantThinking(message: { content?: unknown[] } | null | undefined): string {
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .map((block) => block && typeof block === "object" && (block as { type?: unknown }).type === "thinking"
      ? String((block as { thinking?: unknown }).thinking ?? "")
      : "")
    .join("")
    .trim();
}

/** Normalize supported side-prompt reasoning levels for streamSimple(). */
export function toSideReasoning(level: unknown): "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | undefined {
  return level === "minimal" || level === "low" || level === "medium" || level === "high" || level === "xhigh" || level === "max"
    ? level
    : undefined;
}

export interface SessionIdleWaitResult {
  totalWaitMs: number;
  settleTicks: number;
  idleTicks: number;
  isStreaming: boolean;
  isCompacting: boolean;
  isRetrying: boolean;
}

export const DEFAULT_SESSION_IDLE_SETTLE_TICKS = 20;
export const DEFAULT_SESSION_IDLE_MAX_WAIT_MS = 10_000;
export const DEFAULT_SESSION_IDLE_COMPACTION_MAX_WAIT_MS = 300_000;

function parseEnvPositiveInt(name: string, fallback: number): number {
  return parsePositiveIntStrict(process.env[name], fallback);
}

export function resolveSessionIdleMaxWaitMs(
  session: { isCompacting?: boolean },
  defaultMaxWaitMs = parseEnvPositiveInt("PICLAW_SESSION_IDLE_MAX_WAIT_MS", DEFAULT_SESSION_IDLE_MAX_WAIT_MS),
  compactionMaxWaitMs = parseEnvPositiveInt("PICLAW_SESSION_IDLE_COMPACTION_MAX_WAIT_MS", DEFAULT_SESSION_IDLE_COMPACTION_MAX_WAIT_MS),
): number {
  if (!session.isCompacting) return defaultMaxWaitMs;
  return Math.max(defaultMaxWaitMs, compactionMaxWaitMs);
}

/** Wait until a session fully settles after a prompt completes. */
export async function waitForSessionIdle(
  session: { isStreaming?: boolean; isCompacting?: boolean; isRetrying?: boolean },
  settleTicks = DEFAULT_SESSION_IDLE_SETTLE_TICKS,
  onSettled?: (result: SessionIdleWaitResult) => void,
  maxWaitMs = DEFAULT_SESSION_IDLE_MAX_WAIT_MS,
): Promise<void> {
  let idleTicks = 0;
  const startTime = Date.now();
  while (idleTicks < settleTicks) {
    const totalWaitMs = Date.now() - startTime;
    if (maxWaitMs > 0 && totalWaitMs >= maxWaitMs) {
      throw new Error(
        `Timed out waiting for session idle after ${formatTimeoutDuration(maxWaitMs)} ` +
          `(streaming=${Boolean(session.isStreaming)}, compacting=${Boolean(session.isCompacting)}, retrying=${Boolean(session.isRetrying)})`,
      );
    }
    if (!session.isStreaming && !session.isCompacting && !session.isRetrying) {
      idleTicks += 1;
    } else {
      idleTicks = 0;
    }
    await Bun.sleep(50);
  }

  onSettled?.({
    totalWaitMs: Date.now() - startTime,
    settleTicks,
    idleTicks,
    isStreaming: Boolean(session.isStreaming),
    isCompacting: Boolean(session.isCompacting),
    isRetrying: Boolean(session.isRetrying),
  });
}
