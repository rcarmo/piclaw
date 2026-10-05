import { addonLocalContextApi, setAddonLocalContextHost } from "./local-context.js";
import { addonChildRequestsApi, shutdownAddonChildRequests, resetAddonChildRequestsForTests } from './child-request-runtime.js';
import type { ChildRequestsApiV1 } from './child-request-contracts.js';
import { AddonOperationService } from "./operation-service.js";
import { admitAddonOutboundWork } from './operation-outbound-admission.js';
import type { OperationHost } from "./operation-contracts.js";
import { getCurrentAddonRegistrationOwner } from "./external-routes.js";
import { mkdirSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { getDataDir, getWorkspaceDir as getConfiguredWorkspaceDir } from "../core/config.js";
import { readAccessConfig } from "../core/config-access.js";
import { createLogger } from "../utils/logger.js";
import { getExecutionIdentity } from "../core/execution-context.js";
import { registerPreShutdownHook } from "../runtime/shutdown-registry.js";
import { createMedia, getMediaById } from "../db/media.js";
import { postMessagesToolMessage } from "../extensions/messages-crud.js";
import type { RuntimeAgentMessageRequest, RuntimeAgentMessageResult } from "../channels/web/core/web-channel-runtime-public-surface-service.js";
import {
  registerChatTransport,
  type ChatTransport,
} from "../extensions/chat-transport-registry.js";
import { resetRuntimeStreamSessionsForTests, runtimeStreamSessions } from "./runtime-stream-sessions.js";
import {
  listInstalledAddonPackageDirs,
  readInstalledAddonPackage,
  resolveAddonPackageEntries,
} from "./package-entries.js";
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

export interface PiclawRuntimeOperationsApiV1 {
  version: 1;
  /** Register only during an owning startup import; verified principals bind later. */
  register(): { forPrincipal(principalId: string): ReturnType<AddonOperationService["bind"]>; admitOutbound(): ReturnType<typeof admitAddonOutboundWork> };
}

export interface PiclawRuntimeAddonApi {
  lifecycle: {
    version: 1;
    /** Register process-scoped cleanup for sockets/timers opened by startup runtime entries. */
    onShutdown(handler: () => void | Promise<void>): () => void;
  };
  registerStatusPanelProvider: (provider: AddonStatusPanelProvider) => () => void;
  registerAdaptiveCardIntentHandler: (intent: string, handler: AddonAdaptiveCardIntentHandler) => () => void;
  enqueueAgentMessage: AddonAgentMessageEnqueuer;
  messaging: PiclawRuntimeMessagingApiV1;
  localContext: typeof addonLocalContextApi;
  externalRoutes: PiclawRuntimeExternalRoutesApiV1;
  operations: PiclawRuntimeOperationsApiV1;
  childRequests: ChildRequestsApiV1;
  createMedia: typeof createMedia;
  getMediaById: typeof getMediaById;
  postMessage: typeof postMessagesToolMessage;
  streamSessions: typeof runtimeStreamSessions;
}

type RuntimeAddonPackageManifest = {
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

const log = createLogger("addons.runtime-contributions");
const statusPanelProviders = new Map<string, AddonStatusPanelProvider>();
const adaptiveCardIntentHandlers = new Map<string, AddonAdaptiveCardIntentHandler>();
const addonChatTransportUnregisters = new Set<() => void>();
const addonRuntimeShutdownHandlers = new Set<() => void | Promise<void>>();
const ADDON_RUNTIME_SHUTDOWN_TIMEOUT_MS = 4000;
let runtimeApiInstalled = false;
let lazyRuntimeEntriesLoadPromise: Promise<void> | null = null;
let startupRuntimeEntriesLoadPromise: Promise<void> | null = null;
let agentMessageEnqueuer: AddonAgentMessageEnqueuer | null = null;
let messagingRuntimeHandlers: AddonMessagingRuntimeHandlers | null = null;
let addonRuntimeShutdownHookRegistered = false;

function registerAddonRuntimeShutdownHandler(handler: () => void | Promise<void>): () => void {
  if (typeof handler !== "function") return () => {};
  addonRuntimeShutdownHandlers.add(handler);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    addonRuntimeShutdownHandlers.delete(handler);
  };
}

async function shutdownAddonRuntimeContributions(): Promise<void> {
  // Raw model scopes are never released by the legacy add-on timeout race.
  // Start independent legacy cleanup too: it may release a pipe needed by close.
  const children = shutdownAddonChildRequests();
  void children.catch(() => undefined);
  const handlers = [...addonRuntimeShutdownHandlers];
  addonRuntimeShutdownHandlers.clear();
  const timeout = Symbol("timeout");
  const results = await Promise.all(handlers.map(async (handler, index) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        Promise.resolve().then(handler).then(() => null),
        new Promise<typeof timeout>((resolve) => { timer = setTimeout(() => resolve(timeout), ADDON_RUNTIME_SHUTDOWN_TIMEOUT_MS); }),
      ]);
      if (result === timeout) log.warn("Add-on runtime shutdown handler timed out", { operation: "runtime_addon_shutdown", handlerIndex: index, timeoutMs: ADDON_RUNTIME_SHUTDOWN_TIMEOUT_MS });
    } catch (error) {
      log.warn("Add-on runtime shutdown handler failed", { operation: "runtime_addon_shutdown", handlerIndex: index, err: error });
    } finally {
      clearTimeout(timer);
    }
  }));
  void results;
  await children;
}

