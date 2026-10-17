import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withTempWorkspaceEnv } from "../../helpers.js";
import { initDatabase, getDb, closeDatabase } from "../../../src/db/connection.js";
import { createUser, getUser, updateUser } from "../../../src/db/users.js";
import { ensureChatBranch } from "../../../src/db/chat-branches.js";
import { storeChatMetadata, storeMessage } from "../../../src/db/messages.js";
import { assignRootOwner, provisionUserHome } from "../../../src/db/session-ownership.js";
import { createWebSession, getWebSession, revokeUserWebSessions } from "../../../src/db/web-sessions.js";
import { WebAuthGateway } from "../../../src/channels/web/auth/auth-gateway.js";
import { TotpFailureTracker } from "../../../src/channels/web/auth/totp-failure-tracker.js";
import { WebauthnChallengeTracker } from "../../../src/channels/web/auth/webauthn-challenges.js";
import { RequestRouterService } from "../../../src/channels/web/request-router-service.js";
import { installWebChannelPrototype } from "../../../src/channels/web/core/web-channel-prototype.js";
import { WebSessionBroadcastService } from "../../../src/channels/web/sse/session-broadcast-service.js";
import { SseHub } from "../../../src/channels/web/sse/sse-hub.js";
import { revalidateSseClient } from "../../../src/channels/web/sse/sse.js";
import { getSearchResponse } from "../../../src/channels/web/timeline-service.js";
import { listStoredWebPushSubscriptions } from "../../../src/channels/web/push/web-push-store.js";
import { WebNotificationPresenceService } from "../../../src/channels/web/push/web-notification-presence-service.js";
import { handleFamilyWebPush } from "../../../src/channels/web/push/web-push-routes.js";
import { renameOwnedSessionHandle } from "../../../src/db/session-handles.js";

