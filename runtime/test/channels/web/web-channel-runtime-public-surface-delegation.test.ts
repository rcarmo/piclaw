import { describe, expect, test } from "bun:test";

import { WebChannel } from "../../../src/channels/web.ts";

function responseInteraction(id: number) {
  return {
    id,
    chat_jid: "web:test",
    timestamp: "2026-03-28T00:00:00.000Z",
    data: { type: "agent_response", content: `row-${id}` },
  };
}

describe("web channel runtime public surface delegation", () => {
  test("prototype runtime/session/storage methods stay compatible with bare stubs", async () => {
    const calls: string[] = [];
    const sse = { kind: "sse-hub" };
    const uiBridge = { kind: "ui-bridge" };
    const stored = responseInteraction(2);

    const stub = {
      messageWriteService: {
        sendMessage: async (chatJid: string, text: string, options?: { threadId?: number | null }) => {
          calls.push(`send:${chatJid}:${text}:${options?.threadId ?? "null"}`);
        },
      },
      queuedFollowupLifecycle: {
        getQueuedFollowupCount: (chatJid: string) => {
          calls.push(`count:${chatJid}`);
          return 2;
        },
      },
      messageProcessingStorageService: {
        processChat: async (chatJid: string, agentId: string, threadRootId?: number | null) => {
          calls.push(`process:${chatJid}:${agentId}:${threadRootId ?? "undefined"}`);
        },
        storeMessage: (chatJid: string, content: string, isBot: boolean, mediaIds: number[]) => {
          calls.push(`store:${chatJid}:${content}:${isBot ? 1 : 0}:${mediaIds.join(",")}`);
          return stored;
        },
      },
      sessionBroadcast: {
        sse,
        uiBridge,
        broadcastEvent: (eventType: string, data: unknown) => {
          calls.push(`broadcast:${eventType}:${JSON.stringify(data)}`);
        },
      },
    } as any;

    const sseGetter = Object.getOwnPropertyDescriptor(WebChannel.prototype, "sse")?.get;
    const uiBridgeGetter = Object.getOwnPropertyDescriptor(WebChannel.prototype, "uiBridge")?.get;

    expect(sseGetter?.call(stub)).toBe(sse);
    expect(uiBridgeGetter?.call(stub)).toBe(uiBridge);

    await WebChannel.prototype.sendMessage.call(stub, "web:test", "hello", { threadId: 9 });
    expect(WebChannel.prototype.getQueuedFollowupCount.call(stub, "web:test")).toBe(2);
    WebChannel.prototype.broadcastEvent.call(stub, "agent_status", { chat_jid: "web:test", type: "thinking" });
    expect(WebChannel.prototype.storeMessage.call(stub, "web:test", "stored", true, [7])).toBe(stored);
    await WebChannel.prototype.processChat.call(stub, "web:test", "default", null);

    expect(calls).toEqual([
      "send:web:test:hello:9",
      "count:web:test",
      "broadcast:agent_status:{\"chat_jid\":\"web:test\",\"type\":\"thinking\"}",
      "store:web:test:stored:1:7",
      "process:web:test:default:undefined",
    ]);
  });
});
