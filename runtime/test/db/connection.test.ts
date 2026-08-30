import { expect, test } from "bun:test";
import "../helpers.js";

import Database from "bun:sqlite";
import { dropObsoleteRemoteInteropSchema, getDb, initDatabase, isLikelyTestHarnessProcess, setAllowLiveDbInTestsForTests, shouldBlockLiveDatabaseOpenInTests } from "../../src/db/connection.js";

test("isLikelyTestHarnessProcess detects direct test argv values", () => {
  expect(isLikelyTestHarnessProcess(["bun", "test/channels/web/oobe-instance-state.test.ts"])).toBe(true);
  expect(isLikelyTestHarnessProcess(["bun", "src/index.ts"])).toBe(false);
});

test("shouldBlockLiveDatabaseOpenInTests refuses the canonical live db for test processes", () => {
  expect(shouldBlockLiveDatabaseOpenInTests({
    useMemory: false,
    nextPath: "/workspace/.piclaw/store/messages.db",
    workspaceDir: "/workspace",
    argv: ["bun", "test/channels/web/oobe-instance-state.test.ts"],
  })).toBe(true);

  expect(shouldBlockLiveDatabaseOpenInTests({
    useMemory: true,
    nextPath: "/workspace/.piclaw/store/messages.db",
    workspaceDir: "/workspace",
    argv: ["bun", "test/channels/web/oobe-instance-state.test.ts"],
  })).toBe(false);

  expect(shouldBlockLiveDatabaseOpenInTests({
    useMemory: false,
    nextPath: "/tmp/piclaw-test/store/messages.db",
    workspaceDir: "/tmp/piclaw-test",
    argv: ["bun", "test/channels/web/oobe-instance-state.test.ts"],
  })).toBe(false);

  const restore = setAllowLiveDbInTestsForTests(true);
  try {
    expect(shouldBlockLiveDatabaseOpenInTests({
      useMemory: false,
      nextPath: "/workspace/.piclaw/store/messages.db",
      workspaceDir: "/workspace",
      argv: ["bun", "test/channels/web/oobe-instance-state.test.ts"],
    })).toBe(false);
  } finally {
    restore();
  }
});

test("fresh core schema contains no peer-owned remote tables", () => {
  initDatabase();
  const tables = (getDb().query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(row => row.name);
  for (const table of ["remote_result_callbacks", "remote_requests", "remote_pair_outbound_requests", "remote_pair_requests", "remote_audit_logs", "remote_peers"]) {
    expect(tables).not.toContain(table);
  }
  expect(tables).toContain("core_schema_migrations");
  expect(tables).toContain("compaction_telemetry");
});

test("remote interop schema cleanup is transactional and idempotent", () => {
  const database = new Database(":memory:");
  for (const table of ["remote_peers", "remote_pair_requests", "remote_pair_outbound_requests", "remote_requests", "remote_audit_logs", "remote_result_callbacks"]) {
    database.exec(`CREATE TABLE ${table} (id TEXT)`);
  }
  dropObsoleteRemoteInteropSchema(database);
  dropObsoleteRemoteInteropSchema(database);
  const tables = (database.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(row => row.name);
  expect(tables.filter(name => name.startsWith("remote_"))).toEqual([]);
  expect((database.query("SELECT COUNT(*) AS count FROM core_schema_migrations WHERE name = 'drop-core-remote-interop-v1'").get() as { count: number }).count).toBe(1);
  database.close();
});

test("initDatabase reopens a stale cached sqlite handle", () => {
  initDatabase();
  const first = getDb();
  first.close();

  expect(() => initDatabase()).not.toThrow();

  const reopened = getDb();
  const row = reopened.query("SELECT 1 AS ok").get() as { ok: number } | null;
  expect(row?.ok).toBe(1);
});
