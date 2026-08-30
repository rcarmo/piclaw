import "../helpers.js";

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

import {
  CORE_EARENDIL_FACTORY_TARGETS,
  DYNAMIC_TOOL_PREPARATION_TEMPLATES,
  MESSAGES_ACTIVATION_BLOCKER,
  TOOL_PREPARATION_MANIFEST,
} from "../../src/service-effects/tool-preparation/manifest.js";
import {
  getToolPreparationPolicy,
  listToolPreparationPolicies,
} from "../../src/service-effects/tool-preparation/policy.js";
import {
  normalizeToolPreparationManifest,
  validateToolPreparationManifest,
  type ToolPreparationValidationOptions,
} from "../../src/service-effects/tool-preparation/validator.js";
import type { ToolPreparationSpec } from "../../src/service-effects/tool-preparation/types.js";
import { resolveAddonPackageTree, type VirtualPackageTree } from "./fixtures/addon-package-tree-oracle.js";
import {
  computeMcpServerIdentityHash,
  formatMcpFixtureToolName,
  resolveMcpMetadataFixture,
  resourceNameToToolName,
  type McpServerFixture,
} from "./fixtures/mcp-metadata-oracle.js";
import {
  inventoryRepositoryToolFamilies,
  type SourceTree,
} from "./fixtures/repository-tool-family-oracle.js";

const SPEC_FIELDS = [
  "toolName", "currentSource", "effectClass", "replay", "contextFields",
  "serviceEffector", "abortExpectation", "protectedFields",
].sort();
const TEMPLATE_NAMES = DYNAMIC_TOOL_PREPARATION_TEMPLATES.map((row) => row.toolName);

interface TestMcpCacheEntry {
  readonly configHash?: unknown;
  readonly cachedAt: unknown;
  readonly tools?: unknown;
  readonly resources?: unknown;
}
interface TestMcpServer extends McpServerFixture { readonly cache?: TestMcpCacheEntry | null }

function freshMcpCache(
  _serverName: string,
  metadata: { readonly tools?: readonly Record<string, unknown>[]; readonly resources?: readonly Record<string, unknown>[] } = {},
): TestMcpCacheEntry {
  return { cachedAt: 1_000, ...metadata };
}

function resolveMcpFixture(value: Omit<Record<string, unknown>, "servers" | "cache"> & { readonly servers: readonly TestMcpServer[] }) {
  const cacheServers: Record<string, unknown> = {};
  const servers = value.servers.map(({ cache, ...server }) => {
    if (cache) cacheServers[server.name] = { configHash: cache.configHash ?? computeMcpServerIdentityHash(server), ...cache };
    return server;
  });
  return resolveMcpMetadataFixture({ ...value, servers, cache: { version: 1, servers: cacheServers } });
}

function fixtureSpecs(names: readonly string[]): ToolPreparationSpec[] {
  return names.map((toolName) => ({
    toolName,
    currentSource: "hermetic production-composition fixture",
    effectClass: "query",
    replay: "safe",
    contextFields: [],
    serviceEffector: null,
    abortExpectation: "may_finish_late",
    protectedFields: [],
  }));
}

function compositionTree(optionalFiles: readonly string[] = ["one.ts"], builtinEntries = "alwaysOn"): SourceTree {
  const optionalEntries = optionalFiles
    .map((file) => `{ path: resolve(EXTENSIONS_DIR, "optional", "${file}") }`)
    .join(", ");
  return {
    files: {
      "src/extensions/index.ts": `
        import { alwaysOn } from "./always.js";
        export function createBuiltinExtensionFactories() { return [${builtinEntries}]; }
      `,
      "src/extensions/always.ts": `export const alwaysOn = (pi: any) => pi.registerTool({ name: "fixture_always" });`,
      "src/agent-pool/session.ts": `
        const OPTIONAL_EXTENSIONS = [${optionalEntries}];
      `,
      "extensions/optional/one.ts": `export default (pi: any) => pi.registerTool({ name: "fixture_optional" });`,
      "extensions/optional/two.ts": `export default (pi: any) => pi.registerTool({ name: "fixture_new_optional" });`,
      "extensions/unreferenced.ts": `export default (pi: any) => { pi.registerTool({ name: "fixture_unreferenced" }); pi.registerTool({ name: "fixture_always" }); };`,
    },
  };
}

