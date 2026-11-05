import { AsyncLocalStorage } from "node:async_hooks";
/**
 * agent-pool/session-manager.ts – Main session lifecycle management for AgentPool.
 *
 * Extracts chat-session creation, idle eviction, and shutdown
 * mechanics out of the top-level AgentPool coordinator while preserving the
 * existing map-based cache structure used by callers and tests.
 */

import type { AgentSession, AgentSessionRuntime, ExtensionFactory, ModelRegistry, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { closeOpenAICodexWebSocketSessions } from "@earendil-works/pi-ai/api/openai-codex-responses";

import {
  claimDeferredBranchSeed,
  finalizeClaimedDeferredBranchSeed,
  getDeferredBranchSeedFingerprint,
  hasDeferredBranchSeed,
  restoreClaimedDeferredBranchSeed,
  seedSessionManagerFromDeferredBranchSeed,
} from "./branch-seeding.js";
import { getChatBranchByChatJid, getDb } from "../db.js";
import { readAccessConfig } from "../core/config-access.js";
import { ChatAccessDenied } from "../db/session-ownership.js";
import { readOwnedForkSeed, finishOwnedForkSeed } from "../db/owned-forks.js";
import { requireOwnedSessionExecution } from "./owned-session-access.js";
import { restoreSessionThinkingPolicy } from "./thinking-policy.js";
import { importAdoptedSession } from './adopted-session-import.js';
import type { createDefaultSession } from "./session.js";
import { forcePersistSessionFile } from "./session-file-persistence.js";

/** Cached session entry stored for each chat JID. */
export interface PoolEntry {
  runtime: AgentSessionRuntime;
  lastUsed: number;
}

/**
 * Protect freshly touched sessions from immediate timer-based eviction.
 * This avoids create→idle-cleanup→dispose churn when the cleanup loop runs
 * right after a session was created or used.
 */
const RECENT_USE_EVICTION_GRACE_MS = 1_000;

/** Dependencies required to manage AgentPool session lifecycles. */
export interface AgentSessionManagerOptions {
  getDurableSession?: import("./contracts.js").AgentPoolOptions["getDurableSession"];
  pool: Map<string, PoolEntry>;
  createSession?: (chatJid: string, sessionDir: string) => Promise<AgentSessionRuntime>;
  disposePersistence?: (runtime: AgentSessionRuntime) => Promise<void> | void;
  modelRuntime: ModelRuntime;
  modelRegistry?: ModelRegistry;
  settingsManager: SettingsManager;
  mainSessionMaxSize?: number | null;
  lightweightPrewarmSession?: (chatJid: string) => Promise<void>;
  createDefaultTools?: () => NonNullable<Parameters<typeof createDefaultSession>[1]["tools"]>;
  createCustomToolOverrides?: (chatJid: string) => unknown[];
  getSessionExtensionFactories?: (chatJid: string) => Promise<ExtensionFactory[]>;
  bindSession?: (runtime: AgentSessionRuntime, chatJid: string) => Promise<void>;
  onInfo?: (message: string, details: Record<string, unknown>) => void;
  onWarn?: (message: string, details: Record<string, unknown>) => void;
  onError?: (message: string, details: Record<string, unknown>) => void;
}

/**
 * Handles lifecycle operations for main AgentSession instances.
 */
export interface AgentSessionManagerInstrumentationSnapshot {
  branchSeedRealizationsInFlight: number;
  createInFlight: number;
  evictionProtectedChats: number;
  invalidDeferredSeedErrors: number;
  prewarmInFlight: number;
  queuedPrewarms: number;
  prewarmQueueLength: number;
  prewarmCooldowns: number;
}

export class AgentSessionManager {
  private readonly branchSeedRealizationInFlight = new Map<string, Promise<boolean>>();
  private readonly createInFlight = new Map<string, Promise<AgentSessionRuntime>>();
  private readonly idleMainDisposalsInFlight = new Map<string, Promise<void>>();
  private readonly invalidDeferredBranchSeedErrors = new Map<string, { error: Error; fingerprint: string | null }>();
  private readonly runtimeDisposeInFlight = new WeakMap<AgentSessionRuntime, Promise<unknown | null>>();
  private readonly prewarmInFlight = new Set<string>();
  private readonly queuedPrewarms = new Set<string>();
  private readonly prewarmQueue: Array<{ chatJid: string; mode: "full" | "lightweight" }> = [];
  private readonly prewarmCooldownByChat = new Map<string, number>();
  private readonly evictionProtectionCounts = new Map<string, number>();
  private prewarmLoopActive = false;
  private isShuttingDown = false;
  private mcpAdmissionsBlocked = false;
  private mcpAdmissionEpoch = 0;
  private readonly mcpLifecycleWork = new Set<Promise<unknown>>();
  private mcpSnapshotInFlight = false;
  private readonly lifecycleContext = new AsyncLocalStorage<boolean>();
  private shutdownInFlight?: Promise<void>;
  private readonly failedMcpDisposals = new Set<AgentSessionRuntime>();

  /** Register before callbacks run; include complete delivery/disposal tails. */
  private trackMcpLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const task = Promise.resolve().then(() => this.lifecycleContext.run(true, operation));
    this.mcpLifecycleWork.add(task);
    return task.finally(() => { this.mcpLifecycleWork.delete(task); });
  }

  private assertNonReentrantLifecycleTransition(): void {
    if (this.lifecycleContext.getStore()) throw new Error("Session lifecycle callbacks cannot await manager admission or transition operations.");
  }

  constructor(private readonly options: AgentSessionManagerOptions) {}

  private assertLegacySession(): void {
    if (this.options.getDurableSession !== undefined) throw new Error("Durable application does not construct legacy sessions");
  }

  /** Read-only capture also requires an external all-controller admission fence. */
  assertLegacyCaptureIdle(): void {
    if (this.isShuttingDown || this.mcpSnapshotInFlight || this.hasActiveMemoryReclamationWork() ||
      this.queuedPrewarms.size || this.prewarmLoopActive || this.failedMcpDisposals.size ||
      [...this.options.pool.values()].some(({ runtime }) =>
        runtime.session.isRetrying || runtime.session.hasPendingBashMessages || runtime.session.pendingMessageCount > 0))
      throw new Error("Legacy pool lifecycle/agent work has not drained");
  }

  /** Synchronous full GC must not interrupt protected runs or lifecycle work. */
  hasActiveMemoryReclamationWork(): boolean {
    return this.evictionProtectionCounts.size > 0 || this.prewarmInFlight.size > 0
      || this.pendingMcpLifecycleWork().length > 0
      || [...this.options.pool.values()].some(({ runtime }) =>
        runtime.session.isStreaming || runtime.session.isBashRunning || runtime.session.isCompacting);
  }

  /** Close admission synchronously; keep it closed after transition failure. */
  blockMcpAdmissions(): void {
    if (!this.mcpAdmissionsBlocked) this.mcpAdmissionEpoch++;
    this.mcpAdmissionsBlocked = true;
    this.queuedPrewarms.clear();
    this.prewarmQueue.length = 0;
  }

  assertMcpAdmission(epoch = this.mcpAdmissionEpoch): void {
    if (this.mcpAdmissionsBlocked || epoch !== this.mcpAdmissionEpoch) throw new Error("Session admission is blocked by an MCP engine transition.");
  }

  /** Host invokes only after all participants have reloaded successfully. */
  resumeMcpAdmissions(): void {
    this.assertNonReentrantLifecycleTransition();
    if (this.isShuttingDown) throw new Error("Session manager is shutting down.");
    if (this.failedMcpDisposals.size) throw new Error("MCP runtime disposal remains unresolved.");
    if (this.mcpSnapshotInFlight || this.pendingMcpLifecycleWork().length > 0) throw new Error("MCP lifecycle work has not drained.");
    this.mcpAdmissionsBlocked = false;
  }

  private pendingMcpLifecycleWork(): Promise<unknown>[] {
    return [...new Set([
      ...this.createInFlight.values(), ...this.branchSeedRealizationInFlight.values(),
      ...this.idleMainDisposalsInFlight.values(), ...this.mcpLifecycleWork,
    ])];
  }

  /** Drain pre-fence creation/lifecycle work before enumerating the pool. */
  async fenceMcpAndSnapshot(signal: AbortSignal): Promise<readonly AgentSessionRuntime[]> {
    this.assertNonReentrantLifecycleTransition();
    this.blockMcpAdmissions();
    if (this.mcpSnapshotInFlight) throw new Error("MCP session snapshot already in progress.");
    if (signal.aborted) throw new Error("MCP session snapshot cancelled.");
    this.mcpSnapshotInFlight = true;
    let onAbort!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new Error("MCP session snapshot cancelled."));
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      // Shutdown may enter after fencing. Drain again until no captured work
      // can still mutate the pool; admission stays closed throughout.
      while (true) {
        if (signal.aborted) throw new Error("MCP session snapshot cancelled.");
        const pending = this.pendingMcpLifecycleWork();
        if (!pending.length) break;
        await Promise.race([Promise.allSettled(pending), aborted]);
      }
      if (this.failedMcpDisposals.size) throw new Error("MCP runtime disposal remains unresolved.");
      return [...new Set([...this.options.pool.values()].map(entry => entry.runtime))];
    } finally {
      this.mcpSnapshotInFlight = false;
      signal.removeEventListener("abort", onAbort);
    }
  }

  /**
   * Remove only this captured runtime, then use normal public disposal.
   * Concurrent disposal is coalesced. Sequential quarantine deliberately
   * repeats teardown: a delayed public reload may have rebuilt extensions
   * since the first dispose, and those late resources must also be closed.
   */
  async quarantineMcpRuntime(runtime: AgentSessionRuntime): Promise<void> {
    this.assertNonReentrantLifecycleTransition();
    for (const [chatJid, entry] of this.options.pool) if (entry.runtime === runtime) this.options.pool.delete(chatJid);
    return this.trackMcpLifecycle(async () => {
      const error = await this.disposeRuntimeOnce(runtime, "Failed to dispose MCP transition session", { operation: "mcp_engine_switch.quarantine" });
      if (error) throw new Error("MCP session quarantine failed.");
    });
  }

  /**
   * Protect a chat from every idle/pool-limit eviction path while work is
   * pending or in flight. Protection is reference-counted for overlapping runs.
   */
  acquireEvictionProtection(chatJid: string): () => void {
    const normalized = String(chatJid || "").trim();
    if (!normalized) return () => {};
    this.evictionProtectionCounts.set(normalized, (this.evictionProtectionCounts.get(normalized) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = (this.evictionProtectionCounts.get(normalized) ?? 1) - 1;
      if (next > 0) this.evictionProtectionCounts.set(normalized, next);
      else this.evictionProtectionCounts.delete(normalized);
    };
  }

  /** Lifecycle callers must not archive while a run, hydration or disposal is in flight. */
  hasProtectedRun(chatJid: string): boolean {
    return this.evictionProtectionCounts.has(chatJid);
  }

  hasPendingSessionWork(chatJid: string): boolean {
    return this.createInFlight.has(chatJid)
      || this.branchSeedRealizationInFlight.has(chatJid) || this.evictionProtectionCounts.has(chatJid)
      || this.idleMainDisposalsInFlight.has(chatJid);
  }

  private getEvictionProtectedChatJids(explicit: string[] = []): string[] {
    return [...new Set([...explicit, ...this.evictionProtectionCounts.keys()])];
  }

  private getBlockingInvalidSeedError(chatJid: string): Error | null {
    const knownInvalidSeedState = this.invalidDeferredBranchSeedErrors.get(chatJid);
    if (!knownInvalidSeedState) return null;
    if (knownInvalidSeedState.fingerprint === getDeferredBranchSeedFingerprint(chatJid)) {
      return knownInvalidSeedState.error;
    }
    this.invalidDeferredBranchSeedErrors.delete(chatJid);
    return null;
  }

  private prunePrewarmCooldownEntries(now: number): void {
    for (const [chatJid, lastQueuedAt] of this.prewarmCooldownByChat) {
      if (now - lastQueuedAt >= 30_000) {
        this.prewarmCooldownByChat.delete(chatJid);
      }
    }
  }

  async refreshRuntime(chatJid: string, runtime: AgentSessionRuntime): Promise<void> {
    this.assertLegacySession();
    requireOwnedSessionExecution(chatJid);
    this.assertNonReentrantLifecycleTransition();
    this.assertMcpAdmission();
    const epoch = this.mcpAdmissionEpoch;
    return this.trackMcpLifecycle(() => this.refreshRuntimeAdmitted(chatJid, runtime, epoch));
  }

  private async refreshRuntimeAdmitted(chatJid: string, runtime: AgentSessionRuntime, epoch: number): Promise<void> {
    this.assertMcpAdmission(epoch);
    const entry = this.options.pool.get(chatJid);
    if (entry) entry.lastUsed = Date.now();
    await this.options.bindSession!(runtime, chatJid);
    requireOwnedSessionExecution(chatJid);
    this.assertMcpAdmission(epoch);
  }

  async getOrCreate(chatJid: string): Promise<AgentSessionRuntime> {
    this.assertLegacySession();
    requireOwnedSessionExecution(chatJid);
    this.assertNonReentrantLifecycleTransition();
    this.assertMcpAdmission();
    const epoch = this.mcpAdmissionEpoch;
    return this.trackMcpLifecycle(async () => {
      this.assertMcpAdmission(epoch);
      const runtime = await this.getOrCreateAdmitted(chatJid);
      requireOwnedSessionExecution(chatJid);
      this.assertMcpAdmission(epoch);
      return runtime;
    });
  }

  private async getOrCreateAdmitted(chatJid: string): Promise<AgentSessionRuntime> {
    const owner = requireOwnedSessionExecution(chatJid);
    this.assertMcpAdmission();
    const epoch = this.mcpAdmissionEpoch;
    if (owner) readOwnedForkSeed(getDb(), owner, chatJid);
    if (this.isShuttingDown) {
      throw new Error("Session manager is shutting down.");
    }
    const pendingIdleDispose = this.idleMainDisposalsInFlight.get(chatJid);
    if (pendingIdleDispose) {
      await pendingIdleDispose;
    }

    requireOwnedSessionExecution(chatJid);
    this.assertMcpAdmission(epoch);
    const knownInvalidSeedError = this.getBlockingInvalidSeedError(chatJid);
    if (knownInvalidSeedError) {
      throw knownInvalidSeedError;
    }

    const pendingCreate = this.createInFlight.get(chatJid);
    if (pendingCreate) {
      const runtime = await pendingCreate;
      requireOwnedSessionExecution(chatJid);
      this.assertMcpAdmission(epoch);
      return runtime;
    }

    const existing = this.options.pool.get(chatJid);
    if (existing) {
      existing.lastUsed = Date.now();
      const releaseHydrationProtection = this.acquireEvictionProtection(chatJid);
      try {
        await this.realizeDeferredBranchSeed(chatJid, existing.runtime);
        requireOwnedSessionExecution(chatJid);
        this.assertMcpAdmission(epoch);
        return existing.runtime;
      } catch (error) {
        await this.disposeMainRuntimeAfterError(chatJid, existing.runtime, "get_or_create.realize_existing_after_error");
        throw error;
      } finally { releaseHydrationProtection(); }
    }

    const releaseCreationProtection = this.acquireEvictionProtection(chatJid);
    const task = (async () => {
      this.options.onInfo?.("Creating new session", {
        operation: "get_or_create.create_main_session",
        chatJid,
      });

      if (this.options.modelRegistry) {
        const { installLegacySessionAffinityCompatibility } = await import("./session-affinity-compat.js");
        installLegacySessionAffinityCompatibility(this.options.modelRegistry, (message, details) => this.options.onWarn?.(message, details));
      }
      const { ensureSessionDir, createDefaultSession } = await import("./session.js");
      const chatSessionDir = ensureSessionDir(chatJid);

      const extensionFactories = await this.options.getSessionExtensionFactories?.(chatJid) ?? [];
      requireOwnedSessionExecution(chatJid);
      this.assertMcpAdmission(epoch);
      const runtime = this.options.createSession
        ? await this.options.createSession(chatJid, chatSessionDir)
        : await createDefaultSession(chatJid, {
            modelRuntime: this.options.modelRuntime,
            settingsManager: this.options.settingsManager,
            tools: this.options.createDefaultTools!(),
            customTools: this.options.createCustomToolOverrides?.(chatJid) ?? [],
            extensionFactories,
          });

      if (this.isShuttingDown || this.mcpAdmissionsBlocked || epoch !== this.mcpAdmissionEpoch) {
        await this.disposeRuntimeOnce(runtime, "Failed to dispose newly created session during shutdown or MCP switch", {
          operation: "get_or_create.dispose_during_shutdown",
          chatJid,
        });
        throw new Error("Session creation invalidated by shutdown or MCP transition.");
      }

      this.options.pool.set(chatJid, { runtime, lastUsed: Date.now() });
      this.enforceMainSessionPoolLimit({ protectedChatJids: [chatJid] });
      try {
        const realizedDeferredSeed = await this.realizeDeferredBranchSeed(chatJid, runtime);
        if (!realizedDeferredSeed) {
          await this.applyDefaultModel(runtime.session);
        }
        await this.refreshRuntimeAdmitted(chatJid, runtime, epoch);
        this.assertMcpAdmission(epoch);
        this.options.onInfo?.("Session ready", {
          operation: this.options.createSession ? "get_or_create.create_main_session" : "get_or_create.create_default_session",
          chatJid,
          poolSize: this.options.pool.size,
        });
        return runtime;
      } catch (err) {
        await this.disposeMainRuntimeAfterError(chatJid, runtime, "get_or_create.dispose_after_error");
        throw err;
      }
    })().finally(() => {
      this.createInFlight.delete(chatJid);
      releaseCreationProtection();
    });

    this.createInFlight.set(chatJid, task);
    return await task;
  }

  async recreate(chatJid: string): Promise<void> {
    this.assertNonReentrantLifecycleTransition();
    this.assertMcpAdmission();
    const epoch = this.mcpAdmissionEpoch;
    return this.trackMcpLifecycle(async () => {
      this.assertMcpAdmission(epoch);
      await this.disposeEntry(chatJid, "recreate.dispose_main_session");
    });
  }

  /**
   * Remove any pending (not-yet-realized) prewarm for a chat. Used by
   * branch prune so a queued warmup cannot materialize a blank runtime
   * (or realize the deferred seed) for an archived chat.
   */
  cancelPrewarm(chatJid: string): void {
    const normalized = String(chatJid || "").trim();
    if (!normalized) return;
    this.queuedPrewarms.delete(normalized);
    const idx = this.prewarmQueue.findIndex((entry) => entry.chatJid === normalized);
    if (idx >= 0) this.prewarmQueue.splice(idx, 1);
  }

  prewarm(chatJid: string, options: { priority?: boolean; mode?: "full" | "lightweight" } = {}): boolean {
    if (this.options.getDurableSession !== undefined) return false;
    // Queue provenance must be durable before background multi-user hydration is enabled.
    if (readAccessConfig().mode !== "single-user") return false;
    if (this.isShuttingDown || this.mcpAdmissionsBlocked) return false;
    const normalizedChatJid = String(chatJid || "").trim();
    if (!normalizedChatJid) return false;
    if (this.getBlockingInvalidSeedError(normalizedChatJid)) return false;
    if (this.options.pool.has(normalizedChatJid) && !hasDeferredBranchSeed(normalizedChatJid)) return false;
    if (this.prewarmInFlight.has(normalizedChatJid) || this.queuedPrewarms.has(normalizedChatJid)) return false;
    const now = Date.now();
    this.prunePrewarmCooldownEntries(now);
    const lastQueuedAt = this.prewarmCooldownByChat.get(normalizedChatJid) ?? 0;
    if (!options.priority && now - lastQueuedAt < 30_000) return false;

    const mode = options.mode === "lightweight" ? "lightweight" : "full";
    this.queuedPrewarms.add(normalizedChatJid);
    this.prewarmCooldownByChat.set(normalizedChatJid, now);
    if (options.priority) {
      this.prewarmQueue.unshift({ chatJid: normalizedChatJid, mode });
    } else {
      this.prewarmQueue.push({ chatJid: normalizedChatJid, mode });
    }
    this.drainPrewarmQueue();
    return true;
  }

  getInstrumentationSnapshot(): AgentSessionManagerInstrumentationSnapshot {
    return {
      branchSeedRealizationsInFlight: this.branchSeedRealizationInFlight.size,
      createInFlight: this.createInFlight.size,
      evictionProtectedChats: this.evictionProtectionCounts.size,
      invalidDeferredSeedErrors: this.invalidDeferredBranchSeedErrors.size,
      prewarmInFlight: this.prewarmInFlight.size,
      queuedPrewarms: this.queuedPrewarms.size,
      prewarmQueueLength: this.prewarmQueue.length,
      prewarmCooldowns: this.prewarmCooldownByChat.size,
    };
  }

  async shutdown(): Promise<void> {
    this.assertNonReentrantLifecycleTransition();
    if (this.shutdownInFlight) return this.shutdownInFlight;
    this.isShuttingDown = true;
    this.blockMcpAdmissions();
    // Capture before registering our own promise to avoid waiting on self.
    const preceding = this.pendingMcpLifecycleWork();
    this.shutdownInFlight = this.trackMcpLifecycle(async () => {
      await Promise.allSettled(preceding);
      await this.shutdownAdmitted();
    });
    return this.shutdownInFlight;
  }

  private async shutdownAdmitted(): Promise<void> {
    this.queuedPrewarms.clear();
    this.prewarmQueue.length = 0;
    this.prewarmCooldownByChat.clear();
    this.evictionProtectionCounts.clear();

    for (const jid of [...this.options.pool.keys()]) {
      await this.disposeEntry(jid, "shutdown.dispose_main_session");
    }
    this.options.pool.clear();
  }

  private async disposeEntry(
    chatJid: string,
    operation: string,
  ): Promise<void> {
    const entry = this.options.pool.get(chatJid);
    if (!entry) return;
    const pending = this.idleMainDisposalsInFlight;
    this.startIdleDispose(chatJid, entry, operation);
    await pending.get(chatJid);
  }

  evictIdle(options: { mainIdleTtlMs: number; mainSessionMaxSizeOverride?: number | null; protectedChatJids?: string[] }): void {
    if (this.mcpAdmissionsBlocked) return;
    const now = Date.now();
    const { mainIdleTtlMs, mainSessionMaxSizeOverride } = options;
    const explicitProtectedChatJids = new Set(this.getEvictionProtectedChatJids(
      Array.isArray(options.protectedChatJids)
        ? options.protectedChatJids.map((chatJid) => String(chatJid || "").trim()).filter(Boolean)
        : [],
    ));
    let protectedRecentMainChatJid: string | null = null;
    let protectedRecentMainLastUsed = -Infinity;
    for (const [jid, entry] of this.options.pool) {
      if (explicitProtectedChatJids.has(jid)) continue;
      if (entry.lastUsed > protectedRecentMainLastUsed || (entry.lastUsed === protectedRecentMainLastUsed && protectedRecentMainChatJid !== jid)) {
        protectedRecentMainChatJid = jid;
        protectedRecentMainLastUsed = entry.lastUsed;
      }
    }
    if (protectedRecentMainChatJid && now - protectedRecentMainLastUsed > RECENT_USE_EVICTION_GRACE_MS) {
      protectedRecentMainChatJid = null;
    }

    for (const [jid, entry] of this.options.pool) {
      if (explicitProtectedChatJids.has(jid) || jid === protectedRecentMainChatJid) {
        continue;
      }
      if (this.shouldKeepSessionCached(entry.runtime.session, now, entry)) {
        continue;
      }
      if (now - entry.lastUsed > mainIdleTtlMs) {
        this.disposeCachedMainRuntime(jid, entry.runtime, "evict_idle.main_session");
      }
    }

    this.enforceMainSessionPoolLimit({
      protectedChatJids: [...explicitProtectedChatJids],
      maxSizeOverride: mainSessionMaxSizeOverride,
    });
  }

  private shouldKeepSessionCached(
    session: { isStreaming?: boolean; isBashRunning?: boolean; isCompacting?: boolean },
    now: number,
    entry: PoolEntry,
  ): boolean {
    if (session.isStreaming || session.isBashRunning || session.isCompacting) {
      entry.lastUsed = now;
      return true;
    }
    return false;
  }

  private enforceMainSessionPoolLimit(options: { protectedChatJids?: string[]; maxSizeOverride?: number | null } = {}): void {
    const resolvedMaxSize = options.maxSizeOverride ?? this.options.mainSessionMaxSize ?? 0;
    const maxSize = Number.isFinite(resolvedMaxSize) ? resolvedMaxSize : 0;
    if (maxSize <= 0 || this.options.pool.size <= maxSize) return;

    const protectedChatJids = new Set(this.getEvictionProtectedChatJids(
      Array.isArray(options.protectedChatJids)
        ? options.protectedChatJids.map((chatJid) => String(chatJid || "").trim()).filter(Boolean)
        : [],
    ));
    const candidates = [...this.options.pool.entries()]
      .filter(([chatJid, entry]) => !protectedChatJids.has(chatJid) && !this.shouldKeepSessionCached(entry.runtime.session, Date.now(), entry))
      .sort((left, right) => left[1].lastUsed - right[1].lastUsed);

    while (this.options.pool.size > maxSize && candidates.length > 0) {
      const next = candidates.shift();
      if (!next) break;
      const [chatJid, entry] = next;
      if (this.options.pool.get(chatJid)?.runtime !== entry.runtime) continue;
      this.disposeCachedMainRuntime(chatJid, entry.runtime, "evict_idle.main_session_pool_limit", maxSize);
    }
  }

  private disposeCachedMainRuntime(chatJid: string, runtime: AgentSessionRuntime, operation: string, maxSizeOverride?: number | null): void {
    if (this.options.pool.get(chatJid)?.runtime !== runtime) return;
    this.options.onInfo?.("Evicting cached main session", {
      operation,
      chatJid,
      poolSize: this.options.pool.size,
      maxSize: maxSizeOverride ?? this.options.mainSessionMaxSize ?? null,
    });
    this.startIdleDispose(chatJid, { runtime, lastUsed: Date.now() }, operation);
  }

  private startIdleDispose(
    chatJid: string,
    entry: PoolEntry,
    operation: string,
  ): void {
    const pendingDisposals = this.idleMainDisposalsInFlight;
    if (pendingDisposals.has(chatJid)) return;
    if (this.options.pool.get(chatJid)?.runtime === entry.runtime) {
      this.options.pool.delete(chatJid);
    }

    const task = this.disposeRuntimeOnce(entry.runtime, "Failed to dispose evicted session", {
      operation,
      chatJid,
    }).then(error => {
      if (error) throw new Error("Session runtime disposal failed; admissions remain blocked.");
    }).finally(() => {
      if (pendingDisposals.get(chatJid) === task) {
        pendingDisposals.delete(chatJid);
      }
    });

    // Eviction callers are synchronous; retain rejection for awaiting callers
    // while observing it immediately to avoid an unhandled background failure.
    void task.catch(() => undefined);
    pendingDisposals.set(chatJid, task);
  }

  private async disposeRuntimeOnce(
    runtime: AgentSessionRuntime,
    warnMessage = "Failed to dispose session",
    details: Record<string, unknown> = {},
  ): Promise<unknown | null> {
    const pendingDispose = this.runtimeDisposeInFlight.get(runtime);
    if (pendingDispose) return await pendingDispose;

    const task = Promise.resolve().then(async (): Promise<unknown | null> => {
      const sessionId = runtime.session.sessionId;
      let firstError: unknown | null = null;
      try {
        await this.lifecycleContext.run(true, () => runtime.dispose());
      } catch (err) {
        firstError = err;
        this.options.onWarn?.(warnMessage, { ...details, err });
      } finally {
        try {
          await this.lifecycleContext.run(true, async () => { await this.options.disposePersistence?.(runtime); });
        } catch (err) {
          firstError ??= err;
          this.options.onWarn?.("Failed to dispose session persistence resource", { ...details, err });
        }
        closeOpenAICodexWebSocketSessions(sessionId);
      }
      return firstError;
    });
    this.runtimeDisposeInFlight.set(runtime, task);
    try {
      const error = await task;
      if (error) { this.failedMcpDisposals.add(runtime); this.blockMcpAdmissions(); }
      else this.failedMcpDisposals.delete(runtime);
      return error;
    } catch {
      this.failedMcpDisposals.add(runtime);
      this.blockMcpAdmissions();
      throw new Error("Session runtime disposal failed; admissions remain blocked.");
    } finally { if (this.runtimeDisposeInFlight.get(runtime) === task) this.runtimeDisposeInFlight.delete(runtime); }
  }

  private async applyDefaultModel(session: AgentSession): Promise<void> {
    if (session.model) return;

    const provider = this.options.settingsManager.getDefaultProvider();
    const modelId = this.options.settingsManager.getDefaultModel();
    if (!provider || !modelId) return;

    await this.applyResolvedModel(session, { provider, modelId }, "apply_default_model");
  }

  private async realizeDeferredBranchSeed(chatJid: string, runtime: AgentSessionRuntime): Promise<boolean> {
    const pending = this.branchSeedRealizationInFlight.get(chatJid);
    if (pending) return await pending;

    const task = (async () => {
      const owner = requireOwnedSessionExecution(chatJid);
      let seed;
      try {
        if (owner) {
          const json = readOwnedForkSeed(getDb(), owner, chatJid);
          if (hasDeferredBranchSeed(chatJid)) throw new ChatAccessDenied();
          seed = json === null ? null : JSON.parse(json);
          if (seed && (seed.version !== 1 || !["stable_branch", "rotated_context", "adopted_jsonl"].includes(seed.mode))) throw new ChatAccessDenied();
        } else {
          seed = claimDeferredBranchSeed(chatJid);
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Invalid deferred branch seed for ")) {
          this.invalidDeferredBranchSeedErrors.set(chatJid, {
            error,
            fingerprint: getDeferredBranchSeedFingerprint(chatJid),
          });
        }
        throw error;
      }
      if (!seed) return false;

      try {
        const result = owner && seed.mode === 'adopted_jsonl'
          ? (await importAdoptedSession(runtime,chatJid,seed), {cancelled:false})
          : await runtime.newSession({
          ...(seed.parentSession ? { parentSession: seed.parentSession } : {}),
          setup: async (sessionManager) => {
            requireOwnedSessionExecution(chatJid);
            await seedSessionManagerFromDeferredBranchSeed(sessionManager, seed);
          },
        });
        if (result.cancelled) {
          throw new Error("Deferred branch seed was cancelled.");
        }

        requireOwnedSessionExecution(chatJid);
        const session = runtime.session;
        await this.applyResolvedModel(session, seed.model, "realize_deferred_branch_seed");
        try {
          if (seed.thinkingLevel) {
            restoreSessionThinkingPolicy(session, seed.thinkingLevel, seed.preferredThinkingLevel);
          }
        } catch (err) {
          this.options.onWarn?.("Failed to restore deferred branch thinking level", {
            operation: "realize_deferred_branch_seed.thinking_level",
            chatJid,
            err,
          });
        }
        try {
          // Prefer the current branch record's agent_name over the seed's
          // captured sessionName: if the user renamed the branch between fork
          // and realization, the DB has the new name and applying the stale
          // seed value would overwrite the rename on first warmup.
          const liveAgentName = getChatBranchByChatJid(chatJid)?.agent_name?.trim() || "";
          const sessionNameToApply = liveAgentName || seed.sessionName?.trim() || "";
          if (sessionNameToApply) {
            session.setSessionName(sessionNameToApply);
          }
        } catch (err) {
          this.options.onWarn?.("Failed to restore deferred branch session name", {
            operation: "realize_deferred_branch_seed.session_name",
            chatJid,
            err,
          });
        }

        const persistedSessionFile = forcePersistSessionFile(session);
        if (persistedSessionFile) {
          const reopened = await runtime.switchSession(persistedSessionFile);
          if (reopened.cancelled) throw new Error("Deferred branch session could not be reopened after persistence.");
        }
        if (owner) {
          if (!persistedSessionFile) throw new Error("Owned fork must be persisted before completing its seed.");
          const current = requireOwnedSessionExecution(chatJid);
          if (!current) throw new ChatAccessDenied();
          finishOwnedForkSeed(getDb(), current, chatJid);
        } else {
          finalizeClaimedDeferredBranchSeed(chatJid);
        }
        this.invalidDeferredBranchSeedErrors.delete(chatJid);
        return true;
      } catch (error) {
        if (!owner) restoreClaimedDeferredBranchSeed(chatJid);
        throw error;
      }
    })().finally(() => {
      this.branchSeedRealizationInFlight.delete(chatJid);
    });

    this.branchSeedRealizationInFlight.set(chatJid, task);
    return await task;
  }

  private async applyResolvedModel(
    session: AgentSession,
    model: { provider: string; modelId: string } | null,
    operation: string,
  ): Promise<void> {
    if (!model) return;

    const current = session.model;
    if (current && current.provider === model.provider && current.id === model.modelId) return;

    const resolved = this.options.modelRuntime.getModel(model.provider, model.modelId);
    if (!resolved) return;

    const setModel = (session as { setModel?: (model: typeof resolved) => Promise<void> }).setModel;
    if (typeof setModel !== "function") return;

    try {
      await setModel.call(session, resolved);
    } catch (err) {
      this.options.onWarn?.("Failed to restore model", {
        operation,
        model: `${model.provider}/${model.modelId}`,
        err,
      });
    }
  }

  private drainPrewarmQueue(): void {
    if (this.prewarmLoopActive) return;
    this.prewarmLoopActive = true;

    void (async () => {
      try {
        while (!this.isShuttingDown && !this.mcpAdmissionsBlocked && this.prewarmQueue.length > 0) {
          const next = this.prewarmQueue.shift();
          if (!next) continue;
          const { chatJid, mode } = next;
          this.queuedPrewarms.delete(chatJid);
          if (readAccessConfig().mode !== "single-user") continue;
          if (this.isShuttingDown || this.mcpAdmissionsBlocked) continue;
          if (this.prewarmInFlight.has(chatJid)) continue;
          if (this.options.pool.has(chatJid) && !hasDeferredBranchSeed(chatJid)) continue;

          this.prewarmInFlight.add(chatJid);
          try {
            if (mode === "lightweight" && !hasDeferredBranchSeed(chatJid)) {
              const epoch = this.mcpAdmissionEpoch;
              await this.trackMcpLifecycle(async () => {
                this.assertMcpAdmission(epoch);
                if (this.options.lightweightPrewarmSession) return this.options.lightweightPrewarmSession(chatJid);
                const { lightweightPrewarmSession } = await import("./session.js");
                return lightweightPrewarmSession(chatJid, { getSessionExtensionFactories: this.options.getSessionExtensionFactories });
              });
              this.options.onInfo?.("Lightweight-prewarmed chat session", {
                operation: "prewarm_session.lightweight",
                chatJid,
              });
            } else {
              await this.getOrCreate(chatJid);
              this.options.onInfo?.("Prewarmed chat session", {
                operation: "prewarm_session",
                chatJid,
              });
            }
          } catch (err) {
            this.options.onWarn?.("Failed to prewarm chat session", {
              operation: mode === "lightweight" ? "prewarm_session.lightweight" : "prewarm_session",
              chatJid,
              err,
            });
          } finally {
            this.prewarmInFlight.delete(chatJid);
          }
        }
      } finally {
        this.prewarmLoopActive = false;
        if (this.prewarmQueue.length > 0) {
          this.drainPrewarmQueue();
        }
      }
    })();
  }

  private async disposeMainRuntimeAfterError(chatJid: string, runtime: AgentSessionRuntime, operation: string): Promise<void> {
    if (this.options.pool.get(chatJid)?.runtime === runtime) {
      this.startIdleDispose(chatJid, { runtime, lastUsed: Date.now() }, operation);
      await this.idleMainDisposalsInFlight.get(chatJid);
    } else {
      await this.disposeRuntimeOnce(runtime, "Failed to dispose session after initialization error", { operation, chatJid });
    }
  }
}
