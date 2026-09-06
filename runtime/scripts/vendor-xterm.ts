#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

interface XtermExport {
  packagePath: string;
  outputFile: string;
  sourceSha256: string;
  patches?: string[];
  sha256: string;
}

interface XtermPackage {
  name: string;
  version: string;
  license: string;
  integrity: string;
  licenseSha256: string | null;
  exports: XtermExport[];
}

interface XtermManifest {
  id: string;
  registry: string;
  outputDir: string;
  metadataFile: string;
  documentationFiles: string[];
  packages: XtermPackage[];
}

const PROJECT_DIR = resolve(import.meta.dir, "..");
const MANIFEST_PATH = resolve(PROJECT_DIR, "vendor-manifests/xterm.json");
const LOG_PREFIX = "[vendor:xterm]";

const BROWSER_REQUIRE_FROM = `var me=(s=>typeof require<"u"?require:typeof Proxy<"u"?new Proxy(s,{get:(o,c)=>(typeof require<"u"?require:o)[c]}):s)(function(s){if(typeof require<"u")return require.apply(this,arguments);throw Error('Dynamic require of "'+s+'" is not supported')});`;
const BROWSER_REQUIRE_TO = `var me=(s=>typeof globalThis<"u"&&typeof globalThis.require=="function"?globalThis.require:typeof Proxy<"u"?new Proxy(s,{get:(o,c)=>typeof globalThis<"u"&&typeof globalThis.require=="function"?globalThis.require[c]:o[c]}):s)(function(s){throw Error('Dynamic require of "'+s+'" is not supported')});`;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function packageSlug(name: string): string {
  return name.replace(/^@/, "").replaceAll("/", "-");
}

function packageTarballUrl(manifest: XtermManifest, pkg: XtermPackage): string {
  const basename = pkg.name.slice(pkg.name.lastIndexOf("/") + 1);
  return `${manifest.registry}/${pkg.name}/-/${basename}-${pkg.version}.tgz`;
}

function verifyIntegrity(bytes: Uint8Array, integrity: string, label: string): void {
  const separator = integrity.indexOf("-");
  const algorithm = integrity.slice(0, separator);
  const expected = integrity.slice(separator + 1);
  if (separator < 1 || !["sha256", "sha384", "sha512"].includes(algorithm)) {
    throw new Error(`${label}: unsupported registry integrity ${integrity}`);
  }
  const actual = createHash(algorithm).update(bytes).digest("base64");
  if (actual !== expected) {
    throw new Error(`${label}: registry integrity mismatch (expected ${integrity}, got ${algorithm}-${actual})`);
  }
}

function validateIntegrity(integrity: string, label: string): void {
  if (!/^sha(?:256|384|512)-[A-Za-z0-9+/]+=*$/.test(integrity)) {
    throw new Error(`${label}: invalid registry integrity ${integrity}`);
  }
}

function extractTarballFile(archivePath: string, packagePath: string): Uint8Array {
  const proc = Bun.spawnSync(["tar", "-xOzf", archivePath, `package/${packagePath}`], {
    cwd: PROJECT_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    throw new Error(proc.stderr.toString().trim() || `Could not extract ${packagePath}`);
  }
  return new Uint8Array(proc.stdout);
}

function applyPatch(bytes: Uint8Array, patch: string): Uint8Array {
  if (patch !== "browser-safe-dynamic-require") {
    throw new Error(`Unknown xterm vendor patch: ${patch}`);
  }
  const source = new TextDecoder().decode(bytes);
  const occurrences = source.split(BROWSER_REQUIRE_FROM).length - 1;
  if (occurrences !== 1) {
    throw new Error(`browser-safe-dynamic-require expected one upstream match, found ${occurrences}`);
  }
  return new TextEncoder().encode(source.replace(BROWSER_REQUIRE_FROM, BROWSER_REQUIRE_TO));
}

function loadManifest(): XtermManifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as XtermManifest;
}