const json = (value: unknown, status = 200) => Response.json(value, { status });
let alice: string, bob: string, gateway: WebAuthGateway, router: RequestRouterService, hub: SseHub;
let channel: any;
let statusByChat: Map<string, Record<string, unknown>>;
let revokeDuringStatusRead: boolean;
function request(path: string, token: string | null = "alice-token", method = "GET") {
  return new Request(`https://family.local${path}`, { method, headers: {
    ...(token ? { cookie: `piclaw_session=${token}` } : {}),
    origin: "https://family.local", "x-user-id": bob, "x-piclaw-internal-secret": "internal-test",
  } });
}
function registerChat(jid: string, root = jid, parent?: string) {
  storeChatMetadata(jid, new Date().toISOString(), jid);
  return ensureChatBranch({ chat_jid: jid, root_chat_jid: root, parent_branch_id: parent });
}
function seedMessage(jid: string, content: string) {
  storeMessage({ id: `msg-${jid}`, chat_jid: jid, sender: "user", sender_name: jid, content,
    timestamp: new Date().toISOString(), is_from_me: false, is_bot_message: false });
}
beforeEach(() => {
  closeDatabase();
  initDatabase();
  const db = getDb();
  alice = createUser(db, { username: "alice", displayName: "Alice", role: "admin" }).id;
  bob = createUser(db, { username: "bob", displayName: "Bob" }).id;
  const a = registerChat("web:alice"); registerChat("web:bob");
  registerChat("web:bob-looking-fork", "web:alice", a.branch_id);
  registerChat("web:alice-other"); registerChat("web:unowned");
  provisionUserHome(db, alice, "web:alice"); provisionUserHome(db, bob, "web:bob");
  assignRootOwner(db, "web:alice-other", alice);
  updateUser(db, alice, { enabled: true }); updateUser(db, bob, { enabled: true });
  createWebSession("alice-token", alice, 3600, "totp"); createWebSession("bob-token", bob, 3600, "passkey");
  for (const jid of ["web:alice", "web:bob", "web:bob-looking-fork", "web:alice-other", "web:unowned"]) seedMessage(jid, `needle #test ${jid}`);
  gateway = new WebAuthGateway({ accessMode: "family-shared", passkeyMode: "", totpSecret: "", internalSecret: "internal-test", sessionTtlSeconds: 3600, hasTls: true }, {
    json, challenges: new WebauthnChallengeTracker(), failureTracker: new TotpFailureTracker(),
  });
  hub = new SseHub();
  statusByChat = new Map(); revokeDuringStatusRead = false;
  channel = {
    authGateway: gateway, json,
    clampInt: (v: string | null, fallback: number, min: number, max: number) => v && Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Math.trunc(Number(v)))) : fallback,
    parseOptionalInt: (v: string | null) => v && Number.isSafeInteger(Number(v)) ? Number(v) : null,
    handleSse: (req: Request, authority: any) => hub.handleRequest(req, authority),
    serveStatic: async (path: string) => new Response(`static:${path}`),
    endpointContexts: {
      auth: () => ({ serveStatic: async (path: string) => new Response(`auth:${path}`) }),
      agentStatus: () => ({
        defaultChatJid: 'web:default', json,
        getAgentStatus: (chatJid: string) => statusByChat.get(chatJid) ?? null,
        getExtensionWorkingState: () => ({ message: 'private extension state' }),
        recoverStaleInflightRun: () => { throw new Error('family status read must not mutate recovery state'); },
        getBuffer: (_turnId: string, panel: 'thought' | 'draft') => {
          if (revokeDuringStatusRead) revokeUserWebSessions(alice);
          return { text: `${panel} preview`, totalLines: panel === 'thought' ? 2 : 1, updatedAt: 1 };
        },
        getContextUsageForChat: async () => ({ tokens: 1200, contextWindow: 120000, percent: 1, sessionGeneration: 'session-owned' }),
        getTokenUsageForChat: () => ({
          latest: { input_tokens: 100, output_tokens: 20, reasoning_tokens: 5, cache_read_tokens: 50, cache_write_tokens: 0, total_tokens: 175, cost_total: 0.01, runs: 1, model: 'model', provider: 'test' },
          totals: { input_tokens: 100, output_tokens: 20, reasoning_tokens: 5, cache_read_tokens: 50, cache_write_tokens: 0, total_tokens: 175, cost_total: 0.01, runs: 1 },
        }),
        getAvailableModels: async () => ({ models: [] }), getProviderReadyCompletedForInstance: () => false,
      }),
    },
    handleTimeline: () => { throw Error("legacy fallback entered"); },
  };
  router = new RequestRouterService(channel, "family-shared");
});
afterEach(() => { hub.closeAll(); closeDatabase(); });

test("family route binds missing target to live home and preserves owned forks, not JID prefixes", async () => {
  for (const path of ["/timeline", "/hashtag/test"]) {
    const response = await router.handle(request(path));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
    expect(response.headers.get("x-request-id")).toBeTruthy();
    const body = await response.json();
    expect(body.posts.map((row: any) => row.chat_jid)).toEqual(["web:alice"]);
    if (path === "/timeline") expect(body.identity).toEqual({ user_name: "Alice" });
  }
  const response = await router.handle(request("/timeline?chat_jid=web:bob-looking-fork"));
  expect((await response.json()).posts[0].chat_jid).toBe("web:bob-looking-fork");
  provisionUserHome(getDb(), alice, "web:alice-other");
  expect((await (await router.handle(request("/timeline"))).json()).posts[0].chat_jid).toBe("web:alice-other");
});

test("foreign, unknown, blank, duplicate and unowned targets all deny without redirects", async () => {
  for (const route of ["/timeline", "/hashtag/test", "/thread/1", "/search?q=needle", "/sse/stream"]) {
    for (const query of ["chat_jid=web:bob", "chat_jid=missing", "chat_jid=", "chat_jid=%20", "chat_jid=web:unowned", "chat_jid=web:alice&chat_jid=web:bob", "root_chat_jid=web:bob"]) {
      const response = await router.handle(request(`${route}${route.includes("?") ? "&" : "?"}${query}`));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Session access denied." });
      expect(response.headers.get("location")).toBeNull();
    }
  }
  expect(hub.clients.size).toBe(0);
});

