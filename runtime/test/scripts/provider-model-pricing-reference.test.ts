import { describe, expect, test } from "bun:test";
import Database from "bun:sqlite";
import { join } from "node:path";
import { createTempWorkspace } from "../helpers.js";
import { PROVIDER_MODEL_PRICING_REFERENCE_TAG, resolveProviderModelPricing } from "../../skills/operator/token-chart/provider-model-pricing-reference.ts";
import { generateProviderModelEstimatedCostChart } from "../../skills/operator/token-chart/token-cost-by-provider-model-chart.ts";

describe("provider/model pricing reference", () => {
  test("prices native Fable and Mythos 5.2 with explicit Fast selectors and stable aliases", () => {
    for (const family of ["fable", "mythos"]) {
      const model = `claude-${family}-5.2`;
      const standard = resolveProviderModelPricing("anthropic", model);
      expect(standard).toMatchObject({ inputPerMTok: 8, outputPerMTok: 40, cacheReadPerMTok: 0.2, cacheWritePerMTok: 10 });
      expect(standard.basis).toContain("2026-11-09");
      expect(standard.notes).toContain("1h writes $16");
      expect(resolveProviderModelPricing("anthropic", `claude-${family}-5-2`)).toEqual(standard);
      expect(resolveProviderModelPricing(" ANTHROPIC ", ` claude_${family}_5_2 `)).toEqual(standard);
      const fast = resolveProviderModelPricing("anthropic", `${model}-fast`);
      expect(fast).toMatchObject({ inputPerMTok: 16, outputPerMTok: 80, cacheReadPerMTok: 0.4, cacheWritePerMTok: 20 });
      expect(fast.notes).toContain("1h writes $32");
      expect(fast.notes).toContain("not an upstream model ID");
      expect(resolveProviderModelPricing("anthropic", `claude-${family}-5-2-fast`)).toEqual(fast);
    }
  });

  test("does not invent 5.2 routes or Batch aliases from native availability", () => {
    for (const family of ["fable", "mythos"]) {
      for (const provider of ["openrouter", "github-copilot", "azure-foundry", "amazon-bedrock", "google-vertex", "unknown"]) {
        for (const model of [`claude-${family}-5.2`, `claude-${family}-5-2`, `anthropic/claude-${family}-5.2`]) {
          expect(resolveProviderModelPricing(provider, model)).toBeNull();
        }
      }
      expect(resolveProviderModelPricing("anthropic", `claude-${family}-5.2:batch`)).toBeNull();
    }
    expect(resolveProviderModelPricing("anthropic", "claude-fable-5.1").inputPerMTok).toBe(10);
    expect(resolveProviderModelPricing("anthropic", "claude-mythos-5.1").outputPerMTok).toBe(50);
  });

  test("the cost chart prices 5.2 input categories once without adding reasoning", () => {
    const fixture = createTempWorkspace("claude52-pricing-");
    const dbPath = join(fixture.store, "usage.db");
    try {
      const db = new Database(dbPath);
      db.exec("CREATE TABLE token_usage (run_at TEXT, provider TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER)");
      const insert = db.prepare("INSERT INTO token_usage VALUES (?, ?, ?, ?, ?, ?, ?)");
      for (const model of ["claude-fable-5-2", "claude-mythos-5.2"]) insert.run("2026-11-09T12:00:00Z", "anthropic", model, 5_000, 10_000, 90_000, 5_000);
      db.close();
      const chart = generateProviderModelEstimatedCostChart({ days: 1, dbPath, now: new Date("2026-11-09T13:00:00Z") });
      expect(chart.totalEstimatedCost).toBeCloseTo(1.016, 12);
      expect(chart.seriesCount).toBe(2);
      expect(chart.pricingReferenceTag).toBe(PROVIDER_MODEL_PRICING_REFERENCE_TAG);
    } finally { fixture.cleanup(); }
  });
  test("prices Terra 6.1 exact routes and Graphite aliases without inheriting other providers", () => {
    const expected = { canonicalModel: "GPT-6.1 Terra", inputPerMTok: 1, outputPerMTok: 5, cacheReadPerMTok: 0.05, cacheWritePerMTok: 1.25 };
    for (const provider of ["openai", "github-copilot", "openai-codex"]) {
      expect(resolveProviderModelPricing(provider, "gpt-6.1-terra")).toMatchObject(expected);
      expect(resolveProviderModelPricing(provider, "gpt-6_1-terra")).toMatchObject(expected);
    }
    expect(resolveProviderModelPricing("openrouter", "openai/gpt-6.1-terra")).toMatchObject(expected);
    expect(resolveProviderModelPricing("openrouter", "gpt-6.1-terra")).toBeNull();
    expect(resolveProviderModelPricing("azure-foundry", "gpt-6.1-terra")).toBeNull();
    expect(resolveProviderModelPricing("github-copilot", "gpt-6.1-terra").notes).toContain("Above 272K");
  });
  test("keeps route-specific prices separate", () => {
    expect(resolveProviderModelPricing("azure-foundry", "deepseek-v4-flash")).toMatchObject({
      canonicalModel: "DeepSeek V4 Flash (Azure Foundry)",
      inputPerMTok: 0.19,
      outputPerMTok: 0.51,
    });
    expect(resolveProviderModelPricing("deepseek", "deepseek-v4-flash")).toMatchObject({
      canonicalModel: "DeepSeek V4 Flash (native)",
      inputPerMTok: 0.15,
      cacheReadPerMTok: 0.003,
    });
    expect(resolveProviderModelPricing("openrouter", "deepseek/deepseek-v4-flash")).toMatchObject({
      canonicalModel: "DeepSeek V4 Flash (OpenRouter)",
      inputPerMTok: 0.049,
      outputPerMTok: 0.098,
    });
  });

  test("does not inherit a bare model from the wrong provider", () => {
    expect(resolveProviderModelPricing("openrouter", "deepseek-v4-flash")).toBeNull();
    expect(resolveProviderModelPricing("openrouter", "mistral-large-3")).toBeNull();
  });

  test("leaves subscription-only research previews unpriced", () => {
    expect(resolveProviderModelPricing("openai-codex", "gpt-5.3-codex-spark")).toBeNull();
  });

  test("resolves current aliases without conflating GPT-5 Mini variants", () => {
    expect(resolveProviderModelPricing("openai-codex", "gpt-5-4-mini")).toMatchObject({
      canonicalModel: "GPT-5.4 Mini",
      inputPerMTok: 0.75,
      outputPerMTok: 4.5,
    });
    expect(resolveProviderModelPricing("openai-codex", "gpt-5-mini")).toMatchObject({
      canonicalModel: "GPT-5 Mini",
      inputPerMTok: 0.25,
      outputPerMTok: 2,
    });
  });

  test("resolves Opus 5 and Kimi K3 first-party and routed prices", () => {
    expect(resolveProviderModelPricing("anthropic", "claude-opus-5")).toMatchObject({
      canonicalModel: "Claude Opus 5",
      inputPerMTok: 5,
      outputPerMTok: 25,
      cacheReadPerMTok: 0.5,
      cacheWritePerMTok: 6.25,
    });
    expect(resolveProviderModelPricing("anthropic", "claude-opus-5-fast")).toMatchObject({
      canonicalModel: "Claude Opus 5 Fast",
      inputPerMTok: 10,
      outputPerMTok: 50,
      cacheReadPerMTok: 1,
      cacheWritePerMTok: 12.5,
    });
    expect(resolveProviderModelPricing("openrouter", "anthropic/claude-opus-5")).toMatchObject({
      canonicalModel: "Claude Opus 5 (OpenRouter)",
      inputPerMTok: 5,
      outputPerMTok: 25,
    });
    expect(resolveProviderModelPricing("moonshot", "kimi-k3")).toMatchObject({
      canonicalModel: "Kimi K3",
      inputPerMTok: 3,
      outputPerMTok: 15,
      cacheReadPerMTok: 0.3,
      cacheWritePerMTok: 3,
    });
    expect(resolveProviderModelPricing("openrouter", "moonshotai/kimi-k3")).toMatchObject({
      canonicalModel: "Kimi K3 (OpenRouter)",
      inputPerMTok: 3,
      outputPerMTok: 15,
      cacheReadPerMTok: 0.3,
    });
  });

  test("prices Fable successors and Astra without treating missing cache meters as free", () => {
    expect(resolveProviderModelPricing("anthropic", "claude-fable-5.1")).toMatchObject({ inputPerMTok: 10, outputPerMTok: 50, cacheReadPerMTok: 0.25, cacheWritePerMTok: 12.5 });
    expect(resolveProviderModelPricing("openrouter", "anthropic/claude-fable-5").cacheReadPerMTok).toBe(1);
    expect(resolveProviderModelPricing("github-copilot", "claude-fable-5.1").cacheReadPerMTok).toBe(0.25);
    expect(resolveProviderModelPricing("openai-codex", "gpt-6-astra")).toMatchObject({ inputPerMTok: 10, outputPerMTok: 50, cacheReadPerMTok: 1, cacheWritePerMTok: 12.5 });
    expect(resolveProviderModelPricing("openai", "gpt-5.4-pro").cacheReadPerMTok).toBe(30);
  });

  test("preserves the Sol route discount", () => {
    expect(resolveProviderModelPricing("github-copilot", "gpt-5.6-sol").inputPerMTok).toBe(4);
    expect(resolveProviderModelPricing("openrouter", "openai/gpt-5.6-sol").inputPerMTok).toBe(2);
    expect(resolveProviderModelPricing("openai-codex", "gpt-5.6-sol").outputPerMTok).toBe(20);
  });

  test("refreshes September 22 launches without assuming Copilot availability", () => {
    expect(resolveProviderModelPricing("openai", "gpt-6-sol")).toMatchObject({ inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2, cacheWritePerMTok: 2.5 });
    expect(resolveProviderModelPricing("openai", "gpt-6-luna")).toMatchObject({ inputPerMTok: 0.1, outputPerMTok: 0.5, cacheReadPerMTok: 0.01, cacheWritePerMTok: 0.125 });
    expect(resolveProviderModelPricing("github-copilot", "gpt-6-sol")).toBeNull();
    expect(resolveProviderModelPricing("anthropic", "claude-opus-5-5")).toMatchObject({ inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2, cacheWritePerMTok: 5 });
    expect(resolveProviderModelPricing("anthropic", "claude-opus-5.5-fast")).toMatchObject({ inputPerMTok: 8, outputPerMTok: 40, cacheReadPerMTok: 0.4, cacheWritePerMTok: 10 });
    expect(resolveProviderModelPricing("github-copilot", "claude-sonnet-5")).toMatchObject({ inputPerMTok: 2, outputPerMTok: 10 });
    expect(resolveProviderModelPricing("anthropic", "claude-fable-5-1").cacheReadPerMTok).toBe(0.25);
  });

  test("values native GPT-6.1 Sol without inheriting unquoted provider routes", () => {
    const standard = resolveProviderModelPricing("openai", "gpt-6.1-sol");
    expect(standard).toMatchObject({
      canonicalModel: "GPT-6.1 Sol",
      inputPerMTok: 2,
      outputPerMTok: 10,
      cacheReadPerMTok: 0.1,
      cacheWritePerMTok: 2.5,
    });
    expect(standard.basis).toContain("2026-09-29");
    expect(standard.notes).toContain("base tier only");
    expect(resolveProviderModelPricing("openai", "gpt-6-1-sol")).toEqual(standard);
    expect(resolveProviderModelPricing("openai", "gpt-6-sol").cacheReadPerMTok).toBe(0.2);
    expect(resolveProviderModelPricing("github-copilot", "gpt-6.1-sol")).toBeNull();
    expect(resolveProviderModelPricing("openrouter", "openai/gpt-6.1-sol")).toBeNull();
    expect(resolveProviderModelPricing("openai-codex", "gpt-6.1-sol")).toBeNull();
  });

  test("prices native Mistral Large 4 at undiscounted rates with an explicit write fallback", () => {
    const native = resolveProviderModelPricing("mistral", "mistral-large-4");
    expect(native).toMatchObject({
      canonicalModel: "Mistral Large 4",
      inputPerMTok: 1.36,
      outputPerMTok: 4.18,
      cacheReadPerMTok: 0.14,
      cacheWritePerMTok: 1.36,
    });
    expect(native.basis).toContain("2026-10-06");
    expect(native.notes).toContain("ordinary input estimator fallback");
    expect(native.notes).toContain("launch discount is excluded");
    expect(resolveProviderModelPricing(" MISTRAL ", " mistral_large_4_0 ")).toEqual(native);
    const cost = (5_000 * native.inputPerMTok + 5_000 * native.cacheWritePerMTok
      + 90_000 * native.cacheReadPerMTok + 10_000 * native.outputPerMTok) / 1e6;
    expect(cost).toBeCloseTo(0.068, 12);
  });

  test("does not transfer Mistral Large 4 prices across routes, generations or unverified names", () => {
    for (const provider of ["openrouter", "github-copilot", "azure-foundry", "unknown"]) {
      for (const model of ["mistral-large-4", "mistral-large-4-0", "mistralai/mistral-large-4"]) {
        expect(resolveProviderModelPricing(provider, model)).toBeNull();
      }
    }
    expect(resolveProviderModelPricing("mistral", "mistral-large-latest")).toBeNull();
    expect(resolveProviderModelPricing("mistral", "mistral-large-4-2610")).toBeNull();
    expect(resolveProviderModelPricing("azure-foundry", "mistral-large-3").inputPerMTok).toBe(0.5);
  });

  test("the cost chart estimates separated Mistral token categories once at base prices", () => {
    const fixture = createTempWorkspace("mistral-pricing-");
    const dbPath = join(fixture.store, "usage.db");
    try {
      const db = new Database(dbPath);
      db.exec("CREATE TABLE token_usage (run_at TEXT, provider TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER)");
      db.prepare("INSERT INTO token_usage VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        "2026-10-06T12:00:00Z", "mistral", "mistral-large-4-0", 5_000, 10_000, 90_000, 5_000,
      );
      db.close();
      const chart = generateProviderModelEstimatedCostChart({days: 1, dbPath, now: new Date("2026-10-06T13:00:00Z")});
      expect(chart.totalEstimatedCost).toBeCloseTo(0.068, 12);
      expect(chart.seriesCount).toBe(1);
      expect(chart.pricingReferenceTag).toBe(PROVIDER_MODEL_PRICING_REFERENCE_TAG);
      expect(chart.svg).toContain("mistral / mistral-large-4-0");
      expect(chart.csv).toContain("0.068");
    } finally {
      fixture.cleanup();
    }
  });

  test("preserves peer route differences and explicitly dated fallbacks", () => {
    expect(resolveProviderModelPricing("xai", "grok-4.5").cacheReadPerMTok).toBe(0.3);
    expect(resolveProviderModelPricing("github-copilot", "grok-4.5").cacheReadPerMTok).toBe(0.5);
    expect(resolveProviderModelPricing("google", "gemini-3.8-flash")).toMatchObject({ inputPerMTok: 0.75, outputPerMTok: 3.75 });
    expect(resolveProviderModelPricing("zai", "glm-5.3-flash")).toMatchObject({ inputPerMTok: 0.15, outputPerMTok: 0.5, cacheReadPerMTok: 0.03 });
    expect(resolveProviderModelPricing("groq", "openai/gpt-oss-120b")).toMatchObject({ inputPerMTok: 0.15, outputPerMTok: 0.6 });
    expect(resolveProviderModelPricing("moonshot", "kimi-k3").cacheWritePerMTok).toBe(3);
    expect(resolveProviderModelPricing("azure-foundry", "deepseek-v4-flash").notes).toContain("not reverified");
    expect(resolveProviderModelPricing("groq", "openai/gpt-oss-120b").notes).toContain("ordinary input fallback");
  });

  test("prices local inference at zero metered API cost", () => {
    expect(resolveProviderModelPricing("milkv-local", "gemma4-e4b-qat-mtp")).toMatchObject({
      inputPerMTok: 0,
      outputPerMTok: 0,
      cacheReadPerMTok: 0,
      cacheWritePerMTok: 0,
    });
  });
});
