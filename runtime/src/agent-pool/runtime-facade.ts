/**
 * agent-pool/runtime-facade.ts – Lightweight runtime/status/control helpers for AgentPool.
 *
 * Extracts session-status lookups, model registry access, slash/control routing,
 * and queued-message mutations so AgentPool can remain a thinner orchestrator.
 */

import { revokeAddonLocalAgent } from "../addons/local-context.js";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AgentSession, AgentSessionRuntime, ModelRegistry, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { Api, Model, Provider } from "@earendil-works/pi-ai";

import { applyControlCommand, type AgentControlCommand, type AgentControlResult } from "../agent-control/index.js";
import { handleModel, resolveControlModelSelection } from "../agent-control/handlers/model.js";
import { formatThinkingLevelForDisplay, getAvailableThinkingLevelsForModel, resolveThinkingAlias, THINKING_LEVELS } from "../agent-control/agent-control-helpers.js";
import { buildSessionTreeSnapshot } from "../agent-control/session-tree-snapshot.js";
import { renderSessionTreeWidget } from "../agent-control/handlers/tree.js";
import { getLatestTokenUsageModel } from "../db.js";
import { requireOwnedSessionExecution } from "./owned-session-access.js";
import { getSessionThinkingPolicy } from './thinking-policy.js';

import { SESSIONS_DIR } from "../core/config.js";
import { detectChannel } from "../router.js";
import { executeSlashCommand } from "./slash-command.js";
import { promptWithContextPressureRetry } from "./context-pressure-retry.js";
import { peekProviderUsage, peekProviderUsageForRuntime, warmProviderUsage, type ProviderUsageSnapshot } from "./provider-usage.js";
import { resolveModelLabel } from "../utils/model-utils.js";
import { resolveModelScope } from "../utils/scoped-models.js";
import { withChatContext, getChatJid } from "../core/chat-context.js";
import { sanitiseJid } from "./session-paths.js";
import type { PoolEntry } from "./session-manager.js";
import { probeCompactionModel, type CompactionModelProbeResult } from "./compaction-model-probe.js";
import { readAccessConfig } from "../core/config-access.js";
import { getExecutionIdentity } from "../core/execution-context.js";

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
  getDurableSession?: (chatJid: string) => import("./durable-runtime-adapter.js").DurableSessionPositionPort | undefined;
  /** Compatibility input for isolated callers; application routing uses the backend lookup. */
  durableSessions?: ReadonlyMap<string, import("./durable-runtime-adapter.js").DurableSessionPositionPort>;
  getOrCreateRuntime: (chatJid: string) => Promise<AgentSessionRuntime>;
  modelRegistry: ModelRegistry;
  modelRuntime: ModelRuntime;
  settingsManager?: SettingsManager;
  authPath: string;
  clearAttachments: (chatJid: string) => void;
  refreshRuntime: (chatJid: string, runtime: AgentSessionRuntime) => Promise<void>;
  listKnownChats?: () => Array<{ chat_jid: string; model: string | null }>;
  acquireCommandProtection?: (chatJid: string) => () => void;
  onProviderUsageRefresh?: (event: ProviderUsageRefreshEvent) => void;
  onWarn?: (message: string, details: Record<string, unknown>) => void;
  onError?: (message: string, details: Record<string, unknown>) => void;
  applyControlCommandFn?: typeof applyControlCommand;
  executeSlashCommandFn?: typeof executeSlashCommand;
}

/**
 * Provides session-runtime helpers that do not belong in the core prompt loop.
 */
export class AgentRuntimeFacade {
  // ModelRuntime auth is instance-wide, so provider id is also the credential scope here.
  // provider-usage.ts fingerprints that credential and discards superseded refresh results.
  private readonly getDurableSession: NonNullable<AgentRuntimeFacadeOptions["getDurableSession"]>;
  private readonly providerUsageRefreshInFlight = new Map<string, Promise<void>>();
  private providerUsageRefreshListener: ((event: ProviderUsageRefreshEvent) => void) | undefined;

