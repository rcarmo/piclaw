/**
 * agent-pool/session-manager.ts – Main/side session lifecycle management for AgentPool.
 *
 * Extracts chat-session creation, side-session sync, idle eviction, and shutdown
 * mechanics out of the top-level AgentPool coordinator while preserving the
 * existing map-based cache structure used by callers and tests.
 */

import type { AgentSession, AgentSessionRuntime, ExtensionFactory, ModelRegistry, SettingsManager, AuthStorage } from "@mariozechner/pi-coding-agent";

import {
  clearDeferredBranchSeed,
  hasDeferredBranchSeed,
  readDeferredBranchSeed,
  seedSessionManagerFromDeferredBranchSeed,
} from "./branch-seeding.js";
import { createDefaultSession, createSessionInDir, ensureNamedSessionDir, ensureSessionDir } from "./session.js";
import { forcePersistSessionFile, seedRotatedSession } from "../session-rotation.js";

/** Cached session entry stored for each chat JID. */
export interface PoolEntry {
  runtime: AgentSessionRuntime;
  lastUsed: number;
}

/** Dependencies required to manage AgentPool session lifecycles. */
export interface AgentSessionManagerOptions {
  pool: Map<string, PoolEntry>;
  sidePool: Map<string, PoolEntry>;
  createSession?: (chatJid: string, sessionDir: string) => Promise<AgentSessionRuntime>;
  createSideSession?: (chatJid: string, sessionDir: string) => Promise<AgentSessionRuntime>;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  settingsManager: SettingsManager;
  createDefaultTools: () => NonNullable<Parameters<typeof createDefaultSession>[1]["tools"]>;
  getSessionExtensionFactories?: (chatJid: string) => Promise<ExtensionFactory[]>;
  bindSession: (runtime: AgentSessionRuntime, chatJid: string) => Promise<void>;
  ensureBranchRegistration: (chatJid: string, session?: AgentSession | null) => void;
  onInfo?: (message: string, details: Record<string, unknown>) => void;
  onWarn?: (message: string, details: Record<string, unknown>) => void;
  onError?: (message: string, details: Record<string, unknown>) => void;
}

/**
 * Handles lifecycle operations for main and auxiliary AgentSession instances.
 */
export class AgentSessionManager {
  private readonly branchSeedRealizationInFlight = new Map<string, Promise<boolean>>();
  private readonly invalidDeferredBranchSeedErrors = new Map<string, Error>();
  private readonly prewarmInFlight = new Set<string>();

  constructor(private readonly options: AgentSessionManagerOptions) {}

  async refreshRuntime(chatJid: string, runtime: AgentSessionRuntime): Promise<void> {
    const entry = this.options.pool.get(chatJid);
    if (entry) {
      entry.lastUsed = Date.now();
    }
    await this.options.bindSession(runtime, chatJid);
    this.options.ensureBranchRegistration(chatJid, runtime.session);
  }

  async getOrCreate(chatJid: string): Promise<AgentSessionRuntime> {
    const knownInvalidSeedError = this.invalidDeferredBranchSeedErrors.get(chatJid);
    if (knownInvalidSeedError) {
      throw knownInvalidSeedError;
    }

    const existing = this.options.pool.get(chatJid);
    if (existing) {
      existing.lastUsed = Date.now();
      await this.realizeDeferredBranchSeed(chatJid, existing.runtime);
      return existing.runtime;
    }

    this.options.onInfo?.("Creating new session", {
      operation: "get_or_create.create_main_session",
      chatJid,
    });

    const chatSessionDir = ensureSessionDir(chatJid);

    const extensionFactories = await this.options.getSessionExtensionFactories?.(chatJid) ?? [];
    const runtime = this.options.createSession
      ? await this.options.createSession(chatJid, chatSessionDir)
      : await createDefaultSession(chatJid, {
          authStorage: this.options.authStorage,
          modelRegistry: this.options.modelRegistry,
          settingsManager: this.options.settingsManager,
          tools: this.options.createDefaultTools(),
          extensionFactories,
        });

    this.options.pool.set(chatJid, { runtime, lastUsed: Date.now() });
    try {
      const realizedDeferredSeed = await this.realizeDeferredBranchSeed(chatJid, runtime);
      if (!realizedDeferredSeed) {
        await this.applyDefaultModel(runtime.session);
      }
      await this.refreshRuntime(chatJid, runtime);
      this.options.onInfo?.("Session ready", {
        operation: this.options.createSession ? "get_or_create.create_main_session" : "get_or_create.create_default_session",
        chatJid,
        poolSize: this.options.pool.size,
      });
      return runtime;
    } catch (err) {
      this.options.pool.delete(chatJid);
      try {
        await runtime.dispose();
      } catch (disposeErr) {
        this.options.onWarn?.("Failed to dispose session after initialization error", {
          operation: "get_or_create.dispose_after_error",
          chatJid,
          err: disposeErr,
        });
      }
      throw err;
    }
  }

