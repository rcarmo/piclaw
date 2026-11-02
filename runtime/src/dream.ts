import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, writeFileSync } from "fs";
import { join, relative, resolve } from "path";

import type { Zippable } from "fflate";

import type { AgentPool } from "./agent-pool.js";

import { formatRecoverySummary } from "./agent-pool/recovery-summary.js";
import { inspectDailyNoteSummaryBacklog, refreshDailyNotesFromMessages } from "./agent-memory/daily-notes.js";
import { refreshAgentMemoryFromDailyNotes, type RefreshAgentMemoryResult } from "./agent-memory/refresh.js";
import { dreamStartupBackfillRequired, recordDreamConsolidationResult } from "./agent-memory/startup-state.js";
import { AUTO_DREAM_DEFAULT_DAYS, MANUAL_DREAM_DEFAULT_DAYS } from "./dream-defaults.js";
import { DATA_DIR, WORKSPACE_DIR, getDreamConfig } from "./core/config.js";
import { createDreamAccessGuard } from "./core/dream-access.js";
import { getTaskById, createTask, getDb, updateTask } from "./db.js";
import { refreshWorkspaceIndex } from "./workspace-search.js";
import { launchWorkspaceIndexProcess, waitForWorkspaceIndexProcess } from "./workspace-index-process.js";
import { withWorkspaceIndexAuthority } from './core/workspace-index-access.js';
import { markNoteIndexDirty } from "./note-retrieval/coordinator.js";
import { computeNextRun } from "./task-scheduler-utils.js";
import { sanitiseJid } from "./agent-pool/session-paths.js";
import { createLogger, debugSuppressedError } from "./utils/logger.js";

export const DREAM_TASK_ID = "builtin-dream-midnight";
export const DREAM_TASK_KIND = "internal" as const;
export const DREAM_TASK_PROMPT = "dream";
export const DREAM_TASK_CRON = getDreamConfig().cron;

export interface DreamRunResult {
  generated_at: string;
  mode: "manual" | "auto";
  skipped: boolean;
  skip_reason: string | null;
  chat_jid: string;
  days: number;
  daily_notes_refreshed: boolean;
  workspace_index_refreshed: boolean;
  sessions_since_last_consolidation: number | null;
  last_consolidated_at: string | null;
  complete_days: number;
  partial_days: number;
  unsummarised_days: number;
  latest_complete_date: string | null;
  current_state_path: string;
  recent_context_path: string;
  memory_path: string;
  refresh: RefreshAgentMemoryResult | null;
  backup_path: string | null;
}

const DREAM_DAILY_DIR = resolve(WORKSPACE_DIR, "notes/daily");
const DREAM_MEMORY_DIR = resolve(WORKSPACE_DIR, "notes/memory");
const DREAM_BACKUPS_DIR = resolve(DATA_DIR, "dream-backups");
const DREAM_LOCK_PATH = resolve(DREAM_MEMORY_DIR, ".dream.lock");
const DREAM_ALL_CHATS_SCOPE_ANCHOR = "*";
const DREAM_CURRENT_STATE_PATH = resolve(DREAM_MEMORY_DIR, "current-state.md");
const DREAM_RECENT_CONTEXT_PATH = resolve(DREAM_MEMORY_DIR, "recent-context.md");
const DREAM_MEMORY_PATH = resolve(DREAM_MEMORY_DIR, "MEMORY.md");
const log = createLogger("dream");

type FflateModule = typeof import("fflate");

let fflatePromise: Promise<FflateModule> | null = null;

async function loadFflate(): Promise<FflateModule> {
  if (!fflatePromise) {
    fflatePromise = import("fflate");
  }
  return await fflatePromise;
}

export interface DreamAgentTurnResult {
  mode: "manual" | "auto";
  skipped: boolean;
  result: string;
}

function refreshDailyNotes(_chatJid: string, days: number): boolean {
  refreshDailyNotesFromMessages({ chatJid: DREAM_ALL_CHATS_SCOPE_ANCHOR, days });
  return true;
}

