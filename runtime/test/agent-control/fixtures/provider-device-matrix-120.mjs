import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
// Import-time I/O is also denied; subsequent requests use exact synthetic interceptors.
const fixtureOriginalFetch = globalThis.fetch;
let bootstrapRequests = 0;
const denyBootstrap = () => { bootstrapRequests++; throw new Error("Unexpected provider import-time I/O"); };
globalThis.fetch = Object.assign(denyBootstrap, { preconnect: denyBootstrap });
const { builtinProviders } = await import("@earendil-works/pi-ai/providers/all");
assert.equal(bootstrapRequests, 0);
// Current 1.5.2 OAuth implementation hashes are independently measured; historical archives stay unchanged.
const root = import.meta.resolve("@earendil-works/pi-ai");
assert.equal(JSON.parse(await readFile(fileURLToPath(new URL("../package.json", root)), "utf8")).version, "1.5.2");
const fingerprints = {
  "github-copilot.js":"22819bb759cbd2a9b846d1cfe8cf7ee9b93ccb8aecc70fc32f9a02daedd536a3",
  "kimi-coding.js":"49d62d8a59e05e37ea6868c41784c52408797cb940dadc7b0de1cfb75176fcbd",
  "device-code.js":"8f197cc9af67be64b82939573d719d1b55388f96f2e53cb8c47f9618fc1297eb",
};
for (const [file, hash] of Object.entries(fingerprints)) assert.equal(createHash("sha256").update(await readFile(fileURLToPath(new URL(`auth/oauth/${file}`, root)))).digest("hex"), hash);
const modes = ["pending-success", "denied", "malformed-device", "malformed-token", "blocked-cancel", "expiry", "slow-down", "unsafe-device-uri", "initial-wait-cancel", "pending-wait-cancel", "slow-wait-cancel"];
const requested = process.argv.slice(2);
const selected = requested.length ? requested : modes;
assert.ok(selected.every(mode => modes.includes(mode)));
const originalFetch = fixtureOriginalFetch, results = [];
try {
  for (const provider of ["github-copilot", "kimi-coding"]) {
    const oauth = builtinProviders().find(item => item.id === provider)?.auth.oauth;
    assert.ok(oauth);
    for (const mode of selected) {
      const github = provider === "github-copilot", controller = new AbortController();
      const client = github ? "Iv1.b507a08c87ecfe98" : "17e5f671-d194-4dfb-9706-5516cb48c098";
      const deviceUrl = github ? "https://github.com/login/device/code" : "https://auth.kimi.com/api/oauth/device_authorization";
      const pollUrl = github ? "https://github.com/login/oauth/access_token" : "https://auth.kimi.com/api/oauth/token";
      const verification = github ? "https://github.com/login/device" : "https://auth.kimi.com/verify";
      const counts = { device: 0, poll: 0, copilotToken: 0, catalog: 0, unexpected: 0 }, polls = [];
      let codeObserved = false, abortObserved = false, abortAt = 0;
      let cancellationTimer;
      const cancelSoon = () => { cancellationTimer = setTimeout(() => { abortAt = performance.now(); controller.abort(new Error("Synthetic timer cancellation")); }, 25); };
      globalThis.fetch = async (input, init) => {
        const url = String(input), headers = new Headers(init?.headers);
        if (url === deviceUrl || url === pollUrl) {
          assert.equal(init?.method, "POST");
          assert.equal(headers.get("content-type"), "application/x-www-form-urlencoded");
          assert.equal(headers.get("accept"), "application/json");
          assert.ok(init.signal);
          const body = new URLSearchParams(init.body);
          assert.equal(body.get("client_id"), client);
          if (url === deviceUrl) {
            counts.device++;
            if (github) assert.equal(body.get("scope"), "read:user");
            assert.deepEqual([...body.keys()].sort(), github ? ["client_id", "scope"] : ["client_id"]);
            return Response.json(mode === "malformed-device" ? { device_code: "synthetic-device" } : {
              device_code: "synthetic-device", user_code: "SYNTHETIC-CODE", verification_uri: mode === "unsafe-device-uri" ? "javascript:alert(1)" : verification,
              ...(github ? {} : { verification_uri_complete: mode === "unsafe-device-uri" ? "javascript:alert(1)" : `${verification}?user_code=SYNTHETIC-CODE` }),
              interval: 1, expires_in: mode === "expiry" ? 1 : 60,
            });
          }
          counts.poll++; polls.push(performance.now());
          assert.equal(body.get("device_code"), "synthetic-device");
          assert.equal(body.get("grant_type"), "urn:ietf:params:oauth:grant-type:device_code");
          assert.deepEqual([...body.keys()].sort(), ["client_id", "device_code", "grant_type"]);
          if (mode === "blocked-cancel") return new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => { abortObserved = true; reject(new DOMException("Synthetic abort", "AbortError")); }, { once: true });
            queueMicrotask(() => controller.abort(new Error("Synthetic cancellation")));
          });
          if (mode === "pending-wait-cancel" || mode === "slow-wait-cancel") {
            cancelSoon();
            return Response.json({ error: mode === "pending-wait-cancel" ? "authorization_pending" : "slow_down", interval: 2 }, { status: github ? 200 : 400 });
          }
          if (mode === "denied") return Response.json({ error: "access_denied" }, { status: github ? 200 : 400 });
          if (mode === "malformed-token") return Response.json({ unsupported: true });
          if (mode === "expiry" || mode === "pending-success" && counts.poll === 1) return Response.json({ error: "authorization_pending" }, { status: github ? 200 : 400 });
          if (mode === "slow-down" && counts.poll === 1) return Response.json({ error: "slow_down", interval: 2 }, { status: github ? 200 : 400 });
          return Response.json(github ? { access_token: "synthetic-github-refresh" } : { access_token: "synthetic-kimi-access", refresh_token: "synthetic-kimi-refresh", expires_in: 3600 });
        }
        if (github && url === "https://api.github.com/copilot_internal/v2/token") {
          counts.copilotToken++;
          assert.equal(init?.method ?? "GET", "GET");
          assert.equal(headers.get("authorization"), "Bearer synthetic-github-refresh");
          assert.equal(headers.get("copilot-integration-id"), "vscode-chat");
          return Response.json({ token: "synthetic-copilot-access", expires_at: Date.now() / 1000 + 3600 });
        }
        if (github && url === "https://api.individual.githubcopilot.com/models") {
          counts.catalog++;
          assert.equal(init?.method ?? "GET", "GET");
          assert.equal(headers.get("authorization"), "Bearer synthetic-copilot-access");
          assert.equal(headers.get("x-github-api-version"), "2026-06-01");
          return Response.json({ data: [{ id: "synthetic-model", model_picker_enabled: true, capabilities: { supports: { tool_calls: true } }, policy: { state: "enabled" } }] });
        }
        counts.unexpected++;
        throw new Error("Unexpected provider device request");
      };
      const interaction = {
        signal: controller.signal,
        prompt: async prompt => { assert.equal(github, true); assert.equal(prompt.type, "text"); return ""; },
        notify: event => {
          assert.equal(event.type, "device_code"); assert.equal(event.userCode, "SYNTHETIC-CODE");
          assert.equal(event.verificationUri, github ? verification : `${verification}?user_code=SYNTHETIC-CODE`); assert.equal(event.intervalSeconds, 1);
          assert.equal(event.expiresInSeconds, mode === "expiry" ? 1 : 60); codeObserved = true;
          if (mode === "initial-wait-cancel") cancelSoon();
        },
      };
      const started = performance.now();
      if (mode === "pending-success" || mode === "slow-down") {
        const credential = await oauth.login(interaction);
        assert.equal(credential.type, "oauth");
        if (github) {
          assert.equal(credential.refresh, "synthetic-github-refresh");
          assert.deepEqual(credential.availableModelIds, ["synthetic-model"]);
          assert.deepEqual(await oauth.toAuth(credential), { apiKey: "synthetic-copilot-access", baseUrl: "https://api.individual.githubcopilot.com" });
        } else {
          assert.equal(credential.refresh, "synthetic-kimi-refresh");
          assert.deepEqual(await oauth.toAuth(credential), { headers: { Authorization: "Bearer synthetic-kimi-access" } });
        }
        const gap = polls[1] - polls[0];
        assert.ok(gap >= (mode === "slow-down" ? 1900 : 900));
        assert.ok(gap < (mode === "slow-down" ? 4500 : 3500), "Polling did not follow the declared cadence");
      } else {
        await assert.rejects(oauth.login(interaction), mode === "denied" ? /denied|access_denied/i : mode === "expiry" ? /timed out/i : mode.includes("cancel") ? /cancel|abort/i : mode === "unsafe-device-uri" ? /untrusted|invalid/i : /invalid|failed/i);
      }
      clearTimeout(cancellationTimer);
      if (mode === "expiry") assert.ok(performance.now() - started >= 900);
      if (mode.includes("wait-cancel")) assert.ok(abortAt > 0 && performance.now() - abortAt < 750, "Timer wait did not abort promptly");
      assert.equal(counts.device, 1); assert.equal(counts.unexpected, 0);
      assert.equal(counts.poll, ["malformed-device", "unsafe-device-uri", "expiry", "initial-wait-cancel"].includes(mode) ? 0 : mode === "pending-success" || mode === "slow-down" ? 2 : 1);
      assert.equal(counts.copilotToken, github && ["pending-success", "slow-down"].includes(mode) ? 1 : 0);
      assert.equal(counts.catalog, counts.copilotToken);
      assert.equal(codeObserved, !["malformed-device", "unsafe-device-uri"].includes(mode));
      if (mode === "blocked-cancel") assert.equal(abortObserved, true);
      results.push({ provider, mode, status: "pass", requests: counts, deviceEventObserved: codeObserved,
        cancellationObserved: abortObserved, timerCancellationVerified: mode.includes("wait-cancel"), timingVerified: ["expiry", "pending-success", "slow-down"].includes(mode) });
    }
  }
  console.log(JSON.stringify({ version: "1.5.2", runtime: typeof Bun === "undefined" ? `Node ${process.versions.node}` : `Bun ${Bun.version}`,
    scope: "public_provider_device_methods_only", results, sdkFileSha256: fingerprints,
    credentialPersistence: "none", inference: "not_invoked", modelPolicyWrites: "none", networkGuard: "fetch_interception_no_os_sandbox" }));
} finally { globalThis.fetch = originalFetch; }
