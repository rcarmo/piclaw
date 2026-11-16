import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { snapshotLegacyHostFrontier } from "../../runtime/src/agent-pool/legacy-host-frontier.js";

test("host frontier captures lossless implicit row identity on the actual root connection", () => {
  const root = new Database(":memory:");
  try {
    root.exec("CREATE TABLE messages(id TEXT, content TEXT); INSERT INTO messages(rowid,id,content) VALUES (9007199254740992,'known','unchanged')");
    const before = snapshotLegacyHostFrontier(root);
    // The actual Bun API is supported at runtime but absent in pinned typings.
    const statement = root.query("SELECT rowid FROM messages") as unknown as {
      safeIntegers(enabled: boolean): { values(): unknown[][] };
    };
    expect(statement.safeIntegers(true).values()).toEqual([[9007199254740992n]]);
    root.exec("UPDATE messages SET rowid=9007199254740993");
    expect(root.query("SELECT * FROM messages").values()).toEqual([["known", "unchanged"]]);
    expect(snapshotLegacyHostFrontier(root)).not.toBe(before);
  } finally { root.close(); }
});

test("host frontier handles shadowed aliases, quoted names and commented WITHOUT ROWID; all aliases shadowed fail closed", () => {
  for (const columns of ["value TEXT", '"RoWiD" TEXT', '"rowid" TEXT, "_ROWID_" TEXT']) {
    const root = new Database(":memory:");
    try {
      root.exec(`CREATE TABLE "odd""table" (${columns}); INSERT INTO "odd""table" DEFAULT VALUES`);
      const before = snapshotLegacyHostFrontier(root);
      const alias = columns.includes("_ROWID_") ? "oid" : columns.includes("RoWiD") ? "_rowid_" : "rowid";
      root.exec(`UPDATE "odd""table" SET ${alias}=42`);
      expect(snapshotLegacyHostFrontier(root)).not.toBe(before);
    } finally { root.close(); }
  }
  const root = new Database(":memory:");
  try {
    root.exec('CREATE TABLE keyed(rowid TEXT PRIMARY KEY, _rowid_ TEXT, oid TEXT) WITHOUT /* comment */ ROWID; INSERT INTO keyed VALUES (\'key\',\'a\',\'b\')');
    const before = snapshotLegacyHostFrontier(root);
    root.exec("UPDATE keyed SET oid='changed'");
    expect(snapshotLegacyHostFrontier(root)).not.toBe(before);
    root.exec('CREATE TABLE inaccessible(rowid TEXT, _rowid_ TEXT, oid TEXT, id INTEGER PRIMARY KEY DESC)');
    expect(() => snapshotLegacyHostFrontier(root)).toThrow("Unsupported legacy host row identity");
    root.exec('DROP TABLE inaccessible; CREATE TABLE inaccessible(rowid TEXT, _rowid_ TEXT, oid TEXT, id INTEGER PRIMARY KEY)');
    expect(() => snapshotLegacyHostFrontier(root)).toThrow("Unsupported legacy host row identity");
  } finally { root.close(); }
});

test("host frontier distinguishes SQLite positive and negative REAL infinity from NULL", () => {
  const root = new Database(":memory:");
  try {
    root.exec("CREATE TABLE readings(value REAL); INSERT INTO readings VALUES (1e999)");
    expect(root.query("SELECT value FROM readings").values()).toEqual([[Infinity]]);
    const positive = snapshotLegacyHostFrontier(root);
    root.exec("UPDATE readings SET value=-1e999");
    expect(root.query("SELECT value FROM readings").values()).toEqual([[-Infinity]]);
    const negative = snapshotLegacyHostFrontier(root);
    root.exec("UPDATE readings SET value=NULL");
    const absent = snapshotLegacyHostFrontier(root);
    expect(positive).not.toBe(negative);
    expect(positive).not.toBe(absent);
    expect(negative).not.toBe(absent);
  } finally { root.close(); }
});
