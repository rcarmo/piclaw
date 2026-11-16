// Application-owned host schema; SDK tables retain their separate owner.
import type { Database } from "bun:sqlite";
import { admitSqliteWrite } from "../../src/db/sqlite-async-admission.js";
import { applyOwnedMigrations } from "../../src/db/migrations.js";

import { nativeBindingRecoveryIndex as acceptedPayloadRecoveryIndex, nativeBindingRecoveryMigration as recoveryIndexMigration } from "../../src/db/native-host-schema-contract.js";
export { nativeBindingRecoveryIndex as acceptedPayloadRecoveryIndex } from "../../src/db/native-host-schema-contract.js";
const recoveryIndexSql = recoveryIndexMigration.sql;
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
] as const;
export const hostDurableTableNames = ["piclaw_durable_bindings_v1", "piclaw_durable_intent_bindings_v1"] as const;
const names = hostDurableTableNames;
export class UnsupportedHostSchemaError extends Error {
  constructor() { super("Unsupported host schema"); this.name = "UnsupportedHostSchemaError"; }
}
// Deliberately bounded to these two exact native v1 definitions, including PK/UNIQUE/CHECK/FK.
// A different shape requires an explicit migration, not a best-effort DDL upgrade.
const normalized = (sql: string) => sql.toLowerCase().replace(/if\s+not\s+exists/g, "").replace(/[\s;]/g, "");
export function assertHostSchema(db: Database, indices: readonly number[] = [0, 1]): void {
  for (const i of indices) {
    const row = db.query("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(names[i]!) as { sql: string } | null;
    if (!row || normalized(row.sql) !== normalized(definitions[i]!)) throw new UnsupportedHostSchemaError();
  }
}
function assertRecoveryIndex(db: Database, required: boolean): void {
  const row = db.query("SELECT type,tbl_name,sql FROM sqlite_master WHERE name=?").get(acceptedPayloadRecoveryIndex) as
    { type: string; tbl_name: string; sql: string | null } | null;
  if (!row && !required) return;
  if (!row || row.type !== "index" || row.tbl_name !== "piclaw_durable_bindings_v1" || !row.sql || normalized(row.sql) !== normalized(recoveryIndexSql))
    throw new UnsupportedHostSchemaError();
}
function applyRecoveryIndex(db: Database, owner: () => void): void {
  owner();
  assertHostSchema(db, [0]);
  assertRecoveryIndex(db, false);
  applyOwnedMigrations(db, [recoveryIndexMigration]);
  assertRecoveryIndex(db, true);
  owner();
}
function assertSchemaConnection(db: Database): void {
  if ((db.query("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys !== 1)
    throw new Error("Host schema requires foreign_keys ON");
  if (db.inTransaction) throw new Error("Host schema requires an offline outer transaction");
}
function schemaOwner(db: Database, ownerguard: () => void): () => void {
  const owner = () => { if (ownerguard() !== undefined) throw new Error("Invalid synchronous owner guard"); };
  owner(); assertSchemaConnection(db);
  return owner;
}
function initializeTables(db: Database, owner: () => void, indices: readonly number[]): void {
  owner();
  for (const i of indices) {
    const exists = db.query("SELECT 1 FROM sqlite_master WHERE name=?").get(names[i]!);
    if (exists) assertHostSchema(db, [i]);
  }
  for (const i of indices) db.exec(definitions[i]!);
  assertHostSchema(db, indices);
  if (indices.includes(0)) applyRecoveryIndex(db, owner);
  owner();
}
/** Explicit additive host step, using the existing owned ledger and no SDK DDL. */
export function migrateHostAcceptedPayloadLookup(db: Database, ownerguard: () => void): void {
  const owner = schemaOwner(db, ownerguard);
  db.transaction(() => applyRecoveryIndex(db, owner)).immediate();
}
export function initializeHostSchemaTables(db: Database, ownerguard: () => void, indices: readonly number[]): void {
  if (indices.some(i => i !== 0 && i !== 1)) throw new UnsupportedHostSchemaError();
  const owner = schemaOwner(db, ownerguard);
  db.transaction(() => initializeTables(db, owner, indices)).immediate();
}
/** Explicit OFFLINE initialization only; caller owns an FK-enabled host connection. */
export function initializeHostSchema(db: Database, ownerguard: () => void): void {
  initializeHostSchemaTables(db, ownerguard, [0, 1]);
}
/** Bootstrap yields only before writer acquisition; entered schema work is never replayed. */
export async function prepareHostSchema(db: Database, ownerguard: () => void, offlineInitialize: boolean,
  signal?: AbortSignal, assertBinding: () => void = () => {}): Promise<void> {
  const owner = schemaOwner(db, ownerguard);
  await admitSqliteWrite(db, () => {
    if (offlineInitialize) initializeTables(db, owner, [0, 1]);
    else { assertHostSchema(db); applyRecoveryIndex(db, owner); }
  }, owner, signal, undefined, () => { owner(); assertSchemaConnection(db); assertBinding(); });
}
