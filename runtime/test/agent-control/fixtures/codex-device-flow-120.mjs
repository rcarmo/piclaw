import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

// Import-time I/O is also denied; subsequent requests use exact synthetic interceptors.
const fixtureOriginalFetch = globalThis.fetch;
let bootstrapRequests = 0;
const denyBootstrap = () => { bootstrapRequests++; throw new Error("Unexpected provider import-time I/O"); };
globalThis.fetch = Object.assign(denyBootstrap, { preconnect: denyBootstrap });
const { builtinProviders } = await import("@earendil-works/pi-ai/providers/all");
assert.equal(bootstrapRequests, 0);
// Current 1.5.1 OAuth implementation hashes are independently measured; historical archives stay unchanged.
const manifestPath = fileURLToPath(new URL("../package.json", import.meta.resolve("@earendil-works/pi-ai")));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
assert.equal(manifest.version, "1.5.1", "Exact published pi-ai 1.5.1 required");
const sdkFileSha256 = {};
for (const [path, expected] of [
  ["auth/oauth/openai-codex.js","0b94a219ddb5982f0ee543ef03138ed0254ce6ee0a57c9d89d39c242e2eaf6f6"],
  ["auth/oauth/device-code.js","8f197cc9af67be64b82939573d719d1b55388f96f2e53cb8c47f9618fc1297eb"],
]) {
  const bytes = await readFile(fileURLToPath(new URL(path, import.meta.resolve("@earendil-works/pi-ai"))));
  sdkFileSha256[path] = createHash("sha256").update(bytes).digest("hex");
  assert.equal(sdkFileSha256[path], expected, "Exact published device-flow bytes required");
}

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEVICE_URL = "https://auth.openai.com/api/accounts/deviceauth/usercode";
const POLL_URL = "https://auth.openai.com/api/accounts/deviceauth/token";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const VERIFY_URL = "https://auth.openai.com/codex/device";
const REDIRECT_URI = "https://auth.openai.com/deviceauth/callback";
const DEVICE_ID = "synthetic-device-auth-id";
const USER_CODE = "SYNTH-CODE";
const AUTH_CODE = "synthetic-authorization-code";
const VERIFIER = "synthetic-code-verifier";
const modes = process.argv.slice(2);
const allowedModes = new Set(["success", "denied", "malformed_device", "malformed_token", "cancel", "slow_down"]);
assert.ok(modes.length > 0, "At least one device-flow mode is required");
for (const mode of modes) assert.ok(allowedModes.has(mode), `Unknown device-flow mode: ${mode}`);

