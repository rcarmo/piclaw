import { describe, expect, test } from "bun:test";

import {
  createWebChannelLifecycleSpecialSurfaceService,
  getWebChannelLifecycleSpecialSurfaceService,
} from "../../../../src/channels/web/core/web-channel-lifecycle-special-surface-service.js";

describe("web channel lifecycle/special surface service", () => {
  test("delegates lifecycle and special-case wrappers to extracted collaborators", async () => {
    const calls: string[] = [];
    const server = { port: 4321 } as Bun.Server<any>;
    const service = createWebChannelLifecycleSpecialSurfaceService(
      {
        serverLifecycleGateway: {
          sealAdmissions: async () => {},
          handleRequest: (_req, dispatch) => dispatch(),
          runInternalDispatch: async dispatch => await dispatch(),
          server,
          start: async () => {
            calls.push("start");
          },
          stop: async () => {
            calls.push("stop");
          },
        },
        adaptiveCardSidePromptService: {
          handleAdaptiveCardAction: async (req: Request) => {
            calls.push(`card:${req.method}:${new URL(req.url).pathname}`);
            return new Response("card", { status: 205 });
          },
          handleAgentSidePrompt: async (req: Request) => {
            calls.push(`side:${req.method}:${new URL(req.url).pathname}`);
            return new Response("side", { status: 206 });
          },
          handleAgentSidePromptStream: async (req: Request) => {
            calls.push(`stream:${req.method}:${new URL(req.url).pathname}`);
            return new Response("stream", { status: 207 });
          },
        },
        peerMessageRelayService: {
          handleAgentPeerMessage: async (req: Request) => {
            calls.push(`peer:${req.method}:${new URL(req.url).pathname}`);
            return new Response("peer", { status: 208 });
          },
        },
        agentMessageEntryService: {
          handleAgentMessage: async (req: Request, pathname: string) => {
            calls.push(`message:${req.method}:${pathname}`);
            return new Response(pathname, { status: 209 });
          },
        },
      },
      { defaultChatJid: "web:default", defaultAgentId: "default" },
    );

    expect(service.server).toBe(server);
    await service.start();
    await service.stop();
    expect((await service.handleAdaptiveCardAction(new Request("https://example.com/agent/card-action", { method: "POST" }))).status).toBe(205);
    expect((await service.handleAgentSidePrompt(new Request("https://example.com/agent/side-prompt", { method: "POST" }))).status).toBe(206);
    expect((await service.handleAgentSidePromptStream(new Request("https://example.com/agent/side-prompt/stream", { method: "POST" }))).status).toBe(207);
    expect((await service.handleAgentPeerMessage(new Request("https://example.com/agent/peer-message", { method: "POST" }))).status).toBe(208);
    expect((await service.handleAgentMessage(new Request("https://example.com/agent/default/message", { method: "POST" }), "/agent/default/message")).status)
      .toBe(209);

    expect(calls).toEqual([
      "start",
      "stop",
      "card:POST:/agent/card-action",
      "side:POST:/agent/side-prompt",
      "stream:POST:/agent/side-prompt/stream",
      "peer:POST:/agent/peer-message",
      "message:POST:/agent/default/message",
    ]);
  });

  test("reuses a pre-wired lifecycle/special surface service when present", () => {
    const existing = { kind: "existing" } as unknown as ReturnType<typeof getWebChannelLifecycleSpecialSurfaceService>;
    const carrier = {
      lifecycleSpecialSurfaceService: existing,
      serverLifecycleGateway: {} as never,
    };

    expect(getWebChannelLifecycleSpecialSurfaceService(carrier as any, { defaultChatJid: "web:default", defaultAgentId: "default" }))
      .toBe(existing);
  });
});
