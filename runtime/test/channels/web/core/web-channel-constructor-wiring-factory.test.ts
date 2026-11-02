import { describe, expect, test } from "bun:test";

import type { AgentPool } from "../../../../src/agent-pool.js";
import type { InteractionRow } from "../../../../src/db.js";
import type { WebChannelEndpointFacadeOptions } from "../../../../src/channels/web/endpoints/channel-endpoint-facade-service.js";
import type { InteractionBroadcasterProfile } from "../../../../src/channels/web/interaction-broadcaster.js";
import type { WebMessageWriteServiceDeps } from "../../../../src/channels/web/message-write-service.js";
import type { WebChannelRuntimeStateCallbacks } from "../../../../src/channels/web/runtime/runtime-state-service.js";
import {
  createWebChannelConstructorFactory,
  type WebChannelConstructorFactoryChannel,
  type WebChannelConstructorFactoryDeps,
  type WebChannelConstructorFactoryOptions,
} from "../../../../src/channels/web/core/web-channel-constructor-factory.js";

function sentinel<T>(label: string): T {
  return { label } as unknown as T;
}

describe("web channel constructor wiring factory", () => {
  test("assembles collaborators with shared live identity and runtime wiring", async () => {
    const creationOrder: string[] = [];
    const broadcastCalls: string[] = [];
    const queueCalls: Array<{ key: string; laneKey?: string }> = [];
    const sends: unknown[][] = [];
    let sidePromptOptions: Parameters<WebChannelConstructorFactoryDeps["createAdaptiveCardSidePromptService"]>[0] | undefined;
    const processCalls: Array<{ chatJid: string; agentId: string; threadRootId?: number | null }> = [];
    const storeCalls: Array<{
      chatJid: string;
      content: string;
      isBot: boolean;
      mediaIds: number[];
      options?: { threadId?: number; contentBlocks?: unknown[]; isTerminalAgentReply?: boolean };
    }> = [];
    const dbRuns: Array<{ sql: string; args: unknown[] }> = [];
    const postRequestCalls: Array<{ isReply: boolean; chatJid: string; url: string }> = [];

    let identity = {
      assistantName: "Pi",
      assistantAvatar: "pi.png",
      userName: "Operator",
      userAvatar: "operator.png",
      userAvatarBackground: "#123456",
    };

    const sessionBroadcast = {
      sse: { clients: { size: 0 } },
      uiBridge: { stop: () => {} },
    } as unknown as ReturnType<WebChannelConstructorFactoryDeps["createSessionBroadcast"]>;
    const runtimeState = sentinel<ReturnType<WebChannelConstructorFactoryDeps["createRuntimeState"]>>("runtime-state");
    const interactionBroadcaster = {
      broadcastAgentResponse: () => {
        broadcastCalls.push("agent-response");
      },
      broadcastInteractionUpdated: () => {
        broadcastCalls.push("interaction-updated");
      },
    } as unknown as ReturnType<WebChannelConstructorFactoryDeps["createInteractionBroadcaster"]>;
    const authGateway = sentinel<ReturnType<WebChannelConstructorFactoryDeps["createAuthGateway"]>>("auth-gateway");
    const messageProcessingStorageService = sentinel<ReturnType<WebChannelConstructorFactoryDeps["createMessageProcessingStorageService"]>>(
      "message-processing-storage",
    );
    const messageWriteService = sentinel<ReturnType<WebChannelConstructorFactoryDeps["createMessageWriteService"]>>("message-write");
    const requestRouter = sentinel<ReturnType<WebChannelConstructorFactoryDeps["createRequestRouter"]>>("request-router");
    const endpointContexts = sentinel<ReturnType<WebChannelConstructorFactoryDeps["createEndpointContexts"]>>("endpoint-contexts");
    const endpointFacade = sentinel<ReturnType<WebChannelConstructorFactoryDeps["createEndpointFacade"]>>("endpoint-facade");
    const controlPlaneService = sentinel<ReturnType<WebChannelConstructorFactoryDeps["createControlPlaneService"]>>("control-plane");
    const serverLifecycleGateway = sentinel<ReturnType<WebChannelConstructorFactoryDeps["createServerLifecycleGateway"]>>("server-lifecycle");
    const terminalVncHttpService = {
      handleTerminalSession: (_req: Request) => new Response("terminal-session"),
      handleTerminalHandoff: async (_req: Request) => new Response("terminal-handoff"),
      handleVncSession: (_req: Request) => new Response("vnc-session"),
      handleVncHandoff: async (_req: Request) => new Response("vnc-handoff"),
    } as unknown as ReturnType<WebChannelConstructorFactoryDeps["createTerminalVncHttpService"]>;
    const adaptiveCardSidePromptService = sentinel<ReturnType<WebChannelConstructorFactoryDeps["createAdaptiveCardSidePromptService"]>>(
      "adaptive-card-side-prompt",
    );
    const peerMessageRelayService = sentinel<ReturnType<WebChannelConstructorFactoryDeps["createPeerMessageRelayService"]>>("peer-message-relay");

    let runtimeStateCallbacks: WebChannelRuntimeStateCallbacks | null = null;
    let interactionProfileGetter: (() => InteractionBroadcasterProfile) | null = null;
    let authConfig: ConstructorParameters<WebChannelConstructorFactoryDeps["createAuthGateway"]>[0] | null = null;
    let authDeps: ConstructorParameters<WebChannelConstructorFactoryDeps["createAuthGateway"]>[1] | null = null;
    let messageWriteDeps: WebMessageWriteServiceDeps | null = null;
    let endpointContextOptions: Parameters<WebChannelConstructorFactoryDeps["createEndpointContexts"]>[1] | null = null;
    let endpointFacadeOptions: WebChannelEndpointFacadeOptions | null = null;

    const channel: WebChannelConstructorFactoryChannel = {
      queue: {
        enqueue: (task, key, laneKey) => {
          void task;
          queueCalls.push({ key, laneKey });
        },
      } as WebChannelConstructorFactoryChannel["queue"],
      agentPool: {
        listActiveChats: () => { throw Error("Legacy pool activity must not be read by HTTP wiring"); },
        listKnownChats: (rootChatJid?: string | null, options?: { includeArchived?: boolean }) => [
          rootChatJid ?? null,
          Boolean(options?.includeArchived),
        ],
      } as unknown as AgentPool,
      queuedFollowupLifecycle: {} as WebChannelConstructorFactoryChannel["queuedFollowupLifecycle"],
      terminalService: sentinel<WebChannelConstructorFactoryChannel["terminalService"]>("terminal-service"),
      vncService: sentinel<WebChannelConstructorFactoryChannel["vncService"]>("vnc-service"),
      webauthnChallenges: sentinel<WebChannelConstructorFactoryChannel["webauthnChallenges"]>("webauthn-challenges"),
      totpFailureTracker: sentinel<WebChannelConstructorFactoryChannel["totpFailureTracker"]>("totp-failure-tracker"),
      json: (payload, status = 200) => new Response(JSON.stringify(payload), { status }),
      broadcastEvent: () => {},
      handleRequest: async (req) => new Response(new URL(req.url).pathname),
      loadState: () => {},
      async sendMessage(...args) { expect(this).toBe(channel); sends.push(args); },
      processChat: async (chatJid, agentId, threadRootId) => {
        processCalls.push({ chatJid, agentId, threadRootId });
      },
      admitMessage: async (chatJid, content, isBot, mediaIds, options) => {
        storeCalls.push({ chatJid, content, isBot, mediaIds, options });
        return null;
      },
    };

    const options: WebChannelConstructorFactoryOptions = {
      defaultChatJid: "web:default",
      defaultAgentId: "default",
      webServerConfig: {
        host: "127.0.0.1",
        port: 8080,
        idleTimeout: 30,
        tlsCert: "cert.pem",
        tlsKey: "key.pem",
      },
      webRuntimeConfig: {
        passkeyMode: "passkey-only",
        totpSecret: "totp-secret",
        internalSecret: "internal-secret",
        sessionTtl: 1800,
        terminalEnabled: true,
        debugCardSubmissions: true,
        totpWindow: 2,
      },
    };

    const deps: WebChannelConstructorFactoryDeps = {
      getIdentityConfig: () => identity,
      createSessionBroadcast: (agentPool) => {
        creationOrder.push("sessionBroadcast");
        expect(agentPool).toBe(channel.agentPool);
        return sessionBroadcast;
      },
      createRuntimeState: (callbacks, runtimeOptions) => {
        creationOrder.push("runtimeState");
        runtimeStateCallbacks = callbacks;
        expect(runtimeOptions).toEqual({ defaultAgentId: "default" });
        return runtimeState;
      },
      createIdentitySnapshot: (currentIdentity) => ({
        assistantName: currentIdentity.assistantName,
        assistantAvatarRaw: currentIdentity.assistantAvatar ?? null,
        agentAvatarUrl: `/avatars/${currentIdentity.assistantName.toLowerCase()}`,
        userName: currentIdentity.userName ?? null,
        userAvatarRaw: currentIdentity.userAvatar ?? null,
        userAvatarUrl: currentIdentity.userAvatar ? `/avatars/${currentIdentity.userAvatar}` : null,
        userAvatarBackground: currentIdentity.userAvatarBackground ?? null,
      }),
      createInteractionBroadcaster: (seenChannel, profileOrFn) => {
        creationOrder.push("interactionBroadcaster");
        expect(seenChannel).toBe(channel);
        interactionProfileGetter = typeof profileOrFn === "function"
          ? profileOrFn as () => InteractionBroadcasterProfile
          : () => profileOrFn;
        return interactionBroadcaster;
      },
      createAuthGateway: (config, gatewayDeps) => {
        creationOrder.push("authGateway");
        authConfig = config;
        authDeps = gatewayDeps;
        return authGateway;
      },
      createMessageProcessingStorageService: (seenChannel, defaults) => {
        creationOrder.push("messageProcessingStorageService");
        expect(seenChannel).toBe(channel);
        expect(defaults.defaultAgentId).toBe("default");
        expect(defaults.getAssistantName()).toBe("Pi");
        return messageProcessingStorageService;
      },
      createMessageWriteService: (writeDeps) => {
        creationOrder.push("messageWriteService");
        messageWriteDeps = writeDeps;
        return messageWriteService;
      },
      createRequestRouter: (seenChannel) => {
        creationOrder.push("requestRouter");
        expect(seenChannel).toBe(channel);
        return requestRouter;
      },
      createEndpointContexts: (seenChannel, factoryOptions) => {
        creationOrder.push("endpointContexts");
        expect(seenChannel).toBe(channel);
        endpointContextOptions = factoryOptions;
        return endpointContexts;
      },
      createEndpointFacade: (facadeOptions) => {
        creationOrder.push("endpointFacade");
        endpointFacadeOptions = facadeOptions;
        return endpointFacade;
      },
      createControlPlaneService: (seenChannel, defaults) => {
        creationOrder.push("controlPlaneService");
        expect(seenChannel).toBe(channel);
        expect(defaults).toEqual({ defaultChatJid: "web:default", defaultAgentId: "default" });
        return controlPlaneService;
      },
      createServerLifecycleGateway: (seenChannel, configs) => {
        creationOrder.push("serverLifecycleGateway");
        expect(seenChannel.authGateway).toBe(authGateway);
        expect(seenChannel.terminalService).toBe(channel.terminalService);
        expect(seenChannel.vncService).toBe(channel.vncService);
        expect(seenChannel.uiBridge).toBe(sessionBroadcast.uiBridge);
        expect(seenChannel.sse).toBe(sessionBroadcast.sse);
        expect(seenChannel.runtimeState).toBe(runtimeState);
        expect(seenChannel.sessionBroadcast).toBe(sessionBroadcast);
        expect(configs).toEqual({
          webServerConfig: options.webServerConfig,
          webRuntimeConfig: options.webRuntimeConfig,
        });
        return serverLifecycleGateway;
      },
      createTerminalVncHttpService: (seenChannel, configs) => {
        creationOrder.push("terminalVncHttpService");
        expect(seenChannel.authGateway).toBe(authGateway);
        expect(seenChannel.terminalService).toBe(channel.terminalService);
        expect(seenChannel.vncService).toBe(channel.vncService);
        expect(configs).toEqual({ webRuntimeConfig: options.webRuntimeConfig });
        return terminalVncHttpService;
      },
      createAdaptiveCardSidePromptService: (serviceOptions) => {
        creationOrder.push("adaptiveCardSidePromptService");
        sidePromptOptions = serviceOptions;
        expect(serviceOptions.defaultChatJid).toBe("web:default");
        expect(serviceOptions.defaultAgentId).toBe("default");
        expect(serviceOptions.webRuntimeConfig).toEqual(options.webRuntimeConfig);
        expect(serviceOptions.authGateway).toBe(authGateway);
        expect(serviceOptions.interactionBroadcaster).toBe(interactionBroadcaster);
        expect(serviceOptions.agentPool).toBe(channel.agentPool);
        return adaptiveCardSidePromptService;
      },
      createPeerMessageRelayService: (seenChannel, defaults) => {
        creationOrder.push("peerMessageRelayService");
        expect(seenChannel).toBe(channel);
        expect(defaults).toEqual({ defaultAgentId: "default" });
        return peerMessageRelayService;
      },
      getDb: () => ({
        prepare: (sql: string) => ({
          run: (...args: unknown[]) => {
            dbRuns.push({ sql, args });
          },
        }),
      }) as unknown as ReturnType<WebChannelConstructorFactoryDeps["getDb"]>,
      ensureAvatarCache: async () => null,
      handlePostRequest: async (_seenChannel, req, isReply, chatJid) => {
        postRequestCalls.push({ isReply, chatJid, url: req.url });
        return new Response("post");
      },
    };

    const result = createWebChannelConstructorFactory(channel, options, deps);

    expect(creationOrder).toEqual([
      "sessionBroadcast",
      "runtimeState",
      "interactionBroadcaster",
      "authGateway",
      "messageProcessingStorageService",
      "messageWriteService",
      "requestRouter",
      "endpointContexts",
      "endpointFacade",
      "controlPlaneService",
      "serverLifecycleGateway",
      "adaptiveCardSidePromptService",
      "peerMessageRelayService",
    ]);

    expect(result.sessionBroadcast).toBe(sessionBroadcast);
    expect(result.runtimeState).toBe(runtimeState);
    expect(result).not.toHaveProperty("runtimeFollowupFacade");
    await sidePromptOptions?.sendMessage?.("web:side-prompt", "reply", { threadId: 4 });
    expect(sends).toEqual([["web:side-prompt", "reply", { threadId: 4 }]]);
    expect(result.interactionBroadcaster).toBe(interactionBroadcaster);
    expect(result.authGateway).toBe(authGateway);
    expect(result.messageProcessingStorageService).toBe(messageProcessingStorageService);
    expect(result.messageWriteService).toBe(messageWriteService);
    expect(result.requestRouter).toBe(requestRouter);
    expect(result.endpointContexts).toBe(endpointContexts);
    expect(result.endpointFacade).toBe(endpointFacade);
    expect(result.controlPlaneService).toBe(controlPlaneService);
    expect(result.serverLifecycleGateway).toBe(serverLifecycleGateway);
    expect(result.terminalVncHttpService).not.toBe(terminalVncHttpService);
    expect(result.adaptiveCardSidePromptService).toBe(adaptiveCardSidePromptService);
    expect(result.peerMessageRelayService).toBe(peerMessageRelayService);

    expect(authConfig).toEqual({
      accessMode: "single-user",
      passkeyMode: "passkey-only",
      totpSecret: "totp-secret",
      internalSecret: "internal-secret",
      sessionTtlSeconds: 1800,
      hasTls: true,
    });
    expect(authDeps?.challenges).toBe(channel.webauthnChallenges);
    expect(authDeps?.failureTracker).toBe(channel.totpFailureTracker);
    expect((await (authDeps?.json({ ok: true }, 201) ?? new Response(null)).json())).toEqual({ ok: true });

    expect(runtimeStateCallbacks).not.toBeNull();
    runtimeStateCallbacks?.enqueue(async () => {}, "resume:web:test", "chat:web:test");
    await runtimeStateCallbacks?.processChat("web:test", "agent-a", 42);
    expect(runtimeStateCallbacks).not.toHaveProperty("getChatCursor");
    expect(queueCalls).toEqual([{ key: "resume:web:test", laneKey: "chat:web:test" }]);
    expect(processCalls).toEqual([{ chatJid: "web:test", agentId: "agent-a", threadRootId: 42 }]);

    expect(messageWriteDeps).not.toBeNull();
    const interaction = { id: 1 } as unknown as InteractionRow;
    messageWriteDeps?.broadcastAgentResponse(interaction);
    await messageWriteDeps?.admitMessage("web:test", "hello", false, [1, 2], { threadId: 7 });

    expect(broadcastCalls).toEqual(["agent-response"]);
    expect(storeCalls).toEqual([
      {
        chatJid: "web:test",
        content: "hello",
        isBot: false,
        mediaIds: [1, 2],
        options: { threadId: 7 },
      },
    ]);
    expect(dbRuns).toEqual([]);


    expect(endpointContextOptions?.defaultChatJid).toBe("web:default");
    expect(endpointContextOptions?.defaultAgentId).toBe("default");
    expect(endpointFacadeOptions?.endpointContexts).toBe(endpointContexts);
    expect(endpointFacadeOptions).not.toHaveProperty("listActiveChats");
    expect(endpointFacadeOptions?.listKnownChats("web:root", { includeArchived: true })).toEqual(["web:root", true]);
    const handlePostRequest = endpointFacadeOptions?.handlePostRequest;
    expect(handlePostRequest).toBeDefined();
    if (!handlePostRequest) throw new Error("Expected endpoint facade handlePostRequest");
    expect(await (await handlePostRequest(new Request("https://example.com/post"), false, "web:branch")).text()).toBe("post");
    expect(postRequestCalls).toEqual([
      { isReply: false, chatJid: "web:branch", url: "https://example.com/post" },
    ]);

    expect(creationOrder).not.toContain("terminalVncHttpService");
    expect(await result.terminalVncHttpService.handleTerminalSession(new Request("https://example.com/terminal/session")).text()).toBe("terminal-session");
    expect(creationOrder.filter((entry) => entry === "terminalVncHttpService")).toEqual(["terminalVncHttpService"]);

    identity = {
      assistantName: "Nova",
      assistantAvatar: "nova.png",
      userName: "You",
      userAvatar: "you.png",
      userAvatarBackground: "#654321",
    };

    expect(interactionProfileGetter?.().agentName).toBe("Nova");
    expect(interactionProfileGetter?.().agentAvatar).toBe("/avatars/nova");
    expect(interactionProfileGetter?.().userName).toBe("You");
    expect(interactionProfileGetter?.().userAvatar).toBe("/avatars/you.png");
    expect(endpointContextOptions?.getIdentitySnapshot().assistantName).toBe("Nova");
    expect(endpointContextOptions?.getIdentitySnapshot().userAvatarBackground).toBe("#654321");
    expect(runtimeStateCallbacks?.getAssistantName()).toBe("Nova");
  });
});
