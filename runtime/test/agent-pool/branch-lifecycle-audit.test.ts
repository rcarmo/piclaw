import { afterEach, expect, test } from "bun:test";
import { join } from "path";
import type { AgentSessionRuntime } from "@mariozechner/pi-coding-agent";
import { SessionManager } from "@mariozechner/pi-coding-agent";
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
    newSession: async (options?: { parentSession?: string; setup?: (sessionManager: SessionManager) => Promise<void> | void }) => ({
      cancelled: !(await session.newSession(options)),
    }),
    switchSession: async () => ({ cancelled: false }),
    fork: async () => ({ cancelled: false }),
    importFromJsonl: async () => ({ cancelled: false }),
    dispose: async () => {
      session.dispose?.();
    },
  } as any;
}

function createAssistantMessage(text: string) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
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
  } as const;
}

test("agent pool audit: forks active chats from the previous stable turn boundary", async () => {
  const ws = createTempWorkspace("piclaw-active-fork-audit-");
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await importFresh<typeof import("../src/db.js")>("../src/db.js");
  db.initDatabase();
  const { AgentPool } = await importFresh<typeof import("../src/agent-pool.js")>("../src/agent-pool.js");

  class ForkableSession {
    sessionManager: SessionManager;
    sessionFile: string | undefined;
    sessionName = "Research";
    model = { provider: "openai", id: "gpt-test", reasoning: true } as const;
    thinkingLevel = "high" as const;
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    isBashRunning = false;
    pendingMessageCount = 0;
    sessionId: string;

    constructor(private workspace: string, private sessionDir: string, seed = false) {
      this.sessionManager = SessionManager.create(workspace, sessionDir);
      if (seed) {
        this.sessionManager.appendMessage({ role: "user", content: "stable user", timestamp: Date.now() } as const);
        this.sessionManager.appendMessage(createAssistantMessage("stable assistant"));
      }
      this.sessionFile = this.sessionManager.getSessionFile();
      this.sessionId = this.sessionManager.getSessionId();
    }

    subscribe(_listener: (event: any) => void) {
      return () => {};
    }

    async newSession(options?: { parentSession?: string; setup?: (sessionManager: SessionManager) => Promise<void> | void }) {
      const manager = SessionManager.create(this.workspace, this.sessionDir);
      manager.newSession({ parentSession: options?.parentSession });
      if (options?.setup) {
        await options.setup(manager);
      }
      this.sessionManager = manager;
      this.sessionFile = manager.getSessionFile();
      this.sessionId = manager.getSessionId();
      return true;
    }

    async setModel(_model: any) {}
    setThinkingLevel(_level: any) {}
    setSessionName(name: string) { this.sessionName = name; }
    async prompt(_prompt: string) {}
    async abort() {}
    dispose() {}
  }

  const sourceChatJid = "web:default";
  const sourceSession = new ForkableSession(ws.workspace, join(ws.workspace, "sessions-source"), true);
  sourceSession.isStreaming = true;
  const stableLeafId = sourceSession.sessionManager.getLeafId();
  const created: Record<string, ForkableSession> = { [sourceChatJid]: sourceSession };

  const pool = new AgentPool({
    createSession: async (chatJid: string, sessionDir: string) => {
      if (created[chatJid]) return createRuntime(created[chatJid]) as any;
      const session = new ForkableSession(ws.workspace, sessionDir, false);
      created[chatJid] = session;
      return createRuntime(session) as any;
    },
  });

  (pool as any).activeForkBaseLeafByChat.set(sourceChatJid, stableLeafId ?? null);

  const branch = await (pool as any).createForkedChatBranch(sourceChatJid);
  expect(branch.chat_jid).not.toBe(sourceChatJid);
  await (pool as any).getSessionForIntrospection(branch.chat_jid);
  const forkedSession = created[branch.chat_jid];
  const forkedMessages = forkedSession.sessionManager.buildSessionContext().messages;
  const serialized = JSON.stringify(forkedMessages);
  expect(serialized).toContain("stable user");
  expect(serialized).toContain("stable assistant");
  expect(serialized).not.toContain("in-flight user");

  await pool.shutdown();
  ws.cleanup();
});

test("agent pool audit: refuses to prune an active branch session", async () => {
  const ws = createTempWorkspace("piclaw-active-prune-audit-");
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await importFresh<typeof import("../src/db.js")>("../src/db.js");
  db.initDatabase();
  db.storeChatMetadata("web:default", new Date().toISOString(), "Default");
  const root = db.getChatBranchByChatJid("web:default");
  db.storeChatMetadata("web:default:branch:active", new Date().toISOString(), "Research");
  db.ensureChatBranch({
    chat_jid: "web:default:branch:active",
    root_chat_jid: "web:default",
    parent_branch_id: root?.branch_id ?? null,
    agent_name: "research",
  });

  const { AgentPool } = await importFresh<typeof import("../src/agent-pool.js")>("../src/agent-pool.js");

  class ActiveBranchSession {
    sessionName = "Research";
    sessionId = "branch-session";
    isStreaming = true;
    isCompacting = false;
    isRetrying = false;
    isBashRunning = false;
    subscribe(_listener: (event: any) => void) { return () => {}; }
    async prompt(_prompt: string) {}
    async abort() {}
    dispose() {}
  }

  const pool = new AgentPool({
    createSession: async () => createRuntime(new ActiveBranchSession()) as any,
  });

  await (pool as any).getOrCreate("web:default:branch:active");

  await expect((pool as any).pruneChatBranch("web:default:branch:active")).rejects.toThrow(
    "Cannot prune a branch while it is active.",
  );
  expect(db.getChatBranchByChatJid("web:default:branch:active")?.archived_at).toBeNull();

  await pool.shutdown();
  ws.cleanup();
});
