import "./src/test-guard.js";
import { test, expect } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getConfigPath } from "../../runtime/src/core/config-context.js";
import { hydrateMcpKeychainCredentials, clearHydratedMcpCredentials } from "../../runtime/src/secure/mcp-keychain.js";
import { createHostMcp } from "../../runtime/durable-engine/src/host-mcp.js";
import { BACKGROUND_CONTEXT } from "../../runtime/durable-engine/qualification/context.ts";

test("native HTTP MCP uses the captured keychain lease and fences actual sends", async () => {
  let calls = 0, revoked = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    expect(req.url).toBe("http://127.0.0.1:18081/mcp");
    expect(req.headers.get("authorization")).toBe("Bearer fixture-secret");
    if (req.method !== "POST") return new Response(null, { status: 202 });
    const message = await req.json() as { id?: number; method: string; params?: { protocolVersion?: string; arguments?: unknown } };
    if (message.id === undefined) return new Response(null, { status: 202 });
    const result = message.method === "initialize" ? { protocolVersion: message.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } }
      : message.method === "tools/list" ? { tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] } }] }
      : message.method === "tools/call" ? (++calls, { content: [{ type: "text", text: JSON.stringify(message.params?.arguments) }] }) : {};
    return Response.json({ jsonrpc: "2.0", id: message.id, result });
  }, { preconnect() {} }) as typeof fetch;
  const workspace = process.env.PICLAW_WORKSPACE!;
  mkdirSync(join(workspace, ".pi"), { recursive: true });
  writeFileSync(getConfigPath(), JSON.stringify({ domains: { mcp: { engine: "native", codemode: "on" } } }), { mode: 0o600 });
  writeFileSync(join(workspace, ".pi/mcp.json"), JSON.stringify({ mcpServers: { fixture: { url: "http://127.0.0.1:18081/mcp", bearerTokenKeychain: "fixture/token", bearerTokenEnv: "PICLAW_NATIVE_HTTP_TEST_TOKEN", directTools: false } } }));
  const entries = await hydrateMcpKeychainCredentials(workspace, async name => ({ name, type: "token", secret: "fixture-secret", username: null }));
  let mcp: Awaited<ReturnType<typeof createHostMcp>> | undefined;
  const check = () => { if (revoked) throw Error("source revoked"); };
  try {
    mcp = await createHostMcp({ assertCurrent() {}, captureSource: async () => check });
    expect(mcp.tools.map(tool => tool.name)).toEqual(["mcp__fixture__echo"]);
    const tool = mcp.tools[0]!;
    const result = await tool.execute({ message: "NATIVE_HTTP_OK" }, {} as never, BACKGROUND_CONTEXT);
    expect(JSON.stringify(result)).toContain("NATIVE_HTTP_OK");
    expect(calls).toBe(1);
    revoked = true;
    await expect(tool.execute({ message: "FORBIDDEN" }, {} as never, BACKGROUND_CONTEXT)).rejects.toThrow();
    expect(calls).toBe(1);
  } finally { await mcp?.close(); clearHydratedMcpCredentials(entries); globalThis.fetch = originalFetch; }
});
