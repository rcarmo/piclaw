import { admitSqliteWrite } from "./db/sqlite-async-admission.js";
/**
 * Host facade for admitted native dispatch, models/auth, metadata and resources.
 * SDK tasks/submissions and host accepted-source/terminal records own execution.
 * Supported execution requires admitted native operation ports.
 * Explicit legacy resource composition and migration readers remain
 * separate until their callers retire; ordinary startup selects native ports.
 */

import { existsSync, mkdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { createRequire } from "node:module";
import { hasNativeRouting, requireLegacyRoutingMutation } from "./db/native-routing-policy.js";
import {
  type AgentSession,
  type AgentSessionRuntime,
  ModelRegistry,
  type ModelRuntime,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { AssistantMessageEventStream, Context, Model, Provider, SimpleStreamOptions } from "@earendil-works/pi-ai";

import type { AgentControlCommand, AgentControlResult } from "./agent-control/index.js";
import { getNativeCommandCatalogue } from "./agent-control/native-control-capabilities.js";
import { getPiclawAgentDir } from "./core/agent-dir.js";
import { SESSIONS_DIR, WORKSPACE_DIR, getSessionPoolConfig } from "./core/config.js";
import { readAccessConfig } from "./core/config-access.js";
import { getChatChannel, getChatJid } from "./core/chat-context.js";
import { registerChannelDetector } from "./router.js";
import { createTrackedBashOperations } from "./tools/tracked-bash.js";
import { type ActiveChatAgent, type BranchMutationContext } from "./agent-pool/branch-manager.js";
import {
  type AgentOutput,
  type AgentPoolOptions,
  type SidePromptOptions,
  type SidePromptResult,
} from "./agent-pool/contracts.js";
import { type AgentRuntimeFacade, type AvailableModelsResult } from "./agent-pool/runtime-facade.js";
import { createAgentPoolServices, type AgentPoolServices } from "./agent-pool/service-factory.js";
import { MemoryReclamationGate } from "./agent-pool/memory-reclamation.js";
import { type AgentSessionManagerInstrumentationSnapshot, type PoolEntry } from "./agent-pool/session-manager.js";
import type { PiclawCredentialStore } from "./agent-pool/credential-store.js";
import { type ChatBranchRecord, type MergeChatBranchIntoParentResult, type SshConfig, type SshConfigApplyTiming, type SshConfigClearResult, type SshConfigSetResult, deleteSshConfig, getDb, getSshConfig, pruneOldTokenUsage, reclaimFreelistPages, restoreChatBranchIdentity, shrinkDatabaseMemory, upsertSshConfig } from "./db.js";
import { migrateProxmoxPortainerToKv } from "./db.js";
import { registerRootExtensionKvStore } from "./db/register-extension-kv.js";
import { setSshToolHandlers } from "./extensions/ssh.js";
import { applyLiveSshConfig, clearLiveSshConfig, hasLiveChatSshConnection, hasLiveChatSshSession, resolveSshCoreConfigFromChatConfig } from "./extensions/ssh-core.js";
import { getKeychainEntry } from "./secure/keychain.js";
import { addLogSink, createLogger, debugSuppressedError, removeLogSink } from "./utils/logger.js";

import { resolveProviderUsageAccountRef } from "./agent-pool/provider-usage.js";

const log = createLogger("agent-pool");
const requireLegacyCapture = createRequire(import.meta.url);

export type {
  AgentOutput,
  AgentPoolOptions,
  SidePromptOptions,
  SidePromptResult,
  TurnOutput,
} from "./agent-pool/contracts.js";

interface RuntimeInteropBridge {
  getChatJid?: (defaultValue?: string) => string;
  getChatChannel?: (defaultValue?: string) => string;
  registerChannelDetector?: (detector: (chatJid: string) => string | null) => () => void;
  getModelRegistry?: () => ModelRegistry;
  hasKnownModelCost?: (provider: string, modelId: string) => boolean;
  streamSimple?: (model: Model<any>, context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream;
  getSessionId?: (chatJid?: string) => string | null;
  getScopedModels?: (chatJid?: string) => ReadonlyArray<{ model: Model<any>; thinkingLevel?: string }>;
  getExtensionKvStore?: () => {
    get<T = unknown>(extensionId: string, key: string, scope?: string, scopeKey?: string): T | null;
    set(extensionId: string, key: string, value: unknown, scope?: string, scopeKey?: string): void;
    delete(extensionId: string, key: string, scope?: string, scopeKey?: string): boolean;
    list(extensionId: string, prefix?: string, scope?: string, scopeKey?: string): string[];
    clear(extensionId: string, scope?: string, scopeKey?: string): number;
  };
  addLogSink?: typeof addLogSink;
  removeLogSink?: typeof removeLogSink;
  getKeychainEntry?: typeof getKeychainEntry;
}

export interface AgentPoolSessionResourceInstrumentationSnapshot {
  sessionEntries: number;
  activeMessages: number;
  persistedSessionBytes: number;
  loadedSkills: number;
  loadedExtensions: number;
  registeredTools: number;
}

export interface AgentPoolMemoryInstrumentationSnapshot {
  cachedMainSessions: number;
  cachedSideSessions: number;
  activeForkBaseLeaves: number;
  activeChats: number;
  sessionResources?: AgentPoolSessionResourceInstrumentationSnapshot;
  sessionManager?: AgentSessionManagerInstrumentationSnapshot;
}

function collectSessionResourceInstrumentation(
  entries: Iterable<PoolEntry>,
): AgentPoolSessionResourceInstrumentationSnapshot {
  const snapshot: AgentPoolSessionResourceInstrumentationSnapshot = {
    sessionEntries: 0,
    activeMessages: 0,
    persistedSessionBytes: 0,
    loadedSkills: 0,
    loadedExtensions: 0,
    registeredTools: 0,
  };
  const collect = (metric: keyof AgentPoolSessionResourceInstrumentationSnapshot, read: () => number): void => {
    try {
      snapshot[metric] += read();
    } catch (error) {
      debugSuppressedError(log, "Failed to collect best-effort session resource metric", error, {
        operation: "agent_pool.memory_instrumentation.metric_failed",
        metric,
      });
    }
  };
  for (const entry of entries) {
    const session = entry.runtime.session;
    collect("sessionEntries", () => session.sessionManager.getEntries().length);
    collect("activeMessages", () => session.state.messages.length);
    collect("persistedSessionBytes", () => session.sessionFile ? statSync(session.sessionFile).size : 0);
    collect("loadedSkills", () => session.resourceLoader.getSkills().skills.length);
    collect("loadedExtensions", () => session.resourceLoader.getExtensions().extensions.length);
    collect("registeredTools", () => session.extensionRunner.getAllRegisteredTools().length);
  }
  return snapshot;
}

function stripJsonCommentsAndTrailingCommas(input: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] || "";
    const next = input[index + 1] || "";
    if (lineComment) {
      if (char === "\n") { lineComment = false; output += char; }
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") { blockComment = false; index += 1; }
      continue;
    }
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; output += char; continue; }
    if (char === "/" && next === "/") { lineComment = true; index += 1; continue; }
    if (char === "/" && next === "*") { blockComment = true; index += 1; continue; }
    output += char;
  }
  return output.replace(/,(\s*[}\]])/g, "$1");
}

