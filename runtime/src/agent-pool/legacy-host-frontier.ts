import type { Database } from "bun:sqlite";
// Qualified application correlation/journal tables; not another schema installer.
const hostDurableTableNames = ["piclaw_durable_bindings_v1", "piclaw_durable_intent_bindings_v1",
  "qualification_cutover_v1", "qualification_cutover_work_v1"] as const;

// Exact names of the qualified public SQLite storage format. No SDK private
// imports, prefix exemptions, metadata writes or discovery from candidate SQL.
const sdkTables = ["durable_schema", "durable_metadata", "record_ids", "conversations",
  "entries", "tasks", "submissions", "documents", "document_revisions"];
const sdkIndexes = ["conversations_by_owner_conversation", "conversations_by_owner_task",
  "entries_by_conversation", "entry_heads_by_conversation", "tasks_by_status", "tasks_by_conversation",
  "tasks_by_kind", "tasks_by_abort_requested", "tasks_by_background", "submissions_by_request",
  "submissions_by_conversation", "submissions_by_status", "documents_by_address", "documents_by_scope",
  "documents_by_scope_kind", "document_revisions_by_kind"];
const permittedTables = new Set<string>([...sdkTables, ...hostDurableTableNames]);
const permittedIndexes = new Set(sdkIndexes);
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const encode = (value: unknown): unknown => value instanceof Uint8Array
  ? ["blob", Buffer.from(value).toString("hex")]
  : typeof value === "bigint" ? ["integer", value.toString()]
  : typeof value === "number" && !Number.isFinite(value) ? ["number", String(value)]
  : value === null ? ["null"] : [typeof value, value];

/** Enumerate the ROOT schema on every check, including future host tables,
 * virtual tables and their shadows, WITHOUT ROWID tables, indexes and triggers.
 * Sorting encoded rows preserves duplicate rows, with accessible implicit row
 * identities included for ordinary rowid tables (not WITHOUT ROWID tables).
 * SQLite's shared sequence table is protected except for exact candidate names.
 * SDK/host initializers remain responsible for validating pre-existing candidate
 * schema collisions; this snapshot grants no permission to bypass those APIs. */
export function snapshotLegacyHostFrontier(root: Database): string {
  const schema = root.query("SELECT type,name,tbl_name,sql FROM main.sqlite_schema ORDER BY type,name").all() as
    { type: string; name: string; tbl_name: string; sql: string | null }[];
  const protectedSchema = schema.filter(row => !(
    row.type === "table" && permittedTables.has(row.name) ||
    row.type === "index" && (permittedIndexes.has(row.name) ||
      row.sql === null && permittedTables.has(row.tbl_name))));
  const tables = schema.filter(row => row.type === "table" && !permittedTables.has(row.name));
  const tableKinds = root.query("PRAGMA main.table_list").all() as { name: string; wr: number }[];
  const data = tables.map(({ name }) => {
    const kind = tableKinds.find(table => table.name === name);
    if (!kind) throw Error(`Unsupported legacy host table: ${name}`);
    let identity = "";
    if (!kind.wr) {
      // xinfo includes generated columns too; identifiers are escaped, not SQL
      // fragments. SQLite resolves all three implicit aliases case-insensitively.
      const columns = root.query(`PRAGMA main.table_xinfo(${quote(name)})`).all() as { name: string }[];
      const names = new Set(columns.map(column => column.name.toLowerCase()));
      const alias = ["rowid", "_rowid_", "oid"].find(alias => !names.has(alias));
      // Conservatively refuse even an exposed INTEGER PRIMARY KEY when all
      // aliases are shadowed: INTEGER PRIMARY KEY DESC is not a rowid alias.
      if (!alias) throw Error(`Unsupported legacy host row identity: ${name}`);
      identity = `, ${quote(alias)}`;
    }
    // Append identity so sqlite_sequence's name remains at column zero.
    // Bun's statement-level safeIntegers API is newer than the pinned typings.
    const statement = root.query(`SELECT *${identity} FROM main.${quote(name)}`) as unknown as {
      safeIntegers(enabled: boolean): { values(): unknown[][] };
    };
    const rows = statement.safeIntegers(true).values();
    return [name, rows.filter(row => name !== "sqlite_sequence" || !permittedTables.has(String(row[0])))
      .map(row => JSON.stringify(row.map(encode))).sort()];
  });
  return JSON.stringify([protectedSchema, data]);
}
