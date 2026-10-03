/**
 * db/web-sessions.ts – Persistent web UI auth session storage.
 *
 * Stores session tokens issued after TOTP or passkey login so sessions
 * survive restarts. Tokens are persisted as SHA-256 hashes (not plaintext)
 * for at-rest hardening. Designed for a single-user default now, but includes
 * user_id to enable multi-user support later without schema changes.
 */

import { createHash } from "node:crypto";
import { createUuid } from "../utils/ids.js";
import { getDb } from "./connection.js";

/** Default user ID used for single-user web auth sessions. */
export const DEFAULT_WEB_USER_ID = "default";

/** Persisted web auth session row. */
export interface WebSessionRecord {
  token: string;
  session_id?: string;
  user_id: string;
  auth_method: string | null;
  created_at: string;
  expires_at: string;
}

type StoredWebSession = Omit<WebSessionRecord, "session_id"> & { session_id: string | null };

/** A null ID may acquire an ID, but an established login identity cannot change. */
function sameRepairIdentity(before: StoredWebSession, after: StoredWebSession | null): after is StoredWebSession {
  return Boolean(after && before.user_id === after.user_id && before.auth_method === after.auth_method
    && before.created_at === after.created_at && before.expires_at === after.expires_at
    && (before.session_id === null || before.session_id === after.session_id));
}

/** Derive a deterministic DB-safe hash for a session token. */
function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Create or replace a persistent web auth session token row. */
export function createWebSession(
  token: string,
  userId: string,
  ttlSeconds: number,
  authMethod: string | null
): WebSessionRecord {
  const db = getDb();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const tokenHash = hashSessionToken(token);
  const sessionId = createUuid("login");
  db.prepare(
    "INSERT OR REPLACE INTO web_sessions (token, user_id, auth_method, created_at, expires_at, session_id) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(tokenHash, userId, authMethod, createdAt, expiresAt, sessionId);
  return { token, session_id: sessionId, user_id: userId, auth_method: authMethod, created_at: createdAt, expires_at: expiresAt };
}

/** Fetch a session row by token and auto-delete it when expired. */
export function getWebSession(token: string): WebSessionRecord | null {
  const db = getDb();
  const tokenHash = hashSessionToken(token);

  let row = db
    .prepare("SELECT token, user_id, auth_method, created_at, expires_at, session_id FROM web_sessions WHERE token = ?")
    .get(tokenHash) as StoredWebSession | null;

  // Legacy fallback for plain-token rows created before hashing hardening.
  if (!row) {
    row = db
      .prepare("SELECT token, user_id, auth_method, created_at, expires_at, session_id FROM web_sessions WHERE token = ?")
      .get(token) as StoredWebSession | null;

    if (row) {
      // A writer can revoke or replace this login while repair waits. Match
      // the observed row and then read the canonical committed result.
      db.prepare(`UPDATE web_sessions SET token = ? WHERE token = ?
        AND user_id = ? AND auth_method IS ? AND created_at = ? AND expires_at = ? AND session_id IS ?`)
        .run(tokenHash, token, row.user_id, row.auth_method, row.created_at, row.expires_at, row.session_id);
      const repaired = db.prepare("SELECT token, user_id, auth_method, created_at, expires_at, session_id FROM web_sessions WHERE token = ?")
        .get(tokenHash) as StoredWebSession | null;
      // Zero changes can mean another lookup already performed the migration.
      if (!sameRepairIdentity(row, repaired)) return null;
      row = repaired;
    }
  }

  if (!row) return null;

  const expiresAt = Date.parse(row.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    db.prepare("DELETE FROM web_sessions WHERE token = ?").run(tokenHash);
    db.prepare("DELETE FROM web_sessions WHERE token = ?").run(token);
    return null;
  }

  if (!row.session_id) {
    const sessionId = createUuid("login");
    const updated = db.prepare(`UPDATE web_sessions SET session_id = ? WHERE token = ? AND session_id IS NULL
      AND user_id = ? AND auth_method IS ? AND created_at = ? AND expires_at = ?`)
      .run(sessionId, tokenHash, row.user_id, row.auth_method, row.created_at, row.expires_at);
    const repaired = db.prepare("SELECT token, user_id, auth_method, created_at, expires_at, session_id FROM web_sessions WHERE token = ?")
      .get(tokenHash) as StoredWebSession | null;
    if (!sameRepairIdentity(row, repaired) || !repaired.session_id
      || (updated.changes > 0 && repaired.session_id !== sessionId)) return null;
    row = repaired;
    // ID repair can wait long enough for the original expiry to pass.
    if (Date.parse(row.expires_at) <= Date.now()) return null;
  }
  return {
    token,
    session_id: row.session_id!,
    user_id: row.user_id,
    auth_method: row.auth_method,
    created_at: row.created_at,
    expires_at: row.expires_at,
  };
}

/** List device sessions without exposing bearer tokens or their stored hashes. */
export function listUserWebSessions(userId: string): Array<Omit<WebSessionRecord, "token">> {
  return getDb().prepare(
    "SELECT session_id, user_id, auth_method, created_at, expires_at FROM web_sessions WHERE user_id = ? ORDER BY created_at DESC"
  ).all(userId) as Array<Omit<WebSessionRecord, "token">>;
}

/** Revoke only a login belonging to the authorised target user; caller enforces actor permissions. */
export function revokeUserWebSession(userId: string, sessionId: string): boolean {
  return getDb().prepare("DELETE FROM web_sessions WHERE user_id = ? AND session_id = ?").run(userId, sessionId).changes > 0;
}

/** Account reset can revoke all its cookies without disturbing other accounts. */
export function revokeUserWebSessions(userId: string): number {
  return getDb().prepare("DELETE FROM web_sessions WHERE user_id = ?").run(userId).changes;
}

/** Delete expired session rows and return number of removed records. */
export function deleteExpiredWebSessions(now = new Date()): number {
  const db = getDb();
  const nowIso = now.toISOString();
  const info = db.prepare("DELETE FROM web_sessions WHERE expires_at <= ?").run(nowIso);
  return Number(info.changes || 0);
}

/** Delete all web auth sessions and return number of removed records. */
export function deleteAllWebSessions(): number {
  const db = getDb();
  const info = db.prepare("DELETE FROM web_sessions").run();
  return Number(info.changes || 0);
}
