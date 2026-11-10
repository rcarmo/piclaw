import { expect, test } from "bun:test";
import {
  formatVisualLatestRunUsage,
  formatVisualModelPricing,
  formatVisualProviderUsage,
  mergeVisualLiveContext,
} from "../../web/static/visual/frontend/src/components/model-context-bar/telemetry";

test("visual live context updates preserve cached latest-run telemetry", () => {
  const cacheUsage = { latest: { inputTokens: 100, cacheReadTokens: 200, cacheReadReported: true } };
  expect(mergeVisualLiveContext({
    tokens: 500,
    contextWindow: 200_000,
    percent: 0.25,
    cacheUsage,
  }, {
    tokens: 800,
    contextWindow: 200_000,
    percent: 0.4,
  })).toEqual({
    tokens: 800,
    contextWindow: 200_000,
    percent: 0.4,
    cacheUsage,
  });

  const nextCacheUsage = { latest: { inputTokens: 120, cacheReadTokens: 240, cacheReadReported: true } };
  expect(mergeVisualLiveContext({
    tokens: 800,
    contextWindow: 200_000,
    percent: 0.4,
    cacheUsage,
  }, {
    tokens: null,
    contextWindow: null,
    percent: null,
    cacheUsage: nextCacheUsage,
  })).toEqual({
    tokens: 800,
    contextWindow: 200_000,
    percent: 0.4,
    cacheUsage: nextCacheUsage,
  });
});

test("visual latest-run telemetry preserves cache presence, reasoning, cost provenance, and model attribution", () => {
  const meta = formatVisualLatestRunUsage({
    tokens: 100,
    contextWindow: 200_000,
    percent: 0.05,
    cacheUsage: { latest: {
      inputTokens: 1_000,
      outputTokens: 300,
      reasoningTokens: 40,
      cacheReadTokens: 3_000,
      cacheWriteTokens: 1_000,
      cacheReadReported: true,
      totalTokens: 5_300,
      costTotal: 0.00123,
      costProvenance: "provider_reported",
      provider: "openrouter",
      model: "auto",
      responseModel: "anthropic/claude-sonnet-4-5",
    } },
  }, "openrouter/auto");

  expect(meta?.label).toBe("Last • 5K • CH60.0% • 0.0012 (currency unknown)");
  expect(meta?.title).toContain("Latest run: openrouter/auto");
  expect(meta?.title).toContain("Tokens: 5K");
  expect(meta?.title).toContain("Reasoning: 40");
  expect(meta?.title).toContain("Cache read: 3K");
  expect(meta?.title).toContain("Cache write: 1K");
  expect(meta?.title).toContain("Provider-reported cost: 0.0012 (currency unknown)");
  expect(meta?.title.split("\n").every((line) => line.length < 80)).toBe(true);
});

test("visual latest-run telemetry distinguishes explicit zero, omitted cache fields, and nested OpenRouter model IDs", () => {
  const explicitZero = formatVisualLatestRunUsage({
    tokens: null,
    contextWindow: 0,
    percent: null,
    cacheUsage: { latest: {
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheReadReported: true,
      totalTokens: 110,
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4",
    } },
  }, "openrouter/anthropic/claude-sonnet-4");
  expect(explicitZero?.label).toContain("CH0.0%");
  expect(explicitZero?.title).toContain("Latest run: openrouter/anthropic/claude-sonnet-4");

  const unavailable = formatVisualLatestRunUsage({
    tokens: null,
    contextWindow: 0,
    percent: null,
    cacheUsage: { latest: {
      inputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheReadReported: false,
      totalTokens: 100,
    } },
  }, null);
  expect(unavailable?.label).toContain("CH—");
  expect(unavailable?.title).toContain("Prompt cache telemetry unavailable");
});

test("visual OpenRouter provider telemetry shows spend, limit, remaining, and unavailable states", () => {
  expect(formatVisualProviderUsage({
    provider: "openrouter",
    availability: "available",
    hint_short: "$1.25 / $10.00 • $8.75 left",
    key_usage_usd: 1.25,
    key_limit_usd: 10,
    key_limit_remaining_usd: 8.75,
    key_limit_configured: true,
  })).toEqual({
    label: "$1.25 / $10.00 • $8.75 left",
    title: "Key spend: $1.25\nKey limit: $10.00\nKey remaining: $8.75",
  });
  expect(formatVisualProviderUsage({
    provider: "openrouter",
    availability: "authentication_failed",
    hint_short: "OpenRouter authentication failed",
  })).toEqual({
    label: "OpenRouter authentication failed",
    title: "OpenRouter authentication failed",
  });
});

test("visual model pricing omits unavailable rates instead of claiming zero", () => {
  expect(formatVisualModelPricing({
    input_per_million: 2.5,
    output_per_million: 10,
    cache_read_per_million: null,
    cache_write_per_million: null,
  })).toBe("in $2.5 / out $10 per 1M");
});

test('visual context clears old-generation meters but preserves independent usage telemetry',()=>{
 const cacheUsage={latest:{inputTokens:10}};
 expect(mergeVisualLiveContext({tokens:12000,percent:60,contextWindow:20000,sessionGeneration:'old',cacheUsage},{tokens:null,percent:null,contextWindow:100000,sessionGeneration:'new'},{authoritative:true})).toEqual({tokens:null,percent:null,contextWindow:100000,sessionGeneration:'new',cacheUsage});
});

test('old-generation pushed context cannot resurrect superseded meters',()=>{
 const current={tokens:10,percent:.01,contextWindow:100000,sessionGeneration:'new'};
 expect(mergeVisualLiveContext(current,{tokens:900,percent:9,contextWindow:10000,sessionGeneration:'old'})).toBe(current);
 expect(mergeVisualLiveContext(current,{tokens:900,percent:9,contextWindow:10000})).toBe(current);
});

for(const [currency,label]of [['USD','$0.0000'],['EUR','EUR 0.0000'],[null,'0.0000 (currency unknown)']]as const)test(`visual usage preserves ${currency??'unknown'} provider units`,()=>{
 const meta=formatVisualLatestRunUsage({tokens:null,contextWindow:0,percent:null,cacheUsage:{latest:{totalTokens:0,providerCostCurrency:currency,costTotal:0,costProvenance:'provider_reported'}}},null);expect(meta?.title).toContain(label);if(currency!=='USD')expect(meta?.title).not.toContain('$');
});

test('visual model picker explicitly indicates unknown catalogue prices',()=>{expect(formatVisualModelPricing(null)).toBe('Price unknown');expect(formatVisualModelPricing({input_per_million:null,output_per_million:null,cache_read_per_million:null,cache_write_per_million:null})).toBe('Price unknown');});
