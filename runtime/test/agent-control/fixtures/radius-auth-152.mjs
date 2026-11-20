import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readlinkSync } from "node:fs";
import { request, createServer } from "node:http";
import { fileURLToPath } from "node:url";

assert.ok(typeof Bun !== "undefined", "Bun qualification only.");
assert.ok(process.env.SYNTHETIC_PARENT_NETNS);
assert.notEqual(readlinkSync("/proc/self/ns/net"), process.env.SYNTHETIC_PARENT_NETNS, "A distinct network namespace is required.");
assert.deepEqual(readFileSync("/proc/net/dev", "utf8").trim().split("\n").slice(2).map(line => line.split(":")[0].trim()), ["lo"]);
assert.equal(readFileSync("/proc/net/route", "utf8").trim().split("\n").length, 1);
assert.equal(process.getuid(), Number(process.env.SYNTHETIC_EXPECT_UID)); assert.notEqual(process.getuid(), 0);
const status = readFileSync("/proc/self/status", "utf8");
for (const field of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"]) assert.match(status, new RegExp(`${field}:\\s+0{16}(?:\\n|$)`));
assert.match(status, /NoNewPrivs:\s+1(?:\n|$)/); assert.match(status, /Groups:\s*\n/);
const originalFetch = globalThis.fetch;
let bootstrapRequests = 0;
const denyBootstrap = () => { bootstrapRequests++; throw new Error("Unexpected import request."); };
globalThis.fetch = Object.assign(denyBootstrap, { preconnect: denyBootstrap });
const root = import.meta.resolve("@earendil-works/pi-ai");
assert.equal(JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", root)), "utf8")).version, "1.6.0");
const sdkFileSha256 = JSON.parse(readFileSync(new URL("./provider-oauth-160-hashes.json", import.meta.url), "utf8")).files;
for (const [file, hash] of Object.entries(sdkFileSha256)) assert.equal(createHash("sha256").update(readFileSync(fileURLToPath(new URL(file, root)))).digest("hex"), hash);
const modes = ["browser-success", "browser-bad-state-first", "browser-denied", "browser-token-denied", "browser-discovery-malformed", "browser-cancel", "device-pending-success", "device-slow-down", "device-denied", "device-malformed", "device-expiry", "device-poll-cancel", "device-wait-cancel", "refresh-success", "refresh-denied", "unknown-selection", "pre-abort"];
const gateway = "https://radius-fixture.invalid";
const callbackUrl = new URL("http://127.0.0.1:1456/oauth/callback");

function assertNoIpv6Listener() {
  const listeners = readFileSync("/proc/net/tcp6", "utf8").trim().split("\n").slice(1).map(line => line.trim().split(/\s+/))
    .filter(columns => columns[3] === "0A" && columns[1].split(":")[1] === "05B0");
  assert.equal(listeners.length, 0, "No Radius IPv6 listener is permitted.");
}
function assertIpv4Listener() {
  const listeners = readFileSync("/proc/net/tcp", "utf8").trim().split("\n").slice(1).map(line => line.trim().split(/\s+/))
    .filter(columns => columns[3] === "0A" && columns[1].split(":")[1] === "05B0").map(columns => columns[1].split(":")[0]);
  assert.deepEqual(listeners, ["0100007F"]);
  assertNoIpv6Listener();
}
function loopbackGet(url, counts) {
  assert.equal(url.origin, callbackUrl.origin); assert.equal(url.pathname, callbackUrl.pathname);
  assertIpv4Listener();
  counts.callback++;
  return new Promise((accept, reject) => {
    const req = request(url, { method: "GET", headers: { Connection: "close" } }, response => {
      response.resume(); response.on("end", () => accept({ status: response.statusCode, cacheControl: response.headers["cache-control"] }));
    });
    req.on("error", reject); req.setTimeout(3000, () => req.destroy(new Error("Callback deadline exceeded."))); req.end();
  });
}
async function assertPortReleased() {
  assertNoIpv6Listener();
  const server = createServer();
  try { await new Promise((accept, reject) => { server.once("error", reject); server.listen(1456, "127.0.0.1", accept); }); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const results = [];
try {
  const { radiusProvider } = await import("@earendil-works/pi-ai/providers/radius");
  assert.equal(bootstrapRequests, 0);
  const provider = radiusProvider({ id: "synthetic-radius", name: "Synthetic Radius", gateway });
  assert.equal(provider.id, "synthetic-radius");
  const oauth = provider.auth.oauth; assert.ok(oauth);
  for (const mode of modes) {
    const controller = new AbortController(), counts = { discovery: 0, device: 0, token: 0, refresh: 0, callback: 0, unexpected: 0 };
    const polls = [];
    let callbackFailure, authUrl, callbackWork, deviceEvent = false, progressEvents = 0, selectPrompts = 0, abortObserved = false, abortAt = 0;
    let timer, settled = false, lateEvents = 0, lateRequests = 0, rejectDeadline;
    const deadline = new Promise((_resolve, reject) => { rejectDeadline = reject; });
    const watchdog = setTimeout(() => { rejectDeadline(new Error("Fixture deadline exceeded.")); queueMicrotask(() => controller.abort()); }, 12_000);
    const started = Date.now();
    const cancelSoon = () => { timer = setTimeout(() => { abortAt = performance.now(); controller.abort(); }, 25); };
    const tokenBody = { access_token: "synthetic-radius-access", refresh_token: "synthetic-radius-refresh", expires_in: 3600, scope: "gateway offline_access" };
    try {
      globalThis.fetch = Object.assign(async (input, init) => {
        try {
          if (settled) { lateRequests++; throw new Error("Late request."); }
          const url = String(input), headers = new Headers(init?.headers);
          assert.equal(headers.get("accept"), "application/json"); assert.ok(init.signal);
          if (url === `${gateway}/v1/oauth`) {
            counts.discovery++; assert.equal(init.method ?? "GET", "GET");
            return Response.json(mode === "browser-discovery-malformed" ? {} : { authorizationEndpoint: "https://radius-authorize.invalid/auth" });
          }
          assert.ok([`${gateway}/v1/oauth/device`, `${gateway}/v1/oauth/token`].includes(url));
          assert.equal(init.method, "POST"); assert.equal(headers.get("content-type"), "application/x-www-form-urlencoded");
          const body = new URLSearchParams(init.body); assert.equal(body.get("client_id"), "pi-gateway");
          if (url.endsWith("/device")) {
            counts.device++; assert.deepEqual([...body.keys()].sort(), ["client_id", "scope"]); assert.equal(body.get("scope"), "gateway offline_access");
            return Response.json(mode === "device-malformed" ? { device_code: "synthetic-device" } : { device_code: "synthetic-device", user_code: "SYNTHETIC-RADIUS-CODE", verification_uri: "https://radius-fixture.invalid/verify", interval: 1, expires_in: mode === "device-expiry" ? 0.5 : 60 });
          }
          if (body.get("grant_type") === "refresh_token") {
            counts.refresh++; assert.deepEqual([...body.keys()].sort(), ["client_id", "grant_type", "refresh_token"]); assert.equal(body.get("refresh_token"), "synthetic-radius-refresh");
            if (mode === "refresh-denied") return Response.json({ error: "invalid_grant" }, { status: 400 });
            return Response.json({ ...tokenBody, access_token: "synthetic-radius-rotated", refresh_token: "synthetic-radius-refresh-rotated" });
          }
          counts.token++;
          if (body.get("grant_type") === "authorization_code") {
            assert.deepEqual([...body.keys()].sort(), ["client_id", "code", "code_verifier", "grant_type", "redirect_uri"]);
            assert.equal(body.get("code"), "synthetic-radius-code"); assert.equal(body.get("redirect_uri"), callbackUrl.href);
            assert.equal(createHash("sha256").update(body.get("code_verifier")).digest("base64url"), authUrl.searchParams.get("code_challenge"));
            if (mode === "browser-token-denied") return Response.json({ error: "access_denied" }, { status: 400 });
          } else {
            polls.push(performance.now()); assert.deepEqual([...body.keys()].sort(), ["client_id", "device_code", "grant_type"]);
            assert.equal(body.get("grant_type"), "urn:ietf:params:oauth:grant-type:device_code"); assert.equal(body.get("device_code"), "synthetic-device");
            if (mode === "device-poll-cancel") return new Promise((_resolve, reject) => {
              init.signal.addEventListener("abort", () => { abortObserved = true; reject(new DOMException("Synthetic abort", "AbortError")); }, { once: true });
              queueMicrotask(() => { abortAt = performance.now(); controller.abort(); });
            });
            if (mode === "device-denied") return Response.json({ error: "access_denied" }, { status: 400 });
            if (mode === "device-wait-cancel") { cancelSoon(); return Response.json({ error: "authorization_pending" }, { status: 400 }); }
            if (mode === "device-expiry" || mode === "device-pending-success" && counts.token === 1) return Response.json({ error: "authorization_pending" }, { status: 400 });
            if (mode === "device-slow-down" && counts.token === 1) return Response.json({ error: "slow_down" }, { status: 400 });
          }
          return Response.json(tokenBody);
        } catch { counts.unexpected++; throw new Error("Unexpected Radius request or payload."); }
      }, { preconnect: () => { counts.unexpected++; throw new Error("Unexpected preconnect."); } });
      const interaction = {
        signal: controller.signal,
        prompt: async prompt => {
          selectPrompts++; assert.equal(prompt.type, "select"); assert.equal(prompt.message, "Sign in to Synthetic Radius:");
          assert.deepEqual(prompt.options.map(option => option.id), ["browser", "device-code"]);
          controller.signal.throwIfAborted();
          return mode === "unknown-selection" ? "unsupported" : mode.startsWith("browser-") ? "browser" : "device-code";
        },
        notify: event => {
          if (settled) { lateEvents++; throw new Error("Late event."); }
          if (event.type === "device_code") {
            assert.equal(deviceEvent, false); deviceEvent = true;
            assert.equal(event.userCode, "SYNTHETIC-RADIUS-CODE"); assert.equal(event.verificationUri, "https://radius-fixture.invalid/verify");
            assert.equal(event.intervalSeconds, 1); assert.equal(event.expiresInSeconds, mode === "device-expiry" ? 0.5 : 60);
            return;
          }
          if (event.type === "progress") { progressEvents++; assert.equal(event.message, `Listening for OAuth callback on ${callbackUrl}`); return; }
          assert.equal(event.type, "auth_url"); assert.equal(authUrl, undefined); assertIpv4Listener();
          authUrl = new URL(event.url); assert.equal(authUrl.origin, "https://radius-authorize.invalid"); assert.equal(authUrl.pathname, "/auth");
          assert.equal(authUrl.searchParams.get("client_id"), "pi-gateway"); assert.equal(authUrl.searchParams.get("scope"), "gateway offline_access");
          assert.equal(authUrl.searchParams.get("redirect_uri"), callbackUrl.href); assert.equal(authUrl.searchParams.get("handoff"), "url");
          assert.equal(authUrl.searchParams.get("response_type"), "code"); assert.equal(authUrl.searchParams.get("code_challenge_method"), "S256"); assert.ok(authUrl.searchParams.get("state"));
          if (mode === "browser-cancel") { queueMicrotask(() => { abortAt = performance.now(); controller.abort(); }); return; }
          callbackWork = (async () => {
            const callback = new URL(callbackUrl); callback.searchParams.set("state", authUrl.searchParams.get("state"));
            if (mode === "browser-bad-state-first") {
              const bad = new URL(callback); bad.searchParams.set("state", "synthetic-wrong-state"); bad.searchParams.set("code", "synthetic-radius-code");
              const rejected = await loopbackGet(bad, counts); assert.equal(rejected.status, 400); assert.equal(counts.token, 0);
            }
            if (mode === "browser-denied") callback.searchParams.set("error", "access_denied"); else callback.searchParams.set("code", "synthetic-radius-code");
            const response = await loopbackGet(callback, counts); assert.equal(response.status, mode === "browser-denied" ? 400 : mode === "browser-token-denied" ? 502 : 200);
            assert.equal(response.cacheControl, "no-store");
          })().catch(error => { callbackFailure = error; controller.abort(); });
        },
      };
      if (mode === "pre-abort") controller.abort();
      const refreshOnly = mode.startsWith("refresh-");
      const success = ["browser-success", "browser-bad-state-first", "device-pending-success", "device-slow-down", "refresh-success"].includes(mode);
      const previous = { type: "oauth", access: "synthetic-radius-access", refresh: "synthetic-radius-refresh", expires: 1 };
      const operation = refreshOnly ? oauth.refresh(previous, controller.signal) : oauth.login(interaction);
      if (success) {
        const credential = await Promise.race([operation, deadline]); assert.equal(credential.type, "oauth");
        assert.equal(credential.access, refreshOnly ? "synthetic-radius-rotated" : tokenBody.access_token);
        assert.equal(credential.refresh, refreshOnly ? "synthetic-radius-refresh-rotated" : tokenBody.refresh_token);
        assert.equal(credential.scope, "gateway offline_access"); assert.ok(credential.expires >= started + 3_540_000 && credential.expires <= Date.now() + 3_540_000);
        assert.deepEqual(await oauth.toAuth(credential), { apiKey: credential.access });
        if (!refreshOnly) {
          const renewed = await Promise.race([oauth.refresh(credential, controller.signal), deadline]);
          assert.equal(renewed.access, "synthetic-radius-rotated"); assert.equal(renewed.refresh, "synthetic-radius-refresh-rotated");
          assert.equal(renewed.scope, "gateway offline_access");
          assert.deepEqual(await oauth.toAuth(renewed), { apiKey: renewed.access });
        }
      } else await assert.rejects(Promise.race([operation, deadline]), mode.includes("cancel") || mode === "pre-abort" ? /abort|cancel/i
        : mode === "device-expiry" ? /timed out/i : mode === "unknown-selection" ? /Unknown.*sign-in method/i
        : mode.includes("malformed") ? /invalid|missing/i : /denied|invalid_grant/i);
      await callbackWork; if (callbackFailure) throw callbackFailure;
      settled = true; const before = { ...counts }; await Bun.sleep(100);
      assert.deepEqual(counts, before); assert.equal(lateEvents, 0); assert.equal(lateRequests, 0); assert.equal(counts.unexpected, 0);
      assert.equal(selectPrompts, refreshOnly ? 0 : 1);
      assert.equal(counts.discovery, mode.startsWith("browser-") ? 1 : 0);
      assert.equal(counts.device, mode.startsWith("device-") ? 1 : 0);
      const expectedTokens = ["browser-success", "browser-bad-state-first", "browser-token-denied", "device-denied", "device-expiry", "device-poll-cancel", "device-wait-cancel"].includes(mode) ? 1 : ["device-pending-success", "device-slow-down"].includes(mode) ? 2 : 0;
      assert.equal(counts.token, expectedTokens); assert.equal(counts.refresh, success || mode === "refresh-denied" ? 1 : 0);
      assert.equal(counts.callback, mode === "browser-bad-state-first" ? 2 : ["browser-success", "browser-token-denied", "browser-denied"].includes(mode) ? 1 : 0);
      assert.equal(deviceEvent, mode.startsWith("device-") && mode !== "device-malformed");
      assert.equal(progressEvents, mode.startsWith("browser-") && mode !== "browser-discovery-malformed" ? 1 : 0);
      if (polls.length === 2) { const gap = polls[1] - polls[0]; assert.ok(gap >= (mode === "device-slow-down" ? 5900 : 900) && gap < (mode === "device-slow-down" ? 8500 : 3500)); }
      if (mode === "device-expiry") assert.ok(Date.now() - started >= 450);
      if (mode === "device-poll-cancel") assert.equal(abortObserved, true);
      if (mode === "browser-cancel") assert.ok(authUrl && abortAt > 0, "Case-driven browser cancellation required.");
      if (mode === "device-poll-cancel" || mode === "device-wait-cancel") assert.ok(abortAt > 0, "Case-driven device cancellation required.");
      if (abortAt) assert.ok(performance.now() - abortAt < 850);
      await assertPortReleased();
      results.push({ mode, status: "pass", requests: counts, callbackPortReleased: true, deviceEventObserved: deviceEvent, transportCancellationObserved: abortObserved,
        preAbortPromptObserved: mode === "pre-abort" && selectPrompts === 1,
        timingVerified: ["device-pending-success", "device-slow-down", "device-expiry"].includes(mode), lateEvents, lateRequests, postSettlementObservationMs: 100 });
    } catch (error) { throw callbackFailure ?? error; }
    finally { clearTimeout(watchdog); clearTimeout(timer); controller.abort(); await callbackWork; }
  }
  // The provider accepts malformed HTTP200 JSON. Observe that SDK limitation
  // without writing credentials; Core owner regression tests reject this shape.
  let malformedRequests = 0;
  globalThis.fetch = Object.assign(async (input, init) => {
    assert.equal(String(input), gateway + "/v1/oauth/token");
    assert.equal(new URLSearchParams(init.body).get("grant_type"), "refresh_token");
    malformedRequests++; return Response.json({});
  }, { preconnect() { throw Error("No preconnect"); } });
  const invalid = await oauth.refresh({ type: "oauth", access: "synthetic-radius-access", refresh: "synthetic-radius-refresh", expires: 1 }, new AbortController().signal);
  assert.equal(malformedRequests, 1); assert.equal(invalid.access, undefined); assert.equal(invalid.refresh, undefined); assert.equal(Number.isFinite(invalid.expires), false);
  const malformedResponse = { outcome: "sdk_invalid_credential_observed", requests: malformedRequests, credentialPersistence: "none", coreDisposition: "rejected_by_existing_serialized_write_owner_regression" };
  assert.equal(results.length, modes.length); assert.equal(new Set(results.map(row => row.mode)).size, modes.length);
  console.log(JSON.stringify({ version: "1.6.0", runtime: `Bun ${Bun.version}`, scope: "public_radius_browser_device_refresh_methods_only", results, sdkFileSha256, malformedResponse,
    bootstrapRequests, credentialPersistence: "none", inference: "not_invoked", networkGuard: "distinct_loopback_only_os_namespace_guarded_fetch_owned_ipv4_callback" }));
} finally { globalThis.fetch = originalFetch; }
