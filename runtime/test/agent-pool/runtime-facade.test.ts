import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import { clearProviderUsageCache, peekProviderUsage } from "../../src/agent-pool/provider-usage.js";
import { AgentPool } from "../../src/agent-pool.js";
import { AgentRuntimeFacade } from "../../src/agent-pool/runtime-facade.js";
import { buildSessionTreeSnapshot } from "../../src/agent-control/session-tree-snapshot.js";
import { SESSIONS_DIR } from "../../src/core/config.js";
import { sanitiseJid } from "../../src/agent-pool/session-paths.js";
import { initDatabase } from "../../src/db.js";
import "../helpers.js";
import { bedrockOpus5Fixtures } from "../fixtures/bedrock-opus5.js";
import { getNativeCommandCatalogue } from "../../src/agent-control/native-control-capabilities.js";
import { parseControlCommand } from "../../src/agent-control/agent-control-parser.js";

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

function createNativePositionPort(overrides: Record<string, any> = {}) {
  const model = "model" in overrides ? overrides.model : "synthetic/reasoning";
  const thinkingLevel = "thinkingLevel" in overrides ? overrides.thinkingLevel : "off";
  const position = overrides.position ?? "0";
  const tokens = overrides.tokens ?? 10;
  const contextWindow = overrides.contextWindow ?? 100;
  return {
    sessionId: overrides.sessionId ?? "native-session",
    branchId: overrides.branchId ?? "main",
    readPosition: async () => position,
    readState: async () => ({ position, model, thinkingLevel }),
    readModel: async () => model,
    readThinkingLevel: async () => thinkingLevel,
    readContextUsage: async () => ({ tokens, contextWindow }),
    ...overrides,
  };
}

test("durable runtime lookup must be callable", () => {
  const pool = new Map<string, { runtime: any; lastUsed: number }>();
  expect(() => new AgentRuntimeFacade({
    pool,
    getDurableSession: "invalid-durable-runtime-lookup" as unknown as (chatJid: string) => undefined,
    getOrCreateRuntime: async () => { throw new Error("legacy runtime must not open"); },
    modelRegistry: { getAll: () => [], getAvailable: () => [], registerProvider: () => {} } as any,
    modelRuntime: { getProviders: () => [], getRegisteredProviderIds: () => [], getError: () => undefined } as any,
    authPath: "/tmp/runtime-facade-auth.json",
    clearAttachments: () => {},
    refreshRuntime: async () => {},
  })).toThrow("Durable runtime lookup must be callable");
});

test("durable runtime binding must be an object", () => {
  const { facade } = createFacade({ getDurableSession: () => null as any });
  expect(() => facade.getSessionGenerationForChat("web:invalid-runtime-binding")).toThrow("Durable runtime binding must be an object");
});

test("durable runtime binding requires non-empty sessionId", () => {
  const { facade } = createFacade({ getDurableSession: () => ({ sessionId: "", branchId: "main", readPosition: async () => null } as any) });
  expect(() => facade.getSessionGenerationForChat("web:invalid-runtime-session-id")).toThrow("Durable runtime sessionId must be non-empty");
});

test("durable runtime binding requires non-empty branchId", () => {
  const { facade } = createFacade({ getDurableSession: () => ({ sessionId: "binding", branchId: "", readPosition: async () => null } as any) });
  expect(() => facade.getSessionGenerationForChat("web:invalid-runtime-branch-id")).toThrow("Durable runtime branchId must be non-empty");
});

test("durable runtime binding requires callable readPosition", () => {
  const { facade } = createFacade({ getDurableSession: () => ({ sessionId: "binding", branchId: "main", readPosition: "not-callable" } as any) });
  expect(() => facade.getSessionGenerationForChat("web:invalid-runtime-read-position")).toThrow("Durable runtime readPosition must be callable");
});

test("durable runtime lifetimeSignal must be AbortSignal-like", () => {
  const { facade } = createFacade({
    getDurableSession: () => ({
      sessionId: "binding",
      branchId: "main",
      readPosition: async () => null,
      lifetimeSignal: "invalid-runtime-signal-shape",
    } as any),
  });
  expect(() => facade.getSessionGenerationForChat("web:invalid-runtime-signal")).toThrow("Durable runtime lifetimeSignal must be AbortSignal-like");
});

test("durable runtime lifetimeSignal requires removeEventListener", () => {
  const { facade } = createFacade({
    getDurableSession: () => ({
      sessionId: "binding",
      branchId: "main",
      readPosition: async () => null,
      lifetimeSignal: { aborted: false, addEventListener() {} },
    } as any),
  });
  expect(() => facade.getSessionGenerationForChat("web:invalid-runtime-signal-shape")).toThrow("Durable runtime lifetimeSignal must be AbortSignal-like");
});

test("durable runtime binding requires callable readModel when present", () => {
  const { facade } = createFacade({
    getDurableSession: () => ({
      sessionId: "binding",
      branchId: "main",
      readPosition: async () => null,
      readModel: "not-callable",
    } as any),
  });
  expect(() => facade.getSessionGenerationForChat("web:invalid-runtime-read-model")).toThrow("Durable runtime readModel must be callable");
});

test("durable runtime binding requires callable readContextUsage when present", () => {
  const { facade } = createFacade({
    getDurableSession: () => ({
      sessionId: "binding",
      branchId: "main",
      readPosition: async () => null,
      readContextUsage: "not-callable",
    } as any),
  });
  expect(() => facade.getSessionGenerationForChat("web:invalid-runtime-read-context-usage")).toThrow("Durable runtime readContextUsage must be callable");
});

