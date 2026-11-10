import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readFileSync, readlinkSync } from "node:fs";
import { request, createServer } from "node:http";
import { fileURLToPath } from "node:url";
assert.ok(process.versions.bun, "Bun execution required.");
// Require namespace isolation before imports or a fixed-port callback can bind.
assert.ok(process.env.SYNTHETIC_PARENT_NETNS, "A parent namespace identity is required.");
assert.notEqual(readlinkSync("/proc/self/ns/net"), process.env.SYNTHETIC_PARENT_NETNS, "A distinct network namespace is required.");
assert.deepEqual(readFileSync("/proc/net/dev", "utf8").trim().split("\n").slice(2).map(line => line.split(":")[0].trim()), ["lo"]);
assert.equal(readFileSync("/proc/net/route", "utf8").trim().split("\n").length, 1);
assert.equal(process.getuid(), Number(process.env.SYNTHETIC_EXPECT_UID)); assert.notEqual(process.getuid(), 0);
const status = readFileSync("/proc/self/status", "utf8");
for (const field of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"]) assert.match(status, new RegExp(`${field}:\\s+0{16}(?:\\n|$)`));
assert.match(status, /NoNewPrivs:\s+1(?:\n|$)/);
// Node getgroups includes the effective GID, while Bun omits it. /proc is the
// kernel's supplementary-group source of truth across both runtimes.
assert.match(status, /Groups:\s*\n/);
assert.equal(process.env.PI_OAUTH_CALLBACK_HOST, "127.0.0.1");
const originalFetch = globalThis.fetch;
let bootstrapRequests = 0;
const denyBootstrap = () => { bootstrapRequests++; throw new Error("Unexpected provider import-time request."); };
globalThis.fetch = Object.assign(denyBootstrap, { preconnect: denyBootstrap });

const root = import.meta.resolve("@earendil-works/pi-ai");
assert.equal(JSON.parse(await readFile(fileURLToPath(new URL("../package.json", root)), "utf8")).version, "1.5.2");
const fingerprints = {
  "anthropic.js":"835268caed5dab6a0c7f157c551ed59a00635c76305e6e0c41b579c41aa07bc5",
  "openrouter.js":"b69e807ed855095aa17b2c0d1a15f350c77e3a49f2a66853f227916daacb4703",
  "callback-server.js":"2dda468f4937edcf7bb5e8528de4bf7753efbe5b48610a3f9ea47ff2c4908ede",
  "pkce.js":"d54668654e89d6fe6994a09a7f9399e732a411fcb31c99eb8b5e60349763708c",
};
for (const [file, expected] of Object.entries(fingerprints)) assert.equal(createHash("sha256").update(await readFile(fileURLToPath(new URL(`auth/oauth/${file}`, root)))).digest("hex"), expected);
const commonModes = ["manual-success", "callback-success", "callback-invalid-first", "callback-denied", "token-denied", "malformed-json", "cancel-prompt", "cancel-exchange", "pre-abort"];
const results = [];
const { runCopyCodeCases } = await import("./anthropic-copy-code-100.mjs");
const { anthropicProvider } = await import("@earendil-works/pi-ai/providers/anthropic");
const { openrouterProvider } = await import("@earendil-works/pi-ai/providers/openrouter");
assert.equal(bootstrapRequests, 0);

function loopbackGet(url, allowed, counts) {
  assert.equal(url.protocol, "http:"); assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, allowed.port);
  counts.callback++;
  return new Promise((accept, reject) => {
    const req = request(url, { method: "GET", headers: { Connection: "close" } }, response => {
      let text = "";
      response.setEncoding("utf8"); response.on("data", chunk => { text += chunk; });
      response.on("end", () => accept({ status: response.statusCode, text, cacheControl: response.headers["cache-control"] }));
    });
    req.on("error", reject); req.setTimeout(3000, () => req.destroy(new Error("Fixture callback timed out."))); req.end();
  });
}
function assertExactIpv4Listener(url) {
  const port = Number(url.port).toString(16).toUpperCase().padStart(4, "0");
  const listeners = readFileSync("/proc/net/tcp", "utf8").trim().split("\n").slice(1).map(line => line.trim().split(/\s+/))
    .filter(columns => columns[3] === "0A" && columns[1].split(":")[1] === port).map(columns => columns[1].split(":")[0]);
  assert.deepEqual(listeners, ["0100007F"], "Callback listener must bind exactly IPv4 loopback.");
  const ipv6 = readFileSync("/proc/net/tcp6", "utf8").trim().split("\n").slice(1).map(line => line.trim().split(/\s+/));
  assert.equal(ipv6.some(columns => columns[3] === "0A" && columns[1].split(":")[1] === port), false);
}
async function assertPortReleased(url) {
  const server = createServer();
  try {
    await new Promise((accept, reject) => { server.once("error", reject); server.listen(Number(url.port), "127.0.0.1", accept); });
  } finally { await new Promise(resolve => server.close(resolve)); }
}
try {
  for (const provider of [anthropicProvider(), openrouterProvider()]) {
    const anthropic = provider.id === "anthropic", oauth = provider.auth.oauth;
    assert.ok(oauth);
    const modes = [...commonModes, ...(anthropic ? ["manual-bad-state"] : ["missing-key"])];
    for (const mode of modes) {
      const controller = new AbortController();
      let rejectDeadline;
      const deadline = new Promise((_accept, reject) => { rejectDeadline = reject; });
      const watchdog = setTimeout(() => { controller.abort(); rejectDeadline(new Error("Fixture login deadline exceeded.")); }, 5000);
      try {
      const counts = { exchange: 0, refresh: 0, callback: 0, unexpected: 0 };
      let selectionPrompts = 0, settled = false, lateEvents = 0, lateRequests = 0;
      let authUrl, redirect, promptSignal, manualAborted = false, transportAborted = false, callbackWork, authNotifications = 0;
      const tokenUrl = anthropic ? "https://platform.claude.com/v1/oauth/token" : "https://openrouter.ai/api/v1/auth/keys";
      const token = { access_token: "synthetic-browser-access", refresh_token: "synthetic-browser-refresh", expires_in: 3600 };
      globalThis.fetch = Object.assign(async (input, init) => {
        try {
          if (settled) lateRequests++;
          assert.equal(String(input), tokenUrl); assert.equal(init?.method, "POST");
          assert.equal(new Headers(init.headers).get("content-type")?.toLowerCase(), "application/json");
          assert.ok(init.signal);
          const body = JSON.parse(init.body);
          if (body.grant_type === "refresh_token") {
            assert.equal(anthropic, true); counts.refresh++;
            assert.equal(body.refresh_token, "synthetic-browser-refresh");
            assert.equal(body.client_id, "9d1c250a-e61b-44d9-88ed-5944d1962f5e");
            return Response.json({ ...token, access_token: "synthetic-browser-rotated", refresh_token: "synthetic-browser-rotated-refresh" });
          }
          counts.exchange++; assert.equal(counts.exchange, 1);
          assert.equal(body.code, "synthetic-browser-code"); assert.ok(body.code_verifier);
          assert.equal(createHash("sha256").update(body.code_verifier).digest("base64url"), authUrl.searchParams.get("code_challenge"));
          if (anthropic) {
            assert.deepEqual(Object.keys(body).sort(), ["client_id", "code", "code_verifier", "grant_type", "redirect_uri", "state"]);
            assert.equal(body.grant_type, "authorization_code"); assert.equal(body.client_id, "9d1c250a-e61b-44d9-88ed-5944d1962f5e");
            assert.equal(body.redirect_uri, "http://localhost:53692/callback"); assert.equal(body.state, authUrl.searchParams.get("state"));
          } else {
            assert.deepEqual(Object.keys(body).sort(), ["code", "code_challenge_method", "code_verifier"]);
            assert.equal(body.code_challenge_method, "S256");
          }
          if (mode === "cancel-exchange") return new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => { transportAborted = true; reject(new DOMException("Synthetic cancelled", "AbortError")); }, { once: true });
            queueMicrotask(() => controller.abort());
          });
          if (mode === "token-denied") return Response.json({ error: "access_denied", error_description: "synthetic-denied" }, { status: 400 });
          if (mode === "malformed-json") return new Response("{invalid", { status: 200, headers: { "Content-Type": "application/json" } });
          if (mode === "missing-key") return Response.json({ unsupported: true });
          return Response.json(anthropic ? token : { key: "synthetic-openrouter-key" });
        } catch {
          counts.unexpected++; throw new Error("Unexpected provider browser request or payload.");
        }
      }, { preconnect: () => { counts.unexpected++; throw new Error("Unexpected preconnect."); } });
      const interaction = {
        signal: controller.signal,
        notify: event => {
          if (settled) lateEvents++;
          assert.ok(["auth_url", "progress"].includes(event.type));
          if (event.type !== "auth_url") return;
          authNotifications++;
          assert.equal(authNotifications, 1);
          authUrl = new URL(event.url);
          assert.equal(authUrl.origin, anthropic ? "https://claude.ai" : "https://openrouter.ai");
          assert.equal(authUrl.pathname, anthropic ? "/oauth/authorize" : "/auth");
          assert.equal(authUrl.searchParams.get("code_challenge_method"), "S256");
          assert.ok(authUrl.searchParams.get("code_challenge"));
          const value = authUrl.searchParams.get(anthropic ? "redirect_uri" : "callback_url");
          assert.ok(value); redirect = new URL(value); redirect.hostname = "127.0.0.1";
          assert.equal(redirect.protocol, "http:");
          assert.equal(redirect.pathname.startsWith(anthropic ? "/callback" : "/oauth/callback/"), true);
          if (anthropic) { assert.equal(redirect.port, "53692"); assert.ok(authUrl.searchParams.get("state")); }
          else assert.equal(authUrl.searchParams.has("state"), false);
        },
        prompt: async prompt => {
          if (prompt.type === "select") {
            selectionPrompts++;
            assert.equal(anthropic, true); assert.equal(prompt.signal, undefined);
            assert.deepEqual(prompt.options.map(option => option.id), ["browser", "copy_code"]);
            controller.signal.throwIfAborted();
            return "browser";
          }
          controller.signal.throwIfAborted();
          assert.ok(authUrl && redirect); assert.equal(prompt.type, "manual_code"); assert.ok(prompt.signal);
          assertExactIpv4Listener(redirect);
          promptSignal = prompt.signal;
          if (mode === "cancel-prompt") queueMicrotask(() => controller.abort());
          if (mode.startsWith("callback-")) {
            callbackWork = (async () => {
              const callback = new URL(redirect);
              if (anthropic) callback.searchParams.set("state", authUrl.searchParams.get("state"));
              if (mode === "callback-invalid-first") {
                const invalid = new URL(callback);
                if (anthropic) invalid.searchParams.set("state", "synthetic-wrong-state");
                else invalid.pathname += "-wrong";
                invalid.searchParams.set("code", "synthetic-browser-code");
                const rejected = await loopbackGet(invalid, redirect, counts);
                assert.equal(rejected.status, anthropic ? 400 : 404); assert.equal(rejected.cacheControl, "no-store");
                assert.equal(counts.exchange, 0);
              }
              if (mode === "callback-denied") callback.searchParams.set("error", "access_denied");
              else callback.searchParams.set("code", "synthetic-browser-code");
              const response = await loopbackGet(callback, redirect, counts);
              assert.equal(response.status, mode === "callback-denied" ? 400 : 200);
              assert.equal(response.cacheControl, "no-store");
            })().catch(error => { controller.abort(); throw error; });
            // Observe immediately; the error is rethrown when callbackWork is awaited.
            callbackWork.catch(() => undefined);
          }
          if (mode.startsWith("callback-") || mode === "cancel-prompt") return new Promise((_resolve, reject) => {
            prompt.signal.addEventListener("abort", () => { manualAborted = true; reject(new Error("Manual input cancelled")); }, { once: true });
          });
          const callback = new URL(redirect); callback.searchParams.set("code", "synthetic-browser-code");
          if (anthropic) callback.searchParams.set("state", mode === "manual-bad-state" ? "synthetic-wrong-state" : authUrl.searchParams.get("state"));
          return callback.href;
        },
      };
      if (mode === "pre-abort") controller.abort();
      const success = ["manual-success", "callback-success", "callback-invalid-first"].includes(mode);
      if (success) {
        const credential = await Promise.race([oauth.login(interaction), deadline]);
        assert.equal(credential.type, "oauth");
        assert.equal(credential.access, anthropic ? token.access_token : "synthetic-openrouter-key");
        assert.equal(credential.refresh, anthropic ? token.refresh_token : "");
        if (anthropic) assert.ok(credential.expires > Date.now() + 3_200_000 && credential.expires < Date.now() + 3_310_000);
        else assert.equal(credential.expires, Number.MAX_SAFE_INTEGER);
        assert.deepEqual(await oauth.toAuth(credential), { apiKey: credential.access });
        const refreshed = await oauth.refresh(credential, controller.signal);
        assert.equal(refreshed.access, anthropic ? "synthetic-browser-rotated" : credential.access);
        if (anthropic) assert.equal(refreshed.refresh, "synthetic-browser-rotated-refresh");
        else assert.equal(refreshed, credential);
      } else {
        await assert.rejects(Promise.race([oauth.login(interaction), deadline]), mode === "manual-bad-state" ? /state mismatch/i : mode.includes("cancel") || mode === "pre-abort" ? /cancel|abort/i
          : mode.includes("denied") ? /denied|failed/i : mode === "missing-key" ? /no.*key/i : /invalid JSON/i);
      }
      await callbackWork;
      settled = true; const before = { ...counts }; await Bun.sleep(100);
      assert.deepEqual(counts, before); assert.equal(lateEvents, 0); assert.equal(lateRequests, 0);
      assert.equal(selectionPrompts, anthropic ? 1 : 0);
      assert.equal(counts.unexpected, 0);
      assert.equal(counts.exchange, ["cancel-prompt", "callback-denied", "manual-bad-state", "pre-abort"].includes(mode) ? 0 : 1);
      assert.equal(counts.refresh, anthropic && success ? 1 : 0);
      assert.equal(counts.callback, mode === "callback-invalid-first" ? 2 : mode.startsWith("callback-") ? 1 : 0);
      if (mode.startsWith("callback-") || mode === "cancel-prompt") assert.equal(manualAborted, true);
      if (mode === "cancel-exchange") assert.equal(transportAborted, true);
      if (mode !== "pre-abort") assert.ok(promptSignal?.aborted);
      // Anthropic selection is reached before any SDK abort check; this host prompt
      // rejects a pre-aborted interaction. OpenRouter rejects before notification.
      if (redirect) await assertPortReleased(redirect);
      if (mode === "pre-abort") { assert.equal(promptSignal, undefined); assert.equal(counts.exchange, 0); assert.equal(authNotifications, 0); }
      else assert.equal(authNotifications, 1);
      results.push({ provider: provider.id, mode, status: "pass", requests: counts, pkceVerified: counts.exchange > 0,
        callbackServerReleased: Boolean(redirect), preAbortNotificationObserved: mode === "pre-abort" && Boolean(authUrl),
        manualPromptCancelled: manualAborted, transportCancellationObserved: transportAborted, selectionPrompts,
        preAbortRejectionOwner: mode === "pre-abort" ? anthropic ? "host_selection_prompt" : "sdk_before_notification" : "not_applicable",
        lateEvents, lateRequests, postSettlementObservationMs: 100 });
      } finally { clearTimeout(watchdog); controller.abort(); }
    }
  }
  const copyCodeResults = await runCopyCodeCases(anthropicProvider().auth.oauth);
  console.log(JSON.stringify({ version: "1.5.2", runtime: `Bun ${Bun.version}`,
    scope: "public_anthropic_browser_copy_code_and_openrouter_methods_only", results, copyCodeResults, sdkFileSha256: fingerprints,
    credentialPersistence: "none", inference: "not_invoked", bootstrapRequests, networkGuard: "distinct_loopback_only_os_namespace_guarded_fetch_and_owned_ipv4_callbacks" }));
} finally { globalThis.fetch = originalFetch; }