function readLastConsolidatedAt(): string | null {
  if (!existsSync(DREAM_CURRENT_STATE_PATH)) return null;
  try {
    const text = readFileSync(DREAM_CURRENT_STATE_PATH, "utf8");
    const match = text.match(/^Generated:\s*(.+)$/m);
    return match?.[1]?.trim() || null;
  } catch (error) {
    debugSuppressedError(log, "failed to read last Dream consolidation timestamp", error, { path: DREAM_CURRENT_STATE_PATH });
    return null;
  }
}

function countSessionsSince(chatJid: string, sinceIso: string | null): number | null {
  if (!sinceIso) return null;
  try {
    const db = getDb();
    if (chatJid === DREAM_ALL_CHATS_SCOPE_ANCHOR || String(chatJid || '').trim().toLowerCase() === 'all') {
      const row = db.query<{ count: number }, any[]>(
        `SELECT COUNT(DISTINCT COALESCE(cb.root_chat_jid, m.chat_jid)) AS count
         FROM messages m
         LEFT JOIN chat_branches cb ON cb.chat_jid = m.chat_jid
         WHERE m.chat_jid NOT LIKE 'dream:%'
           AND m.timestamp > ?`
      ).get(sinceIso);
      return row?.count ?? 0;
    }

    if (chatJid.startsWith("web:")) {
      const row = db.query<{ count: number }, any[]>(
        `SELECT COUNT(DISTINCT COALESCE(cb.root_chat_jid, m.chat_jid)) AS count
         FROM messages m
         LEFT JOIN chat_branches cb ON cb.chat_jid = m.chat_jid
         WHERE m.chat_jid LIKE 'web:%'
           AND m.timestamp > ?`
      ).get(sinceIso);
      return row?.count ?? 0;
    }

    const row = db.query<{ count: number }, any[]>(
      `SELECT COUNT(DISTINCT m.chat_jid) AS count
       FROM messages m
       WHERE m.chat_jid = ?
         AND m.timestamp > ?`
    ).get(chatJid, sinceIso);
    return row?.count ?? 0;
  } catch (error) {
    debugSuppressedError(log, "failed to count sessions since Dream consolidation", error, { chatJid, sinceIso });
    return null;
  }
}

export function parseDreamPromptToken(prompt: string): { matched: boolean; mode: "manual" | "auto"; days: number } {
  const trimmed = (prompt || "").trim().toLowerCase();
  const match = trimmed.match(/^(auto\s+dream|dream)(?:\s+(\d+))?$/i);
  if (!match) return { matched: false, mode: "manual", days: MANUAL_DREAM_DEFAULT_DAYS };
  const mode = match[1].toLowerCase().startsWith("auto") ? "auto" : "manual";
  const fallbackDays = mode === "auto" ? AUTO_DREAM_DEFAULT_DAYS : MANUAL_DREAM_DEFAULT_DAYS;
  const parsedDays = match[2] ? Number.parseInt(match[2], 10) : NaN;
  return {
    matched: true,
    mode,
    days: match[2]
      ? (Number.isFinite(parsedDays) ? Math.max(1, parsedDays) : fallbackDays)
      : fallbackDays,
  };
}

export function hasOutstandingDreamConsolidation(recentDays: number): boolean {
  const backlog = inspectDailyNoteSummaryBacklog({ recentDays });
  return dreamStartupBackfillRequired(WORKSPACE_DIR)
    || backlog.unsummarised > 0
    || backlog.partial > 0
    || backlog.missing_watermark > 0
    || backlog.missing > 0;
}

function hasDailyNoteBacklog(backlog: ReturnType<typeof inspectDailyNoteSummaryBacklog>): boolean {
  return backlog.unsummarised > 0 || backlog.partial > 0 || backlog.missing_watermark > 0 || backlog.missing > 0;
}

