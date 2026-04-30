import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const RUNTIME_DIR = join(import.meta.dir, "../..");

describe("cold session benchmark script", () => {
  test("runs one isolated sample and emits JSON summary", () => {
    const result = spawnSync(process.execPath, ["scripts/benchmark-cold-session.ts", "--runs", "1", "--json"], {
      cwd: RUNTIME_DIR,
      env: {
        ...process.env,
        PICLAW_DB_IN_MEMORY: "1",
        PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX: "1",
        PICLAW_DISABLE_STARTUP_SESSION_WARMUP: "1",
      },
      encoding: "utf8",
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);
    const summary = JSON.parse(result.stdout) as {
      runs: number;
      durationMs: { median: number };
      rssDeltaBytes: { median: number };
      samples: Array<{ ok: boolean; durationMs: number; rssDeltaBytes: number }>;
    };

    expect(summary.runs).toBe(1);
    expect(summary.samples).toHaveLength(1);
    expect(summary.samples[0].ok).toBe(true);
    expect(summary.durationMs.median).toBeGreaterThan(0);
    expect(summary.rssDeltaBytes.median).toBeGreaterThan(0);
  });
});
