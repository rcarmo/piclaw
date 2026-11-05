import { expect, test } from "bun:test";
import { createWebChannelEndpointContexts } from "../../../../src/channels/web/endpoints/channel-endpoint-context-factory.js";

function fixture() {
  const identity = { assistantName: "Pi", assistantAvatarRaw: null, agentAvatarUrl: null, userName: null, userAvatarRaw: null, userAvatarUrl: null, userAvatarBackground: null };
  const channel: any = {
    lastCommandInteractionId: null, workspaceVisible: false, workspaceShowHidden: false,
    json(payload: unknown, status = 200) { return new Response(JSON.stringify(payload), { status }); },
    agentPool: {}, authGateway: {}, admitMessage: async () => null,
  };
  const options = { defaultChatJid: "web:default", defaultAgentId: "default", getIdentitySnapshot() { return identity; } };
  return { channel, options, contexts: createWebChannelEndpointContexts(channel, options) };
}

test("five context projections retain exact own keys and allocation policy", () => {
  const { contexts } = fixture();
  const shapes = {
    agentStatus: ["defaultChatJid", "json", "getAgentStatus", "getExtensionWorkingState", "getBuffer", "getContextUsageForChat", "getSessionTreeSummaryForChat", "getTokenUsageForChat", "getAvailableModels", "getProviderReadyCompletedForInstance"],
    content: ["defaultChatJid", "hiddenNativeRows", "json", "getBuffer", "getIdentity"],
    ui: ["json", "getWorkspaceVisible", "setWorkspaceVisible", "getWorkspaceShowHidden", "setWorkspaceShowHidden", "setPanelExpanded", "handleUiResponse"],
    agents: ["agentPool", "defaultChatJid", "defaultAgentId", "agentName", "agentAvatar", "userName", "userAvatar", "userAvatarBackground", "json"],
    avatar: ["assistantAvatar", "userAvatar", "json"],
  } as const;
  for (const name of Object.keys(shapes) as Array<keyof typeof shapes>) {
    const a = contexts[name](), b = contexts[name]();
    expect(Object.keys(a)).toEqual([...shapes[name]]);
    expect(Object.getPrototypeOf(a)).toBe(Object.prototype);
    if (["agentStatus", "content", "ui"].includes(name)) expect(a).toBe(b);
    else expect(a).not.toBe(b);
  }
  expect(contexts.auth()).toBe(contexts.auth());
});

test("context creation stays lazy and cached callbacks preserve live owners/defaults/errors", async () => {
  const { channel, options } = fixture();
  Object.defineProperty(channel, "agentPool", { configurable: true, get() { throw new Error("pool is not ready"); } });
  const contexts = createWebChannelEndpointContexts(channel, options);
  const content = contexts.content(), ui = contexts.ui();
  expect(content.defaultChatJid).toBe("web:default");
  expect(content.hiddenNativeRows).toBeUndefined();
  channel.filterNativeTimeline=async function(chat:string,ids:number[]){expect(this).toBe(channel);expect([chat,ids]).toEqual(['web:default',[7,8]]);return [8];};
  expect(await content.hiddenNativeRows!('web:default',[7,8])).toEqual([8]);
  expect(ui.getWorkspaceVisible()).toBe(false);
  const marker = new Error("same owner error");
  channel.getBuffer = function(turn: string, panel: string) { expect(this).toBe(channel); expect([turn, panel]).toEqual(["turn", "draft"]); throw marker; };
  expect(() => content.getBuffer("turn", "draft")).toThrow(marker);
  channel.json = function(payload: unknown, status = 200) { expect(this).toBe(channel); return new Response(JSON.stringify({ live: payload }), { status }); };
  const response = content.json({ ok: true });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ live: { ok: true } });
  expect(ui.json({}, 409).status).toBe(409);
  channel.workspaceVisible = true;
  expect(ui.getWorkspaceVisible()).toBe(true);
  expect(contexts.content()).toBe(content);
  expect(() => contexts.agentStatus()).toThrow("pool is not ready");
});

test("optional summary presence remains captured at context creation but its owner stays live", async () => {
  const f = fixture(), absent = f.contexts.agentStatus();
  expect(Object.hasOwn(absent, "getSessionTreeSummaryForChat")).toBe(true);
  expect(absent.getSessionTreeSummaryForChat).toBeUndefined();
  f.channel.agentPool.getSessionTreeSummaryForChat = async () => ({ leafId: "first", total: 1 });
  expect(f.contexts.agentStatus().getSessionTreeSummaryForChat).toBeUndefined();
  const present = createWebChannelEndpointContexts(f.channel, f.options).agentStatus();
  await expect(present.getSessionTreeSummaryForChat!("web:default")).resolves.toEqual({ leafId: "first", total: 1 });
  const latest = { async getSessionTreeSummaryForChat(chat: string) { expect(this).toBe(latest); expect(chat).toBe("web:default"); return { leafId: "second", total: 2 }; } };
  f.channel.agentPool = latest;
  await expect(present.getSessionTreeSummaryForChat!("web:default")).resolves.toEqual({ leafId: "second", total: 2 });
});

test("the now-unused endpoint context copy-builder module is retired", async () => {
  expect(await Bun.file(new URL("../../../../src/channels/web/endpoints/endpoint-contexts.ts", import.meta.url)).exists()).toBe(false);
});