const provider = builtinProviders().find(candidate => candidate.id === "openai-codex");
const oauth = provider?.auth.oauth;
assert.ok(oauth, "Public openai-codex OAuth is missing");
const jwt = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({
  "https://api.openai.com/auth": { chatgpt_account_id: "synthetic-chatgpt-account" },
})).toString("base64url")}.synthetic`;
const originalFetch = fixtureOriginalFetch;
const results = [];

function assertRequest(init, contentType, signal) {
  assert.equal(init?.method, "POST");
  assert.equal(init?.signal, signal);
  const headers = new Headers(init?.headers);
  assert.deepEqual([...headers.entries()], [["content-type", contentType]]);
}

async function runMode(mode) {
  const controller = new AbortController();
  const counts = { device: 0, poll: 0, token: 0, unknown: 0 };
  let deviceEvent;
  let cancellationObserved = false;
  const pollTimes = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === DEVICE_URL) {
      counts.device++;
      assertRequest(init, "application/json", controller.signal);
      assert.deepEqual(JSON.parse(init.body), { client_id: CLIENT_ID });
      if (mode === "malformed_device") return Response.json({ device_auth_id: DEVICE_ID });
      return Response.json({ device_auth_id: DEVICE_ID, user_code: USER_CODE, interval: 0 });
    }
    if (url === POLL_URL) {
      counts.poll++;
      pollTimes.push(performance.now());
      assertRequest(init, "application/json", controller.signal);
      assert.deepEqual(JSON.parse(init.body), { device_auth_id: DEVICE_ID, user_code: USER_CODE });
      if (mode === "cancel") return new Promise((_resolve, reject) => {
        const onAbort = () => { cancellationObserved = true; reject(new DOMException("Synthetic abort", "AbortError")); };
        init.signal.addEventListener("abort", onAbort, { once: true });
        queueMicrotask(() => controller.abort(new Error("Synthetic cancellation")));
      });
      if (mode === "denied") return Response.json({ error: "access_denied" }, { status: 400 });
      if (mode === "malformed_token") return Response.json({ authorization_code: AUTH_CODE });
      if (mode === "success" && counts.poll === 1) return new Response("", { status: 403 });
      if (mode === "slow_down" && counts.poll === 1) return Response.json({ error: "slow_down" }, { status: 400 });
      return Response.json({ authorization_code: AUTH_CODE, code_verifier: VERIFIER });
    }
    if (url === TOKEN_URL) {
      counts.token++;
      assertRequest(init, "application/x-www-form-urlencoded", controller.signal);
      const body = new URLSearchParams(init.body);
      assert.deepEqual([...body.keys()].sort(), ["client_id", "code", "code_verifier", "grant_type", "redirect_uri"]);
      assert.equal(body.get("grant_type"), "authorization_code");
      assert.equal(body.get("client_id"), CLIENT_ID);
      assert.equal(body.get("code"), AUTH_CODE);
      assert.equal(body.get("code_verifier"), VERIFIER);
      assert.equal(body.get("redirect_uri"), REDIRECT_URI);
      return Response.json({ access_token: jwt, refresh_token: "synthetic-refresh", expires_in: 3600 });
    }
    counts.unknown++;
    throw new Error(`Unexpected fetch target: ${url}`);
  };
  const interaction = {
    signal: controller.signal,
    async prompt(prompt) {
      assert.equal(prompt.type, "select", "Device flow must not request browser/manual input");
      assert.deepEqual(prompt.options.map(option => option.id), ["browser", "device_code"]);
      return "device_code";
    },
    notify(event) {
      assert.equal(event.type, "device_code");
      assert.equal(event.userCode, USER_CODE);
      assert.equal(event.verificationUri, VERIFY_URL);
      assert.equal(event.intervalSeconds, 0);
      assert.equal(event.expiresInSeconds, 900);
      deviceEvent = { userCode: event.userCode, verificationUri: event.verificationUri,
        intervalSeconds: event.intervalSeconds, expiresInSeconds: event.expiresInSeconds };
    },
  };
  try {
    if (mode === "success" || mode === "slow_down") {
      const credential = await oauth.login(interaction);
      assert.equal(credential.type, "oauth");
      assert.equal(credential.access, jwt);
      assert.equal(credential.refresh, "synthetic-refresh");
      assert.equal(credential.accountId, "synthetic-chatgpt-account");
      assert.ok(credential.expires > Date.now());
      assert.deepEqual(await oauth.toAuth(credential), { apiKey: jwt });
    } else {
      const expected = mode === "denied" ? /status 400.*access_denied/i
        : mode === "malformed_device" ? /invalid openai codex device code response/i
          : mode === "malformed_token" ? /invalid openai codex device auth token response/i : /login cancelled/i;
      await assert.rejects(oauth.login(interaction), expected);
    }
    const pollGapMs = pollTimes.length > 1 ? pollTimes[1] - pollTimes[0] : null;
    if (mode === "slow_down") assert.ok(pollGapMs >= 5900, "slow_down did not increase the interval between polls");
    if (mode === "success") assert.ok(pollGapMs >= 900 && pollGapMs < 5000, "pending polling interval is not the one-second baseline");
    assert.equal(counts.device, 1);
    assert.equal(counts.poll, { success: 2, denied: 1, malformed_device: 0, malformed_token: 1, cancel: 1, slow_down: 2 }[mode]);
    assert.equal(counts.unknown, 0);
    assert.equal(counts.token, mode === "success" || mode === "slow_down" ? 1 : 0);
    assert.equal(Boolean(deviceEvent), mode !== "malformed_device");
    if (mode === "cancel") assert.equal(cancellationObserved, true);
    results.push({ mode, status: "pass", requests: counts,
      deviceEvent: deviceEvent ? { observed: true, intervalSeconds: deviceEvent.intervalSeconds,
        expiresInSeconds: deviceEvent.expiresInSeconds } : null,
      cancellationObserved, slowDownDelayVerified: mode === "slow_down" ? pollGapMs >= 5900 : undefined });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

for (const mode of modes) await runMode(mode);
console.log(JSON.stringify({ version: manifest.version,
  runtime: typeof Bun === "undefined" ? `Node ${process.versions.node}` : `Bun ${Bun.version}`,
  scope: "public_builtin_openai_codex_synthetic_device_flow", results, credentialPersistence: "none",
  inferenceExecution: "none", sdkFileSha256, externalNetwork: "exact_auth_openai_fetch_interceptor_no_os_sandbox" }));
