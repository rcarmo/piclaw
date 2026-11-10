/** Synthetic public OAuth methods: no server socket, credentials or real fetch. */
import { beforeAll, afterAll, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { registerClient, authorizeMcp, McpOAuthProvider, MemoryOAuthStateStore, type AuthorizationServerMetadata, type McpOAuthStateStore } from "@earendil-works/pi-mcp/oauth";
const version = createRequire(import.meta.url)("@earendil-works/pi-mcp/package.json").version;
const serverUrl = "https://mcp.example.invalid/mcp", issuer = "https://auth.example.invalid";
const metadata: AuthorizationServerMetadata = { issuer, authorization_endpoint: issuer + "/authorize", token_endpoint: issuer + "/token", registration_endpoint: issuer + "/register", response_types_supported: ["code"], code_challenge_methods_supported: ["S256"], client_id_metadata_document_supported: true };
const document = { url: "https://client.example.invalid/document.json", redirectUrl: "http://127.0.0.1:1234/callback/synthetic" };
// Capture before setup assertions: Bun still runs afterAll when beforeAll fails.
const originalFetch = globalThis.fetch;
let externalAttempts = 0;
beforeAll(() => { expect(version).toBe("1.5.2"); const deny = () => { externalAttempts++; throw Error("external network forbidden"); }; globalThis.fetch = Object.assign(deny, { preconnect: deny }) as typeof fetch; });
afterAll(() => { globalThis.fetch = originalFetch; expect(externalAttempts).toBe(0); });
async function fixture(options: { stored?: boolean; document?: boolean; declineDocument?: boolean; meta?: AuthorizationServerMetadata | undefined; invalidDocument?: string; failStore?: boolean; failTokenStore?: boolean } = {}) {
  const stateStore = new MemoryOAuthStateStore(); let fail = false;
  const store: McpOAuthStateStore = { load: () => stateStore.load(), save: state => { if (fail || options.failTokenStore && state.tokens) throw Error("synthetic storage failure"); stateStore.save(state); } };
  const redirects: URL[] = [], calls: string[] = []; let documentCalls = 0;
  const provider = new McpOAuthProvider({ serverUrl, redirectUrl: "http://127.0.0.1:1234/callback", clientMetadata: { client_name: "Synthetic candidate" }, store,
    ...(options.document === false ? {} : { clientMetadataDocument: (received: AuthorizationServerMetadata | undefined) => { documentCalls++; expect(received).toEqual(options.meta ?? metadata); if (options.declineDocument) return undefined; return { ...document, ...(options.invalidDocument ? { url: options.invalidDocument } : {}) }; } }),
    onRedirect: url => { redirects.push(url); },
  });
  await provider.saveDiscoveryState({ authorizationServerUrl: issuer, authorizationServerMetadata: options.meta ?? metadata });
  if (options.stored) await provider.saveClientInformation({ client_id: "synthetic-stored-client" });
  fail = options.failStore === true;
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); calls.push(url);
    if (url === issuer + "/register") return Response.json({ client_id: "synthetic-dynamic-client", redirect_uris: [provider.redirectUrl] });
    if (url === issuer + "/token") { const params = new URLSearchParams(String(init?.body)); expect(params.get("client_id")).toBe(options.stored ? "synthetic-stored-client" : document.url); expect(params.get("redirect_uri")).toBe(document.redirectUrl); return Response.json({ access_token: "synthetic-access", token_type: "Bearer", refresh_token: "synthetic-refresh" }); }
    throw Error("unexpected synthetic request");
  };
  return { provider, stateStore, redirects, calls, fetcher, get documentCalls() { return documentCalls; } };
}
test("CIMD redirect uses document client ID/path and is not saved as registration", async () => {
  const f = await fixture(); expect(await authorizeMcp(f.provider, { serverUrl, fetch: f.fetcher })).toBe("REDIRECT");
  expect(f.documentCalls).toBe(1); expect(f.calls).toEqual([]);
  expect(f.redirects[0].searchParams.get("client_id")).toBe(document.url); expect(f.redirects[0].searchParams.get("redirect_uri")).toBe(document.redirectUrl);
  expect(await f.provider.clientInformation()).toBeUndefined(); expect(f.stateStore.load()?.clientInformation).toBeUndefined();
});
test("stored registration wins without invoking document selection", async () => {
  const f = await fixture({ stored: true }); expect(await authorizeMcp(f.provider, { serverUrl, fetch: f.fetcher })).toBe("REDIRECT");
  expect(f.documentCalls).toBe(0); expect(f.calls).toEqual([]); expect(f.redirects[0].searchParams.get("client_id")).toBe("synthetic-stored-client"); expect(f.redirects[0].searchParams.get("redirect_uri")).toBe(f.provider.redirectUrl);
});
test("no document dynamically registers and persists the assigned client", async () => {
  const f = await fixture({ document: false }); expect(await authorizeMcp(f.provider, { serverUrl, fetch: f.fetcher })).toBe("REDIRECT");
  expect(f.calls).toEqual([issuer + "/register"]); expect((await f.provider.clientInformation())?.client_id).toBe("synthetic-dynamic-client");
});
test("document selector may decline and use dynamic registration", async () => {
  const f = await fixture({ declineDocument: true }); expect(await authorizeMcp(f.provider, { serverUrl, fetch: f.fetcher })).toBe("REDIRECT");
  expect(f.documentCalls).toBe(1); expect(f.calls).toEqual([issuer + "/register"]); expect((await f.provider.clientInformation())?.client_id).toBe("synthetic-dynamic-client");
});
test("low-level document selector sees metadata even without advertised support", async () => {
  const f = await fixture({ meta: { ...metadata, client_id_metadata_document_supported: false } });
  expect(await authorizeMcp(f.provider, { serverUrl, fetch: f.fetcher })).toBe("REDIRECT"); expect(f.documentCalls).toBe(1); expect(f.calls).toEqual([]);
  // Capability admission is the host callback's responsibility; this public
  // low-level contract does not certify the coding-agent CIMD UI policy.
  expect(f.redirects[0].searchParams.get("client_id")).toBe(document.url);
});
for (const url of ["http://client.example.invalid/document.json", "https://client.example.invalid/"]) test(`invalid document is rejected before redirect/token: ${url}`, async () => {
  const f = await fixture({ invalidDocument: url }); await expect(authorizeMcp(f.provider, { serverUrl, fetch: f.fetcher })).rejects.toThrow("Invalid OAuth client metadata URL"); expect(f.calls).toEqual([]); expect(f.redirects).toEqual([]);
});
test("document code exchange uses selected redirect and preserves requested scope", async () => {
  const f = await fixture(); await f.provider.saveCodeVerifier("synthetic-pkce-verifier");
  expect(await authorizeMcp(f.provider, { serverUrl, authorizationCode: "synthetic-code", iss: issuer, scope: "read write", fetch: f.fetcher })).toBe("AUTHORIZED");
  expect(f.calls).toEqual([issuer + "/token"]); expect((await f.provider.tokens())?.scope).toBe("read write"); expect(await f.provider.clientInformation()).toBeUndefined();
});
test("wrong issuer denies before code exchange", async () => {
  const f = await fixture(); await f.provider.saveCodeVerifier("synthetic-verifier");
  await expect(authorizeMcp(f.provider, { serverUrl, authorizationCode: "synthetic-code", iss: "https://wrong.example.invalid", fetch: f.fetcher })).rejects.toThrow(); expect(f.calls).toEqual([]); expect(await f.provider.tokens()).toBeUndefined();
});
test("required issuer denies missing issuer before token exchange", async () => {
  const f = await fixture({ meta: { ...metadata, authorization_response_iss_parameter_supported: true } }); await f.provider.saveCodeVerifier("synthetic-verifier");
  await expect(authorizeMcp(f.provider, { serverUrl, authorizationCode: "synthetic-code", fetch: f.fetcher })).rejects.toThrow(); expect(f.calls).toEqual([]);
});
test("early state-store failure propagates before token exchange or redirect", async () => {
  const f = await fixture({ failStore: true }); await expect(authorizeMcp(f.provider, { serverUrl, fetch: f.fetcher })).rejects.toThrow("synthetic storage failure"); expect(f.calls).toEqual([]); expect(f.redirects).toEqual([]); expect(f.stateStore.load()?.tokens).toBeUndefined();
});
test("token-store failure after successful exchange rejects without persisting tokens", async () => {
  const f = await fixture({ failTokenStore: true }); await f.provider.saveCodeVerifier("synthetic-verifier");
  await expect(authorizeMcp(f.provider, { serverUrl, authorizationCode: "synthetic-code", iss: issuer, fetch: f.fetcher })).rejects.toThrow("synthetic storage failure");
  expect(f.calls).toEqual([issuer + "/token"]); expect(f.stateStore.load()?.tokens).toBeUndefined(); expect(f.redirects).toEqual([]);
});

for(const [redirect,expected]of [['http://127.0.0.1:1234/callback','native'],['http://localhost:1234/callback','native'],['piclaw-fixture:/callback','native'],['https://example.invalid/callback','web']]as const)test('1.5.2 OAuth registration application type '+expected+' '+redirect,async()=>{
 let body:any;await registerClient(issuer,{clientMetadata:{redirect_uris:[redirect],client_name:'Synthetic'},metadata,fetch:async(_url,init)=>{body=JSON.parse(String(init?.body));return Response.json({client_id:'synthetic'});}});expect(body.application_type).toBe(expected);
});
