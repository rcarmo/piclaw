import { afterEach, expect, spyOn, test } from "bun:test";
import { createWebChannelTestFixture } from "./helpers/web-channel-fixture.js";
import { handleContentPrimaryRoutes } from "../../../src/channels/web/http/dispatch-content.js";
import * as timeline from "../../../src/channels/web/timeline-service.js";
import type { ContentEndpointsContext } from "../../../src/channels/web/endpoints/content-endpoints.js";

let cleanup: (() => void) | undefined;
let restoreStore: (() => void) | undefined;
afterEach(() => { restoreStore?.(); restoreStore = undefined; cleanup?.(); cleanup = undefined; });

async function fixture() {
  const f = await createWebChannelTestFixture({ workspace: "temp" });
  cleanup = f.cleanup;
  // Timeline must not consult either policy-free stage; other endpoints keep
  // their existing collaborators. This is a dependency assertion, not a mock API.
  Object.defineProperty(f.channel, "httpSurfaceService", {
    get() { throw Error("Timeline still enters retired HTTP surface"); },
  });
  Object.defineProperty(Reflect.get(f.channel, "endpointFacade"), "handleTimeline", {
    configurable: true,
    get() { throw Error("Timeline still enters retired endpoint facade"); },
  });
  return f;
}

function context(): ContentEndpointsContext {
  return {
    defaultChatJid: "web:default",
    json: (body, status = 200) => Response.json(body, { status }),
    getBuffer: () => undefined,
    getIdentity: () => ({ assistantName: "Injected", userName: "Reader" }),
  };
}

test("public timeline uses its typed content context without the HTTP surface or endpoint facade", async () => {
  const f = await fixture();
  const ctx = context();
  f.channel.endpointContexts.content = () => ctx;
  const store = spyOn(timeline, "getTimelineResponse").mockImplementation((chat, limit, before, identity) => {
    expect([chat, limit, before]).toEqual(["web:branch", 5, 17]);
    expect(identity).toMatchObject({ assistant_name: "Injected", user_name: "Reader" });
    return { status: 206, body: { posts: [{ id: 8 }], limit, has_more: true, identity } };
  });
  restoreStore = () => store.mockRestore();
  const response = f.channel.handleTimeline(5, 17, "web:branch");
  expect(response).toBeInstanceOf(Response); // Public synchronous signature remains.
  expect(response.status).toBe(206);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.headers.get("server-timing")).toContain("timeline;dur=");
  expect(await response.json()).toMatchObject({ posts: [{ id: 8 }], limit: 5, has_more: true });
  expect(store).toHaveBeenCalledTimes(1);
});

test("dispatcher timeline guards/defaults and live identity reach the injected store directly", async () => {
  const f = await fixture();
  let assistantName = "First";
  f.channel.endpointContexts.content = () => ({ ...context(), getIdentity: () => ({ assistantName }) });
  const calls: unknown[][] = [];
  const store = spyOn(timeline, "getTimelineResponse").mockImplementation((chat, limit, before, identity) => {
    calls.push([chat, limit, before, identity?.assistant_name]);
    return { status: 200, body: { posts: [], limit, has_more: false, identity } };
  });
  restoreStore = () => store.mockRestore();
  for (const [query, expected] of [
    ["?limit=999&before=17&chat_jid=%20web%3Abranch%20", ["web:branch", 100, 17, "First"]],
    ["?limit=bad&before=bad", ["web:default", 10, undefined, "Later"]],
    ["?limit=0&before=0&chat_jid=%20%20", ["web:default", 1, 0, "Later"]],
  ] as const) {
    const request = new Request("https://fixture.invalid/timeline" + query);
    const response = await handleContentPrimaryRoutes(f.channel, request, "/timeline", new URL(request.url));
    expect(response?.status).toBe(200);
    expect(response?.headers.get("server-timing")).toContain("timeline;dur=");
    expect(calls.at(-1)).toEqual([...expected]);
    assistantName = "Later";
  }
  expect(store).toHaveBeenCalledTimes(3);
});

test("timeline store failure propagates without a forwarding fallback or response replacement", async () => {
  const f = await fixture();
  const failure = Error("Exact timeline store failure");
  const store = spyOn(timeline, "getTimelineResponse").mockImplementation(() => { throw failure; });
  restoreStore = () => store.mockRestore();
  expect(() => f.channel.handleTimeline(3, undefined, "web:branch")).toThrow(failure);
  expect(store).toHaveBeenCalledTimes(1);
});

test("request authentication still rejects timeline before any store observation", async () => {
  const f = await fixture();
  const auth = spyOn(f.channel.authGateway, "isAuthEnabled").mockReturnValue(true);
  const authenticated = spyOn(f.channel.authGateway, "isAuthenticated").mockReturnValue(false);
  const store = spyOn(timeline, "getTimelineResponse").mockImplementation(() => { throw Error("Unauthorised store access"); });
  restoreStore = () => store.mockRestore();
  try {
    const before = f.db.getDb().serialize();
    const response = await f.channel.requestRouter.handle(new Request("https://fixture.invalid/timeline?chat_jid=web%3Aforeign"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("server-timing")).toContain("app;dur=");
    expect(store).not.toHaveBeenCalled();
    expect(f.db.getDb().serialize()).toEqual(before);
  } finally { auth.mockRestore(); authenticated.mockRestore(); }
});

test("dispatcher-to-handler timeline keeps rowid pagination and foreign-chat isolation in an isolated store", async () => {
  const f = await fixture();
  const chat = "web:direct-" + crypto.randomUUID();
  const foreign = chat + ":foreign";
  const ids: number[] = [];
  for (const target of [chat, foreign]) f.db.storeChatMetadata(target, "2026-01-01T00:00:00Z");
  for (let i = 0; i < 5; i++) {
    for (const target of [chat, foreign]) {
      const id = f.db.storeMessage({ id: crypto.randomUUID(), chat_jid: target, sender: "user", sender_name: "Reader",
        content: `row ${i}`, timestamp: `2026-01-01T00:00:0${4 - i}.000Z`, is_from_me: false, is_bot_message: false });
      if (target === chat) ids.push(id);
    }
  }
  async function page(before?: number) {
    const request = new Request(`https://fixture.invalid/timeline?limit=2&chat_jid=${encodeURIComponent(chat)}${before === undefined ? "" : `&before=${before}`}`);
    const response = await handleContentPrimaryRoutes(f.channel, request, "/timeline", new URL(request.url));
    expect(response?.status).toBe(200);
    const body = await response!.json();
    expect(body.posts.every((post: { chat_jid: string }) => post.chat_jid === chat)).toBe(true);
    return body;
  }
  const latest = await page();
  expect(latest.posts.map((post: { id: number }) => post.id)).toEqual(ids.slice(-2));
  expect(latest.has_more).toBe(true);
  const previous = await page(latest.posts[0].id);
  expect(previous.posts.map((post: { id: number }) => post.id)).toEqual(ids.slice(1, 3));
  expect(previous.has_more).toBe(true);
  const first = await page(previous.posts[0].id);
  expect(first.posts.map((post: { id: number }) => post.id)).toEqual(ids.slice(0, 1));
  expect(first.has_more).toBe(false);
});