  constructor(private readonly options: AgentRuntimeFacadeOptions) {
    this.providerUsageRefreshListener = options.onProviderUsageRefresh;
    // Capture routing before any session factory is entered. Never fall back on port failure.
    const compatibility = options.durableSessions === undefined ? undefined : new Map([...options.durableSessions].map(([chat, port]) =>
      [chat, Object.freeze({ ...port, readPosition: port.readPosition.bind(port), readModel: port.readModel?.bind(port), setModel: port.setModel?.bind(port), compact: port.compact?.bind(port), readTree: port.readTree?.bind(port) })]));
    this.getDurableSession = options.getDurableSession?.bind(options) ?? (chat => compatibility?.get(chat));
    options = { ...options, getDurableSession: options.getDurableSession ?? (compatibility && this.getDurableSession) };
    const legacy = options.getOrCreateRuntime;
    this.options = { ...options, getOrCreateRuntime: chat => {
      if (options.getDurableSession !== undefined) return Promise.reject(new Error("Durable application does not construct legacy sessions"));
      return legacy(chat);
    } };
  }

  setProviderUsageRefreshListener(listener: ((event: ProviderUsageRefreshEvent) => void) | undefined): void {
    this.providerUsageRefreshListener = listener;
  }

  async applyControlCommand(chatJid: string, command: AgentControlCommand): Promise<AgentControlResult> {
    if (this.getDurableSession(chatJid)) {
      if (command.type === "compact") {
        requireSingleUserDirectExecution("Direct control commands");
        const port = this.getDurableSession(chatJid)!;
        if (!port.compact) throw new Error("Durable compaction unavailable");
        revokeAddonLocalAgent(chatJid);
        const release = this.options.acquireCommandProtection?.(chatJid);
        try {
          const result = await port.compact(command.instructions?.trim() || undefined);
          return { status: "success", message: result.compacted ? "Context compacted." : "Nothing to compact.",
            sessionGeneration: port.sessionId,
            contextUsage: { tokens: null, contextWindow: null, percent: null, sessionGeneration: port.sessionId,
              source: "durable_context", phase: "after_manual_compaction" } };
        } catch (error) {
          return { status: "error", message: error instanceof Error ? error.message : "Compaction failed." };
        } finally { release?.(); }
      }
      if (command.type === "model") {
        requireSingleUserDirectExecution("Direct model commands");
        const port = this.getDurableSession(chatJid)!;
        if (!port.setModel) throw new Error("Durable model mutation unavailable");
        if (command.compact) return { status: "error", message: "Durable model compaction unavailable" };
        const selected = resolveControlModelSelection(this.options.modelRegistry, command);
        if ("status" in selected) return selected;
        await port.setModel({ provider: selected.provider, modelId: selected.id });
        return { status: "success", message: `Model set to ${selected.provider}/${selected.id}.` };
      }
      if (command.type !== "tree" || command.targetId) throw new Error("Durable history mutation unavailable");
      const tree = await this.getSessionTreeForChat(chatJid);
      return renderSessionTreeWidget(tree, chatJid) ?? { status: "success", message: tree.nodes.length
        ? ["Session tree:", ...tree.nodes.slice(command.mode === "head" ? command.offset ?? 0 : -(command.limit ?? 10), command.mode === "head" ? (command.offset ?? 0) + (command.limit ?? 10) : undefined).map(node => `${node.active ? "→ " : ""}${node.id} ${node.preview}`)].join("\n")
        : "Tree is empty." };
    }
    requireSingleUserDirectExecution("Direct control commands");
    revokeAddonLocalAgent(chatJid);
    const release = this.options.acquireCommandProtection?.(chatJid);
    try {
    const runtime = await this.options.getOrCreateRuntime(chatJid);
    const session = runtime.session;
    const previousSessionGeneration = typeof session.sessionId === "string" ? session.sessionId : null;
    const channel = detectChannel(chatJid);
    const apply = this.options.applyControlCommandFn ?? applyControlCommand;
    const result = await withChatContext(chatJid, channel, () => apply(runtime, this.options.modelRegistry, command));
    if (result.refresh_runtime || runtime.session !== session) {
      await this.options.refreshRuntime(chatJid, runtime);
    }
    const sessionGeneration = typeof runtime.session.sessionId === "string" ? runtime.session.sessionId : null;
    return sessionGeneration
      ? {
        ...result,
        sessionGeneration,
        ...(result.contextUsage
          ? { contextUsage: { ...result.contextUsage, sessionGeneration: previousSessionGeneration ?? sessionGeneration } }
          : {}),
        ...(sessionGeneration !== previousSessionGeneration ? { sessionGenerationChanged: true } : {}),
      }
      : result;
    } finally { release?.(); }
  }

