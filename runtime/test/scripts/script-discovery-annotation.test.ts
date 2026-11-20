import { expect, test } from "bun:test";
import "../helpers.js";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = join(import.meta.dir, "../../..");
const SKILL_SCRIPT = join(root, "runtime/skills/builtin/script-discovery-annotation/annotate-script-jdoc.ts");

test("script-discovery-annotation annotates entrypoints and passes --check", () => {
  const base = mkdtempSync(join(tmpdir(), "piclaw-script-jdoc-"));
  try {
    const target = join(base, "token-chart.ts");
    writeFileSync(target, '#!/usr/bin/env bun\nconsole.log("ok");\n');

    const annotate = Bun.spawnSync([process.execPath, SKILL_SCRIPT, "--path", target, "--write"], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(annotate.exitCode).toBe(0);

    const content = readFileSync(target, "utf8");
    expect(content).toContain("SCRIPT_JDOC:");
    expect(content).toContain('"role": "entrypoint"');

    const check = Bun.spawnSync([process.execPath, SKILL_SCRIPT, "--path", target, "--check"], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(check.exitCode).toBe(0);
    expect(check.stdout.toString()).toContain("SCRIPT_JDOC check passed");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("script-discovery-annotation supports module role override", () => {
  const base = mkdtempSync(join(tmpdir(), "piclaw-script-jdoc-module-"));
  try {
    const target = join(base, "helpers.ts");
    writeFileSync(target, 'export function helper() { return 1; }\n');

    const annotate = Bun.spawnSync([process.execPath, SKILL_SCRIPT, "--path", target, "--write", "--role", "module"], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(annotate.exitCode).toBe(0);

    const content = readFileSync(target, "utf8");
    expect(content).toContain("SCRIPT_JDOC:");
    expect(content).toContain('"role": "module"');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
