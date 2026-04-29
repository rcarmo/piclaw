import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { WORKSPACE_DIR } from "../../../core/config.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("web.addon-config-api");

type AddonPackageManifest = {
  pi?: {
    extensions?: string[];
  };
};

export type AddonConfigApiHandler = (payload: unknown, req: Request) => unknown | Promise<unknown>;

export interface AddonConfigApiRegistration {
  get?: AddonConfigApiHandler;
  set?: AddonConfigApiHandler;
}

interface RegisteredAddonConfigApi {
  addonId: string;
  action: string;
  handlers: AddonConfigApiRegistration;
  extensionPath: string;
  registeredAt: string;
}

type RuntimeGlobal = typeof globalThis & {
  __piclaw_registerAddonConfigApi?: (
    addonId: string,
    action: string,
    handlers: AddonConfigApiRegistration,
    extensionPath?: string,
  ) => "created" | "updated";
};

const registrations = new Map<string, RegisteredAddonConfigApi>();
let registryInstalled = false;
let addonConfigLoadPromise: Promise<void> | null = null;

function getWorkspaceDir(): string {
  return process.env.PICLAW_WORKSPACE || WORKSPACE_DIR;
}

function listAddonPackageDirs(addonsNodeModulesDir: string): string[] {
  if (!existsSync(addonsNodeModulesDir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(addonsNodeModulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const entryPath = join(addonsNodeModulesDir, entry.name);
    if (entry.name.startsWith("@")) {
      for (const scoped of readdirSync(entryPath, { withFileTypes: true })) {
        if (scoped.isDirectory()) results.push(join(entryPath, scoped.name));
      }
      continue;
    }
    results.push(entryPath);
  }
  return results;
}

export function getInstalledAddonConfigEntryPaths(workspaceDir = getWorkspaceDir()): string[] {
  const addonsNodeModulesDir = join(workspaceDir, ".pi", "extensions", "node_modules");
  const entryPaths: string[] = [];

  for (const packageDir of listAddonPackageDirs(addonsNodeModulesDir)) {
    const packageJsonPath = join(packageDir, "package.json");
    if (!existsSync(packageJsonPath)) continue;

    try {
      const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as AddonPackageManifest;
      const declared = Array.isArray(manifest?.pi?.extensions)
        ? manifest.pi.extensions.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
        : [];
      for (const relativePath of declared) {
        const fullPath = join(packageDir, relativePath);
        if (existsSync(fullPath) && statSync(fullPath).isFile()) entryPaths.push(fullPath);
      }
    } catch {
      continue;
    }
  }

  return entryPaths;
}

function registrationKey(addonId: string, action: string): string {
  return `${addonId}::${action}`;
}

export function registerAddonConfigApi(
  addonId: string,
  action: string,
  handlers: AddonConfigApiRegistration,
  extensionPath = "unknown",
): "created" | "updated" {
  const normalizedAddonId = String(addonId || "").trim();
  const normalizedAction = String(action || "").trim();
  if (!normalizedAddonId || !normalizedAction) {
    throw new Error("Addon config API registration requires a non-empty addonId and action.");
  }
  if (!handlers || (typeof handlers.get !== "function" && typeof handlers.set !== "function")) {
    throw new Error(`Addon config API ${normalizedAddonId}/${normalizedAction} must register at least one GET or SET handler.`);
  }

  const key = registrationKey(normalizedAddonId, normalizedAction);
  const existing = registrations.get(key);
  const registeredAt = new Date().toISOString();
  const entry: RegisteredAddonConfigApi = {
    addonId: normalizedAddonId,
    action: normalizedAction,
    handlers: {
      ...(typeof handlers.get === "function" ? { get: handlers.get } : {}),
      ...(typeof handlers.set === "function" ? { set: handlers.set } : {}),
    },
    extensionPath,
    registeredAt,
  };
  registrations.set(key, entry);

  if (existing) {
    log.info("Updated addon config API registration", {
      operation: "web_addon_config_api.register_updated",
      addonId: normalizedAddonId,
      action: normalizedAction,
      previousExtensionPath: existing.extensionPath,
      extensionPath,
    });
    return "updated";
  }

  log.info("Registered addon config API", {
    operation: "web_addon_config_api.register_created",
    addonId: normalizedAddonId,
    action: normalizedAction,
    extensionPath,
  });
  return "created";
}

export function installAddonConfigApiRegistry(): void {
  if (registryInstalled) return;
  const runtimeGlobal = globalThis as RuntimeGlobal;
  runtimeGlobal.__piclaw_registerAddonConfigApi = registerAddonConfigApi;
  registryInstalled = true;
}

export async function ensureAddonConfigApisLoaded(): Promise<void> {
  installAddonConfigApiRegistry();
  if (addonConfigLoadPromise) return addonConfigLoadPromise;

  const entryPaths = getInstalledAddonConfigEntryPaths();
  addonConfigLoadPromise = (async () => {
    for (const entryPath of entryPaths) {
      await import(pathToFileURL(entryPath).href);
    }
  })().catch((error) => {
    addonConfigLoadPromise = null;
    throw error;
  });

  await addonConfigLoadPromise;
}

export async function handleRegisteredAddonConfigApiRequest(
  req: Request,
  addonId: string,
  action: string,
  json: (body: unknown, status?: number) => Response,
): Promise<Response | null> {
  const key = registrationKey(String(addonId || "").trim(), String(action || "").trim());
  let entry = registrations.get(key);
  if (!entry) {
    await ensureAddonConfigApisLoaded();
    entry = registrations.get(key);
  }
  if (!entry) return null;

  try {
    if (req.method === "GET") {
      if (typeof entry.handlers.get !== "function") return json({ error: "Method not allowed" }, 405);
      return json(await entry.handlers.get(undefined, req));
    }

    if (req.method === "POST") {
      if (typeof entry.handlers.set !== "function") return json({ error: "Method not allowed" }, 405);
      const body = await req.json().catch(() => ({}));
      return json(await entry.handlers.set(body, req));
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (error) {
    log.error("Addon config API handler failed", {
      operation: "web_addon_config_api.handle_error",
      addonId: entry.addonId,
      action: entry.action,
      extensionPath: entry.extensionPath,
      err: error,
    });
    return json({ error: String((error as Error)?.message || error) }, 500);
  }
}

export function getRegisteredAddonConfigApis(): Array<{ addonId: string; action: string; extensionPath: string; registeredAt: string }> {
  return [...registrations.values()].map((entry) => ({
    addonId: entry.addonId,
    action: entry.action,
    extensionPath: entry.extensionPath,
    registeredAt: entry.registeredAt,
  }));
}

export function resetAddonConfigApiRegistryForTests(): void {
  registrations.clear();
  addonConfigLoadPromise = null;
  registryInstalled = false;
  const runtimeGlobal = globalThis as RuntimeGlobal;
  delete runtimeGlobal.__piclaw_registerAddonConfigApi;
}

installAddonConfigApiRegistry();
