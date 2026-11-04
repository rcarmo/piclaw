import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { closeDatabase, getDb, initDatabase, initializeDatabaseSchema } from "../../src/db/connection.js";
import { attachmentIndexRetirement, retireAttachmentRowidIndex } from "../../src/db/attachment-index-retirement.js";
import { attachMediaToMessage, createMedia, getMediaIdsForMessage, getMediaIdsForMessages } from "../../src/db/media.js";
import { extensionKvGet, extensionKvList, extensionKvSet } from "../../src/db/extension-kv.js";
import { getTokenUsageTotals } from "../../src/db/token-usage.js";

const retired = "idx_message_media_message_rowid";
const legacy = `CREATE INDEX ${retired} ON message_media(message_rowid)`;
const receipt = (db: Database) => db.query("SELECT * FROM main.piclaw_schema_migrations WHERE owner=?").all(attachmentIndexRetirement.owner);
const schema = (db: Database) => db.query("SELECT type,name,tbl_name,sql,rootpage FROM main.sqlite_schema ORDER BY type,name").all();
const data = (db: Database) => ["messages", "media", "message_media", "extension_kv", "token_usage", "sqlite_sequence"]
  .map(table => db.query(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all());
const index = (db: Database, name = retired) => db.query("SELECT * FROM main.sqlite_schema WHERE name=? COLLATE NOCASE").get(name);

beforeEach(() => { closeDatabase(); expect(process.env.PICLAW_DB_IN_MEMORY).toBe("1"); initDatabase(); });
afterEach(() => closeDatabase());

function modelUpgrade(db: Database) {
  db.query("DELETE FROM piclaw_schema_migrations WHERE owner=?").run(attachmentIndexRetirement.owner);
  db.exec(legacy);
}
function seed() {
  const db = getDb();
  db.exec("INSERT INTO chats(jid) VALUES('web:index-fixture'); INSERT INTO messages(id,chat_jid,content,timestamp) VALUES('index-message','web:index-fixture','fixture','2025-01-01')");
  const first = Number((db.query("SELECT rowid FROM messages").get() as { rowid: number }).rowid);
  const media = [1, 2, 3].map(i => createMedia(`fixture-${i}.bin`, "application/octet-stream", new Uint8Array([i, 0, 255])));
  attachMediaToMessage(first, [media[2]!, media[0]!, media[1]!, media[0]!]);
  db.transaction(() => {
    for (const key of ["beta", "alpha", "other"]) extensionKvSet("fixture", key, { key }, "chat", "web:index-fixture");
  }).immediate();
  for (const chat of ["web:index-fixture", "web:other"]) for (let i = 0; i < 12; i++) db.query(
    "INSERT INTO token_usage(chat_jid,run_at,input_tokens,total_tokens,cost_total) VALUES(?,?,?,?,?)",
  ).run(chat, `2025-01-${String(i + 1).padStart(2, "0")}`, i + 1, i + 2, 0.125);
  return { first, media };
}
function assertRetained(db: Database) {
  for (const [name, columns] of [
    ["idx_message_media_media_id", ["media_id"]],
    ["idx_extension_kv_ext_scope", ["extension_id", "scope", "scope_key"]],
    ["idx_token_usage_chat_jid", ["chat_jid"]],
    ["idx_token_usage_chat_jid_run_at", ["chat_jid", "run_at"]],
    ["idx_messages_chat_jid", ["chat_jid"]],
  ] as const) {
    expect(index(db, name)).not.toBeNull();
    expect((db.query(`PRAGMA index_info(${name})`).all() as { name: string }[]).map(row => row.name)).toEqual([...columns]);
  }
  expect(index(db, "sqlite_autoindex_message_media_1")).not.toBeNull();
  expect(index(db, "sqlite_autoindex_extension_kv_1")).not.toBeNull();
  expect(index(db)).toBeNull();
}
function plans(run: () => unknown, match: RegExp, args: (number | string)[]): string[] {
  const db = getDb(), prepare = spyOn(db, "prepare");
  let sql: string;
  try {
    run(); const calls = prepare.mock.calls.filter(([query]) => match.test(query));
    expect(calls).toHaveLength(1); sql = calls[0]![0];
  } finally {
    // The spy retains .get() statements; release these test-owned readers before DDL.
    for (const result of prepare.mock.results) if (result.type === "return") result.value.finalize();
    prepare.mockRestore();
  }
  const explain = db.prepare(`EXPLAIN QUERY PLAN ${sql!}`);
  try { return (explain.all(...args) as { detail: string }[]).map(row => row.detail); }
  finally { explain.finalize(); }
}

test("fresh core retires only attachment rowid index and records one owned receipt", () => {
  const db = getDb(); assertRetained(db);
  expect(receipt(db)).toHaveLength(1);
  expect(receipt(db)[0]).toMatchObject({ owner: attachmentIndexRetirement.owner, id: attachmentIndexRetirement.id, migration_order: 1 });
});

test("populated owned upgrade preserves raw rows, sequences, retained indexes and real API results/plans", () => {
  const db = getDb(), { first, media } = seed(); modelUpgrade(db);
  const before = data(db), retained = schema(db).filter((row: any) => row.name !== retired);
  const totals = getTokenUsageTotals("web:index-fixture");
  const usageBefore = plans(() => getTokenUsageTotals("web:index-fixture"), /FROM token_usage/, ["web:index-fixture"]);
  const version = db.query("PRAGMA user_version").get(), fk = db.query("PRAGMA foreign_keys").get();
  initializeDatabaseSchema(db); assertRetained(db);
  expect(data(db)).toEqual(before); expect(schema(db)).toEqual(retained);
  expect(db.query("PRAGMA user_version").get()).toEqual(version); expect(db.query("PRAGMA foreign_keys").get()).toEqual(fk);
  expect(getMediaIdsForMessage(first)).toEqual([...media].sort((a, b) => a - b));
  expect(getMediaIdsForMessages([first, first + 99]).sort((a, b) => a - b)).toEqual([...media].sort((a, b) => a - b));
  for (const plan of [
    plans(() => getMediaIdsForMessage(first), /SELECT media_id FROM message_media/, [first]),
    plans(() => getMediaIdsForMessages([first, first + 99]), /SELECT DISTINCT media_id FROM message_media/, [first, first + 99]),
  ]) expect(plan.some(detail => detail.includes("COVERING INDEX sqlite_autoindex_message_media_1"))).toBe(true);
  const single = plans(() => getMediaIdsForMessage(first), /SELECT media_id FROM message_media/, [first]);
  expect(single.some(detail => /TEMP B-TREE/.test(detail))).toBe(false);
  expect(extensionKvList("fixture", undefined, "chat", "web:index-fixture")).toEqual(["alpha", "beta", "other"]);
  expect(extensionKvGet("fixture", "beta", "chat", "web:index-fixture")).toEqual({ key: "beta" });
  expect(getTokenUsageTotals("web:index-fixture")).toEqual(totals);
  const usage = plans(() => getTokenUsageTotals("web:index-fixture"), /FROM token_usage/, ["web:index-fixture"]);
  expect(usage).toEqual(usageBefore);
});

test("reinitialization and older-binary index recreation preserve receipt, data and other index pages", () => {
  const db = getDb(); seed();
  const before = data(db), original = receipt(db), inventory = schema(db), version = db.query("PRAGMA schema_version").get();
  for (let i = 0; i < 2; i++) { retireAttachmentRowidIndex(db); initializeDatabaseSchema(db); initDatabase(); }
  expect(receipt(db)).toEqual(original); expect(data(db)).toEqual(before); expect(schema(db)).toEqual(inventory);
  expect(db.query("PRAGMA schema_version").get()).toEqual(version);
  db.exec('CREATE INDEX "IDX_MESSAGE_MEDIA_MESSAGE_ROWID" ON "message_media" ("message_rowid" ASC)');
  retireAttachmentRowidIndex(db);
  expect(receipt(db)).toEqual(original); expect(data(db)).toEqual(before); expect(schema(db)).toEqual(inventory);
});

test("retirement targets main even when a different temporary table/index shadows its names", () => {
  const db = getDb(); modelUpgrade(db);
  db.exec(`CREATE TEMP TABLE message_media(message_rowid INTEGER,media_id INTEGER);
    CREATE INDEX temp.idx_message_media_message_rowid ON message_media(media_id);
    INSERT INTO temp.message_media VALUES(7,9)`);
  const temporary = db.query("SELECT * FROM sqlite_temp_schema ORDER BY name").all();
  retireAttachmentRowidIndex(db);
  expect(index(db)).toBeNull(); expect(receipt(db)).toHaveLength(1);
  expect(db.query("SELECT * FROM sqlite_temp_schema ORDER BY name").all()).toEqual(temporary);
  expect(db.query("SELECT * FROM temp.message_media").all()).toEqual([{ message_rowid: 7, media_id: 9 }]);
});

test("a shadowed receipt table cannot authorize main-index deletion", () => {
  const db = getDb(); db.exec(legacy);
  db.exec("CREATE TEMP TABLE piclaw_schema_migrations(protected TEXT); INSERT INTO temp.piclaw_schema_migrations VALUES('preserve')");
  const before = schema(db), original = receipt(db);
  expect(() => retireAttachmentRowidIndex(db)).toThrow("Unsupported attachment migration ledger shadow");
  expect(schema(db)).toEqual(before); expect(receipt(db)).toEqual(original);
  expect(db.query("SELECT * FROM temp.piclaw_schema_migrations").all()).toEqual([{ protected: "preserve" }]);
});

test("DDL and receipt insert roll back atomically on migration failure", () => {
  const db = getDb(); seed(); modelUpgrade(db);
  db.exec(`CREATE TRIGGER reject_index_receipt BEFORE INSERT ON piclaw_schema_migrations
    WHEN NEW.owner='host.core-indexes' BEGIN SELECT RAISE(ABORT,'fixture receipt failure'); END`);
  const before = schema(db), rows = data(db);
  expect(() => retireAttachmentRowidIndex(db)).toThrow("fixture receipt failure");
  expect(schema(db)).toEqual(before); expect(data(db)).toEqual(rows); expect(receipt(db)).toEqual([]);
  expect(index(db)).not.toBeNull();
});

for (const drift of [
  "CREATE UNIQUE INDEX idx_message_media_message_rowid ON message_media(message_rowid)",
  "CREATE INDEX idx_message_media_message_rowid ON message_media(message_rowid) WHERE media_id>0",
  "CREATE INDEX idx_message_media_message_rowid ON message_media(message_rowid DESC)",
  "CREATE INDEX idx_message_media_message_rowid ON message_media(media_id)",
  "CREATE INDEX idx_message_media_message_rowid ON message_media(message_rowid COLLATE NOCASE)",
  "CREATE INDEX IDX_MESSAGE_MEDIA_MESSAGE_ROWID ON extension_kv(key)",
  "CREATE VIEW idx_message_media_message_rowid AS SELECT 1 AS value",
]) test(`unknown historical index collision is preserved: ${drift}`, () => {
  const db = getDb(); db.exec(drift);
  const before = schema(db), rows = data(db), original = receipt(db);
  expect(() => retireAttachmentRowidIndex(db)).toThrow("Unsupported historical attachment rowid index");
  expect(schema(db)).toEqual(before); expect(data(db)).toEqual(rows); expect(receipt(db)).toEqual(original);
});

for (const primary of ["PRIMARY KEY(media_id,message_rowid)", "PRIMARY KEY(message_rowid)", "PRIMARY KEY(message_rowid,media_id DESC)"]) {
  test(`missing or incompatible covering primary key prevents retirement: ${primary}`, () => {
    const db = new Database(":memory:");
    try {
      db.exec(`CREATE TABLE message_media(message_rowid INTEGER NOT NULL,media_id INTEGER NOT NULL,${primary});${legacy}`);
      const before = schema(db);
      expect(() => retireAttachmentRowidIndex(db)).toThrow("Unsupported attachment primary-key replacement index");
      expect(schema(db)).toEqual(before);
      expect(db.query("SELECT 1 FROM sqlite_schema WHERE name='piclaw_schema_migrations'").get()).toBeNull();
    } finally { db.close(); }
  });
}
for (const drift of ["checksum='tampered'", "migration_order=2"]) test(`receipt identity drift cannot remove a reintroduced index: ${drift}`, () => {
  const db = getDb(); db.exec(legacy); db.query(`UPDATE piclaw_schema_migrations SET ${drift} WHERE owner=?`).run(attachmentIndexRetirement.owner);
  const before = schema(db), original = receipt(db);
  expect(() => retireAttachmentRowidIndex(db)).toThrow("Schema migration");
  expect(schema(db)).toEqual(before); expect(receipt(db)).toEqual(original); expect(index(db)).not.toBeNull();
});
