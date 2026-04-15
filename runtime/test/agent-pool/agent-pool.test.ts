/**
 * test/agent-pool/agent-pool.test.ts – Tests for agent pool initialisation and session management.
 *
 * Verifies createAgentPool(), session creation, AGENTS.md loading,
 * config persistence, and workspace directory setup.
 */

import { expect, test, afterEach } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import type { AgentSessionRuntime } from "@mariozechner/pi-coding-agent";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { getAttachmentRegistry } from "../../src/agent-pool/attachments.js";
import { createTempWorkspace, getTestWorkspace, importFresh, setEnv } from "../helpers.js";

let restoreEnv: (() => void) | null = null;

function createRuntime(session: any, overrides: Partial<AgentSessionRuntime> = {}): AgentSessionRuntime {
  return {
    session,
    cwd: "/workspace",
    diagnostics: [],
    services: {} as any,
    modelFallbackMessage: undefined,
    newSession: async (options?: any) => ({
      cancelled: typeof session.newSession === "function" ? !(await session.newSession(options)) : false,
    }),
    switchSession: async (path: string) => ({
      cancelled: typeof session.switchSession === "function" ? !(await session.switchSession(path)) : false,
    }),
    fork: async (entryId: string) => (
      typeof session.fork === "function"
        ? await session.fork(entryId)
        : { cancelled: false }
    ),
    importFromJsonl: async () => ({ cancelled: false }),
    dispose: async () => {
      session.dispose?.();
    },
    ...overrides,
  } as any;
}

afterEach(async () => {
  restoreEnv?.();
  restoreEnv = null;
  try {
    const sshCore = await import("../../src/extensions/ssh-core.js");
    sshCore.setSshConnectionResolverForTests(null);
    await sshCore.unregisterLiveChatSshSession("web:default");
  } catch (_error) {
    void _error;
  }
});

test("agent pool aggregates streamed text and writes logs", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const { AgentPool } = await importFresh<typeof import("../src/agent-pool.js")>("../src/agent-pool.js");

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      };
    }
    async prompt(_prompt: string) {
      const deltas = ["Hello", " ", "world"];
      for (const delta of deltas) {
        for (const listener of this.listeners) {
          listener({
            type: "message_update",
            assistantMessageEvent: { type: "text_delta", delta },
          });
        }
      }
    }
    async abort() {}
    dispose() {}
  }

  const pool = new AgentPool({
    createSession: async () => createRuntime(new StubSession()) as any,
  });

  const result = await pool.runAgent("test", "web:default");
  expect(result.status).toBe("success");
  expect(result.result).toBe("Hello world");
  expect(process.env.PICLAW_CHAT_JID).toBeUndefined();

  const logsDir = (pool as any).logsDir || join(process.env.PICLAW_WORKSPACE || ws.workspace, "logs");
  const logFiles = readdirSync(logsDir).filter((f) => f.startsWith("agent-") && f.endsWith(".log"));
  expect(logFiles.length).toBeGreaterThan(0);
  const latest = logFiles.sort().slice(-1)[0];
  const content = readFileSync(join(logsDir, latest), "utf8");
  expect(content).toContain("Hello world");
});

test("agent pool raises provider retry defaults for shared session settings", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const { AgentPool } = await importFresh<typeof import("../src/agent-pool.js")>("../src/agent-pool.js");
  const pool = new AgentPool({
    createSession: async () => createRuntime({ subscribe: () => () => {}, prompt: async () => {}, abort: async () => {} }) as any,
  });

  const retrySettings = (pool as any).settingsManager.getRetrySettings();
  expect(retrySettings.maxRetries).toBeGreaterThanOrEqual(5);
  expect(retrySettings.baseDelayMs).toBeGreaterThanOrEqual(5000);
});

test("agent pool honors timeout overrides", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const { AgentPool } = await importFresh<typeof import("../src/agent-pool.js")>("../src/agent-pool.js");

  let abortCalled = false;
  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      };
    }
    async prompt(_prompt: string) {
      await Bun.sleep(20);
    }
    async abort() {
      abortCalled = true;
    }
    dispose() {}
  }

  const pool = new AgentPool({
    createSession: async () => createRuntime(new StubSession()) as any,
  });

  const timedOut = await pool.runAgent("test", "web:default", { timeoutMs: 5 });
  expect(timedOut.status).toBe("error");
  expect(abortCalled).toBe(true);

  abortCalled = false;
  const ok = await pool.runAgent("test", "web:default", { timeoutMs: 0 });
  expect(ok.status).toBe("success");
  expect(abortCalled).toBe(false);
});

