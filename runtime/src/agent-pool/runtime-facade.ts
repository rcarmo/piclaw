/**
 * agent-pool/runtime-facade.ts – Lightweight runtime/status/control helpers for AgentPool.
 *
 * Extracts session-status lookups, model registry access, slash/control routing,
 * so AgentPool can remain a thinner orchestrator.
 */

import { revokeAddonLocalAgent } from "../addons/local-context.js";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AgentSession, ModelRegistry, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels, type Api, type Model, type Provider } from "@earendil-works/pi-ai";

import type { AgentControlCommand, AgentControlResult } from "../agent-control/index.js";
import { getNativeCommandCatalogue } from "../agent-control/native-control-capabilities.js";
import type { NativeProviderAuthContext } from "../agent-control/provider-auth-context.js";
import type { DurableSessionPositionPort } from "./durable-runtime-adapter.js";
import { getLatestTokenUsageModel } from "../db.js";
import { requireOwnedSessionExecution } from "./owned-session-access.js";
import { getSessionThinkingPolicy } from './thinking-policy.js';

import { SESSIONS_DIR } from "../core/config.js";
import { detectChannel } from "../router.js";
import { peekProviderUsage, peekProviderUsageForRuntime, warmProviderUsage, type ProviderUsageSnapshot } from "./provider-usage.js";
import { resolveModelLabel } from "../utils/model-utils.js";
import { resolveModelScope } from "../utils/scoped-models.js";
import { withChatContext } from "../core/chat-context.js";
import { sanitiseJid } from "./session-paths.js";
import type { PoolEntry } from "./session-manager.js";
import { probeCompactionModel, type CompactionModelProbeResult } from "./compaction-model-probe.js";
import { readAccessConfig } from "../core/config-access.js";
import { getExecutionIdentity } from "../core/execution-context.js";
import { createLogger } from "../utils/logger.js";
import { requestGracefulShutdown } from "../runtime/shutdown-registry.js";

const MAX_PERSISTED_MODEL_STATE_CACHE_CHATS = 512;
const persistedModelStateCache = new Map<string, {
  signature: string;
  current: string | null;
  thinkingLevel: string | null;
}>();

/** Direct session mutations have no owner-aware admission contract yet. */
function requireSingleUserDirectExecution(label: string): void {
  const mode = readAccessConfig().mode;
  const identity = getExecutionIdentity();
  if (mode !== "single-user" || (identity && identity.mode !== "single-user")) throw new Error(`${label} is unavailable in multi-user mode.`);
}

function setPersistedModelStateCache(
  chatJid: string,
  value: { signature: string; current: string | null; thinkingLevel: string | null },
): void {
  if (persistedModelStateCache.has(chatJid)) {
    persistedModelStateCache.delete(chatJid);
  }
  persistedModelStateCache.set(chatJid, value);
  while (persistedModelStateCache.size > MAX_PERSISTED_MODEL_STATE_CACHE_CHATS) {
    const oldestKey = persistedModelStateCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    persistedModelStateCache.delete(oldestKey);
  }
}

function getMostRecentSessionFile(sessionDir: string): string | null {
  try {
    const files = readdirSync(sessionDir)
      .filter((entry) => entry.endsWith(".jsonl"))
      .map((entry) => ({ fullPath: join(sessionDir, entry), entry }))
      .map((file) => ({
        ...file,
        mtimeMs: statSync(file.fullPath).mtimeMs,
      }))
      .sort((left, right) => right.mtimeMs - left.mtimeMs);
    return files[0]?.fullPath ?? null;
  } catch {
    return null;
  }
}

function normalizeTokenUsageModelLabel(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || null;
}

function formatLatestRequestedModel(provider: string | null | undefined, model: string | null | undefined): string | null {
  const modelLabel = normalizeTokenUsageModelLabel(model);
  if (!modelLabel) return null;
  const providerLabel = normalizeTokenUsageModelLabel(provider);
  if (!providerLabel || modelLabel.startsWith(`${providerLabel}/`)) return modelLabel;
  return `${providerLabel}/${modelLabel}`;
}

type ProviderCompositionRuntime = Pick<ModelRuntime, "getProviders" | "getProviderAuthStatus" | "getRegisteredProviderConfig" | "getRegisteredNativeProvider" | "getRegisteredProviderIds" | "getCompatibilityRequestConfig" | "getError">;

/** Non-secret provider composition diagnostics returned to model/debug surfaces. */
export interface ProviderCompositionDiagnostic {
  provider: string;
  name: string | null;
  composed: boolean;
  registered_extension: boolean;
  registered_native: boolean;
  model_count: number;
  available_model_count: number;
  auth_configured: boolean;
  auth_source: string | null;
  auth_label: string | null;
  compatibility_auth_header: boolean | null;
  compatibility_has_headers: boolean;
}

export interface ProviderCompositionDiagnostics {
  providers: ProviderCompositionDiagnostic[];
  registered_provider_ids: string[];
  composition_error: string | null;
}

function safeCall<T>(run: () => T, fallback: T): T {
  try {
    return run();
  } catch {
    return fallback;
  }
}

