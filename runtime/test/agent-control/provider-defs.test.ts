import { describe, expect, test } from "bun:test";

import { PROVIDER_DEFS, getProviderDefs, getProviderDisplayName } from "../../src/agent-control/provider-defs.js";
import { createRealTestModelServices } from "../model-services-fixture.js";
import { createTempWorkspace } from "../helpers.js";

describe("provider defs", () => {
  test("OpenCode ZEN is exposed as a custom provider only", () => {
    const provider = PROVIDER_DEFS.find((entry) => entry.id === "opencode-zen");
    expect(provider).toBeDefined();
    expect(provider?.name).toBe("OpenCode ZEN");
    expect(provider?.isCustom).toBe(true);
    expect(provider?.hasApiKey).toBe(false);
    expect(provider?.customApi).toBe("openai-completions");
    expect(provider?.customFields?.map((field) => field.key)).toEqual(["baseUrl", "apiKey", "modelId", "modelIds"]);
  });

  test("llama.cpp router is exposed as a local OpenAI-compatible custom provider", () => {
    const provider = PROVIDER_DEFS.find((entry) => entry.id === "llama-cpp");
    expect(provider).toMatchObject({
      name: "llama.cpp router",
      isCustom: true,
      hasApiKey: false,
      customApi: "openai-completions",
      customCompat: {
        supportsStore: false,
        supportsStrictMode: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        supportsLongCacheRetention: false,
        maxTokensField: "max_tokens",
      },
    });
    expect(provider?.customFields?.map((field) => field.key)).toEqual(["baseUrl", "modelId", "modelIds", "contextWindow"]);
  });

  test("tracks current built-in providers and drops removed Google subscription providers", () => {
    const ids = getProviderDefs().map((entry) => entry.id);
    expect(ids).toContain("ant-ling");
    expect(ids).toContain("cloudflare-ai-gateway");
    expect(ids).toContain("cloudflare-workers-ai");
    expect(ids).toContain("moonshotai");
    expect(ids).toContain("moonshotai-cn");
    expect(ids).toContain("nvidia");
    expect(ids).toContain("qwen-token-plan");
    expect(ids).toContain("qwen-token-plan-cn");
    expect(ids).toContain("radius");
    expect(ids).toContain("together");
    expect(ids).toContain("xiaomi");
    expect(ids).toContain("xiaomi-token-plan-cn");
    expect(ids).toContain("xiaomi-token-plan-ams");
    expect(ids).toContain("xiaomi-token-plan-sgp");
    expect(ids).toContain("zai-coding-cn");
    expect(ids).not.toContain("google-gemini-cli");
    expect(ids).not.toContain("google-antigravity");
    expect(ids).not.toContain("antigravity");
  });

  test("documents upstream token-plan, OAuth, and regional provider splits", () => {
    const defs = getProviderDefs();
    expect(defs.find((entry) => entry.id === "qwen-token-plan")).toMatchObject({
      name: "Qwen Token Plan", hasApiKey: true, apiKeyHint: "sk-sp-...",
    });
    expect(defs.find((entry) => entry.id === "qwen-token-plan-cn")).toMatchObject({
      name: "Qwen Token Plan CN", hasApiKey: true, apiKeyHint: "sk-sp-...",
    });
    expect(defs.find((entry) => entry.id === "radius")).toMatchObject({
      name: "Radius", hasOAuth: true, hasApiKey: true,
    });
    expect(defs.find((entry) => entry.id === "xiaomi")).toMatchObject({
      name: "Xiaomi MiMo (API billing)", hasApiKey: true, apiKeyHint: "XIAOMI_API_KEY",
    });
    expect(defs.find((entry) => entry.id === "xiaomi-token-plan-ams")).toMatchObject({
      name: "Xiaomi MiMo Token Plan (AMS)", hasApiKey: true, apiKeyHint: "XIAOMI_TOKEN_PLAN_AMS_API_KEY",
    });
    expect(defs.find((entry) => entry.id === "zai-coding-cn")).toMatchObject({
      name: "Z.AI Coding CN", hasApiKey: true, apiKeyHint: "ZAI_CODING_CN_API_KEY",
    });
    expect(defs.find((entry) => entry.id === "openrouter")).toMatchObject({
      name: "OpenRouter", hasOAuth: true, hasApiKey: true,
    });
    expect(defs.find((entry) => entry.id === "kimi-coding")).toMatchObject({
      name: "Kimi For Coding", hasOAuth: true, hasApiKey: true,
    });
  });

  test("can enrich provider names from the ModelRegistry compatibility facade", async () => {
    const workspace = createTempWorkspace("provider-defs-");
    try {
      const { modelRegistry, credentialStore } = await createRealTestModelServices(workspace.base);
      const defs = getProviderDefs(modelRegistry, credentialStore);
      expect(defs.some((entry) => entry.id === "amazon-bedrock")).toBe(true);
      expect(getProviderDisplayName("cloudflare-ai-gateway", modelRegistry)).toBe("Cloudflare AI Gateway");
    } finally {
      workspace.cleanup();
    }
  });
});