test("agent pool clears attachments when a run errors", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const { AgentPool } = await importFresh<typeof import("../src/agent-pool.js")>("../src/agent-pool.js");
  const attachments = getAttachmentRegistry();
  attachments.clear("web:default");

  class StubSession {
    subscribe(_listener: (event: any) => void) {
      return () => {};
    }
    async prompt(_prompt: string) {
      attachments.register("web:default", {
        id: 1,
        name: "file.txt",
        contentType: "text/plain",
        size: 5,
        kind: "file",
        sourcePath: "/tmp/file.txt",
      });
      throw new Error("boom");
    }
    async abort() {}
    dispose() {}
  }

  const pool = new AgentPool({
    createSession: async () => createRuntime(new StubSession()) as any,
  });

  const result = await pool.runAgent("test", "web:default", { timeoutMs: 0 });
  expect(result.status).toBe("error");
  expect(result.attachments).toBeUndefined();
  expect(attachments.take("web:default").length).toBe(0);
});

test("agent pool stores SSH config for future sessions when no live SSH session exists", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const { initDatabase, getSshConfig } = await importFresh<typeof import("../src/db.js")>("../src/db.js");
  initDatabase();
  const { AgentPool } = await importFresh<typeof import("../src/agent-pool.js")>("../src/agent-pool.js");

  let pool: any;
  let createCalls = 0;
  let disposed = 0;

  class StubSession {
    isStreaming = false;
    isBashRunning = false;
    isCompacting = false;
    subscribe(_listener: (event: any) => void) {
      return () => {};
    }
    async prompt(_prompt: string) {
      this.isStreaming = true;
      try {
        const result = await pool.setSshConfig("web:other", {
          ssh_target: "agent@example.com:/srv/project",
          ssh_port: 22,
          private_key_keychain: "ssh-prod",
          known_hosts_keychain: null,
          strict_host_key_checking: "yes",
        });
        expect(result.apply_timing).toBe("next_session");
        expect(getSshConfig("web:other")?.ssh_target).toBe("agent@example.com:/srv/project");
      } finally {
        this.isStreaming = false;
      }
    }
    async abort() {}
    dispose() {
      disposed += 1;
    }
  }

  pool = new AgentPool({
    createSession: async () => {
      createCalls += 1;
      return createRuntime(new StubSession()) as any;
    },
  });

  const result = await pool.runAgent("test", "web:default", { timeoutMs: 0 });
  expect(result.status).toBe("success");
  expect(disposed).toBe(0);
  expect((pool as any).pool.has("web:default")).toBe(true);

  await pool.runAgent("test", "web:default", { timeoutMs: 0 });
  expect(createCalls).toBe(1);

  await pool.shutdown();
});

test("agent pool evicts idle sessions and recreates them", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const { AgentPool } = await importFresh<typeof import("../src/agent-pool.js")>("../src/agent-pool.js");

  let createCalls = 0;
  let disposed = 0;

  class StubSession {
    subscribe(_listener: (event: any) => void) {
      return () => {};
    }
    async prompt(_prompt: string) {}
    async abort() {}
    dispose() {
      disposed += 1;
    }
  }

  const pool = new AgentPool({
    createSession: async () => {
      createCalls += 1;
      return createRuntime(new StubSession()) as any;
    },
  });

  await pool.runAgent("test", "web:default", { timeoutMs: 0 });
  expect(createCalls).toBe(1);

  const entry = (pool as any).pool.get("web:default");
  entry.lastUsed = Date.now() - 11 * 60 * 1000;
  (pool as any).evictIdle();

  expect(disposed).toBe(1);
  expect((pool as any).pool.has("web:default")).toBe(false);

  await pool.runAgent("test", "web:default", { timeoutMs: 0 });
  expect(createCalls).toBe(2);

  await pool.shutdown();
});

test("agent pool can run a side prompt with the current model and thinking level", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const { AgentPool } = await importFresh<typeof import("../src/agent-pool.js")>("../src/agent-pool.js");

  const seen: Array<{ model: string; reasoning: unknown; prompt: string }> = [];
  class StubSession {
    model = {
      provider: "openai",
      id: "gpt-test",
      api: "openai-responses",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 8192,
    };
    thinkingLevel = "high";
    subscribe(_listener: (event: any) => void) {
      return () => {};
    }
    async prompt(_prompt: string) {}
    async abort() {}
    dispose() {}
  }

  const pool = new AgentPool({
    createSession: async () => createRuntime(new StubSession()) as any,
    modelRegistry: {
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test-key" }),
      find: () => undefined,
      getAll: () => [],
      getAvailable: () => [],
    } as any,
    sideStreamSimple: (_model: any, context: any, options: any) => {
      seen.push({
        model: `${_model.provider}/${_model.id}`,
        reasoning: options?.reasoning,
        prompt: context.messages[0].content[0].text,
      });
      return (async function* () {
        yield { type: "thinking_delta", delta: "plan" } as any;
        yield { type: "text_delta", delta: "answer" } as any;
        yield {
          type: "done",
          reason: "stop",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "answer" }],
            api: "openai-responses",
            provider: "openai",
            model: "gpt-test",
            usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            stopReason: "stop",
            timestamp: Date.now(),
          },
        } as any;
      })() as any;
    },
  });

  const result = await pool.runSidePrompt("web:default", "Side question");
  expect(result.status).toBe("success");
  expect(result.result).toBe("answer");
  expect(result.thinking).toBe("plan");
  expect(result.model).toBe("openai/gpt-test");
  expect(seen).toEqual([{ model: "openai/gpt-test", reasoning: "high", prompt: "Side question" }]);
});