  /** Owner-authorized active-session model/thinking mutation; never writes shared defaults. */
  async applyOwnedModelControl(
    chatJid: string,
    command: Extract<AgentControlCommand, { type: "model" | "thinking" }>,
  ): Promise<AgentControlResult> {
    const identity = getExecutionIdentity();
    if (readAccessConfig().mode !== "family-shared" || identity?.mode !== "family-shared" || identity.provenance.chatJid !== chatJid) {
      throw new Error("Session access denied.");
    }
    requireOwnedSessionExecution(chatJid);
    const runtime = await this.options.getOrCreateRuntime(chatJid);
    const session = runtime.session;
    if (session.isStreaming || session.isCompacting || session.isRetrying) {
      return { status: "error", message: "Wait for the current session operation to finish before changing its model." };
    }
    if (command.type === "model") {
      if (!command.provider || !command.modelId || command.compact) return { status: "error", message: "Select one exact available model." };
      const available = await this.getAvailableModels(chatJid, { includeProviderUsage: false, includeProviderDiagnostics: false });
      const requested = `${command.provider}/${command.modelId}`;
      if (!available.model_options.some(option => option.label === requested)) return { status: "error", message: "Selected model is unavailable." };
      // Standard handler applies context-fit checks. AgentSession.setModel persists only
      // to this transcript unless persist:true is supplied (it is not).
      return await withChatContext(chatJid, detectChannel(chatJid), () => handleModel(session, this.options.modelRegistry, command, { refreshRegistry: false, allowCompaction: false }));
    }
    if (!session.model) return { status: "error", message: "No model selected yet." };
    const requested = typeof command.level === "string" ? command.level.trim().toLowerCase() : "";
    if (!requested) {
      return {
        status: "success",
        message: "Current thinking level.",
        thinking_level: session.thinkingLevel ?? null,
        thinking_level_label: formatThinkingLevelForDisplay(session.thinkingLevel, session.model),
      };
    }
    const resolved = resolveThinkingAlias(requested, session.model);
    const available = getAvailableThinkingLevelsForModel(session.model, session.getAvailableThinkingLevels());
    if (!THINKING_LEVELS.includes(resolved as never) || !available.includes(resolved)) {
      return { status: "error", message: "Selected thinking level is unavailable for this model." };
    }
    // SDK default options persist only to this session transcript, not SettingsManager.
    session.setThinkingLevel(resolved as never);
    const applied = session.thinkingLevel ?? resolved;
    return {
      status: "success",
      message: `Thinking level set to ${formatThinkingLevelForDisplay(applied, session.model)}.`,
      thinking_level: applied,
      thinking_level_label: formatThinkingLevelForDisplay(applied, session.model),
    };
  }

  async getCurrentModelLabel(chatJid: string): Promise<string | null> {
    const durable = this.getDurableSession(chatJid);
    if (durable) {
      if (!durable.readModel) throw new Error("Durable session model unavailable");
      return durable.readModel();
    }
    const session = (await this.options.getOrCreateRuntime(chatJid)).session;
    const model = session.model;
    return model ? `${model.provider}/${model.id}` : null;
  }

  async probeCompactionModel(modelLabel: string): Promise<CompactionModelProbeResult> {
    return await probeCompactionModel(this.options.modelRuntime, modelLabel);
  }

