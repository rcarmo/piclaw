import { describe, expect, test } from "bun:test";

import {
  WebSidePromptService,
  type WebSidePromptServiceOptions,
} from "../../../../src/channels/web/agent/side-prompt-service.js";

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`http://localhost${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    ...init,
  });
}

function createFixture(overrides: Partial<WebSidePromptServiceOptions> = {}) {
  const state = {
    sidePromptCalls: [] as Array<{ chatJid: string; prompt: string; options?: Record<string, unknown> }>,
  };

  const options: WebSidePromptServiceOptions = {
    defaultChatJid: "web:default",
    json,
    agentPool: {
      runSidePrompt: async (chatJid, prompt, options) => {
        state.sidePromptCalls.push({
          chatJid,
          prompt,
          options: options ? { ...options } : undefined,
        });
        return {
          status: "success",
          result: `answer:${prompt}`,
          thinking: options?.systemPrompt ?? null,
          model: `model-for:${chatJid}`,
          stopReason: "stop",
        };
      },
    },
    ...overrides,
  };

  return {
    state,
    service: new WebSidePromptService(options),
  };
}

describe("Web side-prompt service", () => {
  test("delegates parsed side-prompt payloads and maps error results to 502", async () => {
    const fixture = createFixture();

    const successResponse = await fixture.service.handleAgentSidePrompt(createRequest("/agent/side-prompt", {
      method: "POST",
      body: JSON.stringify({
        prompt: "What changed?",
        system_prompt: "Summarize briefly.",
        chat_jid: "web:branch",
      }),
    }));
    expect(successResponse.status).toBe(200);
    expect(await successResponse.json()).toEqual({
      status: "success",
      result: "answer:What changed?",
      thinking: "Summarize briefly.",
      model: "model-for:web:branch",
      stopReason: "stop",
    });
    expect(fixture.state.sidePromptCalls).toEqual([
      {
        chatJid: "web:branch",
        prompt: "What changed?",
        options: { systemPrompt: "Summarize briefly." },
      },
    ]);

    const failingCalls: Array<{ chatJid: string; prompt: string; options?: Record<string, unknown> }> = [];
    const failingFixture = createFixture({
      agentPool: {
        runSidePrompt: async (chatJid, prompt, options) => {
          failingCalls.push({
            chatJid,
            prompt,
            options: options ? { ...options } : undefined,
          });
          return {
            status: "error",
            result: null,
            thinking: null,
            model: null,
            error: "backend unavailable",
          };
        },
      },
    });

    const failingResponse = await failingFixture.service.handleAgentSidePrompt(createRequest("/agent/side-prompt", {
      method: "POST",
      body: JSON.stringify({ prompt: "Retry?" }),
    }));
    expect(failingResponse.status).toBe(502);
    expect(await failingResponse.json()).toEqual({
      status: "error",
      result: null,
      thinking: null,
      model: null,
      error: "backend unavailable",
    });
    expect(failingCalls).toEqual([
      {
        chatJid: "web:default",
        prompt: "Retry?",
        options: {},
      },
    ]);
  });

  test("streams side-prompt SSE frames for deltas and terminal success/error events", async () => {
    const streamCalls: Array<{ chatJid: string; prompt: string; options?: Record<string, unknown> }> = [];
    const fixture = createFixture({
      agentPool: {
        runSidePrompt: async (chatJid, prompt, options) => {
          streamCalls.push({
            chatJid,
            prompt,
            options: options ? { ...options } : undefined,
          });
          options?.onThinkingDelta?.("plan");
          options?.onTextDelta?.("answer");
          return {
            status: "success",
            result: `answer:${prompt}`,
            thinking: "plan",
            model: `model-for:${chatJid}`,
            stopReason: "stop",
          };
        },
      },
    });

    const successResponse = await fixture.service.handleAgentSidePromptStream(createRequest("/agent/side-prompt/stream", {
      method: "POST",
      body: JSON.stringify({
        prompt: "What changed?",
        system_prompt: "Summarize briefly.",
        chat_jid: "web:stream",
      }),
    }));
    expect(successResponse.status).toBe(200);
    expect(successResponse.headers.get("Content-Type")).toContain("text/event-stream");
    const successBody = await successResponse.text();
    expect(successBody).toContain("event: side_prompt_start");
    expect(successBody).toContain('"chat_jid":"web:stream"');
    expect(successBody).toContain("event: side_prompt_thinking_delta");
    expect(successBody).toContain('"delta":"plan"');
    expect(successBody).toContain("event: side_prompt_text_delta");
    expect(successBody).toContain('"delta":"answer"');
    expect(successBody).toContain("event: side_prompt_done");
    expect(successBody).toContain('"result":"answer:What changed?"');
    expect(streamCalls).toHaveLength(1);
    expect(streamCalls[0]?.chatJid).toBe("web:stream");
    expect(streamCalls[0]?.prompt).toBe("What changed?");
    expect(streamCalls[0]?.options?.systemPrompt).toBe("Summarize briefly.");

    const errorFixture = createFixture({
      agentPool: {
        runSidePrompt: async () => {
          throw new Error("stream exploded");
        },
      },
    });

    const errorResponse = await errorFixture.service.handleAgentSidePromptStream(createRequest("/agent/side-prompt/stream", {
      method: "POST",
      body: JSON.stringify({ prompt: "Retry?" }),
    }));
    const errorBody = await errorResponse.text();
    expect(errorBody).toContain("event: side_prompt_start");
    expect(errorBody).toContain("event: side_prompt_error");
    expect(errorBody).toContain('"error":"stream exploded"');
  });

  test("keeps side-prompt SSE streams alive with heartbeats and clears them on abort", async () => {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const intervals: Array<{ fn: TimerHandler; ms?: number; token: object }> = [];
    const cleared: object[] = [];

    globalThis.setInterval = ((fn: TimerHandler, ms?: number) => {
      const token = {};
      intervals.push({ fn, ms, token });
      return token as ReturnType<typeof setInterval>;
    }) as typeof setInterval;

    globalThis.clearInterval = ((token: object) => {
      cleared.push(token);
    }) as typeof clearInterval;

    try {
      const abortController = new AbortController();
      const fixture = createFixture({
        agentPool: {
          runSidePrompt: async () => await new Promise<never>(() => {}),
        },
      });

      const response = await fixture.service.handleAgentSidePromptStream(createRequest("/agent/side-prompt/stream", {
        method: "POST",
        body: JSON.stringify({ prompt: "Keepalive?", chat_jid: "web:stream" }),
        signal: abortController.signal,
      }));
      expect(response.status).toBe(200);

      const reader = response.body?.getReader();
      expect(reader).toBeDefined();

      const startChunk = await reader!.read();
      const startBody = new TextDecoder().decode(startChunk.value);
      expect(startBody).toContain("event: side_prompt_start");
      expect(intervals).toHaveLength(1);
      expect(intervals[0]?.ms).toBe(30000);

      const heartbeatHandler = intervals[0]?.fn;
      expect(typeof heartbeatHandler).toBe("function");
      if (typeof heartbeatHandler === "function") {
        heartbeatHandler();
      }

      const heartbeatCommentChunk = await reader!.read();
      const heartbeatCommentBody = new TextDecoder().decode(heartbeatCommentChunk.value);
      expect(heartbeatCommentBody).toContain(": heartbeat");

      const heartbeatEventChunk = await reader!.read();
      const heartbeatEventBody = new TextDecoder().decode(heartbeatEventChunk.value);
      expect(heartbeatEventBody).toContain("event: heartbeat");
      expect(heartbeatEventBody).toContain('"chat_jid":"web:stream"');

      abortController.abort();
      const doneChunk = await reader!.read();
      expect(doneChunk.done).toBe(true);
      expect(cleared).toContain(intervals[0]?.token);
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });
});
