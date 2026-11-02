import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { closeDbQuietly, createTempWorkspace, importFresh, setEnv, withTempWorkspaceEnv } from "../helpers.js";
import {
  STARTUP_STATUS_CHAT_JID,
  STARTUP_STATUS_TURN_ID,
  buildStartupAgentStatus,
  initializeWebAddonMessagingRuntime,
  runWebStartupRecoveryBootstrap,
} from "../../src/runtime/startup.js";
import { getChatTransport } from "../../src/extensions/chat-transport-registry.js";
import { resetAddonRuntimeContributionsForTests } from "../../src/addons/runtime-contributions.js";

const TEST_SHELL = process.env.SHELL || "bash";
const RUNTIME_DIR = join(import.meta.dir, "../..");

setDefaultTimeout(10_000);

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

  test("initializeRuntimeEnvironment installs the add-on runtime API before sessions are created", () => {
    const ws = createTempWorkspace("piclaw-startup-addon-runtime-");

    try {
      const run = Bun.spawnSync({
        cmd: [
          TEST_SHELL,
          "-lc",
          [
            "bun -e ",
            JSON.stringify([
              "import { resetAddonRuntimeContributionsForTests } from './src/addons/runtime-contributions.js';",
              "import { initializeRuntimeEnvironment } from './src/runtime/startup.js';",
              "resetAddonRuntimeContributionsForTests();",
              "if (globalThis.__piclaw_runtime) throw new Error('runtime preinstalled');",
              "initializeRuntimeEnvironment({ loadTimestamps() {}, loadChats() {} });",
              "if (!globalThis.__piclaw_runtime?.registerStatusPanelProvider) throw new Error('runtime missing after startup');",
            ].join(" ")),
          ].join(""),
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
    } finally {
      ws.cleanup();
    }
  });

  test("initializeWebAddonMessagingRuntime wires handlers before startup entry imports", async () => {
    const ws = createTempWorkspace("piclaw-startup-messaging-");
    const restoreEnv = setEnv({
      PICLAW_WORKSPACE: ws.workspace,
      PICLAW_STORE: ws.store,
      PICLAW_DATA: ws.data,
    });
    resetAddonRuntimeContributionsForTests();
    try {
      const addonDir = join(ws.workspace, ".pi", "extensions", "node_modules", "piclaw-addon-startup-messaging");
      mkdirSync(addonDir, { recursive: true });
      writeFileSync(join(addonDir, "package.json"), JSON.stringify({
        name: "piclaw-addon-startup-messaging",
        type: "module",
        pi: { runtime: { entries: ["runtime.ts"], load: "startup" } },
      }));
      writeFileSync(join(addonDir, "runtime.ts"), `
const api = globalThis.__piclaw_runtime;
globalThis.__piclaw_startup_messaging_agents = await api.messaging.listAdvertisableAgents();
api.messaging.registerChatTransport({
  id: "startup-messaging",
  kind: "bang",
  async send(request) { return { status: "ok", source_chat_jid: request.source_chat_jid }; },
});
export {};
`);

      const enqueued: unknown[] = [];
      await initializeWebAddonMessagingRuntime({
        listKnownChats: () => [{ chat_jid: "web:research", agent_name: "research", is_active: true }],
        findChatByAgentName: (name: string) => name === "research" ? { chat_jid: "web:research", agent_name: "research" } : null,
      } as any, {
        enqueueAgentMessage: async (request: unknown) => {
          enqueued.push(request);
          return { status: "ok", chat_jid: "web:research", row_id: 1, thread_id: 1, created: true };
        },
      } as any);

      expect((globalThis as any).__piclaw_startup_messaging_agents).toEqual([{ agent_name: "research", active: true }]);
      expect(getChatTransport("bang")?.id).toBe("startup-messaging");
      const runtimeApi = (globalThis as any).__piclaw_runtime;
      await runtimeApi.messaging.deliverPeerMessage({
        target_agent_name: "research",
        content: "hello",
        source: {
          peer_instance_id: "peerInstance_1234567890",
          peer_fingerprint: "abc123-def456-ghi789",
          message_id: "rmsg_1",
        },
      });
      expect(enqueued).toHaveLength(1);
    } finally {
      delete (globalThis as any).__piclaw_startup_messaging_agents;
      resetAddonRuntimeContributionsForTests();
      restoreEnv();
      ws.cleanup();
    }
  });

  test("initializeRuntimeEnvironment can seed workspace files from a packaged skel directory", () => {
    const ws = createTempWorkspace("piclaw-startup-");
    const skelDir = join(ws.base, "packaged-skel");
    mkdirSync(skelDir, { recursive: true });
    writeFileSync(join(skelDir, "AGENTS.md"), "# Packaged desktop instructions\n");

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
          PICLAW_SKEL_DIR: skelDir,
          PICLAW_DB_IN_MEMORY: "1",
          PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX: "1",
        },
      });
      expect(run.exitCode, run.stderr.toString() || run.stdout.toString()).toBe(0);

      expect(readFileSync(join(ws.workspace, "AGENTS.md"), "utf8")).toBe("# Packaged desktop instructions\n");
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
      const { stopToolOutputCleanup } = await import("../../src/tool-output.js");
      stopToolOutputCleanup();
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
        session_entries: 0,
        active_messages: 0,
        persisted_session_bytes: 0,
        loaded_skills: 0,
        loaded_extensions: 0,
        registered_tools: 0,
        create_in_flight: 0,
        branch_seed_realizations_in_flight: 0,
        invalid_deferred_seed_errors: 0,
        prewarm_in_flight: 0,
        queued_prewarms: 0,
        prewarm_queue_length: 0,
        prewarm_cooldowns: 0,
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

  test("runWebStartupRecoveryBootstrap exposes startup phases and clears them when ready", async () => {
    const events: Array<{ kind: string; chatJid?: string; status?: Record<string, unknown> }> = [];

    let resumePending: (() => void) | null = null;
    runWebStartupRecoveryBootstrap({
      updateAgentStatus: (chatJid, status) => {
        events.push({ kind: "status", chatJid, status });
      },
      resumePendingChats: () => {
        events.push({ kind: "resume" });
      },
    }, (resume) => {
      resumePending = resume;
    });

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      kind: "status",
      chatJid: STARTUP_STATUS_CHAT_JID,
      status: {
        type: "intent",
        intent_key: "startup",
        phase: "recovering_native",
        turn_id: STARTUP_STATUS_TURN_ID,
      },
    });
    expect(events[1]).toMatchObject({
      kind: "status",
      chatJid: STARTUP_STATUS_CHAT_JID,
      status: {
        type: "intent",
        intent_key: "startup",
        phase: "resuming_pending",
        turn_id: STARTUP_STATUS_TURN_ID,
      },
    });
    expect(events[2]).toMatchObject({
      kind: "status",
      chatJid: STARTUP_STATUS_CHAT_JID,
      status: {
        type: "done",
        source: "startup",
        turn_id: STARTUP_STATUS_TURN_ID,
        title: "Startup ready",
      },
    });

    expect(events).toHaveLength(3);
    expect(resumePending).toBeFunction();
    (resumePending as () => void)();
    expect(events[3]).toEqual({ kind: "resume" });
  });
});

