/**
 * db/extension-kv.ts — Root KV readers and transaction-local SQL mutation bodies.
 *
 * Each extension is isolated by extension_id (runtime-assigned).
 * Values are JSON-serialized. Supports chat-scoped and global entries.
 * JSON indexing via json_extract() for structured queries.
 */

import { getDb } from "./connection.js";

const MAX_VALUE_BYTES = 65_536;
const MAX_KEYS_PER_EXTENSION = 1_000;

export type KvScope = "chat" | "global";

export interface KvEntry<T = unknown> {
  key: string;
  scope: KvScope;
  scopeKey: string;
  value: T;
  createdAt: string;
  updatedAt: string;
}

export interface KvQueryOptions {
  scope?: KvScope;
  scopeKey?: string;
  jsonPath: string;
  equals: unknown;
  limit?: number;
}

function resolveScope(scope?: KvScope, scopeKey?: string): { scope: KvScope; scopeKey: string } {
  const s = scope || "chat";
  const sk = s === "global" ? "" : (scopeKey || "");
  return { scope: s, scopeKey: sk };
}

function serializeValue(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) {
    throw new Error("Extension KV value must be JSON-serializable.");
  }
  if (Buffer.byteLength(json, "utf8") > MAX_VALUE_BYTES) {
    throw new Error(`Extension KV value exceeds maximum size (${MAX_VALUE_BYTES} bytes).`);
  }
  return json;
}

function deserializeValue<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function extensionKvGet<T = unknown>(
  extensionId: string,
  key: string,
  scope?: KvScope,
  scopeKey?: string,
): T | null {
  const { scope: s, scopeKey: sk } = resolveScope(scope, scopeKey);
  const db = getDb();
  const row = db
    .prepare("SELECT value FROM extension_kv WHERE extension_id = ? AND scope = ? AND scope_key = ? AND key = ?")
    .get(extensionId, s, sk, key) as { value: string } | undefined;
  if (!row) return null;
  return deserializeValue<T>(row.value);
}

export function extensionKvSet(
  extensionId: string,
  key: string,
  value: unknown,
  scope?: KvScope,
  scopeKey?: string,
): void {
  const { scope: s, scopeKey: sk } = resolveScope(scope, scopeKey);
  const db = getDb();
  if (!db.inTransaction) throw Error("Extension KV mutation requires a transaction-local SQL scope");
  const json = serializeValue(value);

  // Enforce key count limit
  const count = db
    .prepare("SELECT COUNT(*) as cnt FROM extension_kv WHERE extension_id = ?")
    .get(extensionId) as { cnt: number };
  const existing = db
    .prepare("SELECT 1 FROM extension_kv WHERE extension_id = ? AND scope = ? AND scope_key = ? AND key = ?")
    .get(extensionId, s, sk, key);
  if (!existing && count.cnt >= MAX_KEYS_PER_EXTENSION) {
    throw new Error(`Extension KV key limit exceeded (${MAX_KEYS_PER_EXTENSION} keys per extension).`);
  }

  db.prepare(`
    INSERT INTO extension_kv (extension_id, scope, scope_key, key, value, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT (extension_id, scope, scope_key, key)
    DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(extensionId, s, sk, key, json);
}

export function extensionKvDelete(
  extensionId: string,
  key: string,
  scope?: KvScope,
  scopeKey?: string,
): boolean {
  const { scope: s, scopeKey: sk } = resolveScope(scope, scopeKey);
  const db = getDb();
  if (!db.inTransaction) throw Error("Extension KV mutation requires a transaction-local SQL scope");
  const result = db
    .prepare("DELETE FROM extension_kv WHERE extension_id = ? AND scope = ? AND scope_key = ? AND key = ?")
    .run(extensionId, s, sk, key);
  return result.changes > 0;
}

export function extensionKvList(
  extensionId: string,
  prefix?: string,
  scope?: KvScope,
  scopeKey?: string,
): string[] {
  const { scope: s, scopeKey: sk } = resolveScope(scope, scopeKey);
  const db = getDb();
  if (prefix) {
    const rows = db
      .prepare("SELECT key FROM extension_kv WHERE extension_id = ? AND scope = ? AND scope_key = ? AND key LIKE ? ORDER BY key")
      .all(extensionId, s, sk, `${prefix}%`) as { key: string }[];
    return rows.map((r) => r.key);
  }
  const rows = db
    .prepare("SELECT key FROM extension_kv WHERE extension_id = ? AND scope = ? AND scope_key = ? ORDER BY key")
    .all(extensionId, s, sk) as { key: string }[];
  return rows.map((r) => r.key);
}

export function extensionKvQuery<T = unknown>(
  extensionId: string,
  options: KvQueryOptions,
): Array<{ key: string; scopeKey: string; value: T }> {
  const { scope: s, scopeKey } = resolveScope(options.scope, options.scopeKey);
  const limit = Math.min(Math.max(1, options.limit || 100), 1000);
  const db = getDb();

  // If scopeKey is provided, filter by it; otherwise search across all scope_keys for this scope
  const equalsJson = JSON.stringify(options.equals);
  let rows: Array<{ key: string; scope_key: string; value: string }>;

  if (scopeKey) {
    rows = db.prepare(`
      SELECT key, scope_key, value FROM extension_kv
      WHERE extension_id = ? AND scope = ? AND scope_key = ?
        AND json_extract(value, ?) = json_extract(?, '$')
      ORDER BY updated_at DESC LIMIT ?
    `).all(extensionId, s, scopeKey, options.jsonPath, equalsJson, limit) as typeof rows;
  } else {
    rows = db.prepare(`
      SELECT key, scope_key, value FROM extension_kv
      WHERE extension_id = ? AND scope = ?
        AND json_extract(value, ?) = json_extract(?, '$')
      ORDER BY updated_at DESC LIMIT ?
    `).all(extensionId, s, options.jsonPath, equalsJson, limit) as typeof rows;
  }

  const out: Array<{ key: string; scopeKey: string; value: T }> = [];
  for (const r of rows) {
    const parsed = deserializeValue<T>(r.value);
    if (parsed === null) continue;
    out.push({
      key: r.key,
      scopeKey: r.scope_key,
      value: parsed,
    });
  }
  return out;
}

export function extensionKvClear(
  extensionId: string,
  scope?: KvScope,
  scopeKey?: string,
): number {
  const db = getDb();
  if (!db.inTransaction) throw Error("Extension KV mutation requires a transaction-local SQL scope");
  if (scope && scopeKey) {
    const result = db
      .prepare("DELETE FROM extension_kv WHERE extension_id = ? AND scope = ? AND scope_key = ?")
      .run(extensionId, scope, scopeKey);
    return result.changes;
  }
  if (scope) {
    const result = db
      .prepare("DELETE FROM extension_kv WHERE extension_id = ? AND scope = ?")
      .run(extensionId, scope);
    return result.changes;
  }
  const result = db
    .prepare("DELETE FROM extension_kv WHERE extension_id = ?")
    .run(extensionId);
  return result.changes;
}
