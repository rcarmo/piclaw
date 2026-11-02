import { describe, expect, test } from "bun:test";

import { WebChannel } from "../../../src/channels/web.ts";
import { WebChannelRuntimePublicSurfaceService } from "../../../src/channels/web/core/web-channel-runtime-public-surface-service.js";

describe("web channel runtime public surface delegation", () => {
  test("prototype runtime/session/storage methods stay compatible with bare stubs", async () => {
    const calls: string[] = [];
    const sse = { kind: "sse-hub" };
    const uiBridge = { kind: "ui-bridge" };

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
    expect(WebChannel.prototype.getQueuedFollowupCount.call(stub, "web:test")).toBe(2);
    WebChannel.prototype.broadcastEvent.call(stub, "agent_status", { chat_jid: "web:test", type: "thinking" });
    expect(WebChannel.prototype).not.toHaveProperty("storeMessage");

    expect(calls).toEqual([
      "send:web:test:hello:9",
      "count:web:test",
      "broadcast:agent_status:{\"chat_jid\":\"web:test\",\"type\":\"thinking\"}",
    ]);
  });
});
