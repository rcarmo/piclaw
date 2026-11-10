import assert from "node:assert/strict";
import { OAuthCallbackServer } from "@earendil-works/pi-mcp/oauth";
const guard = (globalThis as any).__CALLBACK_GUARD__; assert(guard);
const listener = await OAuthCallbackServer.listen({ host: "127.0.0.1", port: 0, extraPaths: ["/callback/a", "/callback/b"], timeoutMs: 1000 });
const request = (path: string, state: string, code = "synthetic-code") => fetch(new URL(`${path}?state=${state}&code=${code}&iss=https%3A%2F%2Fauth.example.invalid`, listener.redirectUrl));
try {
  const successful = listener.waitForCallback("success", "/callback/a");
  assert.equal((await request("/callback/a", "success")).status, 200); assert.deepEqual(await successful, { code: "synthetic-code", state: "success", iss: "https://auth.example.invalid" });
  const wrong = listener.waitForCallback("wrong-path", "/callback/a"); const rejected = assert.rejects(wrong, /another redirect URI/);
  assert.equal((await request("/callback/b", "wrong-path")).status, 400); await rejected;
  assert.equal((await request("/callback/a", "wrong-path")).status, 400); // rejected state consumed
  const a = listener.waitForCallback("parallel-a", "/callback/a"), b = listener.waitForCallback("parallel-b", "/callback/b");
  assert.equal((await request("/callback/b", "parallel-b", "code-b")).status, 200); assert.equal((await request("/callback/a", "parallel-a", "code-a")).status, 200);
  assert.equal((await a).code, "code-a"); assert.equal((await b).code, "code-b");
  assert.equal((await request("/unknown", "unknown")).status, 404); assert.equal((await request("/callback/a", "unknown")).status, 400);
  const duplicate = listener.waitForCallback("duplicate", "/callback/a"); const duplicateClosed = assert.rejects(duplicate, /server closed/);
  assert.throws(() => listener.waitForCallback("duplicate", "/callback/a"), /already pending/);
  await listener.close(); await duplicateClosed;
  assert.equal(guard.externalAttempts, 0); assert.equal(guard.childAttempts, 0); assert.equal(guard.servers, 1); assert.equal(guard.closed, 1);
  console.log(JSON.stringify({ version: "1.5.2", passed: ["correct-path", "wrong-path-denied", "rejected-state-consumed", "parallel-paths", "unknown-path", "unknown-state", "duplicate-state", "close-pending"], guard, transport: "owned ephemeral loopback HTTP only", realProvider: false }));
} finally { if (guard.closed === 0) await listener.close(); }
