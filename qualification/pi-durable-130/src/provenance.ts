import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const base = resolve(import.meta.dir, "..");
const manifestPath = join(base, "provenance.json");
const engine = resolve(base, "../../runtime/durable-engine");
const names = ["chord", "pi-ai", "pi-codemode", "pi-durable", "pi-telemetry"];
type PackageEvidence = { name: string; version: string; tarball: string; sha1: string; integrity: string; files: Record<string, string> };
type Evidence = { registry: string; recordedAt: string; packages: PackageEvidence[] };
const digest = (bytes: Uint8Array, algorithm = "sha256", encoding: "hex" | "base64" = "hex") => createHash(algorithm).update(bytes).digest(encoding);
async function filesAt(dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function walk(relative: string) {
    for (const entry of await readdir(join(dir, relative), { withFileTypes: true })) {
      // Nested dependency installations are not published package payload.
      if (entry.name === "node_modules") continue;
      const path = join(relative, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files[path] = digest(await readFile(join(dir, path)));
      else throw new Error(`Unexpected non-file package entry: ${path}`);
    }
  }
  await walk("");
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}
function equal(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Provenance mismatch: ${label}`);
}
export async function verifyProvenance() {
  const evidence: Evidence = await Bun.file(manifestPath).json();
  const lock = Bun.JSON5.parse(await Bun.file(join(engine, "bun.lock")).text()) as { packages: Record<string, unknown[]> };
  equal(evidence.packages.map(p => p.name), names.map(n => `@earendil-works/${n}`), "package closure");
  for (const pkg of evidence.packages) {
    equal(pkg.version, "1.3.0", pkg.name);
    equal(lock.packages[pkg.name]?.at(-1), pkg.integrity, `${pkg.name} lock integrity`);
    equal(await filesAt(join(engine, "node_modules", pkg.name)), pkg.files, `${pkg.name} installed bytes`);
  }
  return evidence;
}

// Explicit acquisition only; never called by normal tests. No subprocess inherits credentials.
if (import.meta.main) {
  if (process.argv[2] !== "--record") throw new Error("Use --record for explicit registry acquisition");
  const scratch = await mkdtemp(join(tmpdir(), "pi-130-provenance-"));
  try {
    const evidence: Evidence = { registry: "https://registry.npmjs.org", recordedAt: new Date().toISOString(), packages: [] };
    for (const name of names) {
      const fullName = `@earendil-works/${name}`;
      const response = await fetch(`${evidence.registry}/${fullName}/1.3.0`);
      if (!response.ok) throw new Error(`Registry metadata HTTP ${response.status}`);
      const metadata = await response.json() as { name: string; version: string; dist: { tarball: string; shasum: string; integrity: string } };
      equal(metadata.name, fullName, "registry name"); equal(metadata.version, "1.3.0", "registry version");
      if (!metadata.dist.tarball.startsWith(`${evidence.registry}/`)) throw new Error("Non-registry tarball");
      const archiveResponse = await fetch(metadata.dist.tarball);
      if (!archiveResponse.ok) throw new Error(`Registry archive HTTP ${archiveResponse.status}`);
      const archive = new Uint8Array(await archiveResponse.arrayBuffer());
      equal(digest(archive, "sha1"), metadata.dist.shasum, `${name} archive SHA1`);
      equal(`sha512-${digest(archive, "sha512", "base64")}`, metadata.dist.integrity, `${name} archive SHA512`);
      const archivePath = join(scratch, "candidate.tgz");
      await Bun.write(archivePath, archive);
      const child = Bun.spawn(["tar", "-xzf", archivePath, "-C", scratch], { env: { PATH: "/usr/bin:/bin" }, stdout: "ignore", stderr: "pipe" });
      if (await child.exited !== 0) throw new Error("Registry archive extraction failed");
      const files = await filesAt(join(scratch, "package"));
      equal(await filesAt(join(engine, "node_modules", fullName)), files, `${name} extracted vs installed all files`);
      evidence.packages.push({ name: fullName, version: metadata.version, tarball: metadata.dist.tarball, sha1: metadata.dist.shasum, integrity: metadata.dist.integrity, files });
      await rm(join(scratch, "package"), { recursive: true });
      console.log(`${fullName}@1.3.0: verified ${Object.keys(files).length} files; SHA1 ${metadata.dist.shasum}; ${metadata.dist.integrity}`);
    }
    await Bun.write(manifestPath, JSON.stringify(evidence, null, 2) + "\n");
    await verifyProvenance();
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
