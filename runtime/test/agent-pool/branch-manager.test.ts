import { afterEach, expect, test } from "bun:test";

import type { AgentSessionRuntime } from "@mariozechner/pi-coding-agent";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { join } from "path";
import { AgentBranchManager } from "../../src/agent-pool/branch-manager.js";
import { readDeferredBranchSeed } from "../../src/agent-pool/branch-seeding.js";
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
  const sidePool = new Map<string, { runtime: any; lastUsed: number }>();
  const activeForkBaseLeafByChat = new Map<string, string | null>();
  const warns: string[] = [];

  const manager = new AgentBranchManager({
    pool,
    sidePool,
    activeForkBaseLeafByChat,
    getOrCreateRuntime: async (chatJid) => pool.get(chatJid)?.runtime,
    refreshRuntime: async () => {},
    isActive: (chatJid) => {
      const session = pool.get(chatJid)?.runtime.session;
      return Boolean(session?.isStreaming || session?.isCompacting || session?.isRetrying || session?.isBashRunning);
    },
    scheduleSessionWarmup: () => {},
    onWarn: (message) => warns.push(message),
    ...overrides,
  });

  return { manager, pool, sidePool, activeForkBaseLeafByChat, warns };
}

test("AgentBranchManager registers active chats and resolves agent handles", async () => {
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
      isStreaming: false,
      isCompacting: false,
      isRetrying: false,
      isBashRunning: false,
    }),
    lastUsed: Date.now(),
  });

  const branch = fixture.manager.ensureBranchRegistration("web:topic", fixture.pool.get("web:topic")?.runtime.session);
  expect(branch.agent_name).toBe("research-bot");

  const active = fixture.manager.listActiveChats();
  expect(active).toHaveLength(1);
  expect(active[0]?.agent_name).toBe("research-bot");
  expect(active[0]?.model).toBe("openai/gpt-test");
  expect(fixture.manager.findActiveChatByAgentName("Research Bot")?.chat_jid).toBe("web:topic");
  expect(fixture.manager.findChatByAgentName("research-bot")).toEqual({
    chat_jid: "web:topic",
    agent_name: "research-bot",
  });
  expect(fixture.manager.getAgentHandleForChat("web:topic")).toBe("research-bot");

  ws.cleanup();
});

test("AgentBranchManager writes a deferred fork seed and schedules branch warmup without hydrating the target runtime", async () => {
  const ws = createTempWorkspace("piclaw-branch-seed-");
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await importFresh<typeof import("../src/db.js")>("../src/db.js");
  db.initDatabase();

  const sourceManager = SessionManager.create(ws.workspace, join(ws.workspace, "source-session"));
  sourceManager.appendSessionInfo("Research");
  sourceManager.appendModelChange("openai", "gpt-test");
  sourceManager.appendMessage({ role: "user", content: "stable user", timestamp: Date.now() } as const);
  sourceManager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "stable assistant" }],
    provider: "openai",
    model: "gpt-test",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  } as const);

  const scheduled: string[] = [];
  let getOrCreateCalls = 0;
  const sourceSession = {
    sessionManager: sourceManager,
    sessionFile: sourceManager.getSessionFile(),
    sessionName: "Research",
    model: { provider: "openai", id: "gpt-test", reasoning: true },
    thinkingLevel: "high",
    isStreaming: false,
    isCompacting: false,
    isRetrying: false,
    isBashRunning: false,
  };

  const fixture = createManager({
    getOrCreateRuntime: async (chatJid) => {
      getOrCreateCalls += 1;
      if (chatJid !== "web:default") throw new Error(`unexpected runtime hydration for ${chatJid}`);
      return fixture.pool.get(chatJid)?.runtime;
    },
    scheduleSessionWarmup: (chatJid) => {
      scheduled.push(chatJid);
    },
  });
  fixture.pool.set("web:default", { runtime: createRuntime(sourceSession), lastUsed: Date.now() });

  const branch = await fixture.manager.createForkedChatBranch("web:default");
  expect(branch.chat_jid).not.toBe("web:default");
  expect(getOrCreateCalls).toBe(1);
  expect(scheduled).toEqual([branch.chat_jid]);

  const seed = readDeferredBranchSeed(branch.chat_jid);
  expect(seed?.version).toBe(1);
  expect(seed?.sessionName).toBe(branch.agent_name);
  expect(seed?.model).toEqual({ provider: "openai", modelId: "gpt-test" });
  expect(seed?.mode).toBe("rotated_context");

  ws.cleanup();
});

test("AgentBranchManager prunes inactive branches and disposes cached sessions", async () => {
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
  fixture.sidePool.set("web:default:branch:prune", { runtime: createRuntime(session), lastUsed: Date.now() });
  fixture.activeForkBaseLeafByChat.set("web:default:branch:prune", "leaf-1");

  const archived = await fixture.manager.pruneChatBranch("web:default:branch:prune");
  expect(archived.archived_at).toBeTruthy();
  expect(fixture.pool.has("web:default:branch:prune")).toBe(false);
  expect(fixture.sidePool.has("web:default:branch:prune")).toBe(false);
  expect(fixture.activeForkBaseLeafByChat.has("web:default:branch:prune")).toBe(false);
  expect(disposed).toBe(2);

  ws.cleanup();
});
