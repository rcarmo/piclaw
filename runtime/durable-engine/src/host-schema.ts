// INACTIVE application-owned offline schema boundary. No bootstrap or migration registry.
import type { Database } from "bun:sqlite";
const definitions = [
  `CREATE TABLE IF NOT EXISTS piclaw_durable_bindings_v1 (
      domain TEXT NOT NULL, incarnation TEXT NOT NULL,
      conversation_id INTEGER NOT NULL, chat_jid TEXT NOT NULL, branch_id TEXT NOT NULL,
      operation_id TEXT NOT NULL, source_seq INTEGER NOT NULL, source_id TEXT NOT NULL,
      payload_ref TEXT NOT NULL, request_id TEXT NOT NULL, request_hash TEXT NOT NULL,
      submission_id INTEGER,
      PRIMARY KEY(domain,incarnation,conversation_id,request_id),
      UNIQUE(domain,incarnation,operation_id),
      UNIQUE(domain,incarnation,chat_jid,source_seq),
      UNIQUE(domain,incarnation,submission_id),
      CHECK(conversation_id > 0 AND source_seq > 0),
      CHECK(submission_id IS NULL OR submission_id > 0)
    )`,
  `CREATE TABLE IF NOT EXISTS piclaw_durable_intent_bindings_v1 (
      domain TEXT NOT NULL, incarnation TEXT NOT NULL, conversation_id INTEGER NOT NULL,
      chat_jid TEXT NOT NULL, branch_id TEXT NOT NULL, operation_id TEXT NOT NULL,
      source_seq INTEGER NOT NULL, source_id TEXT NOT NULL, payload_ref TEXT NOT NULL,
      request_id TEXT NOT NULL, request_hash TEXT NOT NULL, submission_id INTEGER,
      PRIMARY KEY(domain,incarnation,operation_id,source_seq),
      UNIQUE(domain,incarnation,conversation_id,request_id),
      UNIQUE(domain,incarnation,chat_jid,source_seq), UNIQUE(domain,incarnation,submission_id),
      CHECK(conversation_id > 0 AND source_seq > 0), CHECK(submission_id IS NULL OR submission_id > 0)
    )`,
  `CREATE TABLE IF NOT EXISTS qualification_cutover_v1 (
    domain TEXT PRIMARY KEY, identity TEXT NOT NULL, request_hash TEXT NOT NULL, manifest TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS qualification_cutover_work_v1 (
    domain TEXT NOT NULL REFERENCES qualification_cutover_v1(domain), operation_id TEXT NOT NULL,
    content_hash TEXT NOT NULL, PRIMARY KEY(domain,operation_id))`,
] as const;
export const hostDurableTableNames = ["piclaw_durable_bindings_v1", "piclaw_durable_intent_bindings_v1",
  "qualification_cutover_v1", "qualification_cutover_work_v1"] as const;
const names = hostDurableTableNames;
export class UnsupportedHostSchemaError extends Error {
  constructor() { super("Unsupported host schema"); this.name = "UnsupportedHostSchemaError"; }
}
// Deliberately bounded to these four exact v1 definitions, including PK/UNIQUE/CHECK/FK.
// A different shape requires an explicit migration, not a best-effort DDL upgrade.
const normalized = (sql: string) => sql.toLowerCase().replace(/if\s+not\s+exists/g, "").replace(/[\s;]/g, "");
export function assertHostSchema(db: Database, indices: readonly number[] = [0, 1]): void {
  for (const i of indices) {
    const row = db.query("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(names[i]!) as { sql: string } | null;
    if (!row || normalized(row.sql) !== normalized(definitions[i]!)) throw new UnsupportedHostSchemaError();
  }
}
export function initializeHostSchemaTables(db: Database, ownerguard: () => void, indices: readonly number[]): void {
  const owner = () => { if (ownerguard() !== undefined) throw new Error("Invalid synchronous owner guard"); };
  owner();
  if ((db.query("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys !== 1)
    throw new Error("Host schema requires foreign_keys ON");
  if (db.inTransaction) throw new Error("Host schema requires an offline outer transaction");
  db.transaction(() => {
    owner();
    for (const i of indices) {
      const exists = db.query("SELECT 1 FROM sqlite_master WHERE name=?").get(names[i]!);
      if (exists) assertHostSchema(db, [i]);
    }
    for (const i of indices) db.exec(definitions[i]!);
    assertHostSchema(db, indices);
    owner();
  }).immediate();
}
/** Explicit OFFLINE initialization only; caller owns an FK-enabled host connection. */
export function initializeHostSchema(db: Database, ownerguard: () => void): void {
  initializeHostSchemaTables(db, ownerguard, [0, 1, 2, 3]);
}
