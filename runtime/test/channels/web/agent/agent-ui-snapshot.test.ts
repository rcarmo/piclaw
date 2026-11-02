import { expect, test } from "bun:test";
import {
  handleAgentUiSnapshotRequest,
  type AgentStatusContext,
} from "../../../../src/channels/web/agent/agent-status";
function context(
  overrides: Partial<AgentStatusContext> = {},
): AgentStatusContext {
  return {
    defaultChatJid: "web:default",
    json: Response.json,
    getAgentStatus: () => null,
    getExtensionWorkingState: () => null,
    recoverStaleInflightRun: () => false,
    getBuffer: () => undefined,
    getContextUsageForChat: async () => ({
      tokens: 12,
      contextWindow: 100,
      percent: 12,
      sessionGeneration: "fixture",
    }),
    getTokenUsageForChat: () => null,
    getAvailableModels: async () => ({
      current: "fixture/one",
      models: ["fixture/one"],
      model_options: [],
    }),
    getProviderReadyCompletedForInstance: () => true,
    getAddonApiHealthSnapshot: () => ({
      degraded: false,
      warningCount: 0,
      warnings: [],
    }),
    getMcpStartupDiagnostics: () => [],
    ...overrides,
  };
}
test("opt-in UI envelope reads all sections for the exact chat and requests only current model metadata", async () => {
  const seen: string[] = [];
  const ctx = context({
    getAvailableModels: async (jid, options) => {
      seen.push(jid);
      expect(options).toEqual({
        includeCatalogue: false,
        includeProviderDiagnostics: false,
      });
      return { current: "fixture/one" };
    },
    getContextUsageForChat: async (jid) => {
      seen.push(jid);
      return { tokens: 12, contextWindow: 100, percent: 12 };
    },
  });
  const res = await handleAgentUiSnapshotRequest(
    new Request("http://fixture/agent/status?ui=1&chat_jid=web%3Aother"),
    ctx,
    {
      getSystemMetrics: async () => ({ cpu_percent: 3 }),
      getAgentName: () => "Fixture",
      getProjectRepository: (jid) => { seen.push(jid); return { repository_url: "https://github.com/example/project", source_branch_id: "root", revision: "2026-01-01T00:00:00Z:root:1" }; },
    },
  );
  expect(res.status).toBe(200);
  expect(res.headers.get("Server-Timing")).toContain("agent_ui_snapshot");
  const p = await res.json();
  expect(seen).toEqual(["web:other", "web:other", "web:other"]);
  expect(p.status.chat_jid).toBe("web:other");
  expect(p.model.oobe.provider_ready_completed_instance).toBe(true);
  expect(p.context.tokens).toBe(12);
  expect(p.metrics.cpu_percent).toBe(3);
  expect(p.errors).toEqual([]);
  expect(p.agent_name).toBe("Fixture");
  expect(p.project_repository).toEqual({ repository_url: "https://github.com/example/project", source_branch_id: "root", revision: "2026-01-01T00:00:00Z:root:1" });
});
test("failed optional sections do not discard healthy status or leak exception text", async () => {
  const res = await handleAgentUiSnapshotRequest(
    new Request("http://fixture/agent/status?ui=1"),
    context({
      getAvailableModels: async () => {
        throw Error("private-model-error");
      },
      getContextUsageForChat: async () => {
        throw Error("private-context-error");
      },
    }),
    {
      getSystemMetrics: async () => {
        throw Error("private-metrics-error");
      },
      getAgentName: () => "Fixture",
    },
  );
  const p = await res.json();
  expect(p.status.status).toBe("idle");
  expect(p.model).toBeNull();
  expect(p.context).toBeNull();
  expect(p.metrics).toBeNull();
  expect(p.errors).toEqual(["model", "context", "metrics"]);
  expect(JSON.stringify(p)).not.toContain("private-");
  expect(p.project_repository).toBeNull();
});

test("public status handler opts into the snapshot and leaves ordinary status synchronous", async () => {
  const { initDatabase, closeDatabase } = await import("../../../../src/db.js");
  initDatabase();
  try {
  const { WebChannel } = await import("../../../../src/channels/web.js");
  const ctx = context();
  const facade = Object.assign(Object.create(WebChannel.prototype), {
    endpointContexts: { agentStatus: () => ctx, identity: () => ({ assistantName: "Facade Fixture" }) },
    json: Response.json, agentPool: { getMemoryInstrumentationSnapshot: () => null },
  });
  const ordinary = facade.handleAgentStatus(
    new Request("http://fixture/agent/status"),
  );
  expect(ordinary).toBeInstanceOf(Response);
  expect((await (ordinary as Response).json()).status).toBe("idle");
  const combined = await facade.handleAgentStatus(
    new Request("http://fixture/agent/status?ui=1"),
  );
  const body = await combined.json();
  expect(body.agent_name).toBe("Facade Fixture");
  expect(body.status.status).toBe("idle");
  expect(body.metrics).toBeTruthy();
  expect(body.model.current).toBe("fixture/one");
  expect(body.project_repository).toBeNull();
  } finally { closeDatabase(); }
});