test("all/root search filters in SQL before pagination and never includes foreign or unowned chats", async () => {
  for (const [scope, expected] of [
    ["current", ["web:alice"]], ["root", ["web:alice", "web:bob-looking-fork"]],
    ["all", ["web:alice", "web:alice-other", "web:bob-looking-fork"]],
  ] as const) {
    const response = await router.handle(request(`/search?q=needle&scope=${scope}`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.results.map((row: any) => row.chat_jid).sort()).toEqual([...expected].sort());
    expect(body.scope).toBe(scope);
  }
  const page = await (await router.handle(request("/search?q=needle&scope=all&offset=1&limit=1"))).json();
  expect(page.results).toHaveLength(1);
  expect(page.results[0].chat_jid).not.toBe("web:bob");
  expect((getSearchResponse("web:alice", "needle", 10, 0, "all", null, null, []).body as any).results).toEqual([]);
  expect((await router.handle(request("/search?q=needle&scope=invalid"))).status).toBe(403);
});

test("thread ID cannot select a foreign message even with an owned chat", async () => {
  const db = getDb();
  const a = (db.query("SELECT rowid FROM messages WHERE chat_jid='web:alice'").get() as any).rowid;
  const b = (db.query("SELECT rowid FROM messages WHERE chat_jid='web:bob'").get() as any).rowid;
  expect((await router.handle(request(`/thread/${a}`))).status).toBe(200);
  const foreign = await router.handle(request(`/thread/${b}`));
  const missing = await router.handle(request("/thread/999999"));
  expect(foreign.status).toBe(404); expect(await foreign.text()).toBe(await missing.text());
});

test("terminal gate denies early add-ons, widget state, indirect resources, controls and new routes", async () => {
  const paths = ["/api/addons/test", "/api/state", "/api/state/events", "/agent/addons/api/test/read", "/agent/active-chats", "/agent/keychain", "/workspace/raw", "/export/timeline", "/internal/export/timeline", "/terminal/session", "/vnc/session", "/recordings", "/avatar/user", "/avatar/agent", "/manifest.json", "/docs/configuration.md", "/future-route"];
  for (const path of paths) {
    expect((await router.handle(request(path))).status).toBe(403);
    const anonymous = await router.handle(request(path, null));
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("location")).toBeNull();
    expect(anonymous.headers.get("cache-control")).toBe("private, no-store");
  }
  for (const path of ["/post", "/internal/post", "/auth/e2e/bootstrap", "/auth/webauthn/register/start", "/sse/stream", "/static/common/dist/login.bundle.js"]) {
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) expect((await router.handle(request(path, "alice-token", method))).status).toBe(403);
  }
  expect((await router.handle(request("/timeline", "alice-token", "HEAD"))).status).toBe(403);
});

test('family status/context expose only an owned standard-pane snapshot and revalidate after reads', async () => {
  statusByChat.set('web:alice', {
    type: 'tool_status', turn_id: 'turn-owned', tool_name: 'read', tool_args: { path: '/workspace/owned.txt' },
    status: 'Working...', output_preview: 'line one\nline two', output_total_lines: 2,
    started_at: '2026-09-08T10:00:00.000Z', retry_at: '2026-09-08T10:00:05.000Z', runtime_generation: 'internal',
    status_hints: [{ key: 'extension', icon_svg: '<svg>extension</svg>', label: 'extension callback' }],
  });
  statusByChat.set('web:bob', { type: 'tool_call', turn_id: 'turn-foreign', title: 'FOREIGN_STATUS' });

  const statusResponse = await router.handle(request('/agent/status?chat_jid=web:alice'));
  expect(statusResponse.status).toBe(200);
  expect(statusResponse.headers.get('cache-control')).toBe('private, no-store');
  const status = await statusResponse.json();
  expect(status).toMatchObject({
    status: 'active', state: 'active', chat_jid: 'web:alice',
    data: { type: 'tool_status', turn_id: 'turn-owned', tool_name: 'read', output_total_lines: 2 },
    thought: { text: 'thought preview', totalLines: 2 },
    draft: { text: 'draft preview', totalLines: 1 },
    extension_working: null,
  });
  const statusText = JSON.stringify(status);
  for (const omitted of ['runtime_generation', 'status_hints', 'extension callback', 'addon_api', 'mcp_startup', 'private extension state', 'FOREIGN_STATUS']) {
    expect(statusText).not.toContain(omitted);
  }

  const contextResponse = await router.handle(request('/agent/context?chat_jid=web:alice'));
  expect(contextResponse.status).toBe(200);
  expect(await contextResponse.json()).toMatchObject({
    tokens: 1200, contextWindow: 120000, percent: 1, sessionGeneration: 'session-owned',
    cacheUsage: { latest: { totalTokens: 175, reasoningTokens: 5, provider: 'test' }, totals: { totalTokens: 175, runs: 1 } },
  });

  for (const path of [
    '/agent/status?chat_jid=web:bob', '/agent/context?chat_jid=web:bob',
    '/agent/status?chat_jid=', '/agent/status?chat_jid=web:alice&chat_jid=web:bob',
    '/agent/context?chat_jid=web:alice&owner_user_id=' + bob,
  ]) expect((await router.handle(request(path))).status).toBe(403);
  for (const path of ['/agent/status?chat_jid=web:alice', '/agent/context?chat_jid=web:alice']) {
    expect((await router.handle(request(path, 'alice-token', 'POST'))).status).toBe(403);
  }

  revokeDuringStatusRead = true;
  expect((await router.handle(request('/agent/status?chat_jid=web:alice'))).status).toBe(403);
});

