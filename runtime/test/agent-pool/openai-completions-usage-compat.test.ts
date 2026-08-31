import { afterEach, expect, test } from "bun:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, Model } from "@earendil-works/pi-ai";

import {
  installOpenAICompletionsUsageCompatibility,
  scanOpenAICompletionsUsage,
} from "../../src/agent-pool/openai-completions-usage-compat.js";

const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;

afterEach(() => {
  if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
});

function model(): Model<"openai-completions"> {
  return {
    id: "test-model",
    name: "Test model",
    api: "openai-completions",
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 1, output: 2, cacheRead: 0.25, cacheWrite: 1.25 },
    contextWindow: 128_000,
    maxTokens: 4096,
  };
}

function completionFetch(usage: Record<string, unknown>, finishReason = "stop"): typeof fetch {
  return async () => {
    const chunks = [
      { id: "chatcmpl-test", model: "test-model", choices: [{ index: 0, delta: { content: "ok" }, finish_reason: null }] },
      { id: "chatcmpl-test", model: "test-model", choices: [{ index: 0, delta: {}, finish_reason: finishReason }], usage },
    ];
    return new Response(`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };
}

async function runtime(): Promise<ModelRuntime> {
  process.env.OPENROUTER_API_KEY = "test-key";
  const created = await ModelRuntime.create({
    modelsPath: null,
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  installOpenAICompletionsUsageCompatibility(created);
  return created;
}

function expectProvenance(message: AssistantMessage): void {
  expect(message.usage).toMatchObject({
    input: 100,
    output: 20,
    cacheRead: 0,
    cacheWrite: 0,
    cacheReadReported: true,
    cacheWriteReported: true,
    providerCost: 0.00123,
  });
}

test("bounded SSE scanner reads explicit cache fields and provider cost", async () => {
  const response = await completionFetch({
    prompt_tokens: 100,
    completion_tokens: 20,
    prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    cost: 0.00123,
  })(new Request("https://example.test"));
  expect(await scanOpenAICompletionsUsage(response)).toEqual({
    promptTokens: 100,
    cacheRead: 0,
    cacheWrite: 0,
    cacheReadReported: true,
    cacheWriteReported: true,
    providerCost: 0.00123,
  });
});

test("bounded SSE scanner ignores explicitly non-streaming response bodies", async () => {
  expect(await scanOpenAICompletionsUsage(new Response(JSON.stringify({ usage: { cost: 99 } }), {
    headers: { "content-type": "application/json" },
  }))).toBeNull();
});

test("ordinary ModelRuntime streams preserve explicit cache fields and provider cost", async () => {
  const modelRuntime = await runtime();
  const stream = modelRuntime.stream(model(), { messages: [] }, {
    fetch: completionFetch({
      prompt_tokens: 100,
      completion_tokens: 20,
      prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      cost: 0.00123,
    }),
  });
  expectProvenance(await stream.result());
});

test("ordinary streams use later finite cache candidates and recalculate token costs", async () => {
  const modelRuntime = await runtime();
  const message = await modelRuntime.stream(model(), { messages: [] }, {
    fetch: completionFetch({
      prompt_tokens: 100,
      completion_tokens: 20,
      prompt_tokens_details: { cached_tokens: "unavailable", cache_write_tokens: 10 },
      prompt_cache_hit_tokens: 30,
    }),
  }).result();
  expect(message.usage).toMatchObject({
    input: 60,
    output: 20,
    cacheRead: 30,
    cacheWrite: 10,
    totalTokens: 120,
    cacheReadReported: true,
    cacheWriteReported: true,
  });
  expect(message.usage.cost.input).toBeCloseTo(0.00006);
  expect(message.usage.cost.output).toBeCloseTo(0.00004);
  expect(message.usage.cost.cacheRead).toBeCloseTo(0.0000075);
  expect(message.usage.cost.cacheWrite).toBeCloseTo(0.0000125);
  expect(message.usage.cost.total).toBeCloseTo(0.00012);
});

test("retry scans prefer the latest response usage", async () => {
  const modelRuntime = await runtime();
  let attempts = 0;
  const message = await modelRuntime.stream(model(), { messages: [] }, {
    maxRetries: 1,
    maxRetryDelayMs: 1,
    fetch: async (...args) => {
      attempts += 1;
      if (attempts === 1) {
        return new Response("temporary failure", { status: 500, headers: { "content-type": "text/plain" } });
      }
      return completionFetch({ prompt_tokens: 50, completion_tokens: 5, cost: 0.5 })(...args);
    },
  }).result();
  expect(attempts).toBe(2);
  expect(message.usage).toMatchObject({ input: 50, output: 5, providerCost: 0.5 });
});

test("simple ModelRuntime streams distinguish omitted cache fields from explicit zero cost", async () => {
  const modelRuntime = await runtime();
  const message = await modelRuntime.streamSimple(model(), { messages: [] }, {
    fetch: completionFetch({ prompt_tokens: 100, completion_tokens: 20, cost: 0 }),
  }).result();
  expect(message.usage.cacheReadReported).toBe(false);
  expect(message.usage.cacheWriteReported).toBe(false);
  expect(message.usage.providerCost).toBe(0);
});

test("non-OpenAI-completions APIs pass through without replacing their stream", async () => {
  const startEvent = { type: "start", partial: {} };
  const source = { sentinel: true };
  const fake = {
    stream: () => source,
    streamSimple: () => source,
  } as any;
  installOpenAICompletionsUsageCompatibility(fake);
  expect(fake.stream({ api: "openai-responses" }, {}, { marker: startEvent })).toBe(source);
  expect(fake.streamSimple({ api: "anthropic-messages" }, {}, {})).toBe(source);
});

test("compatibility installation is idempotent and ignores malformed usage events", async () => {
  const modelRuntime = await runtime();
  installOpenAICompletionsUsageCompatibility(modelRuntime);
  const message = await modelRuntime.stream(model(), { messages: [] }, {
    fetch: async () => new Response([
      `data: ${JSON.stringify({ usage: "malformed", id: "chatcmpl-test", choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }] })}`,
      "data: [DONE]",
      "",
    ].join("\n\n"), { headers: { "content-type": "text/event-stream" } }),
  }).result();
  expect(message.stopReason).toBe("stop");
  expect(message.usage.cacheReadReported).toBeUndefined();
  expect(message.usage.cacheWriteReported).toBeUndefined();
  expect(message.usage.providerCost).toBeUndefined();
});
