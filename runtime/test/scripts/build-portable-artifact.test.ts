import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { assertBundledPiCli, buildWindowsInstallScript, writeLaunchers } from "../../../scripts/release/build-portable-artifact.ts";

describe("portable artifact Windows installer", () => {
  test("emits a PowerShell 5-compatible param block before executable statements", () => {
    const script = buildWindowsInstallScript("piclaw-2.3.4-windows-x64");
    const firstNonEmptyLine = script.split(/\r?\n/).find((line) => line.trim().length > 0);

    expect(firstNonEmptyLine).toBe("param(");
    expect(script.indexOf("$ErrorActionPreference = 'Stop'")).toBeGreaterThan(script.indexOf(")\r\n"));
  });

  test("writes cmd shims for piclaw and pi with interpreted CRLF escapes instead of literal backtick text", () => {
    const script = buildWindowsInstallScript("piclaw-2.3.4-windows-x64");

    expect(script).toContain("$PiclawLauncher = Join-Path $Current 'bin\\piclaw.cmd'");
    expect(script).toContain("$PiLauncher = Join-Path $Current 'bin\\pi.cmd'");
    expect(script).toContain('$PiclawShim = "@echo off`r`n`"$PiclawLauncher`" %*`r`n"');
    expect(script).toContain('$PiShim = "@echo off`r`n`"$PiLauncher`" %*`r`n"');
    expect(script).toContain("$PiclawShim | Set-Content -Encoding ASCII (Join-Path $BinDir 'piclaw.cmd')");
    expect(script).toContain("$PiShim | Set-Content -Encoding ASCII (Join-Path $BinDir 'pi.cmd')");
    expect(script).not.toContain("'@echo off`r`n");
  });
});

describe("portable artifact Pi CLI bundling", () => {
  test("POSIX launcher uses bundled Bun and the declared CLI without rewriting SDK files", async () => {
    const root = mkdtempSync(join(tmpdir(), "portable pi with spaces-"));
    try {
      const app = join(root, "app");
      const pkg = join(app, "node_modules/@earendil-works/pi-coding-agent");
      const cli = join(pkg, "dist/bundle/cli.js");
      mkdirSync(join(pkg, "dist/bundle"), { recursive: true });
      mkdirSync(join(app, "runtime/scripts"), { recursive: true });
      mkdirSync(join(root, "bun/bin"), { recursive: true });
      writeFileSync(join(app, "package.json"), JSON.stringify({ type: "module" }));
      writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", type: "module", bin: { pi: "dist/bundle/cli.js" } }));
      const source = '#!/usr/bin/env node\nconsole.log(JSON.stringify({ bun: process.versions.bun, args: process.argv.slice(2) })); process.exitCode = 17;\n';
      writeFileSync(cli, source);
      writeFileSync(join(pkg, "dist/cli.js"), "throw Error('obsolete CLI must not run');\n");
      copyFileSync(resolve(import.meta.dir, "../../scripts/pi-cli.ts"), join(app, "runtime/scripts/pi-cli.ts"));
      symlinkSync(process.execPath, join(root, "bun/bin/bun"));
      writeFileSync(join(root, "bun/bin/node"), "#!/bin/sh\nexit 91\n", { mode: 0o755 });
      expect(assertBundledPiCli(app)).toBe(cli);
      writeLaunchers(root, "linux", "piclaw-test");
      const child = Bun.spawn([join(root, "bin/pi"), "argument with spaces", "--literal=λ"], { cwd: root, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(exit, stderr).toBe(17);
      expect(JSON.parse(stdout)).toEqual({ bun: process.versions.bun, args: ["argument with spaces", "--literal=λ"] });
      expect(readFileSync(cli, "utf8")).toBe(source);
      rmSync(cli);
      expect(() => assertBundledPiCli(app)).toThrow("declared Pi CLI entrypoint");
      rmSync(join(app, "runtime/scripts/pi-cli.ts"));
      expect(() => assertBundledPiCli(app)).toThrow("Bun Pi launcher");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("Windows cmd and PowerShell launchers use the same Bun wrapper and preserve argument forwarding", () => {
    const root = mkdtempSync(join(tmpdir(), "portable-pi-windows-"));
    try {
      writeLaunchers(root, "windows", "piclaw-test");
      const cmd = readFileSync(join(root, "bin/pi.cmd"), "utf8");
      const ps = readFileSync(join(root, "bin/pi.ps1"), "utf8");
      expect(cmd).toContain('"%ROOT%\\bun\\bun.exe" "%ROOT%\\app\\runtime\\scripts\\pi-cli.ts" %*');
      expect(ps).toContain("& (Join-Path $Root 'bun/bun.exe') (Join-Path $Root 'app/runtime/scripts/pi-cli.ts') @args");
      expect(ps).toContain("exit $LASTEXITCODE");
      expect(cmd + ps).not.toContain("pi-coding-agent");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