test("family models and branches project public context fields without changing legacy JSON", async () => {
  getDb().query("UPDATE chat_branches SET handle_owner_id=? WHERE chat_jid='web:alice'").run(alice);
  const contexts = [
    { tokens: null, contextWindow: 200000, percent: null, sessionGeneration: "native-session", tokensAreAuthoritative: true, futurePrivateField: "private" },
    { tokens: 1200, contextWindow: 120000, percent: 1 },
    { tokens: undefined, contextWindow: 120000, percent: undefined, sessionGeneration: undefined },
    null,
  ];
  for (const context of contexts) {
    channel.agentPool = {
      getAvailableModels: async () => ({ current: "test/model" }),
      getContextUsageForChat: async () => context,
    };
    const expected = context === null ? null : JSON.parse(JSON.stringify({
      tokens: context.tokens, contextWindow: context.contextWindow,
      percent: context.percent, sessionGeneration: context.sessionGeneration,
    }));
    for (const path of ["/agent/models", "/agent/branches"]) {
      const response = await router.handle(request(path));
      expect(response.status).toBe(200);
      const body = await response.json();
      const usages = path === "/agent/models" ? [body.context_usage] : body.branches.map((branch: any) => branch.context_usage);
      expect(usages.length).toBeGreaterThan(0);
      for (const usage of usages) expect(usage).toEqual(expected);
      expect(JSON.stringify(body)).not.toMatch(/tokensAreAuthoritative|futurePrivateField/);
    }
  }
});

test("family compose catalogue exposes only permitted controls and owner-scoped mentions", async () => {
  const fork = registerChat("web:alice-compose-fork", "web:alice", (getDb().query("SELECT branch_id FROM chat_branches WHERE chat_jid='web:alice'").get() as any).branch_id);
  getDb().query("UPDATE chat_branches SET handle_owner_id=? WHERE branch_id=?").run(alice, fork.branch_id);
  renameOwnedSessionHandle(getDb(), gateway.getPrincipal(request("/auth/me"))!, "web:alice-compose-fork", "compose-helper");
  const response = await router.handle(request("/agent/commands?chat_jid=web:alice"));
  expect(response.status).toBe(200);
  const payload = await response.json();
  expect(payload.commands.map((entry: any) => entry.name).sort()).toEqual(["/abort", "/model", "/queue", "/queue-all", "/steer", "/thinking"]);
  expect(payload.mentions).toEqual([expect.objectContaining({ chat_jid: "web:alice-compose-fork", agent_name: "compose-helper" })]);
  expect(JSON.stringify(payload)).not.toContain("web:bob");
  expect((await router.handle(request("/agent/commands?chat_jid=web:bob"))).status).toBe(403);
  expect((await router.handle(request("/agent/commands?chat_jid=web:alice&owner_user_id=" + bob))).status).toBe(403);
  expect((await router.handle(request("/agent/commands?chat_jid=web:alice", "alice-token", "POST"))).status).toBe(403);
});

