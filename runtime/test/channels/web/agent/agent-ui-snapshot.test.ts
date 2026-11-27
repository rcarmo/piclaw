import { expect, test } from "bun:test";
import {
  handleAgentContextRequest,
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
test("passive snapshot does not read context or its token usage", async () => {
  const forbidden = () => { throw Error('Passive status must not load context'); };
  const response = await handleAgentUiSnapshotRequest(new Request('http://fixture/agent/status?ui=1&chat_jid=web%3Aother&context=0'),
    context({ getContextUsageForChat: forbidden, getTokenUsageForChat: forbidden }), {
      getSystemMetrics: async () => ({ cpu_percent: 3 }), getAgentName: () => 'Fixture',
    });
  const body = await response.json();
  expect(body.status.chat_jid).toBe('web:other');
  expect(body.model.current).toBe('fixture/one');
  expect(body.context).toBeNull();
  expect(body.errors).toEqual([]);
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

const contextUsage = {
  tokens: 12,
  contextWindow: 100,
  percent: 12,
  sessionGeneration: "fixture-generation",
  revision: "native-other-head-1",
};

function contextRequest(etag?: string, includeTree = false): Request {
  return new Request(`http://fixture/agent/context?chat_jid=web%3Aother${includeTree ? "&include_tree=1" : ""}`, {
    headers: etag === undefined ? undefined : { "If-None-Match": etag },
  });
}

async function getContextTag(ctx: AgentStatusContext): Promise<string> {
  const response = await handleAgentContextRequest(contextRequest(), ctx);
  const { revision } = await response.json();
  return `"${revision}"`;
}

test("context GET without a validator keeps the snapshot shape and advertises a known revision", async () => {
  let probes = 0;
  const response = await handleAgentContextRequest(contextRequest(), context({
    getContextUsageForChat: async () => contextUsage,
    getContextRevisionForChat: async () => { probes++; return contextUsage.revision; },
  }));
  expect(response.status).toBe(200);
  expect(response.headers.get("Server-Timing")).toContain("agent_context");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const body = await response.json();
  expect(body.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(response.headers.get("ETag")).toBe(`"${body.revision}"`);
  expect(body).toEqual({
    tokens: 12, contextWindow: 100, percent: 12, sessionGeneration: "fixture-generation",
    revision: body.revision, contextUpdate: "replace", cacheUsage: null,
  });
  expect(probes).toBe(0);
});

test("an identical scoped UI context revision yields a bodyless 304 without the full reader", async () => {
  const ui = await handleAgentUiSnapshotRequest(
    new Request("http://fixture/agent/status?ui=1&chat_jid=web%3Aother"),
    context({ getContextUsageForChat: async () => contextUsage }),
    { getSystemMetrics: async () => null, getAgentName: () => "Fixture" },
  );
  const etag = `"${(await ui.json()).context.revision}"`;
  const forbidden = () => { throw Error("Conditional hit must not load snapshot sections"); };
  const response = await handleAgentContextRequest(contextRequest(etag), context({
    getContextUsageForChat: forbidden,
    getSessionTreeSummaryForChat: forbidden,
    getAvailableModels: forbidden,
    getAgentStatus: forbidden,
    getContextRevisionForChat: async (jid) => jid === "web:other" ? contextUsage.revision : null,
    getTokenUsageForChat: (jid) => { expect(jid).toBe("web:other"); return null; },
  }));
  expect(response.status).toBe(304);
  expect(response.body).toBeNull();
  expect(response.headers.get("ETag")).toBe(etag);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Server-Timing")).toContain("agent_context");
});

for (const change of ["head", "ledger"] as const) {
  test(`a changed context ${change} returns a fresh snapshot and validator`, async () => {
    let changed = false;
    const revision = () => changed && change === "head" ? "native-other-head-2" : contextUsage.revision;
    const ctx = context({
      getContextRevisionForChat: async () => revision(),
      getContextUsageForChat: async () => changed && change === "head"
        ? { ...contextUsage, revision: revision(), tokens: 16, percent: 16 } : contextUsage,
      getTokenUsageForChat: () => changed && change === "ledger" ? {
        latest: null, totals: {
          input_tokens: 10, output_tokens: 2, total_tokens: 12, cache_read_tokens: 0,
          cache_write_tokens: 0, cost_total: null, runs: 1,
        },
      } : null,
    });
    const previousTag = await getContextTag(ctx);
    changed = true;
    const response = await handleAgentContextRequest(contextRequest(previousTag), ctx);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tokens).toBe(change === "head" ? 16 : 12);
    expect(body.cacheUsage?.totals.totalTokens).toBe(change === "ledger" ? 12 : undefined);
    expect(response.headers.get("ETag")).not.toBe(previousTag);
    expect(response.headers.get("ETag")).toBe(`"${body.revision}"`);
  });
}

test("unavailable revision probes fall back to a full read even when the full revision still matches", async () => {
  const ctx = context({ getContextUsageForChat: async () => contextUsage });
  const etag = await getContextTag(ctx);
  for (const probe of [undefined, async () => null, async () => "", async () => { throw Error("Binding closed"); }]) {
    const response = await handleAgentContextRequest(contextRequest(etag), { ...ctx, getContextRevisionForChat: probe });
    expect(response.status).toBe(200);
    expect((await response.json()).tokens).toBe(12);
    expect(response.headers.get("ETag")).toBe(etag);
  }
  const unknown = await handleAgentContextRequest(contextRequest(etag), context({
    getContextRevisionForChat: async () => null,
    getContextUsageForChat: async () => ({ tokens: null, contextWindow: null, percent: null, sessionGeneration: "replacement" }),
  }));
  expect(unknown.status).toBe(200);
  expect(unknown.headers.get("ETag")).toBeNull();
  expect(await unknown.json()).toEqual({
    tokens: null, contextWindow: null, percent: null, sessionGeneration: "replacement",
    contextUpdate: "replace", cacheUsage: null,
  });
});

test("a context revision without a session generation is not advertised", async () => {
  const response = await handleAgentContextRequest(contextRequest(), context({
    getContextUsageForChat: async () => ({ ...contextUsage, sessionGeneration: undefined }),
  }));
  expect(response.status).toBe(200);
  expect(response.headers.get("ETag")).toBeNull();
  const body = await response.json();
  expect(body.sessionGeneration).toBeNull();
  expect(body).not.toHaveProperty("revision");
});

test("tree and non-exact validators bypass the conditional context probe", async () => {
  let probes = 0;
  const ctx = context({
    getContextUsageForChat: async () => contextUsage,
    getContextRevisionForChat: async () => { probes++; return contextUsage.revision; },
    getSessionTreeSummaryForChat: async () => ({ leafId: "new-leaf", total: 3 }),
  });
  const etag = await getContextTag(ctx);
  const tree = await handleAgentContextRequest(contextRequest(etag, true), ctx);
  expect(tree.status).toBe(200);
  expect(tree.headers.get("ETag")).toBeNull();
  expect(await tree.json()).toMatchObject({
    sessionTree: { leafId: "new-leaf", total: 3 },
    revision: JSON.parse(etag),
  });
  for (const validator of [`W/${etag}`, "*", etag.slice(1, -1), `"other", ${etag}`]) {
    const response = await handleAgentContextRequest(contextRequest(validator), ctx);
    expect(response.status).toBe(200);
    expect((await response.json()).tokens).toBe(12);
  }
  expect(probes).toBe(0);
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
  expect(body.project_repository).toMatchObject({ chat_jid: "web:default", mode: "inherit", repository_url: null });
  } finally { closeDatabase(); }
});
