import { describe, expect, test } from "bun:test";
import { handleAgentRoutes } from "../../../src/channels/web/http/dispatch-agent.js";

describe("web http agent dispatch", () => {
  test("returns null for non-agent routes", async () => {
    const channel = {} as any;
    const req = new Request("https://example.com/timeline", { method: "GET" });
    const response = await handleAgentRoutes(channel, req, "/timeline", new URL(req.url));
    expect(response).toBeNull();
  });

  test("dispatches thought route with query params", async () => {
    const channel = {
      handleThought: (panel: string | null, turnId: string | null) => new Response(`${panel}:${turnId}`),
    } as any;

    const req = new Request("https://example.com/agent/thought?panel=main&turn_id=t1", { method: "GET" });
    const response = await handleAgentRoutes(channel, req, "/agent/thought", new URL(req.url));
    expect(await response?.text()).toBe("main:t1");
  });

  test("dispatches dynamic /agent/:id/message routes before exact matches and preserves the routed request", async () => {
    const channel = {
      handleAgentMessage: async (req: Request, path: string) => {
        const url = new URL(req.url);
        return new Response(`${path}:${url.searchParams.get("chat_jid") ?? ""}`, { status: 202 });
      },
    } as any;

    const req = new Request("https://example.com/agent/roster/message?chat_jid=web%3Abranch", { method: "POST" });
    const response = await handleAgentRoutes(channel, req, "/agent/roster/message", new URL(req.url));
    expect(response?.status).toBe(202);
    expect(await response?.text()).toBe("/agent/roster/message:web:branch");
  });

  test("dispatches remaining agent endpoints", async () => {
    const channel = {
      handleThoughtVisibility: async () => new Response("thought-vis", { status: 201 }),
      handleAgentMessage: async () => new Response("message", { status: 202 }),
      handleAgents: async () => new Response("roster"),
      handleAgentStatus: () => new Response("status"),
      handleAgentContext: async () => new Response("context"),
      handleAgentDebug: async () => new Response("debug"),
      handleAutoresearchStatus: async () => new Response("autoresearch-status"),
      handleAutoresearchStop: async () => new Response("autoresearch-stop", { status: 213 }),
      handleAutoresearchDismiss: async () => new Response("autoresearch-dismiss", { status: 214 }),
      handleAgentQueueState: async () => new Response("queue-state"),
      handleAgentQueueRemove: async () => new Response("queue-remove", { status: 203 }),
      handleAgentQueueSteer: async () => new Response("queue-steer", { status: 204 }),
      handleAgentModels: async () => new Response("models"),
      handleAgentActiveChats: async () => new Response("active-chats"),
      handleAgentBranches: async () => new Response("branches"),
      handleAgentBranchFork: async () => new Response("branch-fork", { status: 209 }),
      handleAgentBranchRename: async () => new Response("branch-rename", { status: 210 }),
      handleAgentBranchPrune: async () => new Response("branch-prune", { status: 211 }),
      handleAgentBranchRestore: async () => new Response("branch-restore", { status: 212 }),
      handleAgentPeerMessage: async () => new Response("peer-message", { status: 208 }),
      handleAgentRespond: async () => new Response("respond"),
      handleAdaptiveCardAction: async () => new Response("card-action", { status: 205 }),
      handleAgentSidePrompt: async () => new Response("side-prompt", { status: 206 }),
      handleAgentSidePromptStream: async () => new Response("side-prompt-stream", { status: 207 }),
      json: (_payload: unknown, status: number) => new Response("err", { status }),
    } as any;

    const thoughtVisReq = new Request("https://example.com/agent/thought/visibility", { method: "POST" });
    expect((await handleAgentRoutes(channel, thoughtVisReq, "/agent/thought/visibility", new URL(thoughtVisReq.url)))?.status).toBe(201);

    const messageReq = new Request("https://example.com/agent/abc/message", { method: "POST" });
    expect((await handleAgentRoutes(channel, messageReq, "/agent/abc/message", new URL(messageReq.url)))?.status).toBe(202);

    const rosterReq = new Request("https://example.com/agent/roster", { method: "GET" });
    expect(await (await handleAgentRoutes(channel, rosterReq, "/agent/roster", new URL(rosterReq.url)))?.text()).toBe("roster");

    const statusReq = new Request("https://example.com/agent/status", { method: "GET" });
    expect(await (await handleAgentRoutes(channel, statusReq, "/agent/status", new URL(statusReq.url)))?.text()).toBe("status");

    const contextReq = new Request("https://example.com/agent/context", { method: "GET" });
    expect(await (await handleAgentRoutes(channel, contextReq, "/agent/context", new URL(contextReq.url)))?.text()).toBe("context");

    const debugReq = new Request("https://example.com/agent/debug", { method: "GET" });
    expect(await (await handleAgentRoutes(channel, debugReq, "/agent/debug", new URL(debugReq.url)))?.text()).toBe("debug");

    const autoresearchStatusReq = new Request("https://example.com/agent/autoresearch/status", { method: "GET" });
    expect(await (await handleAgentRoutes(channel, autoresearchStatusReq, "/agent/autoresearch/status", new URL(autoresearchStatusReq.url)))?.text()).toBe("autoresearch-status");

    const autoresearchStopReq = new Request("https://example.com/agent/autoresearch/stop", { method: "POST" });
    expect((await handleAgentRoutes(channel, autoresearchStopReq, "/agent/autoresearch/stop", new URL(autoresearchStopReq.url)))?.status).toBe(213);

    const autoresearchDismissReq = new Request("https://example.com/agent/autoresearch/dismiss", { method: "POST" });
    expect((await handleAgentRoutes(channel, autoresearchDismissReq, "/agent/autoresearch/dismiss", new URL(autoresearchDismissReq.url)))?.status).toBe(214);

    const queueStateReq = new Request("https://example.com/agent/queue-state", { method: "GET" });
    expect(await (await handleAgentRoutes(channel, queueStateReq, "/agent/queue-state", new URL(queueStateReq.url)))?.text()).toBe("queue-state");

    const queueRemoveReq = new Request("https://example.com/agent/queue-remove", { method: "POST" });
    expect((await handleAgentRoutes(channel, queueRemoveReq, "/agent/queue-remove", new URL(queueRemoveReq.url)))?.status).toBe(203);

    const queueSteerReq = new Request("https://example.com/agent/queue-steer", { method: "POST" });
    expect((await handleAgentRoutes(channel, queueSteerReq, "/agent/queue-steer", new URL(queueSteerReq.url)))?.status).toBe(204);

    const modelsReq = new Request("https://example.com/agent/models", { method: "GET" });
    expect(await (await handleAgentRoutes(channel, modelsReq, "/agent/models", new URL(modelsReq.url)))?.text()).toBe("models");

    const activeChatsReq = new Request("https://example.com/agent/active-chats", { method: "GET" });
    expect(await (await handleAgentRoutes(channel, activeChatsReq, "/agent/active-chats", new URL(activeChatsReq.url)))?.text()).toBe("active-chats");

    const branchesReq = new Request("https://example.com/agent/branches?root_chat_jid=web%3Adefault", { method: "GET" });
    expect(await (await handleAgentRoutes(channel, branchesReq, "/agent/branches", new URL(branchesReq.url)))?.text()).toBe("branches");

    const branchForkReq = new Request("https://example.com/agent/branch-fork", { method: "POST" });
    expect((await handleAgentRoutes(channel, branchForkReq, "/agent/branch-fork", new URL(branchForkReq.url)))?.status).toBe(209);

    const branchRenameReq = new Request("https://example.com/agent/branch-rename", { method: "POST" });
    expect((await handleAgentRoutes(channel, branchRenameReq, "/agent/branch-rename", new URL(branchRenameReq.url)))?.status).toBe(210);

    const branchPruneReq = new Request("https://example.com/agent/branch-prune", { method: "POST" });
    expect((await handleAgentRoutes(channel, branchPruneReq, "/agent/branch-prune", new URL(branchPruneReq.url)))?.status).toBe(211);

    const branchRestoreReq = new Request("https://example.com/agent/branch-restore", { method: "POST" });
    expect((await handleAgentRoutes(channel, branchRestoreReq, "/agent/branch-restore", new URL(branchRestoreReq.url)))?.status).toBe(212);

    const peerMessageReq = new Request("https://example.com/agent/peer-message", { method: "POST" });
    expect((await handleAgentRoutes(channel, peerMessageReq, "/agent/peer-message", new URL(peerMessageReq.url)))?.status).toBe(208);

    const respondReq = new Request("https://example.com/agent/respond", { method: "POST" });
    expect(await (await handleAgentRoutes(channel, respondReq, "/agent/respond", new URL(respondReq.url)))?.text()).toBe("respond");

    const cardReq = new Request("https://example.com/agent/card-action", { method: "POST" });
    expect((await handleAgentRoutes(channel, cardReq, "/agent/card-action", new URL(cardReq.url)))?.status).toBe(205);

    const vapidReq = new Request("https://example.com/agent/push/vapid-public-key", { method: "GET" });
    expect((await handleAgentRoutes(channel, vapidReq, "/agent/push/vapid-public-key", new URL(vapidReq.url)))?.status).toBe(200);

    const sidePromptReq = new Request("https://example.com/agent/side-prompt", { method: "POST" });
    expect((await handleAgentRoutes(channel, sidePromptReq, "/agent/side-prompt", new URL(sidePromptReq.url)))?.status).toBe(206);

    const sidePromptStreamReq = new Request("https://example.com/agent/side-prompt/stream", { method: "POST" });
    expect((await handleAgentRoutes(channel, sidePromptStreamReq, "/agent/side-prompt/stream", new URL(sidePromptStreamReq.url)))?.status).toBe(207);

    const whitelistReq = new Request("https://example.com/agent/whitelist", { method: "POST" });
    expect((await handleAgentRoutes(channel, whitelistReq, "/agent/whitelist", new URL(whitelistReq.url)))?.status).toBe(404);
  });
});