function getWorkspaceDir(): string {
  return getConfiguredWorkspaceDir();
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

  for (const packageDir of listInstalledAddonPackageDirs(addonsNodeModulesDir)) {
    const addonPackage = readInstalledAddonPackage(packageDir);
    if (!addonPackage) continue;
    const manifest = addonPackage.manifest as RuntimeAddonPackageManifest;
    const load: AddonRuntimeEntryLoad = manifest.pi?.runtime?.load === "startup" ? "startup" : "lazy";
    for (const entryPath of resolveAddonPackageEntries(packageDir, manifest.pi?.runtime?.entries)) {
      runtimeEntries.push({
        packageName: typeof manifest.name === "string" && manifest.name.trim() ? manifest.name.trim() : packageDir.split(/[\\/]/).pop() || "unknown",
        path: entryPath,
        load,
      });
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
  setAddonLocalContextHost(enqueuer ? { enqueue: enqueuer } : null);
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

function requireSingleUserAddonRuntime(action: string): void {
  const mode = readAccessConfig().mode;
  const identity = getExecutionIdentity();
  if (mode !== "single-user" || (identity && identity.mode !== "single-user")) throw new Error(`${action} is unavailable in multi-user mode.`);
}

async function enqueueAgentMessageViaRuntime(request: RuntimeAgentMessageRequest): Promise<RuntimeAgentMessageResult> {
  requireSingleUserAddonRuntime("Add-on agent-message enqueue");
  if (!agentMessageEnqueuer) throw new Error("Piclaw runtime agent-message enqueue API is not available yet.");
  return await agentMessageEnqueuer(request);
}

let operationService: AddonOperationService | null = null;
export function setAddonOperationHost(host: OperationHost): void {
  if (operationService) throw new Error("Operation host already installed.");
  operationService = new AddonOperationService(host);
  registerAddonRuntimeShutdownHandler(() => operationService?.shutdown());
  operationService.recover();
}
function registerOperations() {
  const owner = getCurrentAddonRegistrationOwner();
  if (!owner || !operationService) throw new Error("Operations require an owning startup import and a ready host.");
  const service = operationService;
  return Object.freeze({ forPrincipal: (principalId: string) => service.bind({ addonId: owner.addonId, principalId }), admitOutbound: () => admitAddonOutboundWork(owner.addonId) });
}

export function installAddonRuntimeApi(): PiclawRuntimeAddonApi {
  if (!addonRuntimeShutdownHookRegistered) {
    addonRuntimeShutdownHookRegistered = true;
    registerPreShutdownHook(shutdownAddonRuntimeContributions);
  }
  const runtimeGlobal = globalThis as RuntimeGlobal;
  if (runtimeApiInstalled && runtimeGlobal.__piclaw_runtime) {
    return runtimeGlobal.__piclaw_runtime;
  }

  const api: PiclawRuntimeAddonApi = {
    lifecycle: { version: 1, onShutdown: registerAddonRuntimeShutdownHandler },
    registerStatusPanelProvider: registerAddonStatusPanelProvider,
    registerAdaptiveCardIntentHandler: registerAddonAdaptiveCardIntentHandler,
    enqueueAgentMessage: enqueueAgentMessageViaRuntime,
    localContext: addonLocalContextApi,
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
    operations: { version: 1, register: registerOperations },
    childRequests: addonChildRequestsApi,
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
  requireSingleUserAddonRuntime("Add-on status panels");
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
  requireSingleUserAddonRuntime("Add-on status actions");
  await ensureAddonRuntimeEntriesLoaded();
  const provider = statusPanelProviders.get(String(key || "").trim());
  if (!provider?.runAction) return null;
  return await provider.runAction(String(action || "").trim(), payload);
}

export async function runAddonAdaptiveCardIntent(
  intent: string,
  context: AddonAdaptiveCardIntentContext,
): Promise<boolean> {
  requireSingleUserAddonRuntime("Add-on Adaptive Card intents");
  await ensureAddonRuntimeEntriesLoaded();
  const handler = adaptiveCardIntentHandlers.get(String(intent || "").trim());
  if (!handler) return false;
  await handler(context);
  return true;
}

export async function shutdownAddonRuntimeContributionsForTests(): Promise<void> {
  await shutdownAddonRuntimeContributions();
}

export function resetAddonRuntimeContributionsForTests(): void {
  resetAddonChildRequestsForTests();
  operationService?.shutdown();
  operationService = null;
  statusPanelProviders.clear();
  adaptiveCardIntentHandlers.clear();
  for (const unregister of [...addonChatTransportUnregisters]) unregister();
  addonChatTransportUnregisters.clear();
  addonRuntimeShutdownHandlers.clear();
  resetRuntimeStreamSessionsForTests();
  resetExternalAddonRoutesForTests();
  lazyRuntimeEntriesLoadPromise = null;
  startupRuntimeEntriesLoadPromise = null;
  runtimeApiInstalled = false;
  agentMessageEnqueuer = null;
  setAddonLocalContextHost(null);
  messagingRuntimeHandlers = null;
  const runtimeGlobal = globalThis as RuntimeGlobal;
  delete runtimeGlobal.__piclaw_runtime;
  delete runtimeGlobal.__piclaw_autoresearch_runtime_registered__;
}
