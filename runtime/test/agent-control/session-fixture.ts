import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { mkdirSync, writeFileSync, rmSync, readdirSync } from "fs";
import { dirname, join } from "path";

export const DEFAULT_TEST_MODEL = { provider: "openai", id: "gpt-test", reasoning: true } as any;

export function cleanupRotatedSessionArtifacts(cwd: string): void {
  for (const entry of readdirSync(cwd)) {
    if (!entry.startsWith("rotated-") || !entry.endsWith(".jsonl")) continue;
    rmSync(join(cwd, entry), { force: true });
  }
}

export function createTestAuthStorage() {
  const storage = new Map<string, Record<string, unknown>>();
  return {
    get: (key: string) => storage.get(key),
    set: (key: string, value: Record<string, unknown> | undefined) => {
      if (value === undefined) storage.delete(key);
      else storage.set(key, value);
    },
    list: () => [...storage.entries()].map(([providerId, credential]) => ({ providerId, type: credential.type })),
    reload: () => {},
  };
}

function providerAuth(providerId: string) {
  const hasOAuth = providerId === "anthropic" || providerId === "github-copilot" || providerId === "openai-codex" || providerId === "xai";
  const hasApiKey = providerId !== "openai-codex";
  return {
    ...(hasApiKey ? { apiKey: { name: `${providerId} API key`, login: async (interaction: any) => ({ type: "api_key", key: await interaction.prompt({ type: "secret", message: `Enter ${providerId} API key` }) }) } } : {}),
    ...(hasOAuth ? { oauth: { name: providerId, login: async () => ({ type: "oauth", access: "access", refresh: "refresh", expires: Date.now() + 60_000 }) } } : {}),
  };
}

export function createTestModelRegistry(models: any[] = [DEFAULT_TEST_MODEL], authStorage = createTestAuthStorage()) {
  const providerIds = [...new Set(models.map((model: any) => model.provider))];
  const modelRuntime = {
    getProviders: () => providerIds.map((id) => ({ id, name: id, auth: providerAuth(id), getModels: () => models.filter((model: any) => model.provider === id) })),
    getProvider: (id: string) => ({ id, name: id, auth: providerAuth(id) }),
    getModels: () => models,
    getModel: (provider: string, modelId: string) => models.find((model: any) => model.provider === provider && model.id === modelId),
    getAvailableSnapshot: () => models,
    hasConfiguredAuth: () => true,
    listCredentials: async () => authStorage.list?.() ?? [],
    getProviderAuthStatus: (providerId: string) => ({ configured: Boolean(authStorage.get(providerId)), source: authStorage.get(providerId) ? "stored" : undefined }),
    login: async (providerId: string, type: "api_key" | "oauth", interaction: any) => {
      const provider = providerAuth(providerId);
      const method = type === "oauth" ? provider.oauth : provider.apiKey;
      if (!method?.login) throw new Error(`Unsupported ${type} login`);
      const credential = await method.login(interaction);
      authStorage.set(providerId, credential);
      return credential;
    },
    logout: async (providerId: string) => { authStorage.set(providerId, undefined); },
    refresh: async () => ({ aborted: false, errors: new Map() }),
    getAuth: async (providerId: string) => {
      const credential = authStorage.get(providerId);
      if (!credential) return undefined;
      return { auth: { apiKey: credential.type === "oauth" ? credential.access : credential.key }, source: credential.type === "oauth" ? "OAuth" : "stored credential" };
    },
  };
  return {
    refresh: async () => {},
    getAvailable: () => models,
    getAll: () => models,
    find: (provider: string, modelId: string) => models.find((m: any) => m.provider === provider && m.id === modelId) ?? null,
    hasConfiguredAuth: () => true,
    authStorage,
    modelRuntime,
  } as any;
}

export function createTestSessionRuntime(session: TestAgentControlSession): AgentSessionRuntime {
  return {
    session: session as any,
    cwd: session.rootDir,
    diagnostics: [],
    services: {} as any,
    modelFallbackMessage: undefined,
    newSession: async (options?: { parentSession?: string; setup?: (sessionManager: any) => Promise<void> | void }) => ({
      cancelled: !(await session.newSession(options)),
    }),
    switchSession: async (path: string) => ({
      cancelled: !(await session.switchSession(path)),
    }),
    fork: async (entryId: string) => session.fork(entryId),
    importFromJsonl: async () => ({ cancelled: false }),
    dispose: async () => {
      session.dispose();
    },
  } as any;
}

