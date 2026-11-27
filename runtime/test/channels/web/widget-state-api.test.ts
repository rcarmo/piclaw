import { describe, expect, test } from "bun:test";
import { setImmediate } from "node:timers/promises";
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
      getContextUsageForChat: async () => ({ tokens: 123, contextWindow: 1000, percent: 12.3, sessionGeneration: "session-1" }),
      getSessionGenerationForChat: () => "session-1",
    },
    readNativeQueue: async () => [{ row_id: 7, content: 'SDK queued input' }],
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

  test("state JSON projects only current SDK context without stored estimates or private hints", async () => {
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
          channel.agentPool.getContextUsageForChat = async () => stored || !context ? null : {...context,sessionGeneration:"session-1"};
          channel.getContextUsage = () => stored ? context : null;
          const response = await handleWidgetStateRoutes(channel,
            new Request("https://example.test/api/state", { headers: { Authorization: "Bearer widget-test-token" } }), "/api/state");
          expect(response?.status).toBe(200);
          const body = await response!.json();
          // Actual facade snapshots carry their bound identity. Stored estimates are never read.
          const accepted = context && !stored;
          const expected = accepted ? JSON.parse(JSON.stringify({
            tokens: context.tokens, contextWindow: context.contextWindow, percent: context.percent, sessionGeneration: "session-1",
            ...("tokensAreAuthoritative" in context && context.tokensAreAuthoritative === true ? { contextUpdate: "replace" } : {}),
          })) : { tokens: null, contextWindow: null, percent: null, sessionGeneration: "session-1",contextUpdate:"replace" };
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

  test.each([
    ["request abort", "context"],
    ["request abort", "queue"],
    ["reader cancellation", "context"],
    ["reader cancellation", "queue"],
  ] as const)("state SSE stops snapshot work on %s during the %s read", async (disconnect, blockedRead) => {
    const previous = WEB_RUNTIME_CONFIG.widgetToken;
    WEB_RUNTIME_CONFIG.widgetToken = "widget-test-token";
    const started = Promise.withResolvers<void>();
    const held = Promise.withResolvers<void>();
    const abort = new AbortController();
    const calls: string[] = [];
    const recordRead = async (read: "context" | "queue", chatJid: string) => {
      calls.push(`${read}:${chatJid}`);
      if (read === blockedRead && chatJid === "web:default") {
        started.resolve();
        await held.promise;
      }
    };
    try {
      const channel = makeChannel();
      channel.agentPool.listActiveChats = () => [{ chat_jid: "web:default" }, { chat_jid: "web:other" }];
      channel.agentPool.getContextUsageForChat = async (chatJid: string) => {
        await recordRead("context", chatJid);
        return null;
      };
      channel.readNativeQueue = async (chatJid: string) => {
        await recordRead("queue", chatJid);
        return [];
      };
      channel.getAgentStatus = (chatJid: string) => {
        calls.push(`status:${chatJid}`);
        return null;
      };
      const response = await handleWidgetStateRoutes(channel, new Request("https://example.test/api/state/events", {
        headers: { Authorization: "Bearer widget-test-token" }, signal: abort.signal,
      }), "/api/state/events");
      const reader = response!.body!.getReader();
      const result = reader.read();
      await started.promise;
      if (disconnect === "request abort") abort.abort();
      else await reader.cancel();
      expect(await result).toEqual({ done: true, value: undefined });

      held.resolve();
      // All fake reads settle in microtasks after release; let the snapshot resume before asserting.
      await setImmediate();
      expect(calls).toEqual(blockedRead === "context" ? ["context:web:default"] : ["context:web:default", "queue:web:default"]);
      expect(await reader.read()).toEqual({ done: true, value: undefined });
    } finally {
      abort.abort();
      held.resolve();
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


test("state context isolates an ownership failure without reviving stored tokens", async () => {
  const channel = makeChannel();
  const listActiveChats = channel.agentPool.listActiveChats;
  channel.agentPool.listActiveChats = () => [...listActiveChats(), { chat_jid: "web:other" }];
  const readContext = channel.agentPool.getContextUsageForChat;
  channel.agentPool.getContextUsageForChat = async (chatJid: string) => {
    if (chatJid === "web:default") throw Error("Stale owner");
    return readContext();
  };
  channel.getContextUsage = () => { throw Error("stored context must not be consulted"); };
  const state = await buildPiclawStateSnapshot(channel);
  expect(state.chats.map(chat => chat.chat_jid)).toEqual(["web:default", "web:other"]);
  expect(state.chats[0]?.context).toEqual({ tokens: null, contextWindow: null, percent: null, sessionGeneration: "session-1", contextUpdate: "replace" });
  expect(state.chats[1]?.context?.tokens).toBe(123);
});

test("state snapshot still rejects a failed queue read", async () => {
  const channel = makeChannel();
  channel.readNativeQueue = async () => { throw Error("Queue unavailable"); };
  await expect(buildPiclawStateSnapshot(channel)).rejects.toThrow("Queue unavailable");
});
