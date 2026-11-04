/**
 * test/scripts/token-chart-provider-model-cost.test.ts – Tests the estimated provider+model cost mode.
 */

import { expect, test } from "bun:test";
import "../helpers.js";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import Database from "bun:sqlite";
import { PROVIDER_MODEL_PRICING_REFERENCE_TAG } from "../../skills/operator/token-chart/provider-model-pricing-reference.ts";

test("token-chart --mode provider-model-cost renders an estimated cost chart with the pricing reference tag", () => {
  const base = join(tmpdir(), `piclaw-tokenchart-provider-model-cost-${Date.now()}`);
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
    1_000_000,
    500_000,
    2_000_000,
    0,
    3_500_000,
    0,
    0,
    0,
    0,
    0,
    "gpt-5.4",
    "openai-codex",
    null,
    null
  );

  insert.run(
    "web:default",
    yesterday.toISOString(),
    1_000_000,
    100_000,
    1_000_000,
    500_000,
    2_600_000,
    0,
    0,
    0,
    0,
    0,
    "claude-sonnet-4.6",
    "github-copilot",
    null,
    null
  );

  const proc = Bun.spawnSync(
    [
      "bun",
      "/workspace/piclaw/runtime/skills/operator/token-chart/token-chart.ts",
      "--days",
      "2",
      "--source",
      "db",
      "--mode",
      "provider-model-cost",
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
  expect(output).toContain("Estimated cost chart (provider + model): last 2 days • $17.2 across 2 active series");
  expect(output).toContain(`pricing ref ${PROVIDER_MODEL_PRICING_REFERENCE_TAG}`);

  rmSync(base, { recursive: true, force: true });
});
