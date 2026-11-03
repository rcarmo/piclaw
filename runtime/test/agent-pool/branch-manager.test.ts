import { afterEach, expect, test } from "bun:test";
import { writeFileSync } from "fs";

import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import { join } from "path";
import { ensureSessionDir } from "../../src/agent-pool/session.js";
import { AgentBranchManager } from "../../src/agent-pool/branch-manager.js";
import { hasDeferredBranchSeed } from "../../src/agent-pool/branch-seeding.js";
import { createTempWorkspace, importFresh, setEnv } from "../helpers.js";

let restoreEnv: (() => void) | null = null;

afterEach(() => {
  restoreEnv?.();
  restoreEnv = null;
});

function createRuntime(session: any): AgentSessionRuntime {
  return {
    session,
    cwd: "/workspace",
    diagnostics: [],
    services: {} as any,
    modelFallbackMessage: undefined,
    newSession: async () => ({ cancelled: false }),
    switchSession: async () => ({ cancelled: false }),
    fork: async () => ({ cancelled: false }),
    importFromJsonl: async () => ({ cancelled: false }),
    dispose: async () => {
      session.dispose?.();
    },
  } as any;
}

function createManager(overrides: Partial<ConstructorParameters<typeof AgentBranchManager>[0]> = {}) {
  const pool = new Map<string, { runtime: any; lastUsed: number }>();
  const warns: string[] = [];

  const manager = new AgentBranchManager({
    pool,
    isActive: (chatJid) => {
      const session = pool.get(chatJid)?.runtime.session;
      return Boolean(session?.isStreaming || session?.isCompacting || session?.isRetrying || session?.isBashRunning);
    },
    onWarn: (message) => warns.push(message),
    ...overrides,
  });

  return { manager, pool, warns };
}

test("AgentBranchManager reads existing branch metadata and resolves agent handles", async () => {
  const ws = createTempWorkspace("piclaw-branch-manager-");
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await importFresh<typeof import("../src/db.js")>("../src/db.js");
  db.initDatabase();

  const fixture = createManager();
  fixture.pool.set("web:topic", {
    runtime: createRuntime({
      sessionId: "session-1",
      sessionName: "Research Bot",
      model: { provider: "openai", id: "gpt-test" },
      getContextUsage: () => ({ tokens: 32_000, contextWindow: 128_000, percent: 25 }),
      isStreaming: false,
      isCompacting: false,
      isRetrying: false,
      isBashRunning: false,
    }),
    lastUsed: Date.now(),
  });

  const before = db.getDb().serialize();
  const active = fixture.manager.listActiveChats();
  expect(active).toHaveLength(1);
  expect(active[0]?.agent_name).toBe("research-bot");
  expect(active[0]?.model).toBe("openai/gpt-test");
  expect(active[0]?.context_tokens).toBe(32_000);
  expect(active[0]?.context_window).toBe(128_000);
  expect(active[0]?.context_percent).toBe(25);
  expect(active[0]?.is_active).toBe(false);
  expect(active[0]?.is_compacting).toBe(false);
  expect(active[0]?.activity_status).toBe("idle");
  expect(active[0]?.activity_label).toBe("Idle");
  expect(fixture.manager.findActiveChatByAgentName("Research Bot")?.chat_jid).toBe("web:topic");
  expect(fixture.manager.findChatByAgentName("research-bot")).toEqual({
    chat_jid: "web:topic",
    agent_name: "research-bot",
  });
  expect(fixture.manager.getAgentHandleForChat("web:topic")).toBe("research-bot");
  expect(fixture.manager.listKnownChats("web:topic")[0]?.agent_name).toBe("research-bot");
  expect(db.getDb().serialize()).toEqual(before);
  expect(db.getChatBranchByChatJid("web:topic")).toBeNull();

  ws.cleanup();
});

test("AgentBranchManager exposes compacting status when enumerating sessions", async () => {
  const ws = createTempWorkspace("piclaw-branch-compacting-status-");
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await importFresh<typeof import("../src/db.js")>("../src/db.js");
  db.initDatabase();

  const fixture = createManager();
  fixture.pool.set("web:compact", {
    runtime: createRuntime({
      sessionId: "session-compact",
      sessionName: "Compact Bot",
      model: { provider: "openai", id: "gpt-test" },
      isStreaming: false,
      isCompacting: true,
      isRetrying: false,
      isBashRunning: false,
    }),
    lastUsed: Date.now(),
  });

  const [active] = fixture.manager.listActiveChats();
  expect(active).toMatchObject({
    chat_jid: "web:compact",
    agent_name: "compact-bot",
    is_active: true,
    is_streaming: false,
    is_compacting: true,
    is_retrying: false,
    is_bash_running: false,
    activity_status: "compacting",
    activity_label: "Compacting",
  });

  const [known] = fixture.manager.listKnownChats("web:compact");
  expect(known).toMatchObject({
    chat_jid: "web:compact",
    is_active: true,
    is_compacting: true,
    activity_status: "compacting",
    activity_label: "Compacting",
  });

  ws.cleanup();
});

