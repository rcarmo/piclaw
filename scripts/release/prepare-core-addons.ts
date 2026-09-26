#!/usr/bin/env bun
/** Build the pinned, offline first-workspace add-on seed included by `bun pm pack`. */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const lockPath = join(root, "release/core-addons.lock.json");
const bunLockPath = join(root, "release/core-addons/bun.lock");
const tarballsDir = join(root, "release/core-addons/tarballs");
const catalogPath = join(root, "release/core-addons/catalog.json");
export const seedDir = join(root, "skel/.piclaw/core-addons/defaults");
const catalogHost = "rcarmo.github.io";

export type Pin = { slug: string; name: string; version: string; url: string; sha256: string };
type Lock = { schemaVersion: number; catalog: string; catalogSha256: string; addons: Pin[] };
type CatalogEntry = { slug: string; name: string; version: string; tags: string[]; install: { kind: string; spec: string } };

export function coreCatalogEntries(catalog: { addons?: CatalogEntry[] }): CatalogEntry[] {
  if (!Array.isArray(catalog.addons)) throw new Error("Invalid add-on catalog");
  const entries = catalog.addons.filter((entry) => Array.isArray(entry.tags) && entry.tags.includes("core"));
  if (!entries.length) throw new Error("Add-on catalog has no core entries");
  return entries.sort((a, b) => a.slug.localeCompare(b.slug));
}

export function readCoreAddonLock(path = lockPath): Lock {
  const lock = JSON.parse(readFileSync(path, "utf8")) as Lock;
  if (lock.schemaVersion !== 1 || !Array.isArray(lock.addons) || lock.addons.length === 0 || !/^https:\/\//.test(lock.catalog) || !/^[a-f0-9]{64}$/.test(lock.catalogSha256)) throw new Error("Invalid core add-on lock");
  const catalogBytes = readFileSync(catalogPath);
  if (sha256(catalogBytes) !== lock.catalogSha256) throw new Error("Catalog snapshot checksum mismatch");
  const entries = coreCatalogEntries(JSON.parse(catalogBytes.toString("utf8")));
  if (entries.length !== lock.addons.length) throw new Error("Core add-on lock does not match catalog tags");
  const slugs = new Set<string>();
  const names = new Set<string>();
  for (const pin of lock.addons) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pin.slug) || slugs.has(pin.slug)) throw new Error(`Invalid or duplicate core add-on slug: ${pin.slug}`);
    if (pin.name !== `@rcarmo/piclaw-addon-${pin.slug}` || names.has(pin.name)) throw new Error(`Invalid or duplicate core add-on name: ${pin.name}`);
    if (!/^\d+\.\d+\.\d+$/.test(pin.version) || !/^[a-f0-9]{64}$/.test(pin.sha256)) throw new Error(`Invalid core add-on version or checksum: ${pin.slug}`);
    const url = new URL(pin.url);
    if (url.protocol !== "https:" || url.hostname !== catalogHost || url.pathname !== `/piclaw-addons/packages/piclaw-addon-${pin.slug}-${pin.version}.tgz` || url.search || url.hash) {
      throw new Error(`Invalid core add-on tarball URL: ${pin.slug}`);
    }
    const entry = entries.find((item) => item.slug === pin.slug);
    if (!entry || entry.name !== pin.name || entry.version !== pin.version || entry.install?.kind !== "tarball" || entry.install.spec !== pin.url) {
      throw new Error(`Core add-on lock does not match catalog: ${pin.slug}`);
    }
    slugs.add(pin.slug);
    names.add(pin.name);
  }
  return lock;
}

function run(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function validateInstalledCoreAddons(dir: string, pins: Pin[]): void {
  for (const pin of pins) {
    const manifestPath = join(dir, "node_modules", pin.name, "package.json");
    if (!existsSync(manifestPath)) throw new Error(`Missing installed core add-on: ${pin.name}`);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: string; version?: string };
    if (manifest.name !== pin.name || manifest.version !== pin.version) throw new Error(`Wrong installed core add-on version: ${pin.name}`);
  }
}

export async function prepareCoreAddons(options: { outputDir?: string; tarballsDir?: string; install?: (cwd: string) => void } = {}): Promise<void> {
  const pins = readCoreAddonLock().addons;
  const outputDir = options.outputDir ?? seedDir;
  const archives = options.tarballsDir ?? tarballsDir;
  const staging = mkdtempSync(join(tmpdir(), "piclaw-core-addons-"));
  const tempOutput = `${outputDir}.staging-${process.pid}`;
  try {
    for (const pin of pins) {
      const archive = readFileSync(join(archives, `${pin.slug}.tgz`));
      if (sha256(archive) !== pin.sha256) throw new Error(`Checksum mismatch for ${pin.name}`);
      writeFileSync(join(staging, `${pin.slug}.tgz`), archive);
    }
    cpSync(bunLockPath, join(staging, "bun.lock"));
    writeFileSync(join(staging, "package.json"), JSON.stringify({
      name: "piclaw-default-addons", private: true,
      dependencies: Object.fromEntries(pins.map((pin) => [pin.name, `file:${pin.slug}.tgz`])),
    }, null, 2) + "\n");
    (options.install ?? ((cwd) => run("bun", ["install", "--production", "--frozen-lockfile", "--omit=peer", "--ignore-scripts"], cwd)))(staging);
    validateInstalledCoreAddons(staging, pins);
    mkdirSync(dirname(outputDir), { recursive: true });
    rmSync(tempOutput, { recursive: true, force: true });
    mkdirSync(tempOutput);
    cpSync(join(staging, "node_modules"), join(tempOutput, "node_modules"), { recursive: true });
    writeFileSync(join(tempOutput, "package.json"), JSON.stringify({
      name: "piclaw-local-addons", private: true,
      dependencies: Object.fromEntries(pins.map((pin) => [pin.name, pin.url])),
    }, null, 2) + "\n");
    writeFileSync(join(tempOutput, "core-addons.lock.json"), readFileSync(lockPath));
    rmSync(outputDir, { recursive: true, force: true });
    renameSync(tempOutput, outputDir);
    console.log(`[core-addons] prepared ${pins.length} pinned defaults`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
    rmSync(tempOutput, { recursive: true, force: true });
  }
}

if (import.meta.main) prepareCoreAddons().catch((error) => { console.error(error); process.exitCode = 1; });
