/**
 * db.ts – Public barrel export for the database layer.
 *
 * Re-exports everything from the db/* sub-modules so consumers can import
 * from a single path:
 *   import { initDatabase, storeMessage, getTimeline, ... } from "./db.js";
 *
 * This keeps internal module boundaries hidden from the rest of the codebase.
 */

export { initDatabase, getDb } from "./db/connection.js";
export { clampWebContent } from "./db/web-content.js";
export {
  ensureChatBranch,
  getChatBranchByChatJid,
  getChatBranchByAgentName,
  listChatBranches,
  renameChatBranchIdentity,
  archiveChatBranch,
  restoreChatBranchIdentity,
} from "./db/chat-branches.js";
export {
  storeChatMetadata,
  listRecentChatJids,
  storeMessage,
  getMessageByRowId,
  getMessageByAnyRowId,
  getMessageRowIdById,
  getMessageThreadRootIdById,
  deleteMessageByRowId,
  deleteThreadByRowId,
  getTimeline,
  hasOlderMessages,
  getMessagesByHashtag,
  searchMessages,
  searchMessagesAcrossChats,
  getNewMessages,
  getMessagesSince,
  updateMessageLinkPreviews,
  replaceMessageContent,
} from "./db/messages.js";
export {
  attachMediaToMessage,
  getMediaIdsForMessage,
  createMedia,
  getMediaById,
  getMediaInfoById,
  deleteUnreferencedMedia,
} from "./db/media.js";
export {
  getLinkPreviewImageCache,
  upsertLinkPreviewImageCache,
  touchLinkPreviewImageCache,
  purgeExpiredLinkPreviewImageCache,
} from "./db/link-preview-image-cache.js";
export type { LinkPreviewImageCacheRecord } from "./db/link-preview-image-cache.js";
export {
  createTask,
  getTaskById,
  updateTask,
  deleteTask,
  getDueTasks,
  updateTaskAfterRun,
  logTaskRun,
  getTaskRunLogs,
} from "./db/tasks.js";
export {
  getSshConfig,
  upsertSshConfig,
  deleteSshConfig,
  listSshConfigs,
} from "./db/ssh-configs.js";
export {
  getProxmoxConfig,
  upsertProxmoxConfig,
  deleteProxmoxConfig,
  listProxmoxConfigs,
} from "./db/proxmox-configs.js";
export {
  getPortainerConfig,
  upsertPortainerConfig,
  deletePortainerConfig,
  listPortainerConfigs,
} from "./db/portainer-configs.js";
export {
  storeToolOutput,
  insertToolOutputChunk,
  getToolOutputById,
  deleteToolOutputsBefore,
  searchToolOutputSnippets,
} from "./db/tool-outputs.js";
export { getRouterState, setRouterState } from "./db/router-state.js";
export {
  getChatCursor,
  getAllChatCursors,
  getInflightMessageId,
  setChatCursor,
  beginChatRun,
  endChatRun,
  endChatRunWithError,
  getFailedRun,
  clearFailedRun,
  getInflightRuns,
  rollbackInflightRun,
  clearInflightMarker,
  getAgentReplyStateAfter,
  hasAgentRepliesAfter,
  getDeferredQueuedFollowups,
  setDeferredQueuedFollowups,
} from "./db/chat-cursors.js";
export type { InflightRun, DeferredQueuedFollowupRecord, AgentReplyState } from "./db/chat-cursors.js";
export {
  storeTokenUsage,
  getTokenUsageTotals,
  getTokenUsageByProvider,
  getTokenUsageByModel,
} from "./db/token-usage.js";
export {
  createWebauthnEnrollment,
  getWebauthnEnrollment,
  consumeWebauthnEnrollment,
  listWebauthnCredentials,
  getWebauthnCredentialsForRpId,
  getWebauthnCredentialById,
  findWebauthnCredentialsByPrefix,
  storeWebauthnCredential,
  updateWebauthnCredentialCounter,
  deleteWebauthnCredential,
} from "./db/webauthn.js";
export {
  DEFAULT_WEB_USER_ID,
  createWebSession,
  getWebSession,
  deleteExpiredWebSessions,
  deleteAllWebSessions,
} from "./db/web-sessions.js";
export type {
  ChatBranchRecord,
  InteractionRow,
  ToolOutputRecord,
} from "./db/types.js";
export type {
  SshConfig,
  SshConfigApplyTiming,
  SshConfigClearResult,
  SshConfigSetResult,
  ProxmoxConfig,
  ProxmoxConfigClearResult,
  ProxmoxConfigSetResult,
  PortainerConfig,
  PortainerConfigClearResult,
  PortainerConfigSetResult,
} from "./types.js";
