import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, readlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { ModelRuntime, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { getProviderDefs } from "../../src/agent-control/provider-defs.js";
import { createTestCredentialStore } from "../model-services-fixture.js";

const originalFetch = globalThis.fetch;
let networkRequests = 0;
beforeAll(() => {
  const deny = () => { networkRequests++; throw new Error("Inventory network forbidden"); };
  globalThis.fetch = Object.assign(deny, { preconnect: deny }) as typeof fetch;
});
afterAll(() => { globalThis.fetch = originalFetch; expect(networkRequests).toBe(0); });
const receipt = JSON.parse(readFileSync(resolve(import.meta.dir, "fixtures/provider-auth-inventory-151.json"), "utf8"));
const inventory = () => builtinProviders().map(provider => ({
  id: provider.id, name: provider.name,
  apiKeyLogin: typeof provider.auth.apiKey?.login === "function",
  apiKeyResolve: typeof provider.auth.apiKey?.resolve === "function",
  oauthLogin: typeof provider.auth.oauth?.login === "function",
  oauthRefresh: typeof provider.auth.oauth?.refresh === "function",
  oauthToAuth: typeof provider.auth.oauth?.toAuth === "function",
})).sort((a, b) => a.id.localeCompare(b.id));

test("exact1.5.1 provider-owned method inventory matches public runtime and UI definitions", async () => {
  expect(JSON.parse(readFileSync(new URL("../package.json", import.meta.resolve("@earendil-works/pi-ai")), "utf8")).version).toBe("1.5.1");
  expect(JSON.parse(readFileSync(new URL("../package.json", import.meta.resolve("@earendil-works/pi-coding-agent")), "utf8")).version).toBe("1.5.1");
  expect(receipt.version).toBe("1.5.1");
  expect(receipt.methodsExecuted).toBe(false);
  expect(receipt.networkRequests).toBe(0);
  const allBytes = readFileSync(new URL("providers/all.js", import.meta.resolve("@earendil-works/pi-ai")));
  expect(createHash("sha256").update(allBytes).digest("hex")).toBe(receipt.sdkFileSha256["providers/all.js"]);
  expect(receipt.gitHead).toBe("dd30101cfc5b0609411dd80b6f93adbc14db14cf");
  expect(inventory()).toEqual(receipt.providers);
  expect(receipt.providers).toHaveLength(43);
  const runtime = await ModelRuntime.create({ credentials: createTestCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  const defs = getProviderDefs(new ModelRegistry(runtime), runtime);
  for (const provider of receipt.providers) {
    expect(defs.find(entry => entry.id === provider.id)).toMatchObject({ hasOAuth: provider.oauthLogin, hasApiKey: provider.apiKeyLogin });
  }
  expect(receipt.providers.find((entry: any) => entry.id === "openai")).toMatchObject({ apiKeyLogin: true, oauthLogin: true });
  expect(receipt.providers.find((entry: any) => entry.id === "openai-codex")).toMatchObject({ apiKeyLogin: false, oauthLogin: true });
  for (const provider of ["anthropic", "github-copilot", "kimi-coding", "openrouter", "radius"]) expect(receipt.providers.find((entry: any) => entry.id === provider).oauthLogin).toBe(true);
});

test("authoritative empty/failed runtime cannot advertise removed static login methods", () => {
  for (const getProviders of [() => [], () => { throw new Error("inventory unavailable"); }]) {
    const defs = getProviderDefs({ getAll: () => [{ provider: "anthropic" }] }, { getProviders });
    expect(defs.find(entry => entry.id === "anthropic")).toMatchObject({ hasOAuth: false, hasApiKey: false });
    expect(defs.filter(entry => entry.hasOAuth || entry.hasApiKey)).toEqual([]);
  }
  expect(getProviderDefs().find(entry => entry.id === "anthropic")?.hasOAuth).toBe(true); // Legacy host without a runtime inventory.
});

test("custom local/no-key configuration and external cloud identity are distinct inventory rows", () => {
  expect(receipt.externalIdentityRoutes.map((entry: any) => entry.provider)).toEqual(["amazon-bedrock", "google-vertex", "azure-openai", "azure-foundry"]);
  for (const local of ["ollama", "llama-cpp"]) {
    const row = receipt.customProviders.find((entry: any) => entry.id === local);
    expect(row.requiresApiKey).toBe(false);
    expect(row.authMode).toBe("custom_no_key");
  }
  const defs = getProviderDefs();
  for (const custom of receipt.customProviders) expect(defs.find(entry => entry.id === custom.id)?.customFields?.some(field => field.key === "apiKey" && field.required)).toBe(custom.requiresApiKey);
});

test("packaged public OpenAI/Codex modules execute synthetic PKCE login, refresh, bad state and cancellation", async () => {
  const probe = resolve(import.meta.dir, "fixtures/packaged-openai-login-120.mjs");
  // Manual PKCE still binds port 1455: never expose it in the parent namespace.
  const child = Bun.spawn(["sudo", "-n", "unshare", "--net", "/bin/sh", "-c",
    'ip link set lo up && exec setpriv --reuid="$1" --regid="$2" --clear-groups --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs env -i PATH="$3" HOME=/nonexistent PI_OFFLINE=1 PI_TELEMETRY=0 OTEL_SDK_DISABLED=true PI_OAUTH_CALLBACK_HOST=127.0.0.1 SYNTHETIC_PARENT_NETNS="$4" SYNTHETIC_EXPECT_UID="$1" timeout --kill-after=2s 30s "$5" --no-env-file "$6"',
    "openai-120-namespace", String(process.getuid?.()), String(process.getgid?.()), `${dirname(process.execPath)}:/usr/bin:/bin`, readlinkSync("/proc/self/ns/net"), process.execPath, probe], {
    cwd: resolve(import.meta.dir, "../../.."),
    env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: "/nonexistent" }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  // Allow the namespace's 30s bound and 2s kill grace to finish first.
  const timeout = setTimeout(() => child.kill("SIGKILL"), 35_000);
  try {
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(stderr).toBe("");
    expect(exit).toBe(0);
    const executed = JSON.parse(stdout);
    expect(executed.results).toEqual(["openai", "openai-codex"].flatMap(provider => ["success", "bad_state", "cancel"].map(mode => ({ provider, mode, status: "pass", mockedTokenRequests: mode === "success" ? 2 : mode === "cancel" ? 1 : 0, cancellationObserved: mode === "cancel" }))));
    expect(executed.version).toBe("1.5.1");
    expect(executed.networkGuard).toBe("isolated_loopback_namespace_exact_token_fetch_interception");
    expect(executed.bootstrapRequests).toBe(0);
    expect(executed.credentialPersistence).toBe("none");
    expect(executed.inferenceExecution).toBe("no_inference_method_invoked_by_probe");
    expect(executed.namespaceGuard).toMatchObject({ distinctFromParent: true, loopbackOnly: true, noRoutes: true, privilegesDropped: true, callbacksReleased: 6 });
    for (const sentinel of ["synthetic-refresh", "synthetic-code", "synthetic-issued-client", "synthetic-id", "synthetic-account"]) expect(stdout).not.toContain(sentinel);
  } finally { clearTimeout(timeout); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; }
}, 40_000);


test("1.5.1 manual PKCE fixture refuses the parent namespace before provider imports", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", resolve(import.meta.dir, "fixtures/packaged-openai-login-120.mjs")], {
    env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", SYNTHETIC_PARENT_NETNS: readlinkSync("/proc/self/ns/net"), SYNTHETIC_EXPECT_UID: String(process.getuid?.()) }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit).not.toBe(0); expect(out).toBe(""); expect(err).toContain("A distinct network namespace is required");
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; }
});
