/**
 * agent-pool/service-factory.ts – Constructor wiring for AgentPool helper services.
 */

import type { AgentSession, AgentSessionRuntime, ExtensionFactory, ModelRegistry, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";

import { getAttachmentRegistry } from "./attachments.js";
import { getSshConfig } from "../db.js";
import { readAccessConfig } from '../core/config-access.js';
import { createChatSshCoreExtension, resolveSshCoreConfigFromChatConfig } from "../extensions/ssh-core.js";
import { AgentBranchManager } from "./branch-manager.js";
import { AgentRuntimeFacade } from "./runtime-facade.js";
import type { AgentSessionBinder } from "./session-binder.js";
import type { AgentSessionManager, PoolEntry } from "./session-manager.js";
import type { AgentToolFactory, AgentBashOperations } from "./tool-factory.js";
import type { AgentPoolOptions } from "./contracts.js";
import type { PiclawCredentialStore } from "./credential-store.js";
import { McpCodemodeController } from "./mcp-codemode-runtime.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Shared logger callbacks used across extracted AgentPool services. */
export interface AgentPoolLogHooks {
  onInfo?: (message: string, details: Record<string, unknown>) => void;
  onWarn?: (message: string, details: Record<string, unknown>) => void;
  onError?: (message: string, details: Record<string, unknown>) => void;
}

/** Inputs required to assemble the extracted AgentPool helper services. */
export interface AgentPoolServiceFactoryOptions extends AgentPoolLogHooks {
  legacyCapture?:true;
  pool: Map<string, PoolEntry>;
  authStorage: PiclawCredentialStore;
  modelRuntime: ModelRuntime;
  modelRegistry: ModelRegistry;
  settingsManager: SettingsManager;
  workspaceDir: string;
  mainSessionMaxSize?: number | null;
  bashOperations?: AgentBashOperations;
  getDurableSession?: AgentPoolOptions["getDurableSession"];
  createSession?: AgentPoolOptions["createSession"];
}

type SessionBinderService = Pick<AgentSessionBinder, "setBinder" | "bindSession">;
type ToolFactoryService = Pick<AgentToolFactory, "createDefaultTools" | "createCustomToolOverrides">;
type SessionManagerService = Pick<AgentSessionManager,
  "assertLegacyCaptureIdle" | "blockMcpAdmissions" | "fenceMcpAndSnapshot" | "resumeMcpAdmissions" | "quarantineMcpRuntime"
  | "acquireEvictionProtection" | "getOrCreate" | "refreshRuntime" | "prewarm" | "cancelPrewarm" | "hasPendingSessionWork"
  | "recreate" | "hasProtectedRun" | "hasActiveMemoryReclamationWork" | "getInstrumentationSnapshot" | "evictIdle" | "shutdown">;
type BranchManagerService = Pick<AgentBranchManager,
  "renameChatBranch" | "pruneChatBranch" | "createRootChatSession"
  | "listActiveChats" | "listKnownChats" | "findActiveChatByAgentName" | "findChatByAgentName" | "getAgentHandleForChat">;

/** Concrete helper instances composed into AgentPool. */
export interface AgentPoolServices {
  mcpSettings: McpCodemodeController;
  attachments: ReturnType<typeof getAttachmentRegistry>;
  sessionBinder?: SessionBinderService;
  sessionManager?: SessionManagerService;
  runtimeFacade: AgentRuntimeFacade;
  branchManager: BranchManagerService;
}

async function resolveSessionExtensionFactories(chatJid: string): Promise<ExtensionFactory[]> {
  // Only single-user sessions may load instance SSH credentials.
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
  if (options.getDurableSession !== undefined && typeof options.getDurableSession !== "function") {
    throw new Error("Durable service factory lookup must be callable");
  }
  if (options.legacyCapture !== undefined && options.legacyCapture !== true) throw Error("Invalid legacy capture selection");
  if (options.legacyCapture && options.getDurableSession !== undefined) throw Error("Native host cannot select legacy capture composition");
  if (!options.legacyCapture && options.getDurableSession === undefined) throw Error("Native host requires a durable session lookup; legacy capture must be explicit");
  const getDurableSession = options.getDurableSession?.bind(options);
  const attachments = getAttachmentRegistry();

  const durable = getDurableSession !== undefined;

  const sessionBinder: SessionBinderService | undefined = durable ? undefined : new (require("./session-binder.js") as { AgentSessionBinder: new (...args: any[]) => SessionBinderService }).AgentSessionBinder({
    pool: options.pool,
    onError: options.onError,
  });

  const toolFactory: ToolFactoryService | undefined = durable ? undefined : new (require("./tool-factory.js") as { AgentToolFactory: new (...args: any[]) => ToolFactoryService }).AgentToolFactory({
    workspaceDir: options.workspaceDir,
    bashOperations: options.bashOperations,
  });

  let sessionManager: SessionManagerService | undefined;
  let branchManager: BranchManagerService;
  const runtimeFacade = new AgentRuntimeFacade({
    pool: options.pool,
    getDurableSession,
    ...(durable ? {} : { acquireCommandProtection: (chatJid:string) => sessionManager!.acquireEvictionProtection(chatJid) }),
    modelRegistry: options.modelRegistry,
    modelRuntime: options.modelRuntime,
    settingsManager: options.settingsManager,
    authPath: options.authStorage.authPath,
    listKnownChats: () => branchManager.listKnownChats(),
    onWarn: options.onWarn,
    onError: options.onError,
  });

  sessionManager = durable ? undefined : new (require("./session-manager.js") as { AgentSessionManager: new (...args: any[]) => SessionManagerService }).AgentSessionManager({
    getDurableSession,
    modelRegistry: options.modelRegistry,
    pool: options.pool,
    modelRuntime: options.modelRuntime,
    settingsManager: options.settingsManager,
    mainSessionMaxSize: options.mainSessionMaxSize,
    createSession: options.createSession,
    createDefaultTools: () => toolFactory!.createDefaultTools(),
    createCustomToolOverrides: (chatJid: string) => toolFactory!.createCustomToolOverrides(chatJid),
    getSessionExtensionFactories: (chatJid: string) => resolveSessionExtensionFactories(chatJid),
    bindSession: async (runtime: AgentSessionRuntime, chatJid: string) => {
      (require("./usage.js") as { installSessionUsageRecorder: (session: unknown, chatJid: string, onWarn?: AgentPoolLogHooks["onWarn"]) => void })
        .installSessionUsageRecorder(runtime.session, chatJid, options.onWarn);
      await sessionBinder!.bindSession(runtime, chatJid);
    },
    onInfo: options.onInfo,
    onWarn: options.onWarn,
    onError: options.onError,
  });

  branchManager = new AgentBranchManager({
    pool: options.pool,
    isActive: (chatJid) => runtimeFacade.isActive(chatJid),
    onWarn: options.onWarn,
  });

  return {
    mcpSettings: new McpCodemodeController(sessionManager),
    attachments,
    ...(durable ? {} : {sessionBinder,sessionManager}),
    runtimeFacade,
    branchManager,
  };
}