function formatDailyNoteBacklogSummary(backlog: ReturnType<typeof inspectDailyNoteSummaryBacklog>): string {
  if (!hasDailyNoteBacklog(backlog)) return "- Unresolved daily-note backlog: none";
  const parts = [
    backlog.unsummarised > 0 ? `${backlog.unsummarised} unsummarised` : null,
    backlog.partial > 0 ? `${backlog.partial} partial` : null,
    backlog.missing_watermark > 0 ? `${backlog.missing_watermark} missing watermark` : null,
    backlog.missing > 0 ? `${backlog.missing} missing daily note${backlog.missing === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(", ");
  return `- Unresolved daily-note backlog: ${parts} (${backlog.dates.join(", ")})`;
}

export function shouldRunAutoDream(
  lastConsolidatedAt: string | null,
  sessionsSinceLast: number | null,
  hasOutstandingConsolidation = false,
): { ok: boolean; reason: string | null } {
  if (!lastConsolidatedAt) return { ok: true, reason: null };
  if (hasOutstandingConsolidation) return { ok: true, reason: null };
  if (sessionsSinceLast === 0) {
    return { ok: false, reason: "No sessions since last consolidation." };
  }
  return { ok: true, reason: null };
}

type DreamLockSnapshot = { dev: bigint; ino: bigint; text: string };
type DreamLockLease = DreamLockSnapshot & { fd: number; released: boolean };
type DreamLockInspection = {
  held: boolean;
  ownerPid: number | null;
  stale: boolean;
  snapshot?: DreamLockSnapshot;
  staleFd?: number;
};

function sameDreamLock(left: DreamLockSnapshot, right: DreamLockSnapshot): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.text === right.text;
}
function readDreamLock(fd: number): DreamLockSnapshot {
  const before = fstatSync(fd, { bigint: true });
  if (!before.isFile() || before.nlink !== 1n || before.size < 1n || before.size > 32n) throw Error("Unverified Dream lock file");
  const buffer = Buffer.alloc(33), length = readSync(fd, buffer, 0, buffer.length, 0);
  const after = fstatSync(fd, { bigint: true }), named = lstatSync(DREAM_LOCK_PATH, { bigint: true });
  if (!named.isFile() || named.nlink !== 1n || before.dev !== named.dev || before.ino !== named.ino ||
    before.size !== BigInt(length) || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs)
    throw Error("Dream lock changed while reading");
  return { dev: before.dev, ino: before.ino, text: buffer.subarray(0, length).toString("utf8") };
}
function openNamedDreamLock(): number {
  const named = lstatSync(DREAM_LOCK_PATH, { bigint: true });
  if (!named.isFile() || named.nlink !== 1n) throw Error("Unverified Dream lock file");
  return openSync(DREAM_LOCK_PATH, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
}
function readNamedDreamLock(): DreamLockSnapshot {
  const fd = openNamedDreamLock();
  try { return readDreamLock(fd); } finally { closeSync(fd); }
}
function inspectDreamLock(): DreamLockInspection {
  let fd: number | undefined, retain = false;
  try {
    fd = openNamedDreamLock();
    const snapshot = readDreamLock(fd), raw = snapshot.text.trim(), pid = Number(raw);
    if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(pid)) return { held: true, ownerPid: null, stale: false };
    if (pid === process.pid) return { held: true, ownerPid: pid, stale: false };
    try { process.kill(pid, 0); return { held: true, ownerPid: pid, stale: false }; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") {
        retain = true; // Keep the observed inode pinned until the acquisition decision.
        return { held: false, ownerPid: pid, stale: true, snapshot, staleFd: fd };
      }
      return { held: true, ownerPid: pid, stale: false }; // EPERM or unknown: no stale-owner proof.
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { held: false, ownerPid: null, stale: false };
    return { held: true, ownerPid: null, stale: false }; // Unreadable/aliased/changing: retain.
  } finally { if (fd !== undefined && !retain) closeSync(fd); }
}
function assertDreamLockCurrent(lease: DreamLockLease): void {
  try {
    if (lease.released || !sameDreamLock(lease, readDreamLock(lease.fd)) || !sameDreamLock(lease, readNamedDreamLock())) throw Error("changed");
  } catch { throw Error("Dream lock ownership changed"); }
}
function removeOwnedDreamLock(lease: DreamLockLease): void {
  try { assertDreamLockCurrent(lease); rmSync(DREAM_LOCK_PATH); }
  catch (error) { debugSuppressedError(log, "Retained a Dream lock no longer bound to this invocation", error, { path: DREAM_LOCK_PATH }); }
}
let activeDreamLock: DreamLockLease | undefined;
let dreamLockExitCleanupRegistered = false;
function onDreamProcessExit(): void { if (activeDreamLock) removeOwnedDreamLock(activeDreamLock); }
function ensureDreamLockExitCleanup(lease: DreamLockLease): void {
  activeDreamLock = lease;
  if (dreamLockExitCleanupRegistered) return;
  dreamLockExitCleanupRegistered = true;
  process.on("exit", onDreamProcessExit);
}
function clearDreamLockExitCleanup(lease: DreamLockLease): void {
  if (activeDreamLock !== lease) return;
  activeDreamLock = undefined;
  if (!dreamLockExitCleanupRegistered) return;
  dreamLockExitCleanupRegistered = false;
  process.off("exit", onDreamProcessExit);
}
function describeDreamLockConflict(ownerPid: number | null): string {
  return ownerPid && Number.isFinite(ownerPid) ? `Dream already running (pid ${ownerPid}).` : "Dream already running.";
}
function acquireDreamLock(): { lease: DreamLockLease | null; busyReason: string | null } {
  mkdirSync(DREAM_MEMORY_DIR, { recursive: true });
  const tryOpen = () => {
    const fd = openSync(DREAM_LOCK_PATH, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      writeFileSync(fd, String(process.pid), "utf8");
      const lease = { ...readDreamLock(fd), fd, released: false };
      ensureDreamLockExitCleanup(lease);
      return lease;
    } catch (error) { closeSync(fd); throw error; } // Preserve an incomplete file; never adopt/overwrite it.
  };
  try { return { lease: tryOpen(), busyReason: null }; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const inspection = inspectDreamLock();
    try {
      if (!inspection.held && inspection.stale && inspection.snapshot && inspection.staleFd !== undefined) {
        try {
          if (!sameDreamLock(inspection.snapshot, readDreamLock(inspection.staleFd)) || !sameDreamLock(inspection.snapshot, readNamedDreamLock()))
            return { lease: null, busyReason: "Dream lock changed during stale-owner inspection." };
        } catch { return { lease: null, busyReason: "Dream lock changed during stale-owner inspection." }; }
        log.warn("Reaping stale Dream lock", { operation: "acquire_dream_lock.reap_stale", path: DREAM_LOCK_PATH, ownerPid: inspection.ownerPid });
        rmSync(DREAM_LOCK_PATH);
        try { return { lease: tryOpen(), busyReason: null }; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      }
      return { lease: null, busyReason: describeDreamLockConflict(inspection.ownerPid) };
    } finally { if (inspection.staleFd !== undefined) closeSync(inspection.staleFd); }
  }
}
function releaseDreamLock(lease: DreamLockLease): void {
  if (lease.released) return;
  try { removeOwnedDreamLock(lease); }
  finally {
    // Keep the descriptor open until after the named binding is checked: an
    // unlinked former inode cannot be recycled into another owner's lock.
    try {
      const current = fstatSync(lease.fd, { bigint: true });
      if (current.dev === lease.dev && current.ino === lease.ino) closeSync(lease.fd);
    } catch (error) { debugSuppressedError(log, "failed to close Dream lock fd", error, { fd: lease.fd, path: DREAM_LOCK_PATH }); }
    lease.released = true;
    clearDreamLockExitCleanup(lease);
  }
}

function getDreamAgentTimeoutMs(): number {
  return getDreamConfig().agentTimeoutMs;
}

async function refreshWorkspaceSearchIndex(checkCurrent?:()=>void): Promise<boolean> {
  try {
    return await withWorkspaceIndexAuthority(checkCurrent??(()=>{}),async()=>{
    checkCurrent?.();await refreshWorkspaceIndex({ scope: "all" });
    checkCurrent?.();
    // Re-check Dream authority through the established index boundary before
    // touching new note-index metadata or launching the private writer.
    await markNoteIndexDirty();
    launchWorkspaceIndexProcess({ scope: "notes" });
    await waitForWorkspaceIndexProcess();checkCurrent?.();
    return true;
    });
  } catch (error) {
    checkCurrent?.();
    debugSuppressedError(log, "failed to refresh workspace search index after Dream", error);
    return false;
  }
}

function addDreamBackupTree(entries: Zippable, sourceDir: string, archiveRoot: string): void {
  if (!existsSync(sourceDir)) return;
  for (const entry of readdirSync(sourceDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absPath = join(sourceDir, entry.name);
    const relPath = `${archiveRoot}/${entry.name}`;
    if (absPath === DREAM_LOCK_PATH) continue;
    if (entry.isDirectory()) {
      addDreamBackupTree(entries, absPath, relPath);
      continue;
    }
    if (!entry.isFile()) continue;
    entries[relPath] = readFileSync(absPath);
  }
}

function pruneOldDreamBackups(): void {
  const entries = readdirSync(DREAM_BACKUPS_DIR).sort().reverse();
  for (const entry of entries.slice(getDreamConfig().backupKeep)) {
    rmSync(join(DREAM_BACKUPS_DIR, entry), { recursive: true, force: true });
  }
}

async function createDreamBackup(chatJid: string, mode: "manual" | "auto", days: number, checkAccess: () => void): Promise<string> {
  mkdirSync(DREAM_BACKUPS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = resolve(DREAM_BACKUPS_DIR, `${stamp}-${mode}-${sanitiseJid(chatJid)}.zip`);
  const manifest = {
    generated_at: new Date().toISOString(),
    mode,
    chat_jid: chatJid,
    days,
    format: "zip",
    sources: {
      daily: existsSync(DREAM_DAILY_DIR) ? relative(WORKSPACE_DIR, DREAM_DAILY_DIR) : null,
      memory: existsSync(DREAM_MEMORY_DIR) ? relative(WORKSPACE_DIR, DREAM_MEMORY_DIR) : null,
    },
  };
  const { strToU8, zipSync } = await loadFflate();
  checkAccess();
  const entries: Zippable = {
    "manifest.json": strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
  };

  addDreamBackupTree(entries, DREAM_DAILY_DIR, "notes/daily");
  addDreamBackupTree(entries, DREAM_MEMORY_DIR, "notes/memory");

  writeFileSync(backupPath, zipSync(entries, { level: 6 }));
  pruneOldDreamBackups();
  return backupPath;
}

export async function runDreamAgentTurn(options: { chatJid: string; days?: number; mode?: "manual" | "auto"; model?: string | null; agentPool: AgentPool; nativeAuthority?:{invocationId:string;assertCurrent():void} }): Promise<DreamAgentTurnResult> {
  const inherited=options.nativeAuthority&&Object.freeze({invocationId:options.nativeAuthority.invocationId,assertCurrent:options.nativeAuthority.assertCurrent.bind(options.nativeAuthority)});
  inherited?.assertCurrent();
  const access = createDreamAccessGuard();
  let lockLease: DreamLockLease | null = null;
  const checkAccess = () => { access(); inherited?.assertCurrent(); if (lockLease) assertDreamLockCurrent(lockLease); };
  const chatJid = options.chatJid;
  const mode = options.mode === "auto" ? "auto" : "manual";
  const days = Number.isFinite(options.days) && Number(options.days) > 0
    ? Math.floor(Number(options.days))
    : (mode === "auto" ? AUTO_DREAM_DEFAULT_DAYS : MANUAL_DREAM_DEFAULT_DAYS);
  const lastConsolidatedAt = readLastConsolidatedAt();
  const sessionsSinceLast = countSessionsSince(DREAM_ALL_CHATS_SCOPE_ANCHOR, lastConsolidatedAt);
  const hasOutstandingConsolidation = hasOutstandingDreamConsolidation(days);

  if (mode === "auto") {
    const gate = shouldRunAutoDream(lastConsolidatedAt, sessionsSinceLast, hasOutstandingConsolidation);
    if (!gate.ok) {
      return {
        mode,
        skipped: true,
        result: formatDreamSummary({
          generated_at: new Date().toISOString(),
          mode,
          skipped: true,
          skip_reason: gate.reason,
          chat_jid: chatJid,
          days,
          daily_notes_refreshed: false,
          workspace_index_refreshed: false,
          sessions_since_last_consolidation: sessionsSinceLast,
          last_consolidated_at: lastConsolidatedAt,
          complete_days: 0,
          partial_days: 0,
          unsummarised_days: 0,
          latest_complete_date: null,
          current_state_path: DREAM_CURRENT_STATE_PATH,
          recent_context_path: DREAM_RECENT_CONTEXT_PATH,
          memory_path: DREAM_MEMORY_PATH,
          refresh: null,
          backup_path: null,
        }),
      };
    }
  }

  if(options.agentPool.isDurableRuntime?.()!==true || typeof options.agentPool.dispatchDreamOperation!=="function")
    throw Error("Native Dream dispatcher unavailable");
  const requestedDreamModel = typeof options.model === "string" && options.model.trim()
    ? options.model.trim()
    : getDreamConfig().model || null;
  const dreamStartTime = Date.now();
  let primaryFailure: { error: unknown } | undefined;
  try {
    const lock = acquireDreamLock();
    if (lock.busyReason) {
      return {
        mode,
        skipped: true,
        result: `${mode === "auto" ? "AutoDream" : "Dream"} skipped: ${lock.busyReason}`,
      };
    }
    lockLease = lock.lease;
    const backupPath = await createDreamBackup(chatJid, mode, days, checkAccess);
    checkAccess();
    const dailyNotesRefreshed = refreshDailyNotes(chatJid, days);
    const execution = await (async () => {
      try {
        const output = await options.agentPool.dispatchDreamOperation({invocationId:inherited?.invocationId??crypto.randomUUID(),chatJid,mode,days,model:requestedDreamModel,timeoutMs:getDreamAgentTimeoutMs(),acceptedAt:new Date().toISOString(),assertCurrent:checkAccess});
        return { ok: true as const, output };
      } catch (error) { return { ok: false as const, error }; }
    })();
    let refresh: RefreshAgentMemoryResult;
    let postBacklog: ReturnType<typeof inspectDailyNoteSummaryBacklog>;
    let workspaceIndexRefreshed: boolean;
    try {
      checkAccess();
      refresh = refreshAgentMemoryFromDailyNotes({ recentDays: days });
      postBacklog = inspectDailyNoteSummaryBacklog({ recentDays: days });
      workspaceIndexRefreshed = await refreshWorkspaceSearchIndex(checkAccess);
      checkAccess();
    } catch (error) {
      if (!execution.ok) throw new AggregateError([execution.error, error], "Dream agent outcome and deterministic refresh failed");
      throw error;
    }
    // A rejected admission/dispatch may be uncertain. Refresh authorised local
    // notes, but never convert its exception into a completed consolidation or
    // an automatic retry with another accepted identity.
    if (!execution.ok) throw execution.error;
    const out = execution.output;
    const recoverySummary = formatRecoverySummary(out.recovery);
    recordDreamConsolidationResult({
      successful: out.status !== "error",
      outstandingBacklog: hasDailyNoteBacklog(postBacklog),
      workspaceRoot: WORKSPACE_DIR,
    });
    const suffix = [
      `- Daily notes refreshed before Dream: ${dailyNotesRefreshed ? "yes" : "no"}`,
      formatDailyNoteBacklogSummary(postBacklog),
      `- Memory refreshed after Dream: yes`,
      `- Updated memory: ${refresh.memoryPath}`,
      `- Updated current state: ${refresh.currentStatePath}`,
      `- Updated recent context: ${refresh.recentContextPath}`,
      `- Pre-Dream backup: ${backupPath || "(none)"}`,
      `- Workspace index refreshed: ${workspaceIndexRefreshed ? "yes" : "no"}`,
      recoverySummary ? `- ${recoverySummary}` : null,
    ].filter(Boolean).join("\n");
    if (hasDailyNoteBacklog(postBacklog)) {
      log.warn("Dream pass left unresolved daily-note backlog", {
        operation: "run_dream_agent_turn.unresolved_daily_notes",
        chatJid,
        mode,
        days,
        backlog: postBacklog,
      });
    }
    if (out.status === "error") {
      log.warn("Dream agent turn failed; keeping deterministic memory refresh", {
        operation: "run_dream_agent_turn.fallback_refresh",
        chatJid,
        mode,
        days,
        error: out.error || "Dream agent run failed.",
        recovery: out.recovery || null,
        unresolvedDailyNotes: postBacklog.dates,
      });
      return {
        mode,
        skipped: false,
        result: [
          `${mode === "auto" ? "AutoDream" : "Dream"} model pass failed; deterministic refresh completed.`,
          `- Model pass error: ${out.error || "Dream agent run failed."}`,
          suffix,
        ].join("\n"),
      };
    }
    return {
      mode,
      skipped: false,
      result: `${(out.result || `${mode === "auto" ? "AutoDream" : "Dream"} complete.`).trimEnd()}\n${suffix}`,
    };
  } catch (error) {
    primaryFailure = { error };
    throw error;
  } finally {
    try {
      checkAccess();
      log.info("Dream maintenance completed", {
        operation: "dream.complete",
        chatJid,
        mode,
        days,
        durationMs: Date.now() - dreamStartTime,
      });
    } catch (error) {
      if (primaryFailure && error !== primaryFailure.error) throw new AggregateError([primaryFailure.error, error], "Dream outcome and cleanup failed");
      throw error;
    } finally {
      // Resource release remains necessary on denial; do not reap chat or memory data.
      if (lockLease !== null) releaseDreamLock(lockLease);
    }
  }
}

export async function runDreamMaintenance(options?: { chatJid?: string; days?: number; mode?: "manual" | "auto" }): Promise<DreamRunResult> {
  const access = createDreamAccessGuard();
  let lockLease: DreamLockLease | null = null;
  const checkAccess = () => { access(); if (lockLease) assertDreamLockCurrent(lockLease); };
  const chatJid = typeof options?.chatJid === "string" && options.chatJid.trim()
    ? options.chatJid.trim()
    : "web:default";
  const mode = options?.mode === "auto" ? "auto" : "manual";
  const days = Number.isFinite(options?.days) && Number(options?.days) > 0
    ? Math.floor(Number(options?.days))
    : (mode === "auto" ? AUTO_DREAM_DEFAULT_DAYS : MANUAL_DREAM_DEFAULT_DAYS);
  const lastConsolidatedAt = readLastConsolidatedAt();
  const sessionsSinceLast = countSessionsSince(DREAM_ALL_CHATS_SCOPE_ANCHOR, lastConsolidatedAt);
  const hasOutstandingConsolidation = hasOutstandingDreamConsolidation(days);

  if (mode === "auto") {
    const gate = shouldRunAutoDream(lastConsolidatedAt, sessionsSinceLast, hasOutstandingConsolidation);
    if (!gate.ok) {
      return {
        generated_at: new Date().toISOString(),
        mode,
        skipped: true,
        skip_reason: gate.reason,
        chat_jid: chatJid,
        days,
        daily_notes_refreshed: false,
        workspace_index_refreshed: false,
        sessions_since_last_consolidation: sessionsSinceLast,
        last_consolidated_at: lastConsolidatedAt,
        complete_days: 0,
        partial_days: 0,
        unsummarised_days: 0,
        latest_complete_date: null,
        current_state_path: DREAM_CURRENT_STATE_PATH,
        recent_context_path: DREAM_RECENT_CONTEXT_PATH,
        memory_path: DREAM_MEMORY_PATH,
        refresh: null,
        backup_path: null,
      };
    }
  }

  try {
    const lock = acquireDreamLock();
    if (lock.busyReason) {
      return {
        generated_at: new Date().toISOString(),
        mode,
        skipped: true,
        skip_reason: lock.busyReason,
        chat_jid: chatJid,
        days,
        daily_notes_refreshed: false,
        workspace_index_refreshed: false,
        sessions_since_last_consolidation: sessionsSinceLast,
        last_consolidated_at: lastConsolidatedAt,
        complete_days: 0,
        partial_days: 0,
        unsummarised_days: 0,
        latest_complete_date: null,
        current_state_path: DREAM_CURRENT_STATE_PATH,
        recent_context_path: DREAM_RECENT_CONTEXT_PATH,
        memory_path: DREAM_MEMORY_PATH,
        refresh: null,
        backup_path: null,
      };
    }
    lockLease = lock.lease;
    const backupPath = await createDreamBackup(chatJid, mode, days, checkAccess);
    checkAccess();
    const dailyNotesRefreshed = refreshDailyNotes(chatJid, days);
    const refresh = refreshAgentMemoryFromDailyNotes({ recentDays: days });
    const workspaceIndexRefreshed = await refreshWorkspaceSearchIndex();
    checkAccess();
    return {
      generated_at: new Date().toISOString(),
      mode,
      skipped: false,
      skip_reason: null,
      chat_jid: chatJid,
      days,
      daily_notes_refreshed: dailyNotesRefreshed,
      workspace_index_refreshed: workspaceIndexRefreshed,
      sessions_since_last_consolidation: sessionsSinceLast,
      last_consolidated_at: lastConsolidatedAt,
      complete_days: refresh.currentState.complete_days.length,
      partial_days: refresh.currentState.partial_days.length,
      unsummarised_days: refresh.currentState.unsummarised_days.length,
      latest_complete_date: refresh.currentState.latest_complete_date,
      current_state_path: refresh.currentStatePath,
      recent_context_path: refresh.recentContextPath,
      memory_path: refresh.memoryPath,
      refresh,
      backup_path: backupPath,
    };
  } finally {
    try { checkAccess(); } finally { if (lockLease !== null) releaseDreamLock(lockLease); }
  }
}

export function formatDreamSummary(result: DreamRunResult): string {
  if (result.skipped) {
    return [
      `${result.mode === "auto" ? "AutoDream" : "Dream"} skipped.`,
      `- Chat anchor: ${result.chat_jid}`,
      `- Window: last ${result.days} days`,
      `- Last consolidated: ${result.last_consolidated_at || "(none)"}`,
      `- Sessions since last consolidation: ${result.sessions_since_last_consolidation ?? "(unknown)"}`,
      `- Reason: ${result.skip_reason || "(none)"}`,
    ].join("\n");
  }

  const lines = [
    `${result.mode === "auto" ? "AutoDream" : "Dream"} complete.`,
    `- Chat anchor: ${result.chat_jid}`,
    `- Window: last ${result.days} days`,
    `- Last consolidated: ${result.last_consolidated_at || "(none)"}`,
    `- Sessions since last consolidation: ${result.sessions_since_last_consolidation ?? "(unknown)"}`,
    `- Daily notes refreshed: ${result.daily_notes_refreshed ? "yes" : "no"}`,
    `- Workspace index refreshed: ${result.workspace_index_refreshed ? "yes" : "no"}`,
    `- Pre-Dream backup: ${result.backup_path || "(none)"}`,
    `- Complete days: ${result.complete_days}`,
    `- Partial days: ${result.partial_days}`,
    `- Unsummarised days: ${result.unsummarised_days}`,
    `- Latest complete day: ${result.latest_complete_date || "(none)"}`,
    "- Updated:",
    `  - ${result.memory_path}`,
    `  - ${result.current_state_path}`,
    `  - ${result.recent_context_path}`,
  ];

  if (result.refresh?.currentState.partial_days.length) {
    lines.push("- Partial days needing follow-up:");
    for (const day of result.refresh.currentState.partial_days.slice(0, 5)) {
      lines.push(`  - ${day.date} (${day.state})`);
    }
  }

  if (result.refresh?.currentState.unsummarised_days.length) {
    lines.push("- Unsummarised days:");
    for (const day of result.refresh.currentState.unsummarised_days.slice(0, 5)) {
      lines.push(`  - ${day.date}`);
    }
  }

  return lines.join("\n");
}

export function ensureDreamTask(chatJid = "web:default") {
  createDreamAccessGuard();
  const existing = getTaskById(DREAM_TASK_ID);
  const dreamConfig = getDreamConfig();
  const nextRun = computeNextRun("cron", dreamConfig.cron);

  if (!existing) {
    createTask({
      id: DREAM_TASK_ID,
      chat_jid: chatJid,
      prompt: DREAM_TASK_PROMPT,
      model: dreamConfig.model || null,
      task_kind: DREAM_TASK_KIND,
      command: null,
      cwd: null,
      timeout_sec: null,
      schedule_type: "cron",
      schedule_value: dreamConfig.cron,
      next_run: nextRun,
      status: "active",
      created_at: new Date().toISOString(),
    });
    return getTaskById(DREAM_TASK_ID);
  }

  const shouldRecomputeNextRun = existing.schedule_type !== "cron"
    || existing.schedule_value !== dreamConfig.cron
    || !existing.next_run;

  updateTask(DREAM_TASK_ID, {
    prompt: DREAM_TASK_PROMPT,
    model: dreamConfig.model || null,
    task_kind: DREAM_TASK_KIND,
    command: null,
    cwd: null,
    timeout_sec: null,
    schedule_type: "cron",
    schedule_value: dreamConfig.cron,
    next_run: shouldRecomputeNextRun ? nextRun : existing.next_run,
    status: "active",
  });

  return getTaskById(DREAM_TASK_ID);
}
