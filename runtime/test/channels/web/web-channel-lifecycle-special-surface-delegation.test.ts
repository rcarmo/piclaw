import { describe, expect, test } from "bun:test";

import { WebChannel } from "../../../src/channels/web.ts";

describe("web channel lifecycle/special surface delegation", () => {
  test("prototype lifecycle and special-case wrappers stay compatible with bare stubs", async () => {
    const calls: string[] = [];
    const server = { port: 1234 } as Bun.Server<any>;
    const stub = {
      serverLifecycleGateway: {
        server,
        start: async () => {
          calls.push("start");
        },
        stop: async () => {
          calls.push("stop");
        },
        handleRequest: async (_req: Request, dispatch: () => Promise<Response>) => dispatch(),
      },
      adaptiveCardSidePromptService: {
        handleAdaptiveCardAction: async (_req: Request) => {
          calls.push("card");
          return new Response("card", { status: 205 });
        },
        handleAgentSidePrompt: async (_req: Request) => {
          calls.push("side");
          return new Response("side", { status: 206 });
        },
        handleAgentSidePromptStream: async (_req: Request) => {
          calls.push("stream");
          return new Response("stream", { status: 207 });
        },
      },
      peerMessageRelayService: {
        handleAgentPeerMessage: async (_req: Request) => {
          calls.push("peer");
          return new Response("peer", { status: 208 });
        },
      },
      agentMessageEntryService: {
        handleAgentMessage: async (_req: Request, pathname: string) => {
          calls.push(`message:${pathname}`);
          return new Response(pathname, { status: 209 });
        },
      },
    } as any;

    const serverGetter = Object.getOwnPropertyDescriptor(WebChannel.prototype, "server")?.get;
    expect(serverGetter?.call(stub)).toBe(server);

    await WebChannel.prototype.start.call(stub);
    await WebChannel.prototype.stop.call(stub);
    expect((await WebChannel.prototype.handleAdaptiveCardAction.call(stub, new Request("https://example.com/agent/card-action", { method: "POST" }))).status)
      .toBe(205);
    expect((await WebChannel.prototype.handleAgentSidePrompt.call(stub, new Request("https://example.com/agent/side-prompt", { method: "POST" }))).status)
      .toBe(206);
    expect((await WebChannel.prototype.handleAgentSidePromptStream.call(stub, new Request("https://example.com/agent/side-prompt/stream", { method: "POST" }))).status)
      .toBe(207);
    expect((await WebChannel.prototype.handleAgentPeerMessage.call(stub, new Request("https://example.com/agent/peer-message", { method: "POST" }))).status)
      .toBe(208);
    expect((await WebChannel.prototype.handleAgentMessage.call(stub, new Request("https://example.com/agent/default/message", { method: "POST" }), "/agent/default/message")).status)
      .toBe(209);

    expect(calls).toEqual([
      "start",
      "stop",
      "card",
      "side",
      "stream",
      "peer",
      "message:/agent/default/message",
    ]);
  });
});
