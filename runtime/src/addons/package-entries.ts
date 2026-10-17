import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export type AddonPackageManifest = {
  name?: string;
  pi?: Record<string, unknown>;
};

export interface InstalledAddonPackage {
  packageDir: string;
  manifest: AddonPackageManifest;
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

/** List installed scoped and unscoped add-on package roots in directory order. */
export function listInstalledAddonPackageDirs(addonsNodeModulesDir: string): string[] {
  if (!existsSync(addonsNodeModulesDir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(addonsNodeModulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const entryPath = join(addonsNodeModulesDir, entry.name);
    if (!existsSync(entryPath)) continue;
    if (entry.name.startsWith("@")) {
      try {
        for (const scoped of readdirSync(entryPath, { withFileTypes: true })) {
          if (!scoped.isDirectory() && !scoped.isSymbolicLink()) continue;
          const scopedPath = join(entryPath, scoped.name);
          if (existsSync(scopedPath)) results.push(scopedPath);
        }
      } catch {
        continue;
      }
      continue;
    }
    results.push(entryPath);
  }
  return results.sort();
}

/** Shared installed extension discovery for session and application lifetimes. */
export function getInstalledAddonExtensionPaths(workspaceDir: string): string[] {
  const paths: string[] = [];
  for (const packageDir of listInstalledAddonPackageDirs(join(workspaceDir, ".pi", "extensions", "node_modules"))) {
    const addon = readInstalledAddonPackage(packageDir);
    if (addon) paths.push(...resolveAddonPackageEntries(packageDir, addon.manifest.pi?.extensions));
  }
  return paths;
}

/** Read one installed package manifest, or null when absent/malformed. */
export function readInstalledAddonPackage(packageDir: string): InstalledAddonPackage | null {
  const packageJsonPath = join(packageDir, "package.json");
  if (!existsSync(packageJsonPath)) return null;
  try {
    const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as AddonPackageManifest;
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return null;
    return { packageDir, manifest };
  } catch {
    return null;
  }
}

/**
 * Resolve declared package files using lexical and realpath containment.
 * Declaration order and duplicates are preserved.
 */
export function resolveAddonPackageEntries(packageDir: string, declared: unknown): string[] {
  if (!Array.isArray(declared)) return [];

  let realPackageDir: string;
  try {
    realPackageDir = realpathSync(packageDir);
  } catch {
    return [];
  }

  const entries: string[] = [];
  for (const value of declared) {
    if (typeof value !== "string") continue;
    const relativePath = value.trim();
    if (!relativePath || isAbsolute(relativePath)) continue;

    const fullPath = resolve(packageDir, relativePath);
    if (!isInside(resolve(packageDir), fullPath)) continue;
    try {
      if (!statSync(fullPath).isFile()) continue;
      const realEntryPath = realpathSync(fullPath);
      if (!isInside(realPackageDir, realEntryPath)) continue;
      entries.push(fullPath);
    } catch {
      continue;
    }
  }
  return entries;
}
