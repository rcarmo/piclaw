import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import { clearProviderUsageCache, peekProviderUsage } from "../../src/agent-pool/provider-usage.js";
import { AgentRuntimeFacade } from "../../src/agent-pool/runtime-facade.js";
import { buildSessionTreeSnapshot } from "../../src/agent-control/session-tree-snapshot.js";
import { SESSIONS_DIR } from "../../src/core/config.js";
import { sanitiseJid } from "../../src/agent-pool/session.js";
import { initDatabase } from "../../src/db.js";
import "../helpers.js";
import { bedrockOpus5Fixtures } from "../fixtures/bedrock-opus5.js";

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
    dispose: async () => {},
  } as any;
}

beforeEach(() => {
  initDatabase();
});

afterEach(() => {
  clearProviderUsageCache();
});

function createFacade(overrides: Partial<ConstructorParameters<typeof AgentRuntimeFacade>[0]> = {}) {
  const pool = new Map<string, { runtime: any; lastUsed: number }>();
  const warnings: string[] = [];
  const errors: string[] = [];
  const cleared: string[] = [];

  const facade = new AgentRuntimeFacade({
    pool,
    getOrCreateRuntime: async (chatJid) => {
      const entry = pool.get(chatJid);
      if (!entry) throw new Error(`Missing session for ${chatJid}`);
      return entry.runtime;
    },
    modelRegistry: {
      getAll: () => [],
      getAvailable: () => [],
      registerProvider: () => {},
    } as any,
    modelRuntime: {
      getProviders: () => [],
      getRegisteredProviderIds: () => [],
      getError: () => undefined,
    } as any,
    authStorage: { get: () => null } as any,
    clearAttachments: (chatJid) => cleared.push(chatJid),
    refreshRuntime: async () => {},
    onWarn: (message) => warnings.push(message),
    onError: (message) => errors.push(message),
    ...overrides,
  });

  return { facade, pool, warnings, errors, cleared };
}

test("AgentRuntimeFacade reports available models and context usage", async () => {
  let refreshCalls = 0;
  const session = {
    sessionId: "session-current",
    model: { provider: "openai", id: "gpt-test", reasoning: true },
    thinkingLevel: "high",
    getContextUsage: () => ({ tokens: 10, contextWindow: 100, percent: 10 }),
    modelRegistry: {
      refresh: () => { refreshCalls += 1; },
      getAvailable: () => [
        { provider: "openai", id: "gpt-test", name: "GPT Test", contextWindow: 128000, reasoning: true, cost: { input: 2.5, output: 10, cacheRead: 0.25, cacheWrite: 0 } },
        { provider: "anthropic", id: "claude-test", name: "Claude Test", contextWindow: 200000, reasoning: true },
      ],
    },
  };

  const fixture = createFacade();
  fixture.pool.set("web:default", { runtime: createRuntime(session), lastUsed: Date.now() });

  const available = await fixture.facade.getAvailableModels("web:default");
  expect(refreshCalls).toBe(0);
  expect(available.current).toBe("openai/gpt-test");
  expect(available.models).toEqual(["openai/gpt-test", "anthropic/claude-test"]);
  expect(available.model_options).toEqual([
    {
      label: "openai/gpt-test",
      provider: "openai",
      id: "gpt-test",
      name: "GPT Test",
      context_window: 128000,
      pricing: {
        input_per_million: 2.5,
        output_per_million: 10,
        cache_read_per_million: 0.25,
        cache_write_per_million: null,
      },
      reasoning: true,
      thinking_levels: ["off", "minimal", "low", "medium", "high"],
      thinking_level_labels: ["off", "minimal", "low", "medium", "high"],
    },
    {
      label: "anthropic/claude-test",
      provider: "anthropic",
      id: "claude-test",
      name: "Claude Test",
      context_window: 200000,
      pricing: null,
      reasoning: true,
      thinking_levels: ["off", "minimal", "low", "medium", "high"],
      thinking_level_labels: ["off", "minimal", "low", "medium", "high"],
    },
  ]);
  expect(available.thinking_level).toBe("high");
  expect(available.supports_thinking).toBe(true);
  expect(fixture.facade.getContextUsageForChat("web:default")).toEqual({
    tokens: 10,
    contextWindow: 100,
    percent: 10,
    sessionGeneration: "session-current",
  });
  expect(fixture.facade.getSessionGenerationForChat("web:default")).toBe("session-current");
});

