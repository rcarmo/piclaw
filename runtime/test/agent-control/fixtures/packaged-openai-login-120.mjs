import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readFileSync, readlinkSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
// Manual paste still creates a fixed-port callback: enforce the existing browser namespace guard.
assert.ok(process.versions.bun, "Bun execution required");
assert.ok(process.env.SYNTHETIC_PARENT_NETNS, "Parent namespace identity required");
assert.notEqual(readlinkSync("/proc/self/ns/net"), process.env.SYNTHETIC_PARENT_NETNS, "A distinct network namespace is required");
assert.deepEqual(readFileSync("/proc/net/dev", "utf8").trim().split("\n").slice(2).map(line => line.split(":")[0].trim()), ["lo"]);
assert.equal(readFileSync("/proc/net/route", "utf8").trim().split("\n").length, 1);
assert.equal(process.getuid(), Number(process.env.SYNTHETIC_EXPECT_UID));
assert.notEqual(process.getuid(), 0);
const processStatus = readFileSync("/proc/self/status", "utf8");
for (const field of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"]) assert.match(processStatus, new RegExp(field + ":\\s+0{16}(?:\\n|$)"));
assert.match(processStatus, /NoNewPrivs:\s+1(?:\n|$)/);
assert.match(processStatus, /Groups:\s*\n/);
assert.equal(process.env.PI_OAUTH_CALLBACK_HOST, "127.0.0.1");
const originalFetch = globalThis.fetch;
let bootstrapRequests = 0, callbacksReleased = 0;
const denyBootstrap = () => { bootstrapRequests++; throw new Error("Unexpected provider import-time I/O"); };
globalThis.fetch = Object.assign(denyBootstrap, { preconnect: denyBootstrap });
const { builtinProviders } = await import("@earendil-works/pi-ai/providers/all");
assert.equal(bootstrapRequests, 0);

const manifest = JSON.parse(await readFile(fileURLToPath(new URL("../package.json", import.meta.resolve("@earendil-works/pi-ai"))), "utf8"));
assert.equal(manifest.version, "1.5.2", "Exact published pi-ai required");

// Leave the callback port free inside the owned namespace; no browser/account is opened.
const sdkFileSha256 = {
  "openai-chatgpt.js":"4cf9fc758a07ffe4ee022326404b5dcc86767ee4154945c0417c7f95eaecdcc2",
  "openai-codex.js":"0b94a219ddb5982f0ee543ef03138ed0254ce6ee0a57c9d89d39c242e2eaf6f6",
  "callback-server.js":"2dda468f4937edcf7bb5e8528de4bf7753efbe5b48610a3f9ea47ff2c4908ede",
  "pkce.js":"d54668654e89d6fe6994a09a7f9399e732a411fcb31c99eb8b5e60349763708c",
};
for (const [file, hash] of Object.entries(sdkFileSha256)) {
  const bytes = await readFile(fileURLToPath(new URL("auth/oauth/" + file, import.meta.resolve("@earendil-works/pi-ai"))));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
}
const results = [];
const jwt = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "synthetic-account" } })).toString("base64url")}.fixture`;
try {
  const providers = builtinProviders();
  for (const providerId of ["openai", "openai-codex"]) {
    const oauth = providers.find(provider => provider.id === providerId)?.auth.oauth;
    assert.ok(oauth, `${providerId} OAuth missing`);
    for (const mode of ["success", "bad_state", "cancel"]) {
      let authorization;
      const controller = new AbortController();
      const requests = [];
      let cancellationObserved = false;
      globalThis.fetch = async (input, init) => {
        const url = String(input);
        assert.equal(url, providerId === "openai" ? "https://auth.openai.com/api/accounts/oauth/token" : "https://auth.openai.com/oauth/token");
        assert.notEqual(mode, "bad_state", "Rejected state must not request tokens");
        const body = new URLSearchParams(init?.body);
        requests.push(body.get("grant_type"));
        assert.equal(init?.method, "POST");
        assert.equal(body.get("client_id"), providerId === "openai" ? "synthetic-issued-client" : authorization.searchParams.get("client_id"));
        if (providerId === "openai") assert.equal(body.get("resource"), "https://api.openai.com/v1");
        if (body.get("grant_type") === "authorization_code") {
          assert.equal(body.get("code"), "synthetic-code");
          assert.equal(body.get("redirect_uri"), authorization.searchParams.get("redirect_uri"));
          assert.equal(createHash("sha256").update(body.get("code_verifier")).digest("base64url"), authorization.searchParams.get("code_challenge"));
        } else {
          assert.equal(body.get("grant_type"), "refresh_token");
          assert.equal(body.get("refresh_token"), "synthetic-refresh");
          assert.equal(body.has("code"), false);
        }
        if (mode === "cancel") return await new Promise((_, reject) => {
          assert.ok(init?.signal);
          init.signal.addEventListener("abort", () => { cancellationObserved = true; reject(new DOMException("Synthetic abort", "AbortError")); }, { once: true });
          queueMicrotask(() => controller.abort(new Error("Synthetic cancellation")));
        });
        return Response.json({ access_token: jwt, refresh_token: "synthetic-refresh", expires_in: 3600, id_token: "synthetic-id", scope: "openid chatgpt.tokens.use.direct" });
      };
      const interaction = {
        signal: controller.signal,
        notify(event) { if (event.type === "auth_url") authorization = new URL(event.url); },
        async prompt(prompt) {
          if (prompt.type === "select") return "browser";
          assert.equal(prompt.type, "manual_code");
          assert.ok(authorization);
          const redirect = new URL(authorization.searchParams.get("redirect_uri"));
          assert.equal(redirect.protocol, "http:"); assert.equal(redirect.port, "1455");
          assert.ok(["localhost", "127.0.0.1"].includes(redirect.hostname));
          const listeners = readFileSync("/proc/net/tcp", "utf8").trim().split("\n").slice(1).map(line => line.trim().split(/\s+/)).filter(columns => columns[3] === "0A" && columns[1].split(":")[1] === "05AF").map(columns => columns[1].split(":")[0]);
          assert.deepEqual(listeners, ["0100007F"], "Callback must bind exact IPv4 loopback");
          assert.equal(readFileSync("/proc/net/tcp6", "utf8").trim().split("\n").slice(1).some(line => { const columns = line.trim().split(/\s+/); return columns[3] === "0A" && columns[1].split(":")[1] === "05AF"; }), false);
          redirect.searchParams.set("code", "synthetic-code");
          redirect.searchParams.set("state", mode === "bad_state" ? "wrong-state" : authorization.searchParams.get("state"));
          if (providerId === "openai") redirect.searchParams.set("client_id", "synthetic-issued-client");
          return redirect.toString();
        },
      };
      if (mode === "success") {
        const credential = await oauth.login(interaction, { getDeviceId: () => "00000000-0000-4000-8000-000000000001" });
        assert.equal(credential.type, "oauth");
        assert.equal(credential.access, jwt);
        if (providerId === "openai") assert.equal(credential.clientId, "synthetic-issued-client");
        else assert.equal(credential.accountId, "synthetic-account");
        const refreshed = await oauth.refresh(credential, controller.signal);
        assert.equal(refreshed.type, "oauth");
        assert.deepEqual(requests, ["authorization_code", "refresh_token"]);
      } else {
        await assert.rejects(oauth.login(interaction, { getDeviceId: () => "00000000-0000-4000-8000-000000000001" }), mode === "bad_state" ? /state mismatch/i : /cancel/i);
        assert.deepEqual(requests, mode === "cancel" ? ["authorization_code"] : []);
        if (mode === "cancel") assert.equal(cancellationObserved, true);
      }
      // Verify the provider released its callback before the next public login.
      const callbackProbe = createServer();
      await new Promise((accept, reject) => { callbackProbe.once("error", reject); callbackProbe.listen(1455, "127.0.0.1", accept); });
      await new Promise(accept => callbackProbe.close(accept));
      callbacksReleased++;
      results.push({ provider: providerId, mode, status: "pass", mockedTokenRequests: requests.length, cancellationObserved });
    }
  }
  console.log(JSON.stringify({ version: manifest.version, runtime: typeof Bun === "undefined" ? `Node ${process.versions.node}` : `Bun ${Bun.version}`, owner: "public_builtin_provider_auth", results, externalNetwork: "replaced_with_exact_endpoint_asserting_fetch", networkGuard: "isolated_loopback_namespace_exact_token_fetch_interception", bootstrapRequests, sdkFileSha256, namespaceGuard: { distinctFromParent: true, loopbackOnly: true, noRoutes: true, privilegesDropped: true, callbacksReleased }, credentialPersistence: "none", inferenceExecution: "no_inference_method_invoked_by_probe" }));
} finally {
  globalThis.fetch = originalFetch;
  // The public provider owns its callback-listener cleanup.
}