test("native host-only controls and state never construct a legacy session", async () => {
  let legacy = 0, acquired = 0, released = 0;
  const port = { sessionId: "native-host", branchId: "main", readPosition: async () => "7",
    readModel: async () => "test/model", readThinkingLevel: async () => "off" };
  const { facade } = createFacade({ getDurableSession: () => port,
    acquireCommandProtection: () => { acquired++; return () => { released++; }; },
    getOrCreateRuntime: async () => { legacy++; throw Error("Legacy must not open"); } });
  const state = await facade.applyControlCommand("web:native-host", { type: "state", raw: "/state" });
  expect(state).toMatchObject({ status: "success" });
  expect(state.message).toContain("pi-durable SQLite");
  expect(state.message).toContain("test/model");
  for (const type of ["agent_name", "agent_avatar", "user_name", "user_avatar", "user_github", "qr", "search_workspace"] as const) {
    const result = await facade.applyControlCommand("web:native-host", { type, raw: `/${type}` });
    expect(result.status).toBe(["qr", "search_workspace", "user_github"].includes(type) ? "error" : "success");
    expect(result.message).not.toContain("unavailable. No legacy session");
  }
  const passkey = await facade.applyControlCommand("web:native-host", { type: "passkey", raw: "/passkey" });
  expect(passkey.message).toMatch(/Passkey commands|Passkeys are disabled/);
  const totp = await facade.applyControlCommand("web:native-host", { type: "totp", action: "invalid", raw: "/totp invalid" });
  expect(totp).toMatchObject({ status: "error", message: "Usage: /totp enrol|enroll|reset" });
  const shell = await facade.applyControlCommand("web:native-host", { type: "shell", command: "printf NATIVE_SHELL_PORT_OK", raw: "/shell printf NATIVE_SHELL_PORT_OK" });
  expect(shell.status).toBe("success");
  expect(shell.message).toContain("NATIVE_SHELL_PORT_OK");
  expect(legacy).toBe(0);
  expect(acquired).toBe(10); expect(released).toBe(acquired);
});

test("every unavailable native command and alias fails closed without reading or mutating a session", async () => {
  let legacy = 0, hostCalls = 0;
  const unexpected = async (): Promise<never> => { hostCalls++; throw Error("Unavailable command entered host control"); };
  const port = { sessionId: "native-audit", branchId: "main", readPosition: unexpected,
    readModel: unexpected, setModel: unexpected, readThinkingLevel: unexpected, setThinkingLevel: unexpected,
    reset: unexpected, abort: unexpected, compact: unexpected, readTree: unexpected, readReport: unexpected };
  const { facade } = createFacade({ getDurableSession: chat => chat === "web:native-audit" ? port : undefined,
    getOrCreateRuntime: async () => { legacy++; throw Error("Legacy must never open"); } });
  const unavailable = getNativeCommandCatalogue(port).filter(command => command.status === "unavailable");
  expect(unavailable.length).toBeGreaterThan(0);
  for (const definition of unavailable) {
    for (const raw of new Set([definition.name, definition.name.replace(/-/g, "_"), ...(definition.aliases ?? [])])) {
      const command = parseControlCommand(raw);
      expect(command).not.toBeNull();
      const result = await facade.applyControlCommand("web:native-audit", command!);
      expect(result.status).toBe("error");
      expect(result.message).toContain("No legacy session was opened");
    }
  }
  expect(hostCalls).toBe(0);
  expect(legacy).toBe(0);
});

test("native provider authentication uses a host-owned lifetime, never an AgentSession", async () => {
  const lifetime = new AbortController();
  let controls = 0, protectedCount = 0, released = 0;
  const port = Object.freeze({ sessionId: "native-auth", branchId: "main", readPosition: async () => null, lifetimeSignal: lifetime.signal,
    assertCurrent() { expect(this.sessionId).toBe("native-auth"); },
    async runOwnedControl<T>(operation: () => Promise<T>) { controls++; return operation(); } });
  const { facade } = createFacade({ getDurableSession: chat => chat === "web:native-auth" ? port : undefined,
    modelRuntime: { listCredentials: async () => [], getProviders: () => [], getProviderAuthStatus: () => ({ configured: false }) } as any,
    acquireCommandProtection: () => { protectedCount++; return () => { released++; }; },
    getOrCreateRuntime: async () => { throw Error("Legacy session must never open"); } });
  expect(Reflect.set(port, "assertCurrent", () => { throw Error("Mutated authority port"); })).toBe(false);
  for (const type of ["login", "logout"] as const) {
    const result = await facade.applyControlCommand("web:native-auth", { type, raw: `/${type}` });
    expect(result.status).toBe("success"); expect(result.message).toBe("Provider authentication"); expect(result.contentBlocks).toHaveLength(1);
  }
  expect(controls).toBe(2); expect(protectedCount).toBe(2); expect(released).toBe(2);
  lifetime.abort();
  await expect(facade.applyControlCommand("web:native-auth", { type: "login", raw: "/login" })).rejects.toThrow("Native authentication lifetime unavailable");
  expect(controls).toBe(2);
});

test("native authentication without an owned lifetime fails closed", async () => {
  const { facade } = createFacade({ getDurableSession: chat => chat === "web:no-auth-scope" ? { sessionId: "native", branchId: "main", readPosition: async () => null } : undefined });
  for (const type of ["login", "logout"] as const) expect(await facade.applyControlCommand("web:no-auth-scope", { type, raw: `/${type}` }))
    .toEqual({ status: "error", message: "Native authentication lifetime unavailable. No legacy session was opened." });
});

test("native report controls use captured passive SDK reports, never a legacy session", async () => {
  let reads = 0, legacy = 0;
  const report = { activeEntries: 7, userMessages: 2, assistantMessages: 3, contextWindow: 10000,
    observedTokens: 30, observedModel: "test/model", lastAnswer: "exact committed final answer",
    usage: { input: 10, output: 20, cacheRead: 5, cacheWrite: 2, cost: 0.125 } };
  const port = Object.freeze({ sessionId: "native-report", branchId: "main", readPosition: async () => null,
    readModel: async () => "test/model",
    async readReport() { expect(this.sessionId).toBe("native-report"); reads++; return report; } });
  const { facade } = createFacade({ getDurableSession: chat => chat === "web:report" ? port : undefined,
    getOrCreateRuntime: async () => { legacy++; throw Error("Legacy must not open"); } });
  expect(Reflect.set(port, "readReport", async () => { throw Error("Mutated report port"); })).toBe(false);
  const stats = await facade.applyControlCommand("web:report", { type: "stats", raw: "/stats" });
  expect(stats.status).toBe("success"); expect(stats.message).toContain("10 / 20"); expect(stats.message).toContain("$0.125000");
  const ctx = await facade.applyControlCommand("web:report", { type: "context", raw: "/context" });
  expect(ctx.status).toBe("success"); expect(ctx.message).toContain("test/model"); expect(ctx.message).toContain("not a next-request fit estimate");
  const last = await facade.applyControlCommand("web:report", { type: "last", raw: "/last" });
  expect(last).toEqual({ status: "success", message: "Last assistant response:\n\nexact committed final answer" });
  const catalogue = await facade.applyControlCommand("web:report", { type: "commands", raw: "/commands" });
  expect(catalogue.status).toBe("success");
  expect(catalogue.message).toContain("/queue | web input");
  expect(catalogue.message).toContain("/fork | unavailable");
  expect(catalogue.message).toContain("/stats | native");
  const quota = await facade.applyControlCommand("web:report", { type: "quota", raw: "/quota" });
  expect(quota.status).toBe("success"); expect(quota.message).toContain("test/model");
  expect(reads).toBe(3); expect(legacy).toBe(0);
});

