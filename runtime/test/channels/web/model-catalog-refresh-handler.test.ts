import { expect, test } from "bun:test";
import { handleAgentRoutes } from "../../../src/channels/web/http/dispatch-agent.js";
import { getDataRateLimitRule } from "../../../src/channels/web/http/rate-limit-rules.js";

const owner = { kind: "local", userId: "default", username: "default", displayName: "Test", role: "admin", mode: "single-user", homeChatJid: "web:default", authentication: { method: "local", sessionId: null, expiresAt: null } };
const endpoint = "https://fixture.invalid/agent/models/refresh";

function channel(principal: unknown, refresh: (options: any) => Promise<any> = async () => ({ aborted: false, errors: new Map() })) {
  const calls: any[] = [];
  return { calls, channel: { agentPool: { modelRuntime: { refresh: (options: any) => { calls.push(options); return refresh(options); } } },
    authGateway: { getPrincipal: () => principal }, json: (body: unknown, status = 200) => Response.json(body, { status }) } as any };
}
const call = (c: any, init: RequestInit = { method: "POST" }, suffix = "") => {
  const req = new Request(endpoint + suffix, init);
  return handleAgentRoutes(c, req, new URL(req.url).pathname, new URL(req.url));
};

test("the owner forces a networked catalogue refresh and gets a per-provider outcome", async () => {
  const fixture = channel(owner, async () => ({ aborted: false, errors: new Map([["openrouter", new Error("HTTP 503")]]) }));
  const res = await call(fixture.channel);
  expect(res?.status).toBe(200);
  expect(res?.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await res!.json()).toEqual({ status: "partial", skipped: [], failed: [{ provider: "openrouter", message: "HTTP 503" }] });
  expect(fixture.calls).toHaveLength(1);
  expect(fixture.calls[0]).toMatchObject({ allowNetwork: true, force: true });
});

test("only the single-user owner may refresh, before any network work", async () => {
  for (const principal of [null, { ...owner, role: "member" }, { ...owner, mode: "family-shared" }]) {
    const fixture = channel(principal);
    expect((await call(fixture.channel))?.status).toBe(403);
    expect(fixture.calls).toEqual([]);
  }
});

test("the route accepts no query and is rate limited", async () => {
  const fixture = channel(owner);
  expect((await call(fixture.channel, { method: "POST" }, "?force=0"))?.status).toBe(400);
  expect(fixture.calls).toEqual([]);
  expect(getDataRateLimitRule("POST", "/agent/models/refresh")?.bucket).toBe("data/model_catalog_refresh");
});
