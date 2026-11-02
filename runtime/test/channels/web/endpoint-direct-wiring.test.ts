import { afterEach, expect, spyOn, test } from "bun:test";
import { createWebChannelTestFixture } from "./helpers/web-channel-fixture.js";
import * as posts from "../../../src/channels/web/handlers/posts.js";
import * as metrics from "../../../src/channels/web/agent/system-metrics.js";
import * as timeline from "../../../src/channels/web/timeline-service.js";
import { createWebChannelEndpointContexts, createWebChannelIdentitySnapshot } from "../../../src/channels/web/endpoints/channel-endpoint-context-factory.js";

let cleanup: (() => void) | undefined;
const restores: (() => void)[] = [];
afterEach(() => { for (const restore of restores.splice(0)) restore(); cleanup?.(); cleanup = undefined; });
async function fixture() {
  const f = await createWebChannelTestFixture({ workspace: "temp", agentPool: {
    listKnownChats: () => [{ chat_jid: "web:branch", agent_name: "Branch" }],
    getCurrentModelLabel: async () => null, getMemoryInstrumentationSnapshot: () => null,
  } });
  cleanup = f.cleanup;
  Object.defineProperty(f.channel, "endpointFacade", { get() { throw Error("Retired endpoint facade was accessed"); } });
  return f;
}

test("HTTP roster, status, activity and branch reads bypass the retired facade", async () => {
  const f = await fixture();
  for (const path of ["/agent/roster", "/agent/status", "/agent/active-chats", "/agent/branches?include_archived=yes&root_chat_jid=%20web%3Aroot%20"]) {
    const response = await f.channel.handleRequest(new Request("https://fixture.invalid" + path));
    expect(response.status).toBe(200); expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-request-id")).toBeString();
    const body = await response.json();
    if (path.includes("active-chats")) expect(body.chats[0]).toMatchObject({ chat_jid: "web:branch", is_active: false, activity_status: "idle" });
    if (path.includes("branches?")) expect(body.chats).toEqual([{ chat_jid: "web:branch", agent_name: "Branch" }]);
  }
});

test("post/reply entry keeps request, target defaults and response identity without another adapter", async () => {
  const f = await fixture(), calls: unknown[][] = [], response = new Response("accepted", { status: 201 });
  const handler = spyOn(posts, "handlePost").mockImplementation(async (...args) => { calls.push(args); return response; });
  restores.push(() => handler.mockRestore());
  for (const [query, target, reply] of [["%20web%3Abranch%20", "web:branch", false], ["%20", "web:default", true]] as const) {
    const req = new Request("https://fixture.invalid/post?chat_jid=" + query, { method: "POST" });
    expect(await f.channel.handlePost(req, reply)).toBe(response);
    expect(calls.at(-1)).toEqual([f.channel, req, reply, target]);
  }
});

test("UI status keeps partial errors and never renews GPU sampling", async () => {
  const f = await fixture(), ctx = f.channel.endpointContexts.agentStatus(), seen: unknown[][] = [];
  ctx.getAvailableModels = async () => { throw Error("unavailable catalogue"); };
  ctx.getContextUsageForChat = async () => ({ tokens: 0, contextWindow: 1000, percent: 0 });
  ctx.getTokenUsageForChat = () => null;
  const handler = spyOn(metrics, "handleSystemMetricsRequest").mockImplementation((...args) => { seen.push(args); return Response.json({ fixture: true }); });
  restores.push(() => handler.mockRestore());
  const response = await f.channel.handleRequest(new Request("https://fixture.invalid/agent/status?ui=1"));
  const body = await response.json();
  expect(response.status).toBe(200); expect(body.model).toBeNull(); expect(body.context.tokens).toBe(0);
  expect(body.metrics).toEqual({ fixture: true }); expect(body.errors).toEqual(["model"]);
  expect(seen).toHaveLength(1); expect(seen[0]![2]).toBeNull();
});

test("delete preserves default chat, empty/error payloads and broadcasts only actual deletions", async () => {
  const f = await fixture(), calls: unknown[][] = [];
  let result = { deletedIds: [7, 9], body: { deleted: 2 }, status: 202 };
  const remove = spyOn(timeline, "deletePostResponse").mockImplementation((...args) => { calls.push(args); return result as any; });
  restores.push(() => remove.mockRestore());
  let response = f.channel.handleDeletePost(new Request("https://fixture.invalid/post/7?chat_jid=%20web%3Abranch%20"), 7, true);
  expect(response.status).toBe(202); expect(await response.json()).toEqual({ deleted: 2 });
  expect(calls).toEqual([["web:branch", 7, true]]);
  expect(f.events).toEqual([{ type: "interaction_deleted", data: { chat_jid: "web:branch", ids: [7, 9] } }]);
  result = { deletedIds: [], body: { error: "missing" } as any, status: 404 };
  response = f.channel.handleDeletePost(new Request("https://fixture.invalid/post/7"), null);
  expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: "missing" });
  expect(calls.at(-1)).toEqual(["web:default", null, false]); expect(f.events).toHaveLength(1);
});

test("identity getter retains its options receiver and UI naming stays live after awaited sections", async () => {
  const f = await fixture(), entered = Promise.withResolvers<void>(), models = Promise.withResolvers<unknown>();
  let live = createWebChannelIdentitySnapshot({ assistantName: "Before" });
  const options = { defaultChatJid: "web:default", defaultAgentId: "default", getIdentitySnapshot() { expect(this).toBe(options); return live; } };
  const contexts = createWebChannelEndpointContexts(f.channel, options);
  expect(contexts.identity()).toBe(live);
  f.channel.endpointContexts = contexts;
  const ctx = contexts.agentStatus();
  ctx.getAvailableModels = () => { entered.resolve(); return models.promise; };
  ctx.getContextUsageForChat = async () => null; ctx.getTokenUsageForChat = () => null;
  const metric = spyOn(metrics, "handleSystemMetricsRequest").mockImplementation(() => Response.json({}));
  restores.push(() => metric.mockRestore());
  const pending = f.channel.handleAgentStatus(new Request("https://fixture.invalid/agent/status?ui=1"));
  try {
    await entered.promise; live = createWebChannelIdentitySnapshot({ assistantName: "After" });
    models.resolve({ current: null });
    expect((await (await pending).json()).agent_name).toBe("After");
    expect(contexts.identity()).toBe(live);
  } finally { models.resolve({}); await pending; }
});