test("agent pool forwards header-based auth for side prompts", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const { AgentPool } = await importFresh<typeof import("../src/agent-pool.js")>("../src/agent-pool.js");

  const seen: Array<{ apiKey: unknown; headers: unknown }> = [];
  class StubSession {
    model = {
      provider: "openai",
      id: "gpt-test",
      api: "openai-responses",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 8192,
    };
    thinkingLevel = "high";
    subscribe(_listener: (event: any) => void) {
      return () => {};
    }
    async prompt(_prompt: string) {}
    async abort() {}
    dispose() {}
  }

  const pool = new AgentPool({
    createSession: async () => createRuntime(new StubSession()) as any,
    modelRegistry: {
      getApiKeyAndHeaders: async () => ({
        ok: true,
        headers: { Authorization: "Bearer side-token", "X-Test": "1" },
      }),
      find: () => undefined,
      getAll: () => [],
      getAvailable: () => [],
    } as any,
    sideStreamSimple: (_model: any, _context: any, options: any) => {
      seen.push({ apiKey: options?.apiKey, headers: options?.headers });
      return (async function* () {
        yield {
          type: "done",
          reason: "stop",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "header answer" }],
            api: "openai-responses",
            provider: "openai",
            model: "gpt-test",
            usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            stopReason: "stop",
            timestamp: Date.now(),
          },
        } as any;
      })() as any;
    },
  });

  const result = await pool.runSidePrompt("web:default", "Side question");
  expect(result.status).toBe("success");
  expect(result.result).toBe("header answer");
  expect(seen).toEqual([{ apiKey: undefined, headers: { Authorization: "Bearer side-token", "X-Test": "1" } }]);
});

test("agent pool forks active chats from the previous stable turn boundary", async () => {
  const ws = createTempWorkspace("piclaw-active-fork-");
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await importFresh<typeof import("../src/db.js")>("../src/db.js");
  db.initDatabase();
  const { AgentPool } = await importFresh<typeof import("../src/agent-pool.js")>("../src/agent-pool.js");

  const createAssistantMessage = (text: string) => ({
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
  } as const);

  class ForkableSession {
    private listeners: Array<(event: any) => void> = [];
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
    gate: Promise<void> | null = null;

    constructor(private workspace: string, private sessionDir: string, seed = false) {
      this.sessionManager = SessionManager.create(workspace, sessionDir);
      if (seed) {
        this.sessionManager.appendMessage({ role: "user", content: "stable user", timestamp: Date.now() } as const);
        this.sessionManager.appendMessage(createAssistantMessage("stable assistant"));
      }
      this.sessionFile = this.sessionManager.getSessionFile();
      this.sessionId = this.sessionManager.getSessionId();
    }

    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      };
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

    async prompt(_prompt: string) {
      this.isStreaming = true;
      this.sessionManager.appendMessage({ role: "user", content: "in-flight user", timestamp: Date.now() } as const);
      this.sessionFile = this.sessionManager.getSessionFile();
      if (this.gate) {
        await this.gate;
      }
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "done" } });
      }
      this.isStreaming = false;
    }

    async setModel(_model: any) {}
    setThinkingLevel(_level: any) {}
    setSessionName(name: string) { this.sessionName = name; }
    async abort() {}
    dispose() {}
  }

  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const sourceChatJid = "web:default";
  const sourceSession = new ForkableSession(ws.workspace, join(ws.workspace, "sessions-source"), true);
  sourceSession.gate = gate;
  const created: Record<string, ForkableSession> = { [sourceChatJid]: sourceSession };

  const pool = new AgentPool({
    createSession: async (chatJid: string, sessionDir: string) => {
      if (created[chatJid]) return createRuntime(created[chatJid]) as any;
      const session = new ForkableSession(ws.workspace, sessionDir, false);
      created[chatJid] = session;
      return createRuntime(session) as any;
    },
  });

  const runPromise = pool.runAgent("continue", sourceChatJid, { timeoutMs: 0 });
  await Bun.sleep(20);

  const branch = await (pool as any).createForkedChatBranch(sourceChatJid);
  expect(branch.chat_jid).not.toBe(sourceChatJid);
  await (pool as any).getSessionForIntrospection(branch.chat_jid);
  const forkedSession = created[branch.chat_jid];
  const forkedMessages = forkedSession.sessionManager.buildSessionContext().messages;
  const serialized = JSON.stringify(forkedMessages);
  expect(serialized).toContain("stable user");
  expect(serialized).toContain("stable assistant");
  expect(serialized).not.toContain("in-flight user");

  release();
  const result = await runPromise;
  expect(result.status).toBe("success");

  await pool.shutdown();
  ws.cleanup();
});

