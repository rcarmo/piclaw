#!/usr/bin/env bun

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import { findProjectPackageDir } from "./vendor-workflow.js";

const LOG_PREFIX = "[repo-dev]";

export interface RepoDevCommandPlan {
  packageDir: string;
  runtimeDir: string;
  cwd: string;
  binaryPath: string;
  args: string[];
  requiredBinaries: string[];
  preRun?: () => void;
  postRun?: () => void;
}

export function resolveRepoBinary(packageDir: string, binaryName: string): string {
  switch (binaryName) {
    case "eslint":
      return resolve(packageDir, "node_modules/eslint/bin/eslint.js");
    case "tsc":
      return resolve(packageDir, "node_modules/typescript/bin/tsc");
    default:
      return resolve(packageDir, "node_modules/.bin", binaryName);
  }
}

export function createRepoDevCommandPlan(commandName: string, projectDir = process.cwd()): RepoDevCommandPlan {
  const packageDir = findProjectPackageDir(projectDir);
  if (!packageDir) {
    throw new Error(`Could not find package.json near ${projectDir}`);
  }

  const runtimeDir = resolve(packageDir, "runtime");
  const eslintConfigPath = resolve(runtimeDir, "eslint.config.js");

  switch (commandName) {
    case "build":
      return {
        packageDir,
        runtimeDir,
        cwd: runtimeDir,
        binaryPath: resolveRepoBinary(packageDir, "tsc"),
        args: ["-p", "tsconfig.json"],
        requiredBinaries: ["tsc"],
        preRun: () => {
          rmSync(resolve(runtimeDir, "generated/dist"), { recursive: true, force: true });
        },
        postRun: () => {
          rmSync(resolve(runtimeDir, "generated/dist"), { recursive: true, force: true });
        },
      };
    case "typecheck":
      return {
        packageDir,
        runtimeDir,
        cwd: runtimeDir,
        binaryPath: resolveRepoBinary(packageDir, "tsc"),
        args: ["--noEmit", "-p", "tsconfig.json"],
        requiredBinaries: ["tsc"],
      };
    case "lint":
      return {
        packageDir,
        runtimeDir,
        cwd: runtimeDir,
        binaryPath: resolveRepoBinary(packageDir, "eslint"),
        args: ["--config", eslintConfigPath, "src/**/*.ts", "test/**/*.ts"],
        requiredBinaries: ["eslint"],
      };
    default:
      throw new Error(`Unsupported repo dev command: ${commandName}`);
  }
}

export function listMissingRepoBinaries(plan: RepoDevCommandPlan): string[] {
  return plan.requiredBinaries.filter((binaryName) => !existsSync(resolveRepoBinary(plan.packageDir, binaryName)));
}

export function installRepoDependencies(packageDir: string, env: Record<string, string | undefined> = process.env): number {
  const installEnv = { ...env };
  const cacheDir = installEnv.BUN_INSTALL_CACHE_DIR || "/workspace/.cache/bun";
  const tempDir = installEnv.TMPDIR || "/workspace/.tmp/bun-install";
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(tempDir, { recursive: true });
  installEnv.BUN_INSTALL_CACHE_DIR = cacheDir;
  installEnv.TMPDIR = tempDir;
  installEnv.TEMP = installEnv.TEMP || tempDir;
  installEnv.TMP = installEnv.TMP || tempDir;

  const proc = Bun.spawnSync([process.execPath, "install", "--frozen-lockfile"], {
    cwd: packageDir,
    stdout: "inherit",
    stderr: "inherit",
    env: installEnv,
  });
  return proc.exitCode || 0;
}

export function ensureRepoDevTooling(plan: RepoDevCommandPlan, env: Record<string, string | undefined> = process.env): void {
  const missing = listMissingRepoBinaries(plan);
  if (missing.length === 0) return;

  console.error(`${LOG_PREFIX} Missing repo binaries: ${missing.join(", ")}`);
  console.error(`${LOG_PREFIX} Attempting repo-local bun install --frozen-lockfile for this worktree...`);

  const exitCode = installRepoDependencies(plan.packageDir, env);
  if (exitCode !== 0) {
    throw new Error(`Automatic dependency install failed with exit ${exitCode}`);
  }

  const stillMissing = listMissingRepoBinaries(plan);
  if (stillMissing.length > 0) {
    throw new Error(`Repo binaries still missing after bun install: ${stillMissing.join(", ")}`);
  }
}

export function runRepoDevCommand(
  commandName: string,
  options: {
    projectDir?: string;
    env?: Record<string, string | undefined>;
  } = {},
): number {
  const plan = createRepoDevCommandPlan(commandName, options.projectDir || process.cwd());
  const env = options.env ?? process.env;
  ensureRepoDevTooling(plan, env);
  plan.preRun?.();

  try {
    const proc = Bun.spawnSync([plan.binaryPath, ...plan.args], {
      cwd: plan.cwd,
      stdout: "inherit",
      stderr: "inherit",
      env,
    });
    return proc.exitCode || 0;
  } finally {
    plan.postRun?.();
  }
}

export function runRepoDevCommandCli(argv = process.argv.slice(2)): never {
  try {
    const commandName = argv[0];
    if (!commandName) {
      throw new Error("Usage: bun run runtime/scripts/repo-dev-command.ts <build|typecheck|lint>");
    }
    process.exit(runRepoDevCommand(commandName));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}

if (import.meta.main) {
  runRepoDevCommandCli();
}
