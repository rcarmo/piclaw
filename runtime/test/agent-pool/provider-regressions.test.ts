import { describe, expect, test } from "bun:test";
import { Type } from "typebox";
import type { AssistantMessage, Context, Model } from "@earendil-works/pi-ai";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import {
  convertResponsesMessages,
  processResponsesStream,
} from "@earendil-works/pi-ai/api/openai-responses-shared";
import { stream as streamOpenAIResponses } from "@earendil-works/pi-ai/api/openai-responses";

function azureModel(): Model<"azure-openai-responses"> {
  return {
    id: "gpt-5-mini",
    name: "GPT-5 Mini",
    api: "azure-openai-responses",
    provider: "azure-openai-responses",
    baseUrl: "https://example.invalid",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 400_000,
    maxTokens: 128_000,
  };
}

function assistantOutput(model: Model<"azure-openai-responses">): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

async function* terminalEncryptedReasoningEvents(): AsyncIterable<any> {
  yield {
    type: "response.output_item.added",
    output_index: 0,
    sequence_number: 0,
    item: { type: "reasoning", id: "rs_missing", summary: [] },
  };
  yield {
    type: "response.output_item.done",
    output_index: 0,
    sequence_number: 1,
    item: { type: "reasoning", id: "rs_missing", summary: [] },
  };
  yield {
    type: "response.completed",
    sequence_number: 2,
    response: {
      id: "resp_test",
      status: "completed",
      output: [{
        type: "reasoning",
        id: "rs_missing",
        summary: [],
        encrypted_content: "from-response-completed",
      }],
    },
  };
}

describe("Earendil 0.81.x provider regressions", () => {
  test("built-in catalogs expose Fable 5 max, Copilot MAI Responses, corrected OpenRouter context, and OpenCode affinity", () => {
    const anthropicFable = getBuiltinModels("anthropic").find((model) => model.id === "claude-fable-5");
    expect(anthropicFable?.thinkingLevelMap).toMatchObject({ xhigh: "xhigh", max: "max" });

    const copilotMai = getBuiltinModels("github-copilot").find((model) => model.id === "mai-code-1-flash-picker");
    expect(copilotMai?.api).toBe("openai-responses");

    const openRouterQwenCoder = getBuiltinModels("openrouter").find((model) => model.id === "qwen/qwen3-coder");
    expect(openRouterQwenCoder?.contextWindow).toBe(262_144);

    const openCodeResponses = getBuiltinModels("opencode").find((model) => model.api === "openai-responses");
    expect(openCodeResponses?.compat).toMatchObject({ sessionAffinityFormat: "openai-nosession" });
  });

  test("Moonshot Kimi K3 metadata uses OpenAI thinking format with reasoning effort support", () => {
    for (const provider of ["moonshotai", "moonshotai-cn"] as const) {
      const kimiK3 = getBuiltinModels(provider).find((model) => model.id === "kimi-k3");
      expect(kimiK3, provider).toBeDefined();
      expect(kimiK3?.api).toBe("openai-completions");
      expect(kimiK3?.reasoning).toBe(true);
      expect(kimiK3?.thinkingLevelMap).toMatchObject({ low: "low", high: "high", max: "max" });
      expect(kimiK3?.thinkingLevelMap?.minimal).toBeNull();
      expect(kimiK3?.thinkingLevelMap?.medium).toBeNull();
      expect(kimiK3?.compat).toMatchObject({
        thinkingFormat: "openai",
        supportsReasoningEffort: true,
        supportsDeveloperRole: false,
        requiresReasoningContentOnAssistantMessages: true,
        deferredToolsMode: "kimi",
      });
    }
  });

  test("OpenRouter Responses uses its native session header and omits OpenAI session_id", async () => {
    // Run in a subprocess because the repository suite contains other fetch-mocking
    // tests; sharing globalThis.fetch would make this header assertion racy.
    const script = String.raw`
      import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
      import { stream } from "@earendil-works/pi-ai/api/openai-responses";
      const model = {
        ...getBuiltinModels("openai").find((candidate) => candidate.id === "gpt-5.4"),
        provider: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
      };
      let requestHeaders = new Headers();
      let payload;
      globalThis.fetch = async (_input, init) => {
        requestHeaders = new Headers(init?.headers);
        return new Response("data: [DONE]\\n\\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      };
      const response = stream(model, {
        messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
      }, {
        apiKey: "test-key",
        sessionId: "session-openrouter",
        onPayload: (value) => { payload = value; },
      });
      for await (const event of response) {
        if (event.type === "done" || event.type === "error") break;
      }
      console.log(JSON.stringify({
        xSessionId: requestHeaders.get("x-session-id"),
        sessionId: requestHeaders.get("session_id"),
        clientRequestId: requestHeaders.get("x-client-request-id"),
        payloadSessionId: payload?.session_id ?? null,
        promptCacheKey: payload?.prompt_cache_key ?? null,
      }));
    `;
    const child = Bun.spawn([process.execPath, "-e", script], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exitCode, stderr).toBe(0);
    const captured = JSON.parse(stdout.trim()) as Record<string, string | null>;

    expect(captured.xSessionId).toBe("session-openrouter");
    expect(captured.sessionId).toBeNull();
    expect(captured.clientRequestId).toBeNull();
    expect(captured.payloadSessionId).toBeNull();
    expect(captured.promptCacheKey).toBe("session-openrouter");
  });

  test("OpenAI Responses forwards required and named toolChoice values", async () => {
    const model = getBuiltinModels("openai").find((candidate) => candidate.id === "gpt-5.4")!;
    const originalFetch = globalThis.fetch;
    const payloads: unknown[] = [];
    globalThis.fetch = (async () => new Response("data: [DONE]\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    })) as typeof fetch;

    try {
      for (const toolChoice of ["required", { type: "function", name: "ping" }] as const) {
        const stream = streamOpenAIResponses(model, {
          messages: [{ role: "user", content: "Call ping", timestamp: Date.now() }],
          tools: [{ name: "ping", description: "Ping", parameters: Type.Object({ value: Type.String() }) }],
        }, {
          apiKey: "test-key",
          toolChoice,
          onPayload: (payload) => payloads.push(payload),
        });
        for await (const event of stream) {
          if (event.type === "done" || event.type === "error") break;
        }
      }
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(payloads[0]).toMatchObject({ tool_choice: "required" });
    expect(payloads[1]).toMatchObject({ tool_choice: { type: "function", name: "ping" } });
  });

  test("Azure replay backfills terminal encrypted_content for the next request", async () => {
    const model = azureModel();
    const output = assistantOutput(model);
    await processResponsesStream(
      terminalEncryptedReasoningEvents(),
      output,
      { push() {} } as any,
      model,
    );

    const context: Context = {
      messages: [
        { role: "user", content: "first", timestamp: Date.now() - 1 },
        output,
        { role: "user", content: "follow-up", timestamp: Date.now() },
      ],
    };
    const input = convertResponsesMessages(model, context, new Set(["azure-openai-responses"]));
    expect(input.find((item) => item.type === "reasoning")).toMatchObject({
      type: "reasoning",
      id: "rs_missing",
      encrypted_content: "from-response-completed",
    });
  });
});
