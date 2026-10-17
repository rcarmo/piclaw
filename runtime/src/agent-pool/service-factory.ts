/**
 * agent-pool/service-factory.ts – Constructor wiring for AgentPool helper services.
 */

import type { ExtensionFactory, ModelRegistry, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";

import { getAttachmentRegistry } from "./attachments.js";
import { getSshConfig } from "../db.js";
import { readAccessConfig } from '../core/config-access.js';
import { createChatSshCoreExtension, resolveSshCoreConfigFromChatConfig } from "../extensions/ssh-core.js";
import { AgentBranchManager } from "./branch-manager.js";
import { AgentRuntimeFacade } from "./runtime-facade.js";
import { AgentSessionBinder } from "./session-binder.js";
import { AgentSessionManager, type PoolEntry } from "./session-manager.js";
import { AgentToolFactory } from "./tool-factory.js";
import { AgentTurnCoordinator } from "./turn-coordinator.js";
import { installSessionUsageRecorder } from "./usage.js";
import type { AgentPoolOptions } from "./contracts.js";
import type { AgentBashOperations } from "./tool-factory.js";
import type { PiclawCredentialStore } from "./credential-store.js";
import { McpCodemodeController } from "./mcp-codemode-runtime.js";

/** Shared logger callbacks used across extracted AgentPool services. */
export interface AgentPoolLogHooks {
  onInfo?: (message: string, details: Record<string, unknown>) => void;
  onWarn?: (message: string, details: Record<string, unknown>) => void;
  onError?: (message: string, details: Record<string, unknown>) => void;
}

/** Inputs required to assemble the extracted AgentPool helper services. */
export interface AgentPoolServiceFactoryOptions extends AgentPoolLogHooks {
  pool: Map<string, PoolEntry>;
  sidePool: Map<string, PoolEntry>;
  activeForkBaseLeafByChat: Map<string, string | null>;
  authStorage: PiclawCredentialStore;
  modelRuntime: ModelRuntime;
  modelRegistry: ModelRegistry;
  settingsManager: SettingsManager;
  workspaceDir: string;
  mainSessionMaxSize?: number | null;
  bashOperations?: AgentBashOperations;
  getDurableSession?: AgentPoolOptions["getDurableSession"];
  createSession?: AgentPoolOptions["createSession"];
  createSideSession?: AgentPoolOptions["createSideSession"];
}

/** Concrete helper instances composed into AgentPool. */
export interface AgentPoolServices {
  mcpSettings: McpCodemodeController;
  attachments: ReturnType<typeof getAttachmentRegistry>;
  sessionBinder: AgentSessionBinder;
  toolFactory: AgentToolFactory;
  turnCoordinator: AgentTurnCoordinator;
  sessionManager: AgentSessionManager;
  runtimeFacade: AgentRuntimeFacade;
  branchManager: AgentBranchManager;
}

async function resolveSessionExtensionFactories(chatJid: string): Promise<ExtensionFactory[]> {
  // Never load persisted legacy SSH credentials or connect a shared remote shell for family hydration.
  if (readAccessConfig().mode !== 'single-user') return [];
  let sshConfig: ReturnType<typeof getSshConfig> | undefined;
  try {
    sshConfig = getSshConfig(chatJid);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      (error.message !== "Database not initialized" && error.message !== "Cannot use a closed database")
    ) {
      throw error;
    }
  }
  return [createChatSshCoreExtension(chatJid, sshConfig ? resolveSshCoreConfigFromChatConfig(sshConfig) : null)];
}

/**
 * Assemble the extracted helper services used by AgentPool.
 * Keeps constructor wiring in one place so AgentPool itself remains a thin façade.
 */
export function createAgentPoolServices(options: AgentPoolServiceFactoryOptions): AgentPoolServices {
  const getDurableSession = options.getDurableSession?.bind(options);
  const attachments = getAttachmentRegistry();
  const sessionBinder = new AgentSessionBinder({
    pool: options.pool,
    onError: options.onError,
  });
  const toolFactory = new AgentToolFactory({
    workspaceDir: options.workspaceDir,
    bashOperations: options.bashOperations,
  });
  const turnCoordinator = new AgentTurnCoordinator({
    takeAttachments: (chatJid) => attachments.take(chatJid),
    touchSession: (chatJid) => {
      const entry = options.pool.get(chatJid);
      if (entry) entry.lastUsed = Date.now();
    },
    onInfo: options.onInfo,
    onWarn: options.onWarn,
    onError: options.onError,
  });

  let sessionManager: AgentSessionManager;
  let branchManager: AgentBranchManager;
  const runtimeFacade = new AgentRuntimeFacade({
    pool: options.pool,
    getDurableSession,
    acquireCommandProtection: chatJid => sessionManager.acquireEvictionProtection(chatJid),
    getOrCreateRuntime: (chatJid) => sessionManager.getOrCreate(chatJid),
    modelRegistry: options.modelRegistry,
    modelRuntime: options.modelRuntime,
    settingsManager: options.settingsManager,
    authPath: options.authStorage.authPath,
    clearAttachments: (chatJid) => attachments.clear(chatJid),
    refreshRuntime: (chatJid, runtime) => sessionManager.refreshRuntime(chatJid, runtime),
    listKnownChats: () => branchManager.listKnownChats(),
    onWarn: options.onWarn,
    onError: options.onError,
  });
  branchManager = new AgentBranchManager({
    pool: options.pool,
    sidePool: options.sidePool,
    activeForkBaseLeafByChat: options.activeForkBaseLeafByChat,
    getOrCreateRuntime: (chatJid) => sessionManager.getOrCreate(chatJid),
    refreshRuntime: (chatJid, runtime) => sessionManager.refreshRuntime(chatJid, runtime),
    isActive: (chatJid) => runtimeFacade.isActive(chatJid),
    scheduleSessionWarmup: (chatJid) => sessionManager.prewarm(chatJid),
    cancelSessionWarmup: (chatJid) => sessionManager.cancelPrewarm(chatJid),
    hasPendingSessionWork: (chatJid) => sessionManager.hasPendingSessionWork(chatJid),
    onWarn: options.onWarn,
  });
  sessionManager = new AgentSessionManager({
    getDurableSession,
    modelRegistry: options.modelRegistry,
    pool: options.pool,
    sidePool: options.sidePool,
    modelRuntime: options.modelRuntime,
    settingsManager: options.settingsManager,
    mainSessionMaxSize: options.mainSessionMaxSize,
    // Compatibility construction is absent from the selected durable backend.
    ...(getDurableSession === undefined ? {
    createSession: options.createSession,
    createSideSession: options.createSideSession,
    createDefaultTools: () => toolFactory.createDefaultTools(),
    createCustomToolOverrides: (chatJid) => toolFactory.createCustomToolOverrides(chatJid),
    getSessionExtensionFactories: (chatJid) => resolveSessionExtensionFactories(chatJid),
    bindSession: async (runtime, chatJid) => {
      installSessionUsageRecorder(runtime.session, chatJid, options.onWarn);
      await sessionBinder.bindSession(runtime, chatJid);
    },
    ensureBranchRegistration: (chatJid, session) => {
      branchManager.ensureBranchRegistration(chatJid, session);
    },
    } : {}),
    onInfo: options.onInfo,
    onWarn: options.onWarn,
    onError: options.onError,
  });

  return {
    mcpSettings: new McpCodemodeController(sessionManager),
    attachments,
    sessionBinder,
    toolFactory,
    turnCoordinator,
    sessionManager,
    runtimeFacade,
    branchManager,
  };
}
