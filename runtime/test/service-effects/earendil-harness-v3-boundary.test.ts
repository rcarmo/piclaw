import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { collectModuleSpecifiers } from "./fixtures/typescript-syntax-oracle.js";
import { readRepositorySourceTree } from "./fixtures/repository-tool-family-oracle.js";

const root = resolve(import.meta.dir, "../../..");
const latent = "src/service-effects/earendil-harness-v3-compatibility/";

describe("1.0.1 runtime / retired Harness boundary", () => {
  test("private native engine has no retired compatibility or Harness/Pico3 import", () => {
    // The current source tree includes untracked additions and excludes actual
    // deletions; the Git index may still contain removed compatibility owners.
    const source=resolve(root,'runtime/durable-engine/src');
    const files=[...new Bun.Glob('**/*.ts').scanSync({cwd:source,dot:true,onlyFiles:true})]
      .filter(path=>!path.endsWith('.d.ts')).map(path=>resolve(source,path));
    expect(files.length).toBeGreaterThan(0);
    const incoming: string[] = [];
    for (const path of files) {
      for (const specifier of collectModuleSpecifiers(path, readFileSync(resolve(root, path), "utf8"))) {
        if (/earendil-harness-v3-compatibility|pi-agent-core\/(?:harness(?:\/|$)|experimental\/pico3)/.test(specifier)) incoming.push(`${path}: ${specifier}`);
      }
    }
    expect(incoming).toEqual([]); // Public pi-durable and current native contracts remain allowed here.
  });
  test("retired implementation files stay absent from production", () => {
    for (const path of ["runtime/src/service-effects/current-piclaw/local-execution-env.ts", `${"runtime/"}${latent}direct-assignments.ts`, `${"runtime/"}${latent}preparation-contract.ts`, `${"runtime/"}${latent}manifest.ts`]) {
      expect(Bun.file(resolve(root, path)).size).toBe(0);
    }
  });

  test("production cannot import retired contracts, old SDK subpaths or experimental durable", () => {
    const tree = readRepositorySourceTree();
    expect(Object.keys(tree.files).filter(path => path.startsWith(latent))).toEqual([]);
    const incoming: string[] = [];
    for (const [path, source] of Object.entries(tree.files)) {
      if (!path.endsWith(".ts")) continue;
      for (const specifier of collectModuleSpecifiers(path, source)) {
        if (/historical\/|earendil-harness-v3-compatibility|pi-durable|pi-agent-core\/(?:node|harness|experimental)/.test(specifier)) incoming.push(`${path}: ${specifier}`);
      }
    }
    expect(incoming).toEqual([]);
    const dependencies = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    expect(JSON.stringify(dependencies.dependencies)).not.toContain("pi-durable");
    expect(JSON.stringify(dependencies.dependencies)).not.toContain("0.99.1");
    expect(readFileSync(resolve(root, "runtime/src/agent-pool/session.ts"), "utf8")).not.toMatch(/AgentHarness|Pico3/);
  });
});
