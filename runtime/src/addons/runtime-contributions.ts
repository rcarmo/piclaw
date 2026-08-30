import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { getDataDir, getWorkspaceDir as getConfiguredWorkspaceDir } from "../core/config.js";
import { createMedia, getMediaById } from "../db/media.js";
import { postMessagesToolMessage } from "../extensions/messages-crud.js";
import type { RuntimeAgentMessageRequest, RuntimeAgentMessageResult } from "../channels/web/core/web-channel-runtime-public-surface-service.js";
import {
  registerChatTransport,
  type ChatTransport,
} from "../extensions/chat-transport-registry.js";
import { resetRuntimeStreamSessionsForTests, runtimeStreamSessions } from "./runtime-stream-sessions.js";
import {
  freezeExternalAddonRoutes,
  registerExternalAddonRoute,
  resetExternalAddonRoutesForTests,
  withExternalAddonRegistrationContext,
  type ExternalAddonRouteRegistration,
} from "./external-routes.js";

export interface AddonStatusPanelProvider {
  key: string;
  getPayload: (chatJid: string) => Promise<unknown> | unknown;
  runAction?: (action: string, payload: Record<string, unknown>) => Promise<unknown> | unknown;
}

export interface AddonAdaptiveCardIntentContext {
  chatJid: string;
  threadId?: string | null;
  sourcePostId?: number | null;
  rawSubmissionData: Record<string, unknown>;
  sendMessage: (content: string, options?: { threadId?: string | null }) => Promise<void>;
}

export type AddonAdaptiveCardIntentHandler = (context: AddonAdaptiveCardIntentContext) => Promise<void> | void;

export type AddonAgentMessageEnqueuer = (request: RuntimeAgentMessageRequest) => Promise<RuntimeAgentMessageResult>;

export type AddonMessagingTargetInput = {
  target_chat_jid?: string;
  target_agent_name?: string;
};

export type AddonMessagingTargetResolution =
  | { status: "resolved"; target_agent_name: string; active: boolean }
  | { status: "not_found" }
  | { status: "ambiguous"; candidates: Array<{ target_agent_name: string }> };

export interface AddonAdvertisableAgent {
  agent_name: string;
  active: boolean;
}

export interface AddonAuthenticatedPeerSource {
  peer_instance_id: string;
  peer_fingerprint: string;
  peer_alias?: string;
  agent_name?: string;
  agent_display_name?: string;
  reply_address?: string;
  message_id: string;
  in_reply_to?: string;
}

export interface AddonPeerMessageAttachment {
  filename: string;
  content_type: string;
  size: number;
  sha256: string;
  data: Uint8Array;
}

export interface AddonPeerMessageDeliveryRequest extends AddonMessagingTargetInput {
  content: string;
  attachments?: AddonPeerMessageAttachment[];
  mode?: "auto" | "queue" | "steer";
  thread_id?: number | null;
  source: AddonAuthenticatedPeerSource;
}

export interface AddonMessagingRuntimeHandlers {
  listAdvertisableAgents(): Promise<AddonAdvertisableAgent[]> | AddonAdvertisableAgent[];
  resolveLocalTarget(input: AddonMessagingTargetInput): Promise<AddonMessagingTargetResolution> | AddonMessagingTargetResolution;
  deliverPeerMessage(input: AddonPeerMessageDeliveryRequest): Promise<RuntimeAgentMessageResult>;
}

export interface PiclawRuntimeMessagingApiV1 {
  version: 1;
  registerChatTransport(transport: ChatTransport): () => void;
  listAdvertisableAgents(): Promise<AddonAdvertisableAgent[]>;
  resolveLocalTarget(input: AddonMessagingTargetInput): Promise<AddonMessagingTargetResolution>;
  deliverPeerMessage(input: AddonPeerMessageDeliveryRequest): Promise<RuntimeAgentMessageResult>;
  getAddonDataDir(addonId: string): string;
}

export interface PiclawRuntimeExternalRoutesApiV1 {
  version: 1;
  register(registration: ExternalAddonRouteRegistration): () => void;
}

export interface PiclawRuntimeAddonApi {
  registerStatusPanelProvider: (provider: AddonStatusPanelProvider) => () => void;
  registerAdaptiveCardIntentHandler: (intent: string, handler: AddonAdaptiveCardIntentHandler) => () => void;
  enqueueAgentMessage: AddonAgentMessageEnqueuer;
  messaging: PiclawRuntimeMessagingApiV1;
  externalRoutes: PiclawRuntimeExternalRoutesApiV1;
  createMedia: typeof createMedia;
  getMediaById: typeof getMediaById;
  postMessage: typeof postMessagesToolMessage;
  streamSessions: typeof runtimeStreamSessions;
}

