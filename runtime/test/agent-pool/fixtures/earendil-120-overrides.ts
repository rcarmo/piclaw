/** Trusted-project config through public SDK/MCP extension, no deep imports. */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { McpTransport, JsonRpcMessage, McpTransportMessageListener } from "@earendil-works/pi-mcp";
const root = process.env.CANDIDATE_102_ROOT!; assert(root); const agentDir = join(root, "agent");
process.env.PI_CODING_AGENT_DIR = agentDir; mkdirSync(agentDir, { recursive: true }); mkdirSync(join(root, ".pi"), { recursive: true });
const mode = process.argv[2]; assert(["disabled-trusted", "disabled-untrusted", "exposure", "invalid-extra", "replacement"].includes(mode));
const globalConfig = { mcpServers: { fixture: { command: "synthetic-global-never-spawned", args: ["kept"], env: { FIXTURE: "synthetic-public-marker" }, exposure: "hidden" } }, other: "keep" };
const patch = mode.startsWith("disabled") ? { enabled: false } : mode === "exposure" ? { exposure: "direct", toolExposure: { ping: "hidden" } } : mode === "invalid-extra" ? { enabled: false, env: { FIXTURE: "forbidden-change" } } : { command: "synthetic-project-never-spawned", exposure: "direct" };
const globalPath = join(agentDir, "mcp.json"), projectPath = join(root, ".pi/mcp.json");
writeFileSync(globalPath, JSON.stringify(globalConfig)); writeFileSync(projectPath, JSON.stringify({ mcpServers: { fixture: patch }, unrelated: "keep" }));
const before = [readFileSync(globalPath, "utf8"), readFileSync(projectPath, "utf8")];
const { createAgentSession, createAgentSessionRuntime, createMcpExtension, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = await import("@earendil-works/pi-coding-agent");
const { InMemoryCredentialStore } = await import("@earendil-works/pi-ai");
const trusted = mode !== "disabled-untrusted", entries: any[] = [], errors: string[] = [], notices: string[] = []; let closed = 0, listed = 0;
class Transport implements McpTransport {
  closed = false;
  listeners = new Set<McpTransportMessageListener>();
  onMessage(fn: McpTransportMessageListener) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  onError() { return () => {}; } onClose() { return () => {}; }
  async start() {}
  async close() { if (!this.closed) { closed++; this.closed = true; } }
  async send(message: JsonRpcMessage) {
    if (!("id" in message)) return;
    assert("method" in message);
    if (message.method === "tools/list") listed++;
    const result = message.method === "initialize" ? { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "synthetic", version: "0" } }
      : message.method === "tools/list" ? { tools: [{ name: "ping", inputSchema: { type: "object", properties: {} } }] } : {};
    for (const listener of this.listeners) listener({ jsonrpc: "2.0", id: message.id, result });
  }
}
const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
const settings = SettingsManager.inMemory({ defaultProjectTrust: trusted ? "always" : "never" }, { projectTrusted: trusted });
const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
  extensionFactories: [createMcpExtension({ createTransport: entry => { entries.push(structuredClone(entry)); return new Transport(); } })] });
await loader.reload({ resolveProjectTrust: async () => trusted }); settings.setProjectTrusted(trusted);
const host = await createAgentSessionRuntime(async ({ sessionManager }) => {
  const result = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, settingsManager: settings, sessionManager, resourceLoader: loader, noTools: "all" });
  return { ...result, services: { cwd: root, agentDir, modelRuntime: runtime, settingsManager: settings, resourceLoader: loader, diagnostics: [] }, diagnostics: [] };
}, { cwd: root, agentDir, sessionManager: SessionManager.inMemory(root) });
const session = host.session;
try {
  await session.bindExtensions({ mode: "rpc", onError: error => { errors.push(error.error); }, uiContext: { notify: (message: string) => { notices.push(message); } } as any });
  const expected = mode === "disabled-trusted" ? 0 : 1;
  const settle = async (count: number) => {
    const deadline = performance.now() + 3000;
    while ((entries.length < count || listed < count) && performance.now() < deadline) await Bun.sleep(10);
    assert.equal(entries.length, count); assert.equal(listed, count);
  };
  await settle(expected);
  // Disabled trusted entry must not connect even after runtime import/startup settles.
  if (!expected) await Bun.sleep(80);
  assert.equal(entries.length, expected); assert.deepEqual(errors, []);
  if (expected) {
    const config = entries[0].config;
    if (mode === "replacement") { assert.equal(config.command, "synthetic-project-never-spawned"); assert.equal(config.env, undefined); assert.equal(config.args, undefined); assert.equal(config.exposure, "direct"); assert.equal(config.toolExposure, undefined); assert.equal(entries[0].scope, "project"); }
    else { assert.equal(config.command, "synthetic-global-never-spawned"); assert.deepEqual(config.args, ["kept"]); assert.deepEqual(config.env, { FIXTURE: "synthetic-public-marker" }); assert.equal(entries[0].scope, "global"); }
    if (mode === "exposure") { assert.equal(config.exposure, "direct"); assert.deepEqual(config.toolExposure, { ping: "hidden" }); assert.equal(entries[0].override, projectPath); }
    if (mode === "invalid-extra") { assert.equal(config.exposure, "hidden"); assert.equal(entries[0].override, undefined); }
    if (mode === "disabled-untrusted") assert.equal(entries[0].override, undefined);
  }
  await session.reload();
  await settle(expected * 2);
  if (expected) { assert.deepEqual(entries[1], entries[0]); assert.equal(closed, 1); }
  else await Bun.sleep(80);
  await session.abort(); await host.dispose();
  assert.equal(closed, expected * 2); assert.deepEqual(errors, []);
  assert.deepEqual([readFileSync(globalPath, "utf8"), readFileSync(projectPath, "utf8")], before);
  const guard = (globalThis as any).__ADMISSION_ENFORCEMENT__; assert.equal(guard.networkAttempts, 0); assert.equal(guard.childProcessAttempts, 0);
  console.log(JSON.stringify({ version: "1.5.2", mode, initialTransports: expected, reloadTransports: entries.length - expected, closedTransports: closed, guard, configUnmodified: true, actualLifecycle: "bind/reload/abort/await-runtime-dispose", noticesObserved: notices.length, scope: "public SDK project-trust/config read semantics; disabled server absence observed across two bounded80mssettle windows; management-write/real OAuth/provider gateway unqualified" }));
} finally { await host.dispose(); rmSync(root, { recursive: true, force: true }); }
