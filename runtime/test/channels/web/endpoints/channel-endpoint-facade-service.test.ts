import { describe, expect, test } from "bun:test";
import type { AgentPool } from "../../../../src/agent-pool.js";
import {
  WebChannelEndpointFacadeService,
  type WebChannelEndpointFacadeOptions,
} from "../../../../src/channels/web/endpoints/channel-endpoint-facade-service.js";
import type { WebChannelEndpointContexts, WebChannelIdentitySnapshot } from "../../../../src/channels/web/endpoints/channel-endpoint-context-factory.js";
import { createJsonResponder } from "../helpers/http.ts";

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=";

function createIdentitySnapshot(overrides: Partial<WebChannelIdentitySnapshot> = {}): WebChannelIdentitySnapshot {
  return {
    assistantName: "Pi",
    assistantAvatarRaw: PNG_DATA_URL,
    agentAvatarUrl: "/avatar/agent",
    userName: "User",
    userAvatarRaw: null,
    userAvatarUrl: null,
    userAvatarBackground: "#111111",
    ...overrides,
  };
}

function createFacade(getIdentitySnapshot: () => WebChannelIdentitySnapshot) {
  const json = createJsonResponder();
  const contexts: WebChannelEndpointContexts = {
    postMutations: () => {
      throw new Error("postMutations context not used in this test");
    },
    agentStatus: () => {
      throw new Error("agentStatus context not used in this test");
    },
    content: () => {
      throw new Error("content context not used in this test");
    },
    ui: () => {
      throw new Error("ui context not used in this test");
    },
    agents: () => {
      const identity = getIdentitySnapshot();
      return {
        agentPool: {
          getCurrentModelLabel: async () => "openai/gpt-5",
        } as unknown as AgentPool,
        defaultChatJid: "web:default",
        defaultAgentId: "default",
        agentName: identity.assistantName,
        agentAvatar: identity.agentAvatarUrl,
        userName: identity.userName,
        userAvatar: identity.userAvatarUrl,
        userAvatarBackground: identity.userAvatarBackground,
        json,
      };
    },
    avatar: () => {
      const identity = getIdentitySnapshot();
      return {
        assistantAvatar: identity.assistantAvatarRaw,
        userAvatar: identity.userAvatarRaw,
        json,
      };
    },
    auth: () => ({
      createTotpContext: () => ({}),
      createWebauthnContext: () => ({}),
      createWebauthnEnrolPageContext: () => ({}),
      serveStatic: async () => new Response(),
    }),
  };

  const ensureCalls: string[] = [];
  const postCalls: Array<{ isReply: boolean; chatJid: string }> = [];
  const scheduledWarmups: Array<{ limit?: number; excludeChatJids?: string[] }> = [];
  const activeChats = [{ chat_jid: "web:default", agent_name: "Pi" }];
  const knownChats = [{ chat_jid: "web:branch", agent_name: "Branch" }];
  const options: WebChannelEndpointFacadeOptions = {
    endpointContexts: contexts,
    defaultChatJid: "web:default",
    agentPool: {
      scheduleRecentChatWarmup: (input: { limit?: number; excludeChatJids?: string[] }) => {
        scheduledWarmups.push(input);
        return [];
      },
    } as unknown as AgentPool,
    getIdentitySnapshot,
    ensureAvatarCache: async (_kind, source) => {
      ensureCalls.push(source);
      return { updatedAt: "2026-03-09T00:00:00.000Z", contentType: "image/png" };
    },
    json,
    broadcastEvent: () => {},
    handlePostRequest: async (_req, isReply, chatJid) => {
      postCalls.push({ isReply, chatJid });
      return new Response(JSON.stringify({ ok: true, chat_jid: chatJid, is_reply: isReply }), { status: 201 });
    },
    listActiveChats: () => activeChats,
    listKnownChats: () => knownChats,
  };

  return {
    facade: new WebChannelEndpointFacadeService(options),
    ensureCalls,
    postCalls,
    scheduledWarmups,
    activeChats,
    knownChats,
  };
}

