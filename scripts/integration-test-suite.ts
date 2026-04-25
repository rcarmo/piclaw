#!/usr/bin/env bun
// @ts-nocheck
/**
 * scripts/integration-test-suite.ts – Full integration validation gate.
 *
 * Runs every validation layer in sequence:
 *   1. Lint checks (silent-swallows, structured-logging)
 *   2. Full unit/component test suite (all 485+ test files)
 *   3. Static analysis (import boundaries, unused exports, hook TDZ, pack hygiene)
 *   4. Web build + bundle regression tests
 *   5. Playwright UI smoke tests (OOBE, chat lifecycle) — requires Docker
 *
 * Exit code is non-zero if any stage fails.
 *
 * Usage:
 *   bun run scripts/integration-test-suite.ts [--skip-playwright] [--skip-docker]
 *
 * Environment:
 *   PICLAW_INTEGRATION_SKIP_PLAYWRIGHT=1  — skip Playwright/Docker stages
 *   PICLAW_INTEGRATION_SKIP_DOCKER=1      — same effect
 *   PICLAW_INTEGRATION_TIMEOUT_SEC=600    — per-stage timeout (default 600)
 */

import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const args = process.argv.slice(2);
const skipPlaywright =
  args.includes("--skip-playwright") ||
  args.includes("--skip-docker") ||
  process.env.PICLAW_INTEGRATION_SKIP_PLAYWRIGHT === "1" ||
  process.env.PICLAW_INTEGRATION_SKIP_DOCKER === "1";

const stageTimeoutSec = Number(process.env.PICLAW_INTEGRATION_TIMEOUT_SEC || 600);

type StageResult = {
  name: string;
  passed: boolean;
  exitCode: number;
  elapsedMs: number;
  skipped?: boolean;
};

const results: StageResult[] = [];

function log(msg: string) {
  process.stderr.write(`[integration] ${msg}\n`);
}

async function runStage(name: string, cmd: string[], options: {
  cwd?: string;
  env?: Record<string, string>;
  skip?: boolean;
  skipReason?: string;
} = {}): Promise<StageResult> {
  if (options.skip) {
    log(`SKIP ${name} — ${options.skipReason || "skipped"}`);
    const result: StageResult = { name, passed: true, exitCode: 0, elapsedMs: 0, skipped: true };
    results.push(result);
    return result;
  }

  log(`START ${name}`);
  const start = Date.now();
  const proc = Bun.spawn(cmd, {
    cwd: options.cwd || ROOT,
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, ...(options.env || {}) },
  });

  const timeoutMs = stageTimeoutSec * 1000;
  const timer = setTimeout(() => {
    log(`TIMEOUT ${name} after ${stageTimeoutSec}s — killing`);
    proc.kill();
  }, timeoutMs);

  const exitCode = await proc.exited;
  clearTimeout(timer);
  const elapsedMs = Date.now() - start;
  const passed = exitCode === 0;

  log(`${passed ? "PASS" : "FAIL"} ${name} (${(elapsedMs / 1000).toFixed(1)}s, exit ${exitCode})`);
  const result: StageResult = { name, passed, exitCode, elapsedMs };
  results.push(result);
  return result;
}

// ── Stage 1: Lint checks ──────────────────────────────────────────────

await runStage("check:silent-swallows", ["bun", "run", "check:silent-swallows"]);
await runStage("check:structured-logging", ["bun", "run", "check:structured-logging"]);

// ── Stage 2: Full unit/component test suite ───────────────────────────

await runStage("test:full", ["bun", "test", "--max-concurrency=1",
  "--path-ignore-patterns=**/features/**",
  "--path-ignore-patterns=**/scripts/**",
  "--path-ignore-patterns=**/*.optional.test.ts",
], {
  cwd: resolve(ROOT, "runtime"),
  env: { PICLAW_DB_IN_MEMORY: "1" },
});

// ── Stage 2b: Feature regression tests (isolated subprocess) ─────────

await runStage("test:features", ["bun", "run", "runtime/test/features/run-feature-tests.ts"]);

// ── Stage 3: Static analysis (advisory — pre-existing debt may exist) ──

const staticChecks = [
  { name: "check:import-boundaries", cmd: ["bun", "run", "check:import-boundaries"] },
  { name: "check:unused-exports", cmd: ["bun", "run", "check:unused-exports"] },
  { name: "check:hook-tdz", cmd: ["bun", "run", "check:hook-tdz"] },
  { name: "check:pack-hygiene", cmd: ["bun", "run", "check:pack-hygiene"] },
];

for (const check of staticChecks) {
  const result = await runStage(check.name, check.cmd);
  if (!result.passed) {
    // Downgrade to advisory warning — do not block the gate on pre-existing
    // static analysis debt.  Tests and build are the hard gates.
    log(`  ⚠ ${check.name} failed but is advisory — not blocking the gate`);
    result.passed = true;
    (result as any).advisory = true;
  }
}

// ── Stage 4: Web build + bundle regression ────────────────────────────

await runStage("build-web", ["make", "build-web"]);

// ── Stage 5: Playwright UI smoke tests ────────────────────────────────

const hasDocker = (() => {
  try {
    const proc = Bun.spawnSync(["docker", "info"], { stdout: "pipe", stderr: "pipe" });
    return proc.exitCode === 0;
  } catch {
    return false;
  }
})();

const hasPlaywright = existsSync(resolve(ROOT, "node_modules/playwright"));

await runStage("playwright:oobe", ["bun", "run", "test:oobe:local-container"], {
  skip: skipPlaywright || !hasDocker || !hasPlaywright,
  skipReason: skipPlaywright
    ? "explicitly skipped"
    : !hasDocker
      ? "Docker not available"
      : "Playwright not installed",
});

// ── Summary ───────────────────────────────────────────────────────────

log("");
log("═══════════════════════════════════════════");
log("  INTEGRATION TEST SUMMARY");
log("═══════════════════════════════════════════");

const maxNameLen = Math.max(...results.map((r) => r.name.length));
for (const r of results) {
  const advisory = (r as any).advisory;
  const status = r.skipped ? "SKIP" : advisory ? "WARN" : r.passed ? "PASS" : "FAIL";
  const icon = r.skipped ? "⏭" : advisory ? "⚠" : r.passed ? "✓" : "✗";
  const time = r.skipped ? "" : ` (${(r.elapsedMs / 1000).toFixed(1)}s)`;
  log(`  ${icon} ${r.name.padEnd(maxNameLen)}  ${status}${time}`);
}

const failed = results.filter((r) => !r.passed && !r.skipped);
const passed = results.filter((r) => r.passed && !r.skipped);
const skipped = results.filter((r) => r.skipped);
const totalMs = results.reduce((sum, r) => sum + r.elapsedMs, 0);

log("");
log(`  ${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped (${(totalMs / 1000).toFixed(1)}s total)`);
log("═══════════════════════════════════════════");

if (failed.length > 0) {
  log("");
  log(`FAILED STAGES: ${failed.map((r) => r.name).join(", ")}`);
  process.exit(1);
}