test("native cycle controls reuse fenced model/thinking ports and preserve captured receivers", async () => {
  const models = ["a", "b"].map(id => ({ provider: "test", id, name: id, api: "openai-completions", reasoning: false,
    input: ["text"], contextWindow: 10000, maxTokens: 100, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }));
  let current = "test/a", thinking = "off", aborts = 0;
  const port = Object.freeze({ sessionId: "native-cycle", branchId: "main", readPosition: async () => null,
    readModel: async () => current, readThinkingLevel: async () => thinking,
    async setModel(model: { provider: string; modelId: string }) { expect(this.sessionId).toBe("native-cycle"); current = `${model.provider}/${model.modelId}`; },
    async setThinkingLevel(level: string) { expect(this.sessionId).toBe("native-cycle"); thinking = level; },
    async abort() { expect(this.sessionId).toBe("native-cycle"); aborts++; return false; } });
  const { facade } = createFacade({ getDurableSession: chat => chat === "web:cycles" ? port : undefined,
    modelRegistry: { getAll: () => models, getAvailable: () => models, find: (p: string, id: string) => models.find(m => m.provider === p && m.id === id) } as any });
  expect(Reflect.set(port, "abort", async () => { throw Error("Mutated abort port"); })).toBe(false);
  expect((await facade.applyControlCommand("web:cycles", { type: "cycle_model", raw: "/cycle-model" })).status).toBe("success");
  expect(current).toBe("test/b");
  expect((await facade.applyControlCommand("web:cycles", { type: "cycle_model", direction: "backward", raw: "/cycle-model backward" })).status).toBe("success");
  expect(current).toBe("test/a");
  expect((await facade.applyControlCommand("web:cycles", { type: "cycle_thinking", raw: "/cycle-thinking" })).status).toBe("success");
  expect(thinking).toBe("off");
  expect((await facade.applyControlCommand("web:cycles", { type: "abort", raw: "/abort" })).status).toBe("success");
  expect(aborts).toBe(1);
});

test("current model uses captured durable port and rejects unbound chats without legacy fallback", async () => {
  const port = { sessionId: "session", branchId: "main", readPosition: async () => null,
    readModel: async () => "persisted/model" };
  const ports = new Map([["bound", Object.freeze(port)],
    ["unsupported", Object.freeze({ sessionId: "other", branchId: "main", readPosition: async () => null })]]);
  const fixture = createFacade({ getDurableSession: chat => ports.get(chat) });
  expect(await fixture.facade.getCurrentModelLabel("bound")).toBe("persisted/model");
  await expect(fixture.facade.getCurrentModelLabel("unsupported")).rejects.toThrow("Durable session model unavailable");
  fixture.pool.set("legacy", { runtime: createRuntime({ model: { provider: "legacy", id: "model" } }), lastUsed: 0 });
  await expect(fixture.facade.getCurrentModelLabel("legacy")).rejects.toThrow("Durable session model unavailable");
  await expect(fixture.facade.getSessionTreeForChat("unknown")).rejects.toThrow("Durable session tree unavailable");
  await expect(fixture.facade.saveSessionPosition("unknown")).rejects.toThrow("Durable session position unavailable");
  const legacy = createFacade();
  legacy.pool.set("legacy", { runtime: createRuntime({ model: { provider: "legacy", id: "model" } }), lastUsed: 0 });
  await expect(legacy.facade.getCurrentModelLabel("legacy")).rejects.toThrow("Durable session model unavailable");
});

test("tree summaries await captured public readers, preserve raw head and reject missing durable bindings", async () => {
  const snapshot = { version: 1 as const, leafId: "hidden-head", visibleLeafId: "visible", nodes: [], flat: true as const, total: 3 };
  const port = Object.freeze({ sessionId: "generation", branchId: "main", readPosition: async () => "hidden-head",
    async readTree() { expect(this.sessionId).toBe("generation"); return snapshot; } });
  const fixture = createFacade({ getDurableSession: chat => chat === "bound" ? port : chat === "unsupported" ? { sessionId: "other", branchId: "main", readPosition: async () => null } : undefined });
  expect(Reflect.set(port, "readTree", async () => { throw Error("mutated reader"); })).toBe(false);
  expect(await fixture.facade.getSessionTreeSummaryForChat("bound")).toEqual({ leafId: "hidden-head", total: 3 });
  expect(fixture.facade.getSessionGenerationForChat("bound")).toBe("generation");
  expect(fixture.facade.getSessionGenerationForChat("unknown")).toBeNull();
  fixture.pool.set("unknown", { runtime: createRuntime({}), lastUsed: 0 });
  await expect(fixture.facade.getSessionTreeSummaryForChat("unknown")).rejects.toThrow("Durable session tree unavailable");
  await expect(fixture.facade.getSessionTreeSummaryForChat("unsupported")).rejects.toThrow("Durable session tree unavailable");
  const legacy = createFacade({ getOrCreateRuntime: async () => { throw Error("must not instantiate"); } });
  // Unbound native metadata must refuse, not fall back to a cold legacy-session lookup.
  await expect(legacy.facade.getSessionTreeSummaryForChat("unknown")).rejects.toThrow("Durable session tree unavailable");
  const normal = createFacade();
  normal.pool.set("legacy", { runtime: createRuntime({ sessionManager: { getLeafId: () => "raw", getTree: () => [], getEntries: () => { throw Error("private entry count forbidden"); } } }), lastUsed: 0 });
  await expect(normal.facade.getSessionTreeSummaryForChat("legacy")).rejects.toThrow("Durable session tree unavailable");
});

