/**
 * session-rotation.ts – Shared session rotation helpers.
 *
 * Provides a single safe rotation implementation used by both the manual
 * control command (`/session-rotate`) and automatic rotation in AgentPool.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AgentSession, AgentSessionRuntime, SessionContext, SessionManager } from "@mariozechner/pi-coding-agent";
import { closeOpenAICodexWebSocketSessions } from "@mariozechner/pi-ai/openai-codex-responses";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { basename, dirname, extname, join } from "path";
import { formatBytes } from "./agent-control/agent-control-helpers.js";

type PersistableSessionMessage = Parameters<SessionManager["appendMessage"]>[0];

/** Rotation trigger source. */
export type SessionRotationReason = "manual" | "automatic";

/** Result returned by shared rotation helpers. */
export interface SessionRotationResult {
  status: "success" | "error";
  reason: SessionRotationReason;
  message: string;
  archivePath?: string;
  newSessionFile?: string;
  previousSize?: number | null;
  nextSize?: number | null;
  compacted: boolean;
}

/** Default compaction prompt used before a rotation handoff. */
export const ROTATION_COMPACTION_INSTRUCTIONS = [
  "Prepare a concise continuity summary for session rotation.",
  "Preserve active goals, decisions, constraints, user preferences, and any pending work relevant to the next turns.",
  "Prefer compact operational context over narrative detail.",
].join(" ");

/** Return the byte size for a persisted session file, or null if unavailable. */
export function getSessionFileSize(sessionFile: string | undefined): number | null {
  if (!sessionFile) return null;
  try {
    return statSync(sessionFile).size;
  } catch {
    return null;
  }
}

/** Return the line count for a persisted session file, or null if unavailable. */
export function getSessionFileLineCount(sessionFile: string | undefined): number | null {
  if (!sessionFile) return null;
  try {
    const content = readFileSync(sessionFile, "utf8");
    if (!content) return 0;
    // Each JSONL entry is one line; count newlines for a fast approximation.
    let count = 0;
    for (let i = 0; i < content.length; i++) {
      if (content.charCodeAt(i) === 10) count++;
    }
    return count;
  } catch {
    return null;
  }
}

/** Choose a unique archive path inside the current session directory. */
export function getArchivePath(sessionFile: string): string {
  const archiveDir = join(dirname(sessionFile), "archive");
  mkdirSync(archiveDir, { recursive: true });

  const base = basename(sessionFile);
  const extension = extname(base);
  const stem = extension ? base.slice(0, -extension.length) : base;

  let candidate = join(archiveDir, base);
  let counter = 1;
  while (existsSync(candidate)) {
    candidate = join(archiveDir, `${stem}.archived-${counter}${extension}`);
    counter += 1;
  }
  return candidate;
}

/** Persist the current session entries immediately, even before another assistant response arrives. */
export function forcePersistSessionFile(session: AgentSession): void {
  const sessionFile = session.sessionFile;
  const header = session.sessionManager.getHeader();
  if (!sessionFile || !header) return;

  const entries = session.sessionManager.getEntries();
  const content = [header, ...entries].map((entry) => JSON.stringify(entry)).join("\n");
  writeFileSync(sessionFile, `${content}\n`);
}

/** Return true when compaction errors are safe to fall back from during rotation. */
export function isRotationFallbackCompactionError(message: string): boolean {
  return [
    "Already compacted",
    "Nothing to compact (session too small)",
    "No model selected",
  ].includes(message);
}

/** Build a carried-forward summary from compaction and branch-summary messages. */
export function collectCarriedSummary(messages: readonly AgentMessage[]): { summary: string | null; tokensBefore: number } {
  const parts: string[] = [];
  let tokensBefore = 0;

  for (const message of messages) {
    if (message.role === "compactionSummary") {
      parts.push(message.summary.trim());
      tokensBefore = Math.max(tokensBefore, message.tokensBefore);
    } else if (message.role === "branchSummary") {
      parts.push(`Branch summary:\n${message.summary.trim()}`);
    }
  }

  const summary = parts.map((part) => part.trim()).filter(Boolean).join("\n\n");
  return {
    summary: summary || null,
    tokensBefore,
  };
}

/** Seed a freshly-created session from the current effective session context. */
export function seedRotatedSession(
  sessionManager: SessionManager,
  context: SessionContext,
  options: {
    sessionName?: string;
    model?: { provider: string; modelId: string } | null;
  }
): void {
  if (options.sessionName?.trim()) {
    sessionManager.appendSessionInfo(options.sessionName.trim());
  }

  if (options.model) {
    sessionManager.appendModelChange(options.model.provider, options.model.modelId);
  }

  const carried = collectCarriedSummary(context.messages);
  if (carried.summary) {
    sessionManager.appendCompaction(carried.summary, "rotated-context", carried.tokensBefore);
  }

  for (const message of context.messages) {
    if (message.role === "compactionSummary" || message.role === "branchSummary") {
      continue;
    }

    if (message.role === "custom") {
      sessionManager.appendCustomMessageEntry(
        message.customType,
        message.content,
        message.display,
        message.details
      );
      continue;
    }

    sessionManager.appendMessage(message as PersistableSessionMessage);
  }
}

