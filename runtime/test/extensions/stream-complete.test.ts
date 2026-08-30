import { describe, expect, it, vi } from "vitest";
import { runWithPiclawCompactionTrigger } from "../../src/agent-pool/compaction-trigger-context.js";
import { streamComplete } from "../../src/extensions/smart-compaction/stream-complete.js";

function message(text: string) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    stopReason: "stop" as const,
    usage: { inputTokens: 1, outputTokens: 1 },
    timestamp: Date.now(),
  };
}

function fakeStream(events: any[], finalMessage: ReturnType<typeof message>) {
  let iterated = false;
  return {
    get iterated() { return iterated; },
    async *[Symbol.asyncIterator]() {
      iterated = true;
      for (const event of events) yield event;
    },
    async result() {
      return finalMessage;
    },
  };
}

describe("streamComplete", () => {
  it("uses async custom stream functions and reports text progress", async () => {
    const finalMessage = message("hello world");
    const stream = fakeStream([
      { type: "text_delta", delta: "hello" },
      { type: "text_delta", delta: " world" },
      { type: "done", message: finalMessage },
    ], finalMessage);
    const progress: number[] = [];
    const calls: any[] = [];

    const response = await streamComplete({
      model: { id: "test-model" },
      systemPrompt: "system",
      userPrompt: "summarize",
      maxTokens: 128,
      signal: new AbortController().signal,
      apiKey: "key",
      headers: { "x-test": "1", authorization: null },
      streamFn: async (model, context, options) => {
        calls.push({ model, context, options });
        return stream;
      },
      onProgress: (chars) => progress.push(chars),
      progressIntervalMs: 0,
    });

    expect(response).toBe(finalMessage);
    expect(stream.iterated).toBe(true);
    expect(progress).toEqual([5, 11, 11]);
    expect(calls).toHaveLength(1);
    expect(calls[0].context).toEqual({
      systemPrompt: "system",
      messages: [{
        role: "user",
        content: [{ type: "text", text: "summarize" }],
        timestamp: expect.any(Number),
      }],
    });
    expect(calls[0].options).toMatchObject({
      maxTokens: 128,
      apiKey: "key",
      headers: { "x-test": "1", authorization: null },
    });
  });

  it("passes the remaining Piclaw compaction deadline and reports first-token timing", async () => {
    const finalMessage = message("done");
    const events = [{ type: "text_delta", delta: "done" }, { type: "done", message: finalMessage }];
    const calls: any[] = [];
    const waiting: any[] = [];
    const firstTokens: any[] = [];
    const deadlineAtMs = Date.now() + 2_000;

    const response = await runWithPiclawCompactionTrigger({
      chatJid: "web:test",
      trigger: "manual",
      willRetry: false,
      source: "test",
      deadlineAtMs,
    }, async () => await streamComplete({
      model: { id: "test-model" },
      systemPrompt: "system",
      userPrompt: "summarize",
      maxTokens: 128,
      signal: new AbortController().signal,
      streamFn: (_model, _context, options) => {
        calls.push(options);
        return fakeStream(events, finalMessage);
      },
      onWaitingForFirstToken: (timing) => waiting.push(timing),
      onFirstToken: (timing) => firstTokens.push(timing),
      onProgress: () => {},
      progressIntervalMs: 0,
    }));

    expect(response).toBe(finalMessage);
    expect(calls[0].timeoutMs).toBeGreaterThan(0);
    expect(calls[0].timeoutMs).toBeLessThanOrEqual(2_000);
    expect(waiting).toEqual([expect.objectContaining({ timeoutMs: calls[0].timeoutMs })]);
    expect(firstTokens).toEqual([expect.objectContaining({ timeToFirstTokenMs: expect.any(Number) })]);
  });

  it("does not count stream metadata as first output but accepts reasoning deltas", async () => {
    const finalMessage = message("done");
    const firstTokens: any[] = [];
    await streamComplete({
      model: { id: "test-model" },
      systemPrompt: "system",
      userPrompt: "summarize",
      maxTokens: 128,
      signal: new AbortController().signal,
      streamFn: () => fakeStream([
        { type: "start" },
        { type: "thinking_delta", delta: "reasoning" },
        { type: "text_delta", delta: "done" },
      ], finalMessage),
      onFirstToken: (timing) => firstTokens.push(timing),
      onProgress: () => {},
      progressIntervalMs: 0,
    });
    expect(firstTokens).toHaveLength(1);
  });

  it("rejects a pre-aborted signal before starting a provider stream", async () => {
    const controller = new AbortController();
    controller.abort();
    const streamFn = vi.fn();

    await expect(streamComplete({
      model: { id: "test-model" },
      systemPrompt: "system",
      userPrompt: "summarize",
      maxTokens: 128,
      signal: controller.signal,
      streamFn,
    })).rejects.toThrow("Compaction cancelled");

    expect(streamFn).not.toHaveBeenCalled();
  });

  it("stops mid-stream cancellation without collecting or reporting later output", async () => {
    const controller = new AbortController();
    const finalMessage = message("must not be collected");
    const result = vi.fn(async () => finalMessage);
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield { type: "text_delta", delta: "first" };
        controller.abort();
        yield { type: "text_delta", delta: "later" };
      },
      result,
    };
    const progress: number[] = [];

    await expect(streamComplete({
      model: { id: "test-model" },
      systemPrompt: "system",
      userPrompt: "summarize",
      maxTokens: 128,
      signal: controller.signal,
      streamFn: () => stream,
      onProgress: (chars) => progress.push(chars),
      progressIntervalMs: 0,
    })).rejects.toThrow("Compaction cancelled");

    expect(progress).toEqual([5]);
    expect(result).not.toHaveBeenCalled();
  });

  it("rejects a provider result that resolves after cancellation", async () => {
    const controller = new AbortController();
    const finalMessage = message("late result");
    const stream = fakeStream([], finalMessage);
    const result = vi.spyOn(stream, "result").mockImplementation(async () => {
      controller.abort();
      return finalMessage;
    });

    await expect(streamComplete({
      model: { id: "test-model" },
      systemPrompt: "system",
      userPrompt: "summarize",
      maxTokens: 128,
      signal: controller.signal,
      streamFn: () => stream,
    })).rejects.toThrow("Compaction cancelled");

    expect(result).toHaveBeenCalledTimes(1);
  });

  it("does not iterate streams when no progress callback is provided", async () => {
    const finalMessage = message("done");
    const stream = fakeStream([{ type: "text_delta", delta: "ignored" }], finalMessage);

    const response = await streamComplete({
      model: { id: "test-model" },
      systemPrompt: "system",
      userPrompt: "summarize",
      maxTokens: 128,
      signal: new AbortController().signal,
      streamFn: () => stream,
    });

    expect(response).toBe(finalMessage);
    expect(stream.iterated).toBe(false);
  });
});
