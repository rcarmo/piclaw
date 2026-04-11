import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { join, relative, resolve } from "path";

import { strToU8, zipSync, type Zippable } from "fflate";

import type { AgentPool } from "./agent-pool.js";

import { buildDreamPrompt } from "./agent-memory/dream-prompt.js";
import { inspectDailyNoteSummaryBacklog, refreshDailyNotesFromMessages } from "./agent-memory/daily-notes.js";
import { refreshAgentMemoryFromDailyNotes, type RefreshAgentMemoryResult } from "./agent-memory/refresh.js";
import { AUTO_DREAM_DEFAULT_DAYS, MANUAL_DREAM_DEFAULT_DAYS } from "./dream-defaults.js";
import { DATA_DIR, SESSIONS_DIR, WORKSPACE_DIR } from "./core/config.js";
import { getTaskById, createTask, getDb, updateTask } from "./db.js";
import { refreshWorkspaceIndex } from "./workspace-search.js";
import { computeNextRun } from "./task-scheduler-utils.js";
import { sanitiseJid } from "./agent-pool/session.js";

export const DREAM_TASK_ID = "builtin-dream-midnight";
export const DREAM_TASK_KIND = "internal" as const;
export const DREAM_TASK_PROMPT = "dream";
export const DREAM_TASK_CRON = "0 0 * * *";

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
const DREAM_BACKUP_KEEP = Math.max(1, Number.parseInt(process.env.PICLAW_DREAM_BACKUP_KEEP || "10", 10) || 10);
const DREAM_MODEL = process.env.PICLAW_DREAM_MODEL?.trim() || null;

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
  } catch {
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
  } catch {
    return null;
  }
}

export function parseDreamPromptToken(prompt: string): { matched: boolean; mode: "manual" | "auto"; days: number } {
  const trimmed = (prompt || "").trim().toLowerCase();
  const match = trimmed.match(/^(auto\s+dream|dream)(?:\s+(\d+))?$/i);
  if (!match) return { matched: false, mode: "manual", days: MANUAL_DREAM_DEFAULT_DAYS };
  const mode = match[1].toLowerCase().startsWith("auto") ? "auto" : "manual";
  const fallbackDays = mode === "auto" ? AUTO_DREAM_DEFAULT_DAYS : MANUAL_DREAM_DEFAULT_DAYS;
  return {
    matched: true,
    mode,
    days: match[2] ? Math.max(1, Number.parseInt(match[2], 10) || fallbackDays) : fallbackDays,
  };
}