test("durable context uses the captured native estimate and never legacy metadata or counters", async () => {
  let tokens: number | null = 1234, window: number | null = 12345;
  let release!: () => void, hold: Promise<void> = Promise.resolve();
  const port = { sessionId: "generation", branchId: "main", readPosition: async () => null,
    readContextUsage: async () => { await hold; return { tokens, contextWindow: window }; } };
  const ports = new Map<string, any>([["bound", port], ["missing", { sessionId: "missing", branchId: "main", readPosition: async () => null }]]);
  const fixture = createFacade({ getDurableSession: chat => ports.get(chat),
    getOrCreateRuntime: async () => { throw Error("legacy forbidden"); },
    modelRuntime: { getPhysicalModel() { throw Error("legacy metadata forbidden"); } } as any });
  const expected = { tokens: 1234, contextWindow: 12345, percent: 1234 / 12345 * 100, sessionGeneration: "generation", tokensAreAuthoritative: true };
  expect(await fixture.facade.getContextUsageForChat("bound")).toEqual(expected);
  for (window of [0, -1, NaN, Infinity, null]) {
    expect(await fixture.facade.getContextUsageForChat("bound")).toEqual({ ...expected, contextWindow: null, percent: null });
  }
  window = 12345;
  for (tokens of [-1, NaN, Infinity, null]) {
    expect(await fixture.facade.getContextUsageForChat("bound")).toEqual({ ...expected, tokens: null, percent: null });
  }
  tokens = 0;
  expect(await fixture.facade.getContextUsageForChat("bound")).toEqual({ ...expected, tokens: 0, percent: 0 });
  await expect(fixture.facade.getContextUsageForChat("missing")).rejects.toThrow("Durable context reader unavailable");
  await expect(fixture.facade.getContextUsageForChat("unknown")).rejects.toThrow("Durable application does not construct legacy sessions");
  tokens = 2345; window = 54321; hold = new Promise<void>(resolve => { release = resolve; });
  const pending = fixture.facade.getContextUsageForChat("bound");
  ports.set("bound", { ...port, sessionId: "replacement" }); release();
  expect(await pending).toEqual({ ...expected, tokens, contextWindow: window, percent: tokens / window * 100 });
  ports.set("bound", { ...port, readContextUsage: async () => { throw Error("Stale owner"); } });
  await expect(fixture.facade.getContextUsageForChat("bound")).rejects.toThrow("Stale owner");
});

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

  const fixture = createFacade({ getDurableSession: chat => chat === "web:default" ? createNativePositionPort({sessionId:"session-current",model:"openai/gpt-test",thinkingLevel:"high"}) : undefined, modelRegistry: session.modelRegistry as any });

  const available = await fixture.facade.getAvailableModels("web:default");
  const compact = await fixture.facade.getAvailableModels("web:default", { includeCatalogue: false, includeProviderDiagnostics: false });
  expect(compact.models).toEqual(['openai/gpt-test']);
  expect(compact.model_options).toHaveLength(1);
  expect(compact.available_model_count).toBe(2);
  expect(compact.current).toBe(available.current);
  expect(compact.thinking_level).toBe(available.thinking_level);
  expect(compact.provider_diagnostics.providers).toEqual([]);
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
  expect(await fixture.facade.getContextUsageForChat("web:default")).toEqual({
    tokens: 10,
    contextWindow: 100,
    percent: 10,
    sessionGeneration: "session-current",
    tokensAreAuthoritative: true,
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
      getDurableSession: chat => chat === "web:zai" ? createNativePositionPort({model:"zai/glm-4"}) : chat === "web:other" ? createNativePositionPort({model:"openai/gpt-5"}) : undefined,
      modelRegistry: {getAvailable:()=>[{provider:"zai",id:"glm-4",reasoning:false}]} as any,
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
      getDurableSession: chat => chat === "web:openrouter" ? createNativePositionPort({model:"openrouter/auto",thinkingLevel:"high"}) : undefined,
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

test("AgentRuntimeFacade keeps canonical thinking levels and rejects legacy max alias display", async () => {
  const legacyModel = {
    provider: "anthropic",
    id: "claude-legacy",
    reasoning: true,
    thinkingLevelMap: { xhigh: "max" },
  };
  const port = createNativePositionPort({
    sessionId: "legacy-thinking",
    model: "anthropic/claude-legacy",
    thinkingLevel: "xhigh",
  });

  // Legacy xhigh->max metadata is a compatibility alias only; the durable native
  // state and canonical SDK levels must not be rewritten to the retired max label.
  const fixture = createFacade({
    getDurableSession: () => port,
    modelRegistry: {
      refresh: () => {},
      getAvailable: () => [legacyModel],
      getAll: () => [legacyModel],
      registerProvider: () => {},
    } as any,
  });

  const available = await fixture.facade.getAvailableModels("web:legacy", { includeProviderUsage: false, includeProviderDiagnostics: false });
  expect(available.thinking_level).toBe("xhigh");
  expect(available.thinking_level_label).toBe("xhigh");
  expect(available.available_thinking_levels).toEqual(["off", "minimal", "low", "medium", "high", "xhigh"]);
  expect(available.available_thinking_level_labels).toEqual(["off", "minimal", "low", "medium", "high", "xhigh"]);
  expect(available.model_options[0]?.thinking_levels).toEqual(["off", "minimal", "low", "medium", "high", "xhigh"]);
  expect(available.model_options[0]?.thinking_level_labels).toEqual(["off", "minimal", "low", "medium", "high", "xhigh"]);
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
      getDurableSession: () => createNativePositionPort({model:null,thinkingLevel:null}),
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
      getDurableSession: () => createNativePositionPort({model:null,thinkingLevel:null}),
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
      getDurableSession: () => createNativePositionPort({model:null,thinkingLevel:null}),
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
      getDurableSession: () => createNativePositionPort({model:null,thinkingLevel:null}),
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
  // Native metadata never hydrates a legacy runtime, synchronously or in background.
  expect(_getOrCreateCalls).toBe(0);
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
    available_thinking_levels: [],
    available_thinking_level_labels: [],
    provider_usage: null,
  });
});