  async getAvailableModels(
    chatJid: string,
    options: { includeProviderUsage?: boolean; includeProviderDiagnostics?: boolean; includeCatalogue?: boolean } = {},
  ): Promise<AvailableModelsResult> {
    // Passive UI refreshes should not hydrate a cold runtime just to render
    // model state for the picker.
    const session = this.options.getDurableSession === undefined ? this.options.pool.get(chatJid)?.runtime.session ?? null : null;
    const persistedState = this.options.getDurableSession !== undefined
      ? { current: await this.getCurrentModelLabel(chatJid), thinkingLevel: null }
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
      const thinkingLevels = getAvailableThinkingLevelsForModel(model as Model<any>);
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
        thinking_level_labels: thinkingLevels.map((level) => formatThinkingLevelForDisplay(level, model as Model<any>)),
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
    const baseThinkingLevels: string[] = session && typeof (session as AgentSession & { getAvailableThinkingLevels?: () => string[] }).getAvailableThinkingLevels === "function"
      ? (session as AgentSession & { getAvailableThinkingLevels: () => string[] }).getAvailableThinkingLevels()
      : ["off"];
    const availableThinkingLevels: string[] = currentModelDescriptor
      ? getAvailableThinkingLevelsForModel(currentModelDescriptor, baseThinkingLevels)
      : baseThinkingLevels;
    const activeProvider = session?.model?.provider ?? currentModelOption?.provider ?? null;
    const includeProviderUsage = options.includeProviderUsage !== false;
    const providerUsage = includeProviderUsage && activeProvider
      ? await peekProviderUsageForRuntime(this.options.modelRuntime, activeProvider, { allowStale: true })
      : null;
    if (includeProviderUsage && activeProvider && !peekProviderUsage(activeProvider)) {
      this.warmProviderUsage(activeProvider);
    }
    const thinkingLevelLabel = thinkingLevel && currentModelDescriptor
      ? formatThinkingLevelForDisplay(thinkingLevel, currentModelDescriptor)
      : thinkingLevel;
    const availableThinkingLevelLabels = availableThinkingLevels.map((level) => currentModelDescriptor
      ? formatThinkingLevelForDisplay(level, currentModelDescriptor)
      : level);
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
      thinking_level_label: thinkingLevelLabel,
      thinking_policy: session ? getSessionThinkingPolicy(session) : null,
      supports_thinking: supportsThinking,
      available_thinking_levels: availableThinkingLevels,
      available_thinking_level_labels: availableThinkingLevelLabels,
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
      if (!binding.readModel) throw new Error("Durable model reader unavailable");
      const label = await binding.readModel();
      const separator = label?.indexOf("/") ?? -1;
      const physical = label && separator > 0
        ? this.options.modelRuntime.getPhysicalModel(label.slice(0, separator), label.slice(separator + 1))
        : undefined;
      const window = physical?.contextWindow;
      return { tokens: null, contextWindow: typeof window === "number" && Number.isFinite(window) && window > 0 ? window : null,
        percent: null, sessionGeneration: binding.sessionId, tokensAreAuthoritative: true };
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
    return buildSessionTreeSnapshot((await this.options.getOrCreateRuntime(chatJid)).session.sessionManager);
  }

  async saveSessionPosition(chatJid: string): Promise<string | null> {
    const durable = this.getDurableSession(chatJid);
    if (durable) return durable.readPosition();
    const session = (await this.options.getOrCreateRuntime(chatJid)).session;
    return session.sessionManager.getLeafId();
  }