test("public assets are narrow and anonymous APIs use JSON 401, not redirects", async () => {
  for (const path of ["/static/common/dist/login.bundle.js", "/static/common/dist/login.bundle.css"]) {
    expect((await router.handle(request(path, null))).status).toBe(200);
  }
  for (const path of ["/timeline", "/search?q=needle", "/sse/stream", "/static/common/dist/login.bundle.js.map", "/static/common/fonts/test.woff2"]) {
    expect((await router.handle(request(path, null))).status).toBe(401);
  }
  expect((await router.handle(request("/"))).status).toBe(200);
  expect(await (await router.handle(request("/", null))).text()).toBe("auth:login.html");
  expect(await (await router.handle(request("/login", null))).text()).toBe("auth:login.html");
  expect((await router.handle(request("/auth/me"))).status).toBe(200);
  expect((await router.handle(request("/auth/me", null))).status).toBe(401);
});

test("new requests reject revoked/disabled accounts and isolated configuration never falls through", async () => {
  revokeUserWebSessions(alice);
  expect((await router.handle(request("/timeline"))).status).toBe(401);
  expect((await router.handle(request("/timeline", "bob-token"))).status).toBe(200);
  updateUser(getDb(), bob, { enabled: false });
  expect((await router.handle(request("/timeline", "bob-token"))).status).toBe(401);
  const isolated = new RequestRouterService(channel, "isolated-containers");
  expect((await isolated.handle(request("/api/addons/test"))).status).toBe(503);
  channel.authGateway = { isAuthEnabled: () => false };
  expect((await router.handle(request("/timeline"))).status).toBe(503);
});

test("legacy single-user routing and unscoped SSE behaviour remain unchanged", async () => {
  const legacy = new RequestRouterService({ ...channel, handleTimeline: (_limit: number, _before: number, jid: string) => json({ legacy: jid }) }, "single-user");
  const response = await legacy.handle(request("/timeline?chat_jid=web:bob"));
  expect(await response.json()).toEqual({ legacy: "web:bob" });
  expect(response.headers.get("cache-control")).not.toBe("private, no-store");
  const stream = hub.handleRequest(request("/sse/stream"));
  const reader = stream.body!.getReader(); await reader.read();
  hub.broadcast("unknown_global", { legacy: true });
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('"legacy":true');
  await reader.cancel(); expect(hub.clients.size).toBe(0);
});

test("prototype to HTTP surface to broadcast service preserves subscription authority", async () => {
  class FixtureChannel {}
  installWebChannelPrototype(FixtureChannel.prototype as any);
  const fixture = new FixtureChannel() as any;
  fixture.sessionBroadcast = new WebSessionBroadcastService({ setProviderUsageRefreshListener: () => {} } as any, {
    sse: hub, bindSessionBinder: () => {}, uiBridge: {} as any,
  });
  let enabled = true;
  const authority = { chatJid: "web:alice", isAuthorised: () => enabled };
  const stream = fixture.handleSse(request("/sse/stream?chat_jid=web:bob"), authority) as Response;
  const reader = stream.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('"chat_jid":"web:alice"');
  expect([...hub.clients][0]?.authorisation).toBe(authority);
  enabled = false;
  hub.broadcast("new_post", { chat_jid: "web:alice", secret: "revoked" });
  expect((await reader.read()).done).toBe(true);
  expect(hub.handleRequest(request("/sse/stream"), authority).status).toBe(403);
  expect(hub.clients.size).toBe(0);
});