test("AgentBranchManager renames branch handles without changing the chat JID", async () => {
  const ws = createTempWorkspace("piclaw-branch-rename-");
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await importFresh<typeof import("../src/db.js")>("../src/db.js");
  db.initDatabase();

  let appliedSessionName = "Topic";
  const fixture = createManager();
  fixture.pool.set("web:topic", {
    runtime: createRuntime({
      sessionName: "Topic",
      setSessionName(name: string) {
        appliedSessionName = name;
        this.sessionName = name;
      },
      isStreaming: false,
      isCompacting: false,
      isRetrying: false,
      isBashRunning: false,
    }),
    lastUsed: Date.now(),
  });

  db.storeChatMetadata("web:topic", new Date().toISOString(), "Topic");
  const branch = await fixture.manager.renameChatBranch("web:topic", { agentName: "Research Bot" });

  expect(branch.chat_jid).toBe("web:topic");
  expect(branch.agent_name).toBe("research-bot");
  expect(appliedSessionName).toBe("Topic");
  expect(db.getChatBranchByChatJid("web:topic")?.agent_name).toBe("research-bot");
  expect(db.getChatBranchByChatJid("web:research-bot")).toBeNull();

  ws.cleanup();
});

test("AgentBranchManager creates independent root sessions", async () => {
  const ws = createTempWorkspace("piclaw-root-session-create-");
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await importFresh<typeof import("../src/db.js")>("../src/db.js");
  db.initDatabase();

  const fixture = createManager();

  const root = await fixture.manager.createRootChatSession("Ops Room");

  expect(root.chat_jid).toBe("web:ops-room");
  expect(root.root_chat_jid).toBe("web:ops-room");
  expect(root.parent_branch_id).toBeNull();
  expect(root.agent_name).toBe("ops-room");
  expect(fixture.pool.size).toBe(0);
  expect(db.getChatBranchByChatJid("web:ops-room")?.root_chat_jid).toBe("web:ops-room");

  ws.cleanup();
});

test("AgentBranchManager archives inactive branches without executing legacy session publication", async () => {
  const ws = createTempWorkspace("piclaw-branch-prune-");
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await importFresh<typeof import("../src/db.js")>("../src/db.js");
  db.initDatabase();
  db.storeChatMetadata("web:default", new Date().toISOString(), "Default");
  const root = db.getChatBranchByChatJid("web:default");
  db.storeChatMetadata("web:default:branch:prune", new Date().toISOString(), "Prune Me");
  db.ensureChatBranch({
    chat_jid: "web:default:branch:prune",
    root_chat_jid: "web:default",
    parent_branch_id: root?.branch_id ?? null,
    agent_name: "prune-me",
  });

  let disposed = 0;
  const session = {
    sessionName: "Prune Me",
    isStreaming: false,
    isCompacting: false,
    isRetrying: false,
    isBashRunning: false,
    dispose() {
      disposed += 1;
    },
  };

  const fixture = createManager();
  fixture.pool.set("web:default:branch:prune", { runtime: createRuntime(session), lastUsed: Date.now() });
  writeFileSync(join(ensureSessionDir("web:default:branch:prune"), ".branch-seed.json"), JSON.stringify({
    version: 1,
    parentSession: null,
    sessionName: "Prune Me",
    model: null,
    thinkingLevel: null,
    mode: "rotated_context",
  }), "utf8");

  const archived = await fixture.manager.pruneChatBranch("web:default:branch:prune");
  expect(archived.archived_at).toBeTruthy();
  expect(fixture.pool.has("web:default:branch:prune")).toBe(true);
  // The deferred seed must survive prune — it is the only persisted copy of
  // the forked context until the session is realized, and restoreChatBranch()
  // must be able to pick it back up.
  expect(hasDeferredBranchSeed("web:default:branch:prune")).toBe(true);
  expect(disposed).toBe(0);

  ws.cleanup();
});

test("AgentBranchManager archives a non-default root session and blocks roots with child branches", async () => {
  const ws = createTempWorkspace("piclaw-root-session-archive-");
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await importFresh<typeof import("../src/db.js")>("../src/db.js");
  db.initDatabase();
  db.storeChatMetadata("web:custom", new Date().toISOString(), "Custom Root");

  const fixture = createManager();
  const archivedRoot = await fixture.manager.pruneChatBranch("web:custom");
  expect(archivedRoot.archived_at).toBeTruthy();

  db.storeChatMetadata("web:family", new Date().toISOString(), "Family Root");
  const familyRoot = db.getChatBranchByChatJid("web:family");
  db.storeChatMetadata("web:family:branch:child", new Date().toISOString(), "Child");
  db.ensureChatBranch({
    chat_jid: "web:family:branch:child",
    root_chat_jid: "web:family",
    parent_branch_id: familyRoot?.branch_id ?? null,
    agent_name: "child",
  });

  await expect(fixture.manager.pruneChatBranch("web:family")).rejects.toThrow(
    "Cannot archive a root chat session while it still has active branch sessions.",
  );

  ws.cleanup();
});
