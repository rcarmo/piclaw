import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { assertSchemaInventory, canonicalSchemaSql, classifySchemaInventory, readSchemaInventory, type SchemaContract } from "../scripts/lib/schema-ownership.js";

const base = `CREATE TABLE records(id INTEGER PRIMARY KEY AUTOINCREMENT, state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','done')), parent INTEGER REFERENCES records(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED, UNIQUE(state,parent));
CREATE INDEX records_state ON records(state);
CREATE TABLE audit(value TEXT);
CREATE TRIGGER records_audit AFTER INSERT ON records BEGIN INSERT INTO audit VALUES('Added'); END;`;
function contractFor(database: Database): SchemaContract {
  const objects = readSchemaInventory(database);
  const contract: SchemaContract = { version: 1, sources: { fixture: "synthetic-only" }, owners: {
    fixture: { category: "core", initializer: "synthetic fixture DDL", writers: ["fixture only"], sourceOfTruth: "synthetic records", replayRetention: "owned test lifetime only", references: ["runtime/test/schema-ownership.test.ts"] },
  }, objects: {}, documents: [] };
  for (const object of objects.filter(object => !object.derived)) contract.objects[`${object.kind}:${object.name.toLowerCase()}`] = {
    owner: "fixture", fingerprints: [object.fingerprint], requiredIn: ["fixture"],
    ...(object.kind === "index" || object.kind === "trigger" ? { table: object.table } : {}),
    derivedIndexes: objects.filter(index => index.derived && index.table === object.name).map(index => index.fingerprint),
  };
  return contract;
}
function withDatabase(body: (database: Database, contract: SchemaContract) => void) {
  const database = new Database(":memory:");
  try { database.exec(base); body(database, contractFor(database)); } finally { database.close(); }
}

test("owned tables, indexes, trigger and generated unique index are classified read-only", () => withDatabase((db, contract) => {
  const before = db.query("SELECT * FROM sqlite_schema ORDER BY name").all();
  const version = db.query("PRAGMA schema_version").get();
  const result = assertSchemaInventory(readSchemaInventory(db), contract, "fixture");
  expect(result.objects.every(object => object.owner === "fixture")).toBe(true);
  expect(result.objects.some(object => object.derived)).toBe(true);
  expect(db.query("SELECT * FROM sqlite_schema ORDER BY name").all()).toEqual(before);
  expect(db.query("PRAGMA schema_version").get()).toEqual(version);
  expect(db.query("SELECT * FROM audit").all()).toEqual([]);
}));

test("missing required index fails without repairing it", () => withDatabase((db, contract) => {
  db.exec("DROP INDEX records_state");
  expect(() => assertSchemaInventory(readSchemaInventory(db), contract, "fixture")).toThrow("Missing required object index:records_state");
  expect(db.query("SELECT 1 FROM sqlite_schema WHERE name='records_state'").get()).toBeNull();
}));
for (const ddl of ["CREATE TABLE stranger(value)", "CREATE INDEX stranger ON records(parent)", "CREATE VIEW stranger AS SELECT * FROM records", "CREATE TRIGGER stranger AFTER INSERT ON audit BEGIN SELECT 1; END"]) {
  test(`unowned object fails: ${ddl}`, () => withDatabase((db, contract) => {
    db.exec(ddl);
    expect(() => assertSchemaInventory(readSchemaInventory(db), contract, "fixture")).toThrow("Unowned object");
  }));
}
for (const [label, altered] of [
  ["NOT NULL", base.replace("state TEXT NOT NULL", "state TEXT")],
  ["CHECK literal", base.replace("'pending','done'", "'Pending','done'")],
  ["CHECK removal", base.replace(" CHECK(state IN ('pending','done'))", "")],
  ["FK action", base.replace("ON DELETE RESTRICT", "ON DELETE CASCADE")],
  ["FK deferral", base.replace("DEFERRABLE INITIALLY DEFERRED", "NOT DEFERRABLE INITIALLY IMMEDIATE")],
  ["unique constraint", base.replace(", UNIQUE(state,parent)", "")],
  ["AUTOINCREMENT", base.replace(" AUTOINCREMENT", "")],
  ["default", base.replace("DEFAULT 'pending'", "DEFAULT 'done'")],
  ["trigger literal", base.replace("VALUES('Added')", "VALUES('added')")],
  ["index key order", base.replace("ON records(state)", "ON records(parent,state)")],
] as const) test(`constraint drift fails: ${label}`, () => withDatabase((_db, contract) => {
  const changed = new Database(":memory:");
  try {
    changed.exec(altered);
    expect(() => assertSchemaInventory(readSchemaInventory(changed), contract, "fixture")).toThrow("Unapproved schema drift");
  } finally { changed.close(); }
}));

test("an optional historical component is classified but not recreated or required", () => withDatabase((db, contract) => {
  db.exec("CREATE TABLE retained_history(receipt TEXT)");
  const historical = readSchemaInventory(db).find(object => object.name === "retained_history")!;
  contract.objects["table:retained_history"] = { owner: "fixture", fingerprints: [historical.fingerprint], requiredIn: [] };
  expect(assertSchemaInventory(readSchemaInventory(db), contract, "fixture").objects.find(object => object.name === "retained_history")?.owner).toBe("fixture");
  db.exec("DROP TABLE retained_history");
  expect(assertSchemaInventory(readSchemaInventory(db), contract, "fixture").errors).toEqual([]);
}));

