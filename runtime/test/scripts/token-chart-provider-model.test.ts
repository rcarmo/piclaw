/**
 * test/scripts/token-chart-provider-model.test.ts – Tests the alternative provider+model mode.
 */

import { expect, test } from "bun:test";
import "../helpers.js";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import Database from "bun:sqlite";

test("token-chart --mode provider-model renders an alternative chart", () => {
  const base = join(tmpdir(), `piclaw-tokenchart-provider-model-${Date.now()}`);
  const storeDir = join(base, "store");
  mkdirSync(storeDir, { recursive: true });

  const dbPath = join(storeDir, "messages.db");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE token_usage (
      chat_jid TEXT NOT NULL,
      run_at TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cache_read_tokens INTEGER NOT NULL,
      cache_write_tokens INTEGER NOT NULL,
      total_tokens INTEGER NOT NULL,
      cost_input REAL NOT NULL DEFAULT 0,
      cost_output REAL NOT NULL DEFAULT 0,
      cost_cache_read REAL NOT NULL DEFAULT 0,
      cost_cache_write REAL NOT NULL DEFAULT 0,
      cost_total REAL NOT NULL DEFAULT 0,
      model TEXT,
      provider TEXT,
      api TEXT,
      turns INTEGER
    )
  `);

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const insert = db.prepare(`
    INSERT INTO token_usage (
      chat_jid, run_at, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
      total_tokens, cost_input, cost_output, cost_cache_read, cost_cache_write, cost_total,
      model, provider, api, turns
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run(
    "web:default",
    now.toISOString(),
    100,
    150,
    0,
    50,
    300,
    0,
    0,
    0,
    0,
    0,
    "model-a",
    "provider-a",
    null,
    null
  );

  insert.run(
    "web:default",
    yesterday.toISOString(),
    200,
    100,
    0,
    0,
    300,
    0,
    0,
    0,
    0,
    0,
    "model-b",
    "provider-b",
    null,
    null
  );

  const proc = Bun.spawnSync(
    [
      process.execPath,
      join(import.meta.dir, "../../skills/operator/token-chart/token-chart.ts"),
      "--days",
      "2",
      "--source",
      "db",
      "--mode",
      "provider-model",
    ],
    {
      env: {
        ...process.env,
        PICLAW_STORE: storeDir,
      },
    }
  );

  const output = proc.stdout.toString();

  expect(output.startsWith("![token-chart](data:image/svg+xml;base64,")).toBe(true);
  expect(output).toContain("Alternative chart (provider + model)");
  expect(output).toContain("600 tokens");

  rmSync(base, { recursive: true, force: true });
});