test("SSE receives only approved own-chat events, never global or unknown payloads", async () => {
  const response = await router.handle(request("/sse/stream"));
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  const connected = new TextDecoder().decode((await reader.read()).value);
  expect(connected).toContain('"chat_jid":"web:alice"');
  expect(connected).not.toContain("ui_theme");
  hub.broadcast("new_post", { chat_jid: "web:bob", secret: "foreign" });
  hub.broadcast("unknown_global", { secret: "global" });
  hub.broadcast("unknown_scoped", { chat_jid: "web:alice", secret: "unknown" });
  hub.broadcast("new_post", { chat_jid: "web:alice", content: "mine" });
  const event = new TextDecoder().decode((await reader.read()).value);
  expect(event).toContain("mine"); expect(event).not.toMatch(/foreign|global|unknown/);
  revokeUserWebSessions(alice);
  hub.broadcast("new_post", { chat_jid: "web:alice", secret: "after logout" });
  expect((await reader.read()).done).toBe(true); expect(hub.clients.size).toBe(0);
});

test("stream revalidation closes on expiry, role/account change and invalidated parent chain", async () => {
  const mutations = [
    () => getDb().query("UPDATE web_sessions SET expires_at='invalid' WHERE user_id=?").run(alice),
    () => updateUser(getDb(), alice, { enabled: false }),
    () => updateUser(getDb(), alice, { role: "member" }),
    () => getDb().query("UPDATE chat_branches SET archived_at=? WHERE chat_jid='web:bob-looking-fork'").run(new Date().toISOString()),
    () => getDb().query("UPDATE chat_branches SET parent_branch_id='missing' WHERE chat_jid='web:bob-looking-fork'").run(),
  ];
  for (const mutate of mutations) {
    updateUser(getDb(), alice, { enabled: true, role: "admin" });
    createWebSession("alice-token", alice, 3600, "totp");
    const root = (getDb().query("SELECT branch_id FROM chat_branches WHERE chat_jid='web:alice'").get() as any).branch_id;
    getDb().query("UPDATE chat_branches SET archived_at=NULL,parent_branch_id=? WHERE chat_jid='web:bob-looking-fork'").run(root);
    const response = await router.handle(request("/sse/stream?chat_jid=web:bob-looking-fork"));
    const reader = response.body!.getReader(); await reader.read();
    const client = [...hub.clients][0]!;
    mutate();
    // This is also the production heartbeat's check; no event is required to revoke idle clients.
    expect(revalidateSseClient(hub, client)).toBe(false);
    expect((await reader.read()).done).toBe(true); expect(hub.clients.size).toBe(0);
  }
  expect(getUser(getDb(), bob)?.enabled).toBe(true);
});

test("family push routes bind subscription and presence to the live owner/login and owned chat", async () => {
  const pushDir = `${process.env.PICLAW_DATA}/family-push-test`, presence = new WebNotificationPresenceService();
  const originalHandle = channel.authGateway.getPrincipal.bind(channel.authGateway);
  const subscription = { endpoint: "https://push.example.test/alice", expirationTime: null, keys: { auth: "auth", p256dh: "key" } };
  const post = new Request("https://family.local/agent/push/subscription", { method: "POST", headers: {
    cookie: "piclaw_session=alice-token", origin: "https://family.local", "content-type": "application/json",
    "x-piclaw-account-id": alice, "x-piclaw-login-id": originalHandle(request("/auth/me"))!.authentication.sessionId!,
  }, body: JSON.stringify({ device_id: "device", subscription }) });
  const options = { baseDir: pushDir, database: getDb(), presenceService: presence, readMode: () => "family-shared" };
  const keyRequest = new Request("https://family.local/agent/push/vapid-public-key", { headers: post.headers });
  expect((await handleFamilyWebPush(channel, keyRequest, originalHandle(keyRequest)!, options)).status).toBe(200);
  expect((await handleFamilyWebPush(channel, post, originalHandle(post)!, options)).status).toBe(200);
  const stored = listStoredWebPushSubscriptions(pushDir, { ownerUserId: alice });
  expect(stored).toHaveLength(1); expect(stored[0]?.loginSessionId).toBe(originalHandle(post)!.authentication.sessionId);
  const foreignPresence = new Request("https://family.local/agent/push/presence", { method: "POST", headers: post.headers,
    body: JSON.stringify({ device_id: "device", client_id: "tab", chat_jid: "web:bob", visibility_state: "visible", has_focus: true }) });
  expect((await handleFamilyWebPush(channel, foreignPresence, originalHandle(foreignPresence)!, options)).status).toBe(403);
  const ownPresence = new Request("https://family.local/agent/push/presence", { method: "POST", headers: post.headers,
    body: JSON.stringify({ device_id: "device", client_id: "tab", chat_jid: "web:alice", visibility_state: "visible", has_focus: true }) });
  expect((await handleFamilyWebPush(channel, ownPresence, originalHandle(ownPresence)!, options)).status).toBe(200);
  expect(presence.list()[0]).toMatchObject({ ownerUserId: alice, chatJid: "web:alice" });
  const foreignDelete = new Request("https://family.local/agent/push/subscription", { method: "DELETE", headers: {
    ...Object.fromEntries(post.headers), cookie: "piclaw_session=bob-token", "x-piclaw-account-id": bob,
    "x-piclaw-login-id": originalHandle(request("/auth/me", "bob-token"))!.authentication.sessionId!,
  }, body: JSON.stringify({ device_id: "device", subscription }) });
  expect(await (await handleFamilyWebPush(channel, foreignDelete, originalHandle(foreignDelete)!, options)).json()).toEqual({ ok: true, removed: false });
  expect(listStoredWebPushSubscriptions(pushDir, { ownerUserId: alice })).toHaveLength(1);
  revokeUserWebSessions(alice);
  const staleDelete = new Request("https://family.local/agent/push/subscription", { method: "DELETE", headers: post.headers, body: JSON.stringify({ subscription }) });
  expect((await handleFamilyWebPush(channel, staleDelete, originalHandle(post)!, options)).status).toBe(403);
});

