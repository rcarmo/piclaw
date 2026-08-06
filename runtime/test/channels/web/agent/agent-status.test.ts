import { afterEach, describe, expect, test } from "bun:test";
import {
  handleAgentContextRequest,
  handleAgentModelsRequest,
  handleAgentStatusRequest,
  type AgentStatusContext,
} from "../../../../src/channels/web/agent/agent-status.js";
import { resetMcpStartupStateForTests } from "../../../../src/secure/mcp-keychain.js";
import { createJsonResponder } from "../helpers/http.js";

afterEach(() => resetMcpStartupStateForTests());

function createContext(overrides: Partial<AgentStatusContext> = {}): AgentStatusContext {
  return {
    defaultChatJid: "web:default",
    json: createJsonResponder(),
    getAgentStatus: () => null,
    getExtensionWorkingState: () => null,
    recoverStaleInflightRun: () => false,
    getBuffer: () => undefined,
    getContextUsageForChat: async () => null,
    getTokenUsageForChat: () => null,
    getAvailableModels: async () => ({ models: [] }),
    getProviderReadyCompletedForInstance: () => false,
    ...overrides,
  };
}

describe("web agent status helpers", () => {
  test("handleAgentStatusRequest returns idle status when no active agent", async () => {
    const req = new Request("https://example.com/agent/status");
    const res = handleAgentStatusRequest(req, createContext());

    expect(res.status).toBe(200);
    expect(res.headers.get("Server-Timing")).toContain("agent_status;dur=");
    expect(await res.json()).toEqual({
      status: "idle",
      state: "idle",
      chat_jid: "web:default",
      data: null,
      extension_working: null,
      addon_api: { degraded: false, entries: [] },
      mcp_startup: { degraded: false, servers: [] },
    });
  });

  test("handleAgentStatusRequest exposes quarantined MCP startup servers", async () => {
    const { hydrateMcpKeychainCredentials } = await import("../../../../src/secure/mcp-keychain.js");
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = mkdtempSync(join(tmpdir(), "piclaw-mcp-status-"));
    mkdirSync(join(root, ".pi"), { recursive: true });
    writeFileSync(join(root, ".pi", "mcp.json"), JSON.stringify({
      mcpServers: { broken: { bearerTokenKeychain: "broken/token" } },
    }));
    await hydrateMcpKeychainCredentials(root);

    const body = await handleAgentStatusRequest(
      new Request("https://example.com/agent/status"),
      createContext(),
    ).json();
    expect(body.mcp_startup).toEqual({
      degraded: true,
      servers: [{ server_name: "broken", reason: "must set a valid bearerTokenEnv with bearerTokenKeychain." }],
    });
  });

  test("handleAgentStatusRequest triggers stale inflight recovery when no active status exists", async () => {
    const req = new Request("https://example.com/agent/status?chat_jid=web:ux");
    const calls: Array<{ chatJid: string; hasActiveStatus?: boolean }> = [];
    const res = handleAgentStatusRequest(req, createContext({
      getAgentStatus: () => null,
      recoverStaleInflightRun: (chatJid, options) => {
        calls.push({ chatJid, hasActiveStatus: options?.hasActiveStatus });
        return true;
      },
    }));

    expect(res.status).toBe(200);
    expect(calls).toEqual([{ chatJid: "web:ux", hasActiveStatus: false }]);
    expect(await res.json()).toEqual({
      status: "idle",
      state: "idle",
      chat_jid: "web:ux",
      data: null,
      extension_working: null,
      addon_api: { degraded: false, entries: [] },
      mcp_startup: { degraded: false, servers: [] },
    });
  });

  test("handleAgentStatusRequest exposes a brief done payload without reporting the agent active", async () => {
    const req = new Request("https://example.com/agent/status?chat_jid=web:done");
    const terminal = { type: "done", title: "Completed /session-rotate", turn_id: "turn-done" };
    const res = handleAgentStatusRequest(req, createContext({ getAgentStatus: () => terminal }));

    expect(await res.json()).toMatchObject({
      status: "idle",
      state: "idle",
      chat_jid: "web:done",
      data: terminal,
    });
  });

  test("handleAgentStatusRequest includes thought/draft buffers when available", async () => {
    const req = new Request("https://example.com/agent/status?chat_jid=web:custom");
    const res = handleAgentStatusRequest(
      req,
      createContext({
        getAgentStatus: (chatJid) => ({ chatJid, turn_id: "turn-1", state: "thinking" }),
        getExtensionWorkingState: () => ({ message: "Compacting context…", indicator: { mode: "default" }, visible: true }),
        getBuffer: (_turnId, panel) =>
          panel === "thought"
            ? { text: "thought text", totalLines: 2, updatedAt: 1 }
            : { text: "draft text", totalLines: 1, updatedAt: 1 },
      })
    );

    expect(res.headers.get("Server-Timing")).toContain("agent_status;dur=");
    const body = await res.json();
    expect(body.status).toBe("active");
    expect(body.state).toBe("thinking");
    expect(body.chat_jid).toBe("web:custom");
    expect(body.data.chatJid).toBe("web:custom");
    expect(body.extension_working).toEqual({ message: "Compacting context…", indicator: { mode: "default" }, visible: true });
    expect(body.thought).toEqual({ text: "thought text", totalLines: 2 });
    expect(body.draft).toEqual({ text: "draft text", totalLines: 1 });
  });

  test("handleAgentStatusRequest classifies auth failures as blocked_auth", async () => {
    const req = new Request("https://example.com/agent/status?chat_jid=web:auth");
    const res = handleAgentStatusRequest(req, createContext({
      getAgentStatus: () => ({
        type: "error",
        title: "No API key for provider: openai-codex",
        detail: "Token refresh failed: 401",
      }),
    }));

    const body = await res.json();
    expect(body.status).toBe("idle");
    expect(body.state).toBe("blocked_auth");
    expect(body.classifier).toBeNull();
  });

  test("handleAgentStatusRequest exposes recovery_suppressed classifier state", async () => {
    const req = new Request("https://example.com/agent/status?chat_jid=web:suppressed");
    const res = handleAgentStatusRequest(req, createContext({
      getAgentStatus: () => ({
        type: "error",
        title: "Automatic recovery suppressed",
        classifier: "recovery_suppressed",
        recovery_suppressed_reason: "Repeated identical failures in recovery window.",
      }),
    }));

    const body = await res.json();
    expect(body.state).toBe("recovery_suppressed");
    expect(body.recovery_suppressed_reason).toBe("Repeated identical failures in recovery window.");
  });

  test("handleAgentContextRequest returns null fields when usage is unavailable", async () => {
    const req = new Request("https://example.com/agent/context");
    const res = await handleAgentContextRequest(req, createContext());

    expect(res.status).toBe(200);
    expect(res.headers.get("Server-Timing")).toContain("agent_context;dur=");
    expect(await res.json()).toEqual({ tokens: null, contextWindow: null, percent: null, cacheUsage: null });
  });

  test("handleAgentContextRequest includes prompt cache-hit telemetry", async () => {
    const req = new Request("https://example.com/agent/context?chat_jid=web:usage");
    const res = await handleAgentContextRequest(req, createContext({
      getContextUsageForChat: async () => ({ tokens: 5000, contextWindow: 100000, percent: 5 }),
      getTokenUsageForChat: () => ({
        latest: {
          input_tokens: 1000,
          output_tokens: 300,
          reasoning_tokens: 40,
          cache_read_tokens: 3000,
          cache_write_tokens: 1000,
          total_tokens: 5300,
          cost_total: 0.012,
          runs: 1,
          model: "claude-sonnet",
          response_model: "claude-sonnet-4",
          provider: "anthropic",
          run_at: "2026-06-08T12:00:00.000Z",
        },
        totals: {
          input_tokens: 2000,
          output_tokens: 600,
          reasoning_tokens: 80,
          cache_read_tokens: 6000,
          cache_write_tokens: 2000,
          total_tokens: 10600,
          cost_total: 0.024,
          runs: 2,
        },
      }),
    }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      tokens: 5000,
      contextWindow: 100000,
      percent: 5,
      cacheUsage: {
        latest: {
          inputTokens: 1000,
          outputTokens: 300,
          reasoningTokens: 40,
          cacheReadTokens: 3000,
          cacheWriteTokens: 1000,
          totalTokens: 5300,
          costTotal: 0.012,
          runs: 1,
          cacheHitRate: 60,
          model: "claude-sonnet",
          responseModel: "claude-sonnet-4",
          provider: "anthropic",
          api: null,
          turns: null,
          runAt: "2026-06-08T12:00:00.000Z",
        },
        totals: {
          inputTokens: 2000,
          outputTokens: 600,
          reasoningTokens: 80,
          cacheReadTokens: 6000,
          cacheWriteTokens: 2000,
          totalTokens: 10600,
          costTotal: 0.024,
          runs: 2,
          cacheHitRate: 60,
        },
      },
    });
  });

  test("handleAgentModelsRequest returns payload from model provider", async () => {
    const req = new Request("https://example.com/agent/models");
    const payload = { models: [{ id: "openai/gpt-5" }] };
    const res = await handleAgentModelsRequest(
      req,
      createContext({
        getAvailableModels: async () => payload,
        getProviderReadyCompletedForInstance: () => true,
      })
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Server-Timing")).toContain("agent_models;dur=");
    expect(await res.json()).toEqual({
      ...payload,
      oobe: {
        provider_ready_completed_instance: true,
      },
    });
  });
});
