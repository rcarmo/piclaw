import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DURABLE_ENGINE_SDK_PACKAGES } from "../../src/runtime/durable-engine-dependencies.js";

const root = resolve(import.meta.dir, "../../..");
const text = (path: string) => readFileSync(resolve(root, path), "utf8");

test("packages carry the native source, frozen island and installer without promoting the host SDK", () => {
  const pkg = JSON.parse(text("package.json"));
  for (const path of ["scripts/install-durable-engine.ts", "runtime/durable-engine/src", "runtime/durable-engine/package.json", "runtime/durable-engine/bun.lock"])
    expect(pkg.files).toContain(path);
  const { sdkVersion } = JSON.parse(text("scripts/native-gate-contract.json"));
  expect(pkg.dependencies["@earendil-works/pi-coding-agent"]).toBe(sdkVersion);
  expect(pkg.dependencies["@earendil-works/pi-mcp"]).toBe(sdkVersion);
  expect(pkg.dependencies["@earendil-works/pi-durable"]).toBeUndefined();
  const engine = JSON.parse(text("runtime/durable-engine/package.json"));
  expect(Object.keys(engine.dependencies).filter(name => name.startsWith("@earendil-works/")).sort()).toEqual(DURABLE_ENGINE_SDK_PACKAGES.map(name => `@earendil-works/${name}`).sort());
  for (const name of DURABLE_ENGINE_SDK_PACKAGES) expect(engine.dependencies[`@earendil-works/${name}`]).toBe(sdkVersion);
});

test("normal, scripts-disabled Docker and portable installs run the native installer", () => {
  const installer = text("scripts/install-durable-engine.ts");
  expect(installer).toContain('"--production", "--frozen-lockfile", "--ignore-scripts"');
  expect(installer).toContain("assertDurableEngineDependencies(directory)");
  expect(text("scripts/postinstall.ts")).toContain("installDurableEngineDependencies(ROOT)");
  expect(text("scripts/docker/build-piclaw-package.sh")).toContain('"$DEST_REAL/scripts/postinstall.ts"');
  expect(text("scripts/release/build-portable-artifact.ts")).toContain('["run", "scripts/postinstall.ts"], { cwd: appDir, env: installEnv }');
  const bootstrap = text("runtime/src/runtime/bootstrap.ts");
  expect(bootstrap.indexOf("assertDurableEngineDependencies();")).toBeLessThan(bootstrap.indexOf("await import(MODULE_PATH)"));
});
