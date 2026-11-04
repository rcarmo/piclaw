import { withExtensionKvAuthority, type ExtensionKvAuthority } from "../../../extension-kv-registry.js";
import { AddonLocalContextError, addonLocalContextApi, withAddonLocalRequest, type AddonLocalContext } from "../../../addons/local-context.js";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { getWorkspaceDir as getConfiguredWorkspaceDir } from "../../../core/config.js";
import { createLogger } from "../../../utils/logger.js";
import {
  listInstalledAddonPackageDirs,
  readInstalledAddonPackage,
  resolveAddonPackageEntries,
} from "../../../addons/package-entries.js";

const log = createLogger("web.addon-config-api");

export type AddonConfigApiHandler = (payload: unknown, req: Request, context?: AddonLocalContext | null) => unknown | Promise<unknown>;

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

type AdminGrantFactory = (addonId: string, chatJid: string, request: Request) => ExtensionKvAuthority;
let adminGrantFactory: AdminGrantFactory | undefined;
/** Application-owner registration; disposer cannot revoke a newer owner. */
export function registerAddonConfigKvAuthority(factory: AdminGrantFactory): () => void {
  if (adminGrantFactory) throw Error("Addon configuration owner already registered");
  adminGrantFactory = factory;
  return () => { if (adminGrantFactory === factory) adminGrantFactory = undefined; };
}
async function invokeConfig(handler: AddonConfigApiHandler, payload: unknown, req: Request, context: AddonLocalContext | null, addonId: string) {
  if (!adminGrantFactory) return handler(payload, req, context);
  if (!context || context.kind !== "operator" || context.accessMode !== "single-user") throw Error("Authenticated configuration owner required");
  await context.listTargets();
  const queryChat = new URL(req.url).searchParams.get("chat_jid");
  const bodyChat = payload && typeof payload === "object" && "chat_jid" in payload ? (payload as { chat_jid?: unknown }).chat_jid : undefined;
  if (bodyChat !== undefined && typeof bodyChat !== "string") throw Error("Invalid configuration chat");
  if (queryChat && bodyChat && queryChat !== bodyChat) throw Error("Conflicting configuration chat");
  const requestedChat = queryChat || bodyChat || context.chatJid;
  const target = requestedChat ? await context.resolveTarget({ chatJid: requestedChat }) : undefined;
  const grant = adminGrantFactory(addonId, target?.chatJid ?? "", req);
  let active = true;
  const assertCurrent = () => { if (!active || !addonLocalContextApi.getRequestContext(req)) throw Error("Configuration request expired"); grant.assertCurrent(); };
  try { return await withExtensionKvAuthority({ ...grant, globalWrite: req.method === "POST" && grant.globalWrite === true, assertCurrent, write: body => grant.write(() => { assertCurrent(); const result = body(); assertCurrent(); return result; }) }, () => handler(payload, req, context)); }
  finally { active = false; }
}

const registrations = new Map<string, RegisteredAddonConfigApi>();
let registryInstalled = false;
let addonConfigLoadPromise: Promise<void> | null = null;

function getWorkspaceDir(): string {
  return getConfiguredWorkspaceDir();
}

export function getInstalledAddonConfigEntryPaths(workspaceDir = getWorkspaceDir()): string[] {
  const addonsNodeModulesDir = join(workspaceDir, ".pi", "extensions", "node_modules");
  const entryPaths: string[] = [];
  for (const packageDir of listInstalledAddonPackageDirs(addonsNodeModulesDir)) {
    const addonPackage = readInstalledAddonPackage(packageDir);
    if (!addonPackage) continue;
    entryPaths.push(...resolveAddonPackageEntries(packageDir, addonPackage.manifest.pi?.extensions));
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

/** Native owner handle; stale cleanup cannot remove a replacement registration. */
export function registerOwnedAddonConfigApi(
  addonId: string, action: string, handlers: AddonConfigApiRegistration, extensionPath: string,
): Readonly<{ assertCurrent(): void; dispose(): void }> {
  registerAddonConfigApi(addonId, action, handlers, extensionPath);
  const key = registrationKey(addonId.trim(), action.trim());
  const entry = registrations.get(key)!;
  let disposed = false;
  return Object.freeze({
    assertCurrent() {
      if (disposed || registrations.get(key) !== entry) throw Error("Stale addon configuration binding");
    },
    dispose() {
      if (!disposed) {
        disposed = true;
        if (registrations.get(key) === entry) registrations.delete(key);
      }
    },
  });
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
      const handler = entry.handlers.get;
      return await withAddonLocalRequest(req, async (context) => json(await invokeConfig(handler, undefined, req, context, entry!.addonId)));
    }

    if (req.method === "POST") {
      if (typeof entry.handlers.set !== "function") return json({ error: "Method not allowed" }, 405);
      const body = await req.json().catch(() => ({}));
      const handler = entry.handlers.set;
      return await withAddonLocalRequest(req, async (context) => json(await invokeConfig(handler, body, req, context, entry!.addonId)));
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
    if (error instanceof AddonLocalContextError) {
      return json({ error: error.message, code: error.code, delivery: error.delivery }, error.delivery === 'unknown' ? 502 : 409);
    }
    return json({ error: String((error as Error)?.message || error) }, 500);
  }
}

export function resetAddonConfigApiRegistryForTests(): void {
  registrations.clear();
  addonConfigLoadPromise = null;
  registryInstalled = false;
  const runtimeGlobal = globalThis as RuntimeGlobal;
  delete runtimeGlobal.__piclaw_registerAddonConfigApi;
}

installAddonConfigApiRegistry();
