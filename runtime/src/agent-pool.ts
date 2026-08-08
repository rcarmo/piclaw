/**
 * agent-pool.ts – Manages per-chat pi-agent sessions and orchestrates agent runs.
 *
 * The AgentPool is the central coordinator between inbound messages and the
 * pi-coding-agent SDK. It:
 *   - Maintains a map of chat JID → AgentSession (lazy-initialised).
 *   - Provides runAgent() which prompts the agent, streams events, records
 *     token usage, detects auto-compaction needs, and returns the result.
 *   - Handles slash commands by delegating to agent-pool/slash-command.ts.
 *   - Forwards agent-control commands (model switch, session management, etc.)
 *     to the agent-control module.
 *   - Manages session lifecycle: save/restore position (for scheduled tasks),
 *     clear sessions, reload resources.
 *   - Integrates the attachment registry for file-delivery tools.
 *
 * Consumers:
 *   - runtime.ts / runtime/message-loop.ts creates the AgentPool at startup
 *     and calls runAgent() for each inbound message.
 *   - task-scheduler.ts calls runAgent() for scheduled task execution.
 *   - channels/web.ts uses applyControlCommand() and agent status queries.
 *   - agent-control handlers call methods on AgentPool for session/model ops.
 */

import { mkdirSync, statSync } from "fs";
import { join } from "path";
import {
  type AgentSession,
  type AgentSessionRuntime,
  ModelRegistry,
  type ModelRuntime,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { Provider } from "@earendil-works/pi-ai";

import { type AgentControlCommand, type AgentControlResult } from "./agent-control/index.js";
import { getPiclawAgentDir } from "./core/agent-dir.js";
import { SESSIONS_DIR, WORKSPACE_DIR, getAgentLogConfig, getSessionPoolConfig } from "./core/config.js";
import { getChatChannel, getChatJid, getChatTurnId } from "./core/chat-context.js";
import { registerChannelDetector } from "./router.js";
import { createTrackedBashOperations } from "./tools/tracked-bash.js";
import { type ActiveChatAgent } from "./agent-pool/branch-manager.js";
import {
  type AgentOutput,
  type AgentPoolOptions,
  type RunAgentOptions,
  type SidePromptOptions,
  type SidePromptResult,
} from "./agent-pool/contracts.js";
import { runSidePrompt as runSidePromptInternal } from "./agent-pool/side-prompt-runner.js";
import { runAgentPrompt } from "./agent-pool/run-agent-orchestrator.js";
import { runWithProtectedRecoveryHandoff } from "./agent-pool/protected-recovery-handoff.js";
import {
  clearCompactionFailureBackoff,
  maybeAutoCompactSessionAfterTurn,
  resetCompactionSuccessCount,
} from "./agent-pool/compaction.js";
import { rotateSession, type SessionRotationResult } from "./session-rotation.js";
import { type AgentRuntimeFacade, type AvailableModelsResult } from "./agent-pool/runtime-facade.js";
import { createAgentPoolServices, type AgentPoolServices } from "./agent-pool/service-factory.js";
import { type AgentSessionManagerInstrumentationSnapshot, type PoolEntry } from "./agent-pool/session-manager.js";
import type { PiclawCredentialStore } from "./agent-pool/credential-store.js";
import { installLegacySessionAffinityCompatibility } from "./agent-pool/session-affinity-compat.js";
import {
  type ChatBranchRecord,
  type ChatOperationState,
  type MergeChatBranchIntoParentResult,
  type SshConfig,
  type SshConfigApplyTiming,
  type SshConfigClearResult,
  type SshConfigSetResult,
  cancelChatOperation,
  deleteSshConfig,
  getChatOperation,
  getSshConfig,
  listRecentChatJids,
  pruneOldTokenUsage,
  reclaimFreelistPages,
  shrinkDatabaseMemory,
  upsertSshConfig,
} from "./db.js";
import {
  extensionKvGet,
  extensionKvSet,
  extensionKvDelete,
  extensionKvList,
  extensionKvQuery,
  extensionKvClear,
  migrateProxmoxPortainerToKv,
} from "./db.js";
import { registerExtensionKvStore } from "./extension-kv-registry.js";
import { setSshToolHandlers } from "./extensions/ssh.js";
import { applyLiveSshConfig, clearLiveSshConfig, hasLiveChatSshConnection, hasLiveChatSshSession, resolveSshCoreConfigFromChatConfig } from "./extensions/ssh-core.js";
import { getKeychainEntry } from "./secure/keychain.js";
import { addLogSink, createLogger, debugSuppressedError, removeLogSink } from "./utils/logger.js";
import { startAgentLogCleanup } from "./agent-pool/logging.js";
import {
  SessionMutationGateway,
  SessionMutationRejectedError,
  sessionMutationAccess,
  type SessionMutationClass,
  type SessionMutationRequest,
} from "./agent-pool/session-mutation-gateway.js";

const log = createLogger("agent-pool");

export type {
  AgentOutput,
  AgentPoolOptions,
  RunAgentOptions,
  SidePromptOptions,
  SidePromptResult,
  TurnOutput,
} from "./agent-pool/contracts.js";
export type { SessionMutationClass, SessionMutationRequest } from "./agent-pool/session-mutation-gateway.js";

export type BoundSessionMutationRunner = <T>(
  mutation: Exclude<SessionMutationClass, "abort">,
  action: (runtime: AgentSessionRuntime) => Promise<T> | T,
) => Promise<T>;

export interface OperationCancellationControlResult {
  status: "cancelled" | "no_op";
  reason?: string;
  operation: ChatOperationState | null;
  physicallyAborted: boolean;
  abortResult?: AgentControlResult;
}

export interface AgentPoolRecoveryInstrumentationSnapshot {
  attemptsTotal: number;
  recoveredRuns: number;
  exhaustedRuns: number;
}

interface RuntimeInteropBridge {
  getChatJid?: (defaultValue?: string) => string;
  getChatChannel?: (defaultValue?: string) => string;
  getChatTurnId?: (defaultValue?: string) => string;
  registerChannelDetector?: (detector: (chatJid: string) => string | null) => () => void;
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
  sessionManager: AgentSessionManagerInstrumentationSnapshot;
  recovery: AgentPoolRecoveryInstrumentationSnapshot;
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


const DEFAULT_PROVIDER_RATE_LIMIT_MAX_RETRIES = 5;
const DEFAULT_PROVIDER_RATE_LIMIT_BASE_DELAY_MS = 5000;

/**
 * Manages a pool of persistent AgentSession instances keyed by chat JID.
 *
 * First invocation for a JID pays the warm-up cost (resource discovery,
 * model initialisation). Subsequent calls reuse the live session – no
 * process-spawn overhead, conversation context already loaded.
 */
export class AgentPool {
  private pool = new Map<string, PoolEntry>();
  private sidePool = new Map<string, PoolEntry>();
  private activeForkBaseLeafByChat = new Map<string, string | null>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private shuttingDown = false;
  private memoryPressureActive = false;
  private recoveryStats: AgentPoolRecoveryInstrumentationSnapshot = {
    attemptsTotal: 0,
    recoveredRuns: 0,
    exhaustedRuns: 0,
  };

  // Shared across all sessions (expensive to create, safe to reuse)
  private credentialStore: PiclawCredentialStore;
  private modelRuntime: ModelRuntime;
  private modelRegistry: ModelRegistry;
  private settingsManager = SettingsManager.create(WORKSPACE_DIR, getPiclawAgentDir());
  private logsDir = join(WORKSPACE_DIR, "logs");
  private createSession?: AgentPoolOptions["createSession"];
  private createSideSession?: AgentPoolOptions["createSideSession"];
  private bashOperations = createTrackedBashOperations({
    shellPath: () => this.settingsManager.getShellPath(),
  });
  private attachments: AgentPoolServices["attachments"];
  private sessionBinder: AgentPoolServices["sessionBinder"];
  private toolFactory: AgentPoolServices["toolFactory"];
  private turnCoordinator: AgentPoolServices["turnCoordinator"];
  private sessionManager: AgentPoolServices["sessionManager"];
  private branchManager: AgentPoolServices["branchManager"];
  private runtimeFacade: AgentPoolServices["runtimeFacade"];
  private sideStreamSimple?: NonNullable<AgentPoolOptions["sideStreamSimple"]>;
  private readonly config = getSessionPoolConfig();
  private readonly mutationGateway = new SessionMutationGateway();

  constructor(options: AgentPoolOptions) {
    this.createSession = options.createSession;
    this.createSideSession = options.createSideSession;
    if (!options.credentialStore || !options.modelRuntime) {
      throw new Error("AgentPool requires shared credentialStore and modelRuntime services");
    }
    this.credentialStore = options.credentialStore;
    this.modelRuntime = options.modelRuntime;
    this.modelRegistry = options.modelRegistry ?? new ModelRegistry(this.modelRuntime);
    installLegacySessionAffinityCompatibility(this.modelRegistry, (message, details) => log.warn(message, details));
    this.applyRateLimitRetryDefaults();
    ({
      attachments: this.attachments,
      sessionBinder: this.sessionBinder,
      toolFactory: this.toolFactory,
      turnCoordinator: this.turnCoordinator,
      sessionManager: this.sessionManager,
      runtimeFacade: this.runtimeFacade,
      branchManager: this.branchManager,
    } = createAgentPoolServices({
      pool: this.pool,
      sidePool: this.sidePool,
      activeForkBaseLeafByChat: this.activeForkBaseLeafByChat,
      authStorage: this.credentialStore,
      modelRuntime: this.modelRuntime,
      modelRegistry: this.modelRegistry,
      settingsManager: this.settingsManager,
      workspaceDir: WORKSPACE_DIR,
      mainSessionMaxSize: this.config.mainSessionPoolMaxSize,
      bashOperations: this.bashOperations,
      createSession: this.createSession,
      createSideSession: this.createSideSession,
      onInfo: (message, details) => log.info(message, details),
      onWarn: (message, details) => log.warn(message, details),
      onError: (message, details) => log.error(message, details),
    }));
    this.sideStreamSimple = options.sideStreamSimple;
    setSshToolHandlers({
      get: (chatJid) => this.getSshConfig(chatJid),
      isActive: (chatJid) => hasLiveChatSshConnection(chatJid),
      set: (chatJid, config) => this.setSshConfig(chatJid, config),
      clear: (chatJid) => this.clearSshConfig(chatJid),
    });
    registerExtensionKvStore({
      get: extensionKvGet,
      set: extensionKvSet,
      delete: extensionKvDelete,
      list: extensionKvList,
      query: extensionKvQuery,
      clear: extensionKvClear,
    });
    const runtimeInterop = ((globalThis as { __piclawRuntimeInterop?: RuntimeInteropBridge }).__piclawRuntimeInterop ||= {});
    runtimeInterop.getChatJid = getChatJid;
    runtimeInterop.getChatChannel = getChatChannel;
    runtimeInterop.getChatTurnId = getChatTurnId;
    runtimeInterop.registerChannelDetector = registerChannelDetector;
    runtimeInterop.getExtensionKvStore = () => ({
      get: extensionKvGet,
      set: extensionKvSet,
      delete: extensionKvDelete,
      list: extensionKvList,
      clear: extensionKvClear,
    });
    runtimeInterop.addLogSink = addLogSink;
    runtimeInterop.removeLogSink = removeLogSink;
    runtimeInterop.getKeychainEntry = getKeychainEntry;
    try { migrateProxmoxPortainerToKv(); } catch (e) { void e; /* migration is best-effort */ }
    mkdirSync(SESSIONS_DIR, { recursive: true });
    mkdirSync(this.logsDir, { recursive: true });
    const agentLogConfig = getAgentLogConfig();
    startAgentLogCleanup(this.logsDir, agentLogConfig.retentionMs, agentLogConfig.cleanupIntervalMs);
    this.cleanupTimer = setInterval(
      () => this.evictIdle(),
      this.config.cleanupIntervalMs,
    );
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

  private applyRateLimitRetryDefaults(): void {
    const settingsManager = this.settingsManager as SettingsManager & {
      getRetrySettings?: () => { enabled: boolean; maxRetries: number; baseDelayMs: number };
    };
    if (typeof settingsManager.getRetrySettings !== "function") return;
    const originalGetRetrySettings = settingsManager.getRetrySettings.bind(settingsManager);
    settingsManager.getRetrySettings = () => {
      const settings = originalGetRetrySettings();
      return {
        ...settings,
        maxRetries: Math.max(settings.maxRetries ?? 0, DEFAULT_PROVIDER_RATE_LIMIT_MAX_RETRIES),
        baseDelayMs: Math.max(settings.baseDelayMs ?? 0, DEFAULT_PROVIDER_RATE_LIMIT_BASE_DELAY_MS),
      };
    };
  }

  setSessionBinder(
    binder?: (runtime: AgentSessionRuntime, chatJid: string, mutate: BoundSessionMutationRunner) => Promise<void> | void,
  ): void {
    this.sessionBinder.setBinder(binder
      ? (runtime, chatJid) => binder(runtime, chatJid, (mutation, action) => (
          this.runSessionMutation(chatJid, mutation, {}, (_session, currentRuntime) => action(currentRuntime))
        ))
      : undefined);
  }

  /** Run a prompt against the persistent session for `chatJid`. */
  async runAgent(prompt: string, chatJid: string, options: RunAgentOptions = {}): Promise<AgentOutput> {
    let terminalOutputCommitted = false;
    const output = await this.mutationGateway.run(chatJid, "prompt", sessionMutationAccess(options), async () => {
      const result = await this.runAgentOwned(prompt, chatJid, options);
      if ((result.status === "success" || result.status === "tool_complete") && options.onTerminalOutput) {
        terminalOutputCommitted = await options.onTerminalOutput(result);
      } else if (result.requiresToolEnabledContinuation
        && options.protectedRecoveryHandoffMode === "durable_externalize"
        && options.onProtectedRecoveryHandoff) {
        terminalOutputCommitted = await options.onProtectedRecoveryHandoff(result);
      }
      return result;
    });

    if (terminalOutputCommitted && options.scheduleIdleAutoCompaction
      && (output.status === "success" || output.status === "tool_complete")) {
      await this.runPostTurnMaintenance(chatJid, options);
    }
    return output;
  }

  private async runPostTurnMaintenance(chatJid: string, options: RunAgentOptions): Promise<void> {
    try {
      await this.runSessionMutation(chatJid, "compaction", {}, (session) => (
        maybeAutoCompactSessionAfterTurn(session, chatJid, {
          onInfo: (message, details) => log.info(message, details),
          onWarn: (message, details) => log.warn(message, details),
        }, options.onEvent)
      ));
    } catch (error) {
      if (error instanceof SessionMutationRejectedError && error.reason === "legacy_conflict") {
        log.info("Skipped post-turn maintenance because durable successor owns the chat", {
          operation: "run_agent.post_turn_maintenance_successor_owned",
          chatJid,
        });
        return;
      }
      log.warn("Post-turn maintenance failed after terminal output commit", {
        operation: "run_agent.post_turn_maintenance_failed",
        chatJid,
        err: error,
      });
    }
  }

  private async runAgentOwned(prompt: string, chatJid: string, options: RunAgentOptions): Promise<AgentOutput> {
    // Acquire before session lookup: the cleanup timer can run after getOrCreate
    // returns but before AgentSession flips isStreaming at prompt start.
    const releaseEvictionProtection = this.sessionManager.acquireEvictionProtection(chatJid);
    try {
      const observedOutputs: AgentOutput[] = [];
      const runPrompt = (nextPrompt: string, nextOptions: RunAgentOptions) => runAgentPrompt(nextPrompt, chatJid, nextOptions, {
        getOrCreateRuntime: (nextChatJid) => this.getOrCreateRuntime(nextChatJid),
        turnCoordinator: this.turnCoordinator,
        clearAttachments: (nextChatJid) => this.attachments.clear(nextChatJid),
        takeAttachments: (nextChatJid) => this.attachments.take(nextChatJid),
        logsDir: this.logsDir,
        setActiveForkBaseLeaf: (nextChatJid, leafId) => this.activeForkBaseLeafByChat.set(nextChatJid, leafId),
        clearActiveForkBaseLeaf: (nextChatJid) => {
          this.activeForkBaseLeafByChat.delete(nextChatJid);
        },
        onInfo: (message, details) => log.info(message, details),
        onWarn: (message, details) => log.warn(message, details),
        onError: (message, details) => log.error(message, details),
      });

      const output = await runWithProtectedRecoveryHandoff(prompt, options, runPrompt, (observed) => {
        observedOutputs.push(observed);
      }, () => {
        if (!options.operationOwner) return false;
        const current = getChatOperation(chatJid);
        return current?.operationId !== options.operationOwner.operationId || Boolean(current.cancellation);
      });
      const recoveries = observedOutputs.map((observed) => observed.recovery).filter(Boolean);
      this.recoveryStats.attemptsTotal += recoveries.reduce(
        (sum, recovery) => sum + Math.max(0, recovery?.attemptsUsed || 0),
        0,
      );
      const handedOff = observedOutputs.some((observed) => observed.requiresToolEnabledContinuation);
      if ((output.status !== "error" && observedOutputs.some((observed) => observed.recovery?.recovered)) || handedOff) {
        this.recoveryStats.recoveredRuns += 1;
      }
      if (!handedOff && output.status === "error" && output.recovery?.exhausted) {
        this.recoveryStats.exhaustedRuns += 1;
      }
      return output;
    } finally {
      releaseEvictionProtection();
    }
  }

  async applyControlCommand(
    chatJid: string,
    command: AgentControlCommand,
    request: SessionMutationRequest = {},
  ): Promise<AgentControlResult> {
    const access = sessionMutationAccess(request);
    try {
      if (command.type === "abort") {
        return await this.mutationGateway.compareAndActAbort(chatJid, access, () => {
          const runtime = this.pool.get(chatJid)?.runtime;
          if (!runtime) return { status: "error", message: "No active session to abort." };
          return this.runtimeFacade.applyControlCommandToRuntime(chatJid, runtime, command);
        });
      }
      return await this.mutationGateway.run(chatJid, "control", access, () => (
        this.applyControlCommandOwned(chatJid, command)
      ));
    } catch (error) {
      if (error instanceof SessionMutationRejectedError) {
        return { status: "error", message: error.message };
      }
      throw error;
    }
  }

  async cancelOperationAndAbort(
    chatJid: string,
    expectedOperationId: string,
    cause = "remote_abort",
  ): Promise<OperationCancellationControlResult> {
    const operation = getChatOperation(chatJid);
    if (!operation) {
      return { status: "no_op", reason: "no_active_operation", operation: null, physicallyAborted: false };
    }
    if (operation.operationId !== expectedOperationId) {
      return { status: "no_op", reason: "operation_mismatch", operation, physicallyAborted: false };
    }
    if (operation.cancellation) {
      return { status: "no_op", reason: "already_cancelled", operation, physicallyAborted: false };
    }

    const owner = {
      operationId: operation.operationId,
      sourceSeq: operation.sourceSeq,
      phase: operation.phase,
      generation: operation.generation,
    };
    const abort = await this.mutationGateway.cancelAndActAbort(
      chatJid,
      { scope: "operation", owner },
      () => cancelChatOperation(chatJid, owner, {
        cause,
        requestedAt: new Date().toISOString(),
      }),
      (cancellation) => cancellation.status === "applied",
      () => {
        const runtime = this.pool.get(chatJid)?.runtime;
        if (!runtime) return { status: "error", message: "No active session to abort." } as AgentControlResult;
        return this.runtimeFacade.applyControlCommandToRuntime(chatJid, runtime, { type: "abort", raw: "/abort" });
      },
    );
    const cancellation = abort.cancellation;
    if (cancellation.status !== "applied") {
      return {
        status: "no_op",
        reason: cancellation.reason,
        operation: getChatOperation(chatJid),
        physicallyAborted: false,
      };
    }
    const abortResult = abort.result;
    return {
      status: "cancelled",
      operation: cancellation.operation,
      physicallyAborted: abort.acted && abortResult?.status === "success",
      ...(abortResult ? { abortResult } : {}),
    };
  }

  private async applyControlCommandOwned(chatJid: string, command: AgentControlCommand): Promise<AgentControlResult> {
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
    return runSidePromptInternal(chatJid, prompt, options, {
      getOrCreate: (nextChatJid) => this.getOrCreate(nextChatJid),
      getOrCreateSideRuntime: (nextChatJid) => this.getOrCreateSideRuntime(nextChatJid),
      syncSideSessionFromMain: (mainSession, sideRuntime) => this.syncSideSessionFromMain(mainSession, sideRuntime),
      modelRuntime: this.modelRuntime,
      sideStreamSimple: this.sideStreamSimple,
      onWarn: (message, details) => log.warn(message, details),
    });
  }

  /** Return available model labels and current model for a chat session. */
  async getAvailableModels(chatJid: string): Promise<AvailableModelsResult> {
    return this.runtimeFacade.getAvailableModels(chatJid);
  }

  setProviderUsageRefreshListener(
    listener: Parameters<AgentRuntimeFacade["setProviderUsageRefreshListener"]>[0],
  ): void {
    this.runtimeFacade.setProviderUsageRefreshListener(listener);
  }

  /** Return the current context token usage for a chat session, or null if unknown. */
  async getContextUsageForChat(chatJid: string): Promise<{
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
  } | null> {
    return this.runtimeFacade.getContextUsageForChat(chatJid);
  }

  scheduleRecentChatWarmup(options: { limit?: number; excludeChatJids?: string[] } = {}): string[] {
    if (this.shuttingDown) return [];
    const shouldSkipWarmupChat = (chatJid: string): boolean => (
      chatJid.startsWith("dream:")
      || chatJid.startsWith("control:")
      || chatJid.startsWith("web:ipc-")
    );
    const targetCount = Math.max(1, Math.min(8, Math.trunc(options.limit ?? 3) || 3));
    const excluded = new Set(
      Array.isArray(options.excludeChatJids)
        ? options.excludeChatJids.map((jid) => String(jid || "").trim()).filter(Boolean)
        : [],
    );
    const cooldownByChat = ((this as any).__piclawRecentWarmupCooldownByChat ||= new Map<string, number>()) as Map<string, number>;
    const now = Date.now();
    for (const [chatJid, lastQueuedAt] of cooldownByChat) {
      if (now - lastQueuedAt >= 30_000) {
        cooldownByChat.delete(chatJid);
      }
    }

    const scheduled: string[] = [];
    const seen = new Set<string>();
    let fetchLimit = Math.min(100, Math.max(targetCount * 4, targetCount));

    while (scheduled.length < targetCount) {
      const candidates = listRecentChatJids(fetchLimit, {
        excludeChatJids: [...excluded, ...seen],
      });
      for (const chatJid of candidates) {
        if (seen.has(chatJid)) continue;
        seen.add(chatJid);
        if (excluded.has(chatJid)) continue;
        if (shouldSkipWarmupChat(chatJid)) continue;
        if (this.pool.has(chatJid)) continue;
        if (now - (cooldownByChat.get(chatJid) ?? 0) < 30_000) continue;
        scheduled.push(chatJid);
        if (scheduled.length >= targetCount) break;
      }

      if (scheduled.length >= targetCount || fetchLimit >= 100 || candidates.length < fetchLimit) {
        break;
      }

      const nextFetchLimit = Math.min(100, fetchLimit * 2);
      if (nextFetchLimit === fetchLimit) {
        break;
      }
      fetchLimit = nextFetchLimit;
    }

    // Only record a cooldown / return chats that actually entered the prewarm
    // queue. prewarm() may reject a candidate (already queued, in flight, or
    // within its per-chat cooldown) and we must not consume a slot or suppress
    // backfill for those.
    const actuallyScheduled: string[] = [];
    for (const chatJid of scheduled) {
      if (this.sessionManager.prewarm(chatJid, { mode: "lightweight" })) {
        cooldownByChat.set(chatJid, now);
        actuallyScheduled.push(chatJid);
      }
    }

    return actuallyScheduled;
  }

  scheduleChatWarmup(chatJid: string, options: { priority?: boolean } = {}): boolean {
    return this.sessionManager.prewarm(chatJid, options);
  }

  getSessionTreeForChat(chatJid: string): { leafId: string | null; nodes: unknown[]; flat?: boolean; total?: number; capped?: boolean } | null {
    return this.runtimeFacade.getSessionTreeForChat(chatJid);
  }

  /**
   * Save the current session tree position so it can be restored later.
   * Used by the scheduler to isolate task execution in a side branch.
   */
  async saveSessionPosition(chatJid: string): Promise<string | null> {
    return this.runtimeFacade.saveSessionPosition(chatJid);
  }

  /**
   * Restore the session tree to a previously saved position.
   * Navigates back to the saved leaf, leaving the task's output in a side branch.
   */
  async restoreSessionPosition(chatJid: string, leafId: string | null): Promise<void> {
    return this.mutationGateway.runInheritedOrLegacy(chatJid, "session_tree", () => (
      this.runtimeFacade.restoreSessionPosition(chatJid, leafId)
    ));
  }

  async disposeChatSession(chatJid: string): Promise<void> {
    await this.mutationGateway.runInheritedOrLegacy(chatJid, "lifecycle", () => (
      this.sessionManager.recreate(chatJid)
    ));
  }

  async runSessionMutation<T>(
    chatJid: string,
    mutation: Exclude<SessionMutationClass, "abort">,
    request: SessionMutationRequest,
    action: (session: AgentSession, runtime: AgentSessionRuntime) => Promise<T> | T,
  ): Promise<T> {
    const access = request.operationOwner
      ? sessionMutationAccess(request)
      : this.mutationGateway.currentAccess(chatJid) ?? sessionMutationAccess(request);
    return this.mutationGateway.run(chatJid, mutation, access, async () => {
      const runtime = await this.getOrCreateRuntime(chatJid);
      return await action(runtime.session, runtime);
    });
  }

  async emergencyRotateSession(
    chatJid: string,
    emergencyReason: string,
    request: SessionMutationRequest = {},
  ): Promise<SessionRotationResult> {
    try {
      return await this.mutationGateway.run(chatJid, "rotation", sessionMutationAccess(request), () => (
        this.emergencyRotateSessionOwned(chatJid, emergencyReason)
      ));
    } catch (error) {
      if (error instanceof SessionMutationRejectedError) {
        return { status: "error", reason: "automatic", compacted: false, message: error.message };
      }
      throw error;
    }
  }

  private async emergencyRotateSessionOwned(chatJid: string, emergencyReason: string): Promise<SessionRotationResult> {
    const runtime = await this.getOrCreateRuntime(chatJid);
    const result = await rotateSession(runtime.session, runtime, {
      reason: "automatic",
      skipCompaction: true,
      emergencyReason,
      chatJid,
    });
    if (result.status === "success") {
      clearCompactionFailureBackoff(chatJid);
      resetCompactionSuccessCount(chatJid);
      await this.sessionManager.refreshRuntime(chatJid, runtime);
    }
    return result;
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
    return this.runtimeFacade.isActive(chatJid);
  }

  private ensureBranchRegistration(chatJid: string, session?: AgentSession | null): ChatBranchRecord {
    return this.branchManager.ensureBranchRegistration(chatJid, session);
  }

  async renameChatBranch(
    chatJid: string,
    options: { agentName?: string | null } = {},
  ): Promise<ChatBranchRecord> {
    return this.mutationGateway.runInheritedOrLegacy(chatJid, "lifecycle", () => (
      this.branchManager.renameChatBranch(chatJid, options)
    ));
  }

  async pruneChatBranch(chatJid: string): Promise<ChatBranchRecord> {
    return this.mutationGateway.runInheritedOrLegacy(chatJid, "lifecycle", () => (
      this.branchManager.pruneChatBranch(chatJid)
    ));
  }

  async mergeChatBranchIntoParent(chatJid: string): Promise<MergeChatBranchIntoParentResult> {
    return this.mutationGateway.runInheritedOrLegacy(chatJid, "lifecycle", () => (
      this.branchManager.mergeChatBranchIntoParent(chatJid)
    ));
  }

  async renameChatJid(
    oldJid: string,
    newJid: string,
  ): Promise<{ oldJid: string; newJid: string; branch: ChatBranchRecord }> {
    return this.mutationGateway.runInheritedOrLegacy(oldJid, "lifecycle", () => (
      this.branchManager.renameChatJid(oldJid, newJid)
    ));
  }

  async restoreChatBranch(
    chatJid: string,
    options: { agentName?: string | null } = {},
  ): Promise<ChatBranchRecord> {
    return this.mutationGateway.runInheritedOrLegacy(chatJid, "lifecycle", () => (
      this.branchManager.restoreChatBranch(chatJid, options)
    ));
  }

  async permanentPurgeChatBranch(
    chatJid: string,
  ): Promise<{ branch: ChatBranchRecord; removedSessionArtifacts: string[] }> {
    return this.mutationGateway.runInheritedOrLegacy(chatJid, "lifecycle", () => (
      this.branchManager.permanentPurgeChatBranch(chatJid)
    ));
  }

  async createForkedChatBranch(
    sourceChatJid: string,
    options: { agentName?: string | null } = {},
  ): Promise<ChatBranchRecord> {
    return this.branchManager.createForkedChatBranch(sourceChatJid, options);
  }

  async createRootChatSession(agentName: string): Promise<ChatBranchRecord> {
    return this.branchManager.createRootChatSession(agentName);
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
      ...this.sidePool.values(),
    ]);
    return {
      cachedMainSessions: this.pool.size,
      cachedSideSessions: this.sidePool.size,
      activeForkBaseLeaves: this.activeForkBaseLeafByChat.size,
      activeChats: this.branchManager.listActiveChats().length,
      sessionResources,
      sessionManager: this.sessionManager.getInstrumentationSnapshot(),
      recovery: { ...this.recoveryStats },
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

  async queueStreamingMessage(
    chatJid: string,
    text: string,
    behavior: "steer" | "followUp",
    request: SessionMutationRequest & { beforeQueue?: () => void } = {},
  ): Promise<{ queued: boolean; error?: string }> {
    try {
      return await this.mutationGateway.run(chatJid, "queue", sessionMutationAccess(request), () => {
        request.beforeQueue?.();
        return this.runtimeFacade.queueStreamingMessage(chatJid, text, behavior);
      });
    } catch (error) {
      if (error instanceof SessionMutationRejectedError) return { queued: false, error: error.message };
      throw error;
    }
  }

  /** Remove one queued follow-up message (first content match) from an active session queue. */
  async removeQueuedFollowupMessage(
    chatJid: string,
    queuedContent?: string,
    request: SessionMutationRequest = {},
  ): Promise<boolean> {
    try {
      return await this.mutationGateway.run(chatJid, "queue", sessionMutationAccess(request), () => (
        this.runtimeFacade.removeQueuedFollowupMessage(chatJid, queuedContent)
      ));
    } catch (error) {
      if (error instanceof SessionMutationRejectedError) return false;
      throw error;
    }
  }

  /** Execute a raw slash command in the AgentSession (extension commands). */
  async applySlashCommand(
    chatJid: string,
    rawText: string,
    request: SessionMutationRequest = {},
  ): Promise<AgentControlResult> {
    try {
      return await this.mutationGateway.run(chatJid, "control", sessionMutationAccess(request), () => (
        this.runtimeFacade.applySlashCommand(chatJid, rawText)
      ));
    } catch (error) {
      if (error instanceof SessionMutationRejectedError) return { status: "error", message: error.message };
      throw error;
    }
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
    await this.sessionManager.shutdown();
  }

  /** Return a session for read-only introspection; cold hydration is legacy-fenced. */
  async getSessionForIntrospection(chatJid: string): Promise<AgentSession> {
    return this.mutationGateway.runInheritedOrLegacy(chatJid, "lifecycle", () => this.getOrCreate(chatJid));
  }

  // ── internal ────────────────────────────────────────────

  private async getOrCreateRuntime(chatJid: string): Promise<AgentSessionRuntime> {
    const runtime = await this.sessionManager.getOrCreate(chatJid);
    const pressure = this.getMemoryPressureMode();
    if (pressure.active && !this.shuttingDown) {
      this.sessionManager.evictIdle({
        mainIdleTtlMs: pressure.mainIdleTtlMs,
        sideIdleTtlMs: this.config.sideIdleTtlMs,
        mainSessionMaxSizeOverride: pressure.mainSessionMaxSizeOverride,
        protectedChatJids: [chatJid],
      });
    }
    return runtime;
  }

  private async getOrCreate(chatJid: string): Promise<AgentSession> {
    return (await this.getOrCreateRuntime(chatJid)).session;
  }

  private async getOrCreateSideRuntime(chatJid: string): Promise<AgentSessionRuntime> {
    return this.sessionManager.getOrCreateSide(chatJid);
  }

  private async syncSideSessionFromMain(mainSession: AgentSession, sideRuntime: AgentSessionRuntime): Promise<void> {
    return this.sessionManager.syncSideSessionFromMain(mainSession, sideRuntime);
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
    const pressure = this.getMemoryPressureMode();
    const poolSizeBefore = this.pool.size + this.sidePool.size;
    this.sessionManager.evictIdle({
      mainIdleTtlMs: pressure.mainIdleTtlMs,
      sideIdleTtlMs: this.config.sideIdleTtlMs,
      mainSessionMaxSizeOverride: pressure.mainSessionMaxSizeOverride,
    });
    const poolSizeAfter = this.pool.size + this.sidePool.size;
    // A3 + A4: After evicting sessions, release SQLite page-cache and force GC
    // so dead session objects (large fileEntries arrays) are reclaimed promptly.
    if (poolSizeAfter < poolSizeBefore || pressure.active) {
      shrinkDatabaseMemory();
      Bun.gc(true);
    }
  }
}
