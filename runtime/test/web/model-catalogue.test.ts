import { expect, test } from "bun:test";

import {
  MODEL_PICKER_RENDER_LIMIT,
  buildModelPickerProjection,
  buildModelSearchDocument,
  classifyModelIdentity,
  classifyModelVariants,
  compareModelCatalogueText,
  filterAndRankModels,
  formatModelCataloguePricing,
  groupModels,
  moveModelPickerActiveKey,
  normaliseModelCatalogue,
} from "../../web/src/ui/model-catalogue.ts";

test("model catalogue formats compact input/output pricing", () => {
  expect(formatModelCataloguePricing({ inputPerMillion: 0.15, outputPerMillion: 3, cacheReadPerMillion: null, cacheWritePerMillion: null })).toBe("In $0.15 · Out $3 / 1M");
  expect(formatModelCataloguePricing(null)).toBe("");
});

test("normaliseModelCatalogue preserves provider/model identity and structured metadata", () => {
  const entries = normaliseModelCatalogue({
    current: "openrouter/anthropic/claude-sonnet-4:latest",
    model_options: [
      {
        provider: "github-copilot",
        id: "claude-sonnet-4",
        label: "github-copilot/claude-sonnet-4",
        name: "Claude Sonnet 4",
        context_window: 200_000,
        reasoning: true,
        thinking_levels: ["off", "high"],
        thinking_level_labels: ["Off", "High"],
        pricing: { input_per_million: 3, output_per_million: 15, cache_read_per_million: 0.3 },
      },
      {
        provider: "openrouter",
        id: "anthropic/claude-sonnet-4:latest",
        label: "openrouter/anthropic/claude-sonnet-4:latest",
        name: "Claude Sonnet 4",
        context_window: 200_000,
        reasoning: true,
      },
    ],
  }, {
    pinnedKeys: ["github-copilot/claude-sonnet-4"],
    recentByKey: { "github-copilot/claude-sonnet-4": "2026-08-28T12:00:00Z" },
  });

  expect(entries.map((entry) => entry.key)).toEqual([
    "github-copilot/claude-sonnet-4",
    "openrouter/anthropic/claude-sonnet-4:latest",
  ]);
  expect(entries[0]).toMatchObject({
    key: "github-copilot/claude-sonnet-4",
    provider: "github-copilot",
    publisher: null,
    family: "Claude",
    id: "claude-sonnet-4",
    displayName: "Claude Sonnet 4",
    contextWindow: 200_000,
    reasoning: true,
    thinkingLevels: [{ id: "off", label: "Off" }, { id: "high", label: "High" }],
    pricing: {
      inputPerMillion: 3,
      outputPerMillion: 15,
      cacheReadPerMillion: 0.3,
      cacheWritePerMillion: null,
    },
    variants: [],
    current: false,
    pinned: true,
    lastUsedAt: "2026-08-28T12:00:00Z",
  });
  expect(entries[1]).toMatchObject({
    provider: "openrouter",
    publisher: "anthropic",
    family: "Claude",
    variants: ["alias"],
    current: true,
    pinned: false,
    lastUsedAt: null,
  });
});

test("normaliseModelCatalogue supports legacy strings, missing metadata, and duplicate keys", () => {
  const entries = normaliseModelCatalogue({
    current: "openai/gpt-5",
    model_options: [],
    models: ["openai/gpt-5", "anthropic/claude-4", "openai/gpt-5", "", null],
  });

  expect(entries).toHaveLength(2);
  expect(entries[0]).toMatchObject({
    key: "anthropic/claude-4",
    provider: "anthropic",
    id: "claude-4",
    displayName: "anthropic/claude-4",
    contextWindow: null,
  });
  expect(entries[1]).toMatchObject({ key: "openai/gpt-5", current: true });
});

