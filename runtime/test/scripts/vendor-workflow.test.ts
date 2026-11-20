import { expect, test } from "bun:test";
import { join } from "node:path";

import { findProjectPackageDir } from "../../scripts/vendor-workflow.js";

const root = join(import.meta.dir, "../../..");

test("findProjectPackageDir resolves the repo root from runtime scripts", () => {
  expect(findProjectPackageDir(join(root, "runtime"))).toBe(root);
});

test("findProjectPackageDir returns the package dir when already at repo root", () => {
  expect(findProjectPackageDir(root)).toBe(root);
});
