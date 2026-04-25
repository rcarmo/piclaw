import { expect, test } from "bun:test";

import {
  createRepoDevCommandPlan,
  listMissingRepoBinaries,
  resolveRepoBinary,
} from "../../scripts/repo-dev-command.js";

test("createRepoDevCommandPlan resolves repo-root binaries for build, lint, and typecheck", () => {
  const buildPlan = createRepoDevCommandPlan("build", "/workspace/piclaw/runtime");
  const lintPlan = createRepoDevCommandPlan("lint", "/workspace/piclaw/runtime");
  const typecheckPlan = createRepoDevCommandPlan("typecheck", "/workspace/piclaw/runtime");

  expect(buildPlan.cwd).toBe("/workspace/piclaw/runtime");
  expect(buildPlan.binaryPath).toBe("/workspace/piclaw/node_modules/typescript/bin/tsc");
  expect(buildPlan.args).toEqual(["-p", "tsconfig.json"]);
  expect(typeof buildPlan.preRun).toBe("function");
  expect(typeof buildPlan.postRun).toBe("function");

  expect(lintPlan.cwd).toBe("/workspace/piclaw/runtime");
  expect(lintPlan.binaryPath).toBe("/workspace/piclaw/node_modules/eslint/bin/eslint.js");
  expect(lintPlan.args).toEqual([
    "--config",
    "/workspace/piclaw/runtime/eslint.config.js",
    "src/**/*.ts",
    "test/**/*.ts",
  ]);

  expect(typecheckPlan.cwd).toBe("/workspace/piclaw/runtime");
  expect(typecheckPlan.binaryPath).toBe("/workspace/piclaw/node_modules/typescript/bin/tsc");
  expect(typecheckPlan.args).toEqual(["--noEmit", "-p", "tsconfig.json"]);
});

test("resolveRepoBinary points at the repo-local node_modules bin directory", () => {
  expect(resolveRepoBinary("/workspace/piclaw", "tsc")).toBe("/workspace/piclaw/node_modules/typescript/bin/tsc");
});

test("listMissingRepoBinaries reports missing tools from the repo-local bin directory", () => {
  const plan = {
    packageDir: "/tmp/piclaw-missing-bins",
    runtimeDir: "/tmp/piclaw-missing-bins/runtime",
    cwd: "/tmp/piclaw-missing-bins/runtime",
    binaryPath: "/tmp/piclaw-missing-bins/node_modules/.bin/eslint",
    args: [],
    requiredBinaries: ["eslint", "tsc"],
  };

  expect(listMissingRepoBinaries(plan)).toEqual(["eslint", "tsc"]);
});
