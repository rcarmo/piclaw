import { afterEach, expect, spyOn, test } from "bun:test";
import { createWebChannelTestFixture } from "./helpers/web-channel-fixture.js";
import * as posts from "../../../src/channels/web/handlers/posts.js";
import * as mutations from "../../../src/channels/web/post-mutations.js";
import * as metrics from "../../../src/channels/web/agent/system-metrics.js";
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
  const f = await fixture(), timestamp = new Date().toISOString();
  for (const chat of ["web:branch", "web:default"]) f.db.storeChatMetadata(chat, timestamp, "Fixture");
  const seed = (id: string, chat_jid: string, thread_id?: number) => f.db.storeMessage({ id, chat_jid, thread_id,
    sender: "user", sender_name: "Fixture", content: id, timestamp, is_from_me: false, is_bot_message: false })!;
  const parent = seed("delete-root", "web:branch"), child = seed("delete-child", "web:branch", parent), defaultRow = seed("delete-default", "web:default");
  let response = await f.channel.handleDeletePost(new Request(`https://fixture.invalid/post/${parent}?chat_jid=%20web%3Abranch%20`), parent, true);
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ deleted: 2, ids: [parent, child] });
  expect(f.events).toEqual([{ type: "interaction_deleted", data: { chat_jid: "web:branch", ids: [parent, child] } }]);
  expect(f.db.getDb().query("SELECT rowid FROM messages WHERE chat_jid='web:branch'").all()).toEqual([]);
  response = await f.channel.handleDeletePost(new Request(`https://fixture.invalid/post/${parent}?chat_jid=web:branch`), parent);
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ deleted: 0, ids: [] }); expect(f.events).toHaveLength(1);
  response = await f.channel.handleDeletePost(new Request("https://fixture.invalid/post/7"), null);
  expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: "Post not found" }); expect(f.events).toHaveLength(1);
  response = await f.channel.handleDeletePost(new Request(`https://fixture.invalid/post/${defaultRow}`), defaultRow);
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ deleted: 1, ids: [defaultRow] });
  expect(f.events.at(-1)).toEqual({ type: "interaction_deleted", data: { chat_jid: "web:default", ids: [defaultRow] } });
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

test('post mutation entry calls the original channel and leaf directly without allocating a context', async () => {
  const f = await fixture(), req = new Request('https://fixture.invalid/post/8', { method: 'PATCH' }), result = new Response('original', { status: 202 });
  Object.defineProperty(f.channel.endpointContexts, 'postMutations', { get() { throw Error('Retired post context was accessed'); } });
  for (const [leaf, invoke, args] of [
    ['handleUpdatePostRequest', () => f.channel.handleUpdatePost(req, 8), [f.channel, req, 8, 'web:default']],
    ['handleUpdatePostAnnotationsRequest', () => f.channel.handleUpdatePostAnnotations(req, 8), [f.channel, req, 8, 'web:default']],
    ['handleInternalPostRequest', () => f.channel.handleInternalPost(req), [f.channel, req, 'web:default']],
  ] as const) {
    const calls: unknown[][] = [];
    const hook = spyOn(mutations, leaf).mockImplementation((...input: any[]) => { calls.push(input); return Promise.resolve(result); });
    restores.push(() => hook.mockRestore());
    expect(await invoke()).toBe(result); expect(calls).toEqual([args]);
    hook.mockRestore();
  }
});
