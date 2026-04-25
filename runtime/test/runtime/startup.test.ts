import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  STARTUP_STATUS_CHAT_JID,
  STARTUP_STATUS_TURN_ID,
  buildStartupAgentStatus,
  queueStartupSessionWarmup,
  resolveStartupSessionWarmupOptions,
  runWebStartupRecoveryBootstrap,
} from "../../src/runtime/startup.js";
import { closeDbQuietly, createTempWorkspace, importFresh, setEnv } from "../helpers.js";

const TEST_SHELL = process.env.SHELL || "bash";
const RUNTIME_DIR = join(import.meta.dir, "../..");

describe("runtime startup helpers", () => {
  test("initializeRuntimeEnvironment seeds workspace skel files for direct installs", () => {
    const ws = createTempWorkspace("piclaw-startup-");

    try {
      const run = Bun.spawnSync({
        cmd: [
          TEST_SHELL,
          "-lc",
          "bun -e \"import { initializeRuntimeEnvironment } from './src/runtime/startup.js'; initializeRuntimeEnvironment({ loadTimestamps() {}, loadChats() {} });\"",
        ],
        cwd: RUNTIME_DIR,
        env: {
          ...process.env,
          PICLAW_WORKSPACE: ws.workspace,
          PICLAW_STORE: ws.store,
          PICLAW_DATA: ws.data,
          PICLAW_DB_IN_MEMORY: "1",
          PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX: "1",
        },
      });
      expect(run.exitCode, run.stderr.toString() || run.stdout.toString()).toBe(0);

      expect(existsSync(join(ws.workspace, "AGENTS.md"))).toBe(true);
      expect(existsSync(join(ws.workspace, ".piclaw", "README.md"))).toBe(true);
      expect(existsSync(join(ws.workspace, ".piclaw", "config.json.example"))).toBe(true);
      expect(existsSync(join(ws.workspace, ".mcp.json.example"))).toBe(true);
      expect(existsSync(join(ws.workspace, ".pi", "mcp.json.example"))).toBe(true);
      expect(existsSync(join(ws.workspace, "notes", "index.md"))).toBe(true);
      expect(existsSync(join(ws.workspace, "notes", "memory", "README.md"))).toBe(true);
      expect(existsSync(join(ws.workspace, ".pi", "skills"))).toBe(true);
    } finally {
      ws.cleanup();
    }
  });

  test("initializeRuntimeEnvironment removes orphaned active chat artifacts with empty session dirs", async () => {
    const ws = createTempWorkspace("piclaw-startup-");
    const restoreEnv = setEnv({
      PICLAW_WORKSPACE: ws.workspace,
      PICLAW_STORE: ws.store,
      PICLAW_DATA: ws.data,
      PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX: "1",
    });

    let dbMod: any = null;
    try {
      dbMod = await importFresh("../src/db.js");
      const startupMod = await importFresh<typeof import("../../src/runtime/startup.js")>("../src/runtime/startup.js");
      dbMod.initDatabase();
      const db = dbMod.getDb();
      const now = new Date().toISOString();
      db.prepare("INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)").run("dream:auto:web_default:ghost", "ghost", now);
      db.prepare(
        "INSERT INTO chat_branches (branch_id, chat_jid, root_chat_jid, parent_branch_id, agent_name, created_at, updated_at, archived_at) VALUES (?, ?, ?, NULL, ?, ?, ?, NULL)"
      ).run("branch-ghost", "dream:auto:web_default:ghost", "dream:auto:web_default:ghost", "ghost", now, now);

      const sessionDir = join(ws.data, "sessions", "dream_auto_web_default_ghost");
      mkdirSync(sessionDir, { recursive: true });
      expect(existsSync(sessionDir)).toBe(true);

      startupMod.initializeRuntimeEnvironment({ loadTimestamps() {}, loadChats() {} } as any);

      const remainingChat = db.prepare("SELECT jid FROM chats WHERE jid = ?").get("dream:auto:web_default:ghost");
      const remainingBranch = db.prepare("SELECT chat_jid FROM chat_branches WHERE chat_jid = ?").get("dream:auto:web_default:ghost");
      expect(remainingChat).toBeNull();
      expect(remainingBranch).toBeNull();
    } finally {
      closeDbQuietly(dbMod);
      restoreEnv();
      ws.cleanup();
    }
  });

  test("queueStartupResumePendingIpc writes a resume_pending task", () => {
    const ws = createTempWorkspace("piclaw-startup-");

    try {
      const run = Bun.spawnSync({
        cmd: [
          TEST_SHELL,
          "-lc",
          "bun -e \"import { queueStartupResumePendingIpc } from './src/runtime/startup.js'; queueStartupResumePendingIpc();\"",
        ],
        cwd: RUNTIME_DIR,
        env: {
          ...process.env,
          PICLAW_WORKSPACE: ws.workspace,
          PICLAW_STORE: ws.store,
          PICLAW_DATA: ws.data,
          PICLAW_DB_IN_MEMORY: "1",
          PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX: "1",
        },
      });
      expect(run.exitCode).toBe(0);

      const tasksDir = join(ws.data, "ipc", "tasks");
      const files = readdirSync(tasksDir).filter((file) => file.startsWith("resume_pending_"));
      expect(files).toHaveLength(1);

      const payload = JSON.parse(readFileSync(join(tasksDir, files[0]), "utf-8"));
      expect(payload).toEqual({ type: "resume_pending", chatJid: "all", reason: "startup" });
    } finally {
      ws.cleanup();
    }
  });

  test("captureStartupMemorySnapshot writes a clean startup artifact", () => {
    const ws = createTempWorkspace("piclaw-startup-");

    try {
      const run = Bun.spawnSync({
        cmd: [
          TEST_SHELL,
          "-lc",
          "bun -e \"import { captureStartupMemorySnapshot } from './src/runtime/startup.js'; captureStartupMemorySnapshot({ getMemoryInstrumentationSnapshot() { return { cachedMainSessions: 0, cachedSideSessions: 0, activeForkBaseLeaves: 0, activeChats: 0, sessionManager: { createInFlight: 0, branchSeedRealizationsInFlight: 0, invalidDeferredSeedErrors: 0, prewarmInFlight: 0, queuedPrewarms: 0, prewarmQueueLength: 0, prewarmCooldowns: 0 }, recovery: { attemptsTotal: 0, recoveredRuns: 0, exhaustedRuns: 0 } }; } }, { label: 'post-web-start' });\"",
        ],
        cwd: RUNTIME_DIR,
        env: {
          ...process.env,
          PICLAW_WORKSPACE: ws.workspace,
          PICLAW_STORE: ws.store,
          PICLAW_DATA: ws.data,
          PICLAW_DB_IN_MEMORY: "1",
          PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX: "1",
        },
      });
      expect(run.exitCode, run.stderr.toString() || run.stdout.toString()).toBe(0);

      const snapshotDir = join(ws.data, "startup-memory-snapshots");
      const files = readdirSync(snapshotDir).filter((file) => file.endsWith("_post-web-start.json"));
      expect(files).toHaveLength(1);

      const payload = JSON.parse(readFileSync(join(snapshotDir, files[0]), "utf-8"));
      expect(payload.pid).toBeGreaterThan(0);
      expect(payload.label).toBe("post-web-start");
      expect(payload.snapshot.process_memory.rss_bytes).toBeGreaterThan(0);
      expect(payload.snapshot.runtime_memory).toEqual({
        cached_main_sessions: 0,
        cached_side_sessions: 0,
        active_fork_base_leaves: 0,
        active_chats: 0,
        create_in_flight: 0,
        branch_seed_realizations_in_flight: 0,
        invalid_deferred_seed_errors: 0,
        prewarm_in_flight: 0,
        queued_prewarms: 0,
        prewarm_queue_length: 0,
        prewarm_cooldowns: 0,
        recovery_attempts_total: 0,
        recovery_recovered_runs: 0,
        recovery_exhausted_runs: 0,
      });
    } finally {
      ws.cleanup();
    }
  });

  test("queueStartupResumePendingIpc always queues a fresh startup resume task", () => {
    const ws = createTempWorkspace("piclaw-startup-");

    try {
      const tasksDir = join(ws.data, "ipc", "tasks");
      mkdirSync(tasksDir, { recursive: true });
      writeFileSync(
        join(tasksDir, "resume_pending_existing.json"),
        JSON.stringify({ type: "resume_pending", chatJid: "all", reason: "reload" })
      );

      const run = Bun.spawnSync({
        cmd: [
          TEST_SHELL,
          "-lc",
          "bun -e \"import { queueStartupResumePendingIpc } from './src/runtime/startup.js'; queueStartupResumePendingIpc();\"",
        ],
        cwd: RUNTIME_DIR,
        env: {
          ...process.env,
          PICLAW_WORKSPACE: ws.workspace,
          PICLAW_STORE: ws.store,
          PICLAW_DATA: ws.data,
          PICLAW_DB_IN_MEMORY: "1",
          PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX: "1",
        },
      });
      expect(run.exitCode).toBe(0);

      const files = readdirSync(tasksDir)
        .filter((file) => file.startsWith("resume_pending_"))
        .sort();
      expect(files.length).toBe(2);
      expect(files).toContain("resume_pending_existing.json");
      expect(files.some((file) => file !== "resume_pending_existing.json")).toBe(true);
    } finally {
      ws.cleanup();
    }
  });

  test("buildStartupAgentStatus emits startup intent metadata for the web UI", () => {
    const status = buildStartupAgentStatus({
      phase: "recovering_inflight",
      detail: "Restoring runtime state and recovering interrupted chats.",
      startedAt: "2026-04-24T13:40:00.000Z",
    });

    expect(status).toMatchObject({
      type: "intent",
      kind: "info",
      intent_key: "startup",
      source: "startup",
      phase: "recovering_inflight",
      title: "Starting up…",
      detail: "Restoring runtime state and recovering interrupted chats.",
      blocking: true,
      started_at: "2026-04-24T13:40:00.000Z",
      turn_id: STARTUP_STATUS_TURN_ID,
    });
    expect(typeof status.last_event_at).toBe("string");
  });

  test("runWebStartupRecoveryBootstrap exposes startup phases and clears them when ready", () => {
    const events: Array<{ kind: string; chatJid?: string; status?: Record<string, unknown> }> = [];

    runWebStartupRecoveryBootstrap({
      updateAgentStatus: (chatJid, status) => {
        events.push({ kind: "status", chatJid, status });
      },
      recoverInflightRuns: () => {
        events.push({ kind: "recover" });
      },
      resumePendingChats: () => {
        events.push({ kind: "resume" });
      },
    });

    expect(events).toHaveLength(5);
    expect(events[0]).toMatchObject({
      kind: "status",
      chatJid: STARTUP_STATUS_CHAT_JID,
      status: {
        type: "intent",
        intent_key: "startup",
        phase: "recovering_inflight",
        turn_id: STARTUP_STATUS_TURN_ID,
      },
    });
    expect(events[1]).toEqual({ kind: "recover" });
    expect(events[2]).toMatchObject({
      kind: "status",
      chatJid: STARTUP_STATUS_CHAT_JID,
      status: {
        type: "intent",
        intent_key: "startup",
        phase: "resuming_pending",
        turn_id: STARTUP_STATUS_TURN_ID,
      },
    });
    expect(events[3]).toEqual({ kind: "resume" });
    expect(events[4]).toMatchObject({
      kind: "status",
      chatJid: STARTUP_STATUS_CHAT_JID,
      status: {
        type: "done",
        source: "startup",
        turn_id: STARTUP_STATUS_TURN_ID,
        title: "Startup ready",
      },
    });
  });

  test("queueStartupSessionWarmup is disabled by default", () => {
    const scheduled: Array<{ chatJid: string; priority?: boolean }> = [];
    const recentCalls: Array<{ limit?: number; excludeChatJids?: string[] }> = [];

    queueStartupSessionWarmup({
      scheduleChatWarmup: (chatJid: string, options?: { priority?: boolean }) => {
        scheduled.push({ chatJid, priority: options?.priority });
        return true;
      },
      scheduleRecentChatWarmup: (options?: { limit?: number; excludeChatJids?: string[] }) => {
        recentCalls.push(options || {});
        return [];
      },
    } as any);

    expect(scheduled).toEqual([]);
    expect(recentCalls).toEqual([]);
  });

  test("queueStartupSessionWarmup can explicitly warm the default chat and recent chats", () => {
    const scheduled: Array<{ chatJid: string; priority?: boolean }> = [];
    const recentCalls: Array<{ limit?: number; excludeChatJids?: string[] }> = [];

    queueStartupSessionWarmup({
      scheduleChatWarmup: (chatJid: string, options?: { priority?: boolean }) => {
        scheduled.push({ chatJid, priority: options?.priority });
        return true;
      },
      scheduleRecentChatWarmup: (options?: { limit?: number; excludeChatJids?: string[] }) => {
        recentCalls.push(options || {});
        return [];
      },
    } as any, { warmDefaultChat: true, recentLimit: 5 });

    expect(scheduled).toEqual([{ chatJid: "web:default", priority: true }]);
    expect(recentCalls).toEqual([{ limit: 5, excludeChatJids: ["web:default"] }]);
  });

  test("resolveStartupSessionWarmupOptions reads env-backed warmup controls", () => {
    expect(resolveStartupSessionWarmupOptions({
      PICLAW_STARTUP_WARM_DEFAULT_CHAT: "true",
      PICLAW_STARTUP_WARMUP_RECENT_LIMIT: "3",
    } as NodeJS.ProcessEnv)).toEqual({
      warmDefaultChat: true,
      recentLimit: 3,
    });

    expect(resolveStartupSessionWarmupOptions({
      PICLAW_STARTUP_WARM_DEFAULT_CHAT: "off",
      PICLAW_STARTUP_WARMUP_RECENT_LIMIT: "99",
    } as NodeJS.ProcessEnv)).toEqual({
      warmDefaultChat: false,
      recentLimit: 8,
    });
  });
});
