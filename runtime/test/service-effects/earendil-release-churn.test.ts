import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST } from "../../src/service-effects/earendil-harness-v3-compatibility/manifest.js";

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

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
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

function internalDependencies(manifest: Record<string, unknown>): readonly Readonly<{ name: string; range: string }>[] {
  const dependencies = manifest.dependencies === undefined ? {} : requireRecord(manifest.dependencies, "dependencies");
  return Object.keys(dependencies)
    .filter((name) => name.startsWith("@earendil-works/"))
    .sort()
    .map((name) => ({ name, range: requireString(dependencies[name], `${name} dependency range`) }));
}

function exportNames(manifest: Record<string, unknown>): readonly string[] {
  if (manifest.exports === undefined) return [];
  return Object.keys(requireRecord(manifest.exports, "exports")).sort();
}

function publicTarget(manifest: Record<string, unknown>, subpath: string, kind: "runtime" | "declaration"): string {
  const exportsMap = requireRecord(manifest.exports, "exports");
  const entry = requireRecord(exportsMap[subpath], `exports[${subpath}]`);
  return requireString(entry[kind === "runtime" ? "import" : "types"], `${subpath} ${kind} target`);
}

async function sha256(path: string): Promise<string> {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

describe("Earendil release churn gate", () => {
  test("pins the repository and lockfile to the selected coherent 0.84.4 current runtime", async () => {
    const [historical, current] = EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST.releases;
    const rootManifest = requireRecord(await Bun.file(resolve(repositoryRoot, "package.json")).json(), "repository package.json");
    const rootDependencies = requireRecord(rootManifest.dependencies, "repository dependencies");
    for (const directName of [
      "@earendil-works/pi-agent-core",
      "@earendil-works/pi-ai",
      "@earendil-works/pi-coding-agent",
    ]) {
      expect(rootDependencies[directName]).toBe("0.84.4");
    }
    expect(rootDependencies.openai).toBe("7.5.0");

    const lock = await Bun.file(resolve(repositoryRoot, "bun.lock")).text();
    for (const evidence of historical.packages) {
      expect(lock).not.toContain(`"${evidence.name}@0.84.1"`);
      expect(lock).not.toContain(evidence.integrity);
    }
    for (const evidence of current.packages) {
      const entry = lockPackageEntry(lock, evidence.name);
      if (evidence.installation === "not_installed") {
        expect(entry).toBeUndefined();
        expect(lock).not.toContain(evidence.integrity);
      } else {
        expect(entry).toBeDefined();
        if (!entry) throw new Error(`Missing locked package entry for ${evidence.name}.`);
        expect(entry.startsWith(`    "${evidence.name}": ["${evidence.name}@${evidence.version}",`)).toBe(true);
        expect(entry).toContain(`, "${evidence.integrity}"],`);
      }
    }
    expect(lockPackageEntry(lock, "openai")?.startsWith('    "openai": ["openai@7.5.0",')).toBe(true);
  });

  test("matches installed public package manifests, export maps, engines, and internal ranges", async () => {
    const current = EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST.releases[1];
    expect(current.packages).toHaveLength(9);
    for (const evidence of current.packages) {
      const directory = resolve(modulesRoot, evidence.name);
      if (evidence.installation === "not_installed") {
        expect(existsSync(directory)).toBe(false);
        continue;
      }
      const installed = await readPackage(evidence.name);
      expect(installed.name).toBe(evidence.name);
      expect(installed.version).toBe(evidence.version);
      expect(requireRecord(installed.engines, `${evidence.name} engines`).node).toBe(evidence.engine);
      expect(exportNames(installed)).toEqual(evidence.exports);
      expect(internalDependencies(installed)).toEqual(evidence.internalDependencies);
    }
  });

  test("matches current hashes only through contained package-declared public export targets", async () => {
    const current = EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST.releases[1];
    for (const fingerprint of current.fingerprints) {
      if (fingerprint.subpath.startsWith("audit:")) continue;
      const installed = await readPackage(fingerprint.package);
      const target = publicTarget(installed, fingerprint.subpath, fingerprint.kind);
      const packageRoot = resolve(modulesRoot, fingerprint.package);
      const targetPath = resolve(packageRoot, target);
      expect(target.startsWith("./")).toBe(true);
      expect(isLexicallyContained(packageRoot, targetPath)).toBe(true);
      const realPackageRoot = realpathSync(packageRoot);
      const realTargetPath = realpathSync(targetPath);
      expect(isLexicallyContained(realPackageRoot, realTargetPath)).toBe(true);
      expect(await sha256(realTargetPath)).toBe(fingerprint.sha256);
    }
    expect(isLexicallyContained("/package", "/escape")).toBe(false);
    expect(isLexicallyContained("/package", "/package/../escape")).toBe(false);

    const temporaryRoot = mkdtempSync(resolve(tmpdir(), "earendil-export-containment-"));
    try {
      const packageRoot = resolve(temporaryRoot, "package");
      const escapedTarget = resolve(temporaryRoot, "outside");
      mkdirSync(packageRoot);
      mkdirSync(escapedTarget);
      const linkedTarget = resolve(packageRoot, "linked-export");
      symlinkSync(escapedTarget, linkedTarget, "dir");
      expect(isLexicallyContained(realpathSync(packageRoot), realpathSync(linkedTarget))).toBe(false);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  test("pins manifest uniqueness, canonical order, hashes, SRI, and inert candidate classifications", () => {
    const manifest = EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST;
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

  test("independently pins the selected 0.84.4 runtime and rejected Harness evidence aggregates", () => {
    const current = EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST.releases[1];
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
