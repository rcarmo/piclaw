import { describe, expect, test } from "bun:test";

import "../../helpers.ts";
import { WebChannel } from "../../../src/channels/web.ts";
import { WebAgentControlPlaneService } from "../../../src/channels/web/agent/agent-control-plane-service.js";
import { createWebAdaptiveCardSidePromptService } from "../../../src/channels/web/cards/adaptive-card-side-prompt-service.js";
import { createWebAgentPeerMessageRelayService } from "../../../src/channels/web/agent/agent-peer-message-relay-service.js";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createControlPlaneChannel() {
  return {
    json: jsonResponse,
    controlPlaneService: new WebAgentControlPlaneService({
      defaultChatJid: "web:default",
      defaultAgentId: "default",
      json: jsonResponse,
      broadcastEvent: () => {},
      queue: { enqueue: () => {} },
      agentPool: { setSessionBinder: () => {} },
      readNativeQueue: async () => [],
      controlNativeQueue: async () => false,
    }),
  };
}

describe("web control-plane payload guards", () => {
  test("thought visibility and ui respond handlers reject malformed bodies", async () => {
    const uiContext = {
      json: jsonResponse,
      getWorkspaceVisible: () => false,
      setWorkspaceVisible: () => {},
      getWorkspaceShowHidden: () => false,
      setWorkspaceShowHidden: () => {},
      setPanelExpanded: () => {},
      handleUiResponse: () => ({ status: "ok" as const }),
    };
    const channel = {
      endpointContexts: { ui: () => uiContext },
    } as any;

    const thoughtReq = new Request("https://example.com/agent/thought/visibility", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(null),
    });
    const thoughtResponse = await WebChannel.prototype.handleThoughtVisibility.call(channel, thoughtReq);
    expect(thoughtResponse.status).toBe(400);
    expect((await thoughtResponse.json()).error).toBe("JSON body must be an object");

    const respondReq = new Request("https://example.com/agent/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(null),
    });
    const respondResponse = await WebChannel.prototype.handleAgentRespond.call(channel, respondReq);
    expect(respondResponse.status).toBe(400);
    expect((await respondResponse.json()).error).toBe("JSON body must be an object");
  });

  test("queue remove returns typed 400s for invalid JSON and invalid row ids", async () => {
    const channel = createControlPlaneChannel();

    const invalidJson = new Request("https://example.com/agent/queue-remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    const invalidJsonResponse = await WebChannel.prototype.handleAgentQueueRemove.call(channel, invalidJson);
    expect(invalidJsonResponse.status).toBe(400);
    expect((await invalidJsonResponse.json()).error).toBe("Invalid JSON");

    const missingRowId = new Request("https://example.com/agent/queue-remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const missingRowIdResponse = await WebChannel.prototype.handleAgentQueueRemove.call(channel, missingRowId);
    expect(missingRowIdResponse.status).toBe(400);
    expect((await missingRowIdResponse.json()).error).toBe("Missing or invalid row_id");

    const decimalRowId = new Request("https://example.com/agent/queue-remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row_id: 1.5 }),
    });
    const decimalRowIdResponse = await WebChannel.prototype.handleAgentQueueRemove.call(channel, decimalRowId);
    expect(decimalRowIdResponse.status).toBe(400);
    expect((await decimalRowIdResponse.json()).error).toBe("Missing or invalid row_id");
  });

  test("queue steer rejects non-object JSON payloads and invalid row ids", async () => {
    const channel = createControlPlaneChannel();
    const req = new Request("https://example.com/agent/queue-steer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([1, 2, 3]),
    });

    const response = await WebChannel.prototype.handleAgentQueueSteer.call(channel, req);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("JSON body must be an object");

    const decimalRowId = new Request("https://example.com/agent/queue-steer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row_id: 2.25 }),
    });
    const decimalRowIdResponse = await WebChannel.prototype.handleAgentQueueSteer.call(channel, decimalRowId);
    expect(decimalRowIdResponse.status).toBe(400);
    expect((await decimalRowIdResponse.json()).error).toBe("Missing or invalid row_id");
  });

  test("branch payload handlers reject malformed JSON bodies consistently", async () => {
    const channel = createControlPlaneChannel();

    const forkReq = new Request("https://example.com/agent/branch-fork", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(null),
    });
    const forkResponse = await WebChannel.prototype.handleAgentBranchFork.call(channel, forkReq);
    expect(forkResponse.status).toBe(400);
    expect((await forkResponse.json()).error).toBe("JSON body must be an object");

    const renameReq = new Request("https://example.com/agent/branch-rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["bad"]),
    });
    const renameResponse = await WebChannel.prototype.handleAgentBranchRename.call(channel, renameReq);
    expect(renameResponse.status).toBe(400);
    expect((await renameResponse.json()).error).toBe("JSON body must be an object");

    const pruneReq = new Request("https://example.com/agent/branch-prune", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const pruneResponse = await WebChannel.prototype.handleAgentBranchPrune.call(channel, pruneReq);
    expect(pruneResponse.status).toBe(400);
    expect((await pruneResponse.json()).error).toBe("Missing chat_jid");

    const purgeReq = new Request("https://example.com/agent/branch-purge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const purgeResponse = await WebChannel.prototype.handleAgentBranchPurge.call(channel, purgeReq);
    expect(purgeResponse.status).toBe(400);
    expect((await purgeResponse.json()).error).toBe("Missing chat_jid");

    const restoreReq = new Request("https://example.com/agent/branch-restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_name: "restored" }),
    });
    const restoreResponse = await WebChannel.prototype.handleAgentBranchRestore.call(channel, restoreReq);
    expect(restoreResponse.status).toBe(400);
    expect((await restoreResponse.json()).error).toBe("Missing chat_jid");
  });

  test("adaptive-card and side-prompt handlers reject non-object JSON payloads", async () => {
    const channel = { json: jsonResponse } as any;
    channel.adaptiveCardSidePromptService = createWebAdaptiveCardSidePromptService(channel, { defaultChatJid: "web:default", defaultAgentId: "default" });
    channel.peerMessageRelayService = createWebAgentPeerMessageRelayService(channel, { defaultAgentId: "default" });

    const cardReq = new Request("https://example.com/agent/card-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(null),
    });
    const cardResponse = await WebChannel.prototype.handleAdaptiveCardAction.call(channel, cardReq);
    expect(cardResponse.status).toBe(400);
    expect((await cardResponse.json()).error).toBe("JSON body must be an object");

    const missingCardIdReq = new Request("https://example.com/agent/card-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ post_id: 1, action: { type: "Action.Submit" } }),
    });
    const missingCardIdResponse = await WebChannel.prototype.handleAdaptiveCardAction.call(channel, missingCardIdReq);
    expect(missingCardIdResponse.status).toBe(400);
    expect((await missingCardIdResponse.json()).error).toBe("Missing or invalid card_id");

    const invalidPostIdReq = new Request("https://example.com/agent/card-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ post_id: "nan", card_id: "card-1", action: { type: "Action.Submit" } }),
    });
    const invalidPostIdResponse = await WebChannel.prototype.handleAdaptiveCardAction.call(channel, invalidPostIdReq);
    expect(invalidPostIdResponse.status).toBe(400);
    expect((await invalidPostIdResponse.json()).error).toBe("Missing or invalid post_id");

    const unsupportedActionReq = new Request("https://example.com/agent/card-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ post_id: 1, card_id: "card-1", action: { type: "Action.Fly" } }),
    });
    const unsupportedActionResponse = await WebChannel.prototype.handleAdaptiveCardAction.call(channel, unsupportedActionReq);
    expect(unsupportedActionResponse.status).toBe(400);
    expect((await unsupportedActionResponse.json()).error).toBe("Unsupported action type: Action.Fly");

    const peerReq = new Request("https://example.com/agent/peer-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_chat_jid: "web:other", content: "hello" }),
    });
    const peerResponse = await WebChannel.prototype.handleAgentPeerMessage.call(channel, peerReq);
    expect(peerResponse.status).toBe(400);
    expect((await peerResponse.json()).error).toBe("Missing source_chat_jid");

    const sidePromptReq = new Request("https://example.com/agent/side-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const sidePromptResponse = await WebChannel.prototype.handleAgentSidePrompt.call(channel, sidePromptReq);
    expect(sidePromptResponse.status).toBe(400);
    expect((await sidePromptResponse.json()).error).toBe("Missing or invalid prompt");

    const sidePromptStreamReq = new Request("https://example.com/agent/side-prompt/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: 123 }),
    });
    const sidePromptStreamResponse = await WebChannel.prototype.handleAgentSidePromptStream.call(channel, sidePromptStreamReq);
    expect(sidePromptStreamResponse.status).toBe(400);
    expect((await sidePromptStreamResponse.json()).error).toBe("Missing or invalid prompt");
  });

  test("autoresearch control-plane handlers reject malformed bodies before side effects", async () => {
    const channel = createControlPlaneChannel();

    const stopReq = new Request("https://example.com/agent/autoresearch/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(true),
    });
    const stopResponse = await WebChannel.prototype.handleAutoresearchStop.call(channel, stopReq);
    expect(stopResponse.status).toBe(400);
    expect((await stopResponse.json()).error).toBe("JSON body must be an object");

    const dismissReq = new Request("https://example.com/agent/autoresearch/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    const dismissResponse = await WebChannel.prototype.handleAutoresearchDismiss.call(channel, dismissReq);
    expect(dismissResponse.status).toBe(400);
    expect((await dismissResponse.json()).error).toBe("Invalid JSON");

    const dismissArrayReq = new Request("https://example.com/agent/autoresearch/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["bad"]),
    });
    const dismissArrayResponse = await WebChannel.prototype.handleAutoresearchDismiss.call(channel, dismissArrayReq);
    expect(dismissArrayResponse.status).toBe(400);
    expect((await dismissArrayResponse.json()).error).toBe("JSON body must be an object");
  });
});