type AddonPackageManifest = {
  name?: string;
  pi?: {
    runtime?: {
      entries?: string[];
      load?: "lazy" | "startup";
    };
  };
};

type RuntimeGlobal = typeof globalThis & {
  __piclaw_runtime?: PiclawRuntimeAddonApi;
  __piclaw_autoresearch_runtime_registered__?: boolean;
};

const statusPanelProviders = new Map<string, AddonStatusPanelProvider>();
const adaptiveCardIntentHandlers = new Map<string, AddonAdaptiveCardIntentHandler>();
const addonChatTransportUnregisters = new Set<() => void>();
let runtimeApiInstalled = false;
let lazyRuntimeEntriesLoadPromise: Promise<void> | null = null;
let startupRuntimeEntriesLoadPromise: Promise<void> | null = null;
let agentMessageEnqueuer: AddonAgentMessageEnqueuer | null = null;
let messagingRuntimeHandlers: AddonMessagingRuntimeHandlers | null = null;

function getWorkspaceDir(): string {
  return getConfiguredWorkspaceDir();
}

function listAddonPackageDirs(addonsNodeModulesDir: string): string[] {
  if (!existsSync(addonsNodeModulesDir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(addonsNodeModulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const entryPath = join(addonsNodeModulesDir, entry.name);
    if (entry.name.startsWith("@")) {
      for (const scoped of readdirSync(entryPath, { withFileTypes: true })) {
        if (scoped.isDirectory() || scoped.isSymbolicLink()) results.push(join(entryPath, scoped.name));
      }
      continue;
    }
    results.push(entryPath);
  }
  return results;
}

export type AddonRuntimeEntryLoad = "lazy" | "startup";

export interface InstalledAddonRuntimeEntry {
  packageName: string;
  path: string;
  load: AddonRuntimeEntryLoad;
}

export function getInstalledAddonRuntimeEntries(workspaceDir = getWorkspaceDir()): InstalledAddonRuntimeEntry[] {
  const addonsNodeModulesDir = join(workspaceDir, ".pi", "extensions", "node_modules");
  const runtimeEntries: InstalledAddonRuntimeEntry[] = [];

  for (const packageDir of listAddonPackageDirs(addonsNodeModulesDir)) {
    const packageJsonPath = join(packageDir, "package.json");
    if (!existsSync(packageJsonPath)) continue;

    try {
      const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as AddonPackageManifest;
      const declared = Array.isArray(manifest?.pi?.runtime?.entries)
        ? manifest.pi.runtime.entries.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
        : [];
      const load: AddonRuntimeEntryLoad = manifest?.pi?.runtime?.load === "startup" ? "startup" : "lazy";
      const realPackageDir = realpathSync(packageDir);
      for (const relativePath of declared) {
        const fullPath = resolve(packageDir, relativePath);
        if (fullPath !== packageDir && !fullPath.startsWith(`${packageDir}${sep}`)) continue;
        if (!existsSync(fullPath) || !statSync(fullPath).isFile()) continue;
        const realEntryPath = realpathSync(fullPath);
        if (realEntryPath !== realPackageDir && !realEntryPath.startsWith(`${realPackageDir}${sep}`)) continue;
        runtimeEntries.push({
            packageName: typeof manifest.name === "string" && manifest.name.trim() ? manifest.name.trim() : packageDir.split(/[\\/]/).pop() || "unknown",
            path: fullPath,
            load,
          });
      }
    } catch {
      continue;
    }
  }

  return runtimeEntries.sort((a, b) => a.path.localeCompare(b.path));
}

export function registerAddonStatusPanelProvider(provider: AddonStatusPanelProvider): () => void {
  if (!provider || typeof provider.key !== "string" || !provider.key.trim() || typeof provider.getPayload !== "function") {
    return () => {};
  }

  const normalizedKey = provider.key.trim();
  const normalizedProvider = { ...provider, key: normalizedKey };
  statusPanelProviders.set(normalizedKey, normalizedProvider);
  return () => {
    if (statusPanelProviders.get(normalizedKey) === normalizedProvider) {
      statusPanelProviders.delete(normalizedKey);
    }
  };
}

export function registerAddonAdaptiveCardIntentHandler(intent: string, handler: AddonAdaptiveCardIntentHandler): () => void {
  const normalizedIntent = typeof intent === "string" ? intent.trim() : "";
  if (!normalizedIntent || typeof handler !== "function") return () => {};
  adaptiveCardIntentHandlers.set(normalizedIntent, handler);
  return () => {
    if (adaptiveCardIntentHandlers.get(normalizedIntent) === handler) {
      adaptiveCardIntentHandlers.delete(normalizedIntent);
    }
  };
}

export function setAddonAgentMessageEnqueuer(enqueuer: AddonAgentMessageEnqueuer | null): void {
  agentMessageEnqueuer = enqueuer;
}

export function setAddonMessagingRuntimeHandlers(handlers: AddonMessagingRuntimeHandlers | null): void {
  messagingRuntimeHandlers = handlers;
}

function validateAddonId(addonId: string): string {
  const normalized = String(addonId || "").trim();
  if (!/^[a-z0-9](?:[a-z0-9._-]{0,63})$/.test(normalized)) {
    throw new Error("Add-on id must be 1-64 lowercase letters, digits, dots, underscores, or hyphens.");
  }
  return normalized;
}

function getAddonDataDir(addonId: string): string {
  const normalized = validateAddonId(addonId);
  const root = resolve(getDataDir(), "addons");
  const target = resolve(root, normalized);
  if (target !== join(root, normalized)) throw new Error("Invalid add-on data directory.");
  mkdirSync(root, { recursive: true });
  mkdirSync(target, { recursive: true });
  const realRoot = realpathSync(root);
  const realTarget = realpathSync(target);
  if (realTarget !== join(realRoot, normalized) || !realTarget.startsWith(`${realRoot}${sep}`)) {
    throw new Error("Add-on data directory escapes the runtime data root.");
  }
  return target;
}

function registerAddonChatTransport(transport: ChatTransport): () => void {
  if (transport?.kind !== "bang") {
    throw new Error("Installed add-ons may register only the one-hop bang chat transport.");
  }
  const unregisterTransport = registerChatTransport(transport);
  let active = true;
  const unregister = () => {
    if (!active) return;
    active = false;
    addonChatTransportUnregisters.delete(unregister);
    unregisterTransport();
  };
  addonChatTransportUnregisters.add(unregister);
  return unregister;
}

async function listAdvertisableAgents(): Promise<AddonAdvertisableAgent[]> {
  if (!messagingRuntimeHandlers) throw new Error("Piclaw runtime messaging API is not available yet.");
  return await messagingRuntimeHandlers.listAdvertisableAgents();
}

async function resolveLocalTarget(input: AddonMessagingTargetInput): Promise<AddonMessagingTargetResolution> {
  if (!messagingRuntimeHandlers) throw new Error("Piclaw runtime messaging API is not available yet.");
  return await messagingRuntimeHandlers.resolveLocalTarget(input);
}

async function deliverPeerMessage(input: AddonPeerMessageDeliveryRequest): Promise<RuntimeAgentMessageResult> {
  if (!messagingRuntimeHandlers) throw new Error("Piclaw runtime messaging API is not available yet.");
  return await messagingRuntimeHandlers.deliverPeerMessage(input);
}

async function enqueueAgentMessageViaRuntime(request: RuntimeAgentMessageRequest): Promise<RuntimeAgentMessageResult> {
  if (!agentMessageEnqueuer) throw new Error("Piclaw runtime agent-message enqueue API is not available yet.");
  return await agentMessageEnqueuer(request);
}

export function installAddonRuntimeApi(): PiclawRuntimeAddonApi {
  const runtimeGlobal = globalThis as RuntimeGlobal;
  if (runtimeApiInstalled && runtimeGlobal.__piclaw_runtime) {
    return runtimeGlobal.__piclaw_runtime;
  }

  const api: PiclawRuntimeAddonApi = {
    registerStatusPanelProvider: registerAddonStatusPanelProvider,
    registerAdaptiveCardIntentHandler: registerAddonAdaptiveCardIntentHandler,
    enqueueAgentMessage: enqueueAgentMessageViaRuntime,
    messaging: {
      version: 1,
      registerChatTransport: registerAddonChatTransport,
      listAdvertisableAgents,
      resolveLocalTarget,
      deliverPeerMessage,
      getAddonDataDir,
    },
    externalRoutes: {
      version: 1,
      register: registerExternalAddonRoute,
    },
    createMedia,
    getMediaById,
    postMessage: postMessagesToolMessage,
    streamSessions: runtimeStreamSessions,
  };

  runtimeGlobal.__piclaw_runtime = api;
  runtimeApiInstalled = true;
  return api;
}

export async function initializeStartupAddonRuntime(options: {
  agentMessageEnqueuer: AddonAgentMessageEnqueuer;
  messagingHandlers: AddonMessagingRuntimeHandlers;
}): Promise<void> {
  installAddonRuntimeApi();
  setAddonAgentMessageEnqueuer(options.agentMessageEnqueuer);
  setAddonMessagingRuntimeHandlers(options.messagingHandlers);
  await ensureStartupAddonRuntimeEntriesLoaded();
}

async function importAddonRuntimeEntries(entries: InstalledAddonRuntimeEntry[]): Promise<void> {
  for (const entry of entries) {
    if (entry.load === "startup") {
      await withExternalAddonRegistrationContext(
        { packageName: entry.packageName, entryPath: entry.path },
        async () => await import(pathToFileURL(entry.path).href),
      );
    } else {
      await import(pathToFileURL(entry.path).href);
    }
  }
}

/** Load legacy/default runtime entries only when an add-on surface first needs them. */
export async function ensureAddonRuntimeEntriesLoaded(): Promise<void> {
  installAddonRuntimeApi();
  if (lazyRuntimeEntriesLoadPromise) return lazyRuntimeEntriesLoadPromise;

  const entries = getInstalledAddonRuntimeEntries().filter((entry) => entry.load === "lazy");
  lazyRuntimeEntriesLoadPromise = importAddonRuntimeEntries(entries).catch((error) => {
    lazyRuntimeEntriesLoadPromise = null;
    throw error;
  });

  await lazyRuntimeEntriesLoadPromise;
}

/** Load entries that explicitly require startup transport/runtime registration. */
export async function ensureStartupAddonRuntimeEntriesLoaded(): Promise<void> {
  installAddonRuntimeApi();
  if (startupRuntimeEntriesLoadPromise) return startupRuntimeEntriesLoadPromise;

  const entries = getInstalledAddonRuntimeEntries().filter((entry) => entry.load === "startup");
  startupRuntimeEntriesLoadPromise = importAddonRuntimeEntries(entries).catch((error) => {
    startupRuntimeEntriesLoadPromise = null;
    throw error;
  });

  await startupRuntimeEntriesLoadPromise;
  freezeExternalAddonRoutes();
}

export async function getAddonStatusPanelPayload(key: string, chatJid: string): Promise<unknown | null> {
  await ensureAddonRuntimeEntriesLoaded();
  const provider = statusPanelProviders.get(String(key || "").trim());
  if (!provider) return null;
  return await provider.getPayload(chatJid);
}

export async function runAddonStatusPanelAction(
  key: string,
  action: string,
  payload: Record<string, unknown>,
): Promise<unknown | null> {
  await ensureAddonRuntimeEntriesLoaded();
  const provider = statusPanelProviders.get(String(key || "").trim());
  if (!provider?.runAction) return null;
  return await provider.runAction(String(action || "").trim(), payload);
}

export async function runAddonAdaptiveCardIntent(
  intent: string,
  context: AddonAdaptiveCardIntentContext,
): Promise<boolean> {
  await ensureAddonRuntimeEntriesLoaded();
  const handler = adaptiveCardIntentHandlers.get(String(intent || "").trim());
  if (!handler) return false;
  await handler(context);
  return true;
}

export function resetAddonRuntimeContributionsForTests(): void {
  statusPanelProviders.clear();
  adaptiveCardIntentHandlers.clear();
  for (const unregister of [...addonChatTransportUnregisters]) unregister();
  addonChatTransportUnregisters.clear();
  resetRuntimeStreamSessionsForTests();
  resetExternalAddonRoutesForTests();
  lazyRuntimeEntriesLoadPromise = null;
  startupRuntimeEntriesLoadPromise = null;
  runtimeApiInstalled = false;
  agentMessageEnqueuer = null;
  messagingRuntimeHandlers = null;
  const runtimeGlobal = globalThis as RuntimeGlobal;
  delete runtimeGlobal.__piclaw_runtime;
  delete runtimeGlobal.__piclaw_autoresearch_runtime_registered__;
}
