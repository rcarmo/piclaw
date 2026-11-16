import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

const srcRoot = join(import.meta.dir, "../../src");

test("startup owns add-on runtime registration; native session composition cannot reinstall it", () => {
  expect(existsSync(join(srcRoot, "agent-pool", "session.ts"))).toBe(false);
  for (const path of [join(srcRoot, "agent-pool.ts"), join(srcRoot, "..", "durable-engine", "src", "default-application-runtime.ts")]) {
    const source = readFileSync(path, "utf8");
    expect(source).not.toContain("installAddonRuntimeApi");
    expect(source).not.toContain("../addons/runtime-contributions.js");
  }
  const startupSource = readFileSync(join(srcRoot, "runtime", "startup.ts"), "utf8");
  expect(startupSource).toContain("installAddonRuntimeApi");
});