test("normaliseModelCatalogue reconstructs partial structured identities without dropping routed publishers", () => {
  const entries = normaliseModelCatalogue({
    model_options: [
      { provider: "openrouter", label: "anthropic/claude-4", name: "Claude 4" },
      { provider: "openrouter", id: "gemini-3", label: "openrouter/google/gemini-3", name: "Gemini 3" },
      { id: "openrouter/meta/llama-3", label: "Llama 3", name: "Llama 3" },
      { provider: "openrouter", id: "openrouter/qwen/qwen3", name: "Qwen 3" },
    ],
  });

  expect(entries.some((entry) => entry.current)).toBe(false);
  expect(entries.map((entry) => ({ key: entry.key, provider: entry.provider, id: entry.id, publisher: entry.publisher }))).toEqual([
    { key: "openrouter/anthropic/claude-4", provider: "openrouter", id: "anthropic/claude-4", publisher: "anthropic" },
    { key: "openrouter/google/gemini-3", provider: "openrouter", id: "google/gemini-3", publisher: "google" },
    { key: "openrouter/meta/llama-3", provider: "openrouter", id: "meta/llama-3", publisher: "meta" },
    { key: "openrouter/qwen/qwen3", provider: "openrouter", id: "qwen/qwen3", publisher: "qwen" },
  ]);
});

test("normaliseModelCatalogue falls back to legacy models when structured options are unusable", () => {
  expect(normaliseModelCatalogue({
    model_options: [null, "", {}],
    models: ["openai/gpt-5"],
  }).map((entry) => entry.key)).toEqual(["openai/gpt-5"]);
});

test("normaliseModelCatalogue reconciles unique legacy current IDs and canonicalises provider casing", () => {
  const entries = normaliseModelCatalogue({
    current: "gpt-4o",
    model_options: [
      { label: "OpenAI/gpt-4o" },
      { provider: "OpenAI", id: "gpt-4o" },
      { provider: "openai", id: "gpt-4o" },
    ],
  }, { pinnedKeys: ["OpenAI/gpt-4o"] });

  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    key: "openai/gpt-4o",
    provider: "openai",
    id: "gpt-4o",
    current: true,
    pinned: true,
  });
});

test("classification infers encoded publishers, model families, and deterministic variants", () => {
  expect(classifyModelIdentity({ provider: "openrouter", id: "qwen/qwen3-coder", displayName: "Qwen3 Coder" })).toEqual({
    publisher: "qwen",
    family: "Qwen",
  });
  expect(classifyModelIdentity({ provider: "github-copilot", id: "o4-mini", displayName: "o4 mini" })).toEqual({
    publisher: null,
    family: "OpenAI o-series",
  });
  expect(classifyModelIdentity({ provider: "cerebras", id: "qwen3-235b", displayName: "" })).toEqual({
    publisher: null,
    family: "Qwen",
  });
  expect([
    classifyModelIdentity({ provider: "test", id: "claude3.5-sonnet", displayName: "" }).family,
    classifyModelIdentity({ provider: "test", id: "gemini2.5-pro", displayName: "" }).family,
    classifyModelIdentity({ provider: "test", id: "llama3.1-70b", displayName: "" }).family,
  ]).toEqual(["Claude", "Gemini", "Llama"]);
  expect(classifyModelVariants({ id: "google/gemini-3-preview:free-batch", displayName: "Gemini Image Fast" })).toEqual([
    "batch",
    "free",
    "preview",
    "fast",
    "image",
  ]);
  expect(classifyModelVariants({ id: "anthropic/claude-sonnet-latest" })).toEqual(["alias"]);
});

test("catalogue metadata does not invent backend admission or context fit", () => {
  const entries = normaliseModelCatalogue({ model_options: [
    { provider: "test", id: "near", context_window: 100_000 },
    { provider: "test", id: "small", context_window: 8_000 },
    { provider: "test", id: "unknown" },
  ] });
  for (const entry of entries) expect(entry).not.toHaveProperty("contextFit");
  expect(buildModelPickerProjection(entries).renderedEntries).toEqual(entries);
});

test("search matches shared name, identity, route, publisher, family, capability, variant, and context tokens", () => {
  const [entry] = normaliseModelCatalogue({
    model_options: [{
      provider: "openrouter",
      id: "google/gemini-3-preview:free",
      name: "Gemini 3 Flash",
      context_window: 1_000_000,
      reasoning: true,
    }],
  });
  const document = buildModelSearchDocument(entry);

  for (const token of ["gemini 3 flash", "openrouter", "google", "gemini", "preview", "free", "reasoning", "1m context"]) {
    expect(document).toContain(token);
  }
  expect(filterAndRankModels([entry], { query: "google reasoning 1m" })).toEqual([entry]);
  expect(filterAndRankModels([entry], { query: "anthropic" })).toEqual([]);

  const [nonReasoning] = normaliseModelCatalogue({
    model_options: [{ provider: "openrouter", id: "google/gemini-flash", reasoning: false }],
  });
  expect(buildModelSearchDocument(nonReasoning)).not.toContain("reasoning");
  expect(filterAndRankModels([nonReasoning], { query: "reasoning" })).toEqual([]);
});

