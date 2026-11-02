import { describe, expect, test } from "bun:test";
import {
  createAgentStatusContext,
  createAgentsEndpointContext,
  createAvatarEndpointContext,
  createContentEndpointsContext,
  createUiEndpointsContext,
} from "../../../../src/channels/web/endpoints/endpoint-contexts.js";

describe("web endpoint context builders", () => {
  test("createAgentStatusContext and createContentEndpointsContext preserve shared buffer access", async () => {
    const expectedBuffer = { text: "draft", totalLines: 3 };

    const agentStatusCtx = createAgentStatusContext({
      defaultChatJid: "web:default",
      json: (payload, status = 200) => new Response(JSON.stringify(payload), { status }),
      getAgentStatus: () => ({ status: "active" }),
      getExtensionWorkingState: () => ({ message: "Working", indicator: null }),
      recoverStaleInflightRun: () => false,
      getBuffer: () => expectedBuffer,
      getContextUsageForChat: async () => ({ tokens: 10, contextWindow: 100, percent: 10 }),
      getAvailableModels: async () => ({ models: [] }),
      getProviderReadyCompletedForInstance: () => true,
    });

    const contentCtx = createContentEndpointsContext({
      defaultChatJid: "web:default",
      json: (payload, status = 200) => new Response(JSON.stringify(payload), { status }),
      getBuffer: () => expectedBuffer,
    });

    expect(agentStatusCtx.getExtensionWorkingState("web:default")).toEqual({ message: "Working", indicator: null });
    expect(agentStatusCtx.getBuffer("turn", "draft")).toEqual(expectedBuffer);
    expect(contentCtx.getBuffer("turn", "thought")).toEqual(expectedBuffer);
    await expect(agentStatusCtx.getContextUsageForChat("web:default")).resolves.toEqual({
      tokens: 10,
      contextWindow: 100,
      percent: 10,
    });
  });

  test("createUiEndpointsContext, createAgentsEndpointContext, and createAvatarEndpointContext expose configured state", () => {
    let visible = false;
    let showHidden = false;

    const uiCtx = createUiEndpointsContext({
      json: (payload, status = 200) => new Response(JSON.stringify(payload), { status }),
      getWorkspaceVisible: () => visible,
      setWorkspaceVisible: (value) => {
        visible = value;
      },
      getWorkspaceShowHidden: () => showHidden,
      setWorkspaceShowHidden: (value) => {
        showHidden = value;
      },
      setPanelExpanded: () => {},
      handleUiResponse: () => ({ status: "ok" }),
    });

    uiCtx.setWorkspaceVisible(true);
    uiCtx.setWorkspaceShowHidden(true);
    expect(uiCtx.getWorkspaceVisible()).toBe(true);
    expect(uiCtx.getWorkspaceShowHidden()).toBe(true);

    const agentsCtx = createAgentsEndpointContext({
      agentPool: {} as unknown as import("../../../../src/agent-pool.js").AgentPool,
      defaultChatJid: "web:default",
      defaultAgentId: "default",
      agentName: "Pi",
      agentAvatar: "/avatars/agent",
      userName: "User",
      userAvatar: "/avatars/user",
      userAvatarBackground: "#fff",
      json: (payload, status = 200) => new Response(JSON.stringify(payload), { status }),
    });

    expect(agentsCtx.defaultAgentId).toBe("default");
    expect(agentsCtx.agentName).toBe("Pi");

    const avatarCtx = createAvatarEndpointContext({
      assistantAvatar: "assistant.png",
      userAvatar: "user.png",
      json: (payload, status = 200) => new Response(JSON.stringify(payload), { status }),
    });

    expect(avatarCtx.assistantAvatar).toBe("assistant.png");
    expect(avatarCtx.userAvatar).toBe("user.png");
  });
});