test("an index on an optional retained table remains required whenever its parent is present", () => withDatabase((db, contract) => {
  contract.objects["table:records"]!.requiredIn = [];
  contract.objects["index:records_state"]!.requiredIn = [];
  db.exec("DROP INDEX records_state");
  expect(() => assertSchemaInventory(readSchemaInventory(db), contract, "fixture")).toThrow("Missing required object index:records_state");
}));

test("partial retained owner components require their declared tables", () => withDatabase((db, contract) => {
  const expected = contract.objects["table:records"]!;
  expected.requiredIn = [];
  expected.requiredWhenOwnerPresent = true;
  for (const object of Object.values(contract.objects)) if (object.table === "records") object.requiredIn = [];
  db.exec("DROP TABLE records");
  expect(() => assertSchemaInventory(readSchemaInventory(db), contract, "fixture")).toThrow("Missing required object table:records");
}));

test("unowned documents and unsupported contract versions fail closed", () => withDatabase((db, contract) => {
  contract.documents.push({ kind: "orphan", owner: "missing", scope: "conversation", history: "latest", fork: "initial" });
  expect(() => assertSchemaInventory(readSchemaInventory(db), contract, "fixture")).toThrow("Unowned or incomplete document orphan");
  contract.documents = [];
  (contract as { version: number }).version = 2;
  expect(() => assertSchemaInventory(readSchemaInventory(db), contract, "fixture")).toThrow("Unsupported schema contract version 2");
}));

test("inventory borrows a caller transaction without committing or rolling it back", () => withDatabase((db, contract) => {
  expect(() => db.transaction(() => {
    db.exec("INSERT INTO audit VALUES('uncommitted')");
    assertSchemaInventory(readSchemaInventory(db), contract, "fixture");
    expect(db.inTransaction).toBe(true);
    throw Error("rollback owned fixture");
  }).immediate()).toThrow("rollback owned fixture");
  expect(db.query("SELECT * FROM audit").all()).toEqual([]);
}));

test("unknown profile and incomplete owner fail closed", () => withDatabase((db, contract) => {
  expect(classifySchemaInventory(readSchemaInventory(db), contract, "typo").errors).toContain("Unknown schema profile typo");
  contract.owners.fixture!.writers = [];
  expect(() => assertSchemaInventory(readSchemaInventory(db), contract, "fixture")).toThrow("Incomplete owner");
}));

test("retired owners have no active writers; exact shape and retention requirements remain enforced", () => withDatabase((db, contract) => {
  const before=db.query("SELECT * FROM sqlite_schema ORDER BY name").all();
  contract.owners.fixture!.category="retired";contract.owners.fixture!.writers=[];
  expect(assertSchemaInventory(readSchemaInventory(db),contract,"fixture").objects.every(object=>object.category==="retired")).toBe(true);
  expect(db.query("SELECT * FROM sqlite_schema ORDER BY name").all()).toEqual(before);
  contract.owners.fixture!.replayRetention="";
  expect(()=>assertSchemaInventory(readSchemaInventory(db),contract,"fixture")).toThrow("Incomplete owner");
  contract.owners.fixture!.replayRetention="retain original data without runtime writes";
  db.exec("DROP INDEX records_state");
  expect(()=>assertSchemaInventory(readSchemaInventory(db),contract,"fixture")).toThrow("Missing required object index:records_state");
}));

test("formatting, IF NOT EXISTS and column declaration order normalise; PK order and strings do not", () => {
  const canonical = (sql: string) => canonicalSchemaSql(sql, "table");
  expect(canonical("CREATE TABLE sample(a TEXT,b INTEGER,PRIMARY KEY(a,b))")).toEqual(canonical("create table if not exists sample ( b integer, a text, primary key(a,b)); -- comment"));
  expect(canonical("CREATE TABLE sample(a TEXT,b INTEGER,PRIMARY KEY(a,b))")).not.toEqual(canonical("CREATE TABLE sample(a TEXT,b INTEGER,PRIMARY KEY(b,a))"));
  expect(canonical("CREATE TABLE sample(a TEXT CHECK(a='a b'))")).not.toEqual(canonical("CREATE TABLE sample(a TEXT CHECK(a='a  b'))"));
  expect(canonical('CREATE TABLE sample(a TEXT CHECK(a="Pending"))')).not.toEqual(canonical('CREATE TABLE sample(a TEXT CHECK(a="pending"))'));
  expect(canonical('CREATE TABLE sample("virtual" TEXT,b INTEGER)')).toEqual(canonical('CREATE TABLE sample(b INTEGER,"virtual" TEXT)'));
});

test("FTS virtual and exact shadow tables have owners; similarly named impostors do not", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE VIRTUAL TABLE search USING fts5(content)");
    const contract = contractFor(db), objects = readSchemaInventory(db);
    expect(objects.find(object => object.name === "search")?.storageKind).toBe("virtual");
    expect(objects.some(object => object.storageKind === "shadow")).toBe(true);
    expect(assertSchemaInventory(objects, contract, "fixture").errors).toEqual([]);
    db.exec("CREATE TABLE search_invented(value)");
    expect(() => assertSchemaInventory(readSchemaInventory(db), contract, "fixture")).toThrow("Unowned object table:search_invented");
  } finally { db.close(); }
});

test("safe-integer metadata produces the same derived-index fingerprints", () => {
  const plain = new Database(":memory:"), safe = new Database(":memory:", { safeIntegers: true });
  try {
    for (const db of [plain, safe]) db.exec(base);
    expect(readSchemaInventory(safe)).toEqual(readSchemaInventory(plain));
    expect(assertSchemaInventory(readSchemaInventory(safe), contractFor(plain), "fixture").errors).toEqual([]);
  } finally { plain.close(); safe.close(); }
});
