import * as identity from "../../../../src/channels/web/endpoints/identity-endpoints.js";
import * as content from "../../../../src/channels/web/endpoints/content-endpoints.js";
import * as ui from "../../../../src/channels/web/endpoints/ui-endpoints.js";
import * as status from "../../../../src/channels/web/agent/agent-status.js";
import * as manifest from "../../../../src/channels/web/manifest.js";
import * as mutations from "../../../../src/channels/web/post-mutations.js";
import * as posts from "../../../../src/channels/web/handlers/posts.js";
import * as timeline from "../../../../src/channels/web/timeline-service.js";
const leafRestores: (() => void)[] = [];
afterEach(() => { for (const restore of leafRestores.splice(0)) restore(); });
import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { WebChannel } from "../../../../src/channels/web.js";

function response(label: string, status = 200): Response {
  return new Response(label, { status });
}

describe("web channel public HTTP wiring", () => {
  test("delegates request-router, wrapper, and response helpers to the existing collaborators", async () => {
    const calls: string[] = [];
    const fetchResponse = response("fetch", 206);
    const requestResponse = response("request", 207);
    const jsonResponse = response("json", 208);
    const service = Object.assign(Object.create(WebChannel.prototype), {
      serverLifecycleGateway: {
        handleRequest: (_req: Request, dispatch: () => Promise<Response>) => dispatch(),
        handleFetch: async (req: Request) => {
          calls.push(`fetch:${new URL(req.url).pathname}`);
          return fetchResponse;
        },
      },
      requestRouter: {
        handle: async (req: Request) => {
          calls.push(`request:${new URL(req.url).pathname}`);
          return requestResponse;
        },
      },
      endpointMocks: {
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
          return response("avatar");
        },
        handleWorkspaceVisibility: async (req: Request) => {
          calls.push(`workspace:${req.method}`);
          return response("workspace");
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
          return response("thought-visibility");
        },
        handleDeletePost: (_req: Request, id: number | null, cascade: boolean) => {
          calls.push(`delete:${id ?? "null"}:${cascade}`);
          return response("delete");
        },
        handleUpdatePost: async (_channel: unknown, _req: Request, id: number | null) => {
          calls.push(`update:${id ?? "null"}`);
          return response("update");
        },
        handleInternalPost: async (_channel: unknown, req: Request) => {
          calls.push(`internal:${req.method}`);
          return response("internal");
        },
        handlePost: async (req: Request, isReply: boolean) => {
          calls.push(`post:${req.method}:${isReply ? 1 : 0}`);
          return response("post");
        },
        handleAgentStatus: (req: Request) => {
          calls.push(`status:${req.method}`);
          return response("status");
        },
        handleAgentActiveChats: () => {
          calls.push("active-chats");
          return response("active-chats");
        },
        handleAgentBranches: async (req: Request) => {
          calls.push(`branches:${req.method}`);
          return response("branches");
        },
        handleAgentRespond: async (req: Request) => {
          calls.push(`respond:${req.method}`);
          return response("respond");
        },
      },
      controlPlaneService: {
        handleAutoresearchStatus: async (req: Request) => {
          calls.push(`autoresearch-status:${req.method}`);
          return response("autoresearch-status");
        },
        handleAutoresearchStop: async (req: Request) => {
          calls.push(`autoresearch-stop:${req.method}`);
          return response("autoresearch-stop");
        },
        handleAutoresearchDismiss: async (req: Request) => {
          calls.push(`autoresearch-dismiss:${req.method}`);
          return response("autoresearch-dismiss");
        },
        handleAgentQueueState: async (req: Request) => {
          calls.push(`queue-state:${req.method}`);
          return response("queue-state");
        },
        handleAgentQueueRemove: async (req: Request) => {
          calls.push(`queue-remove:${req.method}`);
          return response("queue-remove");
        },
        handleAgentQueueSteer: async (req: Request) => {
          calls.push(`queue-steer:${req.method}`);
          return response("queue-steer");
        },
        handleAgentBranchFork: async (req: Request) => {
          calls.push(`branch-fork:${req.method}`);
          return response("branch-fork");
        },
        handleAgentBranchRename: async (req: Request) => {
          calls.push(`branch-rename:${req.method}`);
          return response("branch-rename");
        },
        handleAgentBranchPrune: async (req: Request) => {
          calls.push(`branch-prune:${req.method}`);
          return response("branch-prune");
        },
        handleAgentBranchDownload: (req: Request) => {
          calls.push(`branch-download:${req.method}:${new URL(req.url).searchParams.get("chat_jid") ?? ""}`);
          return response("branch-download");
        },
        handleAgentBranchPurge: async (req: Request) => {
          calls.push(`branch-purge:${req.method}`);
          return response("branch-purge");
        },
        handleAgentBranchRestore: async (req: Request) => {
          calls.push(`branch-restore:${req.method}`);
          return response("branch-restore");
        },
      },
      terminalVncHttpService: {
        handleTerminalSession: (req: Request) => {
          calls.push(`terminal:${req.method}`);
          return response("terminal");
        },
        handleTerminalHandoff: async (req: Request) => {
          calls.push(`terminal-handoff:${req.method}`);
          return response("terminal-handoff");
        },
        handleVncSession: (req: Request) => {
          calls.push(`vnc:${req.method}`);
          return response("vnc");
        },
        handleVncHandoff: async (req: Request) => {
          calls.push(`handoff:${req.method}`);
          return response("handoff");
        },
      },
      sessionBroadcast: {
        handleSse: (req: Request) => {
          calls.push(`sse:${req.method}`);
          return response("sse");
        },
      },
      responses: {
        serveStatic: async (relPath: string) => {
          calls.push(`static:${relPath}`);
          return response("static");
        },
        serveDocsStatic: async (relPath: string) => {
          calls.push(`docs:${relPath}`);
          return response("docs");
        },
        json: (_data: unknown, status = 200) => {
          if (_data === "delete") return response("delete", status);
          calls.push(`json:${status}`);
          return jsonResponse;
        },
        clampInt: (value: string | null, fallback: number, min: number, max: number) => {
          calls.push(`clamp:${value ?? "null"}:${fallback}:${min}:${max}`);
          return 33;
        },
        parseOptionalInt: (value: string | null) => {
          calls.push(`parse:${value ?? "null"}`);
          return 44;
        },
      },
    });

    const endpointMocks = service.endpointMocks;
    service.endpointContexts = { identity: () => ({ assistantName: "Fixture", assistantAvatarRaw: null }), agents: () => ({}), avatar: () => ({}), ui: () => ({}), content: () => ({}), agentStatus: () => ({}) };
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

    const getReq = new Request("https://example.test/timeline?chat_jid=web%3Abranch", { method: "GET" });
    const postReq = new Request("https://example.test/post", { method: "POST" });

    expect(await service.handleFetch(getReq)).toBe(fetchResponse);
    expect(await service.handleRequest(getReq)).toBe(requestResponse);
    expect(await (await service.handleAgents()).text()).toBe("agents");
    expect(await (await service.handleManifest(new Request("https://example.test/manifest.json", { method: "HEAD" }))).text()).toBe("manifest");
    expect(await (await service.handleAvatar("user", getReq)).text()).toBe("avatar");
    expect(await (await service.handleWorkspaceVisibility(postReq)).text()).toBe("workspace");
    expect(service.handleTimeline).toBeFunction();
    expect(await service.handleHashtag("tag", 6, 2, "web:branch").text()).toBe("hashtag");
    expect(await service.handleSearch("query", 7, 3, "web:branch", "root", "web:root").text()).toBe("search");
    expect(await service.handleThread(9, "web:branch").text()).toBe("thread");
    expect(await service.handleThought("draft", "turn-1").text()).toBe("thought");
    expect(await (await service.handleThoughtVisibility(postReq)).text()).toBe("thought-visibility");
    expect(await service.handleDeletePost(postReq, 9, true).text()).toBe("delete");
    expect(await (await service.handleUpdatePost(postReq, 10)).text()).toBe("update");
    expect(await (await service.handleInternalPost(postReq)).text()).toBe("internal");
    expect(await service.handleSse(getReq).text()).toBe("sse");
    expect(await service.handleTerminalSession(getReq).text()).toBe("terminal");
    expect(await (await service.handleTerminalHandoff(postReq)).text()).toBe("terminal-handoff");
    expect(await service.handleVncSession(getReq).text()).toBe("vnc");
    expect(await (await service.handleVncHandoff(postReq)).text()).toBe("handoff");
    expect(await (await service.handlePost(postReq, true)).text()).toBe("post");
    expect(await service.handleAgentStatus(getReq).text()).toBe("status");
    expect(await (await service.handleAutoresearchStatus(getReq)).text()).toBe("autoresearch-status");
    expect(await (await service.handleAutoresearchStop(postReq)).text()).toBe("autoresearch-stop");
    expect(await (await service.handleAutoresearchDismiss(postReq)).text()).toBe("autoresearch-dismiss");
    expect(await (await service.handleAgentQueueState(getReq)).text()).toBe("queue-state");
    expect(await (await service.handleAgentQueueRemove(postReq)).text()).toBe("queue-remove");
    expect(await (await service.handleAgentQueueSteer(postReq)).text()).toBe("queue-steer");
    expect(await (await service.handleAgentActiveChats(getReq)).text()).toBe("active-chats");
    expect(await (await service.handleAgentBranches(getReq)).text()).toBe("branches");
    expect(await (await service.handleAgentBranchFork(postReq)).text()).toBe("branch-fork");
    expect(await (await service.handleAgentBranchRename(postReq)).text()).toBe("branch-rename");
    expect(await (await service.handleAgentBranchPrune(postReq)).text()).toBe("branch-prune");
    expect(await service.handleAgentBranchDownload(new Request("https://example.test/agent/branch-download?chat_jid=web%3Aarchived", { method: "GET" })).text()).toBe("branch-download");
    expect(await (await service.handleAgentBranchPurge(postReq)).text()).toBe("branch-purge");
    expect(await (await service.handleAgentBranchRestore(postReq)).text()).toBe("branch-restore");
    expect(await (await service.handleAgentRespond(postReq)).text()).toBe("respond");
    expect(await (await service.serveStatic("index.html")).text()).toBe("static");
    expect(await (await service.serveDocsStatic("guide.md")).text()).toBe("docs");
    expect(service.json({ ok: true }, 209)).toBe(jsonResponse);
    expect(service.clampInt("12", 1, 0, 9)).toBe(33);
    expect(service.parseOptionalInt("44")).toBe(44);

    expect(calls).toEqual([
      "fetch:/timeline",
      "request:/timeline",
      "agents",
      "manifest:HEAD",
      "avatar:user:GET",
      "workspace:POST",
      "hashtag:tag:6:2:web:branch",
      "search:query:7:3:web:branch:root:web:root",
      "thread:9:web:branch",
      "thought:draft:turn-1",
      "thought-visibility:POST",
      "delete:9:true",
      "update:10",
      "internal:POST",
      "sse:GET",
      "terminal:GET",
      "terminal-handoff:POST",
      "vnc:GET",
      "handoff:POST",
      "post:POST:1",
      "status:GET",
      "autoresearch-status:GET",
      "autoresearch-stop:POST",
      "autoresearch-dismiss:POST",
      "queue-state:GET",
      "queue-remove:POST",
      "queue-steer:POST",
      "active-chats",
      "branches:GET",
      "branch-fork:POST",
      "branch-rename:POST",
      "branch-prune:POST",
      "branch-download:GET:web:archived",
      "branch-purge:POST",
      "branch-restore:POST",
      "respond:POST",
      "static:index.html",
      "docs:guide.md",
      "json:209",
      "clamp:12:1:0:9",
      "parse:44",
    ]);
  });

});
