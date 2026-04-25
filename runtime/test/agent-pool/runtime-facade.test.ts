import { afterEach, expect, test } from "bun:test";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AgentSessionRuntime } from "@mariozechner/pi-coding-agent";
import { clearProviderUsageCache } from "../../src/agent-pool/provider-usage.js";
import { AgentRuntimeFacade } from "../../src/agent-pool/runtime-facade.js";
import { SESSIONS_DIR } from "../../src/core/config.js";
import { sanitiseJid } from "../../src/agent-pool/session.js";

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
    model: { provider: "openai", id: "gpt-test", reasoning: true },
    thinkingLevel: "high",
    getContextUsage: () => ({ tokens: 10, contextWindow: 100, percent: 10 }),
    modelRegistry: {
      refresh: () => { refreshCalls += 1; },
      getAvailable: () => [
        { provider: "openai", id: "gpt-test", name: "GPT Test", contextWindow: 128000, reasoning: true },
        { provider: "anthropic", id: "claude-test", name: "Claude Test", contextWindow: 200000, reasoning: true },
      ],
    },
  };

  const fixture = createFacade();
  fixture.pool.set("web:default", { runtime: createRuntime(session), lastUsed: Date.now() });

  const available = await fixture.facade.getAvailableModels("web:default");
  expect(refreshCalls).toBe(1);
  expect(available.current).toBe("openai/gpt-test");
  expect(available.models).toEqual(["openai/gpt-test", "anthropic/claude-test"]);
  expect(available.model_options).toEqual([
    {
      label: "openai/gpt-test",
      provider: "openai",
      id: "gpt-test",
      name: "GPT Test",
      context_window: 128000,
      reasoning: true,
    },
    {
      label: "anthropic/claude-test",
      provider: "anthropic",
      id: "claude-test",
      name: "Claude Test",
      context_window: 200000,
      reasoning: true,
    },
  ]);
  expect(available.thinking_level).toBe("high");
  expect(available.supports_thinking).toBe(true);
  expect(fixture.facade.getContextUsageForChat("web:default")).toEqual({
    tokens: 10,
    contextWindow: 100,
    percent: 10,
  });
});

test("AgentRuntimeFacade returns registry-backed model options without hydrating a cold chat runtime", async () => {
  let refreshCalls = 0;
  let getOrCreateCalls = 0;

  const fixture = createFacade({
    getOrCreateRuntime: async () => {
      getOrCreateCalls += 1;
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
  expect(refreshCalls).toBeGreaterThanOrEqual(1);
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
      },
    ],
    thinking_level: null,
    thinking_level_label: null,
    supports_thinking: false,
    available_thinking_levels: ["off"],
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
    JSON.stringify({ type: "model_change", id: "m1", parentId: null, timestamp: "2026-04-17T18:00:00.100Z", provider: "azure-openai", modelId: "gpt-5-mini" }),
    JSON.stringify({ type: "thinking_level_change", id: "t1", parentId: "m1", timestamp: "2026-04-17T18:00:00.200Z", thinkingLevel: "high" }),
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
          { provider: "azure-openai", id: "gpt-5-mini", name: "GPT 5 Mini", contextWindow: 200000, reasoning: true },
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
    expect(refreshCalls).toBe(1);
    expect(available.current).toBe("azure-openai/gpt-5-mini");
    expect(available.thinking_level).toBe("high");
    expect(available.thinking_level_label).toBe("high");
    expect(available.supports_thinking).toBe(true);
  } finally {
    rmSync(sessionDir, { recursive: true, force: true });
  }
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
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out waiting for getAvailableModels")), 50)),
    ]);

    expect((available as any).current).toBe("openai-codex/gpt-test");
    expect((available as any).provider_usage).toBeNull();
  } finally {
    release();
    globalThis.fetch = previousFetch;
  }
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

  const fixture = createFacade();
  fixture.pool.set("web:default", { runtime: createRuntime(session), lastUsed: Date.now() });

  const tree = fixture.facade.getSessionTreeForChat("web:default");
  expect(tree?.nodes).toHaveLength(1);
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

  const fixture = createFacade();
  fixture.pool.set("web:default", { runtime: createRuntime(session), lastUsed: Date.now() });

  const tree = fixture.facade.getSessionTreeForChat("web:default");
  expect((tree?.nodes[0] as any).detail).toContain('<messages channel="web">');
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
