import assert from "node:assert/strict";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ModelRuntime, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { Credential } from "@earendil-works/pi-ai";
import { FileCredentialStore } from "../../../src/agent-pool/credential-store.js";
import { createNativeControlFixture } from "../native-control-fixture.js";
import { withChatContext } from "../../../src/core/chat-context.js";
import { TestAgentControlSession } from "../session-fixture.js";

const root = process.argv[3], scenario = process.argv[2];
assert.ok(root && scenario);
const authPath = join(root, "auth.json"), modelsPath = join(root, "models.json");
const sentinel = "SYNTHETIC-custom-credential";
let network = 0;
const denyNetwork = () => { network++; throw new Error("Unexpected custom-auth network"); };
globalThis.fetch = Object.assign(async () => denyNetwork(), { preconnect: denyNetwork });
let failWrite = false, failAfterWrite = false, failDelete = false;
let blockList = false, blockCommit = false;
let listEntered!: () => void, releaseList!: () => void;
const entered = new Promise<void>(resolve => { listEntered = resolve; });
const released = new Promise<void>(resolve => { releaseList = resolve; });
class FixtureCredentialStore extends FileCredentialStore {
  override async modify(id: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>) {
    if (id === "openai-compatible" && failWrite) throw new Error("Synthetic write failure");
    const result = await super.modify(id, async current => {
      const next = await fn(current);
      if (id === "openai-compatible" && blockCommit) { blockCommit = false; listEntered(); await released; }
      return next;
    });
    if (id === "openai-compatible" && scenario === "committed-credential-sync-failure") failAfterWrite = true;
    return result;
  }
  override async list() {
    if (blockList) { blockList = false; listEntered(); await released; }
    return super.list();
  }
  override async delete(id: string) {
    if (id === "openai-compatible" && failDelete) throw new Error("Synthetic delete failure");
    return super.delete(id);
  }
  override async read(id: string) {
    if (id === "openai-compatible" && failAfterWrite) throw new Error("Synthetic snapshot failure");
    return super.read(id);
  }
}
const credentials = new FixtureCredentialStore(authPath);
await credentials.modify("unrelated-auth", async () => ({ type: "api_key", key: "unrelated-synthetic" }));
const runtime = await ModelRuntime.create({ credentials, modelsPath, modelsStorePath: join(root, "models-store.json"), refreshOnCreate: false, allowModelNetwork: false });
const registry = new ModelRegistry(runtime);
const session = new TestAgentControlSession(root, registry);
session.modelRuntime = runtime;
const control = createNativeControlFixture(session, registry, "web:custom-auth");
// The fixture supplies only native control ports; provider login, composition,
// credential storage and refresh are the real public APIs.
const configure = (data: Record<string, unknown>) => withChatContext("web:custom-auth", "web", () => control.facade.applyControlCommand("web:custom-auth", { type: "login", provider: `__step2 ${JSON.stringify({ provider: "openai-compatible", method: "configure", baseUrl: "https://fixture.invalid/v1", modelId: "synthetic-model", ...data })}`, raw: "/login __step2" }));
const modelConfig = () => JSON.parse(readFileSync(modelsPath, "utf8"));
const backups = () => readdirSync(root).filter(name => name.endsWith(".bak"));
try {
  if (scenario === "new-key-and-logout") {
    const result = await configure({ apiKey: sentinel });
    assert.equal(result.status, "success");
    assert.equal(modelConfig().providers["openai-compatible"].apiKey, undefined);
    assert.equal((await runtime.getAuth("openai-compatible"))?.auth.apiKey, sentinel);
    assert.equal((await credentials.read("openai-compatible"))?.type, "api_key");
    assert.equal(statSync(authPath).mode & 0o777, 0o600);
    assert.equal(statSync(modelsPath).mode & 0o777, 0o600);
    assert.equal(session.model.id, "gpt-test");
    const logout = await withChatContext("web:custom-auth", "web", () => control.facade.applyControlCommand("web:custom-auth", { type: "logout", provider: "openai-compatible", raw: "/logout openai-compatible" }));
    assert.equal(logout.status, "success");
    assert.equal(await credentials.read("openai-compatible"), undefined);
    assert.equal(backups().some(name => name.startsWith("auth.json")), false);
  } else if (scenario === "blank-update-preserves-key") {
    assert.equal((await configure({ apiKey: sentinel })).status, "success");
    const before = await credentials.read("openai-compatible");
    const config = modelConfig();
    config.providers["unrelated-config"] = { baseUrl: "https://other.invalid", apiKey: "other-config-secret", models: [{ id: "other" }] };
    writeFileSync(modelsPath, JSON.stringify(config));
    assert.equal((await configure({ apiKey: "", modelId: "replacement-model" })).status, "success");
    assert.deepEqual(await credentials.read("openai-compatible"), before);
    assert.equal((await runtime.getAuth("openai-compatible"))?.auth.apiKey, sentinel);
    assert.deepEqual(modelConfig().providers["unrelated-config"], config.providers["unrelated-config"]);
    assert.ok(backups().length > 0);
    for (const name of backups()) {
      const bytes = readFileSync(join(root, name), "utf8");
      assert.ok(!bytes.includes(sentinel) && !bytes.includes("other-config-secret"));
      assert.equal(statSync(join(root, name)).mode & 0o777, 0o600);
    }
  } else if (scenario === "keyless-local") {
    for (const provider of ["ollama", "llama-cpp"]) {
      assert.equal((await configure({ provider, baseUrl: "http://127.0.0.1:11434/v1", apiKey: "" })).status, "success");
      assert.equal(await credentials.read(provider), undefined);
      assert.equal(modelConfig().providers[provider].apiKey, "piclaw-keyless-local");
      assert.equal((await runtime.getAvailable(provider)).length, 1);
      assert.equal((await runtime.getAuth(provider))?.auth.apiKey, "piclaw-keyless-local");
      assert.equal(session.model.id, "gpt-test");
      const reopened = await ModelRuntime.create({ credentials: new FileCredentialStore(authPath), modelsPath, modelsStorePath: join(root, "reopened-models-store.json"), allowModelNetwork: false });
      assert.equal((await reopened.getAvailable(provider)).length, 1);
      assert.equal((await configure({ provider, baseUrl: "http://127.0.0.1:11434/v1", apiKey: "", modelId: "updated-local" })).status, "success");
      assert.equal((await runtime.getAvailable(provider))[0]?.id, "updated-local");
      const logout = await withChatContext("web:custom-auth", "web", () => control.facade.applyControlCommand("web:custom-auth", { type: "logout", provider, raw: `/logout ${provider}` }));
      assert.equal(logout.status, "success");
      assert.equal(modelConfig().providers[provider], undefined);
      assert.equal((await runtime.getAvailable(provider)).length, 0);
      assert.equal(backups().some(name => name.startsWith("auth.json")), false);
    }
    for (const name of backups()) assert.ok(!readFileSync(join(root, name), "utf8").includes("piclaw-keyless-local"));
  } else if (scenario === "authenticated-local-preserves-key") {
    for (const provider of ["ollama", "llama-cpp"]) {
      assert.equal((await configure({ provider, baseUrl: "http://127.0.0.1:11434/v1", apiKey: sentinel })).status, "success");
      const before = await credentials.read(provider);
      assert.equal((await configure({ provider, baseUrl: "http://127.0.0.1:11434/v1", apiKey: "", modelId: "updated-local" })).status, "success");
      assert.deepEqual(await credentials.read(provider), before);
      assert.equal(modelConfig().providers[provider].apiKey, undefined);
      assert.equal((await runtime.getAuth(provider))?.auth.apiKey, sentinel);
      assert.equal((await runtime.getAvailable(provider)).length, 1);
    }
  } else if (scenario === "legacy-config-fails-closed") {
    const original = JSON.stringify({ providers: { "openai-compatible": { baseUrl: "https://fixture.invalid", apiKey: sentinel, models: [{ id: "old" }] } } });
    writeFileSync(modelsPath, original);
    assert.equal((await configure({ apiKey: "new-secret" })).status, "error");
    assert.equal(readFileSync(modelsPath, "utf8"), original);
    assert.equal(await credentials.read("openai-compatible"), undefined);
    assert.deepEqual(backups(), []);
  } else if (scenario === "malformed-config-fails-closed") {
    writeFileSync(modelsPath, "{ malformed");
    assert.equal((await configure({ apiKey: sentinel })).status, "error");
    assert.equal(readFileSync(modelsPath, "utf8"), "{ malformed");
    assert.equal(await credentials.read("openai-compatible"), undefined);
    assert.deepEqual(backups(), []);
  } else if (scenario === "failed-login-restores-config") {
    assert.equal((await configure({ apiKey: sentinel })).status, "success");
    const original = readFileSync(modelsPath, "utf8");
    const before = await credentials.read("openai-compatible");
    failWrite = true;
    assert.equal((await configure({ apiKey: "replacement", modelId: "different" })).status, "error");
    assert.equal(readFileSync(modelsPath, "utf8"), original);
    assert.deepEqual(await credentials.read("openai-compatible"), before);
    assert.equal((await runtime.getAuth("openai-compatible"))?.auth.apiKey, sentinel);
  } else if (scenario === "committed-credential-sync-failure") {
    const result = await configure({ apiKey: sentinel });
    assert.equal(result.status, "error");
    assert.ok(result.message.includes("credential was saved"));
    failAfterWrite = false;
    assert.equal((await credentials.read("openai-compatible"))?.type, "api_key");
    assert.equal(modelConfig().providers["openai-compatible"].apiKey, undefined);
    assert.equal((await runtime.getAuth("openai-compatible"))?.auth.apiKey, sentinel);
  } else if (scenario === "concurrent-custom-config") {
    const results = await Promise.all([
      configure({ apiKey: sentinel }),
      configure({ provider: "opencode-zen", apiKey: "synthetic-second-key", modelId: "second" }),
    ]);
    assert.ok(results.every(result => result.status === "success"));
    assert.ok(modelConfig().providers["openai-compatible"] && modelConfig().providers["opencode-zen"]);
    assert.equal((await runtime.getAuth("openai-compatible"))?.auth.apiKey, sentinel);
    assert.equal((await runtime.getAuth("opencode-zen"))?.auth.apiKey, "synthetic-second-key");
  } else if (scenario === "logout-delete-failure-retains-config") {
    assert.equal((await configure({ apiKey: sentinel })).status, "success");
    const original = readFileSync(modelsPath, "utf8");
    const before = await credentials.read("openai-compatible");
    failDelete = true;
    assert.equal((await withChatContext("web:custom-auth", "web", () => control.facade.applyControlCommand("web:custom-auth", { type: "logout", provider: "openai-compatible", raw: "/logout openai-compatible" }))).status, "error");
    assert.equal(readFileSync(modelsPath, "utf8"), original);
    assert.deepEqual(await credentials.read("openai-compatible"), before);
  } else if (scenario === "same-provider-ordered-setup") {
    blockList = true;
    const first = configure({ apiKey: "first-synthetic", modelId: "first" });
    await entered;
    const second = configure({ apiKey: sentinel, modelId: "second" });
    releaseList();
    const [old, current] = await Promise.all([first, second]);
    // The first write is admitted, but the later setup may invalidate its
    // presentation before refresh settles. It must never yield stale activation.
    if (old.status === "error") {
      assert.ok(old.message.includes("Authentication session changed"));
      assert.equal(old.contentBlocks, undefined);
    } else assert.equal(old.status, "success");
    const oldCard = old.contentBlocks?.[0] as any;
    const activation = oldCard?.payload?.actions?.find((action: any) => action.data?.activation_id)?.data;
    if (activation) {
      const replay = await withChatContext("web:custom-auth", "web", () => control.facade.applyControlCommand("web:custom-auth", { type: "login", provider: `__step3 ${JSON.stringify({ ...activation, model: "first" })}`, raw: "/login __step3" }));
      assert.equal(replay.status, "error");
    }
    assert.equal(current.status, "success");
    assert.equal(modelConfig().providers["openai-compatible"].models[0].id, "second");
    assert.equal((await runtime.getAuth("openai-compatible"))?.auth.apiKey, sentinel);
  } else if (scenario === "commit-window-blank-update") {
    blockCommit = true;
    const first = configure({ apiKey: sentinel, modelId: "first" });
    await entered;
    const second = configure({ apiKey: "", modelId: "second" });
    releaseList();
    const [old, current] = await Promise.all([first, second]);
    if (old.status === "error") assert.ok(old.message.includes("Authentication session changed"));
    else assert.equal(old.status, "success");
    assert.equal(current.status, "success");
    assert.equal(modelConfig().providers["openai-compatible"].models[0].id, "second");
    assert.equal((await runtime.getAuth("openai-compatible"))?.auth.apiKey, sentinel);
  } else if (scenario === "blank-stored-key-rejected") {
    await credentials.modify("openai-compatible", async () => ({ type: "api_key", key: "" }));
    assert.equal((await configure({ apiKey: "" })).status, "error");
    assert.deepEqual(backups(), []);
  } else if (scenario === "required-key-missing") {
    assert.equal((await configure({ apiKey: "" })).status, "error");
    assert.equal(await credentials.read("openai-compatible"), undefined);
    assert.deepEqual(backups(), []);
  } else throw new Error("Unknown custom-auth scenario");
  assert.deepEqual(await credentials.read("unrelated-auth"), { type: "api_key", key: "unrelated-synthetic" });
  assert.equal(network, 0);
  console.log(scenario);
} finally { control.dispose(); }