test("startup upgrade check migrates legacy config permissions before sessions", async () => {
  await withTempWorkspaceEnv("startup-config-permissions-", {}, async workspace => {
    const path = join(workspace.workspace, ".piclaw/config.json");
    mkdirSync(dirname(path), { recursive: true });
    const content = '{"domains":{"access":{"mode":"single-user"}}}';
    writeFileSync(path, content, { mode: 0o644 });
    const proc = Bun.spawn([process.execPath, "-e", `
      import { initializeRuntimeEnvironment } from ${JSON.stringify(join(RUNTIME_DIR, "src/runtime/startup.ts"))};
      initializeRuntimeEnvironment({loadTimestamps(){},loadChats(){}});
      const fs=await import('node:fs');
      console.log('CONFIG_MIGRATION_RESULT:'+JSON.stringify({mode:fs.statSync(${JSON.stringify(path)}).mode&511,content:fs.readFileSync(${JSON.stringify(path)},'utf8')}));
      process.exit(0);
    `], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe", env: { ...process.env, PICLAW_DB_IN_MEMORY: "1", PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX: "1" } });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    expect(await proc.exited).toBe(0);
    expect(stderr).not.toContain("MCP settings require");
    const marker = "CONFIG_MIGRATION_RESULT:";
    const line = stdout.split("\n").find(line => line.includes(marker));
    expect(line).toBeDefined();
    expect(JSON.parse(line!.slice(line!.indexOf(marker) + marker.length))).toEqual({ mode: 0o600, content });
  });
}, 20000);
