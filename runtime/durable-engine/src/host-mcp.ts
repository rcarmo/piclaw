import { AsyncLocalStorage } from "node:async_hooks";
import type { JsonRpcMessage } from "@earendil-works/pi-mcp";
import { Type } from "typebox";
import type { JsonValue } from "@earendil-works/chord/json";
import { defineTool, type ToolExecutionApi } from "@earendil-works/pi-durable";
import { McpClient } from "../../src/durable-legacy-sdk.js";
import { getMcpBridgeReadSnapshot, acquireMcpSessionBridge, assertMcpBridgeSourcesCurrent } from "../../src/secure/mcp-keychain.js";
import { readMcpInstancePolicy } from "../../src/core/config-mcp.js";
import { planMcpEnginePolicy } from "../../src/agent-pool/mcp-engine-plan.js";
import { createNativeStdio } from "../../src/agent-pool/mcp-native-stdio.js";
import { createNativeHttp } from "../../src/agent-pool/mcp-native-http.js";
import { nativeAuthorizationHeader, nativeHeadersCompatible } from "../../src/agent-pool/mcp-native-header-policy.js";
import { constrainNativeTransport } from "../../src/agent-pool/mcp-native-transport.js";
import { RuntimeStartupCleanupError } from "../../src/runtime/startup-cleanup-error.js";

