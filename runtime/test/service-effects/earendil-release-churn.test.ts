import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST from "../../../docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-harness-compatibility-schema6.json";
import historicalProvenance from "../../../docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-harness-compatibility-schema6.provenance.json";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = resolve(runtimeRoot, "..");
const modulesRoot = resolve(repositoryRoot, "node_modules");

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be a record.`);
  return value;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

function digestEvidence(value: unknown): string {
  return new Bun.CryptoHasher("sha256").update(JSON.stringify(canonicalValue(value))).digest("hex");
}

function isLexicallyContained(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function lockPackageEntry(lock: string, packageName: string): string | undefined {
  const prefix = `    "${packageName}": ["${packageName}@`;
  return lock.split("\n").find((line) => line.startsWith(prefix));
}

async function readPackage(name: string): Promise<Record<string, unknown>> {
  return requireRecord(await Bun.file(resolve(modulesRoot, name, "package.json")).json(), `${name} package.json`);
}

describe("Earendil release churn gate", () => {
  test("pins the entire inert schema-6 archive while retiring its executable normalizer", async () => {
    const path = resolve(repositoryRoot, historicalProvenance.archive.path);
    expect(new Bun.CryptoHasher("sha256").update(await Bun.file(path).text()).digest("hex"))
      .toBe("1f6f640cc8ef89163b5d439304792abc735db2fc9251bcbc26bb590f660c932f");
    expect(digestEvidence(EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST))
      .toBe("eb4d28490de9ea4f9bff77c3a9b06051fae8e835133e0ad3f1d9d734275bea7e");
    expect(historicalProvenance.source.sha256).toBe("b7874e86bbd03d005bff57655a6308c8efd2c3025699ae815dc061c50948e91f");
    expect(historicalProvenance.archive.wholeObjectDeepEqualityVerified).toBe(true);
    expect(EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST.currentRuntime.version).toBe("0.99.1");
    expect(EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST.experimentalPico3.productionImport).toBe(false);
    expect(EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST.currentRuntime.productionActivation).toBe(false);
    expect(existsSync(resolve(repositoryRoot, historicalProvenance.source.path))).toBe(false);
  });
  test("pins the repository and lockfile to the exact coherent 1.5.2 current loop", async () => {
    const receipt = await Bun.file(resolve(repositoryRoot, "docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-152-registry.json")).json() as Array<any>;
    const rootManifest = requireRecord(await Bun.file(resolve(repositoryRoot, "package.json")).json(), "repository package.json");
    const rootDependencies = requireRecord(rootManifest.dependencies, "repository dependencies");
    for (const directName of ["@earendil-works/chord", "@earendil-works/pi-agent-core", "@earendil-works/pi-ai", "@earendil-works/pi-coding-agent"]) expect(rootDependencies[directName]).toBe("1.5.2");
    expect(rootDependencies.openai).toBe("7.31.0");
    const lock = await Bun.file(resolve(repositoryRoot, "bun.lock")).text();
    expect(receipt).toHaveLength(9);
    for (const evidence of receipt) {
      expect(evidence.version, evidence.name).toBe("1.5.2");
      const entry = lockPackageEntry(lock, evidence.name);
      expect(entry, evidence.name).toBeDefined();
      expect(entry!.startsWith(`    "${evidence.name}": ["${evidence.name}@1.5.2",`)).toBe(true);
      expect(entry).toContain(`, "${evidence.dist.integrity}"],`);
      expect(lock.match(new RegExp(`${evidence.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}@1\\.5\\.2`, "g"))).toHaveLength(1);
    }
    expect(lockPackageEntry(lock, "openai")?.startsWith('    "openai": ["openai@7.31.0",')).toBe(true);
  });

  test("matches installed 1.5.2 family manifests and keeps inactive Harness evidence at 0.87.1", async () => {
    const receipt = await Bun.file(resolve(repositoryRoot, "docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-152-registry.json")).json() as Array<any>;
    for (const evidence of receipt) {
      const installed = await readPackage(evidence.name);
      expect(installed.name).toBe(evidence.name);
      expect(installed.version).toBe("1.5.2");
      expect(installed.engines ? requireRecord(installed.engines, `${evidence.name} engines`).node : null).toBe(">=22.19.0");
    }
    const selected = EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST.selected;
    expect(selected.version).toBe("0.87.1");
    expect(EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST.authority.harnessActivation).toBe("latent_only");
    expect(digestEvidence(selected.packages)).toBe("c9ff5d9c135c9b234e0de13da5b1a21fbc8968215ea889775be133aa286d3dca");
    expect(digestEvidence(selected.fingerprints)).toBe("ce484225a4fbc620b7dccbf2dbb911ee56a3abcbc1dca59d7420683ebd69e0bc");
  });

  test("retains public-export containment as an independent security invariant", () => {
    expect(isLexicallyContained("/package", "/escape")).toBe(false);
    expect(isLexicallyContained("/package", "/package/../escape")).toBe(false);
    const temporaryRoot = mkdtempSync(resolve(tmpdir(), "earendil-export-containment-"));
    try {
      const packageRoot = resolve(temporaryRoot, "package"), escapedTarget = resolve(temporaryRoot, "outside");
      mkdirSync(packageRoot); mkdirSync(escapedTarget); const linkedTarget = resolve(packageRoot, "linked-export"); symlinkSync(escapedTarget, linkedTarget, "dir");
      expect(isLexicallyContained(realpathSync(packageRoot), realpathSync(linkedTarget))).toBe(false);
    } finally { rmSync(temporaryRoot, { recursive: true, force: true }); }
  });

  test("pins manifest uniqueness, canonical order, hashes, SRI, and inert candidate classifications", () => {
    const manifest = EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST.historical;
    const expectedPackages = [
      "@earendil-works/pi-agent-core",
      "@earendil-works/pi-ai",
      "@earendil-works/pi-client",
      "@earendil-works/pi-coding-agent",
      "@earendil-works/pi-protocol",
      "@earendil-works/pi-server",
      "@earendil-works/pi-session-backend-sqlite-node",
      "@earendil-works/pi-telemetry",
      "@earendil-works/pi-tui",
    ];
    expect(manifest.authority.designCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest.authority.draftEvidenceCommit).toMatch(/^[0-9a-f]{40}$/);
    for (const release of manifest.releases) {
      const names = release.packages.map((entry) => entry.name);
      expect(names).toEqual(expectedPackages);
      expect(new Set(names).size).toBe(9);
      expect(release.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(release.conformance.catalogueSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(release.conformance.auditedResultSha256).toMatch(/^[0-9a-f]{64}$/);
      for (const entry of release.packages) {
        expect(entry.shasum).toMatch(/^[0-9a-f]{40}$/);
        expect(entry.gitHead).toMatch(/^[0-9a-f]{40}$/);
        expect(entry.integrity.startsWith("sha512-")).toBe(true);
        const encoded = entry.integrity.slice("sha512-".length);
        expect(Buffer.from(encoded, "base64")).toHaveLength(64);
        expect(Buffer.from(encoded, "base64").toString("base64")).toBe(encoded);
      }
      const fingerprintKeys = release.fingerprints.map((entry) => `${entry.package}\0${entry.subpath}\0${entry.kind}`);
      expect(new Set(fingerprintKeys).size).toBe(fingerprintKeys.length);
      expect(release.fingerprints.every((entry) => /^[0-9a-f]{64}$/.test(entry.sha256))).toBe(true);
    }
    expect(manifest.boundaries.map((entry) => entry.id)).toEqual(["EB-01", "EB-02", "EB-03", "EB-04", "EB-05"]);
    expect(manifest.capabilities.map((entry) => entry.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => `HC-${String(index + 1).padStart(3, "0")}`),
    );
    expect(manifest.promotionCriteria.map((entry) => entry.id)).toEqual(
      Array.from({ length: 9 }, (_, index) => `PG-${String(index + 1).padStart(2, "0")}`),
    );
    const [historical, current] = manifest.releases;
    expect([historical.role, historical.runtimeSelection, historical.harnessSelection]).toEqual([
      "historical_harness_baseline",
      "historical",
      "baseline_evidence",
    ]);
    expect([current.role, current.runtimeSelection, current.harnessSelection]).toEqual([
      "current_runtime_harness_candidate",
      "installed",
      "rejected_evidence_only",
    ]);
    const expectedInstallation = [
      "direct",
      "direct",
      "transitive",
      "direct",
      "transitive",
      "not_installed",
      "not_installed",
      "transitive",
      "transitive",
    ];
    expect(historical.packages.map((entry) => entry.installation)).toEqual(expectedInstallation);
    expect(current.packages.map((entry) => entry.installation)).toEqual(expectedInstallation);
  });

  test("independently preserves the historical 0.84.4 evidence aggregates", () => {
    const current = EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST.historical.releases[1];
    const packageEvidence = current.packages.map((entry) => ({
      name: entry.name,
      version: entry.version,
      integrity: entry.integrity,
      shasum: entry.shasum,
      gitHead: entry.gitHead,
      engine: entry.engine,
      exports: entry.exports,
      internalDependencies: entry.internalDependencies,
    }));
    expect(digestEvidence(packageEvidence)).toBe("af6c2bd8149fafc1d55560691559d9434e56cf529d9ff6ae6d43425f39fbe04e");
    expect(digestEvidence(current.fingerprints)).toBe("ff836d4226d75aadbe37940f79cfaf48abd8dcec8e0f5adb6decfb2a44a7e290");
    expect([
      current.conformance.caseCount,
      current.conformance.catalogueSha256,
      current.conformance.auditedResultSha256,
      current.conformance.memory,
      current.conformance.jsonl,
      current.conformance.sqlite,
      current.conformance.sqliteReason,
    ]).toEqual([
      30,
      "46636aec941f7bbd5fcec6b3aec2b8e43518a0482a1b7f4fd4c1d5197e69f387",
      "f2c7e067e69daf3e730da4dcab2a0ca14bba31be462c81aa70af0ac10b43e504",
      "pass",
      "pass",
      "unsupported",
      "bun_node_sqlite_unavailable",
    ]);
  });
});
