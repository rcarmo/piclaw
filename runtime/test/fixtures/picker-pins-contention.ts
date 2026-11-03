import "../setup-filesystem-isolation.js";
import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import type { AuthenticatedPrincipal } from "../../src/core/access-types.js";
import type { WebChannelLike } from "../../src/channels/web/core/web-channel-contracts.js";
delete process.env.PICLAW_WEB_VNC_ALLOW_DIRECT;
const { initDatabase, getDb, closeDatabase } = await import("../../src/db/connection.js");
const { STORE_DIR } = await import("../../src/core/config.js");
const { handlePickerPins } = await import("../../src/channels/web/handlers/picker-pins.js");
const { changePickerPins, readPickerPins } = await import("../../src/db/picker-pins.js");
assert.equal(process.env.PICLAW_DB_IN_MEMORY, "0");
initDatabase(); const db = getDb();
db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=0");
const blocker = new Database(join(STORE_DIR, "messages.db"));
const events: unknown[] = [];
const channel = { broadcastEvent: (...args: unknown[]) => { events.push(args); } } as unknown as WebChannelLike;
const request = (method = "GET", value?: unknown, extra: Record<string, string> = {}) => new Request("https://pins.invalid/agent/picker-pins", {
  method, headers: { Origin: "https://pins.invalid", "Content-Type": "application/json", ...extra }, ...(value ? { body: JSON.stringify(value) } : {}),
});
const busy = async (response: Response) => {
  assert.equal(response.status, 503); assert.equal(response.headers.get("Retry-After"), "1");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store"); assert.equal(response.headers.get("Vary"), "Cookie");
  assert.deepEqual(await response.json(), { error: "Pin storage is busy. Retry shortly." });
};
try {
  blocker.exec("BEGIN IMMEDIATE");
  try { await busy(await handlePickerPins(request(), channel)); }
  finally { blocker.exec("ROLLBACK"); }
  const initial = await handlePickerPins(request(), channel); assert.equal(initial.status, 200);
  const before = await initial.json();
  blocker.exec("BEGIN IMMEDIATE");
  try {
    const result = await handlePickerPins(request(), channel); assert.equal(result.status, 200); assert.deepEqual(await result.json(), before);
    const started = performance.now();
    // The observation deadline remains five seconds; connection acquisition
    // itself must never synchronously wait for this separate writer.
    db.exec("PRAGMA busy_timeout=0");
    await busy(await handlePickerPins(request("POST", { action: "set", kind: "model", key: "test/model", pinned: true }), channel));
    assert.ok(performance.now() - started < 500, "pin contention must yield promptly instead of blocking the event loop");
    assert.equal((db.query("PRAGMA busy_timeout").get() as {timeout:number}).timeout,0);
    assert.deepEqual(readPickerPins(db, "operator"), before); assert.deepEqual(events, []);
  } finally { blocker.exec("ROLLBACK"); }
  const result = await handlePickerPins(request("POST", { action: "set", kind: "model", key: "test/model", pinned: true }), channel);
  assert.equal(result.status, 200); assert.equal(events.length, 1);
  assert.equal((db.query("PRAGMA busy_timeout").get() as {timeout:number}).timeout,0);
  const actor: AuthenticatedPrincipal = { kind: "user", mode: "single-user", userId: "missing", username: "missing", displayName: "Missing", role: "admin", homeChatJid: null, authentication: { method: "passkey", sessionId: "missing-login", expiresAt: null } };
  assert.equal((await handlePickerPins(request(), channel, actor)).status, 409);
  assert.equal((await handlePickerPins(request("GET", undefined, { "x-piclaw-account-id": actor.userId, "x-piclaw-login-id": actor.authentication.sessionId! }), channel, actor)).status, 403);
  assert.equal((await handlePickerPins(request("POST", { action: "set", kind: "model", key: "test/model", pinned: false }, { Origin: "https://evil.invalid" }), channel)).status, 403);
  assert.equal((db.query("PRAGMA busy_timeout").get() as {timeout:number}).timeout,0);

  // Inject only at the SQLite query boundary to exercise error codes deterministically.
  // The real WAL tests above establish the actual Bun error shape.
  const originalQuery = db.query.bind(db);
  const fake = (error: unknown, predicate: (sql: string) => boolean) => {
    db.query = ((sql: string) => { if (predicate(sql)) throw error; return originalQuery(sql); }) as typeof db.query;
  };
  for (const error of [
    { code: "SQLITE_BUSY" }, { code: "SQLITE_BUSY_SNAPSHOT" }, { code: "SQLITE_BUSY_RECOVERY" }, { code: "SQLITE_BUSY_TIMEOUT" },
    { code: "SQLITE_LOCKED" }, { code: "SQLITE_LOCKED_SHAREDCACHE" }, { errno: 5 }, { errno: 6 }, { errno: 517 }, { code: 262 },
  ]) {
    fake(error, sql => sql.includes("picker_pin_scopes"));
    try { await busy(await handlePickerPins(request(), channel)); }
    finally { db.query = originalQuery; }
  }
  changePickerPins(db, "operator", { action: "set", kind: "session", key: "web:check", pinned: true });
  const originalPrepare = db.prepare.bind(db);
  db.prepare = ((sql: string) => { if (sql.includes("chat_branches")) throw { code: "SQLITE_BUSY" }; return originalPrepare(sql); }) as typeof db.prepare;
  try { await busy(await handlePickerPins(request(), channel)); }
  finally { db.prepare = originalPrepare; }
  fake({ code: "SQLITE_LOCKED" }, sql => sql.includes("users"));
  try { await busy(await handlePickerPins(request("GET", undefined, { "x-piclaw-account-id": actor.userId, "x-piclaw-login-id": actor.authentication.sessionId! }), channel, actor)); }
  finally { db.query = originalQuery; }
  for (const error of [new Error("unrelated fault"), { code: "SQLITE_CORRUPT" }, { errno: 8 }, { code: "SQLITE_BUSYNESS" }]) {
    fake(error, sql => sql.includes("picker_pin_scopes"));
    try { await assert.rejects(handlePickerPins(request(), channel), value => value === error); assert.equal((db.query("PRAGMA busy_timeout").get() as {timeout:number}).timeout,0); }
    finally { db.query = originalQuery; }
  }
  // A valid account must be rechecked after reading the asynchronous POST body.
  const { getUser } = await import("../../src/db/users.js");
  const { createWebSession } = await import("../../src/db/web-sessions.js");
  const user = getUser(db, "default")!;
  const login = createWebSession("synthetic-contention-login", user.id, 3600, "passkey");
  const bound: AuthenticatedPrincipal = { ...actor, userId: user.id, username: user.username, displayName: user.display_name, role: user.role, homeChatJid: user.home_chat_jid, authentication: { method: "passkey", sessionId: login.session_id!, expiresAt: login.expires_at } };
  const headers = { "x-piclaw-account-id": user.id, "x-piclaw-login-id": login.session_id! };
  assert.equal((await handlePickerPins(request("GET", undefined, headers), channel, bound)).status, 200);
  const beforePost = readPickerPins(db, "user:" + user.id), broadcastCount = events.length;
  let userReads = 0;
  db.query = ((sql: string) => { if (sql.includes("FROM users") && ++userReads === 2) throw { code: "SQLITE_BUSY_SNAPSHOT" }; return originalQuery(sql); }) as typeof db.query;
  try { await busy(await handlePickerPins(request("POST", { action: "set", kind: "model", key: "test/revalidate", pinned: true }, headers), channel, bound)); }
  finally { db.query = originalQuery; }
  assert.equal(userReads, 2); assert.deepEqual(readPickerPins(db, "user:" + user.id), beforePost); assert.equal(events.length, broadcastCount);
  console.log("PICKER_CONTENTION_OK");
} finally { blocker.close(); closeDatabase(); }