function hasExplicitCostRates(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return ["input", "output", "cacheRead", "cacheWrite"].every((field) =>
    typeof record[field] === "number" && Number.isFinite(record[field]) && Number(record[field]) >= 0);
}

export function createKnownModelCostResolver(agentDir: string): (provider: string, modelId: string) => boolean {
  const modelsPath = join(agentDir, "models.json");
  let signature = "unread";
  let provenanceReliable = !existsSync(modelsPath);
  let configuredCosts = new Map<string, boolean>();
  const refresh = () => {
    const nextSignature = existsSync(modelsPath)
      ? (() => { const stat = statSync(modelsPath); return `${stat.mtimeMs}:${stat.size}`; })()
      : "missing";
    if (nextSignature === signature) return;
    try {
      const nextCosts = new Map<string, boolean>();
      if (nextSignature !== "missing") {
        const parsed = JSON.parse(stripJsonCommentsAndTrailingCommas(readFileSync(modelsPath, "utf8"))) as {
          providers?: Record<string, { models?: Array<{ id?: unknown; cost?: unknown }> }>;
        };
        for (const [provider, config] of Object.entries(parsed.providers || {})) {
          for (const model of config.models || []) {
            if (typeof model?.id !== "string") continue;
            nextCosts.set(`${provider}/${model.id}`, hasExplicitCostRates(model.cost));
          }
        }
      }
      configuredCosts = nextCosts;
      signature = nextSignature;
      provenanceReliable = true;
    } catch (error) {
      // Invalid current configuration invalidates provenance. Retry only after
      // the file changes so a hot path cannot flood logs.
      configuredCosts = new Map();
      signature = nextSignature;
      provenanceReliable = false;
      log.warn("Could not inspect models.json cost provenance; all models fail closed until the file changes", {
        operation: "agent_pool.runtime_interop.model_cost_provenance_failed",
        modelsPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  return (provider, modelId) => {
    refresh();
    if (!provenanceReliable) return false;
    return configuredCosts.get(`${provider}/${modelId}`) ?? true;
  };
}

/**
 * Manages a pool of persistent AgentSession instances keyed by chat JID.
 *
 * First invocation for a JID pays the warm-up cost (resource discovery,
 * model initialisation). Subsequent calls reuse the live session – no
 * process-spawn overhead, conversation context already loaded.
 */
export class AgentPool {
  assertLegacyCaptureIdle(): void {
    if (!this.sessionManager) throw Error("Native host has no resident legacy authority");
    this.sessionManager.assertLegacyCaptureIdle();
  }
  /** Explicit read-only resident capture; never selects or constructs a session. */
  async captureLegacyUpgradeBindings(options: import("./agent-pool/legacy-authority-capture.js").LegacyCaptureOptions) {
    const manager=this.sessionManager;
    if (!manager) throw Error("Native host has no resident legacy authority");
    // Capture must detach resident authority before its first filesystem await.
    // Load only at this explicit migration boundary, but without an import await
    // that would let caller mutations become the new baseline before capture.
    const { captureResidentLegacyUpgradeBindings } = requireLegacyCapture("./agent-pool/legacy-authority-capture.js") as typeof import("./agent-pool/legacy-authority-capture.js");
    return captureResidentLegacyUpgradeBindings(options, this.pool, () => manager.assertLegacyCaptureIdle());
  }
  inspectMcpSettings(policy?: unknown) { return this.mcpSettings.inspect(policy); }
  inspectMcpServers(edit?: unknown) { return this.mcpSettings.inspectServers(edit); }
  applyMcpServers(input: { revision: string; acknowledgeInterruptions: boolean }, authorise: () => void, signal: AbortSignal) {
    return this.mcpSettings.applyServers(input, authorise, signal);
  }
  applyMcpSettings(input: { policy: unknown; revision: string; acknowledgeInterruptions: boolean }, authorise: () => void) {
    return this.mcpSettings.apply(input, authorise);
  }
  private mcpSettings: AgentPoolServices["mcpSettings"];
  private pool = new Map<string, PoolEntry>();
  private activeForkBaseLeafByChat = new Map<string, string | null>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private shuttingDown = false;
  private memoryPressureActive = false;
  private readonly memoryReclamation?: MemoryReclamationGate;
  // Shared across all sessions (expensive to create, safe to reuse)
  private credentialStore: PiclawCredentialStore;
  private modelRuntime: ModelRuntime;
  private modelRegistry: ModelRegistry;
  private settingsManager = SettingsManager.create(WORKSPACE_DIR, getPiclawAgentDir());
  private attachments: AgentPoolServices["attachments"];
  private sessionBinder: AgentPoolServices["sessionBinder"];
  private sessionManager: AgentPoolServices["sessionManager"];
  private branchManager: AgentPoolServices["branchManager"];
  private runtimeFacade: AgentPoolServices["runtimeFacade"];
  private readonly releaseModelInterop: () => void;
  private readonly releaseSshHandlers: () => void;
  private readonly sidePromptDispatch?: AgentPoolOptions["dispatchSidePrompt"];
  private readonly dreamDispatch?:AgentPoolOptions['dispatchDreamOperation'];
  dispatchDreamOperation(request:import('./agent-pool/contracts.js').NativeDreamRequest):Promise<AgentOutput>{
    if(!this.durableApplication||!this.dreamDispatch)throw Error('Native Dream dispatcher unavailable');
    return this.dreamDispatch(Object.freeze({...request,assertCurrent:request.assertCurrent.bind(request)}));
  }
  private readonly addonAdmission?: AgentPoolOptions["prepareAddonOperation"];
  private readonly addonDispatch?: AgentPoolOptions["dispatchAddonOperation"];
  private readonly addonReconcile?:AgentPoolOptions['reconcileAddonOperation'];
  reconcileAddonOperation(operationId:string,expectedInputSequence?:number):Promise<AgentOutput|null>{
    if(!this.durableApplication||!this.addonReconcile)throw Error('Native add-on recovery unavailable');
    return this.addonReconcile(operationId,expectedInputSequence);
  }
  dispatchAddonOperation(operationId:string,signal:AbortSignal,expectedInputSequence?:number):Promise<AgentOutput>{
    if(!this.durableApplication||!this.addonDispatch)throw Error('Native add-on execution unavailable');
    return this.addonDispatch(operationId,signal,expectedInputSequence);
  }
  prepareAddonOperation(operationId:string,signal?:AbortSignal){
    if(!this.durableApplication||!this.addonAdmission)throw Error("Native add-on operation admission unavailable");
    signal?.throwIfAborted();return this.addonAdmission(operationId,signal);
  }
  private readonly config = getSessionPoolConfig();

  private readonly scheduledDispatch: AgentPoolOptions["dispatchScheduledAgent"];
  private readonly durableApplication: boolean;
  private readonly durableSessionLookup?: AgentPoolOptions["getDurableSession"];
  private readonly hostCommandDispatch?: AgentPoolOptions["dispatchHostCommand"];
  dispatchScheduledAgent(lease: import("./service-effects/contracts/scheduled-run-store.js").ScheduledRunLease): Promise<AgentOutput> {
    if (!this.scheduledDispatch) throw new Error("Durable scheduled dispatcher unavailable");
    return this.scheduledDispatch(lease);
  }

  constructor(options: AgentPoolOptions) {
    this.dreamDispatch=options.dispatchDreamOperation?.bind(options);
    this.addonAdmission = options.prepareAddonOperation?.bind(options);
    this.addonDispatch = options.dispatchAddonOperation?.bind(options);
    this.addonReconcile = options.reconcileAddonOperation?.bind(options);
    this.hostCommandDispatch = options.dispatchHostCommand?.bind(options);
    this.scheduledDispatch = options.dispatchScheduledAgent?.bind(options);
    this.sidePromptDispatch = options.dispatchSidePrompt?.bind(options);
    if (options.getDurableSession !== undefined && typeof options.getDurableSession !== "function") {
      throw new Error("Durable session lookup must be callable");
    }
    if (options.legacyCapture !== undefined && options.legacyCapture !== true) throw Error("Invalid legacy capture selection");
    if (options.legacyCapture && options.getDurableSession !== undefined) throw Error("Native host cannot select legacy capture composition");
    if (!options.legacyCapture && options.getDurableSession === undefined) throw Error("Native host requires a durable session lookup; legacy capture must be explicit");
    this.durableApplication = options.getDurableSession !== undefined;
    this.durableSessionLookup = options.getDurableSession?.bind(options);
    if (!options.credentialStore || !options.modelRuntime) {
      throw new Error("AgentPool requires shared credentialStore and modelRuntime services");
    }
    this.credentialStore = options.credentialStore;
    this.modelRuntime = options.modelRuntime;
    this.modelRegistry = options.modelRegistry ?? new ModelRegistry(this.modelRuntime);
    ({
      attachments: this.attachments,
      sessionBinder: this.sessionBinder,
      sessionManager: this.sessionManager,
      mcpSettings: this.mcpSettings,
      runtimeFacade: this.runtimeFacade,
      branchManager: this.branchManager,
    } = createAgentPoolServices({
      pool: this.pool,
      activeForkBaseLeafByChat: this.activeForkBaseLeafByChat,
      authStorage: this.credentialStore,
      modelRuntime: this.modelRuntime,
      modelRegistry: this.modelRegistry,
      settingsManager: this.settingsManager,
      workspaceDir: WORKSPACE_DIR,
      mainSessionMaxSize: this.config.mainSessionPoolMaxSize,
      getDurableSession: options.getDurableSession,
      ...(options.legacyCapture ? {legacyCapture:true} : {}),
      ...(options.getDurableSession === undefined ? {
        createSession: options.createSession,
        bashOperations:createTrackedBashOperations({shellPath:()=>this.settingsManager.getShellPath()}),
      } : {}),
      onInfo: (message, details) => log.info(message, details),
      onWarn: (message, details) => log.warn(message, details),
      onError: (message, details) => log.error(message, details),
    }));
    this.releaseSshHandlers = setSshToolHandlers({
      get: (chatJid) => this.getSshConfig(chatJid),
      isActive: (chatJid) => hasLiveChatSshConnection(chatJid),
      set: (chatJid, config) => this.setSshConfig(chatJid, config),
      clear: (chatJid) => this.clearSshConfig(chatJid),
    });
    registerRootExtensionKvStore();
    const runtimeInterop = ((globalThis as { __piclawRuntimeInterop?: RuntimeInteropBridge }).__piclawRuntimeInterop ||= {});
    runtimeInterop.getChatJid = getChatJid;
    runtimeInterop.getChatChannel = getChatChannel;
    runtimeInterop.registerChannelDetector = registerChannelDetector;
    runtimeInterop.hasKnownModelCost = createKnownModelCostResolver(getPiclawAgentDir());
    const getSessionEntry = (chatJid = getChatJid("")): PoolEntry | undefined => {
      const normalizedChatJid = String(chatJid || "").trim();
      return normalizedChatJid ? this.pool.get(normalizedChatJid) : undefined;
    };
    const ownedModelInterop: Pick<RuntimeInteropBridge, "getModelRegistry" | "streamSimple" | "getSessionId" | "getScopedModels"> = {
      getModelRegistry: () => this.modelRegistry,
      streamSimple: (model, context, options) => this.modelRuntime.streamSimple(model, context, options),
      getSessionId: (chatJid) => getSessionEntry(chatJid)?.runtime.session.sessionId ?? null,
      getScopedModels: (chatJid) => getSessionEntry(chatJid)?.runtime.session.scopedModels ?? [],
    };
    Object.assign(runtimeInterop, ownedModelInterop);
    this.releaseModelInterop = () => {
      for (const key of ["getModelRegistry", "streamSimple", "getSessionId", "getScopedModels"] as const)
        if (runtimeInterop[key] === ownedModelInterop[key]) delete runtimeInterop[key];
    };
    runtimeInterop.addLogSink = addLogSink;
    runtimeInterop.removeLogSink = removeLogSink;
    runtimeInterop.getKeychainEntry = getKeychainEntry;
    try { migrateProxmoxPortainerToKv(); } catch (e) { void e; /* migration is best-effort */ }
    if (options.getDurableSession === undefined) mkdirSync(SESSIONS_DIR, { recursive: true });
    if (this.sessionManager) {
      this.memoryReclamation = new MemoryReclamationGate();
      this.cleanupTimer = setInterval(() => this.evictIdle(), this.config.cleanupIntervalMs);
    }
    // B4: Prune old token_usage rows once on startup (90-day retention).
    // D3: Reclaim freelist pages left by the pruning (incremental vacuum).
    try {
      const pruned = pruneOldTokenUsage(90);
      if (pruned > 0) {
        log.info(`Pruned ${pruned} token_usage rows older than 90 days`);
        const remaining = reclaimFreelistPages();
        if (remaining === 0) log.info("Reclaimed all freelist pages after token_usage pruning");
      }
    } catch (e) { void e; }
  }

  setSessionBinder(binder?: (runtime: AgentSessionRuntime, chatJid: string) => Promise<void> | void): void {
    if (!this.sessionBinder) throw Error("Native host does not install a legacy session binder");
    this.sessionBinder.setBinder(binder);
  }

  async applyControlCommand(chatJid: string, command: AgentControlCommand): Promise<AgentControlResult> {
    if (command.type === "rollup") {
      try {
        const result = await this.mergeChatBranchIntoParent(chatJid);
        const counts = result.counts;
        return {
          status: "success",
          message: [
            `Rolled up ${result.source.chat_jid} into parent ${result.parent.chat_jid}.`,
            `Moved: ${counts.messages} message(s), ${counts.token_usage} token-usage row(s), ${counts.scheduled_tasks} scheduled task(s).`,
            "Note: Pi JSONL session files were not merged.",
          ].join("\n"),
          rolled_up_to: result.parent.chat_jid,
          source_chat_jid: result.source.chat_jid,
        };
      } catch (error) {
        return {
          status: "error",
          message: error instanceof Error ? error.message : String(error || "Failed to roll up branch."),
        };
      }
    }

    return this.runtimeFacade.applyControlCommand(chatJid, command);
  }

  async getCurrentModelLabel(chatJid: string): Promise<string | null> {
    return this.runtimeFacade.getCurrentModelLabel(chatJid);
  }

  async runSidePrompt(chatJid: string, prompt: string, options: SidePromptOptions = {}): Promise<SidePromptResult> {
    // Preserve the single-user boundary before budget bookkeeping or session
    // hydration. Side prompts remain single-user-only regardless of which
    // admission controls are installed around them.
    if (readAccessConfig().mode !== "single-user") {
      return { status: "error", result: null, thinking: null, error: "Side prompts are unavailable in multi-user mode.", model: null };
    }
    if (!this.sidePromptDispatch) return { status: "error", result: null, thinking: null, model: null, error: "Durable side prompt dispatcher unavailable" };
    try { return await this.sidePromptDispatch(chatJid, prompt, options); }
    catch { return { status: "error", result: null, thinking: null, model: null, error: "Native side prompt unavailable or failed" }; }
  }

  async probeCompactionModel(modelLabel: string) {
    return await this.runtimeFacade.probeCompactionModel(modelLabel);
  }

  /** Return available model labels and current model for a chat session. */
  async getAvailableModels(chatJid: string, options: { includeProviderUsage?: boolean; includeProviderDiagnostics?: boolean; includeCatalogue?: boolean } = {}): Promise<AvailableModelsResult> {
    return this.runtimeFacade.getAvailableModels(chatJid, options);
  }

  resolveBudgetProviderAccountRef(providerId: string): Promise<string | null> {
    return resolveProviderUsageAccountRef(this.modelRuntime, providerId);
  }

  setProviderUsageRefreshListener(
    listener: Parameters<AgentRuntimeFacade["setProviderUsageRefreshListener"]>[0],
  ): () => void {
    return this.runtimeFacade.setProviderUsageRefreshListener(listener);
  }

  /** Return the current context token usage for a chat session, or null if unknown. */
  async getContextUsageForChat(chatJid: string): Promise<{
    tokens: number | null;
    contextWindow: number | null;
    percent: number | null;
    sessionGeneration?: string;
    tokensAreAuthoritative?: true;
  } | null> {
    return this.runtimeFacade.getContextUsageForChat(chatJid);
  }

  getSessionGenerationForChat(chatJid: string): string | null {
    return this.runtimeFacade.getSessionGenerationForChat(chatJid);
  }

  getSessionTreeForChat(chatJid: string) {
    return this.runtimeFacade.getSessionTreeForChat(chatJid);
  }

  getSessionTreeSummaryForChat(chatJid: string): Promise<{ leafId: string | null; total: number } | null> {
    return this.runtimeFacade.getSessionTreeSummaryForChat(chatJid);
  }

  /**
   * Save the current session tree position so it can be restored later.
   * Used by the scheduler to isolate task execution in a side branch.
   */
  async saveSessionPosition(chatJid: string): Promise<string | null> {
    return this.runtimeFacade.saveSessionPosition(chatJid);
  }

  async disposeChatSession(chatJid: string): Promise<void> {
    if (!this.sessionManager) throw Error("Durable application does not construct legacy sessions");
    await this.sessionManager.recreate(chatJid);
  }

  hasProviderModels(provider: string): boolean {
    return this.runtimeFacade.hasProviderModels(provider);
  }

  registerModelProvider(
    providerName: string,
    config: Parameters<ModelRegistry["registerProvider"]>[1]
  ): void {
    this.runtimeFacade.registerModelProvider(providerName, config);
  }

  registerNativeModelProvider(provider: Provider): void {
    this.runtimeFacade.registerNativeModelProvider(provider);
  }

  getModelRegistry(): ModelRegistry {
    return this.modelRegistry;
  }

  resolveModelInput(input: string): { model?: string; error?: string } {
    return this.runtimeFacade.resolveModelInput(input);
  }

  isStreaming(chatJid: string): boolean {
    return this.runtimeFacade.isStreaming(chatJid);
  }

  isActive(chatJid: string): boolean {
    return this.sessionManager?.hasProtectedRun(chatJid) || this.runtimeFacade.isActive(chatJid);
  }

  private ensureBranchRegistration(chatJid: string, session?: AgentSession | null): ChatBranchRecord {
    return this.branchManager.ensureBranchRegistration(chatJid, session);
  }

  async renameChatBranch(
    chatJid: string,
    options: BranchMutationContext & { agentName?: string | null } = {},
  ): Promise<ChatBranchRecord> {
    return this.branchManager.renameChatBranch(chatJid, options);
  }

  async pruneChatBranch(chatJid: string, context: BranchMutationContext = {}): Promise<ChatBranchRecord> {
    return this.branchManager.pruneChatBranch(chatJid, context);
  }

  async mergeChatBranchIntoParent(chatJid: string, context: BranchMutationContext = {}): Promise<MergeChatBranchIntoParentResult> {
    if (this.durableApplication) throw new Error("Durable branch rollup unavailable");
    return this.branchManager.mergeChatBranchIntoParent(chatJid, context);
  }

  async renameChatJid(
    oldJid: string,
    newJid: string,
    context: BranchMutationContext = {},
  ): Promise<{ oldJid: string; newJid: string; branch: ChatBranchRecord }> {
    if (this.durableApplication) throw new Error("Durable chat identity rename unavailable");
    return this.branchManager.renameChatJid(oldJid, newJid, context);
  }

  async restoreChatBranch(
    chatJid: string,
    options: BranchMutationContext & { agentName?: string | null } = {},
  ): Promise<ChatBranchRecord> {
    if (this.durableApplication) {
      if (readAccessConfig().mode !== "single-user") throw Error("Native restore requires single-user policy");
      const database = getDb();
      const agentName = options.agentName, { signal, authorise } = options;
      const check = () => {
        if (readAccessConfig().mode !== "single-user" || getDb() !== database) throw Error("Native restore authority changed");
        authorise?.();
      };
      return admitSqliteWrite(database, () => {
        const restored = restoreChatBranchIdentity({ chat_jid: chatJid,
          ...(agentName !== undefined ? { agent_name: agentName } : {}) });
        const position = this.durableSessionLookup?.(restored.chat_jid);
        if (!position || position.branchId !== restored.branch_id) throw Error("Exact native restore binding unavailable");
        if (position.assertCurrent !== undefined && typeof position.assertCurrent !== "function") {
          throw Error("Exact native restore binding invalid");
        }
        position.assertCurrent?.();
        return restored;
      }, check, signal, undefined, () => {
        if (getDb() !== database) throw Error("Native restore database changed");
        if (database.inTransaction) throw Error("Native restore requires an outermost transaction");
        check();
      });
    }
    return this.branchManager.restoreChatBranch(chatJid, options);
  }

  async permanentPurgeChatBranch(
    chatJid: string,
    context: BranchMutationContext = {},
  ): Promise<{ branch: ChatBranchRecord; removedSessionArtifacts: string[] }> {
    if (this.durableApplication) {
      requireLegacyRoutingMutation(getDb(), "legacy purge");
      throw new Error("Durable branch purge unavailable");
    }
    return this.branchManager.permanentPurgeChatBranch(chatJid, context);
  }

  async createForkedChatBranch(
    sourceChatJid: string,
    options: { agentName?: string | null; requestId?: string } = {},
  ): Promise<ChatBranchRecord> {
    if (this.durableApplication) {
      requireLegacyRoutingMutation(getDb(), "legacy fork");
      throw new Error("Durable branch fork unavailable");
    }
    return this.branchManager.createForkedChatBranch(sourceChatJid, options);
  }

  async createRootChatSession(agentName: string, context: BranchMutationContext = {}): Promise<ChatBranchRecord> {
    if (this.durableApplication && !hasNativeRouting(getDb())) throw new Error("Durable root session creation unavailable");
    return this.branchManager.createRootChatSession(agentName, context);
  }

  listActiveChats(): ActiveChatAgent[] {
    return this.branchManager.listActiveChats();
  }

  listKnownChats(
    rootChatJid?: string | null,
    options?: { includeArchived?: boolean }
  ): ActiveChatAgent[] {
    return this.branchManager.listKnownChats(rootChatJid, options);
  }

  getMemoryInstrumentationSnapshot(): AgentPoolMemoryInstrumentationSnapshot {
    const sessionResources = collectSessionResourceInstrumentation([
      ...this.pool.values(),
    ]);
    return {
      cachedMainSessions: this.pool.size,
      cachedSideSessions: 0,
      activeForkBaseLeaves: this.activeForkBaseLeafByChat.size,
      activeChats: this.branchManager.listActiveChats().length,
      sessionResources,
      ...(this.sessionManager ? {sessionManager:this.sessionManager.getInstrumentationSnapshot()} : {}),
    };
  }

  findActiveChatByAgentName(agentName: string): ActiveChatAgent | null {
    return this.branchManager.findActiveChatByAgentName(agentName);
  }

  findChatByAgentName(agentName: string): { chat_jid: string; agent_name: string } | null {
    return this.branchManager.findChatByAgentName(agentName);
  }

  getAgentHandleForChat(chatJid: string): string {
    return this.branchManager.getAgentHandleForChat(chatJid);
  }

  /** Dispatch host slash commands through the admitted native command owner. */
  async applySlashCommand(chatJid: string, rawText: string): Promise<AgentControlResult> {
    if (this.hostCommandDispatch) {
      if (readAccessConfig().mode !== "single-user") throw Error("Native slash commands require single-user execution");
      return this.hostCommandDispatch(chatJid, rawText);
    }
    throw Error("Native slash command unavailable");
  }

  getSshConfig(chatJid: string): SshConfig | null {
    return getSshConfig(chatJid);
  }

  async setSshConfig(
    chatJid: string,
    config: Omit<SshConfig, "chat_jid" | "created_at" | "updated_at" | "last_used_at">,
  ): Promise<SshConfigSetResult> {
    const apply_timing: SshConfigApplyTiming = hasLiveChatSshSession(chatJid) ? "immediate" : "next_session";
    if (apply_timing === "immediate") {
      await applyLiveSshConfig(chatJid, resolveSshCoreConfigFromChatConfig(config));
    }
    const next = upsertSshConfig({ chat_jid: chatJid, ...config });
    return { config: next, apply_timing };
  }

  async clearSshConfig(chatJid: string): Promise<SshConfigClearResult> {
    const apply_timing: SshConfigApplyTiming = hasLiveChatSshSession(chatJid) ? "immediate" : "next_session";
    const deleted = deleteSshConfig(chatJid);
    if (apply_timing === "immediate") {
      await clearLiveSshConfig(chatJid);
    }
    return { deleted, apply_timing };
  }

  /** Gracefully shut down all sessions. */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    await this.sessionManager?.shutdown();
    this.releaseModelInterop();
    this.releaseSshHandlers();
  }

  /** The native backend owns recovery for the entire application, not legacy sessions. */
  isDurableRuntime(): boolean { return this.durableApplication; }

  async getDurableSessionMetadata(chatJid: string) {
    if (!this.durableApplication) return undefined;
    const position = this.durableSessionLookup?.(chatJid);
    if (!position) return null;
    if (position.readMetadata !== undefined && typeof position.readMetadata !== "function") {
      throw new Error("Durable metadata reader invalid");
    }
    if (!position.readMetadata) return null;
    const metadata = await position.readMetadata();
    return metadata ? { ...metadata, commandCatalogue: getNativeCommandCatalogue(position) } : null;
  }

  async getSessionForIntrospection(chatJid: string): Promise<AgentSession> {
    return this.getOrCreate(chatJid);
  }

  // ── internal ────────────────────────────────────────────

  private async getOrCreateRuntime(chatJid: string): Promise<AgentSessionRuntime> {
    if (!this.sessionManager) throw Error("Durable application does not construct legacy sessions");
    const runtime = await this.sessionManager.getOrCreate(chatJid);
    const pressure = this.getMemoryPressureMode();
    if (pressure.active && !this.shuttingDown) {
      const poolSizeBefore = this.pool.size;
      this.sessionManager.evictIdle({
        mainIdleTtlMs: pressure.mainIdleTtlMs,
        mainSessionMaxSizeOverride: pressure.mainSessionMaxSizeOverride,
        protectedChatJids: [chatJid],
      });
      if (this.pool.size < poolSizeBefore) this.memoryReclamation!.request();
    }
    return runtime;
  }

  private async getOrCreate(chatJid: string): Promise<AgentSession> {
    return (await this.getOrCreateRuntime(chatJid)).session;
  }

  private getMemoryPressureMode(): { active: boolean; mainIdleTtlMs: number; mainSessionMaxSizeOverride: number | undefined } {
    const rssBytes = process.memoryUsage.rss();
    const active = this.config.memoryPressureRssBytes > 0 && rssBytes >= this.config.memoryPressureRssBytes;
    if (this.memoryPressureActive !== active) {
      this.memoryPressureActive = active;
      log.info(active ? "Memory pressure mode enabled" : "Memory pressure mode cleared", {
        operation: "memory_pressure.mode_change",
        rssBytes,
        thresholdBytes: this.config.memoryPressureRssBytes,
        mainIdleTtlMs: active ? this.config.memoryPressureMainIdleTtlMs : this.config.mainIdleTtlMs,
        mainSessionPoolMaxSize: active ? this.config.memoryPressureMainSessionPoolMaxSize : this.config.mainSessionPoolMaxSize,
      });
    }

    return {
      active,
      mainIdleTtlMs: active ? Math.min(this.config.mainIdleTtlMs, this.config.memoryPressureMainIdleTtlMs) : this.config.mainIdleTtlMs,
      mainSessionMaxSizeOverride: active ? this.config.memoryPressureMainSessionPoolMaxSize : undefined,
    };
  }

  private evictIdle(): void {
    if (!this.sessionManager) return;
    const pressure = this.getMemoryPressureMode();
    const poolSizeBefore = this.pool.size;
    this.sessionManager.evictIdle({
      mainIdleTtlMs: pressure.mainIdleTtlMs,
      mainSessionMaxSizeOverride: pressure.mainSessionMaxSizeOverride,
    });
    const poolSizeAfter = this.pool.size;
    // Coalesce pressure/eviction requests and reclaim only after active runs
    // and asynchronous disposal drain; do not interrupt another chat's work.
    if (this.memoryReclamation!.shouldReclaim({
      pressure: pressure.active,
      evicted: poolSizeAfter < poolSizeBefore,
      busy: this.sessionManager.hasActiveMemoryReclamationWork(),
      now: Date.now(),
      intervalMs: this.config.cleanupIntervalMs,
    })) {
      shrinkDatabaseMemory();
      Bun.gc(true);
    }
  }
}
