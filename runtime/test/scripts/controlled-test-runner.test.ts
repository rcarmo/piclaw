import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const RUNNER = join(REPO_ROOT, "runtime/scripts/controlled-test-runner.ts");

function createTinyControlledTestPackage(): string {
  const root = join(tmpdir(), `piclaw-controlled-runner-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const testDir = join(root, "runtime/test");
  mkdirSync(testDir, { recursive: true });
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "piclaw-controlled-runner-fixture", private: true }, null, 2)}\n`, "utf8");
  writeFileSync(join(root, "runtime/tsconfig.json"), `${JSON.stringify({ compilerOptions: { target: "ES2022" } }, null, 2)}\n`, "utf8");
  writeFileSync(join(testDir, "sample.test.ts"), [
    "import { expect, test } from 'bun:test';",
    "test('sample controlled runner fixture', () => { expect(1 + 1).toBe(2); });",
    "",
  ].join("\n"), "utf8");
  return root;
}

function runControlled(root: string, args: string[], files = ['test/sample.test.ts']) {
  return Bun.spawnSync({
    cmd: [process.execPath, RUNNER, "--stage-size=1", "--sample-ms=50", ...args, "--", ...files],
    cwd: root,
    env: {
      PATH: process.env.PATH || "",
      HOME: process.env.HOME || "/tmp",
      TMPDIR: process.env.TMPDIR || tmpdir(),
      TMP: process.env.TMP || tmpdir(),
      TEMP: process.env.TEMP || tmpdir(),
      USER: process.env.USER || "agent",
      PICLAW_DB_IN_MEMORY: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("controlled-test-runner report policy", () => {
  test("early exit zero cannot qualify a stage or run the next one", () => {
    const root = createTinyControlledTestPackage();
    try {
      writeFileSync(join(root, 'runtime/test/later.test.ts'), readFileSync(join(root, 'runtime/test/sample.test.ts')));
      writeFileSync(join(root, 'runtime/test/sample.test.ts'), 'process.exit(0);\n');
      const reportPath = join(root, 'incomplete.json');
      const result = runControlled(root, ['--report', reportPath], ['test/sample.test.ts', 'test/later.test.ts']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain('without its own complete JUnit artifact');
      expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toMatchObject({
        total_files: 2, stages_completed: 1, failed_stage_index: 1, exit_code: 1,
      });
    } finally { rmSync(root, { force: true, recursive: true }); }
  });

  test("default run does not write the legacy generated report; explicit --report writes JSON", () => {
    const root = createTinyControlledTestPackage();
    try {
      const legacyReport = join(root, "runtime/generated/controlled-test-report.json");
      const defaultRun = runControlled(root, []);
      expect(defaultRun.exitCode, defaultRun.stderr.toString() || defaultRun.stdout.toString()).toBe(0);
      expect(defaultRun.stdout.toString()).toContain("report=disabled");
      expect(existsSync(legacyReport)).toBe(false);

      const explicitReport = join(root, "artifacts/performance/controlled-test-report.json");
      const explicitRun = runControlled(root, ["--report", explicitReport]);
      expect(explicitRun.exitCode, explicitRun.stderr.toString() || explicitRun.stdout.toString()).toBe(0);
      expect(explicitRun.stdout.toString()).toContain("artifacts/performance/controlled-test-report.json");
      expect(existsSync(explicitReport)).toBe(true);

      const report = JSON.parse(readFileSync(explicitReport, "utf8"));
      expect(report).toMatchObject({
        total_files: 1,
        stages_completed: 1,
        failed_stage_index: null,
        exit_code: 0,
      });
      expect(report.stages).toHaveLength(1);
      expect(report.stages[0]).toMatchObject({
        file_count: 1,
        files: ["test/sample.test.ts"],
        exit_code: 0,
      });
      expect(typeof report.max_peak_process_tree_rss_kb).toBe("number");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