describe("WP-3C production-root coverage oracle", () => {
  test("matches exact repository rows from authoritative production composition", () => {
    const inventory = inventoryRepositoryToolFamilies();
    expect(inventory.unresolvedRegistrations).toEqual([]);
    expect(TOOL_PREPARATION_MANIFEST.map((row) => row.toolName).sort()).toEqual([...inventory.names]);
    expect(inventory.registrationSites.cdp_browser).toEqual(["extensions/browser/cdp-browser-tool/index.ts"]);
    expect(inventory.nonProductionDuplicateSites.cdp_browser).toEqual(["extensions/browser/cdp-browser/index.ts"]);
    expect(inventory.sdkToolFamilies).toEqual(["bash", "edit", "find", "grep", "ls", "powershell", "read", "write"]);
    const compositionCategories = {
      builtin: inventory.compositionRoots.filter((root) => root.startsWith("src/extensions/")),
      optional: inventory.compositionRoots.filter((root) => root.startsWith("extensions/")),
      service: inventory.compositionRoots.filter((root) => root === "src/agent-pool/service-factory.ts"),
    };
    expect(Object.fromEntries(Object.entries(compositionCategories).map(([category, roots]) => [category, roots.length]))).toEqual({
      builtin: 30,
      optional: 8,
      service: 1,
    });
    expect(inventory.compositionRoots).toHaveLength(Object.values(compositionCategories).flat().length);

    const manifestByName = new Map(TOOL_PREPARATION_MANIFEST.map((row) => [row.toolName, row]));
    expect(Object.keys(inventory.registrationSites)).toHaveLength(40);
    for (const [toolName, sites] of Object.entries(inventory.registrationSites)) {
      const currentSource = manifestByName.get(toolName)?.currentSource;
      expect(currentSource).toBeDefined();
      for (const site of sites) expect(currentSource).toContain(`runtime/${site}`);
    }
    for (const toolName of inventory.sdkToolFamilies.filter((name) => name !== "powershell")) {
      expect(manifestByName.get(toolName)?.currentSource).toContain("@earendil-works/pi-coding-agent");
    }
    expect(manifestByName.get("powershell")?.currentSource).toContain("runtime/extensions/platform/windows/powershell");
    expect(Object.hasOwn(inventory.registrationSites, "mcp")).toBeFalse();
    expect(manifestByName.get("mcp")?.currentSource).toContain("pi-mcp-adapter");
  });

  test("ignores an unreferenced registration", () => {
    const inventory = inventoryRepositoryToolFamilies(compositionTree());
    expect(inventory.names).toContain("fixture_always");
    expect(inventory.names).toContain("fixture_optional");
    expect(inventory.names).not.toContain("fixture_unreferenced");
    expect(inventory.registrationSites.fixture_always).toEqual(["src/extensions/always.ts"]);
    expect(inventory.nonProductionDuplicateSites.fixture_always).toEqual(["extensions/unreferenced.ts"]);
  });

  test("returns immutable records and tuples rather than mutable Map/Set views", () => {
    const inventory = inventoryRepositoryToolFamilies(compositionTree(), { sdkToolFamilies: [] });
    expect(Object.isFrozen(inventory)).toBeTrue();
    expect(Object.isFrozen(inventory.registrationSites)).toBeTrue();
    expect(Object.isFrozen(inventory.nonProductionDuplicateSites)).toBeTrue();
    expect(Object.values(inventory.registrationSites).every(Object.isFrozen)).toBeTrue();
    expect(Reflect.set(inventory.registrationSites, "escape", ["mutable.ts"])).toBeFalse();
    expect(() => (inventory.registrationSites.fixture_always as string[]).push("mutable.ts")).toThrow();
    expect(Object.values(inventory).some((value) => value instanceof Map || value instanceof Set)).toBeFalse();
  });

  test("derives imported aliases and named re-exported constants/factories from source", () => {
    const tree = compositionTree([], "alwaysOn");
    const files = { ...tree.files };
    files["src/extensions/always.ts"] = `
      import { EXPORTED_NAME as LOCAL_NAME, createExportedTool as localFactory } from "./api.js";
      export const alwaysOn = (pi: any) => {
        pi.registerTool({ name: LOCAL_NAME });
        pi.registerTool(localFactory());
      };
    `;
    files["src/extensions/api.ts"] = `
      export { REAL_NAME as EXPORTED_NAME, createRealTool as createExportedTool } from "./impl.js";
    `;
    files["src/extensions/impl.ts"] = `
      export const REAL_NAME = "fixture_source_constant";
      export function createRealTool() { return { name: "fixture_source_factory" }; }
    `;
    const inventory = inventoryRepositoryToolFamilies({ files }, { sdkToolFamilies: [] });
    expect(inventory.unresolvedRegistrations).toEqual([]);
    expect(inventory.names).toEqual(["fixture_source_constant", "fixture_source_factory"]);
    expect(inventory.registrationSites).toEqual({
      fixture_source_constant: ["src/extensions/always.ts"],
      fixture_source_factory: ["src/extensions/always.ts"],
    });
  });

  test("resolves namespace/export-assignment/import-equals/dynamic edges through tsconfig paths and package exports", () => {
    const tree = compositionTree([], "alwaysOn");
    const files = { ...tree.files };
    files["tsconfig.json"] = JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@latent/*": ["latent/*"] } } });
    files["package.json"] = JSON.stringify({ name: "fixture-root", imports: { "#assigned": "./latent/assigned.ts" } });
    files["node_modules/fixture-package/package.json"] = JSON.stringify({
      name: "fixture-package", exports: { "./dynamic": { import: "./src/dynamic.ts" } },
    });
    files["src/extensions/always.ts"] = `
      export * as latentNamespace from "@latent/namespace";
      import legacy = require("@latent/legacy");
      export = require("#assigned");
      void import("fixture-package/dynamic");
      export const alwaysOn = (pi: any) => pi.registerTool({ name: "fixture_always" });
    `;
    for (const [file, name] of [
      ["latent/namespace.ts", "fixture_namespace"], ["latent/legacy.ts", "fixture_legacy"],
      ["latent/assigned.ts", "fixture_assigned"], ["node_modules/fixture-package/src/dynamic.ts", "fixture_dynamic"],
    ]) files[file] = `declare const pi: any; pi.registerTool({ name: "${name}" });`;
    const inventory = inventoryRepositoryToolFamilies({ files }, { sdkToolFamilies: [] });
    expect(inventory.unresolvedRegistrations).toEqual([]);
    expect(inventory.names).toEqual(["fixture_always"]);
    expect(inventory.productionRoots).toEqual(expect.arrayContaining([
      "latent/namespace.ts", "latent/legacy.ts", "latent/assigned.ts", "node_modules/fixture-package/src/dynamic.ts",
    ]));
    expect(Object.values(inventory).some((value) => value instanceof Map || value instanceof Set)).toBeFalse();
  });

  test("a newly referenced optional registration fails exact coverage", () => {
    const baseline = inventoryRepositoryToolFamilies(compositionTree());
    const changed = inventoryRepositoryToolFamilies(compositionTree(["one.ts", "two.ts"]));
    const issues = validateToolPreparationManifest(fixtureSpecs(baseline.names), {
      knownToolNames: changed.names,
      enforceAuthoritativePolicy: false,
    });
    expect(changed.names).toContain("fixture_new_optional");
    expect(issues).toContainEqual(expect.objectContaining({ code: "missing_known_tool", toolName: "fixture_new_optional" }));
  });

  test("removing an always-on production root makes its row unexpected", () => {
    const baseline = inventoryRepositoryToolFamilies(compositionTree());
    const changed = inventoryRepositoryToolFamilies(compositionTree(undefined, ""));
    const issues = validateToolPreparationManifest(fixtureSpecs(baseline.names), {
      knownToolNames: changed.names,
      rejectUnexpectedExactTools: true,
      enforceAuthoritativePolicy: false,
    });
    expect(issues).toContainEqual(expect.objectContaining({ code: "unexpected_exact_tool", toolName: "fixture_always" }));
  });
});

describe("WP-3C closed manifest policy and hostile-safe normalization", () => {
  test("normalizes and freezes every exact row and conservative template", () => {
    const inventory = inventoryRepositoryToolFamilies();
    const combined = [...TOOL_PREPARATION_MANIFEST, ...DYNAMIC_TOOL_PREPARATION_TEMPLATES];
    const result = normalizeToolPreparationManifest(combined, {
      knownToolNames: inventory.names,
      dynamicTemplateNames: TEMPLATE_NAMES,
      rejectUnexpectedExactTools: true,
    });
    expect(result.issues).toEqual([]);
    expect(result.specs).toHaveLength(46);
    expect(Object.isFrozen(result.specs)).toBeTrue();
    for (const row of result.specs) {
      expect(Object.keys(row).sort()).toEqual(SPEC_FIELDS);
      expect(Object.isFrozen(row)).toBeTrue();
      expect(Object.isFrozen(row.contextFields)).toBeTrue();
      expect(Object.isFrozen(row.protectedFields)).toBeTrue();
    }
  });

  test("has closed rationale evidence for all 44 repository rows", () => {
    const policies = listToolPreparationPolicies();
    expect(policies).toHaveLength(44);
    expect(policies.map((policy) => policy.toolName).sort()).toEqual(TOOL_PREPARATION_MANIFEST.map((row) => row.toolName).sort());
    for (const row of TOOL_PREPARATION_MANIFEST) {
      const policy = getToolPreparationPolicy(row.toolName)!;
      expect(policy.activationStatus).toBe("latent");
      expect(policy.currentIntegration).toBe("existing-production-wiring");
      expect(policy.currentServiceEffector).toBeNull();
      expect(policy.currentContextSource).toContain("neither PiclawToolContext nor a latent WP-3C service effector");
      expect(policy.currentAuthorityDescription.length).toBeGreaterThan(60);
      if (policy.currentAuthorityKind === "repository_file") {
        expect(policy.currentAuthorityPath).toMatch(/^runtime\/.+\.ts$/);
        expect(existsSync(new URL(`../../${policy.currentAuthorityPath.slice("runtime/".length)}`, import.meta.url))).toBeTrue();
      } else {
        expect(policy.currentAuthorityPath).toMatch(/^package:/);
        const packageName = policy.currentAuthorityPath.slice("package:".length);
        expect(existsSync(new URL(`../../../node_modules/${packageName}/package.json`, import.meta.url))).toBeTrue();
      }
      expect(policy.futureContextFields).toEqual(row.contextFields);
      expect(Object.isFrozen(policy.futureContextFields)).toBeTrue();
      expect(policy.futureServiceEffector).toBe(row.serviceEffector);
      expect(policy.futureIntegrationTarget).toContain(row.serviceEffector ?? "without acquiring Piclaw service-operation authority");
      expect(policy.authorityRationale.length).toBeGreaterThan(20);
      expect(policy.contextRationale.length).toBeGreaterThan(20);
      if (row.replay === "safe") expect(policy.safeProof?.length).toBeGreaterThan(20);
      if (row.serviceEffector !== null) {
        expect(policy.idempotencyIdentity?.length).toBeGreaterThan(10);
        expect(policy.activationPrerequisites.length).toBeGreaterThan(0);
        expect(policy.currentAuthorityDescription).toMatch(/SQLite|SSE|registry|transport|filesystem|persistence|indexer|scheduler|shutdown/i);
        expect(policy.currentAuthorityDescription).not.toMatch(/\bnone\b|future EF-S/i);
      } else if (row.effectClass !== "query") {
        expect(policy.nullAuthorityKind).not.toBeNull();
      }
    }
    expect(getToolPreparationPolicy("messages")).toMatchObject({
      currentAuthorityKind: "repository_file",
      currentAuthorityPath: "runtime/src/extensions/messages-crud.ts",
    });
  });

  test("policy evidence has no runtime mutation surface and validation remains stable", () => {
    const policies = listToolPreparationPolicies();
    const readPolicy = getToolPreparationPolicy("read")!;
    const before = normalizeToolPreparationManifest([TOOL_PREPARATION_MANIFEST.find((row) => row.toolName === "read")!]);
    expect(Object.isFrozen(policies)).toBeTrue();
    expect(Object.isFrozen(readPolicy)).toBeTrue();
    expect(Object.isFrozen(readPolicy.contextFields)).toBeTrue();
    expect(Object.isFrozen(readPolicy.futureContextFields)).toBeTrue();
    expect(Object.isFrozen(readPolicy.activationPrerequisites)).toBeTrue();
    expect(Reflect.set(readPolicy, "effectClass", "mutation")).toBeFalse();
    expect(() => (policies as unknown as ToolPreparationSpec[]).push(TOOL_PREPARATION_MANIFEST[0])).toThrow();
    expect(() => (readPolicy.contextFields as string[]).push("env")).toThrow();
    const after = normalizeToolPreparationManifest([TOOL_PREPARATION_MANIFEST.find((row) => row.toolName === "read")!]);
    expect(after).toEqual(before);
  });

  test("rejects hostile outer candidate and option containers without invoking getters or throwing", () => {
    let getterCalls = 0;
    const accessorOuter: unknown[] = [];
    Object.defineProperty(accessorOuter, "0", { configurable: true, enumerable: true, get: () => { getterCalls += 1; return TOOL_PREPARATION_MANIFEST[0]; } });
    accessorOuter.length = 1;
    const sparseOuter = new Array(1);
    const symbolOuter: unknown[] = [];
    symbolOuter[Symbol("hidden") as unknown as number] = TOOL_PREPARATION_MANIFEST[0];
    const propertyOuter: unknown[] & { hidden?: boolean } = [];
    propertyOuter.hidden = true;
    const hostileOuter = new Proxy([], { ownKeys: () => { throw new Error("hostile outer"); } });
    const revokedOuter = Proxy.revocable([], {});
    revokedOuter.revoke();
    const excessiveOuter = new Array(10_001);

    for (const candidate of [accessorOuter, sparseOuter, symbolOuter, propertyOuter, hostileOuter, revokedOuter.proxy, excessiveOuter]) {
      let result: ReturnType<typeof normalizeToolPreparationManifest> | undefined;
      expect(() => { result = normalizeToolPreparationManifest(candidate as unknown[]); }).not.toThrow();
      expect(result?.issues).toContainEqual(expect.objectContaining({ code: "invalid_candidate_array" }));
      expect(result?.specs).toEqual([]);
    }

    const read = TOOL_PREPARATION_MANIFEST.find((row) => row.toolName === "read")!;
    const accessorNames: string[] = [];
    Object.defineProperty(accessorNames, "0", { configurable: true, enumerable: true, get: () => { getterCalls += 1; return "read"; } });
    accessorNames.length = 1;
    const accessorOptions = Object.defineProperty({}, "knownToolNames", {
      enumerable: true,
      get: () => { getterCalls += 1; return ["read"]; },
    });
    const revokedOptions = Proxy.revocable({}, {});
    revokedOptions.revoke();
    for (const options of [{ knownToolNames: accessorNames }, accessorOptions, revokedOptions.proxy]) {
      let result: ReturnType<typeof normalizeToolPreparationManifest> | undefined;
      expect(() => { result = normalizeToolPreparationManifest([read], options as never); }).not.toThrow();
      expect(result?.issues).toContainEqual(expect.objectContaining({ code: "invalid_options" }));
      expect(result?.specs).toEqual([]);
    }
    expect(getterCalls).toBe(0);
  });

  test("closes option names to dense unique canonical exact names and the two approved templates", () => {
    const read = TOOL_PREPARATION_MANIFEST.find((row) => row.toolName === "read")!;
    const sparseNames = new Array(2);
    sparseNames[0] = "read";
    const invalidOptions: ToolPreparationValidationOptions[] = [
      { knownToolNames: ["read", "read"] },
      { knownToolNames: ["write", "read"] },
      { knownToolNames: ["Read"] },
      { knownToolNames: ["<addon-tool>"] },
      { knownToolNames: sparseNames },
      { dynamicTemplateNames: ["<addon-tool>"] },
      { dynamicTemplateNames: ["<mcp-direct-tool>", "<addon-tool>"] },
      { dynamicTemplateNames: ["<addon-tool>", "<unknown-template>"] },
      { dynamicTemplateNames: ["<addon-tool>", "<addon-tool>"] },
    ];
    for (const options of invalidOptions) {
      const result = normalizeToolPreparationManifest([read], options);
      expect(result.specs).toEqual([]);
      expect(result.issues).toContainEqual(expect.objectContaining({ code: "invalid_options" }));
    }
  });

  test("snapshots mutable inputs so later mutation cannot alter normalized policy", () => {
    const source = TOOL_PREPARATION_MANIFEST.find((row) => row.toolName === "read")!;
    const contextFields = ["env"];
    const protectedFields = ["params.path", "result.content"];
    const input = { ...source, contextFields, protectedFields };
    const result = normalizeToolPreparationManifest([input]);
    contextFields[0] = "localEnv";
    protectedFields[0] = "params.changed";
    expect(result.issues).toEqual([]);
    expect(result.specs[0].contextFields).toEqual(["env"]);
    expect(result.specs[0].protectedFields).toEqual(["params.path", "result.content"]);
  });

  test("rejects accessors, symbols, sparse arrays, cycles and throwing proxies without invoking getters", () => {
    const read = TOOL_PREPARATION_MANIFEST.find((row) => row.toolName === "read")!;
    let getterCalls = 0;
    const accessor = Object.defineProperties({}, {
      ...Object.getOwnPropertyDescriptors(read),
      currentSource: { enumerable: true, get: () => { getterCalls += 1; return "hostile"; } },
    });
    const symbol = { ...read } as Record<PropertyKey, unknown>;
    symbol[Symbol("hidden")] = true;
    const sparse = { ...read, contextFields: new Array(1) };
    const cyclic = { ...read } as Record<string, unknown>;
    cyclic.unexpected = cyclic;
    const hostile = new Proxy({}, { ownKeys: () => { throw new Error("hostile"); } });
    const issues = normalizeToolPreparationManifest([accessor, symbol, sparse, cyclic, hostile]).issues;
    expect(getterCalls).toBe(0);
    expect(issues.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "accessor_field", "unexpected_symbol", "invalid_context_fields", "unexpected_field", "invalid_spec",
    ]));
  });

  test("rejects malformed names/templates/selectors/order and authoritative policy drift", () => {
    const read = TOOL_PREPARATION_MANIFEST.find((row) => row.toolName === "read")!;
    const write = TOOL_PREPARATION_MANIFEST.find((row) => row.toolName === "write")!;
    const attach = TOOL_PREPARATION_MANIFEST.find((row) => row.toolName === "attach_file")!;
    const issues = normalizeToolPreparationManifest([
      { ...read, toolName: "Read Tool" },
      { ...read, toolName: "<unknown-template>" },
      { ...DYNAMIC_TOOL_PREPARATION_TEMPLATES[0], serviceEffector: "EF-S01" },
      { ...read, toolName: "bad_selector", protectedFields: ["params.*"] },
      { ...attach, contextFields: ["localEnv", "chatJid", "operationId"] },
      { ...write, effectClass: "query", replay: "safe" },
      { ...read, serviceEffector: "EF-S01" },
    ]).issues;
    expect(issues.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "invalid_tool_name", "invalid_dynamic_template", "invalid_protected_selector", "noncanonical_context_order",
      "authoritative_policy_mismatch", "missing_safe_proof",
    ]));
  });

  test("a malformed exact row cannot satisfy repository coverage", () => {
    const read = TOOL_PREPARATION_MANIFEST.find((row) => row.toolName === "read")!;
    const issues = validateToolPreparationManifest([{ ...read, unexpected: true }], {
      knownToolNames: ["read"],
      rejectUnexpectedExactTools: true,
      enforceAuthoritativePolicy: false,
    });
    expect(issues).toContainEqual(expect.objectContaining({ code: "unexpected_field" }));
    expect(issues).toContainEqual(expect.objectContaining({ code: "missing_known_tool", toolName: "read" }));
  });

  test("a dynamic template cannot satisfy a missing repository-owned exact name", () => {
    const withoutRead = TOOL_PREPARATION_MANIFEST.filter((row) => row.toolName !== "read");
    const issues = validateToolPreparationManifest([...withoutRead, ...DYNAMIC_TOOL_PREPARATION_TEMPLATES], {
      knownToolNames: inventoryRepositoryToolFamilies().names,
      dynamicTemplateNames: TEMPLATE_NAMES,
    });
    expect(issues).toContainEqual(expect.objectContaining({ code: "missing_known_tool", toolName: "read" }));
  });

  test("keeps every mutation never, every EF closed, and messages blocked", () => {
    expect(TOOL_PREPARATION_MANIFEST.filter((row) => row.effectClass !== "query").every((row) => row.replay === "never")).toBeTrue();
    expect(new Set(TOOL_PREPARATION_MANIFEST.map((row) => row.serviceEffector).filter(Boolean))).toEqual(
      new Set(["EF-S01", "EF-S03", "EF-S04", "EF-S05", "EF-S07"]),
    );
    expect(TOOL_PREPARATION_MANIFEST.find((row) => row.toolName === "messages")).toMatchObject({
      effectClass: "mixed", replay: "never", serviceEffector: null,
    });
    expect(MESSAGES_ACTIVATION_BLOCKER).toContain("delete/move");
    expect(CORE_EARENDIL_FACTORY_TARGETS).toEqual({
      package: "@earendil-works/pi-agent-core",
      exports: { read: "createReadTool", write: "createWriteTool", edit: "createEditTool", bash: "createBashTool" },
    });
    expect(Object.isFrozen(CORE_EARENDIL_FACTORY_TARGETS.exports)).toBeTrue();
  });
});

describe("WP-3C hermetic add-on package-tree oracle", () => {
  test("pins current join/exists/isFile semantics separately from future containment blockers", () => {
    const productionSource = readFileSync(new URL("../../src/agent-pool/session.ts", import.meta.url), "utf8");
    const discoveryBody = productionSource.slice(
      productionSource.indexOf("export function getInstalledAddonExtensionPaths"),
      productionSource.indexOf("function getBundledExtensionPaths"),
    );
    expect(discoveryBody).toContain("join(packageDir, relativePath)");
    expect(discoveryBody).toContain("existsSync(fullPath) && statSync(fullPath).isFile()");
    expect(discoveryBody).not.toMatch(/realpath|relative\(|contain/i);
    const tree: VirtualPackageTree = {
      nodeModulesRoot: "/node_modules",
      nodes: {
        "/node_modules": { kind: "directory" },
        "/node_modules/@scope": { kind: "directory" },
        "/node_modules/@scope/pkg": { kind: "directory" },
        "/node_modules/@scope/pkg/package.json": { kind: "file", content: JSON.stringify({ pi: { extensions: ["extension.ts"] } }) },
        "/node_modules/@scope/pkg/extension.ts": { kind: "file", content: "scoped" },
        "/node_modules/link": { kind: "symlink", target: "/packages/linked" },
        "/packages/linked": { kind: "directory" },
        "/packages/linked/package.json": { kind: "file", content: JSON.stringify({ pi: { extensions: ["entry.ts"] } }) },
        "/packages/linked/entry.ts": { kind: "file", content: "linked" },
        "/node_modules/plain": { kind: "directory" },
        "/node_modules/plain/package.json": { kind: "file", content: JSON.stringify({ main: "ignored.ts", pi: { extensions: ["entry.ts", "alias.ts", "entry.ts"] } }) },
        "/node_modules/plain/entry.ts": { kind: "file", content: "plain" },
        "/node_modules/plain/alias.ts": { kind: "symlink", target: "entry.ts" },
        "/node_modules/not-a-package.txt": { kind: "file", content: "ignored" },
      },
    };
    const current = resolveAddonPackageTree(tree, "current");
    const future = resolveAddonPackageTree(tree, "futureHardened");
    expect(current).toMatchObject({ fixtureValid: true, policy: "current", rejections: [] });
    expect(current.extensionPaths).toEqual([
      "/node_modules/@scope/pkg/extension.ts", "/node_modules/link/entry.ts", "/node_modules/plain/entry.ts",
      "/node_modules/plain/alias.ts", "/node_modules/plain/entry.ts",
    ]);
    expect(future.fixtureValid).toBeTrue();
    expect(future.policy).toBe("futureHardened");
    expect(Object.isFrozen(future)).toBeTrue();
    expect(Object.isFrozen(future.packagePaths)).toBeTrue();
    expect(Object.isFrozen(future.extensionPaths)).toBeTrue();
    expect(Object.isFrozen(future.rejections)).toBeTrue();
    expect(future.packagePaths).toEqual(["/node_modules/@scope/pkg", "/node_modules/link", "/node_modules/plain"]);
    expect(future.extensionPaths).toEqual(["/node_modules/@scope/pkg/extension.ts", "/node_modules/link/entry.ts", "/node_modules/plain/entry.ts"]);
    expect(future.rejections.map((entry) => entry.code)).toEqual(["duplicate_declaration", "duplicate_declaration"]);
  });

  test("ignores normal non-addons and reports only declared path failures with provenance", () => {
    const tree: VirtualPackageTree = {
      nodeModulesRoot: "/node_modules",
      nodes: {
        "/node_modules": { kind: "directory" },
        "/node_modules/broken": { kind: "symlink", target: "/missing" },
        "/node_modules/main-only": { kind: "directory" },
        "/node_modules/main-only/package.json": { kind: "file", content: JSON.stringify({ main: "entry.ts" }) },
        "/node_modules/malformed": { kind: "directory" },
        "/node_modules/malformed/package.json": { kind: "file", content: "{" },
        "/node_modules/unreadable": { kind: "directory" },
        "/node_modules/unreadable/package.json": { kind: "unreadable" },
        "/node_modules/unsafe": { kind: "directory" },
        "/node_modules/unsafe/package.json": { kind: "file", content: JSON.stringify({ pi: { extensions: ["../escape.ts", "missing.ts", "dir", "outside.ts", "unreadable.ts", 42] } }) },
        "/node_modules/escape.ts": { kind: "file", content: "current traversal" },
        "/node_modules/unsafe/dir": { kind: "directory" },
        "/node_modules/unsafe/outside.ts": { kind: "symlink", target: "/outside/entry.ts" },
        "/outside/entry.ts": { kind: "file", content: "escape" },
        "/node_modules/unsafe/unreadable.ts": { kind: "unreadable" },
      },
    };
    const current = resolveAddonPackageTree(tree, "current");
    const future = resolveAddonPackageTree(tree, "futureHardened");
    expect(current.extensionPaths).toEqual([
      "/node_modules/escape.ts", "/node_modules/unsafe/outside.ts", "/node_modules/unsafe/unreadable.ts",
    ]);
    expect(current.rejections).toEqual([]);
    expect(future.fixtureValid).toBeTrue();
    expect(future.extensionPaths).toEqual([]);
    expect(future.rejections.map((entry) => entry.code).sort()).toEqual([
      "lexical_escape", "missing_target", "non_file_target", "realpath_escape", "unreadable_target",
    ]);
    expect(future.rejections.every((entry) => entry.packagePath === "/node_modules/unsafe" && typeof entry.declaration === "string")).toBeTrue();
  });

  test("fails closed on hostile outer trees, node maps and accessor nodes without invoking getters", () => {
    let getterCalls = 0;
    const accessorOuter = Object.defineProperty({ nodeModulesRoot: "/node_modules" }, "nodes", {
      get() { getterCalls += 1; return {}; },
    });
    const accessorNode = Object.defineProperty({}, "kind", { get() { getterCalls += 1; return "directory"; } });
    const revokedOuter = Proxy.revocable({}, {});
    revokedOuter.revoke();
    const revokedNodes = Proxy.revocable({}, {});
    revokedNodes.revoke();
    const symbolNodes = { "/node_modules": { kind: "directory" }, [Symbol("escape")]: { kind: "directory" } };
    const hostile: unknown[] = [
      revokedOuter.proxy,
      accessorOuter,
      { nodeModulesRoot: "/node_modules", nodes: revokedNodes.proxy },
      { nodeModulesRoot: "/node_modules", nodes: [] },
      { nodeModulesRoot: "/node_modules", nodes: { "/node_modules": accessorNode } },
      { nodeModulesRoot: "/node_modules", nodes: symbolNodes },
      { nodeModulesRoot: "/node_modules", nodes: { "/node_modules": { kind: "directory" }, "/node_modules/.": { kind: "directory" } } },
    ];
    for (const value of hostile) {
      expect(resolveAddonPackageTree(value, "current")).toEqual({ fixtureValid: false, policy: "current", extensionPaths: [], packagePaths: [], rejections: [] });
      expect(resolveAddonPackageTree(value, "futureHardened")).toEqual({ fixtureValid: false, policy: "futureHardened", extensionPaths: [], packagePaths: [], rejections: [] });
    }
    expect(getterCalls).toBe(0);
  });
});

describe("WP-3C hermetic MCP metadata oracle", () => {
  test("normalizes prefixes and resource names exactly", () => {
    expect(formatMcpFixtureToolName("read.item", "agent-board-mcp", "server")).toBe("agent_board_mcp_read_item");
    expect(formatMcpFixtureToolName("read.item", "agent-board-mcp", "short")).toBe("agent_board_read_item");
    expect(formatMcpFixtureToolName("read.item", "agent-board-mcp", "mcp")).toBe("mcp__agent_board_mcp_read_item");
    expect(formatMcpFixtureToolName("read.item", "agent-board-mcp", "none")).toBe("read_item");
    expect(resourceNameToToolName(" Run  Book ")).toBe("run_book");
    expect(resourceNameToToolName("123")).toBe("resource_123");
    expect(resourceNameToToolName("---")).toBe("resource");
  });

  test("computes stable cache identity from exactly the installed authority field set", () => {
    const identity: McpServerFixture = {
      name: "identity", command: "bun", args: ["serve.ts"], socket: "/tmp/mcp.sock", env: { A: "1" }, cwd: "/repo",
      url: "https://mcp.example.test", headers: { "x-tenant": "one" }, auth: { type: "oauth" }, bearerToken: "secret",
      bearerTokenEnv: "MCP_TOKEN", exposeResources: true, includeTools: ["read_*"], excludeTools: ["write_*"],
    };
    const hash = computeMcpServerIdentityHash(identity);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(computeMcpServerIdentityHash({ ...identity, lifecycle: "lazy", idleTimeout: 5, requestTimeoutMs: 99, debug: true, directTools: true })).toBe(hash);
    for (const changed of [
      { ...identity, includeTools: ["other_*"] }, { ...identity, excludeTools: ["delete_*"] },
      { ...identity, auth: { type: "bearer" } }, { ...identity, url: "https://other.example.test" },
    ]) expect(computeMcpServerIdentityHash(changed)).not.toBe(hash);
    expect(computeMcpServerIdentityHash({ ...identity, env: { B: "2", A: "1" } })).toBe(
      computeMcpServerIdentityHash({ ...identity, env: { A: "1", B: "2" } }),
    );
  });

  test("uses supplied programmatic definitions and closes disabled to a literal boolean", () => {
    const result = resolveMcpFixture({
      prefix: "server",
      disableProxyTool: false,
      builtins: new Set(),
      servers: [
        { name: "boolean-disabled", disabled: true, directTools: true, cache: freshMcpCache("boolean-disabled", { tools: [{ name: "ignored" }] }) },
        { name: "literal-enabled", disabled: false, directTools: true, cache: freshMcpCache("literal-enabled", { tools: [{ name: "search" }] }) },
      ],
    });
    expect(result.directNames).toEqual(["literal_enabled_search"]);
    expect(result.missingConfiguredServers).toEqual([]);
  });

  test("handles filters, resources, invalid metadata, collisions, duplicates and proxy suppression", () => {
    const result = resolveMcpFixture({
      prefix: "short",
      disableProxyTool: true,
      builtins: new Set(["demo_read_resource_123"]),
      servers: [
        {
          name: "demo-mcp", directTools: true, includeTools: ["demo_mcp_*"], excludeTools: ["demo_secret"],
          cache: freshMcpCache("demo-mcp", { tools: [{ name: "search" }, { name: "secret" }, {}], resources: [{ name: "Run  Book" }, { name: "123" }, {}] }),
        },
        { name: "demo", directTools: ["search"], cache: freshMcpCache("demo", { tools: [{ name: "search" }, { name: "write" }] }) },
        { name: "disabled", disabled: true, directTools: true, cache: freshMcpCache("disabled", { tools: [{ name: "ignored" }] }) },
      ],
    });
    expect(Object.isFrozen(result)).toBeTrue();
    expect(Object.isFrozen(result.directNames)).toBeTrue();
    expect(Object.isFrozen(result.missingConfiguredServers)).toBeTrue();
    expect(Object.isFrozen(result.skipped)).toBeTrue();
    expect(result.directNames).toEqual(["demo_search", "demo_read_run_book"]);
    expect(result.proxyRegistered).toBeFalse();
    expect(result.skipped).toEqual(expect.arrayContaining([
      "demo-mcp:invalid-tool", "demo-mcp:resource:read_resource_123:builtin-collision",
      "demo-mcp:invalid-resource", "demo:tool:search:duplicate",
    ]));
  });

  test("validates cache definition hash, timestamp, TTL expiry and exact fresh boundary", () => {
    const result = resolveMcpFixture({
      prefix: "server",
      nowMs: 10_000,
      maxCacheAgeMs: 100,
      disableProxyTool: true,
      builtins: new Set(),
      servers: [
        { name: "mismatch", directTools: true, cache: { configHash: "other", cachedAt: 10_000, tools: [{ name: "search" }] } },
        { name: "zero", directTools: true, cache: { cachedAt: 0, tools: [{ name: "search" }] } },
        { name: "invalid", directTools: true, cache: { cachedAt: "10000", tools: [{ name: "search" }] } },
        { name: "expired", directTools: true, cache: { cachedAt: 9_899, tools: [{ name: "search" }] } },
        { name: "boundary", directTools: true, cache: { cachedAt: 9_900, tools: [{ name: "search" }] } },
      ],
    });
    expect(result.directNames).toEqual(["boundary_search"]);
    expect(result.missingConfiguredServers).toEqual(["expired", "invalid", "mismatch", "zero"]);
    expect(result.proxyRegistered).toBeTrue();
  });

  test("requires the versioned server-map cache envelope", () => {
    const server: McpServerFixture = { name: "versioned", directTools: true };
    const entry = { configHash: computeMcpServerIdentityHash(server), cachedAt: 1_000, tools: [{ name: "search" }] };
    const result = resolveMcpMetadataFixture({
      prefix: "server", disableProxyTool: true, builtins: new Set(), servers: [server],
      cache: { version: 2, servers: { versioned: entry } },
    });
    expect(result).toMatchObject({ directNames: [], missingConfiguredServers: ["versioned"], proxyRegistered: true });
    expect(result.skipped).toEqual(["cache:unsupported-version:2"]);
  });

  test("uses per-server direct selection over the global default", () => {
    const result = resolveMcpFixture({
      prefix: "server",
      globalDirectTools: true,
      disableProxyTool: false,
      builtins: new Set(),
      servers: [
        { name: "global", cache: freshMcpCache("global", { tools: [{ name: "read" }, { name: "write" }] }) },
        { name: "disabled", directTools: false, cache: freshMcpCache("disabled", { tools: [{ name: "ignored" }] }) },
        { name: "exact", directTools: ["read_run_book"], cache: freshMcpCache("exact", { tools: [{ name: "other" }], resources: [{ name: "Run Book" }, { name: "Other" }] }) },
      ],
    });
    expect(result.directNames).toEqual(["global_read", "global_write", "exact_read_run_book"]);
    expect(result.proxyRegistered).toBeTrue();
  });

  test("models env precedence, exact resource selection, stale cache and proxy retention", () => {
    const result = resolveMcpFixture({
      prefix: "none",
      globalDirectTools: true,
      envSelectors: ["selected/read_run_book", "stale"],
      disableProxyTool: true,
      builtins: new Set(),
      servers: [
        { name: "ignored-by-env", directTools: true, cache: freshMcpCache("ignored-by-env", { tools: [{ name: "tool" }] }) },
        { name: "selected", directTools: false, cache: freshMcpCache("selected", { tools: [{ name: "other" }], resources: [{ name: "Run Book" }] }) },
        { name: "stale", directTools: false, cache: { configHash: "mismatched", cachedAt: 1_000, tools: [{ name: "old" }] } },
      ],
    });
    expect(result.directNames).toEqual(["read_run_book"]);
    expect(result.missingConfiguredServers).toEqual(["stale"]);
    expect(result.proxyRegistered).toBeTrue();
  });

  test("retains proxy when metadata is absent or no valid direct tool remains", () => {
    const absent = resolveMcpFixture({
      prefix: "server", globalDirectTools: true, disableProxyTool: true, builtins: new Set(),
      servers: [{ name: "missing", cache: null }],
    });
    const empty = resolveMcpFixture({
      prefix: "server", disableProxyTool: true, builtins: new Set(),
      servers: [{ name: "empty", directTools: true, cache: freshMcpCache("empty", { tools: [{}] }) }],
    });
    expect(absent).toMatchObject({ directNames: [], missingConfiguredServers: ["missing"], proxyRegistered: true });
    expect(empty).toMatchObject({ directNames: [], missingConfiguredServers: [], proxyRegistered: true });
  });

  test("rejects duplicate selectors/direct names and closes metadata/filter strings", () => {
    const base = { prefix: "server" as const, globalDirectTools: true, builtins: new Set<string>(), cache: { version: 1, servers: {} } };
    for (const value of [
      { ...base, envSelectors: ["demo", "demo"], servers: [] },
      { ...base, servers: [{ name: "demo", directTools: ["read", "read"] }] },
      { ...base, servers: [{ name: "demo", includeTools: [" read"], directTools: true }] },
      { ...base, servers: [{ name: "demo", excludeTools: ["read", "read"], directTools: true }] },
    ]) expect(resolveMcpMetadataFixture(value).directNames).toEqual([]);
    expect(resolveMcpMetadataFixture({ ...base, envSelectors: ["demo", "demo"], servers: [] }).skipped).toEqual(["invalid-env-selector:demo"]);
    const whitespace = resolveMcpFixture({
      prefix: "server", builtins: new Set(), servers: [{ name: "demo", directTools: true, cache: freshMcpCache("demo", { tools: [{ name: " read " }] }) }],
    });
    expect(whitespace.skipped).toEqual(["demo:invalid-tool"]);
  });

  test("snapshots original MCP inputs and detects identity mutation on a fresh resolution", () => {
    const server = { name: "stable", directTools: true, url: "https://one.example.test" };
    const tools = [{ name: "read" }];
    const fixture = {
      prefix: "server" as const, builtins: new Set<string>(), servers: [server],
      cache: { version: 1, servers: { stable: { configHash: computeMcpServerIdentityHash(server), cachedAt: 1_000, tools } } },
    };
    const first = resolveMcpMetadataFixture(fixture);
    server.url = "https://two.example.test";
    tools[0]!.name = "write";
    expect(first.directNames).toEqual(["stable_read"]);
    expect(resolveMcpMetadataFixture(fixture)).toMatchObject({ directNames: [], missingConfiguredServers: ["stable"] });
  });

  test("descriptor-closes hostile containers and rejects invalid or future cache times without getters", () => {
    let getterCalls = 0;
    const accessorMetadata = Object.defineProperty({}, "name", { get() { getterCalls += 1; return "escape"; } });
    const accessorServer = Object.defineProperty({}, "name", { get() { getterCalls += 1; return "escape"; } });
    const revokedFixture = Proxy.revocable({}, {});
    revokedFixture.revoke();
    const revokedTools = Proxy.revocable([], {});
    revokedTools.revoke();
    const accessorBuiltins = new Set<string>();
    Object.defineProperty(accessorBuiltins, "size", { get() { getterCalls += 1; return 99; } });
    const base = { prefix: "server" as const, globalDirectTools: true, disableProxyTool: true, builtins: new Set<string>() };
    const invalidOuterValues: unknown[] = [
      revokedFixture.proxy,
      { ...base, servers: [accessorServer] },
      { ...base, servers: new Array(2) },
      { ...base, servers: new Array(1_001).fill({ name: "x", cache: null }) },
      { ...base, nowMs: Number.NaN, servers: [] },
      { ...base, nowMs: Number.POSITIVE_INFINITY, servers: [] },
      { ...base, maxCacheAgeMs: -1, servers: [] },
      { ...base, servers: [{ name: "bad-disabled", disabled: "true" }] },
    ];
    for (const value of invalidOuterValues) {
      expect(resolveMcpMetadataFixture(value)).toEqual({
        directNames: [], missingConfiguredServers: [], proxyRegistered: true, skipped: ["invalid-fixture"],
      });
    }
    expect(resolveMcpMetadataFixture({ ...base, servers: [{ name: "duplicate" }, { name: "duplicate" }], cache: { version: 1, servers: {} } }).skipped).toEqual(["duplicate-server:duplicate"]);
    expect(resolveMcpMetadataFixture({ ...base, builtins: accessorBuiltins, servers: [], cache: { version: 1, servers: {} } })).toEqual({
      directNames: [], missingConfiguredServers: [], proxyRegistered: true, skipped: [],
    });
    const invalidMetadata = resolveMcpFixture({
      ...base, servers: [{ name: "metadata", directTools: true, cache: freshMcpCache("metadata", { tools: [accessorMetadata] }) }],
    });
    expect(invalidMetadata).toMatchObject({ directNames: [], proxyRegistered: true, skipped: ["metadata:invalid-tool"] });
    const invalidCacheShape = resolveMcpFixture({
      ...base, servers: [{ name: "revoked", directTools: true, cache: { cachedAt: 1_000, tools: revokedTools.proxy } }],
    });
    expect(invalidCacheShape).toMatchObject({ directNames: [], missingConfiguredServers: ["revoked"], proxyRegistered: true });
    const future = resolveMcpFixture({
      ...base, nowMs: 1_000, servers: [{ name: "future", directTools: true, cache: { cachedAt: 1_001, tools: [{ name: "escape" }] } }],
    });
    expect(future).toMatchObject({ directNames: [], missingConfiguredServers: ["future"], proxyRegistered: true });
    expect(getterCalls).toBe(0);
  });

  test("does not freeze arbitrary add-on or MCP names into exact rows", () => {
    const exactNames = new Set(TOOL_PREPARATION_MANIFEST.map((row) => row.toolName));
    expect(exactNames.has("fixture_addon_tool")).toBeFalse();
    expect(exactNames.has("demo_search")).toBeFalse();
    expect(TEMPLATE_NAMES).toEqual(["<addon-tool>", "<mcp-direct-tool>"]);
  });
});