  async getOrCreateSide(chatJid: string): Promise<AgentSessionRuntime> {
    const existing = this.options.sidePool.get(chatJid);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.runtime;
    }

    this.options.onInfo?.("Creating new side session", {
      operation: "get_or_create_side.create_session",
      chatJid,
    });
    const sideSessionDir = ensureNamedSessionDir(chatJid, "btw-side");

    const extensionFactories = await this.options.getSessionExtensionFactories?.(chatJid) ?? [];
    const runtime = this.options.createSideSession
      ? await this.options.createSideSession(chatJid, sideSessionDir)
      : await createSessionInDir(sideSessionDir, {
          authStorage: this.options.authStorage,
          modelRegistry: this.options.modelRegistry,
          settingsManager: this.options.settingsManager,
          tools: this.options.createDefaultTools(),
          extensionFactories,
        });

    this.options.sidePool.set(chatJid, { runtime, lastUsed: Date.now() });
    return runtime;
  }

  async syncSideSessionFromMain(mainSession: AgentSession, sideRuntime: AgentSessionRuntime): Promise<void> {
    try {
      const mainContext = mainSession.sessionManager.buildSessionContext();
      await sideRuntime.newSession({
        setup: async (sessionManager) => {
          seedRotatedSession(sessionManager, mainContext, {
            sessionName: "BTW",
            model: mainContext.model,
          });
        },
      });
    } catch (err) {
      this.options.onWarn?.("Failed to reseed side session from main context", {
        operation: "sync_side_session_from_main.reseed",
        err,
      });
    }

    const sideSession = sideRuntime.session;
    const mainModel = mainSession.model;
    const sideModel = sideSession.model;
    if (mainModel && (!sideModel || sideModel.provider !== mainModel.provider || sideModel.id !== mainModel.id)) {
      try {
        await sideSession.setModel(mainModel);
      } catch (err) {
        this.options.onWarn?.("Failed to sync side-session model", {
          operation: "sync_side_session_from_main.model",
          model: `${mainModel.provider}/${mainModel.id}`,
          err,
        });
      }
    }

    try {
      sideSession.setThinkingLevel(mainSession.thinkingLevel);
    } catch (err) {
      this.options.onWarn?.("Failed to sync side-session thinking level", {
        operation: "sync_side_session_from_main.thinking_level",
        err,
      });
    }

    try {
      sideSession.setActiveToolsByName(mainSession.getActiveToolNames());
    } catch (err) {
      this.options.onWarn?.("Failed to sync side-session tool selection", {
        operation: "sync_side_session_from_main.tools",
        err,
      });
    }
  }

  async recreate(chatJid: string): Promise<void> {
    await this.disposeEntry(this.options.pool, chatJid, "recreate.dispose_main_session");
    await this.disposeEntry(this.options.sidePool, chatJid, "recreate.dispose_side_session", true);
  }

  prewarm(chatJid: string): void {
    if (!chatJid || this.prewarmInFlight.has(chatJid)) return;
    if (this.invalidDeferredBranchSeedErrors.has(chatJid)) return;
    if (this.options.pool.has(chatJid) && !hasDeferredBranchSeed(chatJid)) return;

    this.prewarmInFlight.add(chatJid);
    void (async () => {
      try {
        await this.getOrCreate(chatJid);
        this.options.onInfo?.("Prewarmed chat session", {
          operation: "prewarm_session",
          chatJid,
        });
      } catch (err) {
        this.options.onWarn?.("Failed to prewarm chat session", {
          operation: "prewarm_session",
          chatJid,
          err,
        });
      } finally {
        this.prewarmInFlight.delete(chatJid);
      }
    })();
  }

  async shutdown(): Promise<void> {
    for (const jid of [...this.options.pool.keys()]) {
      await this.disposeEntry(this.options.pool, jid, "shutdown.dispose_main_session");
    }
    for (const jid of [...this.options.sidePool.keys()]) {
      await this.disposeEntry(this.options.sidePool, jid, "shutdown.dispose_side_session", true);
    }
    this.options.pool.clear();
    this.options.sidePool.clear();
  }

  private async disposeEntry(
    map: Map<string, PoolEntry>,
    chatJid: string,
    operation: string,
    side = false,
  ): Promise<void> {
    const entry = map.get(chatJid);
    if (!entry) return;
    try {
      await entry.runtime.dispose();
      this.options.onInfo?.(side ? "Disposed side session" : "Disposed session", {
        operation,
        chatJid,
      });
    } catch (err) {
      this.options.onError?.(side ? "Failed to dispose side session" : "Failed to dispose session", {
        operation,
        chatJid,
        err,
      });
    } finally {
      map.delete(chatJid);
    }
  }

  evictIdle(idleTtlMs: number): void {
    const now = Date.now();
    for (const [jid, entry] of this.options.pool) {
      const session = entry.runtime.session;
      if (session.isStreaming || session.isBashRunning || session.isCompacting) {
        entry.lastUsed = now;
        continue;
      }
      if (now - entry.lastUsed > idleTtlMs) {
        this.options.onInfo?.("Evicting idle session", {
          operation: "evict_idle.main_session",
          chatJid: jid,
        });
        Promise.resolve(entry.runtime.dispose()).catch((err) => {
          this.options.onWarn?.("Failed to dispose evicted session", {
            operation: "evict_idle.main_session",
            chatJid: jid,
            err,
          });
        });
        this.options.pool.delete(jid);
      }
    }
    for (const [jid, entry] of this.options.sidePool) {
      const session = entry.runtime.session;
      if (session.isStreaming || session.isBashRunning || session.isCompacting) {
        entry.lastUsed = now;
        continue;
      }
      if (now - entry.lastUsed > idleTtlMs) {
        this.options.onInfo?.("Evicting idle side session", {
          operation: "evict_idle.side_session",
          chatJid: jid,
        });
        Promise.resolve(entry.runtime.dispose()).catch((err) => {
          this.options.onWarn?.("Failed to dispose evicted side session", {
            operation: "evict_idle.side_session",
            chatJid: jid,
            err,
          });
        });
        this.options.sidePool.delete(jid);
      }
    }
  }

  private async applyDefaultModel(session: AgentSession): Promise<void> {
    const provider = this.options.settingsManager.getDefaultProvider();
    const modelId = this.options.settingsManager.getDefaultModel();
    if (!provider || !modelId) return;

    await this.applyResolvedModel(session, { provider, modelId }, "apply_default_model");
  }

  private async realizeDeferredBranchSeed(chatJid: string, runtime: AgentSessionRuntime): Promise<boolean> {
    const pending = this.branchSeedRealizationInFlight.get(chatJid);
    if (pending) return await pending;

    const task = (async () => {
      let seed;
      try {
        seed = readDeferredBranchSeed(chatJid);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Invalid deferred branch seed for ")) {
          this.invalidDeferredBranchSeedErrors.set(chatJid, error);
        }
        throw error;
      }
      if (!seed) return false;

      const result = await runtime.newSession({
        ...(seed.parentSession ? { parentSession: seed.parentSession } : {}),
        setup: async (sessionManager) => {
          seedSessionManagerFromDeferredBranchSeed(sessionManager, seed);
        },
      });
      if (result.cancelled) {
        throw new Error("Deferred branch seed was cancelled.");
      }

      const session = runtime.session;
      await this.applyResolvedModel(session, seed.model, "realize_deferred_branch_seed");
      try {
        if (seed.thinkingLevel) {
          session.setThinkingLevel(seed.thinkingLevel);
        }
      } catch (err) {
        this.options.onWarn?.("Failed to restore deferred branch thinking level", {
          operation: "realize_deferred_branch_seed.thinking_level",
          chatJid,
          err,
        });
      }
      try {
        if (seed.sessionName?.trim()) {
          session.setSessionName(seed.sessionName.trim());
        }
      } catch (err) {
        this.options.onWarn?.("Failed to restore deferred branch session name", {
          operation: "realize_deferred_branch_seed.session_name",
          chatJid,
          err,
        });
      }

      forcePersistSessionFile(session);
      clearDeferredBranchSeed(chatJid);
      this.invalidDeferredBranchSeedErrors.delete(chatJid);
      return true;
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

    const sessionRegistry = (session as AgentSession & { modelRegistry?: ModelRegistry }).modelRegistry ?? this.options.modelRegistry;
    const resolved = sessionRegistry.find(model.provider, model.modelId);
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
}