export function hasOutstandingDreamConsolidation(recentDays: number): boolean {
  const backlog = inspectDailyNoteSummaryBacklog({ recentDays });
  return backlog.unsummarised > 0 || backlog.partial > 0 || backlog.missing_watermark > 0;
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

function buildDreamChatJid(chatJid: string, mode: "manual" | "auto"): string {
  return `dream:${mode}:${sanitiseJid(chatJid)}:${Date.now()}`;
}

async function cleanupDreamChat(agentPool: AgentPool, dreamChatJid: string): Promise<void> {
  try {
    await agentPool.disposeChatSession(dreamChatJid);
  } catch {
    /* ignore */
  }

  try {
    const db = getDb();
    db.prepare("DELETE FROM message_media WHERE message_rowid IN (SELECT rowid FROM messages WHERE chat_jid = ?)").run(dreamChatJid);
    db.prepare("DELETE FROM messages WHERE chat_jid = ?").run(dreamChatJid);
    db.prepare("DELETE FROM chat_branches WHERE chat_jid = ?").run(dreamChatJid);
    db.prepare("DELETE FROM chats WHERE jid = ?").run(dreamChatJid);
  } catch {
    /* ignore */
  }

  rmSync(join(SESSIONS_DIR, sanitiseJid(dreamChatJid)), { recursive: true, force: true });
  rmSync(join(SESSIONS_DIR, `${sanitiseJid(dreamChatJid)}__btw-side`), { recursive: true, force: true });
}

function canReapDreamLock(): boolean {
  if (!existsSync(DREAM_LOCK_PATH)) return false;
  try {
    const raw = readFileSync(DREAM_LOCK_PATH, "utf8").trim();
    const pid = Number.parseInt(raw, 10);
    if (!Number.isFinite(pid) || pid <= 0) return true;
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  } catch {
    return true;
  }
}

function acquireDreamLock(): number {
  mkdirSync(DREAM_MEMORY_DIR, { recursive: true });
  try {
    const fd = openSync(DREAM_LOCK_PATH, "wx");
    writeFileSync(DREAM_LOCK_PATH, String(process.pid), "utf8");
    return fd;
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String((error as any).code) : "";
    if (code === "EEXIST" && canReapDreamLock()) {
      rmSync(DREAM_LOCK_PATH, { force: true });
      const fd = openSync(DREAM_LOCK_PATH, "wx");
      writeFileSync(DREAM_LOCK_PATH, String(process.pid), "utf8");
      return fd;
    }
    throw error;
  }
}

function releaseDreamLock(fd: number): void {
  try { closeSync(fd); } catch { /* ignore */ }
  try { rmSync(DREAM_LOCK_PATH, { force: true }); } catch { /* ignore */ }
}

async function refreshWorkspaceSearchIndex(): Promise<boolean> {
  try {
    await refreshWorkspaceIndex({ scope: "all" });
    return true;
  } catch {
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
  for (const entry of entries.slice(DREAM_BACKUP_KEEP)) {
    rmSync(join(DREAM_BACKUPS_DIR, entry), { recursive: true, force: true });
  }
}

function createDreamBackup(chatJid: string, mode: "manual" | "auto", days: number): string {
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
  const entries: Zippable = {
    "manifest.json": strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
  };

  addDreamBackupTree(entries, DREAM_DAILY_DIR, "notes/daily");
  addDreamBackupTree(entries, DREAM_MEMORY_DIR, "notes/memory");

  writeFileSync(backupPath, zipSync(entries, { level: 6 }));
  pruneOldDreamBackups();
  return backupPath;
}

export async function runDreamAgentTurn(options: { chatJid: string; days?: number; mode?: "manual" | "auto"; agentPool: AgentPool }): Promise<DreamAgentTurnResult> {
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

  let lockFd: number | null = null;
  const dreamChatJid = buildDreamChatJid(chatJid, mode);
  try {
    lockFd = acquireDreamLock();
    const backupPath = createDreamBackup(chatJid, mode, days);
    const dailyNotesRefreshed = refreshDailyNotes(chatJid, days);
    const out = await options.agentPool.runAgent(buildDreamPrompt({ mode, days }), dreamChatJid);
    if (out.status === "error") {
      throw new Error(out.error || "Dream agent run failed.");
    }
    const refresh = refreshAgentMemoryFromDailyNotes({ recentDays: days });
    const workspaceIndexRefreshed = await refreshWorkspaceSearchIndex();
    const suffix = [
      `- Daily notes refreshed before Dream: ${dailyNotesRefreshed ? "yes" : "no"}`,
      `- Memory refreshed after Dream: yes`,
      `- Updated memory: ${refresh.memoryPath}`,
      `- Updated current state: ${refresh.currentStatePath}`,
      `- Updated recent context: ${refresh.recentContextPath}`,
      `- Pre-Dream backup: ${backupPath || "(none)"}`,
      `- Workspace index refreshed: ${workspaceIndexRefreshed ? "yes" : "no"}`,
    ].join("\n");
    return {
      mode,
      skipped: false,
      result: `${(out.result || `${mode === "auto" ? "AutoDream" : "Dream"} complete.`).trimEnd()}\n${suffix}`,
    };
  } finally {
    if (lockFd !== null) releaseDreamLock(lockFd);
    await cleanupDreamChat(options.agentPool, dreamChatJid);
  }
}

export async function runDreamMaintenance(options?: { chatJid?: string; days?: number; mode?: "manual" | "auto" }): Promise<DreamRunResult> {
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

  let lockFd: number | null = null;
  try {
    lockFd = acquireDreamLock();
    const backupPath = createDreamBackup(chatJid, mode, days);
    const dailyNotesRefreshed = refreshDailyNotes(chatJid, days);
    const refresh = refreshAgentMemoryFromDailyNotes({ recentDays: days });
    const workspaceIndexRefreshed = await refreshWorkspaceSearchIndex();
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
    if (lockFd !== null) releaseDreamLock(lockFd);
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
  const existing = getTaskById(DREAM_TASK_ID);
  const nextRun = computeNextRun("cron", DREAM_TASK_CRON);

  if (!existing) {
    createTask({
      id: DREAM_TASK_ID,
      chat_jid: chatJid,
      prompt: DREAM_TASK_PROMPT,
      model: DREAM_MODEL,
      task_kind: DREAM_TASK_KIND,
      command: null,
      cwd: null,
      timeout_sec: null,
      schedule_type: "cron",
      schedule_value: DREAM_TASK_CRON,
      next_run: nextRun,
      status: "active",
      created_at: new Date().toISOString(),
    });
    return getTaskById(DREAM_TASK_ID);
  }

  const shouldRecomputeNextRun = existing.schedule_type !== "cron"
    || existing.schedule_value !== DREAM_TASK_CRON
    || !existing.next_run;

  updateTask(DREAM_TASK_ID, {
    prompt: DREAM_TASK_PROMPT,
    model: DREAM_MODEL,
    task_kind: DREAM_TASK_KIND,
    command: null,
    cwd: null,
    timeout_sec: null,
    schedule_type: "cron",
    schedule_value: DREAM_TASK_CRON,
    next_run: shouldRecomputeNextRun ? nextRun : existing.next_run,
    status: "active",
  });

  return getTaskById(DREAM_TASK_ID);
}