function validateManifest(manifest: XtermManifest): void {
  if (manifest.id !== "xterm" || !manifest.packages.length) {
    throw new Error("Invalid xterm vendor manifest");
  }
  const outputNames = new Set<string>();
  for (const pkg of manifest.packages) {
    if (!pkg.name.startsWith("@xterm/") || !pkg.version || pkg.license !== "MIT") {
      throw new Error(`Invalid package declaration for ${pkg.name || "unknown package"}`);
    }
    validateIntegrity(pkg.integrity, pkg.name);
    for (const output of pkg.exports) {
      if (outputNames.has(output.outputFile)) throw new Error(`Duplicate xterm output: ${output.outputFile}`);
      if (!/^[0-9a-f]{64}$/.test(output.sourceSha256) || !/^[0-9a-f]{64}$/.test(output.sha256)) {
        throw new Error(`Invalid SHA-256 for ${output.outputFile}`);
      }
      outputNames.add(output.outputFile);
    }
  }
}

function repositoryValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "url" in value && typeof value.url === "string") return value.url;
  return null;
}

async function downloadTarball(manifest: XtermManifest, pkg: XtermPackage): Promise<{ path: string; bytes: Uint8Array }> {
  const cacheDir = resolve(PROJECT_DIR, "generated/cache/vendor/xterm");
  const archivePath = resolve(cacheDir, `${packageSlug(pkg.name)}-${pkg.version}.tgz`);
  mkdirSync(cacheDir, { recursive: true });

  let bytes = existsSync(archivePath) ? new Uint8Array(readFileSync(archivePath)) : null;
  if (bytes) {
    try {
      verifyIntegrity(bytes, pkg.integrity, `${pkg.name}@${pkg.version}`);
    } catch {
      bytes = null;
    }
  }
  if (!bytes) {
    const url = packageTarballUrl(manifest, pkg);
    const response = await fetch(url, {
      headers: { "User-Agent": "piclaw-vendor-workflow", Accept: "application/octet-stream" },
    });
    if (!response.ok) throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
    bytes = new Uint8Array(await response.arrayBuffer());
    verifyIntegrity(bytes, pkg.integrity, `${pkg.name}@${pkg.version}`);
    writeFileSync(archivePath, bytes);
  }
  return { path: archivePath, bytes };
}

function checkVendoredFiles(manifest: XtermManifest): void {
  const outputDir = resolve(PROJECT_DIR, manifest.outputDir);
  const expectedNames = new Set([
    ...manifest.documentationFiles,
    ...manifest.packages.flatMap((pkg) => pkg.exports.map((entry) => entry.outputFile)),
  ]);
  const actualNames = new Set(readdirSync(outputDir));
  const unexpected = [...actualNames].filter((name) => {
    if (expectedNames.has(name)) return false;
    const sourceName = name.replace(/\.(?:br|gz)$/, "");
    return sourceName === name || !expectedNames.has(sourceName);
  });
  const missing = [...expectedNames].filter((name) => !actualNames.has(name));
  if (unexpected.length || missing.length) {
    throw new Error(`xterm vendor inventory mismatch (missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"})`);
  }

  for (const pkg of manifest.packages) {
    for (const output of pkg.exports) {
      const outputPath = resolve(outputDir, output.outputFile);
      const actual = sha256(new Uint8Array(readFileSync(outputPath)));
      if (actual !== output.sha256) {
        throw new Error(`${output.outputFile}: SHA-256 mismatch (expected ${output.sha256}, got ${actual})`);
      }
    }
  }

  const metadata = JSON.parse(readFileSync(resolve(PROJECT_DIR, manifest.metadataFile), "utf8")) as {
    manifest_id?: string;
    packages?: Array<{ name?: string; version?: string; integrity?: string }>;
    output_files?: Array<{ output_file?: string; sha256?: string }>;
  };
  if (metadata.manifest_id !== manifest.id) throw new Error("xterm metadata manifest ID does not match");
  for (const pkg of manifest.packages) {
    const recorded = metadata.packages?.find((entry) => entry.name === pkg.name);
    if (recorded?.version !== pkg.version || recorded.integrity !== pkg.integrity) {
      throw new Error(`${pkg.name}: metadata provenance does not match the manifest`);
    }
    for (const output of pkg.exports) {
      const outputFile = `${manifest.outputDir}/${output.outputFile}`;
      const recordedOutput = metadata.output_files?.find((entry) => entry.output_file === outputFile);
      if (recordedOutput?.sha256 !== output.sha256) {
        throw new Error(`${output.outputFile}: metadata checksum does not match the manifest`);
      }
    }
  }
}