test("AgentRuntimeFacade publishes one refreshed usage payload per matching known chat", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let fetchCalls = 0;
  const fetchMock = async () => {
    fetchCalls += 1;
    await gate;
    return new Response(JSON.stringify({
      data: {
        level: "enterprise",
        limits: [
          { type: "TOKENS_LIMIT", percentage: 4, nextResetTime: Date.now() + 60_000 },
        ],
      },
    }));
  };
  const previousFetch = globalThis.fetch;
  globalThis.fetch = fetchMock as typeof fetch;
  const refreshes: unknown[] = [];

  try {
    const fixture = createFacade({
      modelRuntime: {
        authPath: "/tmp/auth.json",
        getProviders: () => [],
        getRegisteredProviderIds: () => [],
        getError: () => undefined,
        getAuth: async () => ({ auth: { apiKey: "test-key" } }),
      } as any,
      listKnownChats: () => [
        { chat_jid: "web:zai", model: "zai/glm-4" },
        { chat_jid: "web:other", model: "openai/gpt-5" },
      ],
      onProviderUsageRefresh: (event) => refreshes.push(event),
    });
    const session = {
      model: { provider: "zai", id: "glm-4", reasoning: false },
      thinkingLevel: "off",
      getContextUsage: () => null,
      modelRegistry: { getAvailable: () => [{ provider: "zai", id: "glm-4", reasoning: false }] },
    };
    fixture.pool.set("web:zai", { runtime: createRuntime(session), lastUsed: Date.now() });

    const available = await fixture.facade.getAvailableModels("web:zai");
    await fixture.facade.getAvailableModels("web:zai");
    expect(available.provider_usage).toBeNull();
    expect(peekProviderUsage("zai")).toBeNull();
    await Promise.resolve();
    expect(fetchCalls).toBe(1);
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(refreshes).toHaveLength(1);
    expect(refreshes[0]).toMatchObject({
      chat_jid: "web:zai",
      current: "zai/glm-4",
      provider_usage: { provider: "zai", plan: "enterprise" },
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("AgentRuntimeFacade retries a superseded OpenRouter refresh after the instance credential rotates", async () => {
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let credential = "first-key";
  let fetchCalls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    fetchCalls += 1;
    const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
    if (authorization === "Bearer first-key") {
      await firstGate;
      return new Response(JSON.stringify({ data: { usage: 1, limit: 10, limit_remaining: 9 } }));
    }
    return new Response(JSON.stringify({ data: { usage: 2, limit: 10, limit_remaining: 8 } }));
  }) as typeof fetch;
  const refreshes: Array<{ provider_usage?: { key_usage_usd?: number } }> = [];

  try {
    const model = { provider: "openrouter", id: "auto", reasoning: true };
    const fixture = createFacade({
      modelRegistry: {
        getAll: () => [model],
        getAvailable: () => [model],
        registerProvider: () => {},
      } as any,
      modelRuntime: {
        getProviders: () => [],
        getRegisteredProviderIds: () => [],
        getError: () => undefined,
        getAuth: async () => ({ auth: { apiKey: credential } }),
      } as any,
      listKnownChats: () => [{ chat_jid: "web:openrouter", model: "openrouter/auto" }],
      onProviderUsageRefresh: (event) => refreshes.push(event),
    });
    const session = {
      model,
      thinkingLevel: "high",
      getContextUsage: () => null,
      modelRegistry: { getAvailable: () => [model] },
    };
    fixture.pool.set("web:openrouter", { runtime: createRuntime(session), lastUsed: Date.now() });

    await fixture.facade.getAvailableModels("web:openrouter");
    for (let i = 0; i < 20 && fetchCalls < 1; i += 1) await Promise.resolve();
    expect(fetchCalls).toBe(1);

    credential = "second-key";
    await fixture.facade.getAvailableModels("web:openrouter");
    releaseFirst();
    for (let i = 0; i < 20 && refreshes.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(fetchCalls).toBe(2);
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0]?.provider_usage?.key_usage_usd).toBe(2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("AgentRuntimeFacade reports display labels for legacy max thinking metadata", async () => {
  const legacyModel = {
    provider: "anthropic",
    id: "claude-legacy",
    reasoning: true,
    thinkingLevelMap: { xhigh: "max" },
  };
  const session = {
    model: legacyModel,
    thinkingLevel: "xhigh",
    supportsThinking: () => true,
    getAvailableThinkingLevels: () => ["off", "low", "medium", "high", "xhigh"],
    modelRegistry: {
      refresh: () => {},
      getAvailable: () => [legacyModel],
    },
  };

  const fixture = createFacade();
  fixture.pool.set("web:legacy", { runtime: createRuntime(session), lastUsed: Date.now() });

  const available = await fixture.facade.getAvailableModels("web:legacy");
  expect(available.thinking_level).toBe("xhigh");
  expect(available.thinking_level_label).toBe("max");
  expect(available.available_thinking_levels).toEqual(["off", "low", "medium", "high", "xhigh"]);
  expect(available.available_thinking_level_labels).toEqual(["off", "low", "medium", "high", "max"]);
  expect(available.model_options[0]?.thinking_levels).toEqual(["off", "minimal", "low", "medium", "high", "xhigh"]);
  expect(available.model_options[0]?.thinking_level_labels).toEqual(["off", "minimal", "low", "medium", "high", "max"]);
});

test("AgentRuntimeFacade exposes non-secret provider composition diagnostics", async () => {
  const extensionProvider = {
    id: "custom-ai",
    name: "Custom AI",
    getModels: () => [
      { provider: "custom-ai", id: "configured", reasoning: true },
      { provider: "custom-ai", id: "hidden", reasoning: false },
    ],
  };
  const nativeProvider = {
    id: "native-ai",
    name: "Native AI",
    getModels: () => [{ provider: "native-ai", id: "native", reasoning: false }],
  };
  const fixture = createFacade({
    modelRegistry: {
      refresh: () => {},
      getAvailable: () => [
        { provider: "custom-ai", id: "configured", name: "Configured", contextWindow: 128000, reasoning: true },
        { provider: "native-ai", id: "native", name: "Native", contextWindow: 64000, reasoning: false },
      ],
      getAll: () => [],
      registerProvider: () => {},
    } as any,
    modelRuntime: {
      getProviders: () => [extensionProvider, nativeProvider],
      getRegisteredProviderIds: () => ["custom-ai", "native-ai"],
      getRegisteredProviderConfig: (providerId: string) => providerId === "custom-ai" ? { name: "Custom AI", apiKey: "$CUSTOM_AI_KEY" } : undefined,
      getRegisteredNativeProvider: (providerId: string) => providerId === "native-ai" ? nativeProvider : undefined,
      getProviderAuthStatus: (providerId: string) => providerId === "custom-ai"
        ? { configured: true, source: "environment", label: "CUSTOM_AI_KEY" }
        : { configured: false },
      getCompatibilityRequestConfig: (model: any) => model.provider === "custom-ai"
        ? { authHeader: false, headers: { "X-Diagnostic": "present" } }
        : { authHeader: true },
      getError: () => "composition warning",
    } as any,
  });

  const available = await fixture.facade.getAvailableModels("web:diagnostics");
  expect(available.provider_diagnostics.composition_error).toBe("composition warning");
  expect(available.provider_diagnostics.registered_provider_ids).toEqual(["custom-ai", "native-ai"]);
  expect(available.provider_diagnostics.providers).toEqual([
    {
      provider: "custom-ai",
      name: "Custom AI",
      composed: true,
      registered_extension: true,
      registered_native: false,
      model_count: 2,
      available_model_count: 1,
      auth_configured: true,
      auth_source: "environment",
      auth_label: "CUSTOM_AI_KEY",
      compatibility_auth_header: false,
      compatibility_has_headers: true,
    },
    {
      provider: "native-ai",
      name: "Native AI",
      composed: true,
      registered_extension: false,
      registered_native: true,
      model_count: 1,
      available_model_count: 1,
      auth_configured: false,
      auth_source: null,
      auth_label: null,
      compatibility_auth_header: true,
      compatibility_has_headers: false,
    },
  ]);
});

test("AgentRuntimeFacade filters web model options with scopedModelsOnly enabledModels", async () => {
  const previous = process.env.PICLAW_SCOPED_MODELS_ONLY;
  process.env.PICLAW_SCOPED_MODELS_ONLY = "1";
  try {
    const fixture = createFacade({
      modelRegistry: {
        refresh: () => {},
        getAvailable: () => [
          { provider: "openai", id: "gpt-fast", name: "GPT Fast", contextWindow: 128000, reasoning: true },
          { provider: "anthropic", id: "claude-test", name: "Claude Test", contextWindow: 200000, reasoning: true },
          { provider: "google", id: "gemini-test", name: "Gemini Test", contextWindow: 1000000, reasoning: false },
        ],
        getAll: () => [],
        registerProvider: () => {},
      } as any,
      settingsManager: {
        getEnabledModels: () => ["anthropic/*", "gemini-test"],
      } as any,
    });

    const available = await fixture.facade.getAvailableModels("web:cold-scoped");
    expect(available.scoped_models_only).toBe(true);
    expect(available.scoped_model_filter_active).toBe(true);
    expect(available.enabled_model_patterns).toEqual(["anthropic/*", "gemini-test"]);
    expect(available.models).toEqual(["anthropic/claude-test", "google/gemini-test"]);
    expect(available.model_options.map((m) => m.label)).toEqual(["anthropic/claude-test", "google/gemini-test"]);
    expect(available.model_options.map((m) => m.thinking_levels)).toEqual([
      ["off", "minimal", "low", "medium", "high"],
      ["off"],
    ]);
  } finally {
    if (previous === undefined) delete process.env.PICLAW_SCOPED_MODELS_ONLY;
    else process.env.PICLAW_SCOPED_MODELS_ONLY = previous;
  }
});

test("AgentRuntimeFacade keeps scopedModelsOnly visible when no enabledModels patterns exist", async () => {
  const previous = process.env.PICLAW_SCOPED_MODELS_ONLY;
  process.env.PICLAW_SCOPED_MODELS_ONLY = "1";
  try {
    const fixture = createFacade({
      modelRegistry: {
        refresh: () => {},
        getAvailable: () => [
          { provider: "openai", id: "gpt-fast", name: "GPT Fast", contextWindow: 128000, reasoning: true },
          { provider: "anthropic", id: "claude-test", name: "Claude Test", contextWindow: 200000, reasoning: true },
        ],
        getAll: () => [],
        registerProvider: () => {},
      } as any,
      settingsManager: {
        getEnabledModels: () => [],
      } as any,
    });

    const available = await fixture.facade.getAvailableModels("web:cold-scoped-empty");
    expect(available.scoped_models_only).toBe(true);
    expect(available.scoped_model_filter_active).toBe(false);
    expect(available.enabled_model_patterns).toEqual([]);
    expect(available.models).toEqual(["openai/gpt-fast", "anthropic/claude-test"]);
  } finally {
    if (previous === undefined) delete process.env.PICLAW_SCOPED_MODELS_ONLY;
    else process.env.PICLAW_SCOPED_MODELS_ONLY = previous;
  }
});

test("AgentRuntimeFacade returns registry-backed model options without hydrating a cold chat runtime", async () => {
  let refreshCalls = 0;
  let _getOrCreateCalls = 0;

  const fixture = createFacade({
    getOrCreateRuntime: async () => {
      _getOrCreateCalls += 1;
      throw new Error("cold model lookup should not hydrate a runtime");
    },
    modelRegistry: {
      refresh: () => { refreshCalls += 1; },
      getAvailable: () => [
        { provider: "openai", id: "gpt-fast", name: "GPT Fast", contextWindow: 128000, reasoning: true },
      ],
      getAll: () => [],
      registerProvider: () => {},
    } as any,
  });

  const available = await fixture.facade.getAvailableModels("web:cold");
  // getOrCreateRuntime must not be called synchronously by getAvailableModels.
  // Background async work (e.g. warmProviderUsage) may trigger it after the
  // await returns — we only assert the synchronous path does not hydrate.
  expect(refreshCalls).toBe(0);
  expect(available).toMatchObject({
    current: null,
    models: ["openai/gpt-fast"],
    model_options: [
      {
        label: "openai/gpt-fast",
        provider: "openai",
        id: "gpt-fast",
        name: "GPT Fast",
        context_window: 128000,
        reasoning: true,
        thinking_levels: ["off", "minimal", "low", "medium", "high"],
        thinking_level_labels: ["off", "minimal", "low", "medium", "high"],
      },
    ],
    thinking_level: null,
    thinking_level_label: null,
    supports_thinking: false,
    available_thinking_levels: ["off"],
    available_thinking_level_labels: ["off"],
    provider_usage: null,
  });
});

test("AgentRuntimeFacade restores persisted current model for a cold chat without hydrating a runtime", async () => {
  const chatJid = "web:persisted-model-test";
  const sessionDir = join(SESSIONS_DIR, sanitiseJid(chatJid));
  rmSync(sessionDir, { recursive: true, force: true });
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, "2026-04-17T18-00-00-000Z_test.jsonl"), [
    JSON.stringify({ type: "session", version: 3, id: "test", timestamp: "2026-04-17T18:00:00.000Z", cwd: "/workspace" }),
    JSON.stringify({ type: "model_change", id: "m1", parentId: null, timestamp: "2026-04-17T18:00:00.100Z", provider: "azure-openai", modelId: "gpt-5.6-sol" }),
    JSON.stringify({ type: "thinking_level_change", id: "t1", parentId: "m1", timestamp: "2026-04-17T18:00:00.200Z", thinkingLevel: "max" }),
    "",
  ].join("\n"));

  try {
    let refreshCalls = 0;
    let getOrCreateCalls = 0;
    const pool = new Map<string, { runtime: any; lastUsed: number }>();
    const facade = new AgentRuntimeFacade({
      pool,
      getOrCreateRuntime: async () => {
        getOrCreateCalls += 1;
        throw new Error("cold model lookup should not hydrate a runtime");
      },
      modelRegistry: {
        refresh: () => { refreshCalls += 1; },
        getAvailable: () => [
          {
            provider: "azure-openai",
            id: "gpt-5.6-sol",
            name: "GPT 5.6 Sol",
            contextWindow: 1_050_000,
            reasoning: true,
            thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" },
          },
        ],
        getAll: () => [],
        registerProvider: () => {},
      } as any,
      authStorage: { get: () => null } as any,
      clearAttachments: () => {},
      refreshRuntime: async () => {},
      onWarn: () => {},
      onError: () => {},
    });

    const available = await facade.getAvailableModels(chatJid);
    expect(getOrCreateCalls).toBe(0);
    expect(refreshCalls).toBe(0);
    expect(available.current).toBe("azure-openai/gpt-5.6-sol");
    expect(available.thinking_level).toBe("max");
    expect(available.thinking_level_label).toBe("max");
    expect(available.supports_thinking).toBe(true);
    expect(available.available_thinking_levels).toContain("max");
    expect(available.model_options[0]?.thinking_levels).toEqual(["minimal", "low", "medium", "high", "xhigh", "max"]);
    expect(available.model_options[0]?.thinking_level_labels).toEqual(["minimal", "low", "medium", "high", "xhigh", "max"]);
  } finally {
    rmSync(sessionDir, { recursive: true, force: true });
  }
});

test("AgentRuntimeFacade projects Bedrock Opus 5 native xhigh into Settings model options", async () => {
  const bedrockOpus = bedrockOpus5Fixtures().find((model) => model.id === "us.anthropic.claude-opus-5")!;
  const fixture = createFacade({
    modelRegistry: {
      refresh: () => {},
      getAvailable: () => [bedrockOpus],
      getAll: () => [bedrockOpus],
      registerProvider: () => {},
    } as any,
  });

  const available = await fixture.facade.getAvailableModels("web:bedrock-cold");
  expect(available.models).toEqual(["amazon-bedrock/us.anthropic.claude-opus-5"]);
  expect(available.model_options[0]).toMatchObject({
    provider: "amazon-bedrock",
    context_window: 1_000_000,
    reasoning: true,
  });
  expect(available.model_options[0]?.thinking_levels).toContain("xhigh");
  expect(available.model_options[0]?.thinking_levels).toContain("max");
});

test("AgentRuntimeFacade uses the most recently modified persisted session when restoring cold model state", async () => {
  const chatJid = "web:persisted-model-mtime-test";
  const sessionDir = join(SESSIONS_DIR, sanitiseJid(chatJid));
  rmSync(sessionDir, { recursive: true, force: true });
  mkdirSync(sessionDir, { recursive: true });

  const olderPath = join(sessionDir, "2026-04-18T15-00-00-000Z_newer-name-but-older-mtime.jsonl");
  const newerPath = join(sessionDir, "2026-04-17T10-00-00-000Z_older-name-but-newer-mtime.jsonl");

  writeFileSync(olderPath, [
    JSON.stringify({ type: "session", version: 3, id: "old", timestamp: "2026-04-18T15:00:00.000Z", cwd: "/workspace" }),
    JSON.stringify({ type: "model_change", id: "m1", parentId: null, timestamp: "2026-04-18T15:00:00.100Z", provider: "openai", modelId: "wrong-model" }),
    "",
  ].join("\n"));
  writeFileSync(newerPath, [
    JSON.stringify({ type: "session", version: 3, id: "new", timestamp: "2026-04-17T10:00:00.000Z", cwd: "/workspace" }),
    JSON.stringify({ type: "model_change", id: "m2", parentId: null, timestamp: "2026-04-17T10:00:00.100Z", provider: "anthropic", modelId: "correct-model" }),
    JSON.stringify({ type: "thinking_level_change", id: "t2", parentId: "m2", timestamp: "2026-04-17T10:00:00.200Z", thinkingLevel: "low" }),
    "",
  ].join("\n"));

  const now = new Date();
  const olderMtime = new Date(now.getTime() - 60_000);
  const newerMtime = now;
  utimesSync(olderPath, olderMtime, olderMtime);
  utimesSync(newerPath, newerMtime, newerMtime);

  try {
    const facade = new AgentRuntimeFacade({
      pool: new Map(),
      getOrCreateRuntime: async () => { throw new Error("cold model lookup should not hydrate a runtime"); },
      modelRegistry: {
        refresh: () => {},
        getAvailable: () => [
          { provider: "openai", id: "wrong-model", name: "Wrong Model", contextWindow: 128000, reasoning: false },
          { provider: "anthropic", id: "correct-model", name: "Correct Model", contextWindow: 200000, reasoning: true },
        ],
        getAll: () => [],
        registerProvider: () => {},
      } as any,
      authStorage: { get: () => null } as any,
      clearAttachments: () => {},
      refreshRuntime: async () => {},
      onWarn: () => {},
      onError: () => {},
    });

    const available = await facade.getAvailableModels(chatJid);
    expect(available.current).toBe("anthropic/correct-model");
    expect(available.thinking_level).toBe("low");
    expect(available.thinking_level_label).toBe("low");
    expect(available.supports_thinking).toBe(true);
  } finally {
    rmSync(sessionDir, { recursive: true, force: true });
  }
});

test("AgentRuntimeFacade does not block getAvailableModels on a cold provider-usage refresh", async () => {
  const previousFetch = globalThis.fetch;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalThis.fetch = (async () => {
    await gate;
    return new Response(JSON.stringify({
      plan_type: "pro",
      rate_limit: {
        primary_window: {
          used_percent: 10,
          reset_at: Math.floor(Date.now() / 1000) + 3600,
          limit_window_seconds: 18000,
        },
      },
      credits: {
        balance: 50,
        unlimited: false,
      },
    }));
  }) as any;

  try {
    const session = {
      model: { provider: "openai-codex", id: "gpt-test", reasoning: true },
      thinkingLevel: "high",
      getContextUsage: () => null,
      modelRegistry: {
        refresh: () => {},
        getAvailable: () => [
          { provider: "openai-codex", id: "gpt-test", name: "GPT Test", contextWindow: 128000, reasoning: true },
        ],
      },
    };

    const fixture = createFacade({
      authStorage: {
        get: () => ({ type: "oauth", access: "token", accountId: "acct_123", expires: Date.now() + 60_000 }),
      } as any,
    });
    fixture.pool.set("web:default", { runtime: createRuntime(session), lastUsed: Date.now() });

    const available = await Promise.race([
      fixture.facade.getAvailableModels("web:default"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out waiting for getAvailableModels")), 500)),
    ]);

    expect((available as any).current).toBe("openai-codex/gpt-test");
    expect((available as any).provider_usage).toBeNull();
  } finally {
    release();
    globalThis.fetch = previousFetch;
  }
});

test("AgentRuntimeFacade compacts and retries context pressure while queueing follow-up", async () => {
  let promptCalls = 0;
  let compactCalls = 0;
  const prompts: Array<{ text: string; behavior: string }> = [];
  const listeners: Array<(event: any) => void> = [];
  const session = {
    isStreaming: true,
    subscribe: (listener: (event: any) => void) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
    compact: async () => {
      compactCalls += 1;
    },
    prompt: async (text: string, options?: { streamingBehavior?: string }) => {
      promptCalls += 1;
      prompts.push({ text, behavior: options?.streamingBehavior ?? "" });
      if (promptCalls === 1) {
        for (const listener of listeners) {
          listener({
            type: "message_end",
            message: {
              role: "assistant",
              stopReason: "error",
              errorMessage: "OpenAI API error (400): 400 Your input exceeds the context window of this model. Please adjust your input and try again.",
              content: [],
            },
          });
        }
      }
    },
  };

  const fixture = createFacade();
  fixture.pool.set("web:default", { runtime: createRuntime(session), lastUsed: Date.now() });

  await expect(fixture.facade.queueStreamingMessage("web:default", "continue", "followUp")).resolves.toEqual({ queued: true });
  expect(promptCalls).toBe(2);
  expect(compactCalls).toBe(1);
  expect(prompts).toEqual([
    { text: "continue", behavior: "followUp" },
    { text: "continue", behavior: "followUp" },
  ]);
});

test("AgentRuntimeFacade removes one queued follow-up and replays the remaining queue", async () => {
  const prompts: Array<{ text: string; behavior: string }> = [];
  const session = {
    isStreaming: true,
    getFollowUpMessages: () => ["first", "second", "third"],
    clearQueue: () => ({ steering: ["keep steer"], followUp: ["first", "second", "third"] }),
    prompt: async (text: string, options?: { streamingBehavior?: string }) => {
      prompts.push({ text, behavior: options?.streamingBehavior ?? "" });
    },
  };

  const fixture = createFacade();
  fixture.pool.set("web:default", { runtime: createRuntime(session), lastUsed: Date.now() });

  await expect(fixture.facade.removeQueuedFollowupMessage("web:default", "second")).resolves.toBe(true);
  expect(prompts).toEqual([
    { text: "keep steer", behavior: "steer" },
    { text: "first", behavior: "followUp" },
    { text: "third", behavior: "followUp" },
  ]);
});

test("AgentRuntimeFacade restores the original queue when queued follow-up removal replay fails", async () => {
  const prompts: Array<{ text: string; behavior: string }> = [];
  let thirdFollowupAttempts = 0;
  let queue = {
    steering: ["keep steer"],
    followUp: ["first", "second", "third"],
  };

  const session = {
    isStreaming: true,
    getFollowUpMessages: () => [...queue.followUp],
    clearQueue: () => {
      const cleared = {
        steering: [...queue.steering],
        followUp: [...queue.followUp],
      };
      queue = { steering: [], followUp: [] };
      return cleared;
    },
    prompt: async (text: string, options?: { streamingBehavior?: string }) => {
      prompts.push({ text, behavior: options?.streamingBehavior ?? "" });
      if (text === "third" && options?.streamingBehavior === "followUp" && thirdFollowupAttempts++ === 0) {
        throw new Error("requeue failed");
      }
      if (options?.streamingBehavior === "steer") {
        queue.steering.push(text);
      } else if (options?.streamingBehavior === "followUp") {
        queue.followUp.push(text);
      }
    },
  };

  const fixture = createFacade();
  fixture.pool.set("web:default", { runtime: createRuntime(session), lastUsed: Date.now() });

  await expect(fixture.facade.removeQueuedFollowupMessage("web:default", "second")).resolves.toBe(false);
  expect(queue).toEqual({
    steering: ["keep steer"],
    followUp: ["first", "second", "third"],
  });
  expect(fixture.warnings).toContain("Failed to remove queued follow-up");
});

test("AgentRuntimeFacade normalizes session-tree user prompts for display while keeping raw detail", () => {
  const session = {
    sessionManager: {
      getLeafId: () => "m1",
      getTree: () => [
        {
          label: null,
          children: [],
          entry: {
            id: "m1",
            parentId: null,
            type: "message",
            timestamp: "2026-04-12T22:24:55Z",
            message: {
              role: "user",
              content: [
                {
                  type: "text",
                  text: [
                    "Channel: web",
                    "",
                    "Formatting:",
                    "Markdown is allowed.",
                    "",
                    "Rui Carmo @ 2026-04-12T22:24:55Z:",
                    "  show a normalized preview.",
                  ].join("\n"),
                },
              ],
            },
          },
        },
      ],
    },
  };

  const tree = buildSessionTreeSnapshot(session.sessionManager as any);
  expect(tree.nodes).toHaveLength(1);
  expect(tree?.nodes[0]).toMatchObject({
    id: "m1",
    role: "user",
    detail: "Rui Carmo (2026-04-12T22:24:55Z): show a normalized preview.",
    previewText: "show a normalized preview.",
  });
  expect((tree?.nodes[0] as any).rawDetail).toContain("Channel: web");
});

test("AgentRuntimeFacade leaves legacy XML session-tree entries unnormalized", () => {
  const session = {
    sessionManager: {
      getLeafId: () => "m1",
      getTree: () => [
        {
          label: null,
          children: [],
          entry: {
            id: "m1",
            parentId: null,
            type: "message",
            timestamp: "2026-04-12T22:24:55Z",
            message: {
              role: "user",
              content: [{ type: "text", text: '<messages channel="web"><message sender="You" time="2026-04-12T22:24:55Z">hello</message></messages>' }],
            },
          },
        },
      ],
    },
  };

  const tree = buildSessionTreeSnapshot(session.sessionManager as any);
  expect((tree.nodes[0] as any).detail).toContain('<messages channel="web">');
  expect((tree?.nodes[0] as any).previewText).toBeUndefined();
  expect((tree?.nodes[0] as any).rawDetail).toBeUndefined();
});

test("AgentRuntimeFacade clears attachments around slash commands", async () => {
  const session = { marker: true };
  let refreshCalls = 0;
  const fixture = createFacade({
    refreshRuntime: async () => {
      refreshCalls += 1;
    },
    executeSlashCommandFn: async (incomingSession, chatJid, rawText) => ({
      ok: incomingSession === session,
      chatJid,
      rawText,
      refresh_runtime: true,
    } as any),
  });
  fixture.pool.set("web:default", { runtime: createRuntime(session), lastUsed: Date.now() });

  const result = await fixture.facade.applySlashCommand("web:default", "/tasks");
  expect(result).toEqual({ ok: true, chatJid: "web:default", rawText: "/tasks", refresh_runtime: true });
  expect(fixture.cleared).toEqual(["web:default", "web:default"]);
  expect(refreshCalls).toBe(1);
});

test("AgentRuntimeFacade reports control-command session generation changes", async () => {
  const previousSession = { sessionId: "session-old" };
  const nextSession = { sessionId: "session-new" };
  const runtime = createRuntime(previousSession);
  const fixture = createFacade({
    applyControlCommandFn: async () => {
      runtime.session = nextSession as any;
      return { status: "success", message: "Started a new session." };
    },
  });
  fixture.pool.set("web:default", { runtime, lastUsed: Date.now() });

  await expect(fixture.facade.applyControlCommand("web:default", { type: "new_session", raw: "/new-session" } as any)).resolves.toEqual({
    status: "success",
    message: "Started a new session.",
    sessionGeneration: "session-new",
    sessionGenerationChanged: true,
  });
});

test("AgentRuntimeFacade scopes command context usage to its originating session generation", async () => {
  const session = { sessionId: "session-compact" };
  const runtime = createRuntime(session);
  const fixture = createFacade({
    applyControlCommandFn: async () => ({
      status: "success",
      message: "Compaction complete.",
      contextUsage: {
        tokens: 123,
        contextWindow: 1000,
        percent: 12.3,
        source: "compact_command",
      },
    }),
  });
  fixture.pool.set("web:default", { runtime, lastUsed: Date.now() });

  await expect(fixture.facade.applyControlCommand("web:default", { type: "compact", raw: "/compact" } as any)).resolves.toMatchObject({
    sessionGeneration: "session-compact",
    contextUsage: {
      tokens: 123,
      contextWindow: 1000,
      percent: 12.3,
      source: "compact_command",
      sessionGeneration: "session-compact",
    },
  });
});

test("AgentRuntimeFacade keeps slow command usage scoped to the session that produced it", async () => {
  const previousSession = { sessionId: "session-old" };
  const nextSession = { sessionId: "session-new" };
  const runtime = createRuntime(previousSession);
  const fixture = createFacade({
    applyControlCommandFn: async () => {
      runtime.session = nextSession as any;
      return {
        status: "success",
        message: "Compaction complete.",
        contextUsage: { tokens: 900, contextWindow: 1000, percent: 90 },
      };
    },
  });
  fixture.pool.set("web:default", { runtime, lastUsed: Date.now() });

  await expect(fixture.facade.applyControlCommand("web:default", { type: "compact", raw: "/compact" } as any)).resolves.toMatchObject({
    sessionGeneration: "session-new",
    sessionGenerationChanged: true,
    contextUsage: {
      tokens: 900,
      sessionGeneration: "session-old",
    },
  });
});

test("AgentRuntimeFacade refreshes runtime when a control command requests it without swapping sessions", async () => {
  const session = { marker: true };
  let refreshCalls = 0;
  const fixture = createFacade({
    refreshRuntime: async () => {
      refreshCalls += 1;
    },
    applyControlCommandFn: async () => ({
      status: "success",
      message: "Agent restarted.",
      refresh_runtime: true,
    }),
  });
  fixture.pool.set("web:default", { runtime: createRuntime(session), lastUsed: Date.now() });

  const result = await fixture.facade.applyControlCommand("web:default", { type: "restart", raw: "/restart" } as any);
  expect(result).toEqual({
    status: "success",
    message: "Agent restarted.",
    refresh_runtime: true,
  });
  expect(refreshCalls).toBe(1);
});
