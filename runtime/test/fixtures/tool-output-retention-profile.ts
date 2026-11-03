/** DB-only tool-output search/retention audit; synthetic, offline disk WAL. */
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { initDatabase, getDb, closeDatabase } from "../../src/db/connection.js";
import { storeToolOutputWithChunks, searchToolOutputSnippets, deleteToolOutputsBefore, getToolOutputById } from "../../src/db/tool-outputs.js";
import { assertPathWithinTestFilesystemIsolation } from "../../scripts/test-filesystem-isolation.js";
import type { ToolOutputRecord } from "../../src/db/types.js";

assertPathWithinTestFilesystemIsolation(process.env.PICLAW_STORE!, process.env, { allowRoot: false });
assert.equal(process.env.PICLAW_DB_IN_MEMORY, "0");
const size = Number(process.argv[2]), mode = process.argv[3] ?? "plain";
assert([10, 100, 1000].includes(size)); assert(["plain", "instrument", "cpu"].includes(mode));
// Fix search policy without relying on live configuration or inherited aliases.
mkdirSync(join(process.env.PICLAW_WORKSPACE!, ".piclaw"), { recursive: true });
writeFileSync(join(process.env.PICLAW_WORKSPACE!, ".piclaw", "config.json"), "{}");
const old = "2000-01-01T00:00:00.000Z", fresh = "2999-01-01T00:00:00.000Z", cutoff = "2026-01-01T00:00:00.000Z";
try {
  initDatabase(); const db = getDb();
  assert.deepEqual(db.query("PRAGMA journal_mode").get(), { journal_mode: "wal" });
  assert.deepEqual(db.query("PRAGMA synchronous").get(), { synchronous: 2 });
  assert.deepEqual(db.query("PRAGMA busy_timeout").get(), { timeout: 0 });
  const seedStart = performance.now();
  // Use real atomic helpers, but outer fixture transaction excludes per-output
  // durable commits from seed time. Runtime writes/FS cleanup are not profiled.
  db.transaction(() => {
    for (let n = 0; n < size; n++) storeToolOutputWithChunks({ id: `fixture-${n}`, created_at: n % 2 ? fresh : old, source: "fixture", summary: "synthetic" },
      Array.from({ length: 10 }, (_, chunk) => `common marker${n} ${chunk === 0 ? `rare${n}` : "ordinary"} chunk ${chunk} synthetic output`));
  }).immediate();
  const seedMs = performance.now() - seedStart;
  const prepared = db.prepare, queried = db.query;
  let counts: Record<string, { calls: number; ms: number; rows?: number }> = {};
  const record = (name: string) => counts[name] ??= { calls: 0, ms: 0 };
  const enable = () => {
    if (mode !== "instrument") return;
    db.query = ((sql: string) => {
      const stmt = Reflect.apply(queried, db, [sql]);
      const entry = record("query"); entry.calls++;
      return new Proxy(stmt, { get(target, key) {
        if (key !== "get") return Reflect.get(target, key, target);
        return (...args: unknown[]) => {
          const start = performance.now();
          try { const result = Reflect.apply(target.get, target, args); record("get").calls++; return result; }
          finally { record("get").ms += performance.now() - start; }
        };
      } });
    }) as typeof db.query;
    db.prepare = ((sql: string, ...params: unknown[]) => {
      const start = performance.now(), stmt = Reflect.apply(prepared, db, [sql, ...params]);
      const entry = record("prepare"); entry.calls++; entry.ms += performance.now() - start;
      return new Proxy(stmt, { get(target, key) {
        if (key !== "all" && key !== "get" && key !== "run") return Reflect.get(target, key, target);
        return (...args: unknown[]) => {
          const start = performance.now();
          try {
            const result = Reflect.apply(target[key], target, args), entry = record(String(key)); entry.calls++;
            if (key === "all") entry.rows = (entry.rows ?? 0) + (result as unknown[]).length;
            return result;
          } finally { record(String(key)).ms += performance.now() - start; }
        };
      } });
    }) as typeof db.prepare;
  };
  const target = `fixture-${size - 1}`;
  const observations: unknown[] = [];
  for (const query of ["common", `rare${size - 1}`]) {
    const expected = searchToolOutputSnippets(target, query, 5);
    assert.equal(expected.length, query === "common" ? 5 : 1);
    assert(expected.every(text => text.includes(`marker${size - 1}`)));
    for (let run = 0; run < 4; run++) {
      counts = {}; enable();
      const tickStart = performance.now();
      const tick = new Promise<number>(resolve => setTimeout(() => resolve(performance.now() - tickStart), 0));
      const cpu = process.cpuUsage(), start = performance.now();
      let result: string[] = [];
      let ms: number, used: ReturnType<typeof process.cpuUsage>;
      try {
        for (let n = 0; n < 100; n++) result = searchToolOutputSnippets(target, query, 5);
        ms = performance.now() - start; used = process.cpuUsage(cpu);
      } finally { db.prepare = prepared; db.query = queried; }
      const tickMs = await tick;
      // LIMIT has no ORDER BY: accept valid target chunks in any order/subset.
      assert.equal(result.length, expected.length);
      assert(result.every(text => text.includes(`marker${size - 1}`) && text.includes(query)));
      observations.push({ queryClass: query === "common" ? "common" : "rare", run, calls: 100, ms, cpu: used, tickMs, counts: mode === "instrument" ? counts : null });
    }
  }
  assert.deepEqual(searchToolOutputSnippets("fixture-missing", "common"), []);
  const plan = db.query("EXPLAIN QUERY PLAN SELECT snippet(tool_outputs_fts,0,'[',']','…',12) FROM tool_outputs_fts WHERE tool_outputs_fts MATCH ? AND output_id=? LIMIT ?").all("common", target, 5);
  counts = {}; enable();
  const tickStart = performance.now();
  const tick = new Promise<number>(resolve => setTimeout(() => resolve(performance.now() - tickStart), 0));
  const cpu = process.cpuUsage(), start = performance.now();
  let removed: ToolOutputRecord[], pruneMs: number, used: ReturnType<typeof process.cpuUsage>;
  try { removed = deleteToolOutputsBefore(cutoff); pruneMs = performance.now() - start; used = process.cpuUsage(cpu); }
  finally { db.prepare = prepared; db.query = queried; }
  const pruneTickMs = await tick;
  assert.equal(removed.length, size / 2);
  assert(removed.every(row => Number(row.id.slice(8)) % 2 === 0));
  for (let n = 0; n < size; n++) assert.equal(Boolean(getToolOutputById(`fixture-${n}`)), n % 2 === 1);
  const verifyCounts = () => {
    assert.equal((db.query("SELECT count(*) n FROM tool_outputs").get() as { n: number }).n, size / 2);
    assert.equal((db.query("SELECT count(*) n FROM tool_outputs_fts").get() as { n: number }).n, size * 5);
  };
  verifyCounts();
  assert.deepEqual(searchToolOutputSnippets("fixture-0", "common"), []);
  assert.equal(searchToolOutputSnippets(target, `rare${size - 1}`, 5).length, 1);
  assert.deepEqual(deleteToolOutputsBefore(cutoff), []);
  verifyCounts();
  assert.deepEqual(db.query("PRAGMA quick_check").get(), { quick_check: "ok" });
  const finalDigest = createHash("sha256").update(JSON.stringify({ metadata: db.query("SELECT * FROM tool_outputs ORDER BY id").all(), fts: db.query("SELECT rowid,* FROM tool_outputs_fts ORDER BY rowid").all() })).digest("hex");
  console.log(JSON.stringify({ size, mode, seedMs, chunksPerOutput: 10, finalDigest, observations, searchPlan: plan, retention: { expired: removed.length, ms: pruneMs, cpu: used, tickMs: pruneTickMs, counts: mode === "instrument" ? counts : null },
    scope: "Actual DB helpers, legacy unowned single-user rows. Seed/startup included in external whole-child CPU profile but excluded workload wall/CPU. Search includes dynamic configuration reads; last batch result checked outside timers, unspecified order/subset accepted. Common-before-rare fixed order; no cold-cache/percentile/writer-contention/heap claim. Successful transactional retention and repeat idempotence checked; callback/failure/family/FS contracts qualified separately. No live data/inference." }));
  db.close(true);
} finally { closeDatabase({ shrinkMemory: false }); }
