import { describe, expect, test } from "bun:test";

import { WebChannel } from "../../../src/channels/web.ts";
import { WebChannelRuntimePublicSurfaceService } from "../../../src/channels/web/core/web-channel-runtime-public-surface-service.js";

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
    const placeholder = responseInteraction(1);
    const stored = responseInteraction(2);

    const stub = {
      runtimeFollowupFacade: {
        sendMessage: async (chatJid: string, text: string, options?: { threadId?: number | null }) => {
          calls.push(`send:${chatJid}:${text}:${options?.threadId ?? "null"}`);
        },
        queueFollowupPlaceholder: (chatJid: string, text: string, threadId?: number, queuedContent?: string) => {
          calls.push(`queue:${chatJid}:${text}:${threadId ?? "null"}:${queuedContent ?? ""}`);
          return placeholder;
        },
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
    stub.runtimePublicSurfaceService = new WebChannelRuntimePublicSurfaceService(stub);

    const sseGetter = Object.getOwnPropertyDescriptor(WebChannel.prototype, "sse")?.get;
    const uiBridgeGetter = Object.getOwnPropertyDescriptor(WebChannel.prototype, "uiBridge")?.get;

    expect(sseGetter?.call(stub)).toBe(sse);
    expect(uiBridgeGetter?.call(stub)).toBe(uiBridge);

    await WebChannel.prototype.sendMessage.call(stub, "web:test", "hello", { threadId: 9 });
    expect(WebChannel.prototype.queueFollowupPlaceholder.call(stub, "web:test", "queued", 7, "later")).toBe(placeholder);
    expect(WebChannel.prototype.getQueuedFollowupCount.call(stub, "web:test")).toBe(2);
    WebChannel.prototype.broadcastEvent.call(stub, "agent_status", { chat_jid: "web:test", type: "thinking" });
    expect(WebChannel.prototype.storeMessage.call(stub, "web:test", "stored", true, [7])).toBe(stored);
    await WebChannel.prototype.processChat.call(stub, "web:test", "default", null);

    expect(calls).toEqual([
      "send:web:test:hello:9",
      "queue:web:test:queued:7:later",
      "count:web:test",
      "broadcast:agent_status:{\"chat_jid\":\"web:test\",\"type\":\"thinking\"}",
      "store:web:test:stored:1:7",
      "process:web:test:default:undefined",
    ]);
  });
});
