import "./src/test-guard.js";
import { test, expect, spyOn } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getConfigPath } from "../../runtime/src/core/config-context.js";
import { hydrateMcpKeychainCredentials, clearHydratedMcpCredentials } from "../../runtime/src/secure/mcp-keychain.js";
import { createHostMcp } from "../../runtime/durable-engine/src/host-mcp.js";
import { BACKGROUND_CONTEXT, withAbortSignal } from "../../runtime/durable-engine/qualification/context.ts";
import * as credentials from "../../runtime/src/secure/mcp-keychain.js";
import { StreamableHttpTransport } from "../../node_modules/@earendil-works/pi-mcp";

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

// A JSON-RPC endpoint fixture, not a session/owner substitute. Every case below
// constructs the actual native owner, public MCP client and constrained transport.
async function endpoint(onCall: (message: string, signal?: AbortSignal | null) => Promise<void>) {
  const previous = globalThis.fetch;
  const workspace = process.env.PICLAW_WORKSPACE!;
  mkdirSync(join(workspace, '.pi'), { recursive: true });
  writeFileSync(getConfigPath(), JSON.stringify({ domains: { mcp: { engine: 'native', codemode: 'on' } } }), { mode: 0o600 });
  writeFileSync(join(workspace, '.pi/mcp.json'), JSON.stringify({ mcpServers: { fixture: { url: 'http://127.0.0.1:18081/mcp', bearerTokenKeychain: 'fixture/token', bearerTokenEnv: 'PICLAW_NATIVE_HTTP_TEST_TOKEN', directTools: false } } }));
  const entries = await hydrateMcpKeychainCredentials(workspace, async name => ({ name, type: 'token', secret: 'fixture-secret', username: null }));
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    expect(request.url).toBe('http://127.0.0.1:18081/mcp');
    expect(request.headers.get('authorization')).toBe('Bearer fixture-secret');
    if (request.method !== 'POST') return new Response(null, { status: 202 });
    const rpc = await request.json() as { id?: number; method: string; params?: { protocolVersion?: string; arguments?: { message?: string } } };
    if (rpc.id === undefined) return new Response(null, { status: 202 });
    let result: unknown = {};
    if (rpc.method === 'initialize') result = { protocolVersion: rpc.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } };
    if (rpc.method === 'tools/list') result = { tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } }] };
    if (rpc.method === 'tools/call') {
      const message = rpc.params?.arguments?.message ?? '';
      await onCall(message, init?.signal);
      init?.signal?.throwIfAborted();
      result = { content: [{ type: 'text', text: message }], privateDiagnostic: 'server-private-do-not-publish' };
    }
    return Response.json({ jsonrpc: '2.0', id: rpc.id, result });
  }, { preconnect() {} }) as typeof fetch;
  return () => { globalThis.fetch = previous; clearHydratedMcpCredentials(entries); };
}

for (const mode of ['abort', 'revocation'] as const) test(`native MCP concurrent calls keep ${mode} and source authority invocation-local`, async () => {
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const calls: string[] = [];
  const restore = await endpoint(async message => { calls.push(message); if (message === 'held') { entered.resolve(); await release.promise; } });
  const firstApi = {}, secondApi = {};
  const controller = new AbortController();
  let revoked = false;
  let owner: Awaited<ReturnType<typeof createHostMcp>> | undefined;
  let pending: Promise<{ value: unknown } | { error: unknown }> | undefined;
  try {
    owner = await createHostMcp({ assertCurrent() {}, captureSource: async api => {
      expect(api === firstApi || api === secondApi).toBe(true);
      return () => { if (api === firstApi && revoked) throw Error('first source revoked'); };
    } });
    const tool = owner.tools[0]!;
    pending = tool.execute({ message: 'held' }, firstApi as never, withAbortSignal(controller.signal, BACKGROUND_CONTEXT)).then(value => ({ value }), error => ({ error }));
    await entered.promise;
    const second = await tool.execute({ message: 'independent' }, secondApi as never, BACKGROUND_CONTEXT);
    expect(JSON.stringify(second)).toContain('independent');
    expect(JSON.stringify(second)).not.toContain('server-private-do-not-publish');
    if (mode === 'abort') controller.abort(Error('first invocation cancelled')); else revoked = true;
    release.resolve();
    const outcome = await pending;
    expect('error' in outcome).toBe(true);
    expect('value' in outcome).toBe(false);
    const later = await tool.execute({ message: 'still-authorised' }, secondApi as never, BACKGROUND_CONTEXT);
    expect(JSON.stringify(later)).toContain('still-authorised');
    expect(calls).toEqual(['held', 'independent', 'still-authorised']);
  } finally {
    release.resolve(); await pending;
    try { await owner?.close(); } finally { restore(); }
  }
});

test('native MCP uncertain close retains its credential lease and never certifies or retries disposal', async () => {
  const restore = await endpoint(async () => {});
  let lease: ReturnType<typeof credentials.acquireMcpSessionBridge> | undefined;
  const acquireLease = credentials.acquireMcpSessionBridge;
  const acquire = spyOn(credentials, 'acquireMcpSessionBridge').mockImplementation(() => {
    lease = acquireLease(); return lease;
  });
  const originalClose = StreamableHttpTransport.prototype.close;
  const failure = Error('synthetic post-close uncertainty');
  const close = spyOn(StreamableHttpTransport.prototype, 'close').mockImplementation(async function (this: StreamableHttpTransport) {
    await originalClose.call(this); throw failure;
  });
  let owner: Awaited<ReturnType<typeof createHostMcp>> | undefined;
  let released: ReturnType<typeof spyOn> | undefined;
  try {
    owner = await createHostMcp({ assertCurrent() {}, captureSource: async () => () => {} });
    expect(acquire).toHaveBeenCalledTimes(1);
    released = spyOn(lease!, 'release');
    const pending = owner.close();
    expect(owner.close()).toBe(pending);
    const outcome = await pending.then(() => null, error => error);
    expect(outcome).toBeInstanceOf(AggregateError);
    expect(outcome.errors).toContain(failure);
    expect(await owner.close().then(() => null, error => error)).toBe(outcome);
    expect(close).toHaveBeenCalledTimes(1);
    expect(released).not.toHaveBeenCalled();
    expect(() => owner!.assertCurrent()).toThrow('no longer current');
    await expect(owner.tools[0]!.execute({ message: 'forbidden-after-close' }, {} as never, BACKGROUND_CONTEXT)).rejects.toThrow();
  } finally {
    close.mockRestore(); acquire.mockRestore(); released?.mockRestore();
    // The real inner endpoint is already closed; the injected failure was after
    // confirmation. Release only the disposable fixture's retained lease here.
    lease?.release(); restore();
  }
});
