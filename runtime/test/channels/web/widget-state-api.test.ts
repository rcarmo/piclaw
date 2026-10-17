import { describe, expect, test } from "bun:test";
import { WEB_RUNTIME_CONFIG } from "../../../src/core/config.js";
import {
  PICLAW_STATE_SCHEMA,
  buildPiclawStateSnapshot,
  handleWidgetStateRoutes,
} from "../../../src/channels/web/state-api.js";

function makeChannel(overrides: Partial<any> = {}): any {
  return {
    sse: { clients: { size: 2 } },
    agentPool: {
      listActiveChats: () => ([
        {
          chat_jid: "web:default",
          agent_name: "Smith",
          model: "openai/gpt-5",
          session_id: "session-1",
          session_name: "main",
          branch_id: "branch-1",
          root_chat_jid: "web:default",
          is_active: true,
          has_side_session: false,
        },
      ]),
      getContextUsageForChat: async () => ({ tokens: 123, contextWindow: 1000, percent: 12.3 }),
    },
    getQueuedFollowupCount: () => 1,
    getAgentStatus: () => ({ type: "thinking", title: "Thinking" }),
    getContextUsage: () => ({ tokens: 50, contextWindow: 1000, percent: 5 }),
    json: (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    }),
    ...overrides,
  };
}

describe("widget state API", () => {
  test("builds a namespaced read-only state snapshot from live channel state", async () => {
    const snapshot = await buildPiclawStateSnapshot(makeChannel());

    expect(snapshot.schema).toBe(PICLAW_STATE_SCHEMA);
    expect(snapshot.instance.sse_clients).toBe(2);
    expect(snapshot.chats).toHaveLength(1);
    expect(snapshot.chats[0]?.chat_jid).toBe("web:default");
    expect(snapshot.chats[0]?.status?.type).toBe("thinking");
    expect(snapshot.chats[0]?.context?.tokens).toBe(123);
    expect(snapshot.chats[0]?.queued_followups).toBe(1);
  });

  test("state JSON projects runtime and stored context without private hints or new defaults", async () => {
    const previous = WEB_RUNTIME_CONFIG.widgetToken;
    WEB_RUNTIME_CONFIG.widgetToken = "widget-test-token";
    try {
      for (const stored of [false, true]) {
        for (const context of [
          { tokens: null, contextWindow: 200000, percent: null, sessionGeneration: "session-1", tokensAreAuthoritative: true, futurePrivateField: "private" },
          { tokens: 123, contextWindow: 1000, percent: 12.3 },
          { tokens: undefined, contextWindow: 1000, percent: undefined },
          null,
        ]) {
          const channel = makeChannel();
          channel.agentPool.getContextUsageForChat = async () => stored ? null : context;
          channel.getContextUsage = () => stored ? context : null;
          const response = await handleWidgetStateRoutes(channel,
            new Request("https://example.test/api/state", { headers: { Authorization: "Bearer widget-test-token" } }), "/api/state");
          expect(response?.status).toBe(200);
          const body = await response!.json();
          // Runtime context inherits the live generation; unversioned stored data remains rejected.
          const accepted = context && (!stored || "sessionGeneration" in context);
          const expected = accepted ? JSON.parse(JSON.stringify({
            tokens: context.tokens, contextWindow: context.contextWindow, percent: context.percent, sessionGeneration: "session-1",
          })) : { tokens: null, contextWindow: null, percent: null, sessionGeneration: "session-1" };
          expect(body.chats[0].context).toEqual(expected);
          expect(JSON.stringify(body)).not.toMatch(/tokensAreAuthoritative|futurePrivateField/);
        }
      }
    } finally {
      WEB_RUNTIME_CONFIG.widgetToken = previous;
    }
  });

  test("requires bearer token auth", async () => {
    const previous = WEB_RUNTIME_CONFIG.widgetToken;
    WEB_RUNTIME_CONFIG.widgetToken = "widget-test-token";
    try {
      const unauthorized = await handleWidgetStateRoutes(
        makeChannel(),
        new Request("https://example.test/api/state"),
        "/api/state",
      );
      expect(unauthorized?.status).toBe(401);
      expect(unauthorized?.headers.get("WWW-Authenticate")).toContain("Bearer");

      const authorized = await handleWidgetStateRoutes(
        makeChannel(),
        new Request("https://example.test/api/state", { headers: { Authorization: "Bearer widget-test-token" } }),
        "/api/state",
      );
      expect(authorized?.status).toBe(200);
      expect((await authorized?.json())?.schema).toBe(PICLAW_STATE_SCHEMA);
    } finally {
      WEB_RUNTIME_CONFIG.widgetToken = previous;
    }
  });

  test("opens state SSE with the piclaw.state.v1 event", async () => {
    const previous = WEB_RUNTIME_CONFIG.widgetToken;
    WEB_RUNTIME_CONFIG.widgetToken = "widget-test-token";
    try {
      const response = await handleWidgetStateRoutes(
        makeChannel(),
        new Request("https://example.test/api/state/events", { headers: { Authorization: "Bearer widget-test-token" } }),
        "/api/state/events",
      );
      expect(response?.status).toBe(200);
      expect(response?.headers.get("Content-Type")).toBe("text/event-stream");

      const reader = response!.body!.getReader();
      const first = await reader.read();
      await reader.cancel();
      const text = new TextDecoder().decode(first.value);
      expect(text).toContain(`event: ${PICLAW_STATE_SCHEMA}`);
      expect(text).toContain(`"schema":"${PICLAW_STATE_SCHEMA}"`);
    } finally {
      WEB_RUNTIME_CONFIG.widgetToken = previous;
    }
  });
});
