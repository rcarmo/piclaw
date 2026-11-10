import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { assertDurableEngineDependencies, DURABLE_ENGINE_SDK_PACKAGES } from "../../src/runtime/durable-engine-dependencies.js";

test("native startup requires the private exact dependency graph, never an ancestor SDK", () => {
  const root = mkdtempSync(join(process.env.PICLAW_WORKSPACE!, "engine-dependencies-"));
  const directory = join(root, "runtime/durable-engine");
  const name = "@earendil-works/pi-durable";
  const manifest = (folder: string, version: string, packageName = name) => {
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "package.json"), JSON.stringify({ name: packageName, version }));
  };
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "package.json"), JSON.stringify({ dependencies: { [name]: "1.5.2" } }));
    for (const shortName of DURABLE_ENGINE_SDK_PACKAGES) {
      const dependency = `@earendil-works/${shortName}`;
      if (dependency !== name) manifest(join(directory, "node_modules", dependency), "1.5.2", dependency);
    }
    manifest(join(root, "node_modules", name), "1.5.2");
    expect(() => assertDurableEngineDependencies(directory)).toThrow("legacy fallback is disabled");
    manifest(join(directory, "node_modules", name), "1.3.0");
    expect(() => assertDurableEngineDependencies(directory)).toThrow("incompatible");
    manifest(join(directory, "node_modules", name), "1.5.2", "wrong-package");
    expect(() => assertDurableEngineDependencies(directory)).toThrow("incompatible");
    manifest(join(directory, "node_modules", name), "1.5.2");
    expect(() => assertDurableEngineDependencies(directory)).not.toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