describe("web channel endpoint facade service", () => {
  test("uses the latest identity snapshot for agents, manifest, and avatar wrappers", async () => {
    let identity = createIdentitySnapshot();
    const { facade, ensureCalls } = createFacade(() => identity);

    const agentsResponse = await facade.handleAgents();
    expect(agentsResponse.status).toBe(200);
    expect(await agentsResponse.json()).toMatchObject({
      agents: [{ name: "Pi", avatar_url: "/avatar/agent", model: "openai/gpt-5" }],
      user: { name: "User", avatar_url: null, avatar_background: "#111111" },
    });

    const manifestResponse = await facade.handleManifest(new Request("https://example.com/manifest.json"));
    expect(manifestResponse.status).toBe(200);
    const manifest = await manifestResponse.json();
    expect(manifest.name).toBe("Pi");
    expect(manifest.icons[0]?.src).toBe("/avatar/agent?v=2026-03-09T00%3A00%3A00.000Z");
    expect(ensureCalls).toEqual([PNG_DATA_URL]);

    const avatarResponse = await facade.handleAvatar("agent", new Request("https://example.com/avatar/agent"));
    expect(avatarResponse.status).toBe(200);
    expect(avatarResponse.headers.get("Content-Type")).toBe("image/png");

    identity = createIdentitySnapshot({
      assistantName: "Nova",
      assistantAvatarRaw: null,
      agentAvatarUrl: null,
      userName: "Operator",
      userAvatarUrl: "/avatar/user",
      userAvatarBackground: "#222222",
    });

    const refreshedAgents = await facade.handleAgents();
    expect(await refreshedAgents.json()).toMatchObject({
      agents: [{ name: "Nova", avatar_url: null }],
      user: { name: "Operator", avatar_url: "/avatar/user", avatar_background: "#222222" },
    });

    const refreshedManifest = await facade.handleManifest(new Request("https://example.com/manifest.json"));
    const refreshedManifestJson = await refreshedManifest.json();
    expect(refreshedManifestJson.name).toBe("Nova");
    expect(refreshedManifestJson.icons).toHaveLength(4);
    expect(ensureCalls).toEqual([PNG_DATA_URL]);

    const missingAvatar = await facade.handleAvatar("agent", new Request("https://example.com/avatar/agent"));
    expect(missingAvatar.status).toBe(404);
    expect(await missingAvatar.json()).toEqual({ error: "Avatar not found" });
  });

  test("parses post chat_jid and falls back to the default chat", async () => {
    const { facade, postCalls } = createFacade(() => createIdentitySnapshot());

    const explicit = await facade.handlePost(new Request("https://example.com/post?chat_jid=web%3Abranch"), false);
    expect(explicit.status).toBe(201);
    expect(await explicit.json()).toEqual({ ok: true, chat_jid: "web:branch", is_reply: false });

    const fallback = await facade.handlePost(new Request("https://example.com/post/reply"), true);
    expect(fallback.status).toBe(201);
    expect(await fallback.json()).toEqual({ ok: true, chat_jid: "web:default", is_reply: true });

    expect(postCalls).toEqual([
      { isReply: false, chatJid: "web:branch" },
      { isReply: true, chatJid: "web:default" },
    ]);
  });

  test("serves active chats and known branches through facade helpers", async () => {
    const { facade, activeChats, knownChats } = createFacade(() => createIdentitySnapshot());

    const activeResponse = facade.handleAgentActiveChats();
    expect(activeResponse.status).toBe(200);
    expect(await activeResponse.json()).toEqual({ chats: activeChats });

    const branchesResponse = facade.handleAgentBranches(
      new Request("https://example.com/agent/branches?root_chat_jid=web%3Aroot&include_archived=1")
    );
    expect(branchesResponse.status).toBe(200);
    expect(await branchesResponse.json()).toEqual({ chats: knownChats });
  });

  test("can schedule recent-chat warmup from the branches endpoint without changing payload shape", async () => {
    const { facade, knownChats, scheduledWarmups } = createFacade(() => createIdentitySnapshot());

    const branchesResponse = facade.handleAgentBranches(
      new Request("https://example.com/agent/branches?include_archived=1&prewarm_recent=1&prewarm_limit=4&exclude_chat_jid=web%3Adefault")
    );
    expect(branchesResponse.status).toBe(200);
    expect(await branchesResponse.json()).toEqual({ chats: knownChats });
    expect(scheduledWarmups).toEqual([{ limit: 4, excludeChatJids: ["web:default"] }]);
  });
});
