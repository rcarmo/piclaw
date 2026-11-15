import "./src/test-guard.js";
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { assertApplicationBranchRoutes } from "../../runtime/durable-engine/src/application-bootstrap.js";

test("historical default bindings do not loosen copied/imported branch publication gates", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE chat_branches(chat_jid TEXT,branch_id TEXT,archived_at TEXT); INSERT INTO chat_branches VALUES('web:archived','stable-branch','2026-10-25T00:00:00.000Z')");
    const manifest = [{ chatJid: "web:archived", branchId: "stable-branch" }];
    expect(() => assertApplicationBranchRoutes(db, manifest)).toThrow("Exact application branch manifest required");
    expect(() => assertApplicationBranchRoutes(db, manifest, true)).not.toThrow();
    expect(() => assertApplicationBranchRoutes(db, [{ ...manifest[0]!, branchId: "wrong" }], true)).toThrow("Exact application branch manifest required");
    expect(() => assertApplicationBranchRoutes(db, [{ chatJid: "web:missing", branchId: "stable-branch" }], true)).toThrow("Exact application branch manifest required");
    expect(() => assertApplicationBranchRoutes(db, [{ chatJid: "fixture:synthetic", branchId: "main" }])).not.toThrow();
  } finally { db.close(); }
});
