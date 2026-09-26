import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

/** Seed release-pinned add-ons only before a workspace has ever been started. */
export function seedFreshWorkspaceCoreAddons(workspaceDir: string, storeDir: string, skelDir: string): boolean {
  const source = join(skelDir, ".piclaw", "core-addons", "defaults");
  const target = join(workspaceDir, ".pi", "extensions");
  if (!existsSync(source) || existsSync(target) || existsSync(join(storeDir, "messages.db"))) return false;
  const manifest = JSON.parse(readFileSync(join(source, "core-addons.lock.json"), "utf8")) as {
    schemaVersion: number;
    addons: Array<{ name: string; version: string }>;
  };
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.addons) || !manifest.addons.length) throw new Error("Invalid bundled core add-ons");
  for (const addon of manifest.addons) {
    if (!/^@rcarmo\/piclaw-addon-[a-z0-9-]+$/.test(addon.name) || !/^\d+\.\d+\.\d+$/.test(addon.version)) throw new Error("Invalid bundled core add-on entry");
    const installed = JSON.parse(readFileSync(join(source, "node_modules", addon.name, "package.json"), "utf8")) as { name?: string; version?: string };
    if (installed.name !== addon.name || installed.version !== addon.version) throw new Error(`Bundled core add-on mismatch: ${addon.name}`);
  }
  const staging = `${target}.seed-${process.pid}`;
  mkdirSync(dirname(target), { recursive: true });
  try {
    rmSync(staging, { recursive: true, force: true });
    cpSync(source, staging, { recursive: true });
    if (existsSync(target)) return false;
    renameSync(staging, target);
    return true;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
