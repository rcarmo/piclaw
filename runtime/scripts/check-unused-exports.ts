#!/usr/bin/env bun

import { spawnSync } from "bun";

/** Normalized unused-export policy entries with explicit retention reasons. Keep entries line-number free. */
const ALLOWED_UNUSED_EXPORTS = new Map<string, string>([
  ["src/addons/addon-api-health.ts - resetAddonApiHealthForTests", "test-only API for focused addons/addon-api-health.ts regression harnesses"],
  ["src/addons/runtime-contributions.ts - resetAddonRuntimeContributionsForTests", "test-only API for focused addons/runtime-contributions.ts regression harnesses"],
  ["src/agent-control/handlers/control.ts - setKillTrackedProcessesForRestartForTests", "test-only API for focused agent-control/handlers/control.ts regression harnesses"],
  ["src/agent-memory/daily-notes.ts - DAILY_NOTES_DIR", "Dream daily-notes directory contract retained for memory maintenance"],
  ["src/agent-pool.ts - TurnOutput", "AgentPool public type export retained for runtime composition imports"],
  ["src/agent-pool/branch-seeding.ts - clearDeferredBranchSeed", "branch seeding persistence helper retained for deferred branch lifecycle recovery"],
  ["src/agent-pool/branch-seeding.ts - readDeferredBranchSeed", "branch seeding persistence helper retained for deferred branch lifecycle recovery"],
  ["src/agent-pool/compaction.ts - scheduleIdleAutoCompaction", "agent-pool compaction scheduling helper retained for runtime compatibility"],
  ["src/agent-pool/llm-context-normalizer.ts - normalizeAgentMessages", "LLM context normalizer helper retained for extension and provider-boundary compatibility"],
  ["src/agent-pool/provider-usage.ts - clearProviderUsageCache", "provider usage cache/control surface retained for status tools and tests"],
  ["src/agent-pool/provider-usage.ts - getProviderUsage", "provider usage cache/control surface retained for status tools and tests"],
  ["src/channels/web/handlers/addon-config-api.ts - resetAddonConfigApiRegistryForTests", "test-only API for focused channels/web/handlers/addon-config-api.ts regression harnesses"],
  ["src/channels/web/handlers/addons.ts - setAddonInstallTestHooksForTests", "test-only API for focused channels/web/handlers/addons.ts regression harnesses"],
  ["src/channels/web/http/client.ts - firstHeaderValue", "web HTTP client helper retained for route tests and future header parsing reuse"],
  ["src/channels/web/http/extension-routes.ts - clearExtensionRoutes", "extension route registry test/debug API retained for web extension route tests"],
  ["src/channels/web/http/extension-routes.ts - isExtensionRouteRegistryFrozen", "extension route registry test/debug API retained for web extension route tests"],
  ["src/channels/web/http/rate-limit.ts - resetRateLimiterStateForTests", "test-only API for focused channels/web/http/rate-limit.ts regression harnesses"],
  ["src/channels/web/ui-context.ts - bindSessionUiContext", "web UI context binder retained for web channel UI wiring compatibility"],
  ["src/db.ts - KvEntry", "public database barrel contract retained for runtime modules, add-ons, and tests importing ./db.js"],
  ["src/db.ts - KvQueryOptions", "public database barrel contract retained for runtime modules, add-ons, and tests importing ./db.js"],
  ["src/db.ts - KvScope", "public database barrel contract retained for runtime modules, add-ons, and tests importing ./db.js"],
  ["src/db.ts - LinkPreviewImageCacheRecord", "public database barrel contract retained for runtime modules, add-ons, and tests importing ./db.js"],
  ["src/db.ts - endChatRunWithError", "public database barrel contract retained for runtime modules, add-ons, and tests importing ./db.js"],
  ["src/db.ts - extensionKvDeleteByChatJid", "public database barrel contract retained for runtime modules, add-ons, and tests importing ./db.js"],
  ["src/db.ts - extensionKvPrune", "public database barrel contract retained for runtime modules, add-ons, and tests importing ./db.js"],
  ["src/db.ts - getTaskRunLogs", "public database barrel contract retained for runtime modules, add-ons, and tests importing ./db.js"],
  ["src/db.ts - hasAgentRepliesAfter", "public database barrel contract retained for runtime modules, add-ons, and tests importing ./db.js"],
  ["src/db.ts - listSshConfigs", "public database barrel contract retained for runtime modules, add-ons, and tests importing ./db.js"],
  ["src/db.ts - previewPermanentDeleteArchivedBranch", "public database barrel contract retained for runtime modules, add-ons, and tests importing ./db.js"],
  ["src/db/media-compression.ts - isCompressed", "media compression helper retained for media storage and migration compatibility tests"],
  ["src/db/messages.ts - getMessageAnnotations", "database submodule API retained for messages.ts low-level runtime consumers"],
  ["src/db/messages.ts - getThinkingContent", "database submodule API retained for messages.ts low-level runtime consumers"],
  ["src/db/remote-interop.ts - countRemoteRequests", "remote interop persistence contract retained for pairing and remote-request workflows"],
  ["src/db/remote-interop.ts - createOutboundPairRequest", "remote interop persistence contract retained for pairing and remote-request workflows"],
  ["src/db/remote-interop.ts - getAllRemoteRequests", "remote interop persistence contract retained for pairing and remote-request workflows"],
  ["src/db/remote-interop.ts - getPairRequestById", "remote interop persistence contract retained for pairing and remote-request workflows"],
  ["src/db/remote-interop.ts - getPendingOutboundPairRequest", "remote interop persistence contract retained for pairing and remote-request workflows"],
  ["src/db/remote-interop.ts - getPendingPairRequests", "remote interop persistence contract retained for pairing and remote-request workflows"],
  ["src/db/remote-interop.ts - getPendingRemoteRequests", "remote interop persistence contract retained for pairing and remote-request workflows"],
  ["src/db/router-state.ts - deleteRouterState", "router state helper retained for runtime state maintenance compatibility"],
  ["src/extension-kv-registry.ts - getExtensionKvStore", "extension KV store factory retained for add-on dynamic KV consumers"],
  ["src/extensions/azure-openai-api.ts - applySessionCorrelationHeaders", "extension entrypoint/runtime-discovered API for azure-openai-api.ts packaged integration consumers"],
  ["src/extensions/azure-openai-api.ts - applyToolCallLimit", "extension entrypoint/runtime-discovered API for azure-openai-api.ts packaged integration consumers"],
  ["src/extensions/azure-openai-api.ts - buildBaseOptions", "extension entrypoint/runtime-discovered API for azure-openai-api.ts packaged integration consumers"],
  ["src/extensions/azure-openai-api.ts - clampReasoning", "extension entrypoint/runtime-discovered API for azure-openai-api.ts packaged integration consumers"],
  ["src/extensions/azure-openai-api.ts - resolveCacheSessionId", "extension entrypoint/runtime-discovered API for azure-openai-api.ts packaged integration consumers"],
  ["src/extensions/bun-runner.ts - bunRunner", "extension entrypoint/runtime-discovered API for bun-runner.ts packaged integration consumers"],
  ["src/extensions/chat-tool-runtime.ts - __chatToolRuntimeInternals", "internal diagnostic surface for extensions/chat-tool-runtime.ts focused tests and debugging"],
  ["src/extensions/context-mode-api.ts - buildPreview", "context-mode compatibility bridge consumed by packaged context-mode extension imports"],
  ["src/extensions/context-mode-api.ts - createBatchExecTool", "context-mode compatibility bridge consumed by packaged context-mode extension imports"],
  ["src/extensions/context-mode-api.ts - createToolOutputSearchTool", "context-mode compatibility bridge consumed by packaged context-mode extension imports"],
  ["src/extensions/context-mode-api.ts - getToolResultCompactionEnabled", "context-mode compatibility bridge consumed by packaged context-mode extension imports"],
  ["src/extensions/context-mode-api.ts - getToolResultCompactionThresholdsByTool", "context-mode compatibility bridge consumed by packaged context-mode extension imports"],
  ["src/extensions/context-mode-api.ts - getToolResultCompactionTools", "context-mode compatibility bridge consumed by packaged context-mode extension imports"],
  ["src/extensions/context-mode-api.ts - getToolResultSemanticSummaryConfig", "context-mode compatibility bridge consumed by packaged context-mode extension imports"],
  ["src/extensions/context-mode-api.ts - readToolOutputFile", "context-mode compatibility bridge consumed by packaged context-mode extension imports"],
  ["src/extensions/context-mode-api.ts - saveToolOutput", "context-mode compatibility bridge consumed by packaged context-mode extension imports"],
  ["src/extensions/context-mode-api.ts - startToolOutputCleanup", "context-mode compatibility bridge consumed by packaged context-mode extension imports"],
  ["src/extensions/context-prune/batch-capture.ts - serializeBatchesForSummarizer", "extension entrypoint/runtime-discovered API for context-prune/batch-capture.ts packaged integration consumers"],
  ["src/extensions/github-copilot-dynamic-models.ts - setGitHubCopilotDynamicModelsFetchForTests", "test-only API for focused extensions/github-copilot-dynamic-models.ts regression harnesses"],
  ["src/extensions/index.ts - builtinExtensionFactories", "built-in extension registry consumed by session startup and extension-hook audits"],
  ["src/extensions/keychain-tools.ts - keychainTools", "extension entrypoint/runtime-discovered API for keychain-tools.ts packaged integration consumers"],
  ["src/extensions/model-execution-runtime.ts - __setRuntimeModelExecutorForTests", "test-only API for focused extensions/model-execution-runtime.ts regression harnesses"],
  ["src/extensions/model-execution-runtime.ts - getRuntimeModelExecutor", "runtime model-executor API used by context/smart-compaction integrations and focused tests"],
  ["src/extensions/request-batch.ts - BatchedRequestItem", "request-batch compatibility API for packaged batch-request extension consumers"],
  ["src/extensions/request-batch.ts - RequestBatchControls", "request-batch compatibility API for packaged batch-request extension consumers"],
  ["src/extensions/request-batch.ts - appendOutputFileNote", "request-batch compatibility API for packaged batch-request extension consumers"],
  ["src/extensions/request-batch.ts - runRequestBatch", "request-batch compatibility API for packaged batch-request extension consumers"],
  ["src/extensions/request-batch.ts - writeRequestOutputFile", "request-batch compatibility API for packaged batch-request extension consumers"],
  ["src/extensions/session-status.ts - removeSession", "extension entrypoint/runtime-discovered API for session-status.ts packaged integration consumers"],
  ["src/extensions/smart-compaction.ts - CompactionSourceEvent", "smart-compaction compatibility facade retained for existing extension/test imports from src/extensions/smart-compaction.js"],
  ["src/extensions/smart-compaction.ts - CompactionSourceUnit", "smart-compaction compatibility facade retained for existing extension/test imports from src/extensions/smart-compaction.js"],
  ["src/extensions/smart-compaction.ts - PreparedCompactionSource", "smart-compaction compatibility facade retained for existing extension/test imports from src/extensions/smart-compaction.js"],
  ["src/extensions/smart-compaction.ts - TraditionalPipelinePlan", "smart-compaction compatibility facade retained for existing extension/test imports from src/extensions/smart-compaction.js"],
  ["src/extensions/smart-compaction.ts - TraditionalPipelinedPrompt", "smart-compaction compatibility facade retained for existing extension/test imports from src/extensions/smart-compaction.js"],
  ["src/extensions/smart-compaction.ts - assemblePipelineEvents", "smart-compaction compatibility facade retained for existing extension/test imports from src/extensions/smart-compaction.js"],
  ["src/extensions/smart-compaction.ts - buildPipelinedAuditTelemetry", "smart-compaction compatibility facade retained for existing extension/test imports from src/extensions/smart-compaction.js"],
  ["src/extensions/smart-compaction.ts - buildProgressiveCompactionChunks", "smart-compaction compatibility facade retained for existing extension/test imports from src/extensions/smart-compaction.js"],
  ["src/extensions/smart-compaction.ts - buildProgressiveCompactionChunksFromSourceUnits", "smart-compaction compatibility facade retained for existing extension/test imports from src/extensions/smart-compaction.js"],
  ["src/extensions/smart-compaction.ts - buildTraditionalPipelinePlan", "smart-compaction compatibility facade retained for existing extension/test imports from src/extensions/smart-compaction.js"],
  ["src/extensions/smart-compaction.ts - buildTraditionalPipelinedPrompt", "smart-compaction compatibility facade retained for existing extension/test imports from src/extensions/smart-compaction.js"],
  ["src/extensions/smart-compaction.ts - buildTrimmedCompactionRetryPrompt", "smart-compaction compatibility facade retained for existing extension/test imports from src/extensions/smart-compaction.js"],
  ["src/extensions/smart-compaction.ts - clampKeepRecentTokens", "smart-compaction compatibility facade retained for existing extension/test imports from src/extensions/smart-compaction.js"],
  ["src/extensions/smart-compaction.ts - estimatePostCompactionFit", "smart-compaction compatibility facade retained for existing extension/test imports from src/extensions/smart-compaction.js"],
  ["src/extensions/smart-compaction.ts - formatProgressCount", "smart-compaction compatibility facade retained for existing extension/test imports from src/extensions/smart-compaction.js"],
  ["src/extensions/smart-compaction.ts - formatProgressRange", "smart-compaction compatibility facade retained for existing extension/test imports from src/extensions/smart-compaction.js"],
  ["src/extensions/smart-compaction.ts - getCompactionOutputTokenTarget", "smart-compaction compatibility facade retained for existing extension/test imports from src/extensions/smart-compaction.js"],
  ["src/extensions/smart-compaction.ts - getCompactionReasoningEffort", "smart-compaction compatibility facade retained for existing extension/test imports from src/extensions/smart-compaction.js"],
  ["src/extensions/smart-compaction.ts - getCompactionRetryPromptTokenTarget", "smart-compaction compatibility facade retained for existing extension/test imports from src/extensions/smart-compaction.js"],
  ["src/extensions/smart-compaction.ts - getProgressiveCompactionBudget", "smart-compaction compatibility facade retained for existing extension/test imports from src/extensions/smart-compaction.js"],
  ["src/extensions/smart-compaction.ts - getSafeCompactionMaxTokens", "smart-compaction compatibility facade retained for existing extension/test imports from src/extensions/smart-compaction.js"],
  ["src/extensions/smart-compaction.ts - isAllowlistedPipelineDropReason", "smart-compaction compatibility facade retained for existing extension/test imports from src/extensions/smart-compaction.js"],
  ["src/extensions/smart-compaction.ts - prepareCompactionSource", "smart-compaction compatibility facade retained for existing extension/test imports from src/extensions/smart-compaction.js"],
  ["src/extensions/smart-compaction/retained-context.ts - buildTurnPrefixSummary", "smart-compaction submodule public helper retained for focused tests and compatibility imports"],
  ["src/extensions/smart-compaction/selective-execution.ts - SelectiveCompactionExecutionResult", "backward-compatible selective-compaction alias module retained for external extension imports"],
  ["src/extensions/smart-compaction/selective-execution.ts - SelectiveCompactionStage", "backward-compatible selective-compaction alias module retained for external extension imports"],
  ["src/extensions/smart-compaction/selective-execution.ts - runSelectiveCompaction", "backward-compatible selective-compaction alias module retained for external extension imports"],
  ["src/extensions/smart-compaction/selective-prompt.ts - buildSelectivePrompt", "smart-compaction submodule public helper retained for focused tests and compatibility imports"],
  ["src/extensions/ssh-core.ts - createSshCoreExtension", "extension entrypoint/runtime-discovered API for ssh-core.ts packaged integration consumers"],
  ["src/extensions/ssh-core.ts - setPersistentSshInterruptGraceMsForTests", "test-only API for focused extensions/ssh-core.ts regression harnesses"],
  ["src/extensions/ssh-core.ts - setPersistentSshSpawnForTests", "test-only API for focused extensions/ssh-core.ts regression harnesses"],
  ["src/extensions/ssh-core.ts - setSshConnectionResolverForTests", "test-only API for focused extensions/ssh-core.ts regression harnesses"],
  ["src/extensions/ssh.ts - sshTool", "extension entrypoint/runtime-discovered API for ssh.ts packaged integration consumers"],
  ["src/extensions/structured-tool-response.ts - presentStructuredToolValue", "extension entrypoint/runtime-discovered API for structured-tool-response.ts packaged integration consumers"],
  ["src/remote/identity.ts - exportPublicKey", "remote interop API retained for identity.ts pairing/signature/security workflows"],
  ["src/remote/identity.ts - resetInteropIdentityForTests", "test-only API for focused remote/identity.ts regression harnesses"],
  ["src/remote/service-security.ts - verifyCallbackProof", "remote interop API retained for service-security.ts pairing/signature/security workflows"],
  ["src/router.ts - escapeXml", "router XML escaping helper retained for channel formatting compatibility"],
  ["src/runtime/progress-watchdog-supervisor.ts - resetProgressWatchdogSupervisorForTests", "test-only API for focused runtime/progress-watchdog-supervisor.ts regression harnesses"],
  ["src/runtime/progress-watchdog-supervisor.ts - setProgressWatchdogMonitorSpawnForTests", "test-only API for focused runtime/progress-watchdog-supervisor.ts regression harnesses"],
  ["src/runtime/progress-watchdog-supervisor.ts - setProgressWatchdogSupervisorEnvironmentForTests", "test-only API for focused runtime/progress-watchdog-supervisor.ts regression harnesses"],
  ["src/runtime/progress-watchdog.ts - resetProgressWatchdogForTests", "test-only API for focused runtime/progress-watchdog.ts regression harnesses"],
  ["src/runtime/progress-watchdog.ts - setProgressWatchdogTerminationHook", "progress watchdog test/control hook retained for runtime watchdog tests"],
  ["src/runtime/progress-watchdog.ts - setProgressWatchdogTimeoutForTests", "test-only API for focused runtime/progress-watchdog.ts regression harnesses"],
  ["src/runtime/provider-bootstrap.ts - resetProviderBootstrapForTests", "test-only API for focused runtime/provider-bootstrap.ts regression harnesses"],
  ["src/runtime/provider-bootstrap.ts - setProviderBootstrapLoaderForTests", "test-only API for focused runtime/provider-bootstrap.ts regression harnesses"],
  ["src/secure/keychain-providers.ts - clearKeychainProviders", "keychain provider registry public API retained for dynamic keychain integrations"],
  ["src/secure/keychain-providers.ts - getRegisteredKeychainProviders", "keychain provider registry public API retained for dynamic keychain integrations"],
  ["src/secure/keychain-providers.ts - registerKeychainProvider", "keychain provider registry public API retained for dynamic keychain integrations"],
  ["src/secure/keychain-providers.ts - unregisterKeychainProvider", "keychain provider registry public API retained for dynamic keychain integrations"],
  ["src/secure/keychain.ts - isInjectableKeychainEnvName", "keychain test/injection helper retained for secure keychain tests and env injection"],
  ["src/secure/keychain.ts - setKeyMaterialProviderForTests", "test-only API for focused secure/keychain.ts regression harnesses"],
  ["src/secure/shell-secrets.ts - buildInjectedPosixCommand", "shell secret injection builder retained for shell/keychain integration tests"],
  ["src/secure/shell-secrets.ts - buildInjectedPowerShellCommand", "shell secret injection builder retained for shell/keychain integration tests"],
  ["src/session-recordings/session-recordings.ts - resetSessionRecordingsForTests", "test-only API for focused session-recordings/session-recordings.ts regression harnesses"],
  ["src/task-scheduler.ts - getSchedulerMetrics", "scheduler metrics helpers retained for scheduler diagnostics and tests"],
  ["src/task-scheduler.ts - resetSchedulerMetricsForTests", "test-only API for focused task-scheduler.ts regression harnesses"],
  ["src/tools/tracked-bash.ts - createTrackedPowerShellOperations", "dynamic packaged Windows PowerShell extension imports this factory from runtime/extensions/platform/windows/powershell"],
  ["src/types.ts - ChatConfig", "shared runtime public type contract retained for channel adapters and add-on consumers"],
  ["src/types.ts - OnChatMetadata", "shared runtime public type contract retained for channel adapters and add-on consumers"],
  ["src/types.ts - OnInboundMessage", "shared runtime public type contract retained for channel adapters and add-on consumers"],
  ["src/types.ts - PortainerConfigClearResult", "shared runtime public type contract retained for channel adapters and add-on consumers"],
  ["src/types.ts - PortainerConfigSetResult", "shared runtime public type contract retained for channel adapters and add-on consumers"],
  ["src/types.ts - ProxmoxConfigClearResult", "shared runtime public type contract retained for channel adapters and add-on consumers"],
  ["src/types.ts - ProxmoxConfigSetResult", "shared runtime public type contract retained for channel adapters and add-on consumers"],
  ["src/utils/ids.ts - createId", "ID helper retained for runtime/test compatibility imports"],
  ["src/utils/process-tracker.ts - listTrackedProcesses", "process tracker diagnostics API retained for process lifecycle tests"],
  ["src/workspace-search.ts - setBackgroundWorkspaceIndexRefreshRequesterForTests", "test-only API for focused workspace-search.ts regression harnesses"],
]);