export class TestAgentControlSession {
  model: any = DEFAULT_TEST_MODEL;
  thinkingLevel = "low" as const;
  isStreaming = false;
  isCompacting = false;
  isRetrying = false;
  autoCompactionEnabled = false;
  autoRetryEnabled = false;
  steeringMode: "all" | "one-at-a-time" = "one-at-a-time";
  followUpMode: "all" | "one-at-a-time" = "one-at-a-time";
  pendingMessageCount = 0;
  sessionId = "session-1";
  sessionName = "";
  sessionFile: string;
  isBashRunning = false;
  abortCalls = 0;
  abortRetryCalls = 0;
  abortBashCalls = 0;
  abortCompactionCalls = 0;
  reloadCalls = 0;
  compactCalls = 0;
  compactError: Error | null = null;
  followUpModeCalls: Array<"all" | "one-at-a-time"> = [];
  steeringModeCalls: Array<"all" | "one-at-a-time"> = [];
  promptCalls: Array<{ text: string; options?: any }> = [];
  labelChanges: Array<{ id: string; label: string }> = [];
  listeners: Array<(event: any) => void> = [];
  sessionContext: any;
  seededEntries: Array<Array<any>> = [];
  extensionRunner: any;
  promptTemplates: Array<{ name: string; description: string }>;
  resourceLoader: any;
  modelRegistry: any;
  modelRuntime: any;
  agent: { state: { messages: any[] }; replaceMessages: (messages: any[]) => void };