test("agent pool refuses to prune an active branch session", async () => {
  const ws = createTempWorkspace("piclaw-active-prune-");
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
    "Cannot prune a branch while it is active."
  );
  expect(db.getChatBranchByChatJid("web:default:branch:active")?.archived_at).toBeNull();

  await pool.shutdown();
  ws.cleanup();
});

test("agent pool reports side prompt errors when no model is active", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const { AgentPool } = await importFresh<typeof import("../src/agent-pool.js")>("../src/agent-pool.js");

  class StubSession {
    model = null;
    subscribe(_listener: (event: any) => void) {
      return () => {};
    }
    async prompt(_prompt: string) {}
    async abort() {}
    dispose() {}
  }

  const pool = new AgentPool({
    createSession: async () => createRuntime(new StubSession()) as any,
  });

  const result = await pool.runSidePrompt("web:default", "Side question");
  expect(result.status).toBe("error");
  expect(result.error).toContain("No active model selected");
});

test("agent pool can run a tool-capable side prompt through a separate side session", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const { AgentPool } = await importFresh<typeof import("../src/agent-pool.js")>("../src/agent-pool.js");

  const mainModel = {
    provider: "openai",
    id: "gpt-test",
    api: "openai-responses",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
  };

  class MainSession {
    model = mainModel;
    thinkingLevel = "high";
    sessionManager = {
      buildSessionContext: () => ({
        messages: [{ role: "user", content: [{ type: "text", text: "main context" }], timestamp: Date.now() }],
        thinkingLevel: "high",
        model: { provider: "openai", modelId: "gpt-test" },
      }),
    };
    getActiveToolNames() { return ["read", "bash"]; }
    subscribe(_listener: (event: any) => void) { return () => {}; }
    async prompt(_prompt: string) {}
    async abort() {}
    dispose() {}
  }

  const seen: any = { model: null, thinking: null, tools: null, prompt: null, seeded: false };
  class SideSession {
    model = undefined;
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    isBashRunning = false;
    listeners: Array<(event: any) => void> = [];
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      };
    }
    async newSession(options: any) {
      seen.seeded = typeof options?.setup === "function";
      if (typeof options?.setup === "function") {
        await options.setup({
          appendSessionInfo: () => {},
          appendModelChange: () => {},
          appendCompaction: () => {},
          appendCustomMessageEntry: () => {},
          appendMessage: () => {},
        });
      }
      return true;
    }
    async setModel(model: any) { this.model = model; seen.model = `${model.provider}/${model.id}`; }
    setThinkingLevel(level: any) { seen.thinking = level; }
    setActiveToolsByName(toolNames: string[]) { seen.tools = [...toolNames]; }
    async prompt(prompt: string) {
      seen.prompt = prompt;
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "tool plan" } });
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "tool answer" } });
        listener({
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "tool answer" }],
            usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            stopReason: "stop",
            timestamp: Date.now(),
          },
        });
      }
    }
    async abort() {}
    getLastAssistantText() { return "tool answer"; }
    dispose() {}
  }

  const pool = new AgentPool({
    createSession: async () => createRuntime(new MainSession()) as any,
    createSideSession: async () => createRuntime(new SideSession()) as any,
    modelRegistry: {
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test-key" }),
      find: () => undefined,
      getAll: () => [],
      getAvailable: () => [],
    } as any,
  });

  const result = await pool.runSidePrompt("web:default", "Inspect workspace", { systemPrompt: "Use tools if needed." });
  expect(result.status).toBe("success");
  expect(result.result).toBe("tool answer");
  expect(result.thinking).toBe("tool plan");
  expect(result.model).toBe("openai/gpt-test");
  expect(seen).toEqual({
    model: "openai/gpt-test",
    thinking: "high",
    tools: ["read", "bash"],
    prompt: "Use tools if needed.\n\nInspect workspace",
    seeded: true,
  });
});
