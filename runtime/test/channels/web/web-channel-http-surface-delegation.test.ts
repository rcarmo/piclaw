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

import { WebChannel } from "../../../src/channels/web.ts";

function response(label: string, status = 200): Response {
  return new Response(label, { status });
}

describe("web channel http surface delegation", () => {
  test("remaining prototype HTTP wrapper methods stay compatible with bare stubs", async () => {
    const calls: string[] = [];
    const stub = {
      serverLifecycleGateway: {
        handleRequest: (_req: Request, dispatch: () => Promise<Response>) => dispatch(),
        handleFetch: async (req: Request) => {
          calls.push(`fetch:${new URL(req.url).pathname}`);
          return response("fetch");
        },
      },
      requestRouter: {
        handle: async (req: Request) => {
          calls.push(`request:${new URL(req.url).pathname}`);
          return response("request");
        },
      },
      endpointMocks: {
        handleAgents: async () => {
          calls.push("agents");
          return response("agents");
        },
        handleDeletePost: (_req: Request, id: number | null, cascade: boolean) => {
          calls.push(`delete:${id ?? "null"}:${cascade}`);
          return response("delete");
        },
        handlePost: async (_req: Request, isReply: boolean) => {
          calls.push(`post:${isReply ? 1 : 0}`);
          return response("post");
        },
        handleAgentStatus: (_req: Request) => {
          calls.push("status");
          return response("status");
        },
        handleAgentRespond: async (_req: Request) => {
          calls.push("respond");
          return response("respond");
        },
        handleAgentActiveChats: () => {
          calls.push("active-chats");
          return response("active-chats");
        },
      },
      controlPlaneService: {
        handleAutoresearchStatus: async (_req: Request) => {
          calls.push("autoresearch-status");
          return response("autoresearch-status");
        },
        handleAgentQueueState: async (_req: Request) => {
          calls.push("queue-state");
          return response("queue-state");
        },
      },
      terminalVncHttpService: {
        handleTerminalSession: (_req: Request) => {
          calls.push("terminal");
          return response("terminal");
        },
        handleTerminalHandoff: async (_req: Request) => {
          calls.push("terminal-handoff");
          return response("terminal-handoff");
        },
        handleVncSession: (_req: Request) => {
          calls.push("vnc");
          return response("vnc");
        },
        handleVncHandoff: async (_req: Request) => {
          calls.push("handoff");
          return response("handoff");
        },
      },
      sessionBroadcast: {
        handleSse: (_req: Request) => {
          calls.push("sse");
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
          return response("json", status);
        },
        clampInt: (value: string | null, fallback: number, min: number, max: number) => {
          calls.push(`clamp:${value ?? "null"}:${fallback}:${min}:${max}`);
          return 17;
        },
        parseOptionalInt: (value: string | null) => {
          calls.push(`parse:${value ?? "null"}`);
          return 23;
        },
      },
    } as any;

    stub.json = WebChannel.prototype.json.bind(stub);
    const endpointMocks = stub.endpointMocks;
    stub.endpointContexts = { identity: () => ({ assistantName: "Fixture", assistantAvatarRaw: null }), agents: () => ({}), avatar: () => ({}), ui: () => ({}), content: () => ({}), postMutations: () => ({}), agentStatus: () => ({}) };
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

    expect(await (await WebChannel.prototype.handleFetch.call(stub, getReq)).text()).toBe("fetch");
    expect(await (await WebChannel.prototype.handleRequest.call(stub, getReq)).text()).toBe("request");
    expect(await (await WebChannel.prototype.handleAgents.call(stub)).text()).toBe("agents");
    expect(await WebChannel.prototype.handleDeletePost.call(stub, postReq, 9, true).text()).toBe("delete");
    expect(await (await WebChannel.prototype.handlePost.call(stub, postReq, true)).text()).toBe("post");
    expect(await WebChannel.prototype.handleAgentStatus.call(stub, getReq).text()).toBe("status");
    expect(await (await WebChannel.prototype.handleAutoresearchStatus.call(stub, getReq)).text()).toBe("autoresearch-status");
    expect(await (await WebChannel.prototype.handleAgentQueueState.call(stub, getReq)).text()).toBe("queue-state");
    expect(await (await WebChannel.prototype.handleAgentRespond.call(stub, postReq)).text()).toBe("respond");
    expect(await (await WebChannel.prototype.handleAgentActiveChats.call(stub, getReq)).text()).toBe("active-chats");
    expect(await WebChannel.prototype.handleSse.call(stub, getReq).text()).toBe("sse");
    expect(await WebChannel.prototype.handleTerminalSession.call(stub, getReq).text()).toBe("terminal");
    expect(await (await WebChannel.prototype.handleTerminalHandoff.call(stub, postReq)).text()).toBe("terminal-handoff");
    expect(await WebChannel.prototype.handleVncSession.call(stub, getReq).text()).toBe("vnc");
    expect(await (await WebChannel.prototype.handleVncHandoff.call(stub, postReq)).text()).toBe("handoff");
    expect(await (await WebChannel.prototype.serveStatic.call(stub, "index.html")).text()).toBe("static");
    expect(await (await WebChannel.prototype.serveDocsStatic.call(stub, "guide.md")).text()).toBe("docs");
    expect((await WebChannel.prototype.json.call(stub, { ok: true }, 201).text())).toBe("json");
    expect(WebChannel.prototype.clampInt.call(stub, "12", 1, 0, 9)).toBe(17);
    expect(WebChannel.prototype.parseOptionalInt.call(stub, "23")).toBe(23);

    expect(calls).toEqual([
      "fetch:/timeline",
      "request:/timeline",
      "agents",
      "delete:9:true",
      "post:1",
      "status",
      "autoresearch-status",
      "queue-state",
      "respond",
      "active-chats",
      "sse",
      "terminal",
      "terminal-handoff",
      "vnc",
      "handoff",
      "static:index.html",
      "docs:guide.md",
      "json:201",
      "clamp:12:1:0:9",
      "parse:23",
    ]);
  });
});
