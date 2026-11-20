/**
 * test/scripts/token-chart.test.ts – Tests for token chart data generation.
 *
 * Verifies aggregateTokenUsage() produces correct daily buckets, cost
 * summaries, and chart-ready data from token_usage records.
 */

import { expect, test } from "bun:test";
import "../helpers.js";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import Database from "bun:sqlite";

function formatDay(d: Date) {
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${dayNames[d.getDay()]} ${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

test("token chart outputs chart first and summary lines", () => {
  const sessionsDir = join(tmpdir(), `piclaw-sessions-${Date.now()}`);
  mkdirSync(sessionsDir, { recursive: true });

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const entries = [
    {
      type: "message",
      timestamp: now.toISOString(),
      message: {
        role: "assistant",
        usage: { input: 1000, output: 500, cacheRead: 200, cacheWrite: 100 },
        timestamp: Date.now(),
      },
    },
    {
      type: "message",
      timestamp: yesterday.toISOString(),
      message: {
        role: "assistant",
        usage: { input: 300, output: 200, cacheRead: 100, cacheWrite: 50 },
        timestamp: Date.now(),
      },
    },
  ];

  writeFileSync(join(sessionsDir, "session.jsonl"), entries.map((e) => JSON.stringify(e)).join("\n"));

  const proc = Bun.spawnSync([
    process.execPath,
    join(import.meta.dir, "../../skills/operator/token-chart/token-chart.ts"),
    "--days",
    "2",
    "--sessions-dir",
    sessionsDir,
  ]);

  const output = proc.stdout.toString();
  const lines = output.trim().split("\n");

  expect(lines[0].startsWith("![token-chart](data:image/svg+xml;base64,"))
    .toBe(true);

  const todayLine = lines.find((line) => line.includes(formatDay(now)));
  const yesterdayLine = lines.find((line) => line.includes(formatDay(yesterday)));

  expect(todayLine).toContain("1.8K tokens");
  expect(yesterdayLine).toContain("650 tokens");
  expect(todayLine).toContain("cached 300");
  expect(yesterdayLine).toContain("cached 150");
});

test("token chart handles empty sessions directory", () => {
  const sessionsDir = join(tmpdir(), `piclaw-sessions-empty-${Date.now()}`);
  mkdirSync(sessionsDir, { recursive: true });

  const proc = Bun.spawnSync([
    process.execPath,
    join(import.meta.dir, "../../skills/operator/token-chart/token-chart.ts"),
    "--days",
    "1",
    "--sessions-dir",
    sessionsDir,
  ]);

  const output = proc.stdout.toString();
  expect(output).toContain("total 0");
  expect(output).toContain("0 tokens");
});

test("token chart aggregates cached and uncached daily usage without provenance columns", () => {
  const base = join(tmpdir(), `piclaw-tokenchart-db-${Date.now()}`);
  const storeDir = join(base, "store");
  const svgPath = join(base, "token-chart.svg");
  mkdirSync(storeDir, { recursive: true });

  const db = new Database(join(storeDir, "messages.db"));
  db.exec(`
    CREATE TABLE token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_jid TEXT NOT NULL,
      run_at TEXT NOT NULL,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      cache_write_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      cost_input REAL DEFAULT 0,
      cost_output REAL DEFAULT 0,
      cost_cache_read REAL DEFAULT 0,
      cost_cache_write REAL DEFAULT 0,
      cost_total REAL DEFAULT 0,
      model TEXT,
      provider TEXT,
      api TEXT,
      turns INTEGER DEFAULT 0
    )
  `);

  const now = new Date();
  const insert = db.prepare(`
    INSERT INTO token_usage (
      chat_jid, run_at, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
      total_tokens, cost_input, cost_output, cost_cache_read, cost_cache_write, cost_total,
      model, provider, api, turns
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run("web:default", now.toISOString(), 1000, 500, 200, 100, 1800, 0, 0, 0, 0, 0, "model-a", "openai-codex", null, 1);
  insert.run("web:default", now.toISOString(), 300, 100, 50, 50, 500, 0, 0, 0, 0, 0, "model-b", "openai-codex", null, 1);
  db.close();

  const proc = Bun.spawnSync([
    process.execPath,
    join(import.meta.dir, "../../skills/operator/token-chart/token-chart.ts"),
    "--days",
    "1",
    "--source",
    "db",
    "--output-svg",
    svgPath,
  ], {
    env: {
      ...process.env,
      PICLAW_STORE: storeDir,
    },
  });

  const output = proc.stdout.toString();
  const svg = readFileSync(svgPath, "utf8");

  expect(output).toContain("total 2.3K");
  expect(output).toContain("Cached 400 tokens • uncached 1.9K");
  expect(output).toContain("cached 400, uncached 1.9K");
  expect(svg).toContain(">uncached</text>");
  expect(svg).toContain(">cached</text>");
  expect(svg).toContain("cached 400");
  expect(svg).toContain("uncached 1.9K");

  rmSync(base, { recursive: true, force: true });
});

test("token chart ignores malformed JSONL lines", () => {
  const sessionsDir = join(tmpdir(), `piclaw-sessions-malformed-${Date.now()}`);
  mkdirSync(sessionsDir, { recursive: true });

  const now = new Date();
  const entries = [
    "{not-json}",
    JSON.stringify({
      type: "message",
      timestamp: now.toISOString(),
      message: {
        role: "assistant",
        usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
        timestamp: Date.now(),
      },
    }),
  ];

  writeFileSync(join(sessionsDir, "session.jsonl"), entries.join("\n"));

  const proc = Bun.spawnSync([
    process.execPath,
    join(import.meta.dir, "../../skills/operator/token-chart/token-chart.ts"),
    "--days",
    "1",
    "--sessions-dir",
    sessionsDir,
  ]);

  const output = proc.stdout.toString();
  expect(output).toContain("150 tokens");
});