test("AgentRuntimeFacade prefers explicit native metadata over stale JSONL session files", async () => {
  const chatJid = "web:native-reader-wins";
  const sessionDir = join(SESSIONS_DIR, sanitiseJid(chatJid));
  rmSync(sessionDir, { recursive: true, force: true });
  mkdirSync(sessionDir, { recursive: true });
  const stalePath = join(sessionDir, "2026-04-17T18-00-00-000Z_stale-file.jsonl");
  writeFileSync(stalePath, [
    JSON.stringify({ type: "session", version: 3, id: "stale", timestamp: "2026-04-17T18:00:00.000Z", cwd: "/workspace" }),
    JSON.stringify({ type: "model_change", id: "m1", parentId: null, timestamp: "2026-04-17T18:00:00.100Z", provider: "azure-openai", modelId: "stale-model" }),
    JSON.stringify({ type: "thinking_level_change", id: "t1", parentId: "m1", timestamp: "2026-04-17T18:00:00.200Z", thinkingLevel: "low" }),
    "",
  ].join("\n"));

  const original = readFileSync(stalePath);
  try {
    const fixture = createFacade({
      getDurableSession: () => createNativePositionPort({
        sessionId: "native-reader-win",
        model: "azure-openai/gpt-5.6-sol",
        thinkingLevel: "max",
        tokens: 42,
        contextWindow: 84,
      }),
      modelRegistry: {
        refresh: () => {},
        getAvailable: () => [{
          provider: "azure-openai",
          id: "gpt-5.6-sol",
          name: "GPT 5.6 Sol",
          contextWindow: 1_050_000,
          reasoning: true,
          thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" },
        }],
        getAll: () => [],
        registerProvider: () => {},
      } as any,
    });

    const available = await fixture.facade.getAvailableModels(chatJid, { includeProviderUsage: false, includeProviderDiagnostics: false });
    expect(available.current).toBe("azure-openai/gpt-5.6-sol");
    expect(available.thinking_level).toBe("max");
    expect(available.thinking_level_label).toBe("max");
    expect(available.supports_thinking).toBe(true);
    expect(available.model_options[0]?.thinking_levels).toEqual(["minimal", "low", "medium", "high", "xhigh", "max"]);
    expect(readFileSync(stalePath)).toEqual(original);
  } finally {
    rmSync(sessionDir, { recursive: true, force: true });
  }
});