  async restoreSessionPosition(chatJid: string, leafId: string | null): Promise<void> {
    if (this.options.getDurableSession !== undefined) throw new Error("Durable history navigation unavailable");
    if (leafId === null) return;
    const session = (await this.options.getOrCreateRuntime(chatJid)).session;
    const currentLeaf = session.sessionManager.getLeafId();
    if (currentLeaf === leafId) return;
    try {
      await session.navigateTree(leafId);
    } catch (err) {
      this.options.onError?.("Failed to restore session position", {
        operation: "restore_session_position",
        chatJid,
        leafId,
        err,
      });
    }
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

  async queueStreamingMessage(
    chatJid: string,
    text: string,
    behavior: "steer" | "followUp",
    admission?: { validate: () => void; signal?: AbortSignal },
  ): Promise<{ queued: boolean; error?: string }> {
    const check = () => { admission?.signal?.throwIfAborted(); admission?.validate(); };
    check();
    requireSingleUserDirectExecution("Direct queue mutation");
    revokeAddonLocalAgent(chatJid);
    const session = (await this.options.getOrCreateRuntime(chatJid)).session;
    check();
    // The SDK awaits input handlers before mutating its steering queue and has
    // no public admission hook there. Bound requests use the fenced durable
    // follow-up path rather than injecting into a streaming SDK session.
    if (admission) return { queued: false };
    if (!session.isStreaming) return { queued: false };

    const channel = detectChannel(chatJid);
    try {
      return await withChatContext(chatJid, channel, async () => {
        if (behavior === "followUp") {
          await promptWithContextPressureRetry(session, text, { streamingBehavior: "followUp" });
        } else {
          await session.prompt(text, { streamingBehavior: behavior });
        }
        return { queued: true };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { queued: false, error: message };
    }
  }

  /** Owner-authorized active-session steering. Durable authority stays in the family queue ledger. */
  async queueOwnedStreamingMessage(
    chatJid: string,
    text: string,
    behavior: "steer",
  ): Promise<{ queued: boolean; error?: string }> {
    requireOwnedSessionExecution(chatJid);
    const session = this.options.pool.get(chatJid)?.runtime.session;
    if (!session) return { queued: false };
    if (!session.isStreaming) return { queued: false };
    try {
      return await withChatContext(chatJid, detectChannel(chatJid), async () => {
        await session.prompt(text, { streamingBehavior: behavior });
        return { queued: true };
      });
    } catch (error) {
      return { queued: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Owner-authorized abort; checked again inside the execution identity immediately before mutation. */
  async abortOwnedRun(chatJid: string): Promise<AgentControlResult> {
    requireOwnedSessionExecution(chatJid);
    const runtime = this.options.pool.get(chatJid)?.runtime;
    if (!runtime || !(runtime.session.isStreaming || runtime.session.isCompacting || runtime.session.isRetrying || runtime.session.isBashRunning)) {
      return { status: "error", message: "No active response to abort." };
    }
    return await withChatContext(chatJid, detectChannel(chatJid), () =>
      (this.options.applyControlCommandFn ?? applyControlCommand)(runtime, this.options.modelRegistry, { type: "abort", raw: "/abort" }));
  }

  async removeQueuedFollowupMessage(chatJid: string, queuedContent?: string): Promise<boolean> {
    requireSingleUserDirectExecution("Direct queue mutation");
    const session = (await this.options.getOrCreateRuntime(chatJid)).session;
    if (!session.isStreaming) return false;

    const followups = [...session.getFollowUpMessages()];
    if (followups.length === 0) return false;

    const normalized = typeof queuedContent === "string" ? queuedContent.trim() : "";
    let removeIndex = -1;
    if (normalized) {
      removeIndex = followups.findIndex((item) => item === queuedContent || item.trim() === normalized);
    }
    if (removeIndex < 0) removeIndex = 0;

    const channel = detectChannel(chatJid);
    try {
      return await withChatContext(chatJid, channel, async () => {
        const cleared = session.clearQueue();
        const nextFollowups = cleared.followUp.filter((_, idx) => idx !== removeIndex);

        try {
          await this.restoreQueuedMessages(session, cleared.steering, nextFollowups);
        } catch (err) {
          try {
            session.clearQueue();
            await this.restoreQueuedMessages(session, cleared.steering, cleared.followUp);
          } catch (restoreErr) {
            this.options.onWarn?.("Failed to restore queued follow-up after removal error", {
              operation: "remove_queued_follow_up.restore",
              chatJid,
              err: restoreErr,
              originalError: err,
            });
          }
          throw err;
        }

        return true;
      });
    } catch (err) {
      this.options.onWarn?.("Failed to remove queued follow-up", {
        operation: "remove_queued_follow_up",
        chatJid,
        err,
      });
      return false;
    }
  }

  private async restoreQueuedMessages(
    session: AgentSession,
    steering: readonly string[],
    followUp: readonly string[],
  ): Promise<void> {
    const chatJid = getChatJid('');
    if (chatJid && (steering.length || followUp.length)) revokeAddonLocalAgent(chatJid);
    for (const steer of steering) {
      await session.prompt(steer, { streamingBehavior: "steer" });
    }
    for (const queued of followUp) {
      await promptWithContextPressureRetry(session, queued, { streamingBehavior: "followUp" });
    }
  }

  async applySlashCommand(chatJid: string, rawText: string): Promise<AgentControlResult> {
    requireSingleUserDirectExecution("Direct slash commands");
    revokeAddonLocalAgent(chatJid);
    const release = this.options.acquireCommandProtection?.(chatJid);
    try {
    this.options.clearAttachments(chatJid);
    const runtime = await this.options.getOrCreateRuntime(chatJid);
    const session = runtime.session;
    const channel = detectChannel(chatJid);
    const exec = this.options.executeSlashCommandFn ?? executeSlashCommand;
    const result = await withChatContext(chatJid, channel, () => exec(session, chatJid, rawText));
    if (result.refresh_runtime || runtime.session !== session) {
      await this.options.refreshRuntime(chatJid, runtime);
    }
    this.options.clearAttachments(chatJid);
    return result;
    } finally { release?.(); }
  }
}
