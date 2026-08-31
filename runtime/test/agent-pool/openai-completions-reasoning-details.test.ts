import { beforeEach, describe, expect, test } from "bun:test";
import { Type } from "typebox";
import type { AssistantMessage, Model, Tool } from "@earendil-works/pi-ai";

const mockState = {
  chunkSets: [] as unknown[][],
  payloads: [] as unknown[],
};

const fakeFetch: typeof globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  mockState.payloads.push(await request.clone().json());
  const chunks = mockState.chunkSets.shift() ?? [];
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
};

const reasoningDetail = { type: "reasoning.encrypted", id: "call_1", data: "encrypted-signature" };

const readTool: Tool = {
  name: "read",
  description: "Read a file",
  parameters: Type.Object({ path: Type.String() }),
};

function model(): Model<"openai-completions"> {
  return {
    id: "google/gemini-test",
    name: "Gemini Test",
    api: "openai-completions",
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 100_000,
    maxTokens: 4096,
  };
}

function chunk(delta: Record<string, unknown>, finishReason: string | null = null): unknown {
  return {
    id: "chatcmpl-test",
    model: "google/gemini-test",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function toolCallChunk(): unknown {
  return chunk({
    tool_calls: [
      {
        index: 0,
        id: "call_1",
        type: "function",
        function: { name: "read", arguments: '{"path":"README.md"}' },
      },
    ],
  });
}

async function runOpenAICompletionsStream(messages: AssistantMessage[] = []): Promise<AssistantMessage> {
  const { stream } = await import("@earendil-works/pi-ai/api/openai-completions");
  return await stream(model(), { messages, tools: [readTool] }, { apiKey: "test", fetch: fakeFetch }).result();
}

function getAssistantPayload(payload: unknown): { reasoning_details?: unknown } | undefined {
  const messages = (payload as { messages?: Array<{ role?: string; reasoning_details?: unknown }> }).messages ?? [];
  return messages.find((message) => message.role === "assistant");
}

describe("OpenAI-completions reasoning_details preservation", () => {
  beforeEach(() => {
    mockState.chunkSets = [];
    mockState.payloads = [];
  });

  test("inherits upstream preservation for reasoning_details that arrive before their matching tool call", async () => {
    mockState.chunkSets = [
      [chunk({ reasoning_details: [reasoningDetail] }), toolCallChunk(), chunk({}, "tool_calls")],
      [chunk({ content: "ok" }), chunk({}, "stop")],
    ];

    const assistantMessage = await runOpenAICompletionsStream();
    const toolCall = assistantMessage.content.find((block) => block.type === "toolCall");
    const thinking = assistantMessage.content.find((block) => block.type === "thinking");
    expect(toolCall).toMatchObject({
      type: "toolCall",
      id: "call_1",
      name: "read",
      arguments: { path: "README.md" },
    });
    expect(thinking).toMatchObject({
      type: "thinking",
      thinking: "",
      thinkingSignature: JSON.stringify([reasoningDetail]),
    });
    expect(JSON.stringify(assistantMessage.content)).toContain("thinkingSignature");
    expect(assistantMessage.content.filter((block) => block.type === "text").map((block) => block.text).join("\n"))
      .not.toContain("encrypted-signature");

    await runOpenAICompletionsStream([assistantMessage]);

    expect(getAssistantPayload(mockState.payloads[1])?.reasoning_details).toEqual([reasoningDetail]);
  });

  test("inherits upstream failure when a stream ends without finish_reason", async () => {
    mockState.chunkSets = [[chunk({ content: "partial answer" })]];

    const assistantMessage = await runOpenAICompletionsStream();
    expect(assistantMessage.stopReason).toBe("error");
    expect(assistantMessage.errorMessage).toContain("finish_reason");
  });
});
