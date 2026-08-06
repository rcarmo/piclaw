import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { createRepoDevCommandPlan } from "../../scripts/repo-dev-command.js";

const RUNTIME_DIR = resolve(import.meta.dir, "../..");
const PACKAGE_DIR = resolve(RUNTIME_DIR, "..");

function readScriptTsconfig(): { include?: string[] } {
  return JSON.parse(readFileSync(resolve(RUNTIME_DIR, "tsconfig.scripts.json"), "utf8"));
}

function listTypeScriptFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listTypeScriptFiles(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out.sort();
}

function scriptEntrypoints(): string[] {
  return [
    ...listTypeScriptFiles(resolve(PACKAGE_DIR, "scripts")),
    ...listTypeScriptFiles(resolve(RUNTIME_DIR, "scripts")),
  ].map((file) => relative(PACKAGE_DIR, file).replace(/\\/g, "/"));
}

function runEslintProbe(file: string) {
  const plan = createRepoDevCommandPlan("lint", RUNTIME_DIR);
  return Bun.spawnSync({
    cmd: [plan.binaryPath, "--config", resolve(PACKAGE_DIR, "eslint.config.js"), file],
    cwd: PACKAGE_DIR,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      PATH: process.env.PATH || "",
    },
  });
}

describe("repository script static-analysis coverage", () => {
  test("script typecheck project covers every root and runtime TypeScript script", () => {
    const config = readScriptTsconfig();
    expect(config.include).toEqual(expect.arrayContaining([
      "../scripts/**/*.ts",
      "scripts/**/*.ts",
    ]));

    const scripts = scriptEntrypoints();
    expect(scripts.length).toBeGreaterThanOrEqual(63);
    for (const script of scripts) {
      expect(
        script.startsWith("scripts/") || script.startsWith("runtime/scripts/"),
        `unexpected script path outside configured script roots: ${script}`,
      ).toBe(true);
    }
  });

  test("repo lint plan includes root and runtime TypeScript script globs", () => {
    const plan = createRepoDevCommandPlan("lint", RUNTIME_DIR);
    expect(plan.args).toEqual(expect.arrayContaining([
      "runtime/scripts/**/*.ts",
      "scripts/**/*.ts",
    ]));
  });

  test.each([
    ["root script", "scripts/audit-model-catalog-delta.ts"],
    ["runtime script", "runtime/scripts/controlled-test-runner.ts"],
    ["Actions workflow contract", "scripts/check-actions-workflows.ts"],
  ] as const)("ESLint config does not ignore a representative %s", (_label, file) => {
    const result = runEslintProbe(file);
    const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;
    expect(result.exitCode, output).toBe(0);
    expect(output).not.toContain("File ignored because no matching configuration was supplied");
  }, 20_000);

  test("script coverage guard runs from the repository package", () => {
    expect(existsSync(resolve(PACKAGE_DIR, "package.json"))).toBe(true);
    expect(existsSync(resolve(PACKAGE_DIR, "runtime", "tsconfig.scripts.json"))).toBe(true);
  });
});
