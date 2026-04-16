/**
 * agent-pool/branch-seeding.ts – Deferred branch seed persistence and replay.
 *
 * Lets branch creation stay lightweight by persisting enough fork context to
 * seed the target session later, either on first use or during background
 * prewarm.
 */

import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { ImageContent, Message, TextContent } from "@mariozechner/pi-ai";
import type { AgentSession, SessionContext, SessionEntry, SessionManager } from "@mariozechner/pi-coding-agent";

import { seedRotatedSession } from "../session-rotation.js";
import { ensureSessionDir } from "./session.js";

type LegacyCustomEntry = {
  type: "custom_entry";
  id?: string;
  customType: string;
  data?: unknown;
};

export type SeedBranchEntry = SessionEntry | LegacyCustomEntry;

export interface DeferredBranchSeed {
  version: 1;
  parentSession: string | null;
  sessionName: string | null;
  model: { provider: string; modelId: string } | null;
  thinkingLevel: ThinkingLevel | null;
  mode: "stable_branch" | "rotated_context";
  branchEntries?: SeedBranchEntry[];
  context?: SessionContext;
}

type AppendableAgentMessage = Message | {
  role: "bashExecution";
  command: string;
  output: string;
  exitCode: number | undefined;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath?: string;
  timestamp: number;
  excludeFromContext?: boolean;
} | {
  role: "custom";
  customType: string;
  content: string | (TextContent | ImageContent)[];
  display: boolean;
  details?: unknown;
  timestamp: number;
};

type SeedSessionManager = Pick<
  SessionManager,
  | "appendMessage"
  | "appendThinkingLevelChange"
  | "appendModelChange"
  | "appendCompaction"
  | "appendSessionInfo"
  | "appendCustomMessageEntry"
  | "appendCustomEntry"
>;

const DEFERRED_BRANCH_SEED_FILE = ".branch-seed.json";
const CLAIMED_DEFERRED_BRANCH_SEED_FILE = ".branch-seed.claimed.json";

function createInvalidDeferredBranchSeedError(chatJid: string, reason: string, cause?: unknown): Error {
  return new Error(`Invalid deferred branch seed for ${chatJid}: ${reason}`, cause ? { cause } : undefined);
}

export function normalizeThinkingLevel(value: string | null | undefined): ThinkingLevel | null {
  return value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh"
    ? value
    : null;
}

function isAppendableAgentMessage(message: unknown): message is AppendableAgentMessage {
  if (!message || typeof message !== "object") return false;
  const role = (message as { role?: unknown }).role;
  return role === "user"
    || role === "assistant"
    || role === "system"
    || role === "tool"
    || role === "bashExecution"
    || role === "custom";
}

function getStableForkSeed(sourceSession: AgentSession, stableLeafId: string | null): {
  branchEntries: SeedBranchEntry[];
  model: { provider: string; modelId: string } | null;
  thinkingLevel: ThinkingLevel | null;
} {
  const branchEntries = stableLeafId === null
    ? []
    : (typeof sourceSession.sessionManager?.getBranch === "function"
        ? sourceSession.sessionManager.getBranch(stableLeafId)
        : []);

  let model: { provider: string; modelId: string } | null = null;
  let thinkingLevel: ThinkingLevel | null = null;

  for (const entry of branchEntries) {
    if (entry?.type === "model_change" && typeof entry.provider === "string" && typeof entry.modelId === "string") {
      model = { provider: entry.provider, modelId: entry.modelId };
    } else if (entry?.type === "thinking_level_change" && typeof entry.thinkingLevel === "string") {
      thinkingLevel = normalizeThinkingLevel(entry.thinkingLevel);
    } else if (entry?.type === "message" && entry.message?.role === "assistant" && typeof entry.message?.provider === "string" && typeof entry.message?.model === "string") {
      model = { provider: entry.message.provider, modelId: entry.message.model };
    }
  }

  return { branchEntries, model, thinkingLevel };
}

