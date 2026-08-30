import { afterEach, expect, test } from "bun:test";

import { probeCompactionModel } from "../../src/agent-pool/compaction-model-probe.js";
import { resetCompactionRuntimeConfigForTests, setCompactionRuntimeConfigForTests } from "../../src/core/config.js";

process.env.PICLAW_DB_IN_MEMORY = "1";
afterEach(resetCompactionRuntimeConfigForTests);

const model = { provider: "local", id: "probe", contextWindow: 64_000 };
const resultMessage = {
  role: "assistant",
  content: [{ type: "text", text: "compaction probe ready" }],
  stopReason: "stop",
  usage: { input: 1, output: 1 },
  timestamp: Date.now(),
};

function stream(events: unknown[], result = resultMessage) {
  return {
    async *[Symbol.asyncIterator]() { for (const event of events) yield event; },
    async result() { return result; },
  };
}

test("probe returns bounded metadata and does not expose provider output", async () => {
  setCompactionRuntimeConfigForTests({ timeoutMs: 45_000 });
  const calls: any[] = [];
  const probe = await probeCompactionModel({
    getModel: () => model,
    streamSimple: async (_model: any, context: any, options: any) => {
      calls.push({ context, options });
      await options.onResponse?.({ status: 200, headers: new Headers() }, model);
      return stream([{ type: "text_delta", delta: "ready" }]);
    },
  } as any, "local/probe");

  expect(probe).toMatchObject({
    ok: true,
    model: "local/probe",
    contextWindow: 64_000,
    timeoutMs: 30_000,
    responseReceived: true,
    credentialStatus: "verified",
    stage: "completed",
    timeToFirstTokenMs: expect.any(Number),
    durationMs: expect.any(Number),
    compactionLatencyEstimate: null,
    error: null,
  });
  expect(probe).not.toHaveProperty("output");
  expect(calls).toHaveLength(1);
  expect(calls[0].options).toMatchObject({ maxTokens: 32, maxRetries: 0, timeoutMs: 30_000, cacheRetention: "none" });
  expect(calls[0].context.messages).toHaveLength(1);
});

test("probe rejects malformed and unavailable exact model labels", async () => {
  await expect(probeCompactionModel({ getModel: () => undefined } as any, "ambiguous"))
    .rejects.toThrow("exact provider/model");
  await expect(probeCompactionModel({ getModel: () => undefined } as any, "local/missing"))
    .rejects.toThrow("unavailable");
});

test("probe attributes connect, first-token, and streaming failures", async () => {
  const run = async (mode: "connect" | "first" | "stream") => await probeCompactionModel({
    getModel: () => model,
    streamSimple: async (_model: any, _context: any, options: any) => {
      if (mode === "connect") throw new Error("apiKey=secret-token connection failed");
      await options.onResponse?.({ status: 200, headers: new Headers() }, model);
      if (mode === "first") return stream([], { ...resultMessage, stopReason: "error", errorMessage: "token=private timeout" });
      return stream([{ type: "text_delta", delta: "partial" }], { ...resultMessage, stopReason: "error", errorMessage: "stream timeout" });
    },
  } as any, "local/probe");

  const connect = await run("connect");
  expect(connect).toMatchObject({ ok: false, stage: "provider_connect", credentialStatus: "unverified", responseReceived: false });
  expect(connect.error).not.toContain("secret-token");
  const first = await run("first");
  expect(first).toMatchObject({ ok: false, stage: "first_token", responseReceived: true, timeToFirstTokenMs: null });
  expect(first.error).not.toContain("private");
  const streaming = await run("stream");
  expect(streaming).toMatchObject({ ok: false, stage: "streaming", responseReceived: true, timeToFirstTokenMs: expect.any(Number) });
});

test("probe remains hard-bounded when a provider ignores cancellation", async () => {
  setCompactionRuntimeConfigForTests({ timeoutMs: 20 });
  const startedAt = Date.now();
  const result = await probeCompactionModel({
    getModel: () => model,
    streamSimple: async () => await new Promise(() => {}),
  } as any, "local/probe");
  expect(Date.now() - startedAt).toBeLessThan(500);
  expect(result).toMatchObject({ ok: false, stage: "provider_connect", timeoutMs: 20 });
  expect(result.error).toContain("timed out after 20ms");
});

test("facade probe does not hydrate or mutate a chat session", async () => {
  let sessionHydrations = 0;
  const { AgentRuntimeFacade } = await import("../../src/agent-pool/runtime-facade.js");
  const facade = new AgentRuntimeFacade({
    pool: new Map(),
    getOrCreateRuntime: async () => { sessionHydrations += 1; throw new Error("must not hydrate"); },
    modelRegistry: { getAvailable: () => [] } as any,
    modelRuntime: {
      getModel: () => model,
      streamSimple: async (_model: any, _context: any, options: any) => {
        await options.onResponse?.({ status: 200, headers: new Headers() }, model);
        return stream([{ type: "text_delta", delta: "ok" }]);
      },
    } as any,
    authPath: "/tmp/auth.json",
    clearAttachments: () => {},
    refreshRuntime: async () => {},
  } as any);

  expect((await facade.probeCompactionModel("local/probe")).ok).toBe(true);
  expect(sessionHydrations).toBe(0);
});
