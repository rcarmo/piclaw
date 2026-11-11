import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { AgentPool } from "../../../../src/agent-pool.js";
import { WebChannel } from "../../../../src/channels/web.js";
import * as avatar from "../../../../src/channels/web/media/avatar-service.js";
import * as posts from "../../../../src/channels/web/handlers/posts.js";
const restores: (() => void)[] = [];
afterEach(() => { for (const restore of restores.splice(0)) restore(); });
import type { WebChannelEndpointContexts, WebChannelIdentitySnapshot } from "../../../../src/channels/web/endpoints/channel-endpoint-context-factory.js";
import { createJsonResponder } from "../helpers/http.ts";

// Valid RGBA PNG generated deterministically with Sharp. Keep this decodable so
// the endpoint test exercises avatar WebP conversion rather than decoder fallback.
const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==";

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
    identity: getIdentitySnapshot,
    postMutations: () => {
      throw new Error("postMutations context not used in this test");
    },
    agentStatus: () => ({
      defaultChatJid: "web:default", json, getAgentStatus: () => null, getExtensionWorkingState: () => null,
      getBuffer: () => undefined, getContextUsageForChat: async () => null, getTokenUsageForChat: () => null,
      getAvailableModels: async () => ({ models: [] }), getProviderReadyCompletedForInstance: () => false,
    }),
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
  const scheduledPriorityWarmups: string[] = [];
  const activeChats = [{ chat_jid: "web:default", agent_name: "Pi" }];
  const knownChats = [{ chat_jid: "web:branch", agent_name: "Branch" }];
  const options = {
    endpointContexts: contexts,
    defaultChatJid: "web:default",
    agentPool: {
      scheduleRecentChatWarmup: (input: { limit?: number; excludeChatJids?: string[] }) => {
        scheduledWarmups.push(input);
        return [];
      },
      scheduleChatWarmup: (chatJid: string) => {
        scheduledPriorityWarmups.push(chatJid);
        return true;
      },
    } as unknown as AgentPool,
    getIdentitySnapshot,
    ensureAvatarCache: async (_kind, source) => {
      ensureCalls.push(source);
      return { updatedAt: "2026-03-09T00:00:00.000Z", contentType: "image/webp" };
    },
    json,
    broadcastEvent: () => {},
    handlePostRequest: async (_req, isReply, chatJid) => {
      postCalls.push({ isReply, chatJid });
      return new Response(JSON.stringify({ ok: true, chat_jid: chatJid, is_reply: isReply }), { status: 201 });
    },
    listKnownChats: () => knownChats,
  };

  const facade = Object.assign(Object.create(WebChannel.prototype), { endpointContexts: contexts,
    agentPool: { ...options.agentPool, listKnownChats: options.listKnownChats }, json, broadcastEvent: options.broadcastEvent });
  const realEnsure = avatar.ensureAvatarCache;
  const cache = spyOn(avatar, "ensureAvatarCache").mockImplementation(realEnsure).mockImplementationOnce(options.ensureAvatarCache);
  const post = spyOn(posts, "handlePost").mockImplementation((_channel, req, isReply, chatJid) => options.handlePostRequest(req, isReply, chatJid));
  restores.push(() => cache.mockRestore(), () => post.mockRestore());
  return {
    facade,
    options,
    ensureCalls,
    postCalls,
    scheduledWarmups,
    scheduledPriorityWarmups,
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
    expect(manifest.icons[0]?.src).toContain("/avatar/agent");
    expect(manifest.icons[0]?.src).toContain("v=2026-03-09T00%3A00%3A00.000Z");
    expect(ensureCalls).toEqual([PNG_DATA_URL]);

    const avatarResponse = await facade.handleAvatar("agent", new Request("https://example.com/avatar/agent"));
    expect(avatarResponse.status).toBe(200);
    expect(avatarResponse.headers.get("Content-Type")).toBe("image/webp");

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
    const { facade, knownChats } = createFacade(() => createIdentitySnapshot());

    const activeResponse = await facade.handleAgentActiveChats();
    expect(activeResponse.status).toBe(200);
    expect((await activeResponse.json()).chats).toEqual(knownChats.map(chat => ({ ...chat, session_id: null,
      is_active: false, is_streaming: false, is_compacting: false, is_retrying: false, is_bash_running: false,
      activity_status: "idle", activity_label: "Idle", last_activity_at: null, last_reply: null })));

    const branchesResponse = await facade.handleAgentBranches(
      new Request("https://example.com/agent/branches?root_chat_jid=web%3Aroot&include_archived=1")
    );
    expect(branchesResponse.status).toBe(200);
    expect(await branchesResponse.json()).toEqual({ chats: knownChats });
  });

  test("stale recent warmup query cannot hydrate a session or change payload shape", async () => {
    const { facade, knownChats, scheduledWarmups } = createFacade(() => createIdentitySnapshot());

    const branchesResponse = await facade.handleAgentBranches(
      new Request("https://example.com/agent/branches?include_archived=1&prewarm_recent=1&prewarm_limit=4&exclude_chat_jid=web%3Adefault")
    );
    expect(branchesResponse.status).toBe(200);
    expect(await branchesResponse.json()).toEqual({ chats: knownChats });
    expect(scheduledWarmups).toEqual([]);
  });

  test("stale priority warmup query cannot hydrate the currently opened chat", async () => {
    const { facade, scheduledPriorityWarmups } = createFacade(() => createIdentitySnapshot());

    const response = await facade.handleAgentBranches(
      new Request("https://example.com/agent/branches?prewarm_chat_jid=web%3Abranch")
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ chats: [{ chat_jid: "web:branch", agent_name: "Branch" }] });
    expect(scheduledPriorityWarmups).toEqual([]);
  });
});


