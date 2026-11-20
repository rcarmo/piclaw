import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildSilentSwallowRemediationHint,
  buildSilentSwallowReport,
  findSilentCatchBlocks,
  findSilentPromiseCatches,
  getSilentSwallowMetrics,
} from "../../scripts/silent-swallow-metrics.ts";

async function withTempDir(prefix: string, run: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("silent-swallow-metrics", () => {
  test("ignores comment-only silent swallow strings", async () => {
    await withTempDir("silent-swallow-comments-", async (dir) => {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "sample.ts"), [
        "// catch {} should not count",
        "/* Promise.resolve().catch(() => {}) should not count */",
        'const note = "catch {} in a string should not count";',
        "const tmpl = `Promise.resolve().catch(() => {}) in template text should not count`;",
      ].join("\n"));

      const metrics = getSilentSwallowMetrics({
        repoDirs: [join(dir, "src")],
        runtimeCoreDirs: [join(dir, "src")],
      });

      expect(metrics.repoSilentCatchBlocks).toBe(0);
      expect(metrics.repoSilentPromiseCatches).toBe(0);
    });
  });

  test("ignores vendored node_modules trees", async () => {
    await withTempDir("silent-swallow-node-modules-", async (dir) => {
      mkdirSync(join(dir, "runtime", "extensions", "node_modules", "pkg"), { recursive: true });
      writeFileSync(join(dir, "runtime", "extensions", "node_modules", "pkg", "sample.js"), [
        "try { work(); } catch {}",
        "Promise.resolve().catch(() => {});",
      ].join("\n"));

      const metrics = getSilentSwallowMetrics({
        repoDirs: [join(dir, "runtime", "extensions")],
        runtimeCoreDirs: [join(dir, "runtime", "extensions")],
      });

      expect(metrics.repoSilentCatchBlocks).toBe(0);
      expect(metrics.repoSilentPromiseCatches).toBe(0);
      expect(metrics.repoFilesWithSilentCatches).toBe(0);
      expect(metrics.runtimeCoreSilentCatches).toBe(0);
    });
  });

  test("ignores broken node_modules symlinks without throwing", async () => {
    await withTempDir("silent-swallow-broken-symlink-", async (dir) => {
      mkdirSync(join(dir, "runtime", "extensions"), { recursive: true });
      symlinkSync(join(dir, "missing-node-modules-target"), join(dir, "runtime", "extensions", "node_modules"));

      const metrics = getSilentSwallowMetrics({
        repoDirs: [join(dir, "runtime", "extensions")],
        runtimeCoreDirs: [join(dir, "runtime", "extensions")],
      });

      expect(metrics.repoSilentCatchBlocks).toBe(0);
      expect(metrics.repoSilentPromiseCatches).toBe(0);
      expect(metrics.repoFilesWithSilentCatches).toBe(0);
      expect(metrics.runtimeCoreSilentCatches).toBe(0);
    });
  });

  test("detects empty and comment-only catch blocks plus empty promise catches", async () => {
    await withTempDir("silent-swallow-detect-", async (dir) => {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "sample.ts"), [
        "try { doThing(); } catch {}",
        "Promise.resolve().catch(() => {});",
        "try { doOtherThing(); } catch { /* expected: intentional swallow */ }",
        "const formatted = `value: ${String(tryLater)}`;",
      ].join("\n"));

      const metrics = getSilentSwallowMetrics({
        repoDirs: [join(dir, "src")],
        runtimeCoreDirs: [join(dir, "src")],
      });

      expect(metrics.repoSilentCatchBlocks).toBe(2);
      expect(metrics.repoSilentPromiseCatches).toBe(1);
      expect(metrics.repoFilesWithSilentCatches).toBe(1);
      expect(metrics.runtimeCoreSilentCatches).toBe(2);
    });
  });

  test("detects comment-only promise catches as silent", async () => {
    await withTempDir("silent-swallow-comment-promise-", async (dir) => {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "sample.ts"), "Promise.resolve().catch(() => { /* ignore */ });\n");

      const matches = findSilentPromiseCatches([join(dir, "src", "sample.ts")]);
      expect(matches).toHaveLength(1);
      expect(matches[0]?.line).toBe(1);
    });
  });

  test("does not flag catch blocks that log the error", async () => {
    await withTempDir("silent-swallow-logged-", async (dir) => {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "sample.ts"), [
        "try { risky(); } catch (error) { console.debug(error); }",
        "try { riskyAgain(); } catch (error) { logger?.debug?.({ error }, 'ignored in debug mode'); }",
      ].join("\n"));

      const matches = findSilentCatchBlocks([join(dir, "src", "sample.ts")]);
      expect(matches).toHaveLength(0);
    });
  });

  test("builds remediation guidance with centralized logging severity hints", () => {
    const hint = buildSilentSwallowRemediationHint();
    expect(hint).toContain("debugSuppressedError(log");
    expect(hint).toContain("log.warn");
    expect(hint).toContain("log.error");
    expect(hint).toContain("Do not leave catch blocks empty or comment-only");
  });

  test("builds a failure report that names missing logging call sites", () => {
    const report = buildSilentSwallowReport("Silent catch block sites", [{
      filePath: "runtime/web/src/ui/mobile-viewport.ts",
      line: 48,
      snippet: "} catch {}",
    }]);
    expect(report).toContain("Silent catch block sites (1)");
    expect(report).toContain("runtime/web/src/ui/mobile-viewport.ts:48 — missing logging call");
    expect(report).toContain("snippet: } catch {} ".trim());
  });

  test("fails in --check mode when silent swallows are present", async () => {
    await withTempDir("silent-swallow-check-", async (dir) => {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "sample.ts"), [
        "try { work(); } catch { /* no logging */ }",
        "Promise.resolve().catch(() => {});",
      ].join("\n"));

      const proc = Bun.spawnSync({
        cmd: [process.execPath, "run", "runtime/scripts/silent-swallow-metrics.ts", "--check"],
        cwd: join(import.meta.dir, "../../.."),
        env: {
          ...process.env,
          PICLAW_SILENT_SWALLOW_SCAN_ROOTS: join(dir, "src"),
          PICLAW_SILENT_SWALLOW_RUNTIME_CORE_ROOTS: join(dir, "src"),
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(proc.exitCode).toBe(1);
      const stderr = new TextDecoder().decode(proc.stderr);
      expect(stderr).toContain("Comment-only handlers count as silent");
      expect(stderr).toContain("Silent catch block sites");
      expect(stderr).toContain("missing logging call");
      expect(stderr).toContain("sample.ts:1");
      expect(stderr).toContain("Silent promise catch sites");
      expect(stderr).toContain("sample.ts:2");
      expect(stderr).toContain("debugSuppressedError(log");
      expect(stderr).toContain("log.warn");
      expect(stderr).toContain("log.error");
    });
  });

  test("reports file path, line, and snippet for catch matches", async () => {
    await withTempDir("silent-swallow-match-info-", async (dir) => {
      mkdirSync(join(dir, "src"), { recursive: true });
      const filePath = join(dir, "src", "sample.ts");
      writeFileSync(filePath, [
        "doThing();",
        "try { risky(); } catch { // TODO log",
        "}",
      ].join("\n"));

      const matches = findSilentCatchBlocks([filePath]);
      expect(matches).toHaveLength(1);
      expect(matches[0]).toEqual({
        filePath,
        line: 2,
        snippet: "try { risky(); } catch { // TODO log",
      });
    });
  });
});