function buildProviderCompositionDiagnostics(
  modelRuntime: Partial<ProviderCompositionRuntime> | null | undefined,
  availableModels: readonly Model<Api>[],
): ProviderCompositionDiagnostics {
  const runtime = modelRuntime ?? {};
  const providers = safeCall(() => [...(runtime.getProviders?.() ?? [])], [] as Provider[]);
  const registeredProviderIds = safeCall(() => [...(runtime.getRegisteredProviderIds?.() ?? [])], [] as string[]).sort((a, b) => a.localeCompare(b));
  const providerIds = new Set<string>();
  for (const provider of providers) providerIds.add(provider.id);
  for (const providerId of registeredProviderIds) providerIds.add(providerId);
  for (const model of availableModels) providerIds.add(model.provider);

  const rows = [...providerIds].sort((a, b) => a.localeCompare(b)).map((providerId) => {
    const provider = providers.find((candidate) => candidate.id === providerId);
    const providerModels = provider?.getModels?.() ?? [];
    const firstAvailableModel = availableModels.find((model) => model.provider === providerId) ?? null;
    const compatibility = firstAvailableModel && typeof runtime.getCompatibilityRequestConfig === "function"
      ? safeCall(() => runtime.getCompatibilityRequestConfig!(firstAvailableModel), null)
      : null;
    const auth = typeof runtime.getProviderAuthStatus === "function"
      ? safeCall(() => runtime.getProviderAuthStatus!(providerId), null)
      : null;
    return {
      provider: providerId,
      name: typeof provider?.name === "string" && provider.name.trim() ? provider.name.trim() : null,
      composed: Boolean(provider),
      registered_extension: Boolean(runtime.getRegisteredProviderConfig?.(providerId)),
      registered_native: Boolean(runtime.getRegisteredNativeProvider?.(providerId)),
      model_count: providerModels.length,
      available_model_count: availableModels.filter((model) => model.provider === providerId).length,
      auth_configured: Boolean(auth?.configured),
      auth_source: typeof auth?.source === "string" ? auth.source : null,
      auth_label: typeof auth?.label === "string" ? auth.label : null,
      compatibility_auth_header: compatibility ? Boolean(compatibility.authHeader) : null,
      compatibility_has_headers: Boolean(compatibility?.headers && Object.keys(compatibility.headers).length > 0),
    } satisfies ProviderCompositionDiagnostic;
  });

  return {
    providers: rows,
    registered_provider_ids: registeredProviderIds,
    composition_error: typeof runtime.getError === "function" ? (runtime.getError() ?? null) : null,
  };
}

function getLatestTokenUsageModelForStatus(chatJid: string): ReturnType<typeof getLatestTokenUsageModel> {
  try {
    return getLatestTokenUsageModel(chatJid);
  } catch (error) {
    if (error instanceof Error && (error.message === "Database not initialized" || error.message.includes("closed database"))) return null;
    throw error;
  }
}