  constructor(readonly rootDir: string, modelRegistry: any = createTestModelRegistry()) {
    this.modelRegistry = modelRegistry;
    this.modelRuntime = modelRegistry.modelRuntime;
    this.sessionFile = join(rootDir, "data", "sessions", "web_default", "state-session.jsonl");
    mkdirSync(dirname(this.sessionFile), { recursive: true });
    writeFileSync(this.sessionFile, '{"type":"session","id":"state","version":3}\n');
    this.sessionContext = {
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "Rotated context" }],
          provider: "openai",
          model: "gpt-test",
          usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: "stop",
          timestamp: Date.now(),
        },
      ],
      thinkingLevel: "low",
      model: { provider: "openai", modelId: "gpt-test" },
    };
    this.agent = {
      state: { messages: [] },
      replaceMessages: (messages: any[]) => {
        this.agent.state.messages = [...messages];
      },
    };
    this.extensionRunner = {
      getRegisteredCommands: () => [
        {
          name: "ext",
          invocationName: "ext",
          description: "Extension command",
          sourceInfo: { path: "/ext", source: "extension", scope: "user", origin: "top-level" },
        },
      ],
      getCommand: (name: string) => (name === "ext" ? { name: "ext" } : null),
    };
    this.promptTemplates = [
      { name: "template", description: "Template command", sourceInfo: { path: "/prompts/template.md", source: "template", scope: "project", origin: "top-level" } },
    ];
    this.resourceLoader = {
      getSkills: () => ({
        skills: [
          { name: "demo", description: "Demo skill", sourceInfo: { path: "/skills/demo/SKILL.md", source: "demo", scope: "user", origin: "package" } },
        ],
      }),
    };
  }

  getSteeringMessages() {
    return ["steer"];
  }

  getFollowUpMessages() {
    return [];
  }

  setFollowUpMode(mode: "all" | "one-at-a-time") {
    this.followUpMode = mode;
    this.followUpModeCalls.push(mode);
  }

  setSteeringMode(mode: "all" | "one-at-a-time") {
    this.steeringMode = mode;
    this.steeringModeCalls.push(mode);
  }

  getSessionStats() {
    return {
      sessionId: this.sessionId,
      sessionFile: this.sessionFile,
      userMessages: 2,
      assistantMessages: 1,
      toolCalls: 1,
      toolResults: 0,
      totalMessages: 3,
      tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
      cost: 0.12,
    } as any;
  }

  getContextUsage() {
    return { tokens: 100, contextWindow: 200, percent: 50 } as any;
  }

  getLastAssistantText() {
    return "last response";
  }

  async compact() {
    this.compactCalls += 1;
    if (this.compactError) throw this.compactError;
    this.sessionContext = {
      messages: [
        { role: "compactionSummary", summary: "Summary", tokensBefore: 1200, timestamp: Date.now() },
        {
          role: "assistant",
          content: [{ type: "text", text: "Rotated context" }],
          provider: "openai",
          model: "gpt-test",
          usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: "stop",
          timestamp: Date.now(),
        },
      ],
      thinkingLevel: "low",
      model: { provider: "openai", modelId: "gpt-test" },
    };
    return {
      tokensBefore: 1200,
      estimatedTokensAfter: 42,
      firstKeptEntryId: "entry-1",
      summary: "Summary",
      details: {
        kind: "piclaw.smart_compaction",
        version: 1,
        method: "pipelined",
        execution: "single_pass",
        remoteCompaction: { outcome: "provider_failure", reason: "Remote endpoint returned HTTP 503" },
        modelCallCount: 1,
      },
    } as any;
  }

  setAutoCompactionEnabled(enabled: boolean) {
    this.autoCompactionEnabled = enabled;
  }

  setAutoRetryEnabled(enabled: boolean) {
    this.autoRetryEnabled = enabled;
  }

  abortRetry() {
    this.abortRetryCalls += 1;
  }

  abortBash() {
    this.abortBashCalls += 1;
  }

  abortCompaction() {
    this.abortCompactionCalls += 1;
  }

  cycleModel() {
    return { model: this.model, thinkingLevel: "low", isScoped: false } as any;
  }

  cycleThinkingLevel() {
    return "medium" as any;
  }

  supportsThinking() {
    return true;
  }

  getAvailableThinkingLevels() {
    return getSupportedThinkingLevels(this.model) as any;
  }

  setThinkingLevel(level: any) {
    this.thinkingLevel = clampThinkingLevel(this.model, level) as any;
  }

  async setModel(model: any) {
    this.model = model;
  }

  async reload() {
    this.reloadCalls += 1;
  }

  async abort() {
    this.abortCalls += 1;
  }

  async executeBash() {
    return { output: "ok", exitCode: 0, truncated: false, cancelled: false } as any;
  }

  setSessionName(name: string) {
    this.sessionName = name;
  }

  async newSession(options?: { setup?: (sessionManager: any) => Promise<void> | void }) {
    const nextFile = join(dirname(this.sessionFile), `rotated-${Date.now()}.jsonl`);
    const recorded: Array<any[]> = [];
    if (options?.setup) {
      await options.setup({
        appendSessionInfo: (name: string) => recorded.push(["session_info", name]),
        appendModelChange: (provider: string, modelId: string) => recorded.push(["model_change", provider, modelId]),
        appendThinkingLevelChange: (thinkingLevel: string) => recorded.push(["thinking_level_change", thinkingLevel]),
        appendCompaction: (summary: string, firstKeptEntryId: string, tokensBefore: number) => recorded.push(["compaction", summary, firstKeptEntryId, tokensBefore]),
        appendCustomMessageEntry: (customType: string, content: unknown, display: boolean, details: unknown) => recorded.push(["custom_message", customType, content, display, details]),
        appendMessage: (message: unknown) => recorded.push(["message", message]),
      });
    }
    this.seededEntries.push(recorded);
    mkdirSync(dirname(nextFile), { recursive: true });
    writeFileSync(nextFile, '{"type":"session","id":"rotated","version":3}\n');
    this.sessionFile = nextFile;
    return true;
  }

  async switchSession() {
    return true;
  }

  async fork() {
    return { cancelled: false, selectedText: "Selected" } as any;
  }

  getUserMessagesForForking() {
    return [{ entryId: "entry-1", text: "hello" }];
  }

  async exportToHtml(path?: string) {
    return path || join(this.rootDir, "session.html");
  }

  sessionManager = {
    getLeafId: () => "entry-1",
    getTree: () => [
      {
        entry: { id: "entry-1", type: "message", message: { role: "user", content: [{ type: "text", text: "hello" }] } },
        label: "milestone",
        children: [],
      },
    ],
    buildSessionContext: () => this.sessionContext,
    getHeader: () => ({ type: "session", id: "rotated", version: 3, timestamp: new Date().toISOString(), cwd: this.rootDir }),
    getEntries: () => [],
    appendLabelChange: (id: string, label: string) => {
      this.labelChanges.push({ id, label });
    },
  };

  async navigateTree() {
    return { cancelled: false, aborted: false, editorText: "Navigation text" } as any;
  }

  subscribe(fn: (event: any) => void) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((listener) => listener !== fn);
    };
  }

  async prompt(text: string, options?: any) {
    this.promptCalls.push({ text, options });
    for (const listener of this.listeners) {
      listener({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "queued reply" }] },
      });
    }
  }
}
