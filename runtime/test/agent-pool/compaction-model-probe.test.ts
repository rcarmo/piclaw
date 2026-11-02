import { expect, test } from "bun:test";
import { AgentPool } from "../../src/agent-pool.js";
import { AgentRuntimeFacade } from "../../src/agent-pool/runtime-facade.js";
import * as estimates from "../../src/agent-pool/compaction-prefill-estimate.js";
import { handleAgentRoutes } from "../../src/channels/web/http/dispatch-agent.js";

// The separate-model feature was retired by the native settings contract. Keep
// its negative/public boundary covered without executing a provider probe.
test("AgentPool and its runtime expose no separate compaction-model execution API", () => {
  expect(AgentPool.prototype).not.toHaveProperty("probeCompactionModel");
  expect(AgentRuntimeFacade.prototype).not.toHaveProperty("probeCompactionModel");
});

test("the retired provider probe runner is absent rather than hidden behind another wrapper", async () => {
  const path = new URL("../../src/agent-pool/compaction-model-probe.ts", import.meta.url);
  expect(await Bun.file(path).exists()).toBe(false);
});

test("probe-only latest-selector is gone while the historical estimator and bucket reader remain", () => {
  expect(estimates).not.toHaveProperty("buildLatestCompactionLatencyEstimate");
  expect(estimates.buildCompactionLatencyEstimate).toBeFunction();
  expect(estimates.compactionInputTokenBucket(48_000)).toEqual({ min: 32_768, max: 65_536 });
});

test("retired probe HTTP requests stay 410 without looking up a pool or consuming any input", async () => {
  let effects = 0;
  const channel = { json: (payload: unknown, status = 200) => Response.json(payload, { status }),
    get agentPool() { effects++; throw Error("No model, credential, session, history or provider lookup is permitted"); } };
  const path = "/agent/settings/compaction/probe";
  for (const body of ["{", "{}", JSON.stringify({ model: "local/obsolete", chatJid: "web:historical" })]) {
    const aborted = new AbortController(); aborted.abort();
    const req = new Request("https://fixture.invalid" + path, { method: "POST", body, signal: aborted.signal });
    const response = await handleAgentRoutes(channel as any, req, path, new URL(req.url));
    expect(response?.status).toBe(410);
    expect(await response?.json()).toEqual({ error: "Native compaction uses the active conversation model; separate compaction-model probes are unsupported." });
    expect(req.bodyUsed).toBe(false);
  }
  expect(effects).toBe(0);
});

test("native current-model reads stay on their bound port and fail closed without probe/session fallback", async () => {
  let providerReads = 0, hydrations = 0;
  const unexpected = () => { providerReads++; throw Error("must not execute provider/model lookup"); };
  let available = true;
  const options = { pool: new Map(), authPath: "/workspace/tmp/probe-retirement-unused-auth.json",
    getOrCreateRuntime: () => { hydrations++; throw Error("must not hydrate"); },
    modelRuntime: new Proxy({}, { get: unexpected }), modelRegistry: {},
    getDurableSession(chat: string) {
      expect(this).toBe(options); expect(chat).toBe("web:active");
      return available ? { sessionId: "native-session", branchId: "native-branch", readPosition: () => ({ sessionId: "native-session", branchId: "native-branch", headId: null }), readModel: async () => "local/active" } : undefined;
    } };
  const facade = new AgentRuntimeFacade(options as any);
  expect(await facade.getCurrentModelLabel("web:active")).toBe("local/active");
  available = false;
  await expect(facade.getCurrentModelLabel("web:active")).rejects.toThrow("Durable session model unavailable");
  expect(providerReads).toBe(0); expect(hydrations).toBe(0);
});
