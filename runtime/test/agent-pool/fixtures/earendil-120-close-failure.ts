/** Public SDK observation: failed native transport close is not teardown proof. */
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createAgentSession, createAgentSessionRuntime, createMcpExtension, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import type { JsonRpcMessage, McpTransport, McpTransportMessageListener } from "@earendil-works/pi-mcp";
const root = process.env.CANDIDATE_102_ROOT!; assert(root); mkdirSync(root, { recursive: true });
const transports: Transport[] = [], errors: string[] = []; let listed = 0;
class Transport implements McpTransport {
  listeners = new Set<McpTransportMessageListener>(); attempts = 0; closed = false;
  constructor(readonly id: number) {}
  onMessage(fn: McpTransportMessageListener) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  onError() { return () => {}; } onClose() { return () => {}; } async start() {}
  async close() { this.attempts++; if (this.id === 1) throw Error("synthetic native close failure"); this.closed = true; }
  async send(message: JsonRpcMessage) {
    if (!("id" in message)) return; assert("method" in message); if (message.method === "tools/list") listed++;
    const result = message.method === "initialize" ? { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "0" } }
      : message.method === "tools/list" ? { tools: [{ name: "ping", inputSchema: { type: "object", properties: {} } }] } : {};
    for (const listener of this.listeners) listener({ jsonrpc: "2.0", id: message.id, result });
  }
}
const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
const settingsManager = SettingsManager.inMemory(); const agentDir = join(root, "agent");
const resourceLoader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager, noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true,
  extensionFactories: [createMcpExtension({ loadConfig: () => ({ servers: [{ name: "fixture", config: { command: "not-executed", exposure: "direct" }, source: "fixture" }], errors: [], autoEnableCodemode: false }),
    createTransport: () => { const t = new Transport(transports.length + 1); transports.push(t); return t; } })] });
await resourceLoader.reload();
const host = await createAgentSessionRuntime(async ({ sessionManager }) => {
  const result = await createAgentSession({ cwd: root, agentDir, modelRuntime, settingsManager, sessionManager, resourceLoader, noTools: "all" });
  return { ...result, services: { cwd: root, agentDir, modelRuntime, settingsManager, resourceLoader, diagnostics: [] }, diagnostics: [] };
}, { cwd: root, agentDir, sessionManager: SessionManager.inMemory(root) });
const ready = async (count: number) => { const deadline = performance.now() + 3000; while (listed < count && performance.now() < deadline) await Bun.sleep(5); assert.equal(listed, count); };
try {
  await host.session.bindExtensions({ onError: error => { errors.push(error.error); } }); await ready(1);
  host.session.sessionManager.appendMessage({ role: "user", content: "synthetic retained history", timestamp: 1 }); const history = JSON.stringify(host.session.sessionManager.getEntries());
  await host.session.reload(); await ready(2);
  assert.equal(transports[0].attempts, 1); assert.equal(transports[0].closed, false); assert.deepEqual(errors, []);
  assert.equal(JSON.stringify(host.session.sessionManager.getEntries()), history);
  await host.dispose(); assert.equal(transports[1].closed, true);
  const guard = (globalThis as any).__ADMISSION_ENFORCEMENT__; assert.equal(guard.networkAttempts, 0); assert.equal(guard.childProcessAttempts, 0);
  console.log(JSON.stringify({ version: "1.5.2", closeFailureObserved: true, reloadResolved: true, firstTransportClosed: false, secondTransportClosed: true, transportCount: 2, surfacedErrors: errors.length, guard,
    conclusion: "reload success is not proof of native transport shutdown; synthetic observation only, no Apply invocation or real sockets" }));
} finally { await host.dispose(); rmSync(root, { recursive: true, force: true }); }
