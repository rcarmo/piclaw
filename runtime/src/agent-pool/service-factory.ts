/**
 * agent-pool/service-factory.ts – Constructor wiring for AgentPool helper services.
 */

import type { AuthStorage, ExtensionFactory, ModelRegistry, SettingsManager } from "@mariozechner/pi-coding-agent";

import { getAttachmentRegistry } from "./attachments.js";
import { getSshConfig } from "../db.js";
import { createChatSshCoreExtension, resolveSshCoreConfigFromChatConfig } from "../extensions/ssh-core.js";
import { AgentBranchManager } from "./branch-manager.js";
import { AgentRuntimeFacade } from "./runtime-facade.js";
import { AgentSessionBinder } from "./session-binder.js";
import { AgentSessionManager, type PoolEntry } from "./session-manager.js";
import { AgentToolFactory } from "./tool-factory.js";
import { AgentTurnCoordinator } from "./turn-coordinator.js";
import { recordMessageUsage } from "./usage.js";
import type { AgentPoolOptions } from "./contracts.js";
import type { AgentBashOperations } from "./tool-factory.js";

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
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  settingsManager: SettingsManager;
  workspaceDir: string;
  bashOperations?: AgentBashOperations;
  createSession?: AgentPoolOptions["createSession"];
  createSideSession?: AgentPoolOptions["createSideSession"];
}

/** Concrete helper instances composed into AgentPool. */
export interface AgentPoolServices {
  attachments: ReturnType<typeof getAttachmentRegistry>;
  sessionBinder: AgentSessionBinder;
  toolFactory: AgentToolFactory;
  turnCoordinator: AgentTurnCoordinator;
  sessionManager: AgentSessionManager;
  runtimeFacade: AgentRuntimeFacade;
  branchManager: AgentBranchManager;
}

async function resolveSessionExtensionFactories(chatJid: string): Promise<ExtensionFactory[]> {
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
    recordMessageUsage,
    onWarn: options.onWarn,
    onError: options.onError,
  });

  let sessionManager: AgentSessionManager;
  const runtimeFacade = new AgentRuntimeFacade({
    pool: options.pool,
    getOrCreateRuntime: (chatJid) => sessionManager.getOrCreate(chatJid),
    modelRegistry: options.modelRegistry,
    authStorage: options.authStorage,
    clearAttachments: (chatJid) => attachments.clear(chatJid),
    refreshRuntime: (chatJid, runtime) => sessionManager.refreshRuntime(chatJid, runtime),
    onWarn: options.onWarn,
    onError: options.onError,
  });
  const branchManager = new AgentBranchManager({
    pool: options.pool,
    sidePool: options.sidePool,
    activeForkBaseLeafByChat: options.activeForkBaseLeafByChat,
    getOrCreateRuntime: (chatJid) => sessionManager.getOrCreate(chatJid),
    refreshRuntime: (chatJid, runtime) => sessionManager.refreshRuntime(chatJid, runtime),
    isActive: (chatJid) => runtimeFacade.isActive(chatJid),
    scheduleSessionWarmup: (chatJid) => sessionManager.prewarm(chatJid),
    onWarn: options.onWarn,
  });
  sessionManager = new AgentSessionManager({
    pool: options.pool,
    sidePool: options.sidePool,
    ...(options.createSession ? { createSession: options.createSession } : {}),
    ...(options.createSideSession ? { createSideSession: options.createSideSession } : {}),
    authStorage: options.authStorage,
    modelRegistry: options.modelRegistry,
    settingsManager: options.settingsManager,
    createDefaultTools: () => toolFactory.createDefaultTools(),
    getSessionExtensionFactories: (chatJid) => resolveSessionExtensionFactories(chatJid),
    bindSession: (runtime, chatJid) => sessionBinder.bindSession(runtime, chatJid),
    ensureBranchRegistration: (chatJid, session) => {
      branchManager.ensureBranchRegistration(chatJid, session);
    },
    onInfo: options.onInfo,
    onWarn: options.onWarn,
    onError: options.onError,
  });

  return {
    attachments,
    sessionBinder,
    toolFactory,
    turnCoordinator,
    sessionManager,
    runtimeFacade,
    branchManager,
  };
}
