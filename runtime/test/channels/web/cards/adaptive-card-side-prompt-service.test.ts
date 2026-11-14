import { describe, expect, test } from "bun:test";

import {
  WebAdaptiveCardSidePromptService,
  type WebAdaptiveCardSidePromptServiceOptions,
} from "../../../../src/channels/web/cards/adaptive-card-side-prompt-service.js";
import { createNativeControlFixture } from "../../../agent-control/native-control-fixture.js";
import { withChatContext } from "../../../../src/core/chat-context.js";
import { createTestModelRegistry, TestAgentControlSession } from "../../../agent-control/session-fixture.js";
import { getTestWorkspace } from "../../../helpers.js";

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
  test("actual provider multi-prompt events stay transient across reveal and continuation with no transcript secrets", async () => {
    const db = await import("../../../../src/db.js");
    db.initDatabase();
    const sentinel = "PRIVATE-integrated-provider";
    const registry = createTestModelRegistry([{ provider: "openai", id: "one" }]);
    registry.modelRuntime.login = async (_id: string, _type: string, input: any) => {
      input.notify({ type: "auth_url", url: `https://auth.example.test/?state=${sentinel}`, instructions: sentinel });
      await input.prompt({ type: "secret", message: `${sentinel}-first` });
      input.notify({ type: "progress", message: `${sentinel}-progress` });
      await input.prompt({ type: "text", message: `${sentinel}-second` });
    };
    const session = new TestAgentControlSession(getTestWorkspace().workspace, registry);
    const chat = "web:integrated-private";
    const control = createNativeControlFixture(session, registry, chat);
    const run = (command: any) => withChatContext(chat, "web", () => control.facade.applyControlCommand(chat, command));
    try {
      const start = await run({ type: "login", provider: '__step1 {"provider":"openai"}', raw: "/login __step1" });
      const card = start.contentBlocks![0] as any;
      const postId = db.storeMessage({ id: crypto.randomUUID(), chat_jid: chat, sender: "agent", sender_name: "Agent", content: start.message, timestamp: new Date().toISOString(), is_from_me: true, is_bot_message: true, content_blocks: start.contentBlocks });
      const broadcasts: unknown[] = [];
      const fixture = createFixture({ agentPool: { applyControlCommand: async (_chat, command) => run(command) }, interactionBroadcaster: { broadcastInteractionUpdated: row => broadcasts.push(row) } });
      const submit = (id: string, data: object) => fixture.service.handleAdaptiveCardAction(createRequest("/agent/card-action", { method: "POST", body: JSON.stringify({ chat_jid: chat, post_id: postId, card_id: id, action: { type: "Action.Submit", data } }) }));
      const reveal = card.payload.actions.find((action: any) => action.data.method === "runtime_present").data;
      const shown = await submit(card.card_id, reveal);
      expect(shown.status).toBe(200);
      const response = await shown.json() as any;
      expect(response.auth_presentation.prompt.message).toBe(`${sentinel}-first`);
      const next = await submit(response.card_id, { ...response.auth_presentation.action_data, method: "runtime_continue", auth_value: `${sentinel}-value` });
      expect(next.status).toBe(200);
      const second = await next.json() as any;
      expect(second.auth_presentation.prompt.message).toBe(`${sentinel}-second`);
      expect(fixture.state.sentMessages).toEqual([]);
      expect(JSON.stringify({ row: db.getMessageByRowId(chat, postId), broadcasts })).not.toContain(sentinel);
      expect((await submit(response.card_id, { ...response.auth_presentation.action_data, method: "runtime_continue", auth_value: "replay" })).status).toBe(409);
      const done = await submit(second.card_id, { ...second.auth_presentation.action_data, method: "runtime_continue", auth_value: "done" });
      expect(done.status).toBe(200);
      expect(JSON.stringify({ row: db.getMessageByRowId(chat, postId), broadcasts, sent: fixture.state.sentMessages })).not.toContain(sentinel);
    } finally { control.dispose(); }
  });
  test("private provider presentation leaves only in no-store response, while safe card bindings rotate", async () => {
    const db = await import("../../../../src/db.js");
    db.initDatabase();
    const sentinel = "PRIVATE-provider-url-and-code";
    const data = { intent: "login-step2", provider: "openai", auth_type: "oauth", flow_id: "owned", action_id: "reveal", method: "runtime_present" };
    const block = { type: "adaptive_card", card_id: "private-old", state: "active", payload: { type: "AdaptiveCard", actions: [{ type: "Action.Submit", data }] } };
    const postId = db.storeMessage({ id: crypto.randomUUID(), chat_jid: "web:private-auth", sender: "agent", sender_name: "Agent", content: "Authentication", timestamp: new Date().toISOString(), is_from_me: true, is_bot_message: true, content_blocks: [block] });
    const broadcasts: unknown[] = [];
    const fixture = createFixture({ interactionBroadcaster: { broadcastInteractionUpdated: row => broadcasts.push(row) }, agentPool: { applyControlCommand: async () => ({
      status: "success", message: sentinel,
      contentBlocks: [{ ...block, card_id: "private-next", payload: { type: "AdaptiveCard", actions: [{ type: "Action.Submit", data: { ...data, action_id: "next" } }] } }],
      authPresentation: { expires_at: Date.now() + 60_000, events: [{ type: "auth_url", url: `https://example.test/?state=${sentinel}` }], prompt: { type: "secret", message: sentinel }, action_data: { ...data, action_id: "next" } },
    }) } });
    const request = (chat: string) => createRequest("/agent/card-action", { method: "POST", body: JSON.stringify({ chat_jid: chat, post_id: postId, card_id: "private-old", action: { type: "Action.Submit", data } }) });
    expect((await fixture.service.handleAdaptiveCardAction(createRequest("/agent/card-action", { method: "POST", body: JSON.stringify({ post_id: postId, card_id: "private-old", action: { type: "Action.Submit", data } }) }))).status).toBe(409);
    expect((await fixture.service.handleAdaptiveCardAction(request("web:foreign"))).status).toBe(404);
    const response = await fixture.service.handleAdaptiveCardAction(request("web:private-auth"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(JSON.stringify(await response.json())).toContain(sentinel);
    expect(fixture.state.sentMessages).toEqual([]);
    expect(fixture.state.broadcastEvents).toEqual([]);
    expect(JSON.stringify({ persisted: db.getMessageByRowId("web:private-auth", postId), broadcasts })).not.toContain(sentinel);
    expect((await fixture.service.handleAdaptiveCardAction(request("web:private-auth"))).status).toBe(409);
  });
  test("login secrets reach only the in-memory handler and never completed card or submission state", async () => {
    process.env.PICLAW_DB_IN_MEMORY = "1";
    const db = await import("../../../../src/db.js");
    db.initDatabase();
    const sentinel = "AUTH-secret-input-sentinel";
    const actionData = { intent: "login-step2", provider: "openai", method: "runtime_continue", auth_type: "api_key", flow_id: "flow", action_id: "action" };
    const postId = db.storeMessage({
      id: `login-secret-${crypto.randomUUID()}`, chat_jid: "web:auth-test", sender: "agent", sender_name: "Agent", content: "Authentication", timestamp: new Date().toISOString(), is_from_me: true, is_bot_message: true,
      content_blocks: [{ type: "adaptive_card", card_id: "secret-login-card", state: "active", payload: { type: "AdaptiveCard", version: "1.5", body: [{ type: "Input.Text", id: "auth_value", style: "password" }], actions: [{ type: "Action.Submit", title: "Continue", data: actionData }] } }],
    });
    const received: any[] = [];
    const fixture = createFixture({ agentPool: { applyControlCommand: async (_chat, command) => {
      received.push(JSON.parse(command.provider.slice(8)));
      return { status: "success", message: "Authentication completed." };
    } } });
    const response = await fixture.service.handleAdaptiveCardAction(createRequest("/agent/card-action", {
      method: "POST", body: JSON.stringify({ chat_jid: "web:auth-test", post_id: postId, card_id: "secret-login-card", action: { type: "Action.Submit", title: sentinel, data: { ...actionData, auth_value: sentinel } } }),
    }));
    expect(response.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0].auth_value).toBe(sentinel);
    const persisted = db.getMessageByRowId("web:auth-test", postId);
    expect(JSON.stringify({ persisted, sent: fixture.state.sentMessages, response: await response.json() })).not.toContain(sentinel);
    expect((persisted?.data?.content_blocks?.[0] as any)?.last_submission?.data).toBeUndefined();
  });

  test("login action bindings reject altered provider/flow metadata before handler or card mutation", async () => {
    process.env.PICLAW_DB_IN_MEMORY = "1";
    const db = await import("../../../../src/db.js");
    db.initDatabase();
    const data = { intent: "login-step2", provider: "openai", method: "runtime_continue", flow_id: "owned", action_id: "prompt" };
    const postId = db.storeMessage({
      id: `login-binding-${crypto.randomUUID()}`, chat_jid: "web:binding", sender: "agent", sender_name: "Agent", content: "Authentication", timestamp: new Date().toISOString(), is_from_me: true, is_bot_message: true,
      content_blocks: [{ type: "adaptive_card", card_id: "bound-login-card", state: "active", payload: { type: "AdaptiveCard", version: "1.5", body: [], actions: [{ type: "Action.Submit", data }] } }],
    });
    let calls = 0;
    const fixture = createFixture({ agentPool: { applyControlCommand: async () => { calls++; return { status: "success", message: "unexpected" }; } } });
    const response = await fixture.service.handleAdaptiveCardAction(createRequest("/agent/card-action", {
      method: "POST", body: JSON.stringify({ post_id: postId, card_id: "bound-login-card", action: { type: "Action.Submit", data: { ...data, provider: "foreign", auth_value: "secret" } } }),
    }));
    expect(response.status).toBe(409);
    expect(calls).toBe(0);
    expect((db.getMessageByRowId("web:binding", postId)?.data?.content_blocks?.[0] as any)?.state).toBe("active");
    const substituted = await fixture.service.handleAdaptiveCardAction(createRequest("/agent/card-action", {
      method: "POST", body: JSON.stringify({ post_id: postId, card_id: "bound-login-card", action: { type: "Action.Submit", data: { intent: "ordinary-note", auth_value: "AUTH-substitution-sentinel" } } }),
    }));
    expect(substituted.status).toBe(409);
    expect(JSON.stringify(db.getMessageByRowId("web:binding", postId))).not.toContain("AUTH-substitution-sentinel");
  });

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

  test("routes login adaptive-card submissions through the source chat/thread and broadcasts model changes on success", async () => {
    process.env.PICLAW_DB_IN_MEMORY = "1";
    const db = await import("../../../../src/db.js");
    db.initDatabase();
    db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");

    const sourcePostId = db.storeMessage({
      id: "login-card-source-success",
      chat_jid: "web:branch",
      sender: "agent",
      sender_name: "Agent",
      content: "Provider authentication",
      timestamp: new Date().toISOString(),
      is_from_me: true,
      is_bot_message: true,
      thread_id: 17,
      content_blocks: [
        {
          type: "adaptive_card",
          card_id: "login-card-success",
          state: "active",
          submit_behavior: "keep_active",
          payload: {
            type: "AdaptiveCard",
            version: "1.5",
            body: [],
            actions: [{ type: "Action.Submit", title: "Check", data: { intent: "login-step2", provider: "github-copilot", method: "oauth_check" } }],
          },
        },
      ],
    });

    const applyCalls: Array<{ chatJid: string; command: { type: "login"; provider: string; raw: string } }> = [];
    const fixture = createFixture({
      agentPool: {
        runSidePrompt: async (chatJid, prompt, options) => ({
          status: "success",
          result: `answer:${prompt}`,
          thinking: options?.systemPrompt ?? null,
          model: `model-for:${chatJid}`,
          stopReason: "stop",
        }),
        applyControlCommand: async (chatJid, command) => {
          applyCalls.push({ chatJid, command });
          return {
            status: "success",
            message: "✓ GitHub Copilot authenticated.",
            contentBlocks: [{
              type: "adaptive_card",
              card_id: "login-model-picker",
              state: "active",
              payload: { type: "AdaptiveCard", version: "1.5", body: [], actions: [] },
            }],
            model_label: "github-copilot/gpt-4.1",
            thinking_level: "medium",
          };
        },
        getAvailableModels: async () => ({
          current: "github-copilot/gpt-4.1",
          thinking_level: "medium",
          supports_thinking: true,
        }),
      },
    });

    const response = await fixture.service.handleAdaptiveCardAction(createRequest("/agent/card-action", {
      method: "POST",
      body: JSON.stringify({
        post_id: sourcePostId,
        chat_jid: "web:branch",
        card_id: "login-card-success",
        action: { type: "Action.Submit", title: "Check", data: { intent: "login-step2", provider: "github-copilot", method: "oauth_check" } },
      }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      card_updated: false,
      source_post_id: sourcePostId,
      card_id: "login-card-success",
      submitted_at: expect.any(String),
      auth_result: "success",
    });
    expect(applyCalls).toHaveLength(1);
    expect(applyCalls[0]).toEqual({
      chatJid: "web:branch",
      command: {
        type: "login",
        provider: `__step2 ${JSON.stringify({ intent: "login-step2", provider: "github-copilot", method: "oauth_check" })}`,
        raw: "/login __step2 ",
      },
    });
    expect(fixture.state.sentMessages).toEqual([
      {
        chatJid: "web:branch",
        text: "✓ GitHub Copilot authenticated.",
        options: {
          threadId: 17,
          contentBlocks: [{
            type: "adaptive_card",
            card_id: "login-model-picker",
            state: "active",
            payload: { type: "AdaptiveCard", version: "1.5", body: [], actions: [] },
          }],
        },
      },
    ]);
    expect(fixture.state.broadcastEvents).toEqual([
      {
        eventType: "model_changed",
        data: {
          chat_jid: "web:branch",
          model: "github-copilot/gpt-4.1",
          thinking_level: "medium",
          supports_thinking: true,
        },
      },
    ]);
    expect(fixture.state.skipFailedCalls).toEqual([]);
  });

  test("routes login adaptive-card failures back to the source chat/thread without model-change broadcasts", async () => {
    process.env.PICLAW_DB_IN_MEMORY = "1";
    const db = await import("../../../../src/db.js");
    db.initDatabase();
    db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");

    const sourcePostId = db.storeMessage({
      id: "login-card-source-error",
      chat_jid: "web:branch",
      sender: "agent",
      sender_name: "Agent",
      content: "Provider authentication",
      timestamp: new Date().toISOString(),
      is_from_me: true,
      is_bot_message: true,
      thread_id: 23,
      content_blocks: [
        {
          type: "adaptive_card",
          card_id: "login-card-error",
          state: "active",
          submit_behavior: "keep_active",
          payload: {
            type: "AdaptiveCard",
            version: "1.5",
            body: [],
            actions: [{ type: "Action.Submit", title: "Check", data: { intent: "login-step2", provider: "github-copilot", method: "oauth_check" } }],
          },
        },
      ],
    });

    const fixture = createFixture({
      agentPool: {
        runSidePrompt: async (chatJid, prompt, options) => ({
          status: "success",
          result: `answer:${prompt}`,
          thinking: options?.systemPrompt ?? null,
          model: `model-for:${chatJid}`,
          stopReason: "stop",
        }),
        applyControlCommand: async () => ({
          status: "error",
          message: 'OAuth for **GitHub Copilot** did not complete yet.',
        }),
      },
    });

    const response = await fixture.service.handleAdaptiveCardAction(createRequest("/agent/card-action", {
      method: "POST",
      body: JSON.stringify({
        post_id: sourcePostId,
        chat_jid: "web:branch",
        card_id: "login-card-error",
        action: { type: "Action.Submit", title: "Check", data: { intent: "login-step2", provider: "github-copilot", method: "oauth_check" } },
      }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      card_updated: false,
      source_post_id: sourcePostId,
      card_id: "login-card-error",
      submitted_at: expect.any(String),
      auth_result: "error",
    });
    expect(fixture.state.sentMessages).toEqual([
      {
        chatJid: "web:branch",
        text: 'OAuth for **GitHub Copilot** did not complete yet.',
        options: { threadId: 23 },
      },
    ]);
    expect(fixture.state.broadcastEvents).toEqual([]);
    expect(fixture.state.skipFailedCalls).toEqual([]);
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
