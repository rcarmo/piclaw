import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createMcpExtension, createToolSearchExtension, createCodemodeExtension } from "@earendil-works/pi-coding-agent";
import { checkMcpPublic151, matchNegativeDiagnostics, MCP_GIT_HEAD, MCP_VERSION, missingSeams } from "../../../scripts/check-earendil-mcp-public-151.ts";
import historicalHarnessEvidence from "../../../docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-harness-compatibility-schema6.json";

const root = resolve(import.meta.dir, "../../..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const lock = readFileSync(resolve(root, "bun.lock"), "utf8");
const family = ["chord", "pi-agent-core", "pi-ai", "pi-codemode", "pi-coding-agent", "pi-mcp", "pi-telemetry", "pi-tui"].map(name => "@earendil-works/" + name);

const closure = [...family, '@earendil-works/pi-schema']; // SDK-owned exact dependency, no redundant host override.
// Current target checks are unconditional; historical archive receipts remain immutable.
test("exact 1.5.1 root closure includes SDK schema and excludes durable", () => {
  for (const name of ["chord", "pi-agent-core", "pi-ai", "pi-coding-agent"].map(name => "@earendil-works/" + name)) {
    expect(pkg.dependencies[name], name).toBe("1.5.1");
  }
  for (const name of family) expect(pkg.overrides[name], name).toBe("1.5.1");
  // Parse Bun's JSON-with-trailing-delimiters lock and inspect package values.
  const parsed = JSON.parse(lock.replace(/,\s*([}\]])/g, "$1"));
  const resolved = Object.values(parsed.packages).map((entry: any) => entry[0] as string).filter(id => id.startsWith("@earendil-works/"));
  expect(resolved.sort()).toEqual(closure.map(name => name + "@1.5.1").sort());
  for (const name of ["chord", "pi-agent-core", "pi-ai", "pi-coding-agent"].map(name => "@earendil-works/" + name)) {
    expect(parsed.workspaces[""].dependencies[name], name).toBe("1.5.1");
  }
  for (const name of closure) {
    const installed = JSON.parse(readFileSync(resolve(root, "node_modules", name, "package.json"), "utf8"));
    expect(installed.name).toBe(name);
    expect(installed.version, name).toBe("1.5.1");
  }
  expect(JSON.stringify({ dependencies: pkg.dependencies, devDependencies: pkg.devDependencies, overrides: pkg.overrides })).not.toContain("pi-durable");
  expect(lock).not.toContain("pi-durable");
  expect(existsSync(resolve(root, "node_modules/@earendil-works/pi-durable"))).toBe(false);
});

test("1.5.1 keeps wrapper ownership and does not activate native MCP or Harness", () => {
  expect(pkg.dependencies["pi-mcp-adapter"]).toBe("github:piclaw-bot/pi-mcp-adapter#dddfcf630508f42c169889c11dee94e69b746e7c");
  const session = readFileSync(resolve(root, "runtime/src/agent-pool/session.ts"), "utf8");
  expect(session).toContain('require("pi-mcp-adapter")');
  expect(session).toContain("initializeOnLoad: false");
  expect(session).toContain("resolveRuntimeEnv");
  for (const factory of ["createMcpExtension", "createToolSearchExtension", "createCodemodeExtension"]) expect(session).not.toContain(factory);
  expect(typeof createMcpExtension).toBe("function");
  expect(typeof createToolSearchExtension).toBe("function");
  expect(typeof createCodemodeExtension).toBe("function");
  expect(session).not.toMatch(/AgentHarness|Pico3|pi-durable/);
  expect(historicalHarnessEvidence.authority.currentRuntimeVersion).toBe("0.99.1"); // Frozen as-of evidence, not installed target.
  expect(historicalHarnessEvidence.authority.harnessActivation).toBe("latent_only");
  expect(historicalHarnessEvidence.experimentalPico3.productionImport).toBe(false);
  expect(historicalHarnessEvidence.experimentalPico3.productionActivation).toBe(false);
  expect(historicalHarnessEvidence.currentRuntime.productionImport).toBe(false);
  expect(historicalHarnessEvidence.currentRuntime.productionActivation).toBe(false);
});

test("1.5.1 public SDK, MCP and ToolLoadout.getPromptGuidelines types compile with all ten measured gaps retained", () => {
  expect(MCP_VERSION).toBe("1.5.1");
  expect(MCP_GIT_HEAD).toBe("dd30101cfc5b0609411dd80b6f93adbc14db14cf");
  const receipt = checkMcpPublic151(root);
  const fresh = JSON.parse(readFileSync(resolve(root, "docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-151-mcp-public.json"), "utf8"));
  expect(receipt).toEqual(fresh.compile);
  expect(receipt).toMatchObject({ version: "1.5.1", referenceGitHead: "dd30101cfc5b0609411dd80b6f93adbc14db14cf", positive: "pass", scope: "public_type_contract_only", nativeParity: "not_qualified", productionActivation: false });
  expect(receipt.packages).toEqual(["pi-coding-agent", "pi-mcp", "pi-codemode"].map(name => ({ name: "@earendil-works/" + name, version: "1.5.1" })));
  expect(receipt.negative).toEqual([
    { symbol: "lazy", code: "TS2353", requirement: "MCP-08" },
    { symbol: "statusObserver", code: "TS2353", requirement: "MCP-12" },
    { symbol: "resourceFilter", code: "TS2353", requirement: "MCP-06" },
    { symbol: "authStart", code: "TS2353", requirement: "MCP-10" },
    { symbol: "appRenderer", code: "TS2353", requirement: "MCP-11" },
    { symbol: "absoluteDeadlineMs", code: "TS2353", requirement: "MCP-07" },
    { symbol: "McpOAuthCredentialStore", code: "TS2740", requirement: "MCP-03" },
    { symbol: "socket", code: "TS2322", requirement: "MCP-08" },
    { symbol: "listPrompts", code: "TS2339", requirement: "MCP-11" },
    { symbol: "getPrompt", code: "TS2339", requirement: "MCP-11" },
  ]);
  expect(receipt.positiveSourceSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(receipt.negativeSourceSha256).toMatch(/^[0-9a-f]{64}$/);
}, 65_000);

test("1.5.1 diagnostic matching rejects missing, extra, changed and ambiguous gaps", () => {
  const lines = missingSeams.map(row => `error ${row.code}: ${row.symbol}`);
  expect(matchNegativeDiagnostics(lines.join("\n"))).toEqual(missingSeams);
  expect(() => matchNegativeDiagnostics(lines.slice(1).join("\n"))).toThrow("Expected exactly 10");
  expect(() => matchNegativeDiagnostics([...lines, "error TS9999: unrelated"].join("\n"))).toThrow("Expected exactly 10");
  expect(() => matchNegativeDiagnostics(["error TS2339: lazy", ...lines.slice(1)].join("\n"))).toThrow("Missing or ambiguous TS2353 for lazy");
  expect(() => matchNegativeDiagnostics([lines[0], lines[0], ...lines.slice(2)].join("\n"))).toThrow("Missing or ambiguous TS2353 for lazy");
});
