/**
 * db.ts – Public barrel export for the database layer.
 *
 * Re-exports everything from the db/* sub-modules so consumers can import
 * from a single path:
 *   import { initDatabase, storeMessage, getTimeline, ... } from "./db.js";
 *
 * This keeps internal module boundaries hidden from the rest of the codebase.
 */

export { initDatabase, getDb, backupDatabase, closeDatabase, shrinkDatabaseMemory, reclaimFreelistPages } from "./db/connection.js";
export { createVerifiedSqliteBackup, verifySqliteBackup } from "./db/backup.js";
export type { SqliteBackupManifest } from "./db/backup.js";
export { applyOwnedMigrations, ensureOwnedMigrationLedger, listAppliedOwnedMigrations } from "./db/migrations.js";
export type { OwnedSchemaMigration, AppliedOwnedSchemaMigration } from "./db/migrations.js";
export { clampWebContent } from "./db/web-content.js";
export {
  ensureChatBranch,
  getChatBranchByChatJid,
  getChatBranchByAgentName,
  listChatBranches,
  renameChatBranchIdentity,
  renameChatJid,
  archiveChatBranch,
  mergeChatBranchIntoParent,
  exportArchivedBranchDownloadData,
  previewPermanentDeleteArchivedBranch,
  permanentDeleteArchivedBranch,
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
  applyScheduledRunToTask,
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
  storeToolOutput,
  insertToolOutputChunk,
  getToolOutputById,
  deleteToolOutputsBefore,
  searchToolOutputSnippets,
} from "./db/tool-outputs.js";
export { getRouterState, setRouterState } from "./db/router-state.js";
export {
  extensionKvGet,
  extensionKvSet,
  extensionKvDelete,
  extensionKvList,
  extensionKvQuery,
  extensionKvClear,
  extensionKvDeleteByChatJid,
  extensionKvPrune,
  migrateProxmoxPortainerToKv,
  type KvScope,
  type KvEntry,
  type KvQueryOptions,
} from "./db/extension-kv.js";
export {
  getChatCursor,
  getAllChatCursors,
  getInflightMessageId,
  setChatCursor,
  beginChatPreflight,
  clearChatPreflight,
  promoteChatPreflightToInflight,
  beginChatRun,
  endChatRun,
  removeProtectedRecoveryContinuationForSourceMessageId,
  endChatRunWithError,
  rollbackChatRunWithError,
  getFailedRun,
  clearFailedRun,
  getPreflightRuns,
  quarantinePendingManualCompactCommands,
  quarantineStalePreflightRun,
  getInflightRuns,
  rollbackInflightRun,
  clearInflightMarker,
  getAgentReplyStateAfter,
  hasAgentRepliesAfter,
  getDeferredQueuedFollowups,
  setDeferredQueuedFollowups,
  getChatCompactionBackoff,
  getAllChatCompactionBackoffs,
  setChatCompactionBackoff,
  clearChatCompactionBackoff,
  markChatCompactionActive,
  clearChatCompactionActive,
  getActiveChatCompactions,
  getChatAutoCompactionWindow,
  setChatAutoCompactionWindow,
  resetChatAutoCompactionWindow,
} from "./db/chat-cursors.js";
export type {
  PreflightRun,
  InflightRun,
  DeferredQueuedFollowupRecord,
  AgentReplyState,
  ChatCompactionBackoffState,
  ActiveCompactionState,
  ChatAutoCompactionWindowState,
  ManualCompactQuarantineRecord,
  StalePreflightRecoveryRecord,
} from "./db/chat-cursors.js";
export {
  storeCompactionTelemetry,
  listCompactionTelemetryAfter,
  normalizeCompactionTelemetryRecord,
  pruneCompactionTelemetry,
} from "./db/compaction-telemetry.js";
export type { CompactionTelemetryRecord, CompactionTelemetryOutcome, CompactionTelemetryStage } from "./db/compaction-telemetry.js";
export {
  storeTokenUsage,
  getTokenUsageTotals,
  getTokenUsageByProvider,
  getTokenUsageByModel,
  getTokenUsageBySource,
  getLatestTokenUsage,
  getLatestTokenUsageModel,
  pruneOldTokenUsage,
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
export type { MergeChatBranchIntoParentResult } from "./db/chat-branches.js";
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
} from "./types.js";