test("family push routes reject missing pins, selectors, methods and authority loss during a streamed body", async () => {
  const pushDir = `${process.env.PICLAW_DATA}/family-push-negative`, presence = new WebNotificationPresenceService(), actor = gateway.getPrincipal(request("/auth/me"))!;
  const options = { baseDir: pushDir, database: getDb(), presenceService: presence, readMode: () => "family-shared" };
  const payload = JSON.stringify({ device_id: "device", subscription: { endpoint: "https://push.example.test/a", keys: { auth: "auth", p256dh: "key" } } });
  const req = (path: string, method: string, body = payload, headers: Record<string, string> = {}) => new Request(`https://family.local${path}`, { method, headers: {
    cookie: "piclaw_session=alice-token", origin: "https://family.local", "content-type": "application/json",
    "x-piclaw-account-id": alice, "x-piclaw-login-id": actor.authentication.sessionId!, ...headers,
  }, ...(method === "GET" || method === "HEAD" ? {} : { body }) });
  for (const candidate of [req("/agent/push/subscription?owner=bob", "POST"), req("/agent/push/subscription", "PUT"),
    req("/agent/push/subscription", "POST", payload, { "x-piclaw-account-id": bob }),
    req("/agent/push/presence", "POST", JSON.stringify({ device_id: "device", client_id: "tab", chat_jid: "web:bob", visibility_state: "visible", has_focus: true }))]) {
    expect((await handleFamilyWebPush(channel, candidate, actor, options)).status).toBe(403);
  }
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new TextEncoder().encode(payload.slice(0, 10)));
    getDb().query("DELETE FROM web_sessions WHERE session_id=?").run(actor.authentication.sessionId);
    controller.enqueue(new TextEncoder().encode(payload.slice(10))); controller.close();
  } });
  const raced = new Request("https://family.local/agent/push/subscription", { method: "POST", headers: req("/", "POST").headers, body: stream, duplex: "half" } as RequestInit);
  expect((await handleFamilyWebPush(channel, raced, actor, options)).status).toBe(403);
  expect(listStoredWebPushSubscriptions(pushDir)).toEqual([]); expect(presence.list()).toEqual([]);
});

