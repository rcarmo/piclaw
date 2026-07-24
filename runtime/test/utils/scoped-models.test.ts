import { describe, expect, test } from "bun:test";

import { filterModelsByEnabledPatterns } from "../../src/utils/scoped-models.js";

function model(provider: string, id: string, name = id): any {
  return {
    provider,
    id,
    name,
    contextWindow: 100_000,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    maxTokens: 4_096,
  };
}

describe("scoped model filtering", () => {
  test("prioritizes provider matches over proxy-provider IDs for partial patterns", () => {
    const models = [
      model("openrouter", "openai/gpt-5", "GPT-5 via OpenRouter"),
      model("openai", "gpt-5", "GPT-5"),
    ];

    expect(filterModelsByEnabledPatterns(models, ["openai"]).map((m) => `${m.provider}/${m.id}`)).toEqual([
      "openai/gpt-5",
    ]);
  });

  test("prioritizes provider-prefixed partial references over proxy-provider IDs", () => {
    const models = [
      model("openrouter", "openai/gpt-5", "GPT-5 via OpenRouter"),
      model("openai", "gpt-5", "GPT-5"),
    ];

    expect(filterModelsByEnabledPatterns(models, ["openai/gpt"]).map((m) => `${m.provider}/${m.id}`)).toEqual([
      "openai/gpt-5",
    ]);
  });

  test("resolves exact model IDs containing brackets before treating patterns as globs", () => {
    const models = [
      model("test", "model[beta]", "Bracket Model"),
      model("test", "modelb", "Glob-like Model"),
    ];

    expect(filterModelsByEnabledPatterns(models, ["test/model[beta]"]).map((m) => `${m.provider}/${m.id}`)).toEqual([
      "test/model[beta]",
    ]);
    expect(filterModelsByEnabledPatterns(models, ["model[beta]"]).map((m) => `${m.provider}/${m.id}`)).toEqual([
      "test/model[beta]",
    ]);
  });
});
