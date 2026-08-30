import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  resetCompactionRuntimeConfigForTests,
  setCompactionRuntimeConfigForTests,
} from "../../src/core/config.js";
import { resolveSmartCompactionModelRequest } from "../../src/extensions/smart-compaction/model-request.js";

process.env.PICLAW_DB_IN_MEMORY = "1";

beforeEach(() => resetCompactionRuntimeConfigForTests());
afterEach(() => resetCompactionRuntimeConfigForTests());

function runtime(models: any[], auth: any = { auth: { apiKey: "key" }, env: {} }) {
  return {
    getModel(provider: string, modelId: string) {
      return models.find((model) => model.provider === provider && model.id === modelId);
    },
    getAuth: async () => auth,
  };
}

const activeModel = { provider: "active", id: "large", contextWindow: 128_000 };
const compactModel = { provider: "local", id: "fast-summary", contextWindow: 64_000 };

describe("resolveSmartCompactionModelRequest", () => {
  test("uses the active model when no dedicated model is configured", async () => {
    setCompactionRuntimeConfigForTests({ compactionModel: "" });
    const result = await resolveSmartCompactionModelRequest({ model: activeModel }, runtime([compactModel]), { useConfiguredModel: true });
    expect(result).toEqual({ ok: true, model: activeModel, auth: { ok: true } });
  });

  test("strictly resolves the configured provider/model", async () => {
    setCompactionRuntimeConfigForTests({ compactionModel: "local/fast-summary" });
    const result = await resolveSmartCompactionModelRequest({ model: activeModel }, runtime([compactModel]), { useConfiguredModel: true });
    expect(result).toEqual({ ok: true, model: compactModel, auth: { ok: true } });
  });

  test("rejects malformed or unavailable configured models without active-model fallback", async () => {
    setCompactionRuntimeConfigForTests({ compactionModel: "ambiguous" });
    expect(await resolveSmartCompactionModelRequest({ model: activeModel }, runtime([compactModel]), { useConfiguredModel: true }))
      .toEqual({ ok: false, error: "Configured compaction model must use provider/model syntax: ambiguous" });

    setCompactionRuntimeConfigForTests({ compactionModel: "local/missing" });
    expect(await resolveSmartCompactionModelRequest({ model: activeModel }, runtime([compactModel]), { useConfiguredModel: true }))
      .toEqual({ ok: false, error: "Configured compaction model is unavailable: local/missing" });
  });

  test("resolves dedicated-model credentials only for direct provider-native requests", async () => {
    setCompactionRuntimeConfigForTests({ compactionModel: "local/fast-summary" });
    const result = await resolveSmartCompactionModelRequest({ model: activeModel }, runtime([compactModel]), {
      useConfiguredModel: true,
      resolveDirectRequestAuth: true,
    });
    expect(result).toEqual({ ok: true, model: compactModel, auth: { ok: true, apiKey: "key", headers: undefined, env: {}, baseUrl: undefined } });
  });
});
