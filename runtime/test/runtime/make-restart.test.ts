import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MAKEFILE_PATH = resolve(import.meta.dir, "../../..", "Makefile");

test("make restart is a no-op safety guard that points to exit_process", () => {
  const makefile = readFileSync(MAKEFILE_PATH, "utf8");

  expect(makefile).toContain('restart: ## No-op safety guard');
  expect(makefile).toContain('[restart] No-op by design.');
  expect(makefile).toContain('call exit_process as the last action');
  expect(makefile).not.toContain('systemctl --user restart piclaw.service;');
  expect(makefile).not.toContain('supervisorctl restart piclaw');
});