function cloneSeedValue<T>(value: T): T {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createDeferredBranchSeed(
  sourceSession: AgentSession,
  options: { stableLeafId: string | null; sessionName?: string | null; sourceIsActive: boolean },
): DeferredBranchSeed {
  const stableSeed = options.sourceIsActive
    ? getStableForkSeed(sourceSession, options.stableLeafId)
    : null;
  const sourceContext = stableSeed
    ? null
    : sourceSession.sessionManager.buildSessionContext();
  const model = stableSeed?.model || sourceContext?.model || (sourceSession.model
    ? { provider: sourceSession.model.provider, modelId: sourceSession.model.id }
    : null);
  const thinkingLevel = normalizeThinkingLevel(
    stableSeed?.thinkingLevel || sourceContext?.thinkingLevel || sourceSession.thinkingLevel,
  );

  return {
    version: 1,
    parentSession: sourceSession.sessionFile?.trim() || null,
    sessionName: options.sessionName?.trim() || null,
    model,
    thinkingLevel,
    mode: stableSeed ? "stable_branch" : "rotated_context",
    ...(stableSeed ? { branchEntries: cloneSeedValue(stableSeed.branchEntries) } : { context: cloneSeedValue(sourceContext ?? undefined) }),
  };
}

function seedSessionManagerFromBranchEntries(
  sessionManager: SeedSessionManager,
  branchEntries: SeedBranchEntry[],
  fallback: { sessionName?: string | null; model?: { provider: string; modelId: string } | null },
): void {
  if (!Array.isArray(branchEntries) || branchEntries.length === 0) {
    if (fallback.sessionName?.trim()) {
      sessionManager.appendSessionInfo(fallback.sessionName.trim());
    }
    if (fallback.model) {
      sessionManager.appendModelChange(fallback.model.provider, fallback.model.modelId);
    }
    return;
  }

  const sourceToNewId = new Map<string, string>();
  for (const entry of branchEntries) {
    let newId: string | null = null;
    if (entry?.type === "message" && isAppendableAgentMessage(entry.message)) {
      newId = sessionManager.appendMessage(entry.message);
    } else if (entry?.type === "thinking_level_change" && typeof entry.thinkingLevel === "string") {
      newId = sessionManager.appendThinkingLevelChange(entry.thinkingLevel);
    } else if (entry?.type === "model_change" && typeof entry.provider === "string" && typeof entry.modelId === "string") {
      newId = sessionManager.appendModelChange(entry.provider, entry.modelId);
    } else if (entry?.type === "compaction" && typeof entry.summary === "string") {
      const firstKeptEntryId = sourceToNewId.get(entry.firstKeptEntryId)
        ?? sourceToNewId.get(branchEntries[0]?.id ?? "")
        ?? "rotated-context";
      newId = sessionManager.appendCompaction(entry.summary, firstKeptEntryId, entry.tokensBefore ?? 0, entry.details, entry.fromHook);
    } else if (entry?.type === "session_info" && typeof entry.name === "string" && entry.name.trim()) {
      newId = sessionManager.appendSessionInfo(entry.name.trim());
    } else if (entry?.type === "custom_message" && typeof entry.customType === "string") {
      newId = sessionManager.appendCustomMessageEntry(entry.customType, entry.content, entry.display, entry.details);
    } else if (entry?.type === "custom_entry" && typeof entry.customType === "string") {
      newId = sessionManager.appendCustomEntry(entry.customType, entry.data);
    }

    if (entry?.id && newId) {
      sourceToNewId.set(entry.id, newId);
    }
  }
}

export function seedSessionManagerFromDeferredBranchSeed(
  sessionManager: SeedSessionManager,
  seed: DeferredBranchSeed,
): void {
  if (seed.mode === "stable_branch") {
    seedSessionManagerFromBranchEntries(sessionManager, seed.branchEntries ?? [], {
      sessionName: seed.sessionName,
      model: seed.model,
    });
    return;
  }

  if (seed.context) {
    seedRotatedSession(sessionManager as SessionManager, seed.context, {
      sessionName: seed.sessionName || undefined,
      model: seed.model,
    });
    return;
  }

  if (seed.sessionName?.trim()) {
    sessionManager.appendSessionInfo(seed.sessionName.trim());
  }
  if (seed.model) {
    sessionManager.appendModelChange(seed.model.provider, seed.model.modelId);
  }
}

function getDeferredBranchSeedPath(chatJid: string): string {
  return join(ensureSessionDir(chatJid), DEFERRED_BRANCH_SEED_FILE);
}

function getClaimedDeferredBranchSeedPath(chatJid: string): string {
  return join(ensureSessionDir(chatJid), CLAIMED_DEFERRED_BRANCH_SEED_FILE);
}

function readDeferredBranchSeedFromPath(chatJid: string, path: string): DeferredBranchSeed | null {
  if (!existsSync(path)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw createInvalidDeferredBranchSeedError(chatJid, "malformed JSON", error);
  }

  if (!parsed || typeof parsed !== "object") {
    throw createInvalidDeferredBranchSeedError(chatJid, "seed payload must be an object");
  }

  const seed = parsed as Partial<DeferredBranchSeed>;
  if (seed.version !== 1) {
    throw createInvalidDeferredBranchSeedError(chatJid, "unsupported version");
  }
  if (seed.mode !== "stable_branch" && seed.mode !== "rotated_context") {
    throw createInvalidDeferredBranchSeedError(chatJid, "unsupported seed mode");
  }
  return seed as DeferredBranchSeed;
}

function getExistingDeferredBranchSeedPath(chatJid: string): string | null {
  const primaryPath = getDeferredBranchSeedPath(chatJid);
  if (existsSync(primaryPath)) return primaryPath;
  const claimedPath = getClaimedDeferredBranchSeedPath(chatJid);
  return existsSync(claimedPath) ? claimedPath : null;
}

export function hasDeferredBranchSeed(chatJid: string): boolean {
  return getExistingDeferredBranchSeedPath(chatJid) !== null;
}

export function getDeferredBranchSeedFingerprint(chatJid: string): string | null {
  const path = getExistingDeferredBranchSeedPath(chatJid);
  if (!path) return null;
  try {
    const stat = statSync(path);
    return `${path}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return null;
  }
}

export function writeDeferredBranchSeed(chatJid: string, seed: DeferredBranchSeed): void {
  const targetPath = getDeferredBranchSeedPath(chatJid);
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tempPath, JSON.stringify(seed), "utf8");
    renameSync(tempPath, targetPath);
    rmSync(getClaimedDeferredBranchSeedPath(chatJid), { force: true });
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

export function readDeferredBranchSeed(chatJid: string): DeferredBranchSeed | null {
  const path = getExistingDeferredBranchSeedPath(chatJid);
  if (!path) return null;
  return readDeferredBranchSeedFromPath(chatJid, path);
}

export function claimDeferredBranchSeed(chatJid: string): DeferredBranchSeed | null {
  const primaryPath = getDeferredBranchSeedPath(chatJid);
  const claimedPath = getClaimedDeferredBranchSeedPath(chatJid);
  if (existsSync(primaryPath)) {
    renameSync(primaryPath, claimedPath);
  }
  if (!existsSync(claimedPath)) return null;
  return readDeferredBranchSeedFromPath(chatJid, claimedPath);
}

export function restoreClaimedDeferredBranchSeed(chatJid: string): void {
  const primaryPath = getDeferredBranchSeedPath(chatJid);
  const claimedPath = getClaimedDeferredBranchSeedPath(chatJid);
  if (!existsSync(claimedPath)) return;
  if (existsSync(primaryPath)) {
    rmSync(claimedPath, { force: true });
    return;
  }
  renameSync(claimedPath, primaryPath);
}

export function finalizeClaimedDeferredBranchSeed(chatJid: string): void {
  rmSync(getClaimedDeferredBranchSeedPath(chatJid), { force: true });
}

export function clearDeferredBranchSeed(chatJid: string): void {
  rmSync(getDeferredBranchSeedPath(chatJid), { force: true });
  rmSync(getClaimedDeferredBranchSeedPath(chatJid), { force: true });
}
