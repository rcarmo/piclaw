import "./src/test-guard.js";
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { configureHostWalFixtureDatabase, openWalFixtureDatabase } from "./src/sqlite-fixture-policy.js";

async function disk(run: (path: string) => Promise<void>) {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "wal-policy-"));
  try { await run(join(dir, "fixture.sqlite")); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

describe("WAL FULL policy for historical separate fixtures, not shared application schema", () => {
  test("copied host file uses production WAL initializer, retains FULL and owner busy_timeout on reopen", () => disk(async path => {
    const source = new Database(":memory:");
    try { source.exec("CREATE TABLE sample (n INTEGER)"); source.query("VACUUM INTO ?").run(path); }
    finally { source.close(); }
    for (let open = 0; open < 2; open++) {
      const db = new Database(path, { strict: true });
      try {
        expect(db.query("PRAGMA synchronous").get()).toEqual({ synchronous: 2 });
        db.exec("PRAGMA busy_timeout=321");
        configureHostWalFixtureDatabase(db);
        configureHostWalFixtureDatabase(db);
        expect(db.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
        expect(db.query("PRAGMA synchronous").get()).toEqual({ synchronous: 2 });
        expect(db.query("PRAGMA busy_timeout").get()).toEqual({ timeout: 321 });
        db.query("INSERT INTO sample VALUES (?)").run(open);
        expect(await Bun.file(`${path}-wal`).exists()).toBe(true);
      } finally { db.close(); }
    }
  }));

  test("standalone candidate file verifies WAL and FULL on every open; public transaction rollback remains intact", () => disk(async path => {
    const first = await openWalFixtureDatabase(path);
    try {
      expect(await first.get("SELECT * FROM pragma_journal_mode")).toEqual({ journal_mode: "wal" });
      expect(await first.get("SELECT * FROM pragma_synchronous")).toEqual({ synchronous: 2 });
      await first.exec("CREATE TABLE sample (n INTEGER)");
      await first.run("INSERT INTO sample VALUES (1)");
      const rejected = new Error("policy rollback probe");
      await expect(first.transaction(async tx => {
        await tx.run("INSERT INTO sample VALUES (2)");
        throw rejected;
      })).rejects.toBe(rejected);
      expect(await first.all("SELECT n FROM sample")).toEqual([{ n: 1 }]);
      expect(await Bun.file(`${path}-wal`).exists()).toBe(true);
    } finally { await first.close(); }
    const reopened = await openWalFixtureDatabase(path);
    try {
      expect(await reopened.get("SELECT * FROM pragma_journal_mode")).toEqual({ journal_mode: "wal" });
      expect(await reopened.get("SELECT * FROM pragma_synchronous")).toEqual({ synchronous: 2 });
      expect(await reopened.all("SELECT n FROM sample")).toEqual([{ n: 1 }]);
    } finally { await reopened.close(); }
  }));
});
