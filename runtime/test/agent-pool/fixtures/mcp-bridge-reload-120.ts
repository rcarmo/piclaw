import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { createAgentSession, createAgentSessionRuntime, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { acquireMcpSessionBridge, hydrateMcpKeychainCredentials, resetMcpStartupStateForTests } from "../../../src/secure/mcp-keychain.js";
import { bindMcpBridgeOwner, createMcpBridgeOwner } from "../../../src/agent-pool/mcp-bridge-owner.js";

const require = createRequire(import.meta.url);
const { createMcpAdapter } = require("pi-mcp-adapter") as { createMcpAdapter(options: unknown): ExtensionFactory };
const version = require("@earendil-works/pi-coding-agent/package.json").version;
const adapterVersion = require("pi-mcp-adapter/package.json").version;
assert.equal(version, "1.5.2"); assert.equal(adapterVersion, "2.31.0");
const mode = process.argv[2];
assert(["success", "failed-initial", "failed-reload", "commit-failure", "unbound", "overlap", "disposed-barrier", "failed-barrier", "shutdown-error", "runtime-dispose"].includes(mode));
const reloads = Number(process.argv[3] ?? 3); assert(Number.isInteger(reloads) && reloads > 0 && reloads <= 1000);
const instrument = process.argv[4] === "instrument";
const root = process.argv[5] ?? mkdtempSync(join(tmpdir(), "mcp-bridge-reload-"));
const savedFetch = globalThis.fetch; let network = 0, credentialReads = 0;
const deny = () => { network++; throw Error("Unexpected network"); };
globalThis.fetch = Object.assign(deny, { preconnect: deny }) as typeof fetch;
const leases: Array<{ revision: string; released: number; env: () => Readonly<NodeJS.ProcessEnv> }> = [];
const order: string[] = [], times: number[] = [], errors: string[] = [];
let fail = mode === "failed-initial", unrelatedLoads = 0, barrierCalls = 0;
let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
let sessionRuntime: Awaited<ReturnType<typeof createAgentSessionRuntime>> | undefined;
const owner = createMcpBridgeOwner(bridge => {
  if (fail) throw Error("Synthetic owner factory failed");
  const adapter = createMcpAdapter({ config: bridge.config, initializeOnLoad: false, resolveRuntimeEnv: (serverName: string) => bridge.resolveRuntimeEnv(serverName) });
  return async pi => {
    await adapter(pi);
    const id = leases.length;
    let stopped = false;
    pi.on("session_shutdown", async () => {
      if (stopped) return; stopped = true;
      assert(bridge.resolveRuntimeEnv("fixture").FIXTURE_MCP_BEARER); order.push(`shutdown:${id}`);
      if (mode === "shutdown-error") throw Error("Synthetic shutdown error");
    });
    pi.on("session_start", async () => { order.push(`start:${id}`); });
    if (mode === "commit-failure") pi.registerProvider("fixture", { baseUrl: "https://fixture.invalid" });
  };
}, () => {
  const bridge = acquireMcpSessionBridge();
  const row = { revision: bridge.revision, released: 0, env: () => bridge.resolveRuntimeEnv("fixture") };
  leases.push(row); order.push(`acquire:${leases.length}`);
  return { ...bridge, release: () => { row.released++; order.push(`release:${leases.indexOf(row) + 1}`); bridge.release(); } };
});
async function prepare(revision: number) {
  writeFileSync(join(root, ".pi/mcp.json"), JSON.stringify({ mcpServers: { fixture: { command: "must-not-spawn", args: [String(revision)], disabled: true, bearerTokenKeychain: "fixture-only", bearerTokenEnv: "FIXTURE_MCP_BEARER" } } }));
  await hydrateMcpKeychainCredentials(root, async () => { credentialReads++; return { secret: `SYNTHETIC_BEARER_${revision}` } as any; });
}
function files(path: string): Record<string, string> {
  return Object.fromEntries(readdirSync(path).sort().flatMap(name => {
    const child = join(path, name);
    return statSync(child).isDirectory() ? Object.entries(files(child)) : [[relative(root, child), readFileSync(child).toString("base64")]];
  }));
}
const counts = { parse: { calls: 0, bytes: 0, ms: 0 }, stringify: { calls: 0, bytes: 0, ms: 0 }, clone: { calls: 0, ms: 0 } };
const parse = JSON.parse, stringify = JSON.stringify, clone = globalThis.structuredClone;
function startCounters() {
  if (!instrument) return;
  JSON.parse = (...args: Parameters<typeof JSON.parse>) => { const start = performance.now(); try { return parse(...args); } finally { counts.parse.calls++; counts.parse.bytes += args[0].length; counts.parse.ms += performance.now() - start; } };
  JSON.stringify = ((...args: Parameters<typeof JSON.stringify>) => { const start = performance.now(); const result = stringify(...args); counts.stringify.calls++; counts.stringify.bytes += result?.length ?? 0; counts.stringify.ms += performance.now() - start; return result; }) as typeof JSON.stringify;
  globalThis.structuredClone = ((...args: Parameters<typeof structuredClone>) => { const start = performance.now(); try { return clone(...args); } finally { counts.clone.calls++; counts.clone.ms += performance.now() - start; } }) as typeof structuredClone;
}
function stopCounters() { JSON.parse = parse; JSON.stringify = stringify; globalThis.structuredClone = clone; }
const loop = monitorEventLoopDelay({ resolution: 1 });
try {
  mkdirSync(join(root, ".pi")); process.env.PICLAW_WORKSPACE = root; process.env.PICLAW_PI_AGENT_DIR = join(root, "agent"); process.env.PI_CODING_AGENT_DIR = join(root, "agent");
  await prepare(1);
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  const settings = SettingsManager.inMemory();
  const unrelated: ExtensionFactory = () => { unrelatedLoads++; };
  const loader = new DefaultResourceLoader({ cwd: root, agentDir: join(root, "agent"), settingsManager: settings, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, extensionFactories: [mode === "commit-failure" ? { ...owner.extension, builtin: true } : owner.extension, unrelated], ...(mode === "commit-failure" ? { additionalExtensionPaths: [`builtin:${owner.extension.name}`] } : {}) });
  const before = files(root);
  assert.equal(leases.length, 0);
  if (mode === "commit-failure") {
    // Public SDK runtime fault injection: factory completes, then its deferred
    // provider registration throws during SDK commit (not in the factory).
    // Built-in factory loads after the public project-trust callback, which
    // supplies the same runtime used for final registration commits.
    await loader.reload({ resolveProjectTrust: ({ extensionsResult }) => {
      extensionsResult.runtime.registerProvider = () => { throw Error("Synthetic registration commit failed"); };
      return Promise.resolve(true);
    } });
    const result = loader.getExtensions();
    assert(!result.extensions.some(extension => extension.path === `builtin:${owner.extension.name}`)); assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].error, /Synthetic registration commit failed/);
    assert.equal(leases[0].released, 0);
    assert.throws(() => owner.assertLoaded(result), /did not load/);
  } else {
    await loader.reload();
    assert.deepEqual(files(root), before, "loading must not write configuration or credentials");
    assert.equal(credentialReads, 1); // loading never rehydrates credentials
    if (mode === "failed-initial") {
      assert.equal(loader.getExtensions().errors.length, 1);
      assert.throws(() => owner.assertLoaded(loader.getExtensions()), /did not load/);
    } else {
      owner.assertLoaded(loader.getExtensions());
      const create = async (sessionManager: SessionManager) => {
        const result = await createAgentSession({ cwd: root, agentDir: join(root, "agent"), modelRuntime: runtime, settingsManager: settings, resourceLoader: loader, sessionManager, noTools: "builtin" });
        bindMcpBridgeOwner(result.session, loader, owner); return result;
      };
      if (mode === "runtime-dispose") {
        sessionRuntime = await createAgentSessionRuntime(async ({ sessionManager }) => ({ ...await create(sessionManager), services: { cwd: root, agentDir: join(root, "agent"), modelRuntime: runtime, settingsManager: settings, resourceLoader: loader, diagnostics: [] }, diagnostics: [] }), { cwd: root, agentDir: join(root, "agent"), sessionManager: SessionManager.inMemory(root) });
        session = sessionRuntime.session;
      } else ({ session } = await create(SessionManager.inMemory(root)));
      if (mode !== "unbound") await session.bindExtensions({ mode: "rpc", onError: error => errors.push(error.error) });
      session.sessionManager.appendMessage({ role: "user", content: "Synthetic retained history", timestamp: 1 });
      const id = session.sessionId, history = JSON.stringify(session.sessionManager.getEntries());
      const initialMemory = process.memoryUsage(); const cpu = process.cpuUsage();
      loop.enable(); await Bun.sleep(5); startCounters();
      if (mode === "success" || mode === "runtime-dispose" || mode === "shutdown-error") {
        for (let revision = 2; revision <= reloads + 1; revision++) {
          await prepare(revision);
          assert.equal(leases.at(-1)!.env().FIXTURE_MCP_BEARER, `SYNTHETIC_BEARER_${revision - 1}`);
          const start = performance.now();
          await session.reload({ beforeSessionStart: () => { order.push(`barrier:${revision}`); } }); times.push(performance.now() - start);
          assert.equal(leases[revision - 2].released, 1); assert.equal(leases[revision - 2].env().FIXTURE_MCP_BEARER, undefined);
          assert.equal(leases.at(-1)!.env().FIXTURE_MCP_BEARER, `SYNTHETIC_BEARER_${revision}`);
          assert.equal(leases.at(-1)!.released, 0); assert.notEqual(leases.at(-1)!.revision, leases[revision - 2].revision);
          await Bun.sleep(1);
        }
        assert.equal(unrelatedLoads, reloads + 1);
        for (let n = 1; n <= reloads; n++) {
          assert(order.indexOf(`shutdown:${n}`) < order.indexOf(`release:${n}`));
          assert(order.indexOf(`release:${n}`) < order.indexOf(`acquire:${n + 1}`));
          assert(order.indexOf(`barrier:${n + 1}`) < order.indexOf(`start:${n + 1}`));
        }
        assert.equal(errors.length, mode === "shutdown-error" ? reloads : 0);
      } else if (mode === "failed-reload" || mode === "unbound") {
        await prepare(2); fail = true;
        await assert.rejects(session.reload({ beforeSessionStart: () => { barrierCalls++; } }), /did not load/);
        assert.equal(loader.getExtensions().errors.length, 1);
        assert.equal(barrierCalls, 0); assert.equal(leases.length, 2); assert.equal(leases[0].released, 1); assert.equal(leases[1].released, 1);
        assert(!order.includes("start:2"));
      } else if (mode === "overlap") {
        await prepare(2);
        let enter!: () => void, finish!: () => void;
        const entered = new Promise<void>(resolve => { enter = resolve; });
        const gate = new Promise<void>(resolve => { finish = resolve; });
        const pending = session.reload({ beforeSessionStart: async () => {
          barrierCalls++; enter();
          await assert.rejects(session!.reload(), /already in progress/);
          await gate;
        } });
        await entered; await assert.rejects(session.reload(), /already in progress/);
        assert.equal(leases.length, 2); finish(); await pending;
        await prepare(3); await session.reload(); assert.equal(leases.length, 3); assert.equal(barrierCalls, 1);
      } else if (mode === "disposed-barrier") {
        await prepare(2);
        await assert.rejects(session.reload({ beforeSessionStart: () => { session!.dispose(); } }), /did not load/);
        assert(!order.includes("start:2"));
        await assert.rejects(session.reload(), /disposed|did not load|invalidated/i);
      } else if (mode === "failed-barrier") {
        await prepare(2);
        await assert.rejects(session.reload({ beforeSessionStart: () => { throw Error("Synthetic barrier failure"); } }), /Synthetic barrier failure/);
        assert(!order.includes("start:2"));
      }
      stopCounters(); loop.disable();
      assert.equal(session.sessionId, id); assert.equal(JSON.stringify(session.sessionManager.getEntries()), history);
      if (sessionRuntime) { await sessionRuntime.dispose(); await sessionRuntime.dispose(); sessionRuntime = undefined; }
      session.dispose(); session.dispose();
      console.log(JSON.stringify({ measurement: true, mode, version, adapterVersion, acquired: leases.length, released: leases.filter(row => row.released === 1).length, historyPreserved: true, reloadMs: times, cpu: process.cpuUsage(cpu), initialMemory, finalMemory: process.memoryUsage(), instrument, counters: instrument ? counts : null, eventLoop: { resolutionMs: 1, count: loop.count, meanMs: loop.count ? loop.mean / 1e6 : null, maxMs: loop.max / 1e6 }, database: "not exercised", scope: "public SDK lease lifecycle only; disabled synthetic adapter server; not active MCP teardown or engine-switch acceptance" }));
    }
  }
  owner.dispose(); owner.dispose();
  assert(leases.every(row => row.released === 1)); assert(leases.every(row => row.env().FIXTURE_MCP_BEARER === undefined));
  assert.equal(network, 0);
  console.log(JSON.stringify({ mode, version, adapterVersion, status: "pass", acquired: leases.length, released: leases.length, network, initialisationWrites: mode === "commit-failure" ? "not measured" : 0, historyPreserved: session ? true : "not exercised" }));
} finally {
  stopCounters(); loop.disable(); session?.dispose(); owner.dispose(); resetMcpStartupStateForTests(); globalThis.fetch = savedFetch; rmSync(root, { recursive: true, force: true });
}
