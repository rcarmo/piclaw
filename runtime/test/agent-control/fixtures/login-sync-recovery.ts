import assert from "node:assert/strict";
import { join } from "node:path";
import { CredentialSynchronizationError, ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Credential, Provider } from "@earendil-works/pi-ai";
import { FileCredentialStore } from "../../../src/agent-pool/credential-store.js";
import { cancelProviderAuthFlows, handleLogin, handleLogout } from "../../../src/agent-control/handlers/login.js";
import { withChatContext } from "../../../src/core/chat-context.js";
import type { NativeProviderAuthContext } from "../../../src/agent-control/provider-auth-context.js";

const [variant, root] = process.argv.slice(2);
assert.ok(variant && root);
const confirm = variant === "native-confirm", logoutSync = variant === "native-logout-sync";
const scenario = confirm || logoutSync ? "success" : variant.startsWith("native-") ? variant.slice(7) : variant;
const id = "synthetic-login-sync";
const secret = "SYNTHETIC-SAVED-OAUTH-SECRET";
const causeSecret = "SYNTHETIC-CAUSE-SECRET";
let network = 0, logins = 0, writes = 0, refreshes = 0, rotations = 0, caught = 0;
const denyNetwork = () => { network++; throw new Error("Unexpected network"); };
globalThis.fetch = Object.assign(async () => denyNetwork(), { preconnect: denyNetwork });
let failReads = 0;
class Store extends FileCredentialStore {
  override async modify(provider: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>) {
    const result = await super.modify(provider, fn);
    if (provider === id) { writes++; failReads = scenario === "persistent" ? Infinity : 1; }
    return result;
  }
  override async read(provider: string) {
    if (provider === id && failReads > 0) { failReads--; throw new Error(causeSecret); }
    return super.read(provider);
  }
}
const store = new Store(join(root, "auth.json"));
const runtime = await ModelRuntime.create({ credentials: store, modelsPath: null, modelsStorePath: join(root, "models-store.json"), refreshOnCreate: false, allowModelNetwork: false });
const provider: Provider = {
  id, name: "Synthetic Login Sync", auth: { oauth: {
    name: "Synthetic OAuth",
    login: async interaction => {
      logins++;
      if (scenario.includes("-before") || scenario.includes("-during")) interaction.notify({ type: "progress", message: "Synthetic progress" });
      else await interaction.prompt({ type: "text", message: "Synthetic input" });
      if (scenario === "reject") throw new Error(causeSecret);
      return { type: "oauth", access: secret, refresh: secret, expires: Date.now() + 3_600_000 };
    },
    refresh: async () => { rotations++; throw new Error("Provider refresh forbidden"); },
    toAuth: async credential => ({ apiKey: credential.access }),
  } },
  getModels: () => [{ provider: id, id: "synthetic-model", name: "Synthetic model", api: "openai-completions", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 512 }],
  stream: () => { throw new Error("No stream allowed"); },
  streamSimple: () => { throw new Error("No stream allowed"); },
};
runtime.registerNativeProvider(provider);
await runtime.refresh({ allowNetwork: false });
const registry = new ModelRegistry(runtime);
const lifetime = new AbortController();
let nativeCurrent = true, owned = 0, ownedEntries = 0, activations = 0;
const nativeOwned = new Set<Promise<unknown>>();
const nativeContext: NativeProviderAuthContext = Object.freeze({
  kind: "native-provider-auth", chatJid: "web:sync-fixture", bindingId: "native-binding", runtime, signal: lifetime.signal,
  assertCurrent() { assert.equal(nativeCurrent, true, "Native owner revoked"); },
  runOwned<T>(operation: () => Promise<T>): Promise<T> {
    owned++; ownedEntries++;
    const running = Promise.resolve().then(operation);
    nativeOwned.add(running);
    return running.finally(() => { nativeOwned.delete(running); owned--; });
  },
  async activateModel(providerId: string, modelId: string) {
    assert.equal(confirm, true, "Authentication must not activate a model without confirmation");
    assert.equal(providerId, id); assert.equal(modelId, "synthetic-model");
    activations++; return { status: "success", message: "Native model selected" };
  },
});
const originalLogin = runtime.login.bind(runtime), originalRefresh = runtime.refresh.bind(runtime);
let entered!: () => void, release!: () => void;
const gateEntered = new Promise<void>(resolve => { entered = resolve; });
const gateReleased = new Promise<void>(resolve => { release = resolve; });
runtime.login = async (...args) => {
  try { return await originalLogin(...args); }
  catch (error) {
    if (scenario !== "reject") {
      assert.ok(error instanceof CredentialSynchronizationError);
      assert.equal(error.operation, "login");
      assert.equal(error.credential?.type, "oauth");
      assert.equal((error.credential as any).access, secret);
      assert.ok(error.cause instanceof Error && error.cause.message.includes(causeSecret));
      caught++;
      if (scenario === "cancel-before" || scenario === "owner-before") { entered(); await gateReleased; }
    }
    throw error;
  }
};
runtime.refresh = async options => {
  refreshes++;
  assert.equal(options?.allowNetwork, false);
  if (["cancel-during", "owner-during", "replace-during", "dispose-during", "logout-during"].includes(scenario)) { entered(); await gateReleased; }
  if (scenario === "throw") throw new Error(causeSecret);
  const result = await originalRefresh(options);
  if (scenario === "errors") return { ...result, errors: new Map([[id, new Error(causeSecret)]]) };
  if (scenario === "aborted") return { ...result, aborted: true };
  return result;
};
const command = (step: string, data: Record<string, unknown>) => withChatContext("web:sync-fixture", "web", () => handleLogin(nativeContext, registry, { type: "login", provider: `__${step} ${JSON.stringify(data)}`, raw: "/login" })).catch(error => {
  assert.ok(!nativeCurrent || lifetime.signal.aborted, "Unexpected native authentication rejection");
  return { status: "error" as const, message: "Native authentication owner ended", contentBlocks: undefined };
});
const action = (result: any, method: string) => result.contentBlocks[0].payload.actions.find((a: any) => a.data.method === method).data;
try {
  const started = await command("step1method", { provider: id, action: "oauth" });
  assert.equal(started.status, "success");
  const blocked = scenario.includes("-before") || scenario.includes("-during");
  const data = action(started, blocked ? "runtime_check" : "runtime_continue");
  const continuing = blocked ? null : command("step2", { ...data, auth_value: "synthetic" });
  let logout: Promise<unknown> | undefined;
  if (scenario.includes("-before") || scenario.includes("-during")) {
    await gateEntered;
    if (scenario.startsWith("cancel")) {
      const cancelled = await Promise.race([
        command("step2", { ...data, method: "runtime_cancel" }),
        Bun.sleep(500).then(() => { throw new Error("Cancellation joined blocked recovery"); }),
      ]);
      assert.equal(cancelled.status, "success");
    } else if (scenario.startsWith("owner")) nativeCurrent = false;
    else if (scenario === "dispose-during") lifetime.abort();
    else if (scenario === "replace-during") cancelProviderAuthFlows(nativeContext);
    else logout = withChatContext("web:sync-fixture", "web", () => handleLogout(nativeContext, registry, { type: "logout", provider: id, raw: "/logout" }));
    release();
  }
  const result = continuing ? await continuing : await command("step2", { ...data, method: "runtime_check" });
  if (scenario === "success") {
    assert.equal(result.status, "success");
    assert.ok(JSON.stringify(result.contentBlocks).includes("Authentication successful"));
    assert.equal(runtime.getProviderAuthStatus(id).configured, true);
    assert.equal(activations, 0);
  } else {
    assert.equal(result.status, "error");
    assert.equal(result.contentBlocks, undefined);
    if (["persistent", "throw", "errors", "aborted"].includes(scenario)) {
      assert.ok(result.message.startsWith("Credentials were saved, but local model state could not be updated."));
      assert.ok(!result.message.includes("Start again with /login"));
    }
    if (scenario === "reject") assert.equal(result.message, "Authentication failed. Start again with /login.");
  }
  await logout;
  await Promise.allSettled([...nativeOwned]);
  await Bun.sleep(30); // Let every detached settlement run; unhandled failures fail the child.
  assert.equal(logins, 1);
  assert.equal(writes, scenario === "reject" ? 0 : 1);
  assert.equal(caught, scenario === "reject" ? 0 : 1);
  assert.equal(refreshes, scenario.endsWith("-before") || scenario === "reject" ? 0 : 1);
  assert.equal(rotations, 0);
  assert.equal(network, 0);
  if (confirm) {
    const selection = (result.contentBlocks![0] as any).payload.actions.find((item: any) => item.data?.intent === "login-step3").data;
    assert.ok(typeof selection.activation_id === "string");
    for (const forged of [{ model: "forged-model" }, { provider: "foreign-provider", model: "synthetic-model" }]) {
      assert.equal((await command("step3", { ...selection, ...forged })).status, "error");
      assert.equal(activations, 0);
    }
    assert.equal((await command("step3", { ...selection, model: "synthetic-model" })).status, "success");
    assert.equal((await command("step3", { ...selection, model: "synthetic-model" })).status, "error");
    assert.equal(activations, 1);
  }
  if (logoutSync) {
    const originalLogout = runtime.logout.bind(runtime);
    runtime.logout = async (...args) => {
      await originalLogout(...args);
      throw new CredentialSynchronizationError(id, "logout", undefined, { cause: Error(causeSecret) });
    };
    const removed = await withChatContext("web:sync-fixture", "web", () => handleLogout(nativeContext, registry, { type: "logout", provider: id, raw: `/logout ${id}` }));
    assert.equal(removed.status, "error");
    assert.ok(removed.message.includes("refreshed offline"));
    assert.ok(!JSON.stringify(removed).includes(causeSecret));
    assert.equal(logins, 1); assert.equal(refreshes, 2);
  }
  assert.ok(!JSON.stringify([started, result]).includes(secret));
  assert.ok(!JSON.stringify([started, result]).includes(causeSecret));
  failReads = 0;
  const saved = await store.read(id);
  if (scenario !== "reject" && scenario !== "logout-during" && !logoutSync) assert.equal((saved as any)?.access, secret);
  else assert.equal(saved, undefined);
  assert.equal(owned, 0); assert.ok(ownedEntries >= 2); assert.equal(activations, confirm ? 1 : 0);
  console.log(variant);
} finally { cancelProviderAuthFlows(nativeContext); }
