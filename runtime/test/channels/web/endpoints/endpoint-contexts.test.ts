import { describe, expect, test } from "bun:test";
import { createPostMutationsContext } from "../../../../src/channels/web/endpoints/endpoint-contexts.js";
import { createWebChannelEndpointContexts } from "../../../../src/channels/web/endpoints/channel-endpoint-context-factory.js";

function fixture(extra: Record<string, unknown> = {}) {
  const channel = {
    lastCommandInteractionId: 42,
    workspaceVisible: false,
    workspaceShowHidden: false,
    json: (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status }),
    ...extra,
  };
  const options = {
    defaultChatJid: "web:default", defaultAgentId: "default",
    getIdentitySnapshot: () => ({ assistantName: "Pi", assistantAvatarRaw: "assistant.png", agentAvatarUrl: "/avatars/agent", userName: "User", userAvatarRaw: "user.png", userAvatarUrl: "/avatars/user", userAvatarBackground: "#fff" }),
  };
  return { channel, contexts: createWebChannelEndpointContexts(channel as unknown as Parameters<typeof createWebChannelEndpointContexts>[0], options) };
}

describe("web endpoint contexts through the surviving channel factory", () => {
  test("createPostMutationsContext captures current command interaction id and delegates calls", () => {
    let storedThreadId: { messageId: number; threadId: number } | null = null;
    let broadcastedId: number | null = null;

    const postCtx = createPostMutationsContext({
      defaultChatJid: "web:default",
      getLastCommandInteractionId: () => 42,
      json: (payload, status = 200) => new Response(JSON.stringify(payload), { status }),
      replaceMessageContent: (_chatJid, id, content, threadId) => {
        storedThreadId = { messageId: id, threadId: threadId! };
        return { id, timestamp: new Date().toISOString(), data: { type: "agent_response", content } };
      },
      broadcastInteractionUpdated: (interaction) => {
        broadcastedId = interaction.id;
      },
      storeMessage: () => null,
      broadcastAgentResponse: () => {},
    });

    expect(postCtx.defaultChatJid).toBe("web:default");
    expect(postCtx.lastCommandInteractionId).toBe(42);

    const replaced = postCtx.replaceMessageContent("web:default", 9, "updated", 100)!;
    postCtx.broadcastInteractionUpdated(replaced);

    expect(storedThreadId).toEqual({ messageId: 9, threadId: 100 });
    expect(broadcastedId).toBe(9);
  });

  test("agent status and content preserve shared buffer access", async () => {
    const expectedBuffer = { text: "draft", totalLines: 3 };
    const { contexts } = fixture({
      getAgentStatus: () => ({ status: "active" }),
      getExtensionWorkingState: () => ({ message: "Working", indicator: null }),
      getBuffer: () => expectedBuffer,
      agentPool: {
        getContextUsageForChat: async () => ({ tokens: 10, contextWindow: 100, percent: 10 }),
        getAvailableModels: async () => ({ models: [] }),
      },
    });
    const agentStatusCtx = contexts.agentStatus(), contentCtx = contexts.content();
    expect(agentStatusCtx.getExtensionWorkingState("web:default")).toEqual({ message: "Working", indicator: null });
    expect(agentStatusCtx.getBuffer("turn", "draft")).toEqual(expectedBuffer);
    expect(contentCtx.getBuffer("turn", "thought")).toEqual(expectedBuffer);
    await expect(agentStatusCtx.getContextUsageForChat("web:default")).resolves.toEqual({ tokens: 10, contextWindow: 100, percent: 10 });
  });

  test("UI, agents and avatar contexts expose configured state", () => {
    const { contexts } = fixture({ setPanelExpanded: () => {}, uiBridge: { handleUiResponse: () => ({ status: "ok" }) }, agentPool: {} });
    const uiCtx = contexts.ui();
    uiCtx.setWorkspaceVisible(true);
    uiCtx.setWorkspaceShowHidden(true);
    expect(uiCtx.getWorkspaceVisible()).toBe(true);
    expect(uiCtx.getWorkspaceShowHidden()).toBe(true);
    const agentsCtx = contexts.agents();
    expect(agentsCtx.defaultAgentId).toBe("default");
    expect(agentsCtx.agentName).toBe("Pi");
    const avatarCtx = contexts.avatar();
    expect(avatarCtx.assistantAvatar).toBe("assistant.png");
    expect(avatarCtx.userAvatar).toBe("user.png");
  });
});