function getPersistedSessionState(chatJid: string): { current: string | null; thinkingLevel: string | null } {
  const sessionDir = join(SESSIONS_DIR, sanitiseJid(chatJid));
  if (!existsSync(sessionDir)) {
    persistedModelStateCache.delete(chatJid);
    return { current: null, thinkingLevel: null };
  }

  const fullPath = getMostRecentSessionFile(sessionDir);
  if (!fullPath) {
    persistedModelStateCache.delete(chatJid);
    return { current: null, thinkingLevel: null };
  }
  let signature: string;
  try {
    const stat = statSync(fullPath);
    signature = `${fullPath}:${stat.size}:${Math.round(stat.mtimeMs)}`;
  } catch {
    persistedModelStateCache.delete(chatJid);
    return { current: null, thinkingLevel: null };
  }

  const cached = persistedModelStateCache.get(chatJid);
  if (cached?.signature === signature) {
    return { current: cached.current, thinkingLevel: cached.thinkingLevel };
  }

  let current: string | null = null;
  let thinkingLevel: string | null = null;
  try {
    const lines = readFileSync(fullPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let entry: any;
      try {
        entry = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (entry?.type === "model_change" && typeof entry.provider === "string" && typeof entry.modelId === "string") {
        current = `${entry.provider}/${entry.modelId}`;
        continue;
      }
      if (entry?.type === "thinking_level_change" && typeof entry.thinkingLevel === "string") {
        thinkingLevel = entry.thinkingLevel;
        continue;
      }
      if (entry?.type === "message" && entry.message?.role === "assistant" && typeof entry.message?.provider === "string" && typeof entry.message?.model === "string") {
        current = `${entry.message.provider}/${entry.message.model}`;
      }
    }
  } catch {
    current = null;
    thinkingLevel = null;
  }

  setPersistedModelStateCache(chatJid, { signature, current, thinkingLevel });
  return { current, thinkingLevel };
}

function modelCostRate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Structured model option returned to the web model picker. */
export interface AvailableModelOption {
  label: string;
  provider: string;
  id: string;
  name: string | null;
  context_window: number | null;
  pricing: {
    input_per_million: number | null;
    output_per_million: number | null;
    cache_read_per_million: number | null;
    cache_write_per_million: number | null;
  } | null;
  reasoning: boolean;
  thinking_levels: string[];
  thinking_level_labels: string[];
}

/** Shape returned by available-model inspection. */
export interface AvailableModelsResult {
  available_model_count?: number;
  thinking_policy?: ReturnType<typeof getSessionThinkingPolicy>;
  current: string | null;
  models: string[];
  model_options: AvailableModelOption[];
  thinking_level: string | null;
  thinking_level_label: string | null;
  supports_thinking: boolean;
  available_thinking_levels: string[];
  available_thinking_level_labels: string[];
  provider_usage: Awaited<ReturnType<typeof warmProviderUsage>>;
  latest_requested_model: string | null;
  latest_response_model: string | null;
  scoped_models_only: boolean;
  scoped_model_filter_active: boolean;
  enabled_model_patterns: string[];
  provider_diagnostics: ProviderCompositionDiagnostics;
}

/** Dependencies required by AgentRuntimeFacade. */
export interface ProviderUsageRefreshEvent {
  chat_jid: string;
  current: string | null;
  provider_usage: ProviderUsageSnapshot;
}

export interface AgentRuntimeFacadeOptions {
  pool: Map<string, PoolEntry>;
  getDurableSession?: (chatJid: string) => DurableSessionPositionPort | undefined;
  modelRegistry: ModelRegistry;
  modelRuntime: ModelRuntime;
  settingsManager?: SettingsManager;
  authPath: string;
  listKnownChats?: () => Array<{ chat_jid: string; model: string | null }>;
  acquireCommandProtection?: (chatJid: string) => () => void;
  onProviderUsageRefresh?: (event: ProviderUsageRefreshEvent) => void;
  onWarn?: (message: string, details: Record<string, unknown>) => void;
  onError?: (message: string, details: Record<string, unknown>) => void;
}

/**
 * Provides session-runtime helpers that do not belong in the core prompt loop.
 */
export class AgentRuntimeFacade {
  // ModelRuntime auth is instance-wide, so provider id is also the credential scope here.
  // provider-usage.ts fingerprints that credential and discards superseded refresh results.
  private readonly getDurableSession: NonNullable<AgentRuntimeFacadeOptions["getDurableSession"]>;
  private readonly providerUsageRefreshInFlight = new Map<string, Promise<void>>();
  private readonly nativeProviderAuthContexts = new Map<string, NativeProviderAuthContext>();
  private providerUsageRefreshListener: ((event: ProviderUsageRefreshEvent) => void) | undefined;
  private providerUsageRefreshGeneration = 0;

  constructor(private readonly options: AgentRuntimeFacadeOptions) {
    if ("durableSessions" in options) {
      throw new Error("durableSessions is retired; use getDurableSession");
    }
    if (options.getDurableSession !== undefined && typeof options.getDurableSession !== "function") {
      throw new Error("Durable runtime lookup must be callable");
    }
    this.providerUsageRefreshListener = options.onProviderUsageRefresh;
    // Capture routing before any session factory is entered. Never fall back on port failure.
    const rawDurableLookup = options.getDurableSession?.bind(options) ?? (() => undefined);
    const validateDurableRuntimeMethod = (
      port: DurableSessionPositionPort,
      method: keyof DurableSessionPositionPort,
      options: { required?: boolean } = {},
    ): void => {
      const candidate = port[method] as unknown;
      if (candidate === undefined) {
        if (options.required) throw new Error(`Durable runtime ${String(method)} must be callable`);
        return;
      }
      if (typeof candidate !== "function") {
        throw new Error(`Durable runtime ${String(method)} must be callable`);
      }
    };
    this.getDurableSession = (chatJid) => {
      const port = rawDurableLookup(chatJid);
      if (port === undefined) return undefined;
      if (!port || typeof port !== "object") {
        throw new Error("Durable runtime binding must be an object");
      }
      if (typeof port.sessionId !== "string" || !port.sessionId.trim()) {
        throw new Error("Durable runtime sessionId must be non-empty");
      }
      if (typeof port.branchId !== "string" || !port.branchId.trim()) {
        throw new Error("Durable runtime branchId must be non-empty");
      }
      validateDurableRuntimeMethod(port, "readPosition", { required: true });
      validateDurableRuntimeMethod(port, "readContextUsage");
      validateDurableRuntimeMethod(port, "readModel");
      validateDurableRuntimeMethod(port, "readThinkingLevel");
      validateDurableRuntimeMethod(port, "setThinkingLevel");
      validateDurableRuntimeMethod(port, "setModel");
      validateDurableRuntimeMethod(port, "reset");
      validateDurableRuntimeMethod(port, "readAbortScope");
      validateDurableRuntimeMethod(port, "abort");
      validateDurableRuntimeMethod(port, "abortRetry");
      validateDurableRuntimeMethod(port, "restart");
      validateDurableRuntimeMethod(port, "runBash");
      validateDurableRuntimeMethod(port, "abortBash");
      validateDurableRuntimeMethod(port, "readExecutionPolicy");
      validateDurableRuntimeMethod(port, "setExecutionPolicy");
      validateDurableRuntimeMethod(port, "requestExit");
      validateDurableRuntimeMethod(port, "compact");
      validateDurableRuntimeMethod(port, "reconcileMaintenance");
      validateDurableRuntimeMethod(port, "readTree");
      validateDurableRuntimeMethod(port, "readMetadata");
      validateDurableRuntimeMethod(port, "readReport");
      validateDurableRuntimeMethod(port, "assertCurrent");
      validateDurableRuntimeMethod(port, "runOwnedControl");
      if (port.lifetimeSignal !== undefined) {
        const signal = port.lifetimeSignal as unknown as {
          aborted?: unknown;
          addEventListener?: unknown;
          removeEventListener?: unknown;
        };
        if (
          !signal ||
          typeof signal !== "object" ||
          typeof signal.aborted !== "boolean" ||
          typeof signal.addEventListener !== "function" ||
          typeof signal.removeEventListener !== "function"
        ) {
          throw new Error("Durable runtime lifetimeSignal must be AbortSignal-like");
        }
      }
      return port;
    };
    this.options = { ...options };
  }

  private async nativeProviderAuthContext(chatJid: string, port: DurableSessionPositionPort): Promise<NativeProviderAuthContext> {
    if (!port.assertCurrent || !port.runOwnedControl || !port.lifetimeSignal || port.lifetimeSignal.aborted) throw Error("Native authentication lifetime unavailable");
    const existing = this.nativeProviderAuthContexts.get(chatJid);
    if (existing && existing.bindingId === port.sessionId && existing.signal === port.lifetimeSignal) { existing.assertCurrent(); return existing; }
    if (existing) {
      const { revokeNativeProviderAuthContext } = await import("../agent-control/handlers/login.js");
      revokeNativeProviderAuthContext(existing);
    }
    const assertCurrent = port.assertCurrent.bind(port), runOwned = port.runOwnedControl.bind(port);
    const context: NativeProviderAuthContext = Object.freeze({
      kind: "native-provider-auth", chatJid, bindingId: port.sessionId, runtime: this.options.modelRuntime, signal: port.lifetimeSignal,
      assertCurrent: () => {
        const result: unknown = assertCurrent();
        if (result !== undefined) {
          void Promise.resolve(result).catch(() => {
            createLogger("agent_pool").warn("invalid_auth_authority", { message: "Rejected asynchronous authentication authority" });
          });
          throw Error("Native authentication authority must be synchronous");
        }
        if (this.nativeProviderAuthContexts.get(chatJid) !== context) throw Error("Native authentication binding changed");
      },
      runOwned: <T>(operation: () => Promise<T>) => runOwned(operation),
      activateModel: (provider: string, modelId: string) => this.applyControlCommand(chatJid, { type: "model", provider, modelId, raw: `/model ${provider}/${modelId}` }),
    });
    this.nativeProviderAuthContexts.set(chatJid, context);
    context.assertCurrent();
    return context;
  }

  setProviderUsageRefreshListener(listener: ((event: ProviderUsageRefreshEvent) => void) | undefined): () => void {
    const generation = ++this.providerUsageRefreshGeneration;
    this.providerUsageRefreshListener = listener;
    return () => { if (this.providerUsageRefreshGeneration === generation) this.providerUsageRefreshListener = undefined; };
  }

  async applyControlCommand(chatJid: string, command: AgentControlCommand): Promise<AgentControlResult> {
    if (["queue", "queue_all", "steer"].includes(command.type)) {
      return { status: "error", message: "Native queue commands require host input admission. No legacy session was opened." };
    }
    // Operator process controls must not enter the model/session authority path.
    // The host shutdown handler seals ingress and owns the bounded cleanup deadline.
    if (command.type === "exit" || command.type === "restart") {
      requireSingleUserDirectExecution("Host process controls");
      requestGracefulShutdown(`User /${command.type} requested`);
      return { status: "success", message: command.type === "restart"
        ? "Host restart requested. Cleanup is bounded; committed history and accepted inputs are preserved."
        : "Host exit requested. Cleanup is bounded; committed history and accepted inputs are preserved." };
    }
    const port = this.getDurableSession(chatJid);
    if (port) {
      requireSingleUserDirectExecution("Native control commands");
      const { applySessionIndependentControlCommand, SESSION_INDEPENDENT_CONTROL_COMMAND_TYPES } = await import("../agent-control/agent-control-handlers.js");
      if (SESSION_INDEPENDENT_CONTROL_COMMAND_TYPES.has(command.type)) {
        revokeAddonLocalAgent(chatJid);
        const release = this.options.acquireCommandProtection?.(chatJid);
        try {
          const independent = await withChatContext(chatJid, detectChannel(chatJid), () => applySessionIndependentControlCommand(command));
          if (!independent) throw Error("Native host control unavailable");
          return independent;
        } finally { release?.(); }
      }
      if (["bash", "abort_bash", "abort_retry", "auto_compact", "auto_retry"].includes(command.type)) {
        if (!port.assertCurrent || !port.lifetimeSignal || port.lifetimeSignal.aborted)
          return {status:"error",message:"Native control lifetime unavailable. No legacy session was opened."};
        try {
          port.assertCurrent();
          switch (command.type) {
            case "bash": {
              if (!port.runBash) break;
              if (!command.command?.trim()) return {status:"error",message:"Usage: /bash <command>"};
              const result = await port.runBash(command.command.trim());
              return {status: result.cancelled || result.exitCode !== 0 ? "error" : "success", message:[result.output || "(no output)", result.cancelled ? "(cancelled)" : "(exit " + result.exitCode + ")", "Command/output saved to native context; no model request started."].join("\n")};
            }
            case "abort_bash":
              if (!port.abortBash) break;
              return {status:"success",message:await port.abortBash() ? "Bash abort requested." : "No bash command is running."};
            case "abort_retry":
              if (!port.abortRetry) break;
              return {status:"success",message:await port.abortRetry() ? "Retry backoff aborted." : "No retry backoff is active."};
            case "auto_compact": case "auto_retry": {
              if (!port.readExecutionPolicy || !port.setExecutionPolicy) break;
              if (command.enabled === undefined && command.raw?.trim().split(/\s+/).length > 1)
                return {status:"error",message:"Usage: /" + command.type.replaceAll("_","-") + " [on|off]"};
              const key = command.type === "auto_compact" ? "autoCompact" : "autoRetry";
              if (command.enabled !== undefined) await port.setExecutionPolicy(key,command.enabled);
              const state = await port.readExecutionPolicy();
              return {status:"success",message:"Native automatic " + (key === "autoCompact" ? "compaction" : "retry") + " is " + (state[key] ? "enabled" : "disabled") + " (runtime-wide). Existing work is not replayed or restarted."};
            }
          }
          return {status:"error",message:"Native command '"+command.type+"' is unavailable. No legacy session was opened."};
        } catch(error) { return {status:"error",message:error instanceof Error ? error.message : String(error)}; }
      }
      if (command.type === "login" || command.type === "logout") {
        if (!port.assertCurrent || !port.runOwnedControl || !port.lifetimeSignal) return { status: "error", message: "Native authentication lifetime unavailable. No legacy session was opened." };
        const context = await this.nativeProviderAuthContext(chatJid, port);
        revokeAddonLocalAgent(chatJid);
        const release = this.options.acquireCommandProtection?.(chatJid);
        try { return await withChatContext(chatJid, chatJid.startsWith("web:") ? "web" : "unknown", async () => {
          const { handleLogin, handleLogout } = await import("../agent-control/handlers/login.js");
          return command.type === "login"
            ? handleLogin(context, this.options.modelRegistry, command)
            : handleLogout(context, this.options.modelRegistry, command);
        }); }
        finally { release?.(); }
      }
      if (command.type === "commands") {
        const commands = getNativeCommandCatalogue(port);
        return { status: "success", message: ["**Native core command audit**",
          "Unavailable controls fail closed; no legacy session is opened. Tree is read-only; reset keeps the conversation identity.",
          "Web input commands use durable admission, not legacy prompt queues. Add-on commands are managed separately.",
          "", "| Command | Status | Aliases |", "|---|---|---|",
          ...commands.map(command => `| ${command.name} | ${command.status} | ${(command.aliases ?? []).join(", ") || "—"} |`)].join("\n") };
      }
      if (command.type === "stats" || command.type === "context" || command.type === "last") {
        if (!port.readReport) return { status: "error", message: "Native session reporting unavailable. No legacy session was opened." };
        const report = await port.readReport();
        if (command.type === "last") return report.lastAnswer
          ? { status: "success", message: `Last assistant response:\n\n${report.lastAnswer}` }
          : { status: "error", message: "No assistant messages in the active native context." };
        if (command.type === "context") return { status: "success", message: ["**Durable context**",
          `Active entries: ${report.activeEntries}`, `Current model window: ${report.contextWindow ?? "unknown"}`,
          `Last committed observed tokens: ${report.observedTokens ?? "unknown"}`, `Observed model: ${report.observedModel ?? "unknown"}`,
          "Observation includes that response's output; it is not a next-request fit estimate."].join("\n") };
        return { status: "success", message: ["**Durable session statistics**",
          `Active entries: ${report.activeEntries}`, `Active user / assistant messages: ${report.userMessages} / ${report.assistantMessages}`,
          "SDK own-conversation committed ledger (not provider billing):",
          `Input / output: ${report.usage.input} / ${report.usage.output}`,
          `Cache read / write: ${report.usage.cacheRead} / ${report.usage.cacheWrite}`,
          `Recorded cost: $${report.usage.cost.toFixed(6)}`].join("\n") };
      }
      if (command.type === "quota") {
        const { handleProviderQuota } = await import("../agent-control/handlers/info.js");
        const label = await port.readModel?.();
        const split = label?.indexOf("/") ?? -1;
        return handleProviderQuota(this.options.modelRuntime, label && split > 0
          ? { provider: label.slice(0, split), id: label.slice(split + 1) } : undefined);
      }
      if (command.type === "state") {
        const state = port.readState ? await port.readState() : undefined;
        const [model, thinking, position] = state ? [state.model, state.thinkingLevel, state.position]
          : await Promise.all([port.readModel?.(), port.readThinkingLevel?.(), port.readPosition()]);
        return { status: "success", message: ["**Durable session state**", `Session: ${port.sessionId}`, `Branch: ${port.branchId}`,
          `Model: ${model ?? "unavailable"}`, `Thinking: ${thinking ?? "unavailable"}`, `Position: ${position ?? "empty"}`,
          "Storage: pi-durable SQLite (no legacy session file)"].join("\n") };
      }
      if (command.type === "cycle_model") {
        const models = (await this.getAvailableModels(chatJid, { includeProviderUsage: false, includeProviderDiagnostics: false })).model_options;
        if (!models.length) return { status: "error", message: "No available native models." };
        const current = await port.readModel?.();
        const index = models.findIndex(model => model.label === current);
        const next = index < 0 ? (command.direction === "backward" ? models.length - 1 : 0)
          : (index + (command.direction === "backward" ? -1 : 1) + models.length) % models.length;
        return this.applyControlCommand(chatJid, { type: "model", provider: models[next]!.provider, modelId: models[next]!.id, raw: command.raw });
      }
      if (command.type === "cycle_thinking") {
        const label = await port.readModel?.();
        const model = this.options.modelRegistry.getAvailable().find(model => `${model.provider}/${model.id}` === label);
        if (!model) return { status: "error", message: "No available native thinking model." };
        const levels = getSupportedThinkingLevels(model);
        const current = await port.readThinkingLevel?.();
        const next = levels[(levels.findIndex(level => level === current) + 1) % levels.length];
        if (!next) return { status: "error", message: "No available thinking levels." };
        return this.applyControlCommand(chatJid, { type: "thinking", level: next, raw: command.raw });
      }
      if (command.type === "abort") {
        requireSingleUserDirectExecution("Direct abort commands");
        if (!port.abort) return { status: "error", message: "Native operation abort unavailable. No legacy session was opened." };
        revokeAddonLocalAgent(chatJid);
        const release = this.options.acquireCommandProtection?.(chatJid);
        try {
          const aborted = await port.abort();
          return { status: "success", message: aborted ? "Aborted the current durable operation." : "No active durable operation." };
        } finally { release?.(); }
      }
      if (command.type === "new_session") {
        requireSingleUserDirectExecution("Direct session reset");
        if (command.parent) return { status: "error", message: "Durable contexts do not accept legacy session-file parents." };
        if (!port.reset) return { status: "error", message: "Native context reset unavailable." };
        revokeAddonLocalAgent(chatJid);
        const release = this.options.acquireCommandProtection?.(chatJid);
        try {
          await port.reset();
          const auth = this.nativeProviderAuthContexts.get(chatJid);
          this.nativeProviderAuthContexts.delete(chatJid);
          if (auth) {
            const { revokeNativeProviderAuthContext } = await import("../agent-control/handlers/login.js");
            revokeNativeProviderAuthContext(auth);
          }
          return { status: "success", message: "Started a new durable context. Previous history is retained.",
            sessionGeneration: port.sessionId, sessionGenerationChanged: false,
            contextUsage: { ...await this.readDurableControlContextUsage(port), source: "durable-reset" } };
        } catch (error) {
          return { status: "error", message: error instanceof Error ? error.message : "Context reset failed." };
        } finally { release?.(); }
      }
      if (command.type === "compact") {
        requireSingleUserDirectExecution("Direct control commands");
        if (!port.compact) throw new Error("Durable compaction unavailable");
        revokeAddonLocalAgent(chatJid);
        const release = this.options.acquireCommandProtection?.(chatJid);
        try {
          const result = await port.compact(command.instructions?.trim() || undefined);
          return { status: "success", message: result.compacted ? "Context compacted." : "Nothing to compact.",
            sessionGeneration: port.sessionId,
            contextUsage: { ...await this.readDurableControlContextUsage(port),
              source: "durable_context", phase: "after_manual_compaction" } };
        } catch (error) {
          return { status: "error", message: error instanceof Error ? error.message : "Compaction failed." };
        } finally { release?.(); }
      }
      if (command.type === "model") {
        requireSingleUserDirectExecution("Direct model commands");
        if (!command.modelId) {
          if (command.provider) return { status: "error", message: "Invalid model format. Use /model <provider>/<modelId>." };
          if (!port.readModel) throw new Error("Durable session model unavailable");
          const current = await port.readModel();
          const available = resolveModelScope(this.options.modelRegistry.getAvailable(), this.options.settingsManager).models;
          const models = Array.from(new Set(available.map(model => `${model.provider}/${model.id}`))).sort();
          return { status: "success", message: `Available models:\n${models.map(model => `  ${model}${model === current ? " (current)" : ""}`).join("\n")}` };
        }
        if (!port.setModel) throw new Error("Durable model mutation unavailable");
        if (command.compact) return { status: "error", message: "Durable model compaction unavailable" };
        const { resolveControlModelSelection } = await import("../agent-control/agent-control-helpers.js");
        const selected = resolveControlModelSelection(this.options.modelRegistry, command);
        if ("status" in selected) return selected;
        revokeAddonLocalAgent(chatJid);
        const release = this.options.acquireCommandProtection?.(chatJid);
        try {
          await port.setModel({ provider: selected.provider, modelId: selected.id });
          return { status: "success", message: `Model set to ${selected.provider}/${selected.id}.`, model_label: `${selected.provider}/${selected.id}` };
        } catch (error) {
          return { status: "error", message: error instanceof Error ? error.message : "Model selection failed." };
        } finally { release?.(); }
      }
      if (command.type === "thinking") {
        requireSingleUserDirectExecution("Direct thinking commands");
        if (command.level !== undefined && !port.setThinkingLevel) throw new Error("Durable thinking mutation unavailable");
        if (!port.readModel || !port.readThinkingLevel) throw new Error("Durable thinking reader unavailable");
        const current = await port.readModel();
        if (!current) return { status: "error", message: "No model selected." };
        const model = this.options.modelRegistry.getAvailable().find(model => `${model.provider}/${model.id}` === current);
        if (!model) throw new Error("Durable thinking model unavailable");
        if (command.level !== undefined) {
          const level = command.level.trim().toLowerCase();
          if (!getSupportedThinkingLevels(model).some(supported => supported === level))
            return { status: "error", message: "Thinking level is not available for this model." };
          revokeAddonLocalAgent(chatJid);
          const release = this.options.acquireCommandProtection?.(chatJid);
          try {
            await port.setThinkingLevel!(level);
            return { status: "success", message: `Thinking level set to ${level}.`, thinking_level: level, thinking_level_label: level };
          } catch (error) {
            return { status: "error", message: error instanceof Error ? error.message : "Thinking selection failed." };
          } finally { release?.(); }
        }
        const level = await port.readThinkingLevel();
        const levels = getSupportedThinkingLevels(model);
        return { status: "success", message: [
          `Model: ${current}`, `Thinking level: ${level ?? "unknown"}`,
          `Available levels: ${levels.join(", ")}`,
          ...(!model.reasoning ? ["This model does not support thinking."] : []),
        ].join("\n"), thinking_level: level, thinking_level_label: level };
      }
      if (command.type !== "tree" || command.targetId) return { status: "error", message: `Native command '${command.type}' is unavailable. No legacy session was opened.` };
      if (!port.readTree) throw new Error("Durable session tree unavailable");
      const tree = await port.readTree();
      const { renderSessionTreeWidget } = await import("../agent-control/handlers/tree.js");
      return renderSessionTreeWidget(tree, chatJid) ?? { status: "success", message: tree.nodes.length
        ? ["Session tree:", ...tree.nodes.slice(command.mode === "head" ? command.offset ?? 0 : -(command.limit ?? 10), command.mode === "head" ? (command.offset ?? 0) + (command.limit ?? 10) : undefined).map(node => `${node.active ? "→ " : ""}${node.id} ${node.preview}`)].join("\n")
        : "Tree is empty." };
    }
    return { status: "error", message: "Native control binding unavailable. No legacy session was opened." };
  }

  async getCurrentModelLabel(chatJid: string): Promise<string | null> {
    const durable = this.getDurableSession(chatJid);
    if (durable) {
      if (!durable.readModel) throw new Error("Durable session model unavailable");
      return durable.readModel();
    }
    throw new Error("Durable session model unavailable");
  }

  async probeCompactionModel(modelLabel: string): Promise<CompactionModelProbeResult> {
    return await probeCompactionModel(this.options.modelRuntime, modelLabel);
  }

  async getAvailableModels(
    chatJid: string,
    options: { includeProviderUsage?: boolean; includeProviderDiagnostics?: boolean; includeCatalogue?: boolean } = {},
  ): Promise<AvailableModelsResult> {
    // Legacy-session metadata retains its old label projection. Native handles
    // use the pinned SDK's canonical capability keys without aliases.
    const legacy = this.options.getDurableSession === undefined ? await import('../agent-control/agent-control-helpers.js') : null;
    // Passive UI refreshes should not hydrate a cold runtime just to render
    // model state for the picker.
    const session = this.options.getDurableSession === undefined ? this.options.pool.get(chatJid)?.runtime.session ?? null : null;
    const durable = this.getDurableSession(chatJid);
    if (this.options.getDurableSession !== undefined && !durable?.readState && !durable?.readModel) throw new Error("Durable session model unavailable");
    const durableState = durable?.readState ? await durable.readState() : null;
    const persistedState = this.options.getDurableSession !== undefined
      ? durableState ? { current: durableState.model, thinkingLevel: durableState.thinkingLevel }
        : { current: await durable!.readModel!(), thinkingLevel: await durable!.readThinkingLevel?.() ?? null }
      : session ? { current: null, thinkingLevel: null } : getPersistedSessionState(chatJid);
    const registry = (session as (AgentSession & { modelRegistry?: ModelRegistry }) | null)?.modelRegistry ?? this.options.modelRegistry;
    const scopedModels = resolveModelScope(
      registry.getAvailable(),
      (session as (AgentSession & { settingsManager?: SettingsManager }) | null)?.settingsManager ?? this.options.settingsManager,
    );
    const available = scopedModels.models;
    const currentModel = session?.model ? `${session.model.provider}/${session.model.id}` : persistedState.current;
    // Status polling needs only the current model, not a catalogue projection.
    const selected = options.includeCatalogue === false
      ? available.filter(model => `${model.provider}/${model.id}` === currentModel)
      : available;
    const modelOptions = selected.map((model) => {
      const thinkingLevels = legacy ? legacy.getAvailableThinkingLevelsForModel(model as Model<any>) : getSupportedThinkingLevels(model as Model<any>);
      return {
        label: `${model.provider}/${model.id}`,
        provider: model.provider,
        id: model.id,
        name: typeof model.name === "string" && model.name.trim() ? model.name.trim() : null,
        context_window: typeof model.contextWindow === "number" && Number.isFinite(model.contextWindow) && model.contextWindow > 0
          ? model.contextWindow
          : null,
        pricing: [model.cost?.input, model.cost?.output, model.cost?.cacheRead, model.cost?.cacheWrite]
          .some((value) => typeof value === "number" && Number.isFinite(value) && value > 0)
          ? {
            input_per_million: modelCostRate(model.cost?.input),
            output_per_million: modelCostRate(model.cost?.output),
            cache_read_per_million: modelCostRate(model.cost?.cacheRead),
            cache_write_per_million: modelCostRate(model.cost?.cacheWrite),
          }
          : null,
        reasoning: Boolean(model.reasoning),
        thinking_levels: thinkingLevels,
        thinking_level_labels: legacy ? thinkingLevels.map(level => legacy.formatThinkingLevelForDisplay(level, model)) : thinkingLevels,
      };
    });
    const models = modelOptions.map((model) => model.label);
    const currentModelOption = currentModel ? modelOptions.find((model) => model.label === currentModel) ?? null : null;
    const currentModelDescriptor = session?.model
      ?? (currentModel ? available.find((model) => `${model.provider}/${model.id}` === currentModel) ?? null : null);
    const thinkingLevel = session?.thinkingLevel ?? persistedState.thinkingLevel ?? null;
    const supportsThinking = session && typeof (session as AgentSession & { supportsThinking?: () => boolean }).supportsThinking === "function"
      ? (session as AgentSession & { supportsThinking: () => boolean }).supportsThinking()
      : Boolean(currentModelDescriptor?.reasoning);
    const baseThinkingLevels = session && typeof (session as AgentSession & { getAvailableThinkingLevels?: () => string[] }).getAvailableThinkingLevels === 'function'
      ? (session as AgentSession & { getAvailableThinkingLevels: () => string[] }).getAvailableThinkingLevels() : undefined;
    const availableThinkingLevels: string[] = currentModelDescriptor
      ? legacy ? legacy.getAvailableThinkingLevelsForModel(currentModelDescriptor, baseThinkingLevels) : getSupportedThinkingLevels(currentModelDescriptor)
      : legacy ? baseThinkingLevels ?? ['off'] : [];
    const activeProvider = session?.model?.provider ?? currentModelOption?.provider ?? null;
    const includeProviderUsage = options.includeProviderUsage !== false;
    const providerUsage = includeProviderUsage && activeProvider
      ? await peekProviderUsageForRuntime(this.options.modelRuntime, activeProvider, { allowStale: true })
      : null;
    if (includeProviderUsage && activeProvider && !peekProviderUsage(activeProvider)) {
      this.warmProviderUsage(activeProvider);
    }
    const latestUsageModel = getLatestTokenUsageModelForStatus(chatJid);
    const latestRequestedModel = latestUsageModel
      ? formatLatestRequestedModel(latestUsageModel.provider, latestUsageModel.model)
      : null;
    const latestResponseModel = normalizeTokenUsageModelLabel(latestUsageModel?.response_model);
    return {
      current: currentModel,
      ...(options.includeCatalogue === false ? { available_model_count: available.length } : {}),
      models,
      model_options: modelOptions,
      thinking_level: thinkingLevel,
      thinking_level_label: legacy && thinkingLevel ? legacy.formatThinkingLevelForDisplay(thinkingLevel, currentModelDescriptor) : thinkingLevel,
      thinking_policy: session ? getSessionThinkingPolicy(session) : null,
      supports_thinking: supportsThinking,
      available_thinking_levels: availableThinkingLevels,
      available_thinking_level_labels: legacy ? availableThinkingLevels.map(level => legacy.formatThinkingLevelForDisplay(level, currentModelDescriptor)) : availableThinkingLevels,
      provider_usage: providerUsage,
      latest_requested_model: latestRequestedModel,
      latest_response_model: latestResponseModel,
      scoped_models_only: scopedModels.scopedModelsOnly,
      scoped_model_filter_active: scopedModels.scoped,
      enabled_model_patterns: scopedModels.patterns,
      provider_diagnostics: options.includeProviderDiagnostics === false
        ? { providers: [], registered_provider_ids: [], composition_error: null }
        : buildProviderCompositionDiagnostics(this.options.modelRuntime, available),
    };
  }

  private warmProviderUsage(providerId: string): void {
    if (this.providerUsageRefreshInFlight.has(providerId)) return;
    const refresh = warmProviderUsage(this.options.modelRuntime, providerId, this.options.authPath)
      .then(async (usage) => {
        // A rotated OpenRouter credential can supersede an older in-flight result.
        // Re-read once so the new credential is warmed without waiting for the next UI poll.
        const currentUsage = usage ?? (providerId === "openrouter"
          ? await warmProviderUsage(this.options.modelRuntime, providerId, this.options.authPath)
          : null);
        if (currentUsage) this.publishProviderUsageRefresh(providerId, currentUsage);
      })
      .finally(() => this.providerUsageRefreshInFlight.delete(providerId));
    this.providerUsageRefreshInFlight.set(providerId, refresh);
  }

  private publishProviderUsageRefresh(providerId: string, usage: ProviderUsageSnapshot): void {
    for (const chat of this.options.listKnownChats?.() ?? []) {
      if (chat.model?.split("/", 1)[0] !== providerId) continue;
      this.providerUsageRefreshListener?.({
        chat_jid: chat.chat_jid,
        current: chat.model,
        provider_usage: usage,
      });
    }
  }

  /** A committed reset/compact stays successful if its subsequent display read
   * loses ownership or the runtime closes. Unknown remains authoritative.
   */
  private async readDurableControlContextUsage(binding: DurableSessionPositionPort) {
    try { return await this.readDurableContextUsage(binding); }
    catch { return { tokens: null, contextWindow: null, percent: null, sessionGeneration: binding.sessionId, tokensAreAuthoritative: true as const }; }
  }

  private async readDurableContextUsage(binding: DurableSessionPositionPort) {
    if (!binding.readContextUsage) throw new Error("Durable context reader unavailable");
    const usage = await binding.readContextUsage();
    const window = usage.contextWindow;
    const contextWindow = typeof window === "number" && Number.isFinite(window) && window > 0 ? window : null;
    const tokens = typeof usage.tokens === "number" && Number.isFinite(usage.tokens) && usage.tokens >= 0 ? usage.tokens : null;
    return { tokens, contextWindow, percent: tokens !== null && contextWindow !== null ? tokens / contextWindow * 100 : null,
      sessionGeneration: binding.sessionId, tokensAreAuthoritative: true as const };
  }

  async getContextUsageForChat(chatJid: string): Promise<{
    tokens: number | null;
    contextWindow: number | null;
    percent: number | null;
    sessionGeneration?: string;
    /** Unknown counts from this reader must not be replaced by stored estimates. */
    tokensAreAuthoritative?: true;
  } | null> {
    if (this.options.getDurableSession !== undefined) {
      const binding = this.getDurableSession(chatJid);
      if (!binding) throw new Error("Durable application does not construct legacy sessions");
      return this.readDurableContextUsage(binding);
    }
    const entry = this.options.pool.get(chatJid);
    if (!entry) return null;
    const session = entry.runtime.session;
    const sessionGeneration = typeof session.sessionId === "string" ? session.sessionId.trim() : "";
    const usage = session.getContextUsage() ?? null;
    if (!sessionGeneration) return usage;
    return usage
      ? { ...usage, sessionGeneration }
      : { tokens: null, contextWindow: session.model?.contextWindow ?? 0, percent: null, sessionGeneration };
  }

  getSessionGenerationForChat(chatJid: string): string | null {
    const sessionId = this.options.getDurableSession !== undefined
      ? this.getDurableSession(chatJid)?.sessionId
      : this.options.pool.get(chatJid)?.runtime.session.sessionId;
    return typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : null;
  }

  /** Exact public head and visible node count, from the same tree reader as /tree. */
  async getSessionTreeSummaryForChat(chatJid: string): Promise<{ leafId: string | null; total: number } | null> {
    // Legacy introspection must not instantiate an idle/unknown session.
    if (this.options.getDurableSession === undefined && !this.options.pool.has(chatJid)) return null;
    const snapshot = await this.getSessionTreeForChat(chatJid);
    return { leafId: snapshot.leafId, total: snapshot.total };
  }

  async getSessionTreeForChat(chatJid: string): Promise<import("../agent-control/session-tree-snapshot.js").SessionTreeSnapshot> {
    const durable = this.getDurableSession(chatJid);
    if (durable) {
      if (!durable.readTree) throw new Error("Durable session tree unavailable");
      return durable.readTree();
    }
    throw new Error("Durable session tree unavailable");
  }

  async saveSessionPosition(chatJid: string): Promise<string | null> {
    const durable = this.getDurableSession(chatJid);
    if (!durable) throw new Error("Durable session position unavailable");
    return durable.readPosition();
  }

  hasProviderModels(provider: string): boolean {
    return this.options.modelRegistry.getAll().some((model) => model.provider === provider);
  }

  registerModelProvider(providerName: string, config: Parameters<ModelRegistry["registerProvider"]>[1]): void {
    this.options.modelRegistry.registerProvider(providerName, config);
  }

  registerNativeModelProvider(provider: Provider): void {
    this.options.modelRegistry.registerProvider(provider);
  }

  resolveModelInput(input: string): { model?: string; error?: string } {
    return resolveModelLabel(this.options.modelRegistry, input);
  }

  isStreaming(chatJid: string): boolean {
    return this.options.pool.get(chatJid)?.runtime.session.isStreaming ?? false;
  }

  isActive(chatJid: string): boolean {
    const session = this.options.pool.get(chatJid)?.runtime.session;
    if (!session) return false;
    return Boolean(session.isStreaming || session.isCompacting || session.isRetrying || session.isBashRunning);
  }

}
