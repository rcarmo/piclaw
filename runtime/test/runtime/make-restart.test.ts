import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const PACKAGE_DIR = resolve(import.meta.dir, "../../..");
const MAKEFILE_PATH = resolve(PACKAGE_DIR, "Makefile");

test("make local-install ignores a portable runtime BUN_INSTALL and rejects portable release roots", () => {
  const makefile = readFileSync(MAKEFILE_PATH, "utf8");

  expect(makefile).toContain("HOST_BUN_ROOT := $(if $(wildcard /usr/local/lib/bun/bin/bun),/usr/local/lib/bun");
  expect(makefile).toContain("BUN_ROOT ?= $(HOST_BUN_ROOT)");
  expect(makefile).not.toContain("BUN_ROOT ?= $(or $(BUN_INSTALL)");
  expect(makefile).toContain("Refusing portable release Bun root");
  expect(makefile).toContain("/opt/piclaw/current/*|/opt/piclaw/releases/*");

  const make = Bun.spawnSync({
    cmd: ["make", "-s", "--eval", "print-bun-root:;@echo $(BUN_ROOT)", "print-bun-root"],
    cwd: PACKAGE_DIR,
    env: {
      ...process.env,
      BUN_INSTALL: "/opt/piclaw/current/bun",
      PATH: `/opt/piclaw/current/bun/bin:${process.env.PATH ?? ""}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(make.exitCode, make.stderr.toString()).toBe(0);
  const expectedHostRoot = existsSync("/usr/local/lib/bun/bin/bun")
    ? "/usr/local/lib/bun"
    : dirname(dirname(process.execPath));
  expect(make.stdout.toString().trim()).toBe(expectedHostRoot);
  expect(make.stdout.toString().trim()).not.toStartWith("/opt/piclaw/");
});

test("make restart is a no-op safety guard that points to exit_process", () => {
  const makefile = readFileSync(MAKEFILE_PATH, "utf8");

  expect(makefile).toContain('restart: ## No-op safety guard');
  expect(makefile).toContain('[restart] No-op by design.');
  expect(makefile).toContain('call exit_process as the last action');
  expect(makefile).not.toContain('systemctl --user restart piclaw.service;');
  expect(makefile).not.toContain('supervisorctl restart piclaw');
});
