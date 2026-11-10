import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { AssistantMessage, JsonObject, Model, Provider, ToolCall } from "@earendil-works/pi-ai";
import type { JsonRpcMessage, McpTransport, McpTransportCloseListener, McpTransportErrorListener, McpTransportMessageListener } from "@earendil-works/pi-mcp";

const root = process.env.MCP_PUBLIC_FIXTURE_ROOT ?? mkdtempSync(join(tmpdir(), "mcp-public-100-"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
let networkAttempts = 0;
const originalFetch = globalThis.fetch;
const deny = () => { networkAttempts++; throw new Error("Network forbidden in synthetic transport fixture"); };
globalThis.fetch = Object.assign(deny, { preconnect: deny }) as typeof fetch;
const { createAgentSession, createAgentSessionRuntime, createMcpExtension, createToolSearchExtension, createCodemodeExtension, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = await import("@earendil-works/pi-coding-agent");
const { InMemoryCredentialStore, createAssistantMessageEventStream } = await import("@earendil-works/pi-ai");
assert.equal(JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.resolve("@earendil-works/pi-coding-agent"))), "utf8")).version, "1.5.2");
const events: string[] = [], nested: Array<{ name: string; parent?: string }> = [];
let generation = 0, blocked = false;
const exposure = process.argv[2] ?? "deferred";
assert.ok(exposure === "deferred" || exposure === "codemode");
const transports: SyntheticTransport[] = [];
class SyntheticTransport implements McpTransport {
  messages = new Set<McpTransportMessageListener>();
  errors = new Set<McpTransportErrorListener>();
  closes = new Set<McpTransportCloseListener>();
  closed = false;
  calls = 0;
  arguments: unknown[] = [];
  constructor(readonly generation: number) {}
  onMessage(listener: McpTransportMessageListener) { this.messages.add(listener); return () => { this.messages.delete(listener); }; }
  onError(listener: McpTransportErrorListener) { this.errors.add(listener); return () => { this.errors.delete(listener); }; }
  onClose(listener: McpTransportCloseListener) { this.closes.add(listener); return () => { this.closes.delete(listener); }; }
  async start() { events.push(`start:${this.generation}`); }
  async send(message: JsonRpcMessage) {
    assert.equal(this.closed, false);
    assert.ok("method" in message);
    if (!("id" in message)) { assert.equal(message.method, "notifications/initialized"); return; }
    let result: unknown;
    switch (message.method) {
      case "initialize": result = { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "0" }, instructions: "Synthetic orchard tools" }; break;
      case "tools/list": result = { tools: [
        { name: "orchard", description: "Count apples in an orchard", inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] } },
        { name: "hidden", description: "Hidden orchard tool", inputSchema: { type: "object", properties: {} } },
      ] }; break;
      case "tools/call": {
        this.calls++;
        const params = message.params as { name: string; arguments: unknown; _meta?: { progressToken?: number } };
        assert.equal(params.name, "orchard");
        assert.ok(JSON.stringify(params.arguments) === JSON.stringify({ value: "apples" }) || JSON.stringify(params.arguments) === JSON.stringify({ value: "123" }));
        this.arguments.push(params.arguments);
        assert.equal(typeof params._meta?.progressToken, "number");
        result = { content: [{ type: "text", text: "orchard result" }], structuredContent: { count: 3 }, _meta: { secret: "SYNTHETIC_META" } }; break;
      }
      default: throw new Error("Unexpected MCP method");
    }
    for (const listener of this.messages) listener({ jsonrpc: "2.0", id: message.id, result });
  }
  async close() { if (this.closed) return; this.closed = true; events.push(`close:${this.generation}`); for (const listener of this.closes) listener(); }
}
const credentials = new InMemoryCredentialStore();
const modelRuntime = await ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
const model: Model<"openai-completions"> = { id: "scripted", provider: "synthetic-mcp-probe", name: "Scripted fixture", api: "openai-completions", baseUrl: "https://unused.invalid", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
let pendingCall: ToolCall | undefined, scriptedResponses = 0;
const scriptedStream = () => {
  scriptedResponses++;
  assert.ok(scriptedResponses <= 20, "Unexpected synthetic provider loop");
  const call = pendingCall; pendingCall = undefined;
  const message: AssistantMessage = { role: "assistant", content: call ? [call] : [{ type: "text", text: "Scripted fixture complete" }],
    api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: call ? "toolUse" : "stop",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  const stream = createAssistantMessageEventStream(); stream.push({ type: "done", reason: call ? "toolUse" : "stop", message }); return stream;
};
const provider: Provider = { id: model.provider, name: "Synthetic MCP probe", getModels: () => [model],
  auth: { apiKey: { name: "No external credential", login: async () => { throw new Error("Login forbidden"); }, resolve: async () => ({ auth: {}, source: "synthetic" }) } },
  stream: scriptedStream, streamSimple: scriptedStream,
};
modelRuntime.registerNativeProvider(provider);
await modelRuntime.refresh({ allowNetwork: false });
const settingsManager = SettingsManager.inMemory();
settingsManager.applyOverrides({ compaction: { enabled: false }, retry: { enabled: false } });
const loader = new DefaultResourceLoader({ cwd: root, agentDir: join(root, "agent"), settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
  extensionFactories: [createCodemodeExtension({ models: false }), createToolSearchExtension(), createMcpExtension({
    loadConfig: () => ({ servers: [{ name: "orchard", config: { command: "synthetic-never-spawned", exposure, toolExposure: { hidden: "hidden" } }, source: "fixture" }], errors: [], autoEnableCodemode: exposure === "codemode" }),
    createTransport(_entry, _cwd, auth) { assert.equal(auth, undefined); const transport = new SyntheticTransport(++generation); transports.push(transport); return transport; },
  }), pi => {
    pi.on("tool_call", event => { nested.push({ name: event.toolName, parent: event.parentToolCallId }); if (blocked && event.toolName === "mcp__orchard__orchard") return { block: true, reason: "Synthetic policy refusal" }; });
  }],
});
await loader.reload();
const runtime = await createAgentSessionRuntime(async ({ sessionManager }) => {
  const result = await createAgentSession({ cwd: root, agentDir: join(root, "agent"), modelRuntime, model, sessionManager, settingsManager, resourceLoader: loader, noTools: "builtin" });
  await result.session.bindExtensions({ mode: "rpc", onError: () => { throw new Error("Extension error"); } });
  return { ...result, services: { cwd: root, agentDir: join(root, "agent"), modelRuntime, settingsManager, resourceLoader: loader, diagnostics: [] }, diagnostics: [] };
}, { cwd: root, agentDir: join(root, "agent"), sessionManager: SessionManager.inMemory(root) });
const wait = async () => { const end = Date.now() + 4000; while (!runtime.session.getAllTools().some(tool => tool.name === "mcp__orchard__orchard")) { if (Date.now() > end) throw new Error("Tool registration timeout"); await Bun.sleep(5); } };
try {
  await wait();
  const session = runtime.session;
  session.sessionManager.appendMessage({ role: "user", content: "preserved fixture history", timestamp: Date.now() });
  assert.ok(session.getActiveToolNames().includes(exposure === "deferred" ? "tool_search" : "codemode"));
  if (exposure === "codemode") session.setActiveToolsByName([...session.getActiveToolNames(), "tool_search"]);
  assert.ok(!session.getActiveToolNames().includes("mcp__orchard__orchard"));
  assert.ok(session.getCallableToolNames().includes("mcp__orchard__orchard"));
  assert.ok(!session.getCallableToolNames().includes("mcp__orchard__hidden"));
  // A deterministic in-memory provider issues real tool-call messages. The
  // session supplies the nested execution context; no private runner mutation.
  const execute = async (id: string, name: string, args: JsonObject) => {
    pendingCall = { type: "toolCall", id, name, arguments: args };
    await session.prompt("Run the next scripted fixture call.");
    assert.equal(pendingCall, undefined);
    const result = session.messages.findLast(message => message.role === "toolResult" && message.toolCallId === id);
    assert.ok(result && result.role === "toolResult", "Missing scripted tool result");
    return result;
  };
  const search = await execute("search-fixture", "tool_search", { query: "orchard apples", limit: 4 });
  assert.ok(search.details && typeof search.details === "object" && "loaded" in search.details);
  assert.deepEqual(search.details.loaded, ["mcp__orchard__orchard"]);
  assert.ok(session.getActiveToolNames().includes("mcp__orchard__orchard"));
  session.setActiveToolsByName([...session.getActiveToolNames(), "codemode"]);
  const script = 'const names=await searchTools("orchard apples");const ns=await describeNamespace("orchard");const result=await tools.mcp__orchard__orchard({value:"apples"});text({names:names.map(x=>x.name),instructions:ns.instructions,result});';
  const result = await execute("codemode-fixture", "codemode", { code: script });
  assert.equal(result.isError, false, JSON.stringify(result));
  const text = JSON.stringify(result);
  assert.ok(text.includes("orchard result")); assert.ok(text.includes("Synthetic orchard tools")); assert.ok(!text.includes("SYNTHETIC_META"));
  const output = result.content.flatMap(block => block.type === "text" ? [block.text] : []).find(value => value.startsWith('{"names"'));
  assert.ok(output, "Missing codemode discovery result");
  assert.deepEqual(JSON.parse(output), { names: ["mcp__orchard__orchard"], instructions: "Synthetic orchard tools",
    result: { content: [{ type: "text", text: "orchard result" }], structuredContent: { count: 3 } } });
  assert.ok(result.nestedCalls?.calls.some(call => call.name === "mcp__orchard__orchard" && call.id === "codemode-fixture/1"));
  assert.deepEqual(nested, [{ name: "tool_search", parent: undefined }, { name: "codemode", parent: undefined }, { name: "mcp__orchard__orchard", parent: "codemode-fixture" }]);
  assert.equal(transports[0]!.calls, 1);
  blocked = true;
  const refused = await execute("codemode-blocked", "codemode", { code: 'await tools.mcp__orchard__orchard({value:"apples"});' });
  assert.equal(refused.isError, true); assert.ok(JSON.stringify(refused).includes("Synthetic policy refusal")); assert.equal(transports[0]!.calls, 1);
  blocked = false;
  const invalid = await execute("codemode-invalid", "codemode", { code: 'await tools.mcp__orchard__orchard({});' });
  assert.equal(invalid.isError, true); assert.equal(transports[0]!.calls, 1);
  assert.match(JSON.stringify(invalid), /Validation failed for tool.*mcp__orchard__orchard/);
  assert.match(JSON.stringify(invalid), /value: missing/i);
  const hidden = await execute("codemode-hidden", "codemode", { code: 'await tools.mcp__orchard__hidden({});' });
  assert.equal(hidden.isError, true); assert.equal(transports[0]!.calls, 1);
  assert.ok(JSON.stringify(hidden).includes("tools.mcp__orchard__hidden does not exist."));
  const coerced = await execute("codemode-coercion", "codemode", { code: 'await tools.mcp__orchard__orchard({value:123});' });
  assert.equal(coerced.isError, false); assert.equal(transports[0]!.calls, 2);
  assert.deepEqual(transports[0]!.arguments, [{ value: "apples" }, { value: "123" }]);
  const id = session.sessionId, history = JSON.stringify(session.sessionManager.getEntries());
  await session.reload(); await wait();
  assert.equal(session.sessionId, id); assert.equal(JSON.stringify(session.sessionManager.getEntries()), history);
  assert.ok(session.getActiveToolNames().includes("mcp__orchard__orchard"));
  assert.equal(transports.length, 2);
  assert.ok(events.includes("close:1") && events.includes("start:2"));
  assert.ok(events.indexOf("close:1") < events.indexOf("start:2"));
  const afterReload = await execute("codemode-after-reload", "codemode", { code: script });
  assert.equal(afterReload.isError, false, JSON.stringify(afterReload));
  assert.equal(transports[0]!.calls, 2); assert.equal(transports[1]!.calls, 1);
  assert.deepEqual(transports[1]!.arguments, [{ value: "apples" }]);
  assert.ok(afterReload.nestedCalls?.calls.some(call => call.id === "codemode-after-reload/1" && call.name === "mcp__orchard__orchard"));
  await runtime.dispose();
  assert.ok(transports.every(transport => transport.closed)); assert.equal(networkAttempts, 0);
  assert.equal(scriptedResponses, 14);
  assert.deepEqual(events, ["start:1", "close:1", "start:2", "close:2"]);
  console.log(JSON.stringify({ version: "1.5.2", runtime: `Bun ${Bun.version}`, transport: "synthetic_public_factory", exposure, deferredDiscovered: true, hiddenExcluded: true, codemodeSearchAndCall: true,
    nestedPolicyAndParentId: true, missingRequiredArgumentBlocked: true, numericStringCoercionObserved: true, hiddenInvocationBlocked: true, restoredAfterReload: true, postReloadCallUsesNewTransport: true, sessionAndHistoryPreserved: true, transportsClosed: true, networkAttempts,
    scriptedResponses, externalInference: "not_invoked", topLevelToolHooks: "scripted_provider_real_session_pipeline", productionAdoption: false }));
} finally {
  try { await runtime.dispose(); }
  finally { globalThis.fetch = originalFetch; rmSync(root, { recursive: true, force: true }); }
}