async function restoreCancelledRotationSession(
  runtime: AgentSessionRuntime,
  previousSessionFile: string,
): Promise<string | null> {
  const activeSessionFile = runtime.session.sessionFile?.trim();
  if (!activeSessionFile || activeSessionFile === previousSessionFile) {
    return null;
  }

  const result = await runtime.switchSession(previousSessionFile);
  if (result.cancelled) {
    return `Failed to restore previous session after cancellation: ${previousSessionFile}`;
  }

  const restoredSessionFile = runtime.session.sessionFile?.trim();
  if (restoredSessionFile !== previousSessionFile) {
    return `Failed to restore previous session after cancellation: expected ${previousSessionFile} but active session is ${restoredSessionFile || "(none)"}`;
  }

  return null;
}

/** Rotate a persisted session into a newly-seeded successor session file. */
export async function rotateSession(
  session: AgentSession,
  runtime: AgentSessionRuntime,
  options: { instructions?: string; reason?: SessionRotationReason } = {}
): Promise<SessionRotationResult> {
  const reason = options.reason ?? "manual";

  if (session.isStreaming || session.isCompacting || session.isRetrying) {
    return {
      status: "error",
      reason,
      compacted: false,
      message: "Cannot rotate the session while a response, compaction, or retry is active.",
    };
  }

  if (session.pendingMessageCount > 0) {
    return {
      status: "error",
      reason,
      compacted: false,
      message: "Cannot rotate the session while queued steering or follow-up messages are pending.",
    };
  }

  const previousSessionId = session.sessionId;
  const previousSessionFile = session.sessionFile?.trim();
  if (!previousSessionFile) {
    return {
      status: "error",
      reason,
      compacted: false,
      message: "No persisted session file is active yet.",
    };
  }

  if (!existsSync(previousSessionFile)) {
    return {
      status: "error",
      reason,
      compacted: false,
      message: `Current session file does not exist: ${previousSessionFile}`,
    };
  }

  const compactionInstructions = options.instructions?.trim() || ROTATION_COMPACTION_INSTRUCTIONS;
  let compacted = false;
  try {
    await session.compact(compactionInstructions);
    compacted = true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!isRotationFallbackCompactionError(message)) {
      return { status: "error", reason, compacted, message };
    }
  }

  const context = session.sessionManager.buildSessionContext();
  const archivePath = getArchivePath(previousSessionFile);
  const previousSize = getSessionFileSize(previousSessionFile);
  const currentModel = session.model
    ? { provider: session.model.provider, modelId: session.model.id }
    : context.model;
  const currentSessionName = session.sessionName?.trim() || undefined;

  let archived = false;
  try {
    copyFileSync(previousSessionFile, archivePath);
    archived = true;

    const result = await runtime.newSession({
      parentSession: archivePath,
      setup: async (sessionManager) => {
        seedRotatedSession(sessionManager, context, {
          sessionName: currentSessionName,
          model: currentModel,
        });
      },
    });

    if (result.cancelled) {
      if (archived) rmSync(archivePath, { force: true });
      const restoreError = await restoreCancelledRotationSession(runtime, previousSessionFile);
      return {
        status: "error",
        reason,
        compacted,
        message: restoreError ? `Session rotation cancelled. ${restoreError}` : "Session rotation cancelled.",
      };
    }

    closeOpenAICodexWebSocketSessions(previousSessionId);

    const activeSession = runtime.session;
    forcePersistSessionFile(activeSession);
    rmSync(previousSessionFile, { force: true });

    const nextSessionFile = activeSession.sessionFile || "(unavailable)";
    const nextSize = getSessionFileSize(activeSession.sessionFile);
    const summaryCount = collectCarriedSummary(context.messages).summary ? 1 : 0;
    const carriedMessageCount = context.messages.filter(
      (message) => message.role !== "compactionSummary" && message.role !== "branchSummary"
    ).length;

    return {
      status: "success",
      reason,
      compacted,
      archivePath,
      newSessionFile: nextSessionFile,
      previousSize,
      nextSize,
      message: [
        reason === "automatic" ? "Session auto-rotated." : "Session rotated.",
        `Archived previous session: ${archivePath}`,
        `New session: ${nextSessionFile}`,
        `Previous file size: ${previousSize === null ? "unknown" : formatBytes(previousSize)}`,
        `New file size: ${nextSize === null ? "unknown" : formatBytes(nextSize)}`,
        `Continuity seed: ${summaryCount > 0 ? "summary + " : ""}${carriedMessageCount} carried message${carriedMessageCount === 1 ? "" : "s"}`,
        `Compaction before rotate: ${compacted ? "yes" : "no (used current effective context)"}`,
      ].join("\n"),
    };
  } catch (err) {
    if (archived) {
      try {
        rmSync(archivePath, { force: true });
      } catch {
        /* expected: failed rotation cleanup is best-effort because the archive path may already be gone. */
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    return { status: "error", reason, compacted, message };
  }
}
