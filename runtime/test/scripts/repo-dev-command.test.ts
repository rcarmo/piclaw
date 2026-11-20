import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildRepoDevSpawnCommand,
  createRepoDevCommandPlan,
  ensureEsbuildExecutable,
  ensureTypeScriptCompilerExecutable,
  listMissingRepoBinaries,
  resolveRepoBinary,
} from "../../scripts/repo-dev-command.js";

const root = join(import.meta.dir, "../../..");
const runtime = join(root, "runtime");
const tsc = join(root, "node_modules/typescript/bin/tsc");
const oxlint = join(root, "node_modules/.bin/oxlint");

test("createRepoDevCommandPlan resolves repo-root binaries for build, lint, and typecheck", () => {
  const buildPlan = createRepoDevCommandPlan("build", runtime);
  const lintPlan = createRepoDevCommandPlan("lint", runtime);
  const typecheckPlan = createRepoDevCommandPlan("typecheck", runtime);
  const scriptTypecheckPlan = createRepoDevCommandPlan("typecheck:scripts", runtime);
  const webSettingsTypecheckPlan = createRepoDevCommandPlan("typecheck:web-settings", runtime);
  const webPanesTypecheckPlan = createRepoDevCommandPlan("typecheck:web-panes", runtime);

  expect(buildPlan.cwd).toBe(runtime);
  expect(buildPlan.binaryPath).toBe(tsc);
  expect(buildPlan.args).toEqual(["-p", "tsconfig.json"]);
  expect(typeof buildPlan.preRun).toBe("function");
  expect(typeof buildPlan.postRun).toBe("function");

  expect(lintPlan.cwd).toBe(root);
  expect(lintPlan.binaryPath).toBe(oxlint);
  expect(lintPlan.args).toEqual([
    "--config",
    join(root, ".oxlintrc.json"),
    "--deny-warnings",
    "runtime/src",
    "runtime/test",
    "runtime/scripts",
    "scripts",
  ]);
  expect(buildRepoDevSpawnCommand(lintPlan)).toEqual([
    process.execPath,
    oxlint,
    ...lintPlan.args,
  ]);

  expect(typecheckPlan.cwd).toBe(runtime);
  expect(typecheckPlan.binaryPath).toBe(tsc);
  expect(typecheckPlan.args).toEqual(["--noEmit", "-p", "tsconfig.json"]);
  expect(buildRepoDevSpawnCommand(typecheckPlan)).toEqual([
    process.execPath,
    tsc,
    ...typecheckPlan.args,
  ]);

  expect(scriptTypecheckPlan.cwd).toBe(runtime);
  expect(scriptTypecheckPlan.binaryPath).toBe(tsc);
  expect(scriptTypecheckPlan.args).toEqual(["--noEmit", "-p", "tsconfig.scripts.json"]);

  expect(webSettingsTypecheckPlan.cwd).toBe(runtime);
  expect(webSettingsTypecheckPlan.binaryPath).toBe(tsc);
  expect(webSettingsTypecheckPlan.args).toEqual(["--noEmit", "-p", "tsconfig.web-settings.json"]);

  expect(webPanesTypecheckPlan.cwd).toBe(runtime);
  expect(webPanesTypecheckPlan.binaryPath).toBe(tsc);
  expect(webPanesTypecheckPlan.args).toEqual(["--noEmit", "-p", "tsconfig.web-panes.json"]);
});

test("resolveRepoBinary points at the repo-local node_modules bin directory", () => {
  expect(resolveRepoBinary(root, "tsc")).toBe(tsc);
});

test("repo native-tool repairs restore only extracted TypeScript and esbuild executables", () => {
  const root = mkdtempSync(join(tmpdir(), "piclaw-native-tool-mode-"));
  const compiler = join(root, "node_modules/@typescript/typescript-linux-x64/lib/tsc");
  const esbuild = join(root, "node_modules/@esbuild/linux-x64/bin/esbuild");
  mkdirSync(join(root, "node_modules/@typescript/typescript-linux-x64/lib"), { recursive: true });
  mkdirSync(join(root, "node_modules/@esbuild/linux-x64/bin"), { recursive: true });
  writeFileSync(compiler, "native-tsc", { mode: 0o600 });
  writeFileSync(esbuild, "native-esbuild", { mode: 0o600 });
  chmodSync(compiler, 0o600);
  chmodSync(esbuild, 0o600);
  try {
    const expected = process.platform === "win32" ? 0 : 1;
    expect(ensureTypeScriptCompilerExecutable(root)).toBe(expected);
    expect(ensureEsbuildExecutable(root)).toBe(expected);
    if (process.platform !== "win32") {
      expect(statSync(compiler).mode & 0o111).not.toBe(0);
      expect(statSync(esbuild).mode & 0o111).not.toBe(0);
    }
    expect(readFileSync(compiler, "utf8")).toBe("native-tsc");
    expect(readFileSync(esbuild, "utf8")).toBe("native-esbuild");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("listMissingRepoBinaries reports missing tools from the repo-local bin directory", () => {
  const plan = {
    packageDir: "/tmp/piclaw-missing-bins",
    runtimeDir: "/tmp/piclaw-missing-bins/runtime",
    cwd: "/tmp/piclaw-missing-bins/runtime",
    binaryPath: "/tmp/piclaw-missing-bins/node_modules/.bin/oxlint",
    args: [],
    requiredBinaries: ["oxlint", "tsc"],
  };

  expect(listMissingRepoBinaries(plan)).toEqual(["oxlint", "tsc"]);
});