function nativeActiveFixture() {
  const base = createFacade(() => createIdentitySnapshot());
  const statuses = new Map<string, Record<string, unknown> | null>();
  const known = ["web:idle", "web:provider", "web:tool", "web:queued", "web:terminal", "web:maintenance"].map(chat_jid => ({ chat_jid, agent_name: chat_jid,
    is_active: true, is_streaming: true, is_compacting: true, activity_status: "streaming" }));
  let recoveries = 0, reads = 0, stale = false;
  const context: any = { getAgentStatus(jid: string) { reads++; if(stale) throw Error("Stale native owner"); return statuses.get(jid) ?? null; },
    recoverStaleInflightRun() { recoveries++; throw Error("read must not recover"); },
    getExtensionWorkingState() { throw Error("unrelated extension worker is not native activity"); },
    getBuffer() { return undefined; } };
  const facade = Object.assign(Object.create(WebChannel.prototype), { json: base.options.json,
    agentPool: { listKnownChats: () => known, isDurableRuntime: () => true, listActiveChats() { throw Error("legacy pool must not be read"); }, getSessionGenerationForChat: (jid: string) => "native:" + jid },
    endpointContexts: { ...base.options.endpointContexts, agentStatus: () => context } });
  return { facade, statuses, known, stats: () => ({ recoveries, reads }), revoke() { stale = true; } };
}

test("native active-chats projects provider, tool, queued and maintenance work without legacy sessions", async () => {
  const f = nativeActiveFixture();
  f.statuses.set("web:provider", { type: "thinking", title: "Working" });
  f.statuses.set("web:tool", { type: "tool", title: "Running tool" });
  f.statuses.set("web:queued", { type: "thinking", title: "Queued", queued_count: 1 });
  f.statuses.set("web:maintenance", { type: "intent", title: "Compacting", intent_key: "native_task" });
  f.statuses.set("web:terminal", { type: "done", title: "Idle" });
  const body = await (await f.facade.handleAgentActiveChats()).json();
  expect(body.chats).toHaveLength(6);
  const byJid = new Map(body.chats.map((row: any) => [row.chat_jid, row])) as Map<string, any>;
  for (const jid of ["web:provider", "web:tool", "web:queued", "web:maintenance"]) expect(byJid.get(jid).is_active).toBe(true);
  expect(byJid.get("web:provider").activity_status).toBe("streaming");
  expect(byJid.get("web:tool").activity_status).toBe("working");
  expect(byJid.get("web:tool").session_id).toBe("native:web:tool");
  for (const jid of ["web:idle", "web:terminal"]) expect(byJid.get(jid)).toMatchObject({ is_active: false, is_streaming: false, is_compacting: false, activity_status: "idle", activity_label: "Idle" });
  expect(body.chats.slice(0, 4).every((row: any) => row.is_active)).toBe(true);
  expect(f.stats()).toEqual({ recoveries: 0, reads: 6 });
});

test("native active-chats reads fresh terminal state and does not revive retained errors or cleanup", async () => {
  const f = nativeActiveFixture();
  f.statuses.set("web:tool", { type: "tool", title: "Tool" });
  expect((await (await f.facade.handleAgentActiveChats()).json()).chats.find((row: any) => row.chat_jid === "web:tool").is_active).toBe(true);
  for (const type of ["done", "error"]) {
    f.statuses.set("web:tool", { type, title: "Terminal", classifier: "provider_auth" });
    const row = (await (await f.facade.handleAgentActiveChats()).json()).chats.find((row: any) => row.chat_jid === "web:tool");
    expect(row).toMatchObject({ is_active: false, activity_status: "idle" });
  }
  expect(f.stats().recoveries).toBe(0);
});

test("active-chats has one native authority without consulting the retired engine-mode switch", async () => {
  const f = nativeActiveFixture();
  f.facade.agentPool.isDurableRuntime = () => false;
  f.statuses.set("web:tool", { type: "tool", title: "Actual native task" });
  const body = await (await f.facade.handleAgentActiveChats()).json();
  expect(body.chats.find((row: any) => row.chat_jid === "web:tool")).toMatchObject({ is_active: true, activity_status: "working" });
  expect(f.stats()).toEqual({ recoveries: 0, reads: 6 });
});

test("native active-chats rejects owner loss rather than returning all-idle or stale activity", async () => {
  const f = nativeActiveFixture(); f.revoke();
  await expect(f.facade.handleAgentActiveChats()).rejects.toThrow("Stale native owner");
});