export function normalizeUnusedExportEntry(entry: string): string {
  const match = entry.match(/^(.*?):\d+\s+-\s+(.*)$/);
  if (!match) return entry;
  const [, filePath, exportName] = match;
  return `${filePath} - ${exportName}`;
}

const NORMALIZED_ALLOWED_UNUSED_EXPORTS = new Set(
  Array.from(ALLOWED_UNUSED_EXPORTS.keys(), (entry) => normalizeUnusedExportEntry(entry))
);

export function parseUnusedExports(tsPruneOutput: string): string[] {
  return tsPruneOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.includes("(used in module)"))
    .sort();
}

export function getAllowedUnusedExportReason(entry: string): string | undefined {
  return ALLOWED_UNUSED_EXPORTS.get(normalizeUnusedExportEntry(entry));
}

export function findUnexpectedUnusedExports(entries: string[]): string[] {
  return entries
    .filter((entry) => !NORMALIZED_ALLOWED_UNUSED_EXPORTS.has(normalizeUnusedExportEntry(entry)))
    .sort();
}

if (import.meta.main) {
  const proc = spawnSync(["bunx", "ts-prune", "-p", "tsconfig.json"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  if (proc.exitCode !== 0) {
    console.error("[unused-exports] ts-prune failed:");
    console.error(proc.stderr.toString());
    process.exit(proc.exitCode ?? 1);
  }

  const entries = parseUnusedExports(proc.stdout.toString());
  const unexpected = findUnexpectedUnusedExports(entries);

  if (unexpected.length > 0) {
    console.error("[unused-exports] unexpected unused exports detected:");
    for (const entry of unexpected) {
      console.error(` - ${entry}`);
    }
    process.exit(1);
  }

  console.log(`[unused-exports] ok (${entries.length} allowlisted entries)`);
}