test("filterAndRankModels keeps catalogue choices and deterministic recommended ranking", () => {
  const entries = normaliseModelCatalogue({
    current: "openrouter/openai/gpt-5",
    model_options: [
      { provider: "openrouter", id: "openai/gpt-5-preview", name: "GPT 5 Preview", context_window: 128_000, reasoning: true },
      { provider: "openrouter", id: "openai/gpt-5", name: "GPT 5", context_window: 200_000, reasoning: true },
      { provider: "openrouter", id: "openai/gpt-4:free", name: "GPT 4 Free", context_window: 200_000, reasoning: false },
      { provider: "openrouter", id: "openai/gpt-4:latest", name: "GPT 4 Latest", context_window: 200_000, reasoning: false },
      { provider: "github-copilot", id: "claude-sonnet-4", name: "Claude Sonnet 4", context_window: 200_000, reasoning: true },
    ],
  }, {
    pinnedKeys: ["github-copilot/claude-sonnet-4"],
    recentByKey: { "openrouter/openai/gpt-4:free": "2026-08-28T10:00:00Z" },
  });

  expect(filterAndRankModels(entries).map((entry) => entry.key)).toEqual([
    "openrouter/openai/gpt-5",
    "github-copilot/claude-sonnet-4",
    "openrouter/openai/gpt-4:free",
    "openrouter/openai/gpt-4:latest",
    "openrouter/openai/gpt-5-preview",
  ]);
  expect(filterAndRankModels(entries).map((entry) => entry.key)).toContain("openrouter/openai/gpt-5-preview");
  expect(filterAndRankModels(entries, { providers: " openrouter ", variants: " stable ", reasoning: false }).map((entry) => entry.key)).toEqual([
    "openrouter/openai/gpt-4:latest",
  ]);
});

test("groupModels groups access providers and encoded publishers with counts", () => {
  const entries = normaliseModelCatalogue({
    model_options: [
      { provider: "openrouter", id: "anthropic/claude-4", context_window: 200_000 },
      { provider: "openrouter", id: "google/gemini-3", context_window: 128_000 },
      { provider: "openrouter", id: "auto", context_window: 200_000 },
      { provider: "github-copilot", id: "gpt-5", context_window: 200_000 },
    ],
  });

  const groups = groupModels(entries);
  expect(groups.map((group) => group.provider)).toEqual(["github-copilot", "openrouter"]);
  expect(groups[1]).toMatchObject({
    provider: "openrouter",
    totalCount: 3,
  });
  expect(groups[1].entries.map((entry) => entry.id)).toEqual(["auto"]);
  expect(groups[1].publisherGroups.map((group) => ({ publisher: group.publisher, total: group.totalCount }))).toEqual([
    { publisher: "anthropic", total: 1 },
    { publisher: "google", total: 1 },
  ]);
});

test("405-model catalogue remains distinct, searchable, groupable, and naturally ordered", () => {
  const modelOptions = Array.from({ length: 405 }, (_, index) => ({
    provider: index < 360 ? "openrouter" : index < 385 ? "github-copilot" : "openai",
    id: index < 360
      ? `${["anthropic", "google", "openai", "qwen"][index % 4]}/model-${index}${index % 20 === 0 ? ":free" : ""}`
      : `model-${index}`,
    name: `Model ${index}`,
    context_window: index % 3 === 0 ? 128_000 : 200_000,
    reasoning: index % 2 === 0,
  }));
  const entries = normaliseModelCatalogue({ model_options: modelOptions });

  expect(entries).toHaveLength(405);
  expect(new Set(entries.map((entry) => entry.key)).size).toBe(405);
  expect(filterAndRankModels(entries, { query: "qwen model-31" }).map((entry) => entry.id)).toEqual([
    "qwen/model-31",
    "qwen/model-311",
    "qwen/model-315",
    "qwen/model-319",
  ]);
  expect(filterAndRankModels(entries)).toHaveLength(405);
  expect(groupModels(entries).reduce((count, group) => count + group.totalCount, 0)).toBe(405);
  expect(["model-2", "model-10", "model-1"].sort(compareModelCatalogueText)).toEqual(["model-1", "model-2", "model-10"]);
});

