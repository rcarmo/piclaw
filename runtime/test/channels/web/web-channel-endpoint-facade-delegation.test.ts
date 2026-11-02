import * as identity from "../../../src/channels/web/endpoints/identity-endpoints.js";
import * as content from "../../../src/channels/web/endpoints/content-endpoints.js";
import * as ui from "../../../src/channels/web/endpoints/ui-endpoints.js";
import * as status from "../../../src/channels/web/agent/agent-status.js";
import * as manifest from "../../../src/channels/web/manifest.js";
import * as mutations from "../../../src/channels/web/post-mutations.js";
import * as posts from "../../../src/channels/web/handlers/posts.js";
import * as timeline from "../../../src/channels/web/timeline-service.js";
const leafRestores: (() => void)[] = [];
afterEach(() => { for (const restore of leafRestores.splice(0)) restore(); });
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createWebChannelTestFixture } from "./helpers/web-channel-fixture.ts";

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe("WebChannel endpoint facade delegation", () => {
  test("delegates remaining endpoint wrapper methods to the facade service", async () => {
    const fixture = await createWebChannelTestFixture({ workspace: "temp" });
    cleanup = fixture.cleanup;

    const calls: string[] = [];
    const response = (label: string, status = 200) => new Response(label, { status });

    const endpointMocks = {
      handleAgents: async () => {
        calls.push("agents");
        return response("agents");
      },
      handleManifest: async (req: Request) => {
        calls.push(`manifest:${req.method}`);
        return response("manifest");
      },
      handleAvatar: async (kind: string, req: Request) => {
        calls.push(`avatar:${kind}:${req.method}`);
        return response(`avatar:${kind}`);
      },
      handleWorkspaceVisibility: async (req: Request) => {
        calls.push(`workspace:${req.method}`);
        return response("workspace", 202);
      },
      handlePost: async (req: Request, isReply: boolean) => {
        calls.push(`post:${req.method}:${isReply ? 1 : 0}:${new URL(req.url).searchParams.get("chat_jid") ?? ""}`);
        return response("post", 207);
      },
      handleHashtag: (tag: string, limit: number, offset: number, chatJid?: string) => {
        calls.push(`hashtag:${tag}:${limit}:${offset}:${chatJid ?? ""}`);
        return response("hashtag");
      },
      handleSearch: (
        query: string,
        limit: number,
        offset: number,
        chatJid?: string,
        searchScope?: string,
        rootChatJid?: string,
      ) => {
        calls.push(`search:${query}:${limit}:${offset}:${chatJid ?? ""}:${searchScope ?? ""}:${rootChatJid ?? ""}`);
        return response("search");
      },
      handleThread: (id: number | null, chatJid?: string) => {
        calls.push(`thread:${id ?? "null"}:${chatJid ?? ""}`);
        return response("thread");
      },
      handleThought: (panel: string | null, turnId: string | null) => {
        calls.push(`thought:${panel ?? "null"}:${turnId ?? "null"}`);
        return response("thought");
      },
      handleThoughtVisibility: async (req: Request) => {
        calls.push(`thought-visibility:${req.method}`);
        return response("thought-visibility", 203);
      },
      handleDeletePost: (_req: Request, id: number | null, cascade: boolean) => {
        calls.push(`delete:${id ?? "null"}:${cascade}`);
        return response("delete", 206);
      },
      handleUpdatePost: async (_req: Request, id: number | null) => {
        calls.push(`update:${id ?? "null"}`);
        return response("update", 204);
      },
      handleInternalPost: async (req: Request) => {
        calls.push(`internal:${req.method}`);
        return response("internal", 201);
      },
      handleAgentStatus: (req: Request) => {
        calls.push(`status:${req.method}`);
        return response("status");
      },
      handleAgentActiveChats: () => {
        calls.push("active-chats");
        return response("active-chats");
      },
      handleAgentBranches: (req: Request) => {
        calls.push(`branches:${req.method}:${new URL(req.url).searchParams.get("include_archived") ?? ""}`);
        return response("branches");
      },
      handleAgentRespond: async (req: Request) => {
        calls.push(`respond:${req.method}`);
        return response("respond", 205);
      },
    };

    if ("handleAgents" in endpointMocks) { const spy = spyOn(identity, "handleAgentsRequest").mockImplementation((...args: any[]) => (endpointMocks as any).handleAgents(...args)); leafRestores.push(() => spy.mockRestore()); }
    if ("handleManifest" in endpointMocks) { const spy = spyOn(manifest, "handleManifestRequest").mockImplementation((...args: any[]) => (endpointMocks as any).handleManifest(...args)); leafRestores.push(() => spy.mockRestore()); }
    if ("handleAvatar" in endpointMocks) { const spy = spyOn(identity, "handleAvatarRequest").mockImplementation((...args: any[]) => (endpointMocks as any).handleAvatar(...args)); leafRestores.push(() => spy.mockRestore()); }
    if ("handleWorkspaceVisibility" in endpointMocks) { const spy = spyOn(ui, "handleWorkspaceVisibilityRequest").mockImplementation((...args: any[]) => (endpointMocks as any).handleWorkspaceVisibility(...args)); leafRestores.push(() => spy.mockRestore()); }
    if ("handleHashtag" in endpointMocks) { const spy = spyOn(content, "handleHashtagRequest").mockImplementation((...args: any[]) => (endpointMocks as any).handleHashtag(...args)); leafRestores.push(() => spy.mockRestore()); }
    if ("handleSearch" in endpointMocks) { const spy = spyOn(content, "handleSearchRequest").mockImplementation((...args: any[]) => (endpointMocks as any).handleSearch(...args)); leafRestores.push(() => spy.mockRestore()); }
    if ("handleThread" in endpointMocks) { const spy = spyOn(content, "handleThreadRequest").mockImplementation((...args: any[]) => (endpointMocks as any).handleThread(...args)); leafRestores.push(() => spy.mockRestore()); }
    if ("handleThought" in endpointMocks) { const spy = spyOn(content, "handleThoughtRequest").mockImplementation((...args: any[]) => (endpointMocks as any).handleThought(...args)); leafRestores.push(() => spy.mockRestore()); }
    if ("handleThoughtVisibility" in endpointMocks) { const spy = spyOn(ui, "handleThoughtVisibilityRequest").mockImplementation((...args: any[]) => (endpointMocks as any).handleThoughtVisibility(...args)); leafRestores.push(() => spy.mockRestore()); }
    if ("handleUpdatePost" in endpointMocks) { const spy = spyOn(mutations, "handleUpdatePostRequest").mockImplementation((...args: any[]) => (endpointMocks as any).handleUpdatePost(...args)); leafRestores.push(() => spy.mockRestore()); }
    if ("handleInternalPost" in endpointMocks) { const spy = spyOn(mutations, "handleInternalPostRequest").mockImplementation((...args: any[]) => (endpointMocks as any).handleInternalPost(...args)); leafRestores.push(() => spy.mockRestore()); }
    if ("handleAgentStatus" in endpointMocks) { const spy = spyOn(status, "handleAgentStatusRequest").mockImplementation((...args: any[]) => (endpointMocks as any).handleAgentStatus(...args)); leafRestores.push(() => spy.mockRestore()); }
    if ("handleAgentActiveChats" in endpointMocks) { const spy = spyOn(status, "handleAgentActiveChatsRequest").mockImplementation((...args: any[]) => (endpointMocks as any).handleAgentActiveChats(...args)); leafRestores.push(() => spy.mockRestore()); }
    if ("handleAgentBranches" in endpointMocks) { const spy = spyOn(status, "handleAgentBranchesRequest").mockImplementation((...args: any[]) => (endpointMocks as any).handleAgentBranches(...args)); leafRestores.push(() => spy.mockRestore()); }
    if ("handleAgentRespond" in endpointMocks) { const spy = spyOn(ui, "handleAgentRespondRequest").mockImplementation((...args: any[]) => (endpointMocks as any).handleAgentRespond(...args)); leafRestores.push(() => spy.mockRestore()); }
    const post = spyOn(posts, "handlePost").mockImplementation((_channel, req, isReply) => endpointMocks.handlePost(req, isReply)); leafRestores.push(() => post.mockRestore());
    const remove = spyOn(timeline, "deletePostResponse").mockImplementation((_chat, id, cascade) => { const value = endpointMocks.handleDeletePost(undefined as any, id, cascade ?? false); return { deletedIds: [], body: "delete", status: value.status } as any; }); leafRestores.push(() => remove.mockRestore());

    expect(await (await fixture.channel.handleAgents()).text()).toBe("agents");
    expect(await (await fixture.channel.handleManifest(new Request("https://example.com/manifest.json", { method: "HEAD" }))).text())
      .toBe("manifest");
    expect(await (await fixture.channel.handleAvatar("user", new Request("https://example.com/avatar/user"))).text()).toBe("avatar:user");
    expect((await fixture.channel.handleWorkspaceVisibility(new Request("https://example.com/workspace/visibility", { method: "POST" }))).status)
      .toBe(202);
    expect((await fixture.channel.handlePost(new Request("https://example.com/post?chat_jid=web%3Abranch", { method: "POST" }), false)).status)
      .toBe(207);
    expect(await fixture.channel.handleHashtag("tag", 6, 2, "web:branch").text()).toBe("hashtag");
    expect(await fixture.channel.handleSearch("query", 7, 3, "web:branch", "root", "web:root").text()).toBe("search");
    expect(await fixture.channel.handleThread(9, "web:branch").text()).toBe("thread");
    expect(await fixture.channel.handleThought("draft", "turn-1").text()).toBe("thought");
    expect((await fixture.channel.handleThoughtVisibility(new Request("https://example.com/agent/thought/visibility", { method: "POST" }))).status)
      .toBe(203);
    expect(fixture.channel.handleDeletePost(new Request("https://example.com/post/9?cascade=true", { method: "DELETE" }), 9, true).status)
      .toBe(206);
    expect((await fixture.channel.handleUpdatePost(new Request("https://example.com/post/9", { method: "PATCH" }), 9)).status).toBe(204);
    expect((await fixture.channel.handleInternalPost(new Request("https://example.com/internal/post", { method: "POST" }))).status).toBe(201);
    expect(await fixture.channel.handleAgentStatus(new Request("https://example.com/agent/status")).text()).toBe("status");
    expect(await (await fixture.channel.handleAgentActiveChats(new Request("https://example.com/agent/active-chats"))).text()).toBe("active-chats");
    expect(await (await fixture.channel.handleAgentBranches(new Request("https://example.com/agent/branches?include_archived=1"))).text()).toBe("branches");
    expect((await fixture.channel.handleAgentRespond(new Request("https://example.com/agent/respond", { method: "POST" }))).status).toBe(205);

    expect(calls).toEqual([
      "agents",
      "manifest:HEAD",
      "avatar:user:GET",
      "workspace:POST",
      "post:POST:0:web:branch",
      "hashtag:tag:6:2:web:branch",
      "search:query:7:3:web:branch:root:web:root",
      "thread:9:web:branch",
      "thought:draft:turn-1",
      "thought-visibility:POST",
      "delete:9:true",
      "update:9",
      "internal:POST",
      "status:GET",
      "active-chats",
      "branches:GET:1",
      "respond:POST",
    ]);
  });
});
