import { describe, expect, test } from "bun:test";

import {
  WebAdaptiveCardSidePromptService,
  type WebAdaptiveCardSidePromptServiceOptions,
} from "../../../../src/channels/web/cards/adaptive-card-side-prompt-service.js";

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

function createFixture(overrides: Partial<WebAdaptiveCardSidePromptServiceOptions> = {}) {
  const state = {
    sentMessages: [] as Array<{ chatJid: string; text: string; options?: unknown }>,
    broadcastEvents: [] as Array<{ eventType: string; data: unknown }>,
    skipFailedCalls: [] as string[],
    sidePromptCalls: [] as Array<{ chatJid: string; prompt: string; options?: Record<string, unknown> }>,
  };

  const options: WebAdaptiveCardSidePromptServiceOptions = {
    defaultChatJid: "web:default",
    defaultAgentId: "default",
    json,
    webRuntimeConfig: {
      debugCardSubmissions: false,
      sessionTtl: 3600,
      totpSecret: "",
      totpWindow: 1,
    },
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
    authGateway: {
      setTotpSecret: () => {},
      createTotpContext: () => ({
        buildSessionCookie: () => "piclaw_session=test",
      }),
    },
    interactionBroadcaster: {
      broadcastInteractionUpdated: () => {},
    },
    sendMessage: async (chatJid, text, options) => {
      state.sentMessages.push({ chatJid, text, options });
    },
    broadcastEvent: (eventType, data) => {
      state.broadcastEvents.push({ eventType, data });
    },
    skipFailedOnModelSwitch: (chatJid) => {
      state.skipFailedCalls.push(chatJid);
    },
    forwardAgentMessage: async () => new Response(JSON.stringify({ status: "ok" }), { status: 201 }),
    ...overrides,
  };

  return {
    state,
    service: new WebAdaptiveCardSidePromptService(options),
  };
}

describe("Web adaptive-card/side-prompt service", () => {
  test("preserves adaptive-card validation and client-handled open-url responses", async () => {
    const fixture = createFixture();

    const openUrlResponse = await fixture.service.handleAdaptiveCardAction(createRequest("/agent/card-action", {
      method: "POST",
      body: JSON.stringify({
        post_id: 7,
        card_id: "card-7",
        action: {
          type: "Action.OpenUrl",
          url: "https://example.com/runbook",
        },
      }),
    }));
    expect(openUrlResponse.status).toBe(200);
    expect(await openUrlResponse.json()).toEqual({
      status: "ok",
      handled: "client",
      action_type: "Action.OpenUrl",
      url: "https://example.com/runbook",
    });

    const unsupportedResponse = await fixture.service.handleAdaptiveCardAction(createRequest("/agent/card-action", {
      method: "POST",
      body: JSON.stringify({
        post_id: 7,
        card_id: "card-7",
        action: {
          type: "Action.Fly",
        },
      }),
    }));
    expect(unsupportedResponse.status).toBe(400);
    expect(await unsupportedResponse.json()).toEqual({ error: "Unsupported action type: Action.Fly" });
  });

  test("routes adaptive-card submissions back to the source post chat when chat_jid is missing or wrong", async () => {
    process.env.PICLAW_DB_IN_MEMORY = "1";
    const db = await import("../../../../src/db.js");
    db.initDatabase();
    db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");

    const sourcePostId = db.storeMessage({
      id: "card-source-1",
      chat_jid: "web:branch",
      sender: "agent",
      sender_name: "Agent",
      content: "Card host",
      timestamp: new Date().toISOString(),
      is_from_me: true,
      is_bot_message: true,
      content_blocks: [
        {
          type: "adaptive_card",
          card_id: "card-branch",
          state: "active",
          submit_behavior: "keep_active",
          payload: {
            type: "AdaptiveCard",
            version: "1.5",
            body: [],
            actions: [{ type: "Action.Submit", title: "Go", data: { intent: "generic" } }],
          },
        },
      ],
    });

    const forwardCalls: Array<{ chatJid: string; pathname: string }> = [];
    const fixture = createFixture({
      forwardAgentMessage: async (_req, pathname, chatJid) => {
        forwardCalls.push({ chatJid, pathname });
        return new Response(JSON.stringify({ status: "ok", id: 999 }), { status: 201 });
      },
    });

    const missingChatRes = await fixture.service.handleAdaptiveCardAction(createRequest("/agent/card-action", {
      method: "POST",
      body: JSON.stringify({
        post_id: sourcePostId,
        card_id: "card-branch",
        action: { type: "Action.Submit", title: "Go", data: { intent: "generic" } },
      }),
    }));
    expect(missingChatRes.status).toBe(201);
    expect(forwardCalls[0]?.chatJid).toBe("web:branch");

    const wrongChatRes = await fixture.service.handleAdaptiveCardAction(createRequest("/agent/card-action", {
      method: "POST",
      body: JSON.stringify({
        post_id: sourcePostId,
        chat_jid: "web:default",
        card_id: "card-branch",
        action: { type: "Action.Submit", title: "Go", data: { intent: "generic" } },
      }),
    }));
    expect(wrongChatRes.status).toBe(201);
    expect(forwardCalls[1]?.chatJid).toBe("web:branch");
  });

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
