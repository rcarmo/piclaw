import { afterEach, expect, test } from "bun:test";
import Database from "bun:sqlite";
import { createHash } from "node:crypto";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDatabase, getDb } from "../../src/db/connection.js";
import { acquireRuntimeLock } from "../../src/runtime/single-instance.js";
import { inventoryLegacySources } from "../../src/agent-pool/legacy-source-inventory.js";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });
function fixture() {
  initDatabase();
  const dir = mkdtempSync(join(tmpdir(), "legacy-inventory-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, "root.db");
  writeFileSync(dbPath, getDb().serialize());
  const root = new Database(dbPath);
  cleanup.push(() => root.close());
  root.exec("DELETE FROM messages; DELETE FROM chat_branches; DELETE FROM chats;");
  for (const id of ["web:a", "web:b", "web:empty"]) {
    root.query("INSERT INTO chats(jid) VALUES (?)").run(id);
    root.query("INSERT INTO chat_branches(branch_id,chat_jid,root_chat_jid,agent_name,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .run(`branch-${id}`, id, id, id, "2026-01-01", "2026-01-01");
  }
  const legacySessionRoot = join(dir, "legacy"); mkdirSync(legacySessionRoot);
  for (const id of ["web_a", "web_b"]) mkdirSync(join(legacySessionRoot, id));
  const file = join(legacySessionRoot, "web_a", "one.jsonl");
  const time = "2026-01-01T00:00:00.000Z";
  const lines = [
    { type: "session", version: 3, id: "original-session", timestamp: time, cwd: dir },
    { type: "message", id: "base", parentId: null, timestamp: time, message: { role: "system", content: "not a persisted host baseline binding", timestamp: 1 } },
    ...["left", "right"].map(id => ({ type: "message", id, parentId: "base", timestamp: time, message: { role: "user", content: id, timestamp: 2 } })),
  ];
  writeFileSync(file, lines.map(l => JSON.stringify(l)).join("\n") + "\n");
  symlinkSync(file, join(legacySessionRoot, "web_b", "shared.jsonl"));
  const owner = acquireRuntimeLock({ lockPath: join(dir, "owner.lock"), strictOwnership: true });
  cleanup.push(() => owner.release());
  const options = { root, legacySessionRoot, owner };
  return { ...options, options, file, dir };
}
test("actual persisted root rows inventory shared bytes once, retain every chat and tree leaf, never invent bindings", () => {
  const f = fixture(), before = f.root.serialize(), bytes = readFileSync(f.file);
  const result = inventoryLegacySources(f.options);
  expect(result.status).toBe("BLOCKED"); expect(result.preparable).toBe(false);
  expect(result.sources).toHaveLength(1);
  expect(result.sources[0]!.chatJids).toEqual(["web:a", "web:b"]);
  expect(result.sources[0]!.leafIds).toEqual(["left", "right"]);
  expect(result.sources[0]!.sourceSessionId).toBe("original-session");
  expect(Buffer.from(result.sources[0]!.sourceBytesBase64, "base64")).toEqual(bytes);
  expect(result.references).toHaveLength(3);
  expect(result.references.every(r => r.sessionId === null && r.persistedLeafId === null && r.hostBaseline === null)).toBe(true);
  expect(result.references.find(r => r.chatJid === "web:empty")!.classification).toBe("existing-empty-unproven");
  expect(Object.isFrozen(result.sources[0])).toBe(true);
  result.revalidate();
  expect(f.root.serialize()).toEqual(before); expect(readFileSync(f.file)).toEqual(bytes);
});
test("source mutation, additions and root frontier mutation invalidate captured input", () => {
  const f = fixture(), result = inventoryLegacySources(f.options);
  f.root.query("UPDATE chats SET name='changed' WHERE jid=?").run("web:a");
  expect(result.revalidate).toThrow("Root DB frontier changed");
  const next = inventoryLegacySources(f.options);
  writeFileSync(f.file, readFileSync(f.file, "utf8") + "\n");
  expect(next.revalidate).toThrow("Legacy source changed");
  const last = inventoryLegacySources(f.options);
  writeFileSync(join(f.legacySessionRoot, "added.jsonl"), "bad");
  expect(last.revalidate).toThrow("Legacy directory changed");
});
test("escape, dangling reference, malformed and incomplete history fail without DB writes", () => {
  const f = fixture(), before = f.root.serialize();
  writeFileSync(join(f.dir, "outside.jsonl"), "bad");
  const link = join(f.legacySessionRoot, "escape.jsonl");
  symlinkSync(join(f.dir, "outside.jsonl"), link);
  expect(() => inventoryLegacySources(f.options)).toThrow("Legacy path escape");
  rmSync(link); rmSync(f.file);
  expect(() => inventoryLegacySources(f.options)).toThrow(); // shared symlink now dangling
  rmSync(join(f.legacySessionRoot, "web_b", "shared.jsonl"));
  writeFileSync(f.file, "{broken");
  expect(() => inventoryLegacySources(f.options)).toThrow();
  writeFileSync(f.file, JSON.stringify({ type: "session", version: 3, id: "s", cwd: f.dir, timestamp: "2026-01-01" }));
  expect(() => inventoryLegacySources(f.options)).toThrow("Incomplete legacy history");
  expect(f.root.serialize()).toEqual(before);
});
test("held WAL read snapshot rejects capture and every revalidation, then detects late committed chat", () => {
  const f = fixture();
  f.root.exec("PRAGMA journal_mode=WAL");
  const writer = new Database(join(f.dir, "root.db"));
  cleanup.push(() => writer.close());
  const result = inventoryLegacySources(f.options);
  f.root.exec("BEGIN");
  f.root.query("SELECT * FROM chats").all(); // pin old WAL snapshot
  writer.query("INSERT INTO chats(jid) VALUES (?)").run("web:late-committed");
  expect(f.root.query("SELECT jid FROM chats WHERE jid=?").get("web:late-committed")).toBeNull();
  expect(() => inventoryLegacySources(f.options)).toThrow("Root DB transaction active");
  expect(result.revalidate).toThrow("Root DB transaction active");
  expect(result.revalidate).toThrow("Root DB transaction active");
  f.root.exec("ROLLBACK");
  expect(result.revalidate).toThrow("Root DB frontier changed");
  const fresh = inventoryLegacySources(f.options);
  expect(fresh.references.map(r => r.chatJid)).toContain("web:late-committed");
  expect(fresh.references).toHaveLength(4);
});
test("transaction opened during capture or revalidation cannot pass the end guard", () => {
  const f = fixture();
  let calls = 0, beginAt = Infinity;
  const owner = { enabled: true, strictOwnership: true, assertCurrentOwner() {
    f.owner.assertCurrentOwner();
    if (++calls === beginAt) f.root.exec("BEGIN");
  } };
  const guarded = inventoryLegacySources({ ...f.options, owner });
  calls = 0; beginAt = 4; // final ownership callback at revalidation end
  expect(guarded.revalidate).toThrow("Root DB transaction active");
  f.root.exec("ROLLBACK");
  calls = 0; beginAt = 2; // initial frontier capture
  expect(() => inventoryLegacySources({ ...f.options, owner })).toThrow("Root DB transaction active");
  f.root.exec("ROLLBACK");
});
test("public Pi inMemory root/fork headers, usage and bash records retain exact frozen bytes", () => {
  const f = fixture();
  const manager = SessionManager.inMemory(f.dir, { parentSession: join(f.dir, "parent.jsonl") });
  manager.appendMessage({ role: "user", content: "hello", timestamp: 1 });
  manager.appendUsage("cache_warm", "provider", "model", { input: 1, output: 0, cacheRead: 0, cacheWrite: 0,
    totalTokens: 1, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
  manager.appendMessage({ role: "bashExecution", command: "printf hi", output: "hi", exitCode: 0,
    cancelled: false, truncated: false, timestamp: 2 });
  const bytes = Buffer.from([manager.getHeader(), ...manager.getEntries()].map(r => JSON.stringify(r)).join("\n") + "\n");
  writeFileSync(f.file, bytes);
  const rootManager = SessionManager.inMemory(f.dir);
  rootManager.appendMessage({ role: "user", content: "root", timestamp: 1 });
  const rootFile = join(f.legacySessionRoot, "root.jsonl");
  writeFileSync(rootFile, [rootManager.getHeader(), ...rootManager.getEntries()].map(r => JSON.stringify(r)).join("\n") + "\n");
  const result = inventoryLegacySources(f.options), source = result.sources.find(s => s.canonicalPath === f.file)!;
  expect(source.unsupportedRecords).toEqual([]);
  expect(result.sources).toHaveLength(2);
  expect(source.sourceSessionId).toBe(manager.getHeader()!.id);
  expect(source.sourceBytesBase64).toBe(bytes.toString("base64"));
  expect(source.sourceSHA256).toBe(createHash("sha256").update(bytes).digest("hex"));
  expect(Object.isFrozen(source.unsupportedRecords)).toBe(true);
  result.revalidate();
});
test("future schemas report per file without dropping bytes, other sources or empty chats", () => {
  const f = fixture();
  const manager = SessionManager.inMemory(f.dir);
  manager.appendMessage({ role: "user", content: "unrelated", timestamp: 1 });
  writeFileSync(join(f.legacySessionRoot, "unrelated.jsonl"), [manager.getHeader(), ...manager.getEntries()].map(r => JSON.stringify(r)).join("\n") + "\n");
  const time = "2026-01-01T00:00:00.000Z";
  const bytes = Buffer.from(readFileSync(f.file, "utf8") + [
    { type: "future_record", id: "future", parentId: "left", timestamp: time, payload: "keep" },
    { type: "message", id: "extended", parentId: "future", timestamp: time, futureField: true,
      message: { role: "user", content: "keep too", timestamp: 3 } },
  ].map(r => JSON.stringify(r)).join("\n") + "\n");
  writeFileSync(f.file, bytes);
  const result = inventoryLegacySources(f.options), source = result.sources.find(s => s.canonicalPath === f.file)!;
  expect(source.unsupportedRecords.map(r => r.recordId)).toEqual(["future", "extended"]);
  expect(source.sourceBytesBase64).toBe(bytes.toString("base64"));
  expect(result.sources).toHaveLength(2);
  expect(result.references).toHaveLength(3);
  expect(result.references.find(r => r.chatJid === "web:empty")!.classification).toBe("existing-empty-unproven");
  expect(result.status).toBe("BLOCKED");
  result.revalidate();
  writeFileSync(f.file, bytes.toString() + JSON.stringify({ type: "future", id: "bad", parentId: "missing", timestamp: time }) + "\n");
  expect(() => inventoryLegacySources(f.options)).toThrow("Malformed legacy tree");
  writeFileSync(f.file, bytes.toString() + '{"type":');
  expect(() => inventoryLegacySources(f.options)).toThrow();
});
test("source traversal uses ordinal rather than locale-dependent order", () => {
  const f = fixture(), bytes = readFileSync(f.file);
  for (const name of ["a", "Z", "_"]) writeFileSync(join(f.legacySessionRoot, `${name}.jsonl`), bytes);
  const result = inventoryLegacySources(f.options);
  expect(result.sources.slice(0, 3).map(s => s.canonicalPath)).toEqual(
    ["Z", "_", "a"].map(name => join(f.legacySessionRoot, `${name}.jsonl`)));
  result.revalidate();
});
test("owner loss rejects before reads and on later revalidation", () => {
  const f = fixture(), result = inventoryLegacySources(f.options);
  f.owner.release();
  expect(result.revalidate).toThrow();
  expect(() => inventoryLegacySources(f.options)).toThrow();
});
