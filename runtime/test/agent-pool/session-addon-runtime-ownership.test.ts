import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

const srcRoot = join(import.meta.dir, "../../src");

test("agent-pool session module does not install the add-on runtime API", () => {
  const sessionSource = readFileSync(join(srcRoot, "agent-pool", "session.ts"), "utf8");
  const startupSource = readFileSync(join(srcRoot, "runtime", "startup.ts"), "utf8");

  expect(sessionSource).not.toContain("installAddonRuntimeApi");
  expect(sessionSource).not.toContain("../addons/runtime-contributions.js");
  expect(startupSource).toContain("installAddonRuntimeApi");
});