test("AgentRuntimeFacade projects Bedrock Opus 5 native xhigh into Settings model options", async () => {
  const bedrockOpus = bedrockOpus5Fixtures().find((model) => model.id === "us.anthropic.claude-opus-5")!;
  const fixture = createFacade({
      getDurableSession: () => createNativePositionPort({model:null,thinkingLevel:null}),
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

test("AgentRuntimeFacade fails closed when native model metadata is missing even if stale JSONL files exist", async () => {
  const chatJid = "web:missing-native-reader";
  const sessionDir = join(SESSIONS_DIR, sanitiseJid(chatJid));
  rmSync(sessionDir, { recursive: true, force: true });
  mkdirSync(sessionDir, { recursive: true });

  const stalePath = join(sessionDir, "2026-04-17T10-00-00-000Z_oldest-stale-file.jsonl");
  writeFileSync(stalePath, [
    JSON.stringify({ type: "session", version: 3, id: "new", timestamp: "2026-04-17T10:00:00.000Z", cwd: "/workspace" }),
    JSON.stringify({ type: "model_change", id: "m2", parentId: null, timestamp: "2026-04-17T10:00:00.100Z", provider: "anthropic", modelId: "correct-model" }),
    JSON.stringify({ type: "thinking_level_change", id: "t2", parentId: "m2", timestamp: "2026-04-17T10:00:00.200Z", thinkingLevel: "low" }),
    "",
  ].join("\n"));

  const original = readFileSync(stalePath);
  try {
    const { facade } = createFacade({
      getDurableSession: () => ({ sessionId: "missing-native", branchId: "main", readPosition: async () => "0" }),
      modelRegistry: {
        refresh: () => {},
        getAvailable: () => [
          { provider: "anthropic", id: "correct-model", name: "Correct Model", contextWindow: 200000, reasoning: true },
        ],
        getAll: () => [],
        registerProvider: () => {},
      } as any,
    });

    await expect(facade.getAvailableModels(chatJid, { includeProviderUsage: false, includeProviderDiagnostics: false })).rejects.toThrow("Durable session model unavailable");
    expect(readFileSync(stalePath)).toEqual(original);
  } finally {
    rmSync(sessionDir, { recursive: true, force: true });
  }
});

test("AgentRuntimeFacade does not block getAvailableModels on a cold provider-usage refresh", async () => {
  const previousFetch = globalThis.fetch;
  let release!: () => void; let fetchCalls=0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalThis.fetch = (async () => {
    fetchCalls++; await gate;
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
      getDurableSession: () => createNativePositionPort({model:"openai-codex/gpt-test",thinkingLevel:"high"}),
      modelRegistry: session.modelRegistry as any,
      authStorage: {
        get: () => ({ type: "oauth", access: "token", accountId: "acct_123", expires: Date.now() + 60_000 }),
      } as any,
    });

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

test("native pool/facade expose no SDK queue mutation API", () => {
  const { facade } = createFacade();
  for (const target of [facade, AgentPool.prototype]) {
    expect("queueStreamingMessage" in target).toBe(false);
    expect("removeQueuedFollowupMessage" in target).toBe(false);
  }
});

for (const raw of ["/queue queued", "/queue-all queued", "/steer queued"]) {
  test("native direct queue command rejects before lookup/factory/protection: " + raw, async () => {
    let lookups=0, legacy=0, protectedCalls=0;
    const { facade } = createFacade({
      getDurableSession() { lookups++; throw Error("queue must not resolve a session"); },
      async getOrCreateRuntime() { legacy++; throw Error("legacy must not open"); },
      acquireCommandProtection() { protectedCalls++; return () => {}; },
    });
    const command = parseControlCommand(raw);
    expect(command).not.toBeNull();
    expect(await facade.applyControlCommand("web:queue-boundary",command!))
      .toMatchObject({status:"error",message:"Native queue commands require host input admission. No legacy session was opened."});
    expect([lookups,legacy,protectedCalls]).toEqual([0,0,0]);
  });
}

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

test("durable compact captures one port for the whole command without legacy fallback", async () => {
  let lookups = 0, compactions = 0, legacyCalls = 0, releases = 0;
  const port = { sessionId: "captured-generation", branchId: "main", readPosition: async () => null,
    async readContextUsage() { return { tokens: 10, contextWindow: 1000 }; },
    async compact(instructions?: string) { compactions++; expect(instructions).toBe("keep decisions"); return { compacted: true }; } };
  const { facade } = createFacade({
    getDurableSession() { return ++lookups === 1 ? port : undefined; },
    async getOrCreateRuntime() { legacyCalls++; throw Error("Legacy forbidden"); },
    acquireCommandProtection() { return () => { releases++; }; },
  });
  expect(await facade.applyControlCommand("web:captured", { type: "compact", instructions: " keep decisions " })).toMatchObject({ status: "success", sessionGeneration: "captured-generation", contextUsage: { tokens: 10, contextWindow: 1000, percent: 1 } });
  expect(lookups).toBe(1);
  expect(compactions).toBe(1);
  expect(legacyCalls).toBe(0);
  expect(releases).toBe(1);
});

test("durable tree command uses its captured port without resolving another generation", async () => {
  let lookups = 0, reads = 0, legacyCalls = 0;
  const port = { sessionId: "tree-generation", branchId: "main", readPosition: async () => null,
    async readTree() { reads++; expect(this.sessionId).toBe("tree-generation"); return { version: 1 as const, leafId: null, nodes: [], flat: true as const, total: 0 }; } };
  const { facade } = createFacade({ getDurableSession() { return ++lookups === 1 ? port : undefined; },
    async getOrCreateRuntime() { legacyCalls++; throw Error("Legacy forbidden"); } });
  expect(await facade.applyControlCommand("web:tree-captured", { type: "tree" })).toMatchObject({ status: "success" });
  expect(lookups).toBe(1);
  expect(reads).toBe(1);
  expect(legacyCalls).toBe(0);
});

for (const fails of [false, true]) test(`durable model command protects its captured port and releases on ${fails ? 'failure' : 'success'}`, async () => {
  const events: string[] = [];
  const fault = Error('model switch denied');
  const port = { sessionId: 'model-generation', branchId: 'main', readPosition: async () => null,
    async setModel(model: { provider: string; modelId: string }) {
      events.push('set'); expect(model).toEqual({ provider: 'synthetic', modelId: 'approved' });
      if (fails) throw fault;
    } };
  let lookups = 0;
  const { facade } = createFacade({ getDurableSession() { lookups++; return port; },
    modelRegistry: { getAll: () => [{ provider: 'synthetic', id: 'approved' }], getAvailable: () => [{ provider: 'synthetic', id: 'approved' }] } as any,
    acquireCommandProtection(chat) { expect(chat).toBe('web:model-protected'); events.push('protect'); return () => { events.push('release'); }; },
  });
  const result = facade.applyControlCommand('web:model-protected', { type: 'model', provider: 'synthetic', modelId: 'approved' });
  if (fails) expect(await result).toMatchObject({ status: 'error', message: 'model switch denied' });
  else expect(await result).toMatchObject({ status: 'success', message: 'Model set to synthetic/approved.' });
  expect(events).toEqual(['protect', 'set', 'release']);
  expect(lookups).toBe(1);
});

test('durable model query lists unique available models with persisted selection and no mutation', async () => {
  let lookups = 0, reads = 0, protection = 0;
  const { facade } = createFacade({ getDurableSession() { lookups++; return { sessionId: 'query', branchId: 'main', readPosition: async () => null,
    async readModel() { reads++; return 'z/current'; } }; },
    modelRegistry: { getAvailable: () => [{ provider: 'z', id: 'current' }, { provider: 'a', id: 'other' }, { provider: 'z', id: 'current' }] } as any,
    acquireCommandProtection() { protection++; return () => {}; },
  });
  expect(await facade.applyControlCommand('web:model-query', { type: 'model', raw: '/model' })).toEqual({ status: 'success', message: 'Available models:\n  a/other\n  z/current (current)' });
  expect(lookups).toBe(1);
  expect(reads).toBe(1);
  expect(protection).toBe(0);
  expect(await facade.applyControlCommand('web:model-query', { type: 'model', provider: 'z', raw: '/model z/' })).toMatchObject({ status: 'error', message: 'Invalid model format. Use /model <provider>/<modelId>.' });
});

test('durable model picker reads persisted thinking level without legacy hydration', async () => {
  const { facade } = createFacade({ getDurableSession: chat => chat === 'web:thinking' ? {
    sessionId: 'thinking', branchId: 'main', readPosition: async () => null,
    readModel: async () => 'synthetic/reasoning', readThinkingLevel: async () => 'high',
  } : undefined, modelRegistry: { getAvailable: () => [{ provider: 'synthetic', id: 'reasoning', reasoning: true }] } as any });
  expect(await facade.getAvailableModels('web:thinking', { includeProviderUsage: false, includeProviderDiagnostics: false })).toMatchObject({ current: 'synthetic/reasoning', thinking_level: 'high' });
});

test('durable state and model picker reuse one coherent native state read', async () => {
  let reads = 0;
  const port = { sessionId: 'coherent', branchId: 'main',
    async readState() { reads++; return { position: '42', model: 'synthetic/reasoning', thinkingLevel: 'high' }; },
    async readPosition() { throw Error('split position read'); } };
  const { facade } = createFacade({ getDurableSession: () => port,
    modelRegistry: { getAvailable: () => [{ provider: 'synthetic', id: 'reasoning', reasoning: true }] } as any });
  expect(await facade.applyControlCommand('web:coherent', { type: 'state' })).toMatchObject({ status: 'success', message: expect.stringContaining('Position: 42') });
  expect(reads).toBe(1);
  expect(await facade.getAvailableModels('web:coherent', { includeProviderUsage: false, includeProviderDiagnostics: false }))
    .toMatchObject({ current: 'synthetic/reasoning', thinking_level: 'high' });
  expect(reads).toBe(2);
});

test('durable thinking query reads persisted level and rejects mutation before reading', async () => {
  let reads = 0, protections = 0;
  const { facade } = createFacade({ getDurableSession: () => ({ sessionId: 'thinking-query', branchId: 'main', readPosition: async () => null,
    readModel: async () => 'synthetic/reasoning', async readThinkingLevel() { reads++; return 'high'; } }),
    modelRegistry: { getAvailable: () => [{ provider: 'synthetic', id: 'reasoning', reasoning: true }] } as any,
    acquireCommandProtection() { protections++; return () => {}; },
  });
  expect(await facade.applyControlCommand('web:thinking-query', { type: 'thinking', raw: '/thinking' })).toMatchObject({ status: 'success', thinking_level: 'high', thinking_level_label: 'high' });
  expect(reads).toBe(1);
  expect(protections).toBe(0);
  await expect(facade.applyControlCommand('web:thinking-query', { type: 'thinking', level: 'low', raw: '/thinking low' })).rejects.toThrow('Durable thinking mutation unavailable');
  expect(reads).toBe(1);
});

test('durable model catalogue query reuses configured model scope', async () => {
  const previous = process.env.PICLAW_SCOPED_MODELS_ONLY;
  process.env.PICLAW_SCOPED_MODELS_ONLY = '1';
  try {
    const { facade } = createFacade({ getDurableSession: chat => chat === 'web:scoped-query' ? { sessionId: 'scope', branchId: 'main', readPosition: async () => null, readModel: async () => 'synthetic/allowed' } : undefined,
      modelRegistry: { getAvailable: () => [{ provider: 'synthetic', id: 'allowed' }, { provider: 'synthetic', id: 'hidden' }] } as any,
      settingsManager: { getEnabledModels: () => ['synthetic/allowed'] } as any,
    });
    expect(await facade.applyControlCommand('web:scoped-query', { type: 'model', raw: '/model' })).toEqual({ status: 'success', message: 'Available models:\n  synthetic/allowed (current)' });
  } finally {
    if (previous === undefined) delete process.env.PICLAW_SCOPED_MODELS_ONLY;
    else process.env.PICLAW_SCOPED_MODELS_ONLY = previous;
  }
});

test('durable thinking mutation uses existing protection and preserves provider selection', async () => {
  const events: string[] = [];
  const { facade } = createFacade({ getDurableSession: chat => chat === 'web:thinking-set' ? { sessionId: 'set', branchId: 'main', readPosition: async () => null,
    readModel: async () => 'synthetic/reasoning', readThinkingLevel: async () => 'low',
    async setThinkingLevel(level) { events.push(level); } } : undefined,
    modelRegistry: { getAvailable: () => [{ provider: 'synthetic', id: 'reasoning', reasoning: true }] } as any,
    acquireCommandProtection() { events.push('protect'); return () => { events.push('release'); }; },
  });
  expect(await facade.applyControlCommand('web:thinking-set', { type: 'thinking', level: 'high', raw: '/thinking high' })).toMatchObject({ status: 'success', thinking_level: 'high' });
  expect(events).toEqual(['protect', 'high', 'release']);
  expect(await facade.applyControlCommand('web:thinking-set', { type: 'thinking', level: 'invalid', raw: '/thinking invalid' })).toMatchObject({ status: 'error' });
  expect(events).toEqual(['protect', 'high', 'release']);
});


test("durable reset publishes its new zero context and never a pre-reset count", async () => {
  let tokens = 900;
  const port = { sessionId: "reset-generation", branchId: "main", readPosition: async () => null,
    async reset() { tokens = 0; }, async readContextUsage() { return { tokens, contextWindow: 1000 }; } };
  const { facade } = createFacade({ getDurableSession: () => port });
  expect(await facade.applyControlCommand("web:reset", { type: "new_session", raw: "/new-session" })).toMatchObject({ status: "success", contextUsage: { tokens: 0, contextWindow: 1000, percent: 0, sessionGeneration: "reset-generation", tokensAreAuthoritative: true } });
});


test('durable thinking mutation returns a user-facing error and releases protection rather than escaping as HTTP 500', async () => {
  const events: string[] = [];
  const model = {provider:'synthetic',id:'reasoner',reasoning:true};
  const {facade}=createFacade({getDurableSession:()=>({sessionId:'failure',branchId:'main',readPosition:async()=>null,
    readModel:async()=> 'synthetic/reasoner',readThinkingLevel:async()=> 'off',setThinkingLevel:async()=>{events.push('set');throw Error('maintenance in progress');}}),
    modelRegistry:{getAvailable:()=>[model]} as any,acquireCommandProtection(){events.push('protect');return ()=>{events.push('release');};}});
  expect(await facade.applyControlCommand('web:thinking-failure',{type:'thinking',level:'high',raw:'/thinking high'})).toMatchObject({status:'error',message:'maintenance in progress'});
  expect(events).toEqual(['protect','set','release']);
});

for (const name of ["exit", "restart"] as const) test(`native /${name} bypasses absent, revoked and wedged session authority`, async () => {
  let exits = 0, lookups = 0, legacy = 0;
  (globalThis as any).__PICLAW_EXIT_SCHEDULER__ = () => { exits++; };
  try {
    const { facade } = createFacade({ getDurableSession: () => { lookups++; throw Error("Harness permanently stuck"); },
      getOrCreateRuntime: async () => { legacy++; throw Error("legacy forbidden"); } });
    expect(await facade.applyControlCommand("web:unbound", parseControlCommand(`/${name}`)!)).toMatchObject({status:"success"});
    expect(exits).toBe(1); expect(lookups).toBe(0); expect(legacy).toBe(0);
    const lifetime = new AbortController(); lifetime.abort();
    const { facade: revoked } = createFacade({ getDurableSession: () => ({sessionId:"revoked",branchId:"main",readPosition:async()=>null,
      lifetimeSignal:lifetime.signal,assertCurrent(){throw Error("revoked");}}) });
    expect((await revoked.applyControlCommand("web:revoked",parseControlCommand(`/${name}`)!)).status).toBe("success");
    expect(exits).toBe(2);
  } finally { delete (globalThis as any).__PICLAW_EXIT_SCHEDULER__; }
});

test("native critical controls preserve scope, report failures and never fall back to legacy", async()=>{
 let legacy=0,restarts=0,bashes=0,abortBash=0,abortRetry=0,revoked=false;
 const policy={autoCompact:true,autoRetry:false};const lifetime=new AbortController();
 const port={sessionId:'native-critical',branchId:'main',readPosition:async()=>null,lifetimeSignal:lifetime.signal,
  assertCurrent(){if(revoked)throw Error('binding lost');},restart:async()=>{restarts++;},
  runBash:async(command:string)=>{bashes++;return {output:command,exitCode:0,cancelled:false};},
  abortBash:async()=>{abortBash++;return true;},abortRetry:async()=>{abortRetry++;return false;},
  readExecutionPolicy:async()=>({...policy}),setExecutionPolicy:async(key:'autoCompact'|'autoRetry',enabled:boolean)=>{policy[key]=enabled;}};
 const {facade}=createFacade({getDurableSession:()=>port,getOrCreateRuntime:async()=>{legacy++;throw Error('legacy');}});
 const run=(raw:string)=>facade.applyControlCommand('web:native-critical',parseControlCommand(raw)!);
 expect((await run('/bash printf TEST')).message).toContain('saved to native context');expect(bashes).toBe(1);
 expect((await run('/bash')).status).toBe('error');expect(bashes).toBe(1);
 expect((await run('/abort-bash')).message).toContain('requested');expect(abortBash).toBe(1);
 expect((await run('/abort-retry')).message).toContain('No retry');expect(abortRetry).toBe(1);
 expect((await run('/auto-retry on')).message).toContain('enabled (runtime-wide)');expect(policy.autoRetry).toBe(true);
 expect((await run('/auto-retry off')).message).toContain('disabled');expect(policy.autoRetry).toBe(false);
 expect((await run('/auto-compact off')).message).toContain('disabled');expect(policy.autoCompact).toBe(false);
 expect((await run('/auto-compact invalid')).status).toBe('error');expect(policy.autoCompact).toBe(false);
 revoked=true;expect((await run('/bash printf NO')).message).toContain('binding lost');expect(restarts).toBe(0);
 lifetime.abort();expect((await run('/bash printf NO')).status).toBe('error');expect(bashes).toBe(1);expect(legacy).toBe(0);
});


for (const native of [false, true]) for (const supportsOff of [false, true]) {
  test(`cold/native=${native} thinking capabilities agree with catalogue and command (off=${supportsOff})`, async () => {
    let reads = 0, writes = 0, legacy = 0;
    const model = { provider: 'synthetic', id: 'capabilities', reasoning: true,
      thinkingLevelMap: { off: supportsOff ? 'none' : null, minimal: null, low: 'low', medium: null, high: 'high' } };
    const port = { sessionId: 'capabilities', branchId: 'main', readPosition: async () => null,
      readModel: async () => 'synthetic/capabilities', readThinkingLevel: async () => { reads++; return 'high'; },
      setThinkingLevel: async () => { writes++; } };
    const { facade } = createFacade({ ...(native ? { getDurableSession: () => port } : {}),
      modelRegistry: { getAvailable: () => [model] } as any,
      getOrCreateRuntime: async () => { legacy++; throw Error('legacy hydration forbidden'); } });
    if (!native) {
      for (const includeCatalogue of [true,false]) await expect(facade.getAvailableModels('web:capabilities',{includeCatalogue,includeProviderUsage:false,includeProviderDiagnostics:false})).rejects.toThrow('Durable session model unavailable');
      expect([reads,writes,legacy]).toEqual([0,0,0]); return;
    }
    for (const includeCatalogue of [true, false]) {
      const status = await facade.getAvailableModels('web:capabilities', { includeCatalogue, includeProviderUsage: false, includeProviderDiagnostics: false });
      // Cold non-native has no persisted selection. Native must report exact
      // model-specific support, not add the generic no-session 'off' fallback.
      if (native) {
        const expected = supportsOff ? ['off', 'low', 'high'] : ['low', 'high'];
        expect(status.available_thinking_levels).toEqual(expected);
        expect(status.available_thinking_level_labels).toEqual(expected);
        expect(status.model_options[0]?.thinking_levels).toEqual(expected);
      } else expect(status.available_thinking_levels).toEqual(['off']);
    }
    if (native) {
      const query = await facade.applyControlCommand('web:capabilities', { type: 'thinking', raw: '/thinking' });
      expect(query.message).toContain(supportsOff ? 'Available levels: off, low, high' : 'Available levels: low, high');
      expect(await facade.applyControlCommand('web:capabilities', { type: 'thinking', level: 'off', raw: '/thinking off' })).toMatchObject({ status: supportsOff ? 'success' : 'error' });
      expect(writes).toBe(supportsOff ? 1 : 0);
      expect(reads).toBe(3);
      expect(await facade.applyControlCommand('web:capabilities', { type: 'cycle_thinking', raw: '/cycle-thinking' })).toMatchObject({ status: 'success', thinking_level: supportsOff ? 'off' : 'low' });
      expect(writes).toBe(supportsOff ? 2 : 1);
    }
    expect(legacy).toBe(0);
  });
}

test("native model command refreshes the shared authenticated catalogue before selecting a newly published model", async () => {
  const added = { provider: "synthetic", id: "new-sol", name: "New Sol", api: "openai-responses" } as any;
  const routedAlias = { ...added, provider: "router", id: "synthetic/new-sol" };
  let available: any[] = [routedAlias], refreshes = 0, current = "synthetic/old";
  const { facade } = createFacade({
    getDurableSession: () => createNativePositionPort({
      readModel: async () => current,
      async setModel(choice: { provider: string; modelId: string }) { current = `${choice.provider}/${choice.modelId}`; },
    }),
    modelRegistry: { getAll: () => [added], getAvailable: () => available } as any,
    modelRuntime: { async refresh(options: any) { expect(options).toMatchObject({ force: true, allowNetwork: true }); refreshes++; available = [routedAlias, added]; return { aborted: false, errors: new Map() }; }, getAvailableSnapshot: () => available } as any,
  });
  const result = await facade.applyControlCommand("web:live-model", { type: "model", provider: "synthetic", modelId: "new-sol", raw: "/model synthetic/new-sol" });
  expect(result.status).toBe("success"); expect(current).toBe("synthetic/new-sol"); expect(refreshes).toBe(1);
  expect((await facade.applyControlCommand("web:live-model", { type: "model", provider: "synthetic", modelId: "new-sol", raw: "/model synthetic/new-sol" })).status).toBe("success");
  expect(refreshes).toBe(1);
});