test("provider-less legacy entries use the same unknown sentinel for grouping and filtering", () => {
  const entries = normaliseModelCatalogue({ models: ["gpt-5"] });
  expect(groupModels(entries).map((group) => group.provider)).toEqual(["unknown"]);
  expect(filterAndRankModels(entries, { providers: "unknown" })).toEqual(entries);
});

test("model picker projection deduplicates priority sections and bounds a 405-model catalogue", () => {
  const modelOptions = Array.from({ length: 405 }, (_, index) => ({
    provider: "openrouter",
    id: `${["anthropic", "google", "openai", "qwen"][index % 4]}/model-${index}`,
    name: `Model ${index}`,
    context_window: index % 5 === 0 ? 128_000 : 200_000,
    reasoning: index % 2 === 0,
  }));
  const entries = normaliseModelCatalogue({
    current: "openrouter/anthropic/model-404",
    model_options: modelOptions,
  });
  const projection = buildModelPickerProjection(entries);

  expect(MODEL_PICKER_RENDER_LIMIT).toBe(100);
  expect(projection.totalMatches).toBe(405);
  expect(projection.renderedEntries).toHaveLength(100);
  expect(new Set(projection.renderedEntries.map((entry) => entry.key)).size).toBe(100);
  expect(projection.renderedEntries[0].key).toBe("openrouter/anthropic/model-404");
  expect(projection.sections.find((section) => section.key === "catalogue")?.groups.map((group) => group.label)).toEqual([
    "openrouter · anthropic",
  ]);
});

test("catalogue models stay searchable even when outside the initial render cap", () => {
  const entries = normaliseModelCatalogue({ model_options: Array.from({ length: 200 }, (_, index) => ({
    provider: "test", id: `model-${index}`, context_window: index < 150 ? 200_000 : 100_000,
  })) });
  expect(buildModelPickerProjection(entries).renderedEntries).toHaveLength(100);
  expect(buildModelPickerProjection(entries, { query: "model-199" }).renderedEntries.map((entry) => entry.key)).toEqual(["test/model-199"]);
});

test("models without context metadata remain selectable in the catalogue section", () => {
  const entries = normaliseModelCatalogue({ models: ["openai/gpt-5"] });
  const projection = buildModelPickerProjection(entries);

  expect(projection.sections.find((section) => section.key === "catalogue")?.label).toBe("Models");
  expect(moveModelPickerActiveKey(projection.renderedEntries, null, "first")).toBe("openai/gpt-5");
});

test("search results remain selectable without claiming fit", () => {
  const entries = normaliseModelCatalogue({ model_options: [{ provider: "test", id: "near", context_window: 100_000 }] });
  const projection = buildModelPickerProjection(entries, { query: "near" });
  expect(projection.renderedEntries).toEqual(entries);
  expect(projection.sections[0]?.label).toBe("Models");
  expect(moveModelPickerActiveKey(projection.renderedEntries, null, "first")).toBe("test/near");
});

test("model picker navigation supports arrows, boundaries, and page movement across all catalogue rows", () => {
  const entries = normaliseModelCatalogue({
    model_options: [
      { provider: "test", id: "one", context_window: 200_000 },
      { provider: "test", id: "two", context_window: 128_000 },
      { provider: "test", id: "three", context_window: 200_000 },
      { provider: "test", id: "four", context_window: 200_000 },
    ],
  });
  const ordered = filterAndRankModels(entries, { sort: "name" });

  expect(moveModelPickerActiveKey(ordered, null, "first")).toBe("test/four");
  expect(moveModelPickerActiveKey(ordered, null, "next")).toBe("test/four");
  expect(moveModelPickerActiveKey(ordered, null, "previous")).toBe("test/two");
  expect(moveModelPickerActiveKey(ordered, "test/four", "next")).toBe("test/one");
  expect(moveModelPickerActiveKey(ordered, "test/one", "next")).toBe("test/three");
  expect(moveModelPickerActiveKey(ordered, "test/three", "last")).toBe("test/two");
  expect(moveModelPickerActiveKey(ordered, "test/three", "page-previous", 2)).toBe("test/four");
});
