import assert from "node:assert/strict";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Credential, OAuthCredential, Provider } from "@earendil-works/pi-ai";
import { FileCredentialStore } from "../../../src/agent-pool/credential-store.js";

const [operation, authPath, profile, rejectionFence] = process.argv.slice(2);
assert.ok(operation && authPath && profile);
for (const name of ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent"]) {
  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.resolve(name))), "utf8"));
  assert.equal(manifest.version, "1.5.2");
}
const id = "synthetic-cross-process";
const credential: OAuthCredential = { type: "oauth", access: "synthetic-rotated", refresh: "synthetic-rotated-refresh", expires: Date.now() + 3_600_000 };
let network = 0;
const denied = () => { network++; throw new Error("Unexpected auth network"); };
globalThis.fetch = Object.assign(async () => denied(), { preconnect: denied });
const commands: string[] = [];
const waiters: Array<(value: string) => void> = [];
const lines = createInterface({ input: process.stdin });
lines.on("line", line => {
  const command = JSON.parse(line) as { command: string };
  const waiter = waiters.shift();
  if (waiter) waiter(command.command); else commands.push(command.command);
});
function next(): Promise<string> { return commands.length ? Promise.resolve(commands.shift()!) : new Promise(resolve => waiters.push(resolve)); }
function emit(event: string) { console.log(JSON.stringify({ event })); }
let operationActive = false, readObserved = false;
class ObservedCredentialStore extends FileCredentialStore {
  override async modify(provider: string, fn: (value: Credential | undefined) => Promise<Credential | undefined>) {
    try { return await super.modify(provider, fn); }
    catch (error) {
      // super.modify rejects only after its finally block releases the lock.
      if (operationActive && provider === id && operation === "auth") writeFileSync(rejectionFence, "released-after-rejection", { mode: 0o600 });
      throw error;
    }
  }
  override async delete(provider: string) {
    const pending = super.delete(provider);
    if (operationActive && provider === id) emit("store-delete-started");
    return pending;
  }
  override async read(provider: string) {
    const pending = super.read(provider);
    if (operationActive && provider === id && !readObserved) { readObserved = true; emit("store-read-started"); }
    return pending;
  }
}
const store = new ObservedCredentialStore(authPath, { maxRetries: 0 });
const runtime = await ModelRuntime.create({ credentials: store, modelsPath: null, modelsStorePath: join(profile, "models-store.json"), refreshOnCreate: false, allowModelNetwork: false });
const provider: Provider = {
  id, name: "Synthetic cross-process auth", getModels: () => [],
  stream: () => { throw new Error("Inference forbidden"); }, streamSimple: () => { throw new Error("Inference forbidden"); },
  auth: { oauth: {
    name: "Synthetic OAuth", login: async () => credential,
    refresh: async current => {
      assert.equal(current.refresh, "synthetic-initial-refresh");
      if (operation === "auth-after-rejection") assert.ok(existsSync(rejectionFence), "Contender refreshed before prior rejection inside the lock");
      emit("refresh-entered");
      const decision = await next();
      if (decision === "reject") throw new Error("invalid_grant");
      assert.equal(decision, "release");
      return credential;
    },
    toAuth: async value => ({ apiKey: value.access }),
  } },
};
runtime.registerNativeProvider(provider);
await runtime.refresh({ allowNetwork: false });
emit("ready");
assert.equal(await next(), "go");
operationActive = true;
emit("operation-started");
try {
  if (operation === "logout") { await runtime.logout(id); emit("logout-done"); }
  else {
    const auth = await runtime.getAuth(id);
    assert.equal(auth?.auth.apiKey, credential.access);
    emit("resolved");
  }
} catch (error) {
  assert.ok(error instanceof Error && "code" in error && error.code === "oauth");
  assert.ok(error.cause instanceof Error && error.cause.message === "invalid_grant");
  emit("rejected");
}
assert.equal(network, 0);
emit("finished");
lines.close();
