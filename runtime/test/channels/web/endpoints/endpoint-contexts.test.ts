import { describe, expect, test } from "bun:test";
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
  test("post mutations no longer allocate a forwarding context", () => {
    expect(fixture().contexts).not.toHaveProperty('postMutations');
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
