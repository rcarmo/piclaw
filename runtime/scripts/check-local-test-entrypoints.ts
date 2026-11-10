#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = resolve(import.meta.dir, "../..");
const ALLOWLIST = new Set([
  "runtime/scripts/local-test-priority.ts", // central launcher implementation
  "runtime/scripts/controlled-test-runner.ts", // nested stages inherit launcher niceness
  "runtime/test/features/run-feature-tests.ts", // nested feature subprocess inherits launcher niceness
  "runtime/test/scripts/local-test-priority.test.ts", // launcher/audit fixtures mention raw runners
  "runtime/test/scripts/controlled-test-runner.test.ts", // controlled-runner fixture
  "tests/e2e/scripts/run-microvm-suite.ts", // nested Playwright runner launched by niced package entrypoints
]);
const EXCLUDED_PREFIXES = [
  "runtime/web/static/", // generated browser output
  "runtime/extensions/viewers/editor/vendor/", // checked-in third-party source
  "runtime/test/fixtures/", // test fixture inputs
  "runtime/test/snapshots/", // generated test expectations
  "skel/", // templates, not repository test entrypoints
];
const SOURCE_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs", ".sh", ".json"]);
const RAW_PATTERNS = [
  /\bbun\s+test\b/,
  /\b(?:bunx\s+)?playwright\s+test\b/,
  /["'](?:bun|playwright)["']\s*,\s*["']test["']/,
  /process\.execPath\s*,\s*["']test["']/,
];

function repositoryFiles(root: string, files?: readonly string[]): string[] {
  if (files) return [...files].map(normalizePath).sort();
  const result = spawnSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr.trim()}`);
  const removed = spawnSync("git", ["ls-files", "--deleted", "-z"], { cwd: root, encoding: "utf8" });
  if (removed.status !== 0) throw new Error(`git ls-files --deleted failed: ${removed.stderr.trim()}`);
  // Audit current tracked/untracked source, excluding only Git-proven working
  // tree deletions. Missing explicit inputs and other read failures still throw.
  const deleted = new Set(removed.stdout.split("\0").filter(Boolean).map(normalizePath));
  return result.stdout.split("\0").filter(Boolean).map(normalizePath).filter(path => !deleted.has(path)).sort();
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function isAuditedSource(path: string): boolean {
  if (EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix))) return false;
  if (/\.(?:test|spec)\.[cm]?[jt]s$/.test(path) && path !== "runtime/test/scripts/local-test-priority.test.ts") return false;
  const basename = path.slice(path.lastIndexOf("/") + 1);
  return basename === "Makefile" || basename === "package.json" || SOURCE_EXTENSIONS.has(extname(path));
}

export async function auditLocalTestEntrypoints(
  root = ROOT,
  files?: readonly string[],
): Promise<readonly string[]> {
  const violations: string[] = [];
  for (const path of repositoryFiles(root, files)) {
    if (!isAuditedSource(path) || ALLOWLIST.has(path)) continue;
    const source = readFileSync(join(root, path), "utf8");
    // Negative-only prefilter: every per-line match also exists in the full text.
    // Keep the same files, patterns, comment rules and findings below.
    if (!RAW_PATTERNS.some((pattern) => pattern.test(source))) continue;
    const lines = source.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^\s*(?:#|\/\/|\*)/.test(line)) continue;
      const previousLine = lines[index - 1] ?? "";
      if (
        line.includes("local-test-priority") || line.includes("test:local") ||
        previousLine.includes("local-test-priority") || previousLine.includes("test:local")
      ) continue;
      if (RAW_PATTERNS.some((pattern) => pattern.test(line))) {
        violations.push(`${path}:${index + 1}:${line.trim()}`);
      }
    }
  }
  return violations;
}

if (import.meta.main) {
  // Bun resolves config from cwd, not ancestor package roots.
  await import('./check-test-preloads.js');
  const violations = await auditLocalTestEntrypoints();
  if (violations.length > 0) {
    process.stderr.write(`[local-test-entrypoints] raw local test invocation(s):\n${violations.join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write("[local-test-entrypoints] ok\n");
}
