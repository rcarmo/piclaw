import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Model, Provider } from "@earendil-works/pi-ai";
import { createRuntimeModelServices } from "../../../src/agent-pool/model-services.js";
import { FileCredentialStore } from "../../../src/agent-pool/credential-store.js";
import { classifyOpaqueAgentFailure } from "../../helpers/recovery-classification.js";
import { addLogSink, removeLogSink, type LogRecord } from "../../../src/utils/logger.js";

const mode = process.argv[2];
assert.ok(["refresh-permanent", "refresh-transient", "malformed-storage", "storage-eacces", "storage-elocked", "unknown-resolution", "missing-config", "refresh-retry-success"].includes(mode));
const packageRoot = dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
assert.equal(JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).version, "1.5.1");
assert.equal(JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.resolve("@earendil-works/pi-ai"))), "utf8")).version, "1.5.1");
const root = mkdtempSync(join(tmpdir(), "piclaw-auth-stream-"));
const sentinel = "PRIVATE-STREAM-CREDENTIAL-SENTINEL";
let requests = 0, inference = 0, refreshes = 0;
const originalFetch = globalThis.fetch;
const denyNetwork = () => { requests++; throw new Error("Unexpected fixture network."); };
globalThis.fetch = Object.assign(denyNetwork, { preconnect: denyNetwork }) as typeof fetch;
const logs: LogRecord[] = [];
const sink = (record: LogRecord) => logs.push(record);
addLogSink(sink);
try {
  const credentials = new FileCredentialStore(join(root, "agent", "auth.json"), { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1, random: () => 0 });
  const id = "synthetic-stream-auth";
  await credentials.modify(id, async () => ({ type: "oauth", access: "synthetic-expired", refresh: "synthetic-refresh", expires: 1 }));
  const { modelRuntime } = await createRuntimeModelServices({ agentDir: join(root, "agent"), credentialStore: credentials });
  const model: Model<"openai-completions"> = { provider: id, id: "fixture", name: "Fixture", api: "openai-completions", baseUrl: "https://fixture.invalid", input: ["text"], reasoning: false, contextWindow: 10000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const provider: Provider = { id, name: "Fixture", getModels: () => [model],
    stream: () => { inference++; throw new Error("Inference forbidden."); }, streamSimple: () => { inference++; throw new Error("Inference forbidden."); },
    auth: { oauth: { name: "Fixture", login: async () => { throw new Error("Login forbidden."); }, refresh: async () => {
      refreshes++;
      if (mode === "refresh-retry-success" && refreshes === 2) return { type: "oauth", access: "synthetic-rotated", refresh: "synthetic-rotated-refresh", expires: Date.now() + 3_600_000 };
      throw new Error(`${mode === "refresh-transient" || mode === "refresh-retry-success" ? "503 temporarily unavailable" : "invalid_grant"} ${sentinel}`, { cause: new Error(`refresh=${sentinel}`) });
    }, toAuth: async current => ({ apiKey: current.access }) } },
  };
  modelRuntime.registerNativeProvider(provider);
  const results = [];
  if (mode === "malformed-storage") {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(credentials.authPath, `{ broken-json-${sentinel}`);
  }
  let reads = 0;
  if (["storage-eacces", "storage-elocked", "unknown-resolution"].includes(mode)) {
    credentials.read = async () => {
      reads++;
      throw Object.assign(new Error(`private-store-path=${sentinel}`), mode === "unknown-resolution" ? {} : { code: mode === "storage-eacces" ? "EACCES" : "ELOCKED" });
    };
  }
  if (mode === "missing-config") await credentials.delete(id);
  if (mode === "refresh-retry-success") {
    // Exercise successful refresh retries through public runtime auth setup.
    // Do not submit a completion merely to verify usable rotated credentials.
    const result = await modelRuntime.getAuth(model);
    assert.equal(refreshes, 2); assert.equal(result?.auth.apiKey, "synthetic-rotated");
    const stored = await credentials.read(id);
    assert.equal(stored?.type, "oauth");
    if (stored?.type === "oauth") assert.equal(stored.refresh, "synthetic-rotated-refresh");
    assert.equal((await modelRuntime.getAuth(model))?.auth.apiKey, "synthetic-rotated");
    assert.equal(refreshes, 2);
    results.push({ method: "getAuth", retryAttempts: refreshes, status: "pass" });
  } else for (const method of ["stream", "streamSimple"] as const) {
    const before = refreshes;
    const readsBefore = reads;
    const stream = modelRuntime[method](model, { messages: [] });
    const events = [];
    for await (const event of stream) events.push(event);
    const message = await stream.result();
    assert.equal(message.stopReason, "error"); assert.equal(events.length, 1); assert.equal(events[0].type, "error");
    const encoded = JSON.stringify({ events, message });
    assert.ok(!encoded.includes(sentinel));
    const transient = mode === "refresh-transient";
    const storage = ["malformed-storage", "storage-eacces", "storage-elocked", "unknown-resolution"].includes(mode);
    const category = storage ? "credential_storage" : transient ? "network" : "auth_config";
    const expected = mode === "unknown-resolution" ? "Model credential resolution unavailable." : storage ? "Model credential storage unavailable." : transient ? "Model credential service temporarily unavailable (503)." : mode === "missing-config" ? `Provider is not configured: ${id}` : "Provider login required. Model credentials could not be resolved.";
    assert.ok(message.errorMessage?.includes(expected), message.errorMessage);
    assert.equal(classifyOpaqueAgentFailure(message.errorMessage), category);
    if (storage) assert.ok(!/sign in|login|missing provider/i.test(encoded));
    assert.equal(refreshes - before, transient ? 2 : mode === "refresh-permanent" ? 1 : 0);
    if (["storage-eacces", "storage-elocked", "unknown-resolution"].includes(mode)) assert.equal(reads - readsBefore, 1);
    if (mode !== "malformed-storage" && mode !== "missing-config") {
      const stored = JSON.parse(readFileSync(credentials.authPath, "utf8"))[id];
      assert.equal(stored.access, "synthetic-expired"); assert.equal(stored.refresh, "synthetic-refresh");
    }
    results.push({ method, status: "pass", failureCategory: category, refreshAttempts: refreshes - before });
  }
  assert.ok(!JSON.stringify(logs).includes(sentinel)); assert.equal(requests, 0); assert.equal(inference, 0);
  console.log(JSON.stringify({ version: "1.5.1", mode, results, networkRequests: requests, inference, logsRedacted: true }));
} finally { globalThis.fetch = originalFetch; removeLogSink(sink); rmSync(root, { recursive: true, force: true }); }
// This owned fixture has no public runtime disposal API. Explicitly terminate
// after assertions and filesystem cleanup; natural runtime teardown is outside
// this auth-error regression's scope.
process.exit(0);
