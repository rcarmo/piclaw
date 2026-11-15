/**
 * agent-pool/service-factory.ts – Constructor wiring for AgentPool helper services.
 */

import type { ModelRegistry, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";

import { getAttachmentRegistry } from "./attachments.js";
import { AgentBranchManager } from "./branch-manager.js";
import { AgentRuntimeFacade } from "./runtime-facade.js";
import type { AgentSessionManager, PoolEntry } from "./session-manager.js";
import type { AgentBashOperations } from "./tool-factory.js";
import type { AgentPoolOptions } from "./contracts.js";
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

type SessionManagerService = Pick<AgentSessionManager,
  "assertLegacyCaptureIdle" | "blockMcpAdmissions" | "fenceMcpAndSnapshot" | "resumeMcpAdmissions" | "quarantineMcpRuntime"
  | "acquireEvictionProtection" | "getOrCreate" | "refreshRuntime" | "hasPendingSessionWork"
  | "recreate" | "hasProtectedRun" | "hasActiveMemoryReclamationWork" | "getInstrumentationSnapshot" | "evictIdle" | "shutdown">;
type BranchManagerService = Pick<AgentBranchManager,
  "renameChatBranch" | "pruneChatBranch" | "createRootChatSession"
  | "listActiveChats" | "listKnownChats" | "findActiveChatByAgentName" | "findChatByAgentName" | "getAgentHandleForChat">;

/** Concrete helper instances composed into AgentPool. */
export interface AgentPoolServices {
  mcpSettings: McpCodemodeController;
  attachments: ReturnType<typeof getAttachmentRegistry>;
  sessionManager?: SessionManagerService;
  runtimeFacade: AgentRuntimeFacade;
  branchManager: BranchManagerService;
}

/**
 * Assemble the extracted helper services used by AgentPool.
 * Keeps constructor wiring in one place so AgentPool itself remains a thin façade.
 */
export function createAgentPoolServices(options: AgentPoolServiceFactoryOptions): AgentPoolServices {
  if (options.getDurableSession !== undefined && typeof options.getDurableSession !== "function") {
    throw new Error("Durable service factory lookup must be callable");
  }
  if (Object.hasOwn(options, "legacyCapture")) {
    throw new Error("Resident legacy capture was removed; use session-import into a fresh separate store");
  }
  if (options.getDurableSession === undefined) {
    throw new Error("Native host requires a durable session lookup; use getDurableSession with an existing native lookup");
  }
  const getDurableSession = options.getDurableSession?.bind(options);
  const attachments = getAttachmentRegistry();

  let branchManager: BranchManagerService;
  const runtimeFacade = new AgentRuntimeFacade({
    pool: options.pool,
    getDurableSession,
    modelRegistry: options.modelRegistry,
    modelRuntime: options.modelRuntime,
    settingsManager: options.settingsManager,
    authPath: options.authStorage.authPath,
    listKnownChats: () => branchManager.listKnownChats(),
    onWarn: options.onWarn,
    onError: options.onError,
  });

  branchManager = new AgentBranchManager({
    pool: options.pool,
    isActive: (chatJid) => runtimeFacade.isActive(chatJid),
    onWarn: options.onWarn,
  });

  return {
    mcpSettings: new McpCodemodeController(undefined),
    attachments,
    runtimeFacade,
    branchManager,
  };
}
