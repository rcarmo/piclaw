import "../helpers.js";

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";

import { describe, expect, test } from "bun:test";
import * as syntax from "@babel/types";

import { collectModuleSpecifiers, parseTypeScriptSource } from "./fixtures/typescript-syntax-oracle.js";
import {
  inventoryLatentToolFamilies,
  readRepositorySourceTree,
  readLatentPreparationSourceTree,
  resolveRepositoryModule,
  snapshotLatentToolContracts,
} from "./fixtures/repository-tool-family-oracle.js";

const runtimeRoot = resolve(import.meta.dir, "../..");
const packageRoot = resolve(runtimeRoot, "..");
const latentRoot = resolve(runtimeRoot, "src/service-effects/tool-preparation");
const latentPrefix = "src/service-effects/tool-preparation/";

function walk(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

function moduleSpecifiers(file: string, source: string): readonly string[] {
  return collectModuleSpecifiers(file, source);
}

function importGraph(files: Readonly<Record<string, string>>): Readonly<Record<string, readonly string[]>> {
  const graph: Record<string, readonly string[]> = Object.create(null);
  for (const [file, source] of Object.entries(files)) {
    graph[file] = Object.freeze(moduleSpecifiers(file, source).flatMap((specifier) => {
      const resolved = resolveRepositoryModule(file, specifier, files);
      return resolved ? [resolved] : [];
    }));
  }
  return Object.freeze(graph);
}

function reachable(graph: Readonly<Record<string, readonly string[]>>, root: string): readonly string[] {
  const seen = new Set<string>();
  const queue = [root];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...(graph[file] ?? []));
  }
  return Object.freeze([...seen].sort());
}

