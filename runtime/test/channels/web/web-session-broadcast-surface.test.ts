import { describe, expect, test } from "bun:test";

import "../../helpers.ts";
import { WebChannel } from "../../../src/channels/web.ts";
import { WebChannelRuntimePublicSurfaceService } from "../../../src/channels/web/core/web-channel-runtime-public-surface-service.js";

describe("web channel session broadcast surface", () => {
  test("public sse/uiBridge/handleSse/broadcastEvent surfaces delegate through sessionBroadcast", () => {
    const handleCalls: Request[] = [];
    const broadcastCalls: Array<{ eventType: string; data: unknown }> = [];
    const response = new Response("sse");
    const uiBridge = { kind: "ui-bridge" };
    const sse = { kind: "sse-hub" };
    const channel = {
      sessionBroadcast: {
        sse,
        uiBridge,
        handleSse: (req: Request) => {
          handleCalls.push(req);
          return response;
        },
        broadcastEvent: (eventType: string, data: unknown) => {
          broadcastCalls.push({ eventType, data });
        },
      },
    } as any;
    channel.runtimePublicSurfaceService = new WebChannelRuntimePublicSurfaceService(channel);

    const sseGetter = Object.getOwnPropertyDescriptor(WebChannel.prototype, "sse")?.get;
    const uiBridgeGetter = Object.getOwnPropertyDescriptor(WebChannel.prototype, "uiBridge")?.get;

    expect(sseGetter?.call(channel)).toBe(sse);
    expect(uiBridgeGetter?.call(channel)).toBe(uiBridge);

    const req = new Request("https://example.test/sse/stream?chat_jid=web:branch-a");
    expect(WebChannel.prototype.handleSse.call(channel, req)).toBe(response);
    expect(handleCalls).toEqual([req]);

    WebChannel.prototype.broadcastEvent.call(channel, "agent_status", { chat_jid: "web:branch-a", type: "thinking" });
    expect(broadcastCalls).toEqual([
      { eventType: "agent_status", data: { chat_jid: "web:branch-a", type: "thinking" } },
    ]);
  });
});