async function updateVendoredFiles(manifest: XtermManifest): Promise<void> {
  const packages: Array<Record<string, unknown>> = [];
  const outputs: Array<Record<string, unknown> & { output_file: string }> = [];
  const pendingWrites: Array<{ path: string; bytes: Uint8Array }> = [];

  for (const pkg of manifest.packages) {
    const archive = await downloadTarball(manifest, pkg);
    verifyIntegrity(archive.bytes, pkg.integrity, `${pkg.name}@${pkg.version}`);

    const packageJson = JSON.parse(new TextDecoder().decode(extractTarballFile(archive.path, "package.json"))) as {
      name?: string;
      version?: string;
      license?: string;
      repository?: unknown;
      commit?: string;
    };
    if (packageJson.name !== pkg.name || packageJson.version !== pkg.version || packageJson.license !== pkg.license) {
      throw new Error(`${pkg.name}: package metadata does not match the manifest`);
    }

    if (pkg.licenseSha256) {
      const license = extractTarballFile(archive.path, "LICENSE");
      const licenseHash = sha256(license);
      if (licenseHash !== pkg.licenseSha256) {
        throw new Error(`${pkg.name}: LICENSE SHA-256 mismatch (expected ${pkg.licenseSha256}, got ${licenseHash})`);
      }
    }

    packages.push({
      name: pkg.name,
      version: pkg.version,
      license: pkg.license,
      repository: repositoryValue(packageJson.repository),
      upstream_commit: packageJson.commit || null,
      tarball_url: packageTarballUrl(manifest, pkg),
      integrity: pkg.integrity,
      license_sha256: pkg.licenseSha256,
    });

    for (const entry of pkg.exports) {
      let bytes = extractTarballFile(archive.path, entry.packagePath);
      const sourceHash = sha256(bytes);
      if (sourceHash !== entry.sourceSha256) {
        throw new Error(`${pkg.name}/${entry.packagePath}: source SHA-256 mismatch (expected ${entry.sourceSha256}, got ${sourceHash})`);
      }
      for (const patch of entry.patches || []) bytes = applyPatch(bytes, patch);
      const outputHash = sha256(bytes);
      if (outputHash !== entry.sha256) {
        throw new Error(`${entry.outputFile}: output SHA-256 mismatch (expected ${entry.sha256}, got ${outputHash})`);
      }
      const outputFile = `${manifest.outputDir}/${entry.outputFile}`;
      pendingWrites.push({ path: resolve(PROJECT_DIR, outputFile), bytes });
      outputs.push({
        package_name: pkg.name,
        package_version: pkg.version,
        package_path: entry.packagePath,
        output_file: outputFile,
        source_sha256: sourceHash,
        patches: entry.patches || [],
        sha256: outputHash,
        size_bytes: bytes.byteLength,
      });
    }
  }

  for (const output of pendingWrites) {
    mkdirSync(dirname(output.path), { recursive: true });
    writeFileSync(output.path, output.bytes);
  }
  const metadata = {
    manifest_id: manifest.id,
    registry: manifest.registry,
    generator: "scripts/vendor-xterm.ts",
    packages,
    output_file: outputs[0]?.output_file ?? null,
    output_files: outputs,
    metadata_file: manifest.metadataFile,
    sha256: outputs[0]?.sha256 ?? null,
    size_bytes: outputs[0]?.size_bytes ?? null,
  };
  writeFileSync(resolve(PROJECT_DIR, manifest.metadataFile), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const manifest = loadManifest();
  validateManifest(manifest);
  if (args.includes("--check")) {
    checkVendoredFiles(manifest);
    console.log(`${LOG_PREFIX} verified ${manifest.packages.length} packages and ${manifest.packages.flatMap((pkg) => pkg.exports).length} files`);
    return;
  }
  if (args.length) throw new Error(`Unknown arguments: ${args.join(" ")}`);
  await updateVendoredFiles(manifest);
  checkVendoredFiles(manifest);
  console.log(`${LOG_PREFIX} refreshed ${manifest.packages.length} packages and ${manifest.packages.flatMap((pkg) => pkg.exports).length} files`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