describe("WP-3C static import graph and inert top-level boundary", () => {
  test("has no direct, dynamic, require, re-export, alias or package-export edge into latent preparation", () => {
    const tree = readRepositorySourceTree();
    const violations: string[] = [];
    for (const [file, source] of Object.entries(tree.files)) {
      if (file.startsWith(latentPrefix)) continue;
      for (const specifier of moduleSpecifiers(file, source)) {
        const resolved = resolveRepositoryModule(file, specifier, tree.files);
        if (specifier.includes("service-effects/tool-preparation") || resolved?.startsWith(latentPrefix)) {
          violations.push(`${file} -> ${specifier}`);
        }
      }
    }
    const packageJson = readFileSync(resolve(packageRoot, "package.json"), "utf8");
    expect(violations).toEqual([]);
    expect(packageJson).not.toContain("tool-preparation");
  });

  test("recognizes static ESM, TypeScript, CommonJS, dynamic and package-self import forms", () => {
    const source = `
      import direct from "./direct.js";
      import equal = require("./equal.js");
      export { value } from "./exported.js";
      const dynamic = import("./dynamic.js", { with: { type: "json" } });
      const required = require("./required.js");
      const resolved = require.resolve("./resolved.js");
      const loaded = module.require("./module.js");
      const meta = import.meta.resolve("./meta.js");
      type Imported = import("./typed.js").Imported;
    `;
    expect([...moduleSpecifiers("src/forms.ts", source)].sort()).toEqual([
      "./direct.js", "./dynamic.js", "./equal.js", "./exported.js", "./meta.js", "./module.js", "./required.js", "./resolved.js", "./typed.js",
    ]);
    const files = {
      "package.json": JSON.stringify({ name: "piclaw", exports: { "./runtime/*": "./*" } }),
      "src/index.ts": "", "src/service-effects/tool-preparation/manifest.ts": "",
    };
    expect(resolveRepositoryModule("src/index.ts", "piclaw/runtime/src/service-effects/tool-preparation/manifest.js", files)).toBe(
      "src/service-effects/tool-preparation/manifest.ts",
    );
  });

  test("latent modules are transitively unreachable from the production entrypoint", () => {
    const tree = readRepositorySourceTree();
    const graph = importGraph(tree.files);
    const productionReachable = reachable(graph, "src/index.ts");
    expect(productionReachable.filter((file) => file.startsWith(latentPrefix))).toEqual([]);
  });

  test("test oracles have no production-implementation imports", () => {
    const oraclePaths = [
      "test/service-effects/fixtures/addon-package-tree-oracle.ts",
      "test/service-effects/fixtures/mcp-metadata-oracle.ts",
      "test/service-effects/fixtures/protected-observer.ts",
      "test/service-effects/fixtures/repository-tool-family-oracle.ts",
      "test/service-effects/fixtures/typescript-syntax-oracle.ts",
    ];
    for (const file of oraclePaths) {
      const source = readFileSync(resolve(runtimeRoot, file), "utf8");
      expect(moduleSpecifiers(file, source).filter((specifier) => {
        const allowedFixtureHelper = file.endsWith("repository-tool-family-oracle.ts")
          && specifier === "./typescript-syntax-oracle.js";
        return specifier.includes("pi-mcp-adapter") || specifier.startsWith(".") && !allowedFixtureHelper;
      })).toEqual([]);
    }
  });

  test("has no root/subtree barrel and no top-level activation or I/O form", () => {
    expect(existsSync(resolve(latentRoot, "index.ts"))).toBeFalse();
    const forbiddenText = [
      /\.registerTool\s*\(/,
      /setActiveTools\s*\(/,
      /create(?:Read|Write|Edit|Bash)Tool\s*\(/,
      /set(?:Interval|Timeout)\s*\(/,
      /Bun\.serve\s*\(/,
      /(?:process|Bun)\.env/,
      /from\s+["'][^"']*(?:node:fs|db|keychain|ssh-core|mcp-adapter)[^"']*["']/,
    ];
    const violations: string[] = [];
    for (const path of walk(latentRoot)) {
      const source = readFileSync(path, "utf8");
      const file = relative(runtimeRoot, path).replaceAll("\\", "/");
      const ast = parseTypeScriptSource(file, source);
      for (const statement of ast.statements) {
        if (syntax.isExpressionStatement(statement) || syntax.isForStatement(statement) || syntax.isForOfStatement(statement) || syntax.isWhileStatement(statement)) {
          violations.push(`${file} has top-level ${statement.type}`);
        }
      }
      for (const pattern of forbiddenText) {
        if (pattern.test(source)) violations.push(`${file} matched ${pattern}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("WP-3C retained latent-composition snapshots", () => {
  test("manual activation source is retired", () => {
    const tree = readLatentPreparationSourceTree();
    expect(Object.keys(tree.files).some(file=>file.endsWith("/extensions/tool-activation.ts"))).toBe(false);
  });

  // Source-wide AST audit; this is not a runtime latency assertion.
  test("removing latent declarations cannot reintroduce a default-tool selector", () => {
    const tree = readLatentPreparationSourceTree();
    const withoutLatent = Object.freeze({
      files: Object.freeze(Object.fromEntries(Object.entries(tree.files).filter(([file]) => !file.startsWith(latentPrefix)))),
    });
    const withInventory = inventoryLatentToolFamilies(tree);
    const withoutInventory = inventoryLatentToolFamilies(withoutLatent);
    expect(withInventory.names).toEqual(withoutInventory.names);
    expect(withInventory.names).not.toContain("activate_tools");
    expect(withInventory.names).not.toContain("reset_active_tools");
  }, 30_000);
  test("keeps active name/description/prompt/schema contracts identical with and without latent files", () => {
    const tree = readLatentPreparationSourceTree();
    const withoutLatent = Object.freeze({
      files: Object.freeze(Object.fromEntries(Object.entries(tree.files).filter(([file]) => !file.startsWith(latentPrefix)))),
    });
    const coreNames = ["read","bash","powershell","edit","write","grep","find","ls","list_tools","attach_file","messages"];
    const configurations = [
      {platform:"linux" as const,enabledEnv:new Set<string>(),activeNames:coreNames},
      {platform:"win32" as const,enabledEnv:new Set<string>(),activeNames:coreNames},
    ];
    for (const { activeNames, ...config } of configurations) {
      const withContracts = snapshotLatentToolContracts(tree, config);
      const withoutContracts = snapshotLatentToolContracts(withoutLatent, config);
      const availableNames = inventoryLatentToolFamilies(tree, config).names;
      const effectiveActiveNames = activeNames.filter((name) => availableNames.includes(name));
      const snapshot = (contracts: typeof withContracts) => Object.freeze(Object.fromEntries(
        effectiveActiveNames.map((name) => [name, contracts[name]]),
      ));
      expect(snapshot(withContracts)).toEqual(snapshot(withoutContracts));
      expect(effectiveActiveNames.filter((name) => !Object.hasOwn(withContracts, name))).toEqual([]);
      for (const contract of Object.values(withContracts).filter((entry) => effectiveActiveNames.includes(entry.name))) {
        expect(contract.description.length).toBeGreaterThan(0);
        expect(contract.description).toBe(contract.description.replace(/\s+/g, " ").trim());
        expect(contract.promptSnippet).toBe(contract.promptSnippet.replace(/\s+/g, " ").trim());
        expect(contract.parameterSchemaFingerprint).toMatch(/^(?:[a-f0-9]{64}|external:)/);
        expect(Object.isFrozen(contract)).toBeTrue();
      }
    }
  }, 30_000);

  // Four full source-as-data AST compositions are intentionally bounded above Bun's default timeout.
  test("models retained Linux and Windows declarations without execution", () => {
    const tree = readLatentPreparationSourceTree();
    const withoutLatent = Object.freeze({
      files: Object.freeze(Object.fromEntries(Object.entries(tree.files).filter(([file]) => !file.startsWith(latentPrefix)))),
    });
    const configurations = [
      { platform: "linux" as const, enabledEnv: new Set<string>() },
      { platform: "win32" as const, enabledEnv: new Set<string>() },
    ];
    const withLatent = configurations.map((config) => inventoryLatentToolFamilies(tree, config));
    const withoutLatentInventories = configurations.map((config) => inventoryLatentToolFamilies(withoutLatent, config));
    const [linux, windows] = withLatent;
    for (const [index, inventory] of withLatent.entries()) {
      expect(inventory.names).toEqual(withoutLatentInventories[index].names);
    }

    expect(linux.names).toContain("powershell");
    expect(windows.names).toContain("powershell");
    for (const inventory of [linux,windows]) {
      expect(inventory.names).toContain('list_tools');
      expect(inventory.names).not.toContain('activate_tools');
      expect(inventory.names).not.toContain('reset_active_tools');
    }
    expect(linux.unresolvedRegistrations).toEqual([]);
    expect(windows.unresolvedRegistrations).toEqual([]);
  }, 30_000);
});