/** Startup-owned, tools-only stdio or bounded HTTP profile. No adapter fallback. */
export async function createHostMcp(options: {
  offlineMaintenance?: boolean;
  assertCurrent(): void;
  captureSource(api: ToolExecutionApi): Promise<() => void>;
}) {
  const snapshot = getMcpBridgeReadSnapshot();
  const policy = readMcpInstancePolicy();
  const enabled = Object.entries(snapshot.adapterConfig.mcpServers).filter(([, server]) => server.disabled !== true);
  const tools: ReturnType<typeof defineTool>[] = [];
  const closes: (() => Promise<void>)[] = [];
  let sealed = false;
  let invalidated = false;
  let closing: Promise<void> | undefined;
  const scope = new AsyncLocalStorage<{ name: string; assertCurrent(): void; signal?: AbortSignal }>();
  const assertCurrent = () => {
    options.assertCurrent();
    if (sealed || invalidated || getMcpBridgeReadSnapshot().revision !== snapshot.revision || readMcpInstancePolicy().revision !== policy.revision) throw Error("Native MCP owner is no longer current");
    assertMcpBridgeSourcesCurrent();
  };
  // Maintenance validates metadata only: no credential lease or discovery.
  const deferredMaintenance = options.offlineMaintenance === true;
  let lease: ReturnType<typeof acquireMcpSessionBridge> | undefined;
  const close = () => {
    sealed = true;
    return closing ??= (async () => {
      const results = await Promise.allSettled(closes.map(close => close()));
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failures.length) throw new AggregateError(failures.map(r => r.reason), "Native MCP cleanup uncertain");
      lease?.release();
    })();
  };
  try {
    // Empty configuration has no effect, including on historical Adapter profiles.
    if (enabled.length || snapshot.dryRun.rows.some(row => row.status === "quarantined") || [...snapshot.diagnostics, ...snapshot.dryRun.diagnostics].some(row => row.serverName === "(configuration)")) {
      const plan = planMcpEnginePolicy(policy.policy, snapshot, { native: true, adapter: false, codemode: true });
      if (policy.policy.engine !== "native" || !plan.applicable || !plan.codemodeEnabled) throw Error(`Durable MCP configuration unavailable: ${JSON.stringify(plan.issues)}`);
      const allowed = new Set(["command", "args", "cwd", "env", "disabled", "directTools", "url", "headers", "bearerTokenEnv"]);
      for (const [name, original] of enabled) {
        const projected = snapshot.nativePreview.servers.find(server => server.name === name);
        const reference = (v: unknown): boolean => typeof v === "string" && /\$|\{env:|^!/.test(v);
        if (!projected || Object.keys(original).some(key => !allowed.has(key)) || original.directTools === true ||
          reference(original.command) || reference(original.cwd) || reference(original.url) || original.args?.some(reference) || Object.values(original.env ?? {}).some(reference) ||
          (!("command" in projected.config) && !nativeHeadersCompatible(projected.config.headers)) || !/^[A-Za-z0-9_]+$/.test(name)) throw Error("Durable MCP requires mapped stdio or explicitly authenticated bounded HTTP tools");
      }
      // Validate the entire configuration before acquiring credentials or starting processes.
      if (deferredMaintenance) { assertCurrent(); return { tools, close, assertCurrent, deferredMaintenance }; }
      lease = acquireMcpSessionBridge();
      for (const [name] of enabled) {
        assertCurrent();
        const server = snapshot.nativePreview.servers.find(server => server.name === name)!.config;
        const declarations = new Set<string>();
        const authority = {
          assertStart: assertCurrent,
          assertSend(message: JsonRpcMessage) {
            assertCurrent();
            if ("method" in message && message.method === "tools/call") {
              const call = scope.getStore();
              if (!call || !declarations.has(call.name) || (message.params as any)?.name !== call.name) throw Error("Native MCP call authority unavailable");
              call.signal?.throwIfAborted();
              call.assertCurrent(); // immediately before the actual stdin write
            }
          },
        };
        const raw = "command" in server
          ? createNativeStdio({ command: server.command, args: server.args ? [...server.args] : undefined, cwd: server.cwd, env: { ...server.env }, ...authority })
          : (() => {
            const headers = { ...server.headers };
            const runtimeEnv = lease!.resolveRuntimeEnv(name);
            for (const [key, value] of Object.entries(headers)) {
              const reference = /^Bearer \$\{([A-Z_][A-Z0-9_]*)\}$/.exec(value);
              if (reference) {
                const secret = runtimeEnv[reference[1]!];
                if (!secret) throw Error("Native HTTP credential unavailable");
                headers[key] = `Bearer ${secret}`;
              }
            }
            if (!nativeAuthorizationHeader(headers)) throw Error("Native HTTP requires explicit Authorization");
            return createNativeHttp(server.url, headers, authority);
          })();
        const constrained = constrainNativeTransport(raw);
        const client = new McpClient({ name: "piclaw-durable", version: "1", requestTimeoutMs: 10000 });
        let transportIssue: string | undefined;
        client.onError(error => {
          // Only fixed classifications leave this boundary, never server bodies or headers.
          if (error.message.includes("SSE")) transportIssue = "streaming response unsupported";
          else if (error.message.includes("authority")) transportIssue = "source authority unavailable";
          else if (error.message.includes("1 MiB")) transportIssue = "response bound exceeded";
          else transportIssue = "transport error";
        });
        client.onNotification("notifications/tools/list_changed", () => { invalidated = true; });
        client.onClose(() => { invalidated = true; });
        closes.push(async () => {
          const results = await Promise.allSettled([client.close(), constrained.close()]);
          const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
          if (failure) throw failure.reason;
        });
        await client.connect(constrained.transport);
        for (const declaration of await client.listTools({ timeoutMs: 10000 })) {
          if (!/^[A-Za-z0-9_]+$/.test(declaration.name) || declarations.has(declaration.name) || declaration.inputSchema?.type !== "object") throw Error("Unsupported native MCP tool declaration");
          declarations.add(declaration.name);
          const toolName = `mcp__${name}__${declaration.name}`;
          if (tools.some(tool => tool.name === toolName)) throw Error("Duplicate native MCP tool name");
          tools.push(defineTool<ReturnType<typeof Type.Unsafe<Record<string, unknown>>>>({ name: toolName, description: declaration.description ?? toolName,
            parameters: Type.Unsafe<Record<string, unknown>>(JSON.parse(JSON.stringify(declaration.inputSchema))),
            structuredOutputSchema: Type.Any(), callers: ["tools"], replay: "unsafe",
            async execute(args, api, context) {
              const guard = await options.captureSource(api);
              const check = () => { assertCurrent(); context.abortSignal?.throwIfAborted(); guard(); };
              check();
              let result;
              try { result = await scope.run({ name: declaration.name, assertCurrent: check, signal: context.abortSignal }, () => client.callTool(declaration.name, args, { signal: context.abortSignal, timeoutMs: 10000 })); }
              catch { throw Error(`Host MCP request failed${transportIssue ? `: ${transportIssue}` : ""}`); }
              check();
              // Project only supported public content, never server diagnostics/private fields.
              if (result.content.some(block => block.type !== "text")) throw Error("Unsupported MCP result content");
              return { isError: result.isError, output: result.content.map(block => ({ type: "text" as const, text: (block as { text: string }).text })), structuredOutput: { content: result.content.map(block => ({ type: "text", text: (block as { text: string }).text })), ...(result.isError ? { isError: true } : {}), ...(result.structuredContent ? { structuredContent: result.structuredContent as JsonValue } : {}) } };
            },
          }));
        }
      }
    }
    assertCurrent();
    return { tools, close, assertCurrent, deferredMaintenance };
  } catch (error) {
    try { await close(); } catch (cleanup) { throw new RuntimeStartupCleanupError([error, cleanup], "Native MCP startup cleanup uncertain"); }
    throw error;
  }
}
