import { afterEach, expect, spyOn, test } from "bun:test";
import { createWebChannelTestFixture } from "./helpers/web-channel-fixture.js";

let cleanup: (() => void) | undefined;
const restores: (() => void)[] = [];
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
  cleanup?.(); cleanup = undefined;
});

async function fixture() {
  const f = await createWebChannelTestFixture({ workspace: "temp" });
  cleanup = f.cleanup;
  Object.defineProperty(f.channel, "httpSurfaceService", {
    get() { throw Error("Retired HTTP forwarding service was accessed"); },
  });
  Object.defineProperty(f.channel, "endpointFacade", { get() { throw Error("Retired endpoint facade was accessed"); } });
  return { ...f, ctx: f.channel.endpointContexts.agentStatus() };
}

function expectHttp(response: Response, metric: string) {
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.headers.get("server-timing")).toContain(metric + ";dur=");
  expect(response.headers.get("server-timing")).toContain("app;dur=");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("x-request-id")).toBeString();
}

test("model reads bypass retired forwarding stages and preserve the backend catalogue and price provenance", async () => {
  const f = await fixture(), calls: string[] = [];
  const payload = { models: [{ id: "synthetic/free", cost: { input: 0, output: 0 } }],
    current_model: "synthetic/free", oobe: { custom: "kept" }, reported_provider_cost: null };
  f.ctx.getAvailableModels = async chat => { calls.push(chat); return payload; };
  f.ctx.getProviderReadyCompletedForInstance = () => true;
  const response = await f.channel.handleRequest(new Request("https://fixture.invalid/agent/models?chat_jid=%20web%3Abranch%20"));
  expectHttp(response, "agent_models");
  expect(await response.json()).toEqual({ ...payload, oobe: { custom: "kept", provider_ready_completed_instance: true } });
  expect(calls).toEqual(["web:branch"]);
});

test("model query defaults and an authoritative empty catalogue never revive a legacy registry", async () => {
  const f = await fixture(), calls: string[] = [];
  f.ctx.getAvailableModels = async chat => { calls.push(chat); return { models: [], current_model: null }; };
  f.ctx.getProviderReadyCompletedForInstance = () => false;
  for (const query of ["", "?chat_jid=%20%20", "?chat_jid=%E0%A4%A"]) {
    const response = await f.channel.handleRequest(new Request("https://fixture.invalid/agent/models" + query));
    expectHttp(response, "agent_models");
    expect(await response.json()).toEqual({ models: [], current_model: null, oobe: { provider_ready_completed_instance: false } });
  }
  expect(calls.slice(0, 2)).toEqual(["web:default", "web:default"]);
  expect(calls[2]).toBe(new URL("https://fixture.invalid/?chat_jid=%E0%A4%A").searchParams.get("chat_jid")!);
});

test("context HTTP reads preserve unknown and measured zero without session construction or implicit tree reads", async () => {
  const f = await fixture(), chats: string[] = [];
  f.ctx.getTokenUsageForChat = () => null;
  f.ctx.getSessionTreeSummaryForChat = async () => { throw Error("Tree was not requested"); };
  f.ctx.getContextUsageForChat = async chat => { chats.push(chat); return null; };
  let response = await f.channel.handleRequest(new Request("https://fixture.invalid/agent/context?chat_jid=web%3Abranch"));
  expectHttp(response, "agent_context");
  expect(await response.json()).toMatchObject({ tokens: null, contextWindow: null, percent: null, sessionGeneration: null, contextUpdate: "replace" });
  f.ctx.getContextUsageForChat = async chat => { chats.push(chat); return { tokens: 0, contextWindow: 1000, percent: 0, sessionGeneration: "native:branch" }; };
  response = await f.channel.handleRequest(new Request("https://fixture.invalid/agent/context?chat_jid=web%3Abranch"));
  expectHttp(response, "agent_context");
  expect(await response.json()).toMatchObject({ tokens: 0, contextWindow: 1000, percent: 0, sessionGeneration: "native:branch" });
  expect(chats).toEqual(["web:branch", "web:branch"]);
});

test("explicit tree reads retain the requested chat and asynchronous summary", async () => {
  const f = await fixture(), calls: string[] = [];
  f.ctx.getContextUsageForChat = async () => null;
  f.ctx.getTokenUsageForChat = () => null;
  f.ctx.getSessionTreeSummaryForChat = async chat => { calls.push(chat); return { leafId: "native-head", total: 2 }; };
  const response = await f.channel.handleRequest(new Request("https://fixture.invalid/agent/context?include_tree=1&chat_jid=web%3Abranch"));
  expectHttp(response, "agent_context");
  expect((await response.json()).sessionTree).toEqual({ leafId: "native-head", total: 2 });
  expect(calls).toEqual(["web:branch"]);
});

test("authentication denies model/context requests before any backend observation", async () => {
  const f = await fixture();
  const enabled = spyOn(f.channel.authGateway, "isAuthEnabled").mockReturnValue(true);
  const authenticated = spyOn(f.channel.authGateway, "isAuthenticated").mockReturnValue(false);
  restores.push(() => enabled.mockRestore(), () => authenticated.mockRestore());
  f.ctx.getAvailableModels = async () => { throw Error("Unauthorised catalogue read"); };
  f.ctx.getContextUsageForChat = async () => { throw Error("Unauthorised context read"); };
  const before = f.db.getDb().serialize();
  for (const path of ["models", "context"]) {
    const response = await f.channel.handleRequest(new Request("https://fixture.invalid/agent/" + path));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  }
  expect(f.db.getDb().serialize()).toEqual(before);
});

test("backend read failures propagate without a legacy fallback or replacement response", async () => {
  const f = await fixture(), failure = Error("Exact native read failure");
  f.ctx.getAvailableModels = async () => { throw failure; };
  f.ctx.getContextUsageForChat = async () => { throw failure; };
  f.ctx.getTokenUsageForChat = () => null;
  await expect(f.channel.handleRequest(new Request("https://fixture.invalid/agent/models"))).rejects.toBe(failure);
  await expect(f.channel.handleRequest(new Request("https://fixture.invalid/agent/context"))).rejects.toBe(failure);
});

test("sealing rejects fresh reads but joins the actual admitted callback after client abort", async () => {
  const f = await fixture(), entered = Promise.withResolvers<void>(), result = Promise.withResolvers<unknown>();
  let calls = 0;
  f.ctx.getAvailableModels = () => { calls++; entered.resolve(); return result.promise; };
  const client = new AbortController();
  const request = f.channel.handleRequest(new Request("https://fixture.invalid/agent/models", { signal: client.signal }));
  await entered.promise;
  client.abort();
  let drained = false;
  const drain = f.channel.sealAdmissions().then(() => { drained = true; });
  await Promise.resolve();
  expect(drained).toBe(false);
  const refused = await f.channel.handleRequest(new Request("https://fixture.invalid/agent/context"));
  expect(refused.status).toBe(503); expect(calls).toBe(1);
  result.resolve({ models: [] });
  expect((await request).status).toBe(200);
  await drain; expect(drained).toBe(true);
});
