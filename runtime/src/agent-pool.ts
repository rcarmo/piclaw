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

import { mkdirSync } from "fs";
import { join } from "path";
import {
  type AgentSession,
  type AgentSessionRuntime,
  AuthStorage,
  ModelRegistry,
  SettingsManager,
  getAgentDir,
} from "@mariozechner/pi-coding-agent";

import { type AgentControlCommand, type AgentControlResult } from "./agent-control/index.js";
import { SESSIONS_DIR, WORKSPACE_DIR } from "./core/config.js";
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
import { type AvailableModelsResult } from "./agent-pool/runtime-facade.js";
import { createAgentPoolServices, type AgentPoolServices } from "./agent-pool/service-factory.js";
import { type AgentSessionManagerInstrumentationSnapshot, type PoolEntry } from "./agent-pool/session-manager.js";
import {
  type ChatBranchRecord,
  type SshConfig,
  type SshConfigApplyTiming,
  type SshConfigClearResult,
  type SshConfigSetResult,
  deleteSshConfig,
  getSshConfig,
  listRecentChatJids,
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
import { applyLiveSshConfig, clearLiveSshConfig, hasLiveChatSshSession, resolveSshCoreConfigFromChatConfig } from "./extensions/ssh-core.js";
import { createLogger } from "./utils/logger.js";

const log = createLogger("agent-pool");

export type {
  AgentOutput,
  AgentPoolOptions,
  RunAgentOptions,
  SidePromptOptions,
  SidePromptResult,
  TurnOutput,
} from "./agent-pool/contracts.js";

export interface AgentPoolRecoveryInstrumentationSnapshot {
  attemptsTotal: number;
  recoveredRuns: number;
  exhaustedRuns: number;
}

export interface AgentPoolMemoryInstrumentationSnapshot {
  cachedMainSessions: number;
  cachedSideSessions: number;
  activeForkBaseLeaves: number;
  activeChats: number;
  sessionManager: AgentSessionManagerInstrumentationSnapshot;
  recovery: AgentPoolRecoveryInstrumentationSnapshot;
}

/** How long (ms) an idle main session stays cached before being disposed. */
const DEFAULT_MAIN_IDLE_TTL = 3 * 60 * 1000; // 3 minutes
/** How long (ms) an idle side session stays cached before being disposed. */
const DEFAULT_SIDE_IDLE_TTL = 60 * 1000; // 1 minute
const DEFAULT_CLEANUP_INTERVAL = 30 * 1000; // check every 30 seconds
const DEFAULT_MAIN_SESSION_POOL_MAX_SIZE = 2;
// 512 MB: observed normal multi-session RSS peaks at 388–428 MB so 384 MB
// triggered pressure during ordinary work. 512 MB gives headroom above those
// peaks while still protecting against genuine memory stress.
const DEFAULT_MEMORY_PRESSURE_RSS_BYTES = 512 * 1024 * 1024;
// 60 s under genuine pressure: 30 s was too short — sessions were killed and
// immediately recreated, causing high churn with no net memory benefit.
const DEFAULT_MEMORY_PRESSURE_MAIN_IDLE_TTL = 60 * 1000;
const DEFAULT_MEMORY_PRESSURE_MAIN_SESSION_POOL_MAX_SIZE = 1;

function parsePositiveMs(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const MAIN_IDLE_TTL = parsePositiveMs(
  process.env.PICLAW_MAIN_SESSION_IDLE_TTL_MS ?? process.env.PICLAW_SESSION_IDLE_TTL_MS,
  DEFAULT_MAIN_IDLE_TTL,
);
const SIDE_IDLE_TTL = parsePositiveMs(
  process.env.PICLAW_SIDE_SESSION_IDLE_TTL_MS ?? process.env.PICLAW_SESSION_IDLE_TTL_MS,
  DEFAULT_SIDE_IDLE_TTL,
);
const CLEANUP_INTERVAL = parsePositiveMs(process.env.PICLAW_SESSION_CLEANUP_INTERVAL_MS, DEFAULT_CLEANUP_INTERVAL);
const MAIN_SESSION_POOL_MAX_SIZE = parseNonNegativeInt(
  process.env.PICLAW_MAIN_SESSION_POOL_MAX_SIZE ?? process.env.PICLAW_SESSION_POOL_MAX_SIZE,
  DEFAULT_MAIN_SESSION_POOL_MAX_SIZE,
);
const MEMORY_PRESSURE_RSS_BYTES = parseNonNegativeInt(
  process.env.PICLAW_MAIN_SESSION_PRESSURE_RSS_BYTES,
  DEFAULT_MEMORY_PRESSURE_RSS_BYTES,
);
const MEMORY_PRESSURE_MAIN_IDLE_TTL = parsePositiveMs(
  process.env.PICLAW_MAIN_SESSION_PRESSURE_IDLE_TTL_MS,
  DEFAULT_MEMORY_PRESSURE_MAIN_IDLE_TTL,
);
const MEMORY_PRESSURE_MAIN_SESSION_POOL_MAX_SIZE = parseNonNegativeInt(
  process.env.PICLAW_MAIN_SESSION_PRESSURE_POOL_MAX_SIZE,
  DEFAULT_MEMORY_PRESSURE_MAIN_SESSION_POOL_MAX_SIZE,
);
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
  private authStorage: AuthStorage;
  private modelRegistry: ModelRegistry;
  private settingsManager = SettingsManager.create(WORKSPACE_DIR, getAgentDir());
  private logsDir = join(WORKSPACE_DIR, "logs");
  private createSession?: AgentPoolOptions["createSession"];
  private createSideSession?: AgentPoolOptions["createSideSession"];
  private bashOperations = createTrackedBashOperations();
  private attachments: AgentPoolServices["attachments"];
  private sessionBinder: AgentPoolServices["sessionBinder"];
  private toolFactory: AgentPoolServices["toolFactory"];
  private turnCoordinator: AgentPoolServices["turnCoordinator"];
  private sessionManager: AgentPoolServices["sessionManager"];
  private branchManager: AgentPoolServices["branchManager"];
  private runtimeFacade: AgentPoolServices["runtimeFacade"];
  private sideStreamSimple?: NonNullable<AgentPoolOptions["sideStreamSimple"]>;

  constructor(options: AgentPoolOptions = {}) {
    this.createSession = options.createSession;
    this.createSideSession = options.createSideSession;
    this.authStorage = AuthStorage.create();
    this.modelRegistry = options.modelRegistry ?? ModelRegistry.create(this.authStorage);
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
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      settingsManager: this.settingsManager,
      workspaceDir: WORKSPACE_DIR,
      mainSessionMaxSize: MAIN_SESSION_POOL_MAX_SIZE,
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
    try { migrateProxmoxPortainerToKv(); } catch { /* migration is best-effort */ }
    mkdirSync(SESSIONS_DIR, { recursive: true });
    mkdirSync(this.logsDir, { recursive: true });
    this.cleanupTimer = setInterval(
      () => this.evictIdle(),
      CLEANUP_INTERVAL,
    );
  }

  private applyRateLimitRetryDefaults(): void {
    const settingsManager = this.settingsManager as SettingsManager & {
      getRetrySettings?: () => { enabled: boolean; maxRetries: number; baseDelayMs: number; maxDelayMs: number };
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

  setSessionBinder(binder?: (runtime: AgentSessionRuntime, chatJid: string) => Promise<void> | void): void {
    this.sessionBinder.setBinder(binder);
  }

  /** Run a prompt against the persistent session for `chatJid`. */
  async runAgent(prompt: string, chatJid: string, options: RunAgentOptions = {}): Promise<AgentOutput> {
    const output = await runAgentPrompt(prompt, chatJid, options, {
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

    const recovery = output.recovery;
    if (recovery) {
      this.recoveryStats.attemptsTotal += Math.max(0, recovery.attemptsUsed || 0);
      if (recovery.recovered) this.recoveryStats.recoveredRuns += 1;
      if (recovery.exhausted) this.recoveryStats.exhaustedRuns += 1;
    }

    return output;
  }

  async applyControlCommand(chatJid: string, command: AgentControlCommand): Promise<AgentControlResult> {
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
      modelRegistry: this.modelRegistry,
      sideStreamSimple: this.sideStreamSimple,
      onWarn: (message, details) => log.warn(message, details),
    });
  }

  /** Return available model labels and current model for a chat session. */
  async getAvailableModels(chatJid: string): Promise<AvailableModelsResult> {
    return this.runtimeFacade.getAvailableModels(chatJid);
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
    return this.runtimeFacade.restoreSessionPosition(chatJid, leafId);
  }

  async disposeChatSession(chatJid: string): Promise<void> {
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
    return this.branchManager.renameChatBranch(chatJid, options);
  }

  async pruneChatBranch(chatJid: string): Promise<ChatBranchRecord> {
    return this.branchManager.pruneChatBranch(chatJid);
  }

  async renameChatJid(
    oldJid: string,
    newJid: string,
  ): Promise<{ oldJid: string; newJid: string; branch: ChatBranchRecord }> {
    return this.branchManager.renameChatJid(oldJid, newJid);
  }

  async restoreChatBranch(
    chatJid: string,
    options: { agentName?: string | null } = {},
  ): Promise<ChatBranchRecord> {
    return this.branchManager.restoreChatBranch(chatJid, options);
  }

  async permanentPurgeChatBranch(
    chatJid: string,
  ): Promise<{ branch: ChatBranchRecord; removedSessionArtifacts: string[] }> {
    return this.branchManager.permanentPurgeChatBranch(chatJid);
  }

  async createForkedChatBranch(
    sourceChatJid: string,
    options: { agentName?: string | null } = {},
  ): Promise<ChatBranchRecord> {
    return this.branchManager.createForkedChatBranch(sourceChatJid, options);
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
    return {
      cachedMainSessions: this.pool.size,
      cachedSideSessions: this.sidePool.size,
      activeForkBaseLeaves: this.activeForkBaseLeafByChat.size,
      activeChats: this.branchManager.listActiveChats().length,
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
    behavior: "steer" | "followUp"
  ): Promise<{ queued: boolean; error?: string }> {
    return this.runtimeFacade.queueStreamingMessage(chatJid, text, behavior);
  }

  /** Remove one queued follow-up message (first content match) from an active session queue. */
  async removeQueuedFollowupMessage(chatJid: string, queuedContent?: string): Promise<boolean> {
    return this.runtimeFacade.removeQueuedFollowupMessage(chatJid, queuedContent);
  }

  /** Execute a raw slash command in the AgentSession (extension commands). */
  async applySlashCommand(chatJid: string, rawText: string): Promise<AgentControlResult> {
    return this.runtimeFacade.applySlashCommand(chatJid, rawText);
  }

  getSshConfig(chatJid: string): SshConfig | null {
    return getSshConfig(chatJid);
  }

  async setSshConfig(
    chatJid: string,
    config: Omit<SshConfig, "chat_jid" | "created_at" | "updated_at">,
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

  /** Return an existing session for read-only introspection, or create one if needed. */
  async getSessionForIntrospection(chatJid: string): Promise<AgentSession> {
    return this.getOrCreate(chatJid);
  }

  // ── internal ────────────────────────────────────────────

  private async getOrCreateRuntime(chatJid: string): Promise<AgentSessionRuntime> {
    const runtime = await this.sessionManager.getOrCreate(chatJid);
    const pressure = this.getMemoryPressureMode();
    if (pressure.active && !this.shuttingDown) {
      this.sessionManager.evictIdle({
        mainIdleTtlMs: pressure.mainIdleTtlMs,
        sideIdleTtlMs: SIDE_IDLE_TTL,
        mainSessionMaxSizeOverride: pressure.mainSessionMaxSizeOverride,
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
    const active = MEMORY_PRESSURE_RSS_BYTES > 0 && rssBytes >= MEMORY_PRESSURE_RSS_BYTES;
    if (this.memoryPressureActive !== active) {
      this.memoryPressureActive = active;
      log.info(active ? "Memory pressure mode enabled" : "Memory pressure mode cleared", {
        operation: "memory_pressure.mode_change",
        rssBytes,
        thresholdBytes: MEMORY_PRESSURE_RSS_BYTES,
        mainIdleTtlMs: active ? MEMORY_PRESSURE_MAIN_IDLE_TTL : MAIN_IDLE_TTL,
        mainSessionPoolMaxSize: active ? MEMORY_PRESSURE_MAIN_SESSION_POOL_MAX_SIZE : MAIN_SESSION_POOL_MAX_SIZE,
      });
    }

    return {
      active,
      mainIdleTtlMs: active ? Math.min(MAIN_IDLE_TTL, MEMORY_PRESSURE_MAIN_IDLE_TTL) : MAIN_IDLE_TTL,
      mainSessionMaxSizeOverride: active ? MEMORY_PRESSURE_MAIN_SESSION_POOL_MAX_SIZE : undefined,
    };
  }

  private evictIdle(): void {
    const pressure = this.getMemoryPressureMode();
    this.sessionManager.evictIdle({
      mainIdleTtlMs: pressure.mainIdleTtlMs,
      sideIdleTtlMs: SIDE_IDLE_TTL,
      mainSessionMaxSizeOverride: pressure.mainSessionMaxSizeOverride,
    });
  }
}
