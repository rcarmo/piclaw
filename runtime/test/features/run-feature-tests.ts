#!/usr/bin/env bun
/**
 * test/features/run-feature-tests.ts
 *
 * Subprocess wrapper that runs feature regression tests in complete
 * isolation from the live piclaw instance and from other test files.
 *
 * This prevents any module-level constant poisoning from the live
 * process or from prior test files that mutate process.env.
 */

const cleanEnv: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (k === "PICLAW_WORKSPACE" || k === "PICLAW_STORE" || k === "PICLAW_DATA") continue;
  if (typeof v === "string") cleanEnv[k] = v;
}
cleanEnv.PICLAW_DB_IN_MEMORY = "1";
cleanEnv.PICLAW_RUN_FEATURE_TESTS = "1";

const proc = Bun.spawn(
  ["bun", "test", "--max-concurrency=1", "test/features/feature-regression.test.ts"],
  {
    cwd: import.meta.dir.replace(/\/test\/features$/, ""),
    stdout: "inherit",
    stderr: "inherit",
    env: cleanEnv,
  },
);

const exitCode = await proc.exited;
process.exit(exitCode);