test("family dispatcher serves pinned push routes and a public notification worker", async () => {
  await withTempWorkspaceEnv("family-push-router-", {}, async workspace => {
    mkdirSync(join(workspace.workspace, ".piclaw"), { recursive: true });
    writeFileSync(join(workspace.workspace, ".piclaw", "config.json"), JSON.stringify({ domains: { access: { mode: "family-shared" } } }));
    const identity = gateway.getPrincipal(request("/auth/me"))!, pins = {
      "x-piclaw-account-id": alice, "x-piclaw-login-id": identity.authentication.sessionId!,
    };
    const direct = (path: string, token: string | null, headers: Record<string, string> = {}) => new Request(`https://family.local${path}`, { headers: {
      ...(token ? { cookie: `piclaw_session=${token}` } : {}), origin: "https://family.local", ...headers,
    } });
    expect((await router.handle(direct("/agent/push/vapid-public-key", "alice-token", pins))).status).toBe(200);
    expect((await router.handle(direct("/agent/push/vapid-public-key", "bob-token", pins))).status).toBe(409);
    expect((await router.handle(direct("/agent/push/vapid-public-key", null, pins))).status).toBe(401);
    expect((await router.handle(direct("/family-sw.js", null))).status).toBe(200);
  });
});

test("family status rejects operator-only UI snapshot query", async () => {
  const response = await router.handle(request('/agent/status?chat_jid=web%3Aalice&ui=1'));
  expect(response.status).toBe(403);
  expect(await response.text()).not.toContain('metrics');
});

test('picker pins bind to account/login and never cross ownership boundaries', async()=>{
  const events:Array<{type:string;payload:unknown}>=[];
  channel.broadcastEvent=(type:string,payload:unknown)=>events.push({type,payload});
  const call=(path:string,method='GET',body?:unknown,user=alice,token='alice-token')=>router.handle(new Request('https://family.local'+path,{method,headers:{cookie:`piclaw_session=${token}`,origin:'https://family.local','x-piclaw-account-id':user,'x-piclaw-login-id':getWebSession(token)!.session_id!,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));
  const a=await (await call('/agent/picker-pins')).json();
  expect(a.models).toEqual([]);
  expect((await call('/agent/picker-pins','POST',{action:'set',kind:'session',key:'web:bob',pinned:true})).status).toBe(403);
  const own=await call('/agent/picker-pins','POST',{action:'set',kind:'session',key:'web:alice',pinned:true});expect(own.status).toBe(200);expect((await own.json()).sessions).toEqual(['web:alice']);
  const bobPins=await (await call('/agent/picker-pins','GET',undefined,bob,'bob-token')).json();expect(bobPins.sessions).toEqual([]);expect(bobPins.scope).not.toBe(a.scope);
  const forged=await call('/agent/picker-pins','GET',undefined,bob,'alice-token');expect(forged.status).toBe(409);
  const unbound=await router.handle(request('/agent/picker-pins'));expect(unbound.status).toBe(409);
  const cross=await router.handle(new Request('https://family.local/agent/picker-pins',{method:'POST',headers:{cookie:'piclaw_session=alice-token',origin:'https://evil.invalid','x-piclaw-account-id':alice,'x-piclaw-login-id':getWebSession('alice-token')!.session_id!,'Content-Type':'application/json'},body:JSON.stringify({action:'set',kind:'model',key:'test/a',pinned:true})}));expect(cross.status).toBe(403);
  expect(events).toEqual([{type:'picker_pins_changed',payload:{user_id:alice}}]);
});

test('pin writes revalidate account after streamed body and reject oversized bodies',async()=>{
 const login=getWebSession('alice-token')!.session_id!;channel.broadcastEvent=()=>{throw Error('Must not broadcast');};
 const headers={cookie:'piclaw_session=alice-token',origin:'https://family.local','x-piclaw-account-id':alice,'x-piclaw-login-id':login,'Content-Type':'application/json'};
 const huge=await router.handle(new Request('https://family.local/agent/picker-pins',{method:'POST',headers,body:'x'.repeat(300001)}));expect(huge.status).toBe(400);
 const body=new ReadableStream({pull(controller){revokeUserWebSessions(alice);controller.enqueue(new TextEncoder().encode(JSON.stringify({action:'set',kind:'model',key:'test/a',pinned:true})));controller.close();}});
 const response=await router.handle(new Request('https://family.local/agent/picker-pins',{method:'POST',headers,body,duplex:'half'} as RequestInit));expect(response.status).not.toBe(200);
 expect(getDb().query('SELECT count(*) AS n FROM picker_pins').get()).toEqual({n:0});
});
