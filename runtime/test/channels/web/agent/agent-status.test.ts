import { describe, expect, test } from "bun:test";
import {
  handleAgentContextRequest,
  handleAgentModelsRequest,
  handleAgentStatusRequest,
  type AgentStatusContext,
} from "../../../../src/channels/web/agent/agent-status.js";
import { createJsonResponder } from "../helpers/http.js";

function createContext(overrides: Partial<AgentStatusContext> = {}): AgentStatusContext {
  return {
    defaultChatJid: "web:default",
    json: createJsonResponder(),
    getAgentStatus: () => null,
    getBuffer: () => undefined,
    getContextUsageForChat: async () => null,
    getAvailableModels: async () => ({ models: [] }),
    ...overrides,
  };
}

describe("web agent status helpers", () => {
  test("handleAgentStatusRequest returns idle status when no active agent", async () => {
    const req = new Request("https://example.com/agent/status");
    const res = handleAgentStatusRequest(req, createContext());

    expect(res.status).toBe(200);
    expect(res.headers.get("Server-Timing")).toContain("agent_status;dur=");
    expect(await res.json()).toEqual({ status: "idle", data: null });
  });

  test("handleAgentStatusRequest includes thought/draft buffers when available", async () => {
    const req = new Request("https://example.com/agent/status?chat_jid=web:custom");
    const res = handleAgentStatusRequest(
      req,
      createContext({
        getAgentStatus: (chatJid) => ({ chatJid, turn_id: "turn-1", state: "thinking" }),
        getBuffer: (_turnId, panel) =>
          panel === "thought"
            ? { text: "thought text", totalLines: 2, updatedAt: 1 }
            : { text: "draft text", totalLines: 1, updatedAt: 1 },
      })
    );

    expect(res.headers.get("Server-Timing")).toContain("agent_status;dur=");
    const body = await res.json();
    expect(body.status).toBe("active");
    expect(body.data.chatJid).toBe("web:custom");
    expect(body.thought).toEqual({ text: "thought text", totalLines: 2 });
    expect(body.draft).toEqual({ text: "draft text", totalLines: 1 });
  });

  test("handleAgentContextRequest returns null fields when usage is unavailable", async () => {
    const req = new Request("https://example.com/agent/context");
    const res = await handleAgentContextRequest(req, createContext());

    expect(res.status).toBe(200);
    expect(res.headers.get("Server-Timing")).toContain("agent_context;dur=");
    expect(await res.json()).toEqual({ tokens: null, contextWindow: null, percent: null });
  });

  test("handleAgentModelsRequest returns payload from model provider", async () => {
    const req = new Request("https://example.com/agent/models");
    const payload = { models: [{ id: "openai/gpt-5" }] };
    const res = await handleAgentModelsRequest(
      req,
      createContext({
        getAvailableModels: async () => payload,
      })
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Server-Timing")).toContain("agent_models;dur=");
    expect(await res.json()).toEqual(payload);
  });
});
