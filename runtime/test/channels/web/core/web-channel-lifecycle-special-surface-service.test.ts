import { describe, expect, spyOn, test } from "bun:test";
import { WebChannel } from "../../../../src/channels/web.js";
import * as handlers from "../../../../src/channels/web/handlers/agent.js";

describe("public web lifecycle/special entrypoints", () => {
  test("delegates lifecycle and special-case wrappers to extracted collaborators", async () => {
    const calls: string[] = [];
    const server = { port: 4321 } as Bun.Server<any>;
    const service = Object.assign(Object.create(WebChannel.prototype), {
      serverLifecycleGateway: {
        sealAdmissions: async () => {},
        handleRequest: (_req: Request, dispatch: () => Promise<Response>) => dispatch(),
        runInternalDispatch: async (dispatch: () => unknown) => await dispatch(),
        server,
        start: async () => { calls.push("start"); },
        stop: async () => { calls.push("stop"); },
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
    });
    const spy = spyOn(handlers, "handleAgentMessage").mockImplementation(async (_channel, req, pathname) => {
      calls.push(`message:${req.method}:${pathname}`);
      return new Response(pathname, { status: 209 });
    });
    try {
      expect(service.server).toBe(server);
      await service.start(); await service.stop();
      expect((await service.handleAdaptiveCardAction(new Request("https://example.com/agent/card-action", { method: "POST" }))).status).toBe(205);
      expect((await service.handleAgentSidePrompt(new Request("https://example.com/agent/side-prompt", { method: "POST" }))).status).toBe(206);
      expect((await service.handleAgentSidePromptStream(new Request("https://example.com/agent/side-prompt/stream", { method: "POST" }))).status).toBe(207);
      expect((await service.handleAgentPeerMessage(new Request("https://example.com/agent/peer-message", { method: "POST" }))).status).toBe(208);
      expect((await service.handleAgentMessage(new Request("https://example.com/agent/default/message", { method: "POST" }), "/agent/default/message")).status).toBe(209);
      expect(calls).toEqual(["start", "stop", "card:POST:/agent/card-action", "side:POST:/agent/side-prompt", "stream:POST:/agent/side-prompt/stream", "peer:POST:/agent/peer-message", "message:POST:/agent/default/message"]);
    } finally { spy.mockRestore(); }
  });

  test("keeps exact lifecycle promises and the admitted callback on the original gateway", () => {
    const stop = Promise.withResolvers<void>(), seal = Promise.withResolvers<void>(), result = Promise.withResolvers<number>();
    const callback = () => 23;
    const service = Object.assign(Object.create(WebChannel.prototype), {
      serverLifecycleGateway: {
        stop: () => stop.promise,
        sealAdmissions: () => seal.promise,
        runInternalDispatch: (dispatch: () => number) => { expect(dispatch).toBe(callback); return result.promise; },
      },
    });
    Object.defineProperty(service, "lifecycleSpecialSurfaceService", { get() { throw Error("Retired lifecycle namespace was accessed"); } });
    expect(service.stop()).toBe(stop.promise);
    expect(service.sealAdmissions()).toBe(seal.promise);
    expect(service.runInternalDispatch(callback)).toBe(result.promise);
    stop.resolve(); seal.resolve(); result.resolve(23);
  });
});
