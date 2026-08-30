/**
 * extensions/index.ts – Registry of built-in extension factories.
 *
 * These factories are passed to the pi-coding-agent's DefaultResourceLoader
 * so they load automatically without needing separate files on disk.
 * Each factory registers tools and/or commands on the pi ExtensionAPI.
 *
 * Extensions registered here:
 *   - fileAttachments: attach_file tool for delivering workspace files.
 *   - messages: unified messages tool for searching, retrieving, adding, and deleting chat messages.
 *   - modelControl: get_model_state, list_models, switch_model, switch_thinking.
 *   - internalTools: list_tools for tool discovery.
 *   - runtimeScripts: list_scripts for packaged/workspace script discovery.
 *   - toolActivation: activate_tools/reset_active_tools for lazy tool activation.
 *   - sqlIntrospect: introspect_sql for read-only DB introspection.
 *   - scheduledTasks: /tasks and /scheduled commands for task listing.
 *   - workspaceSearch: search_workspace tool for FTS over workspace files.
 *   - dreamMaintenance: /dream memory-consolidation slash command.
 *   - sendAdaptiveCard: send_adaptive_card for agent-owned Adaptive Card posting.
 *   - sendDashboardWidget: send_dashboard_widget for posting the built-in live dashboard widget.
 *   - chatTool: chat for cross-session agent-to-agent messaging.
 *   - openWorkspaceFile: open_workspace_file for browser-side editor tab/popout launches.
 *   - envTools: env for persistent workspace-scoped environment variables.
 *   - contextPrune: context_prune/context_tree_query for recoverable tool-result pruning.
 *   - providerRequestSanitizer: defensive provider payload cleanup before HTTP requests.
 *   - openRouterRequestFilter: bounded OpenRouter output budgets and adaptive retry overrides.
 *   - llmContextNormalizer: defensive LLM message-shape cleanup before provider conversion.
 *   - mcpTimeoutPatch: Piclaw-compatible outer timeout/abort guard for MCP tools.
 *   - localLitePromptProfile: compact prompt/tool profile for local OpenAI-compatible models.
 *
 * Note: bun_run, keychain, ssh, proxmox, and portainer now live as packaged
 * runtime extensions under runtime/extensions/integrations/* and are loaded via
 * the additionalExtensionPaths wiring in agent-pool/session.ts.
 *
 * Consumers:
 *   - agent-pool/session.ts passes builtinExtensionFactories to the resource loader.
 */
import type { ExtensionFactory, ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AttachmentRegistry } from "../agent-pool/attachments.js";
import { createFileAttachmentsExtension } from "./file-attachments.js";
import { messagesCrud } from "./messages-crud.js";
import { modelControl } from "./model-control.js";
import { internalTools } from "./internal-tools.js";
import { runtimeScripts } from "./runtime-scripts.js";
import { toolActivation } from "./tool-activation.js";
import { sqlIntrospect } from "./sql-introspect.js";
import { scheduledTasks } from "./scheduled-tasks.js";
import { workspaceSearch } from "./workspace-search.js";
import { workspaceMemoryBootstrap } from "./workspace-memory-bootstrap.js";
import { dreamMaintenance } from "./dream-maintenance.js";
import { uiThemeExtension } from "./ui-theme.js";
import { createSmartCompactionExtension, type CompactionStreamFn } from "./smart-compaction.js";
import { sendAdaptiveCard } from "./send-adaptive-card.js";
import { sendDashboardWidget } from "./send-dashboard-widget.js";
import { chatTool } from "./chat-tool.js";
import { sessionControl } from "./session-control.js";
import { openWorkspaceFile } from "./open-workspace-file.js";
import { envTools } from "./env-tools.js";
import { exitProcess } from "./exit-process.js";
import { imageProcessing } from "./image-processing.js";
import { sessionStatus } from "./session-status.js";
import { providerResponseDiagnostics } from "./provider-response-diagnostics.js";
import { providerRequestSanitizer } from "./provider-request-sanitizer.js";
import { openRouterRequestFilter } from "./openrouter-request-filter.js";
import { llmContextNormalizer } from "./llm-context-normalizer.js";
import { persistedToolResultSanitizer } from "./persisted-tool-result-sanitizer.js";
import { createContextPruneExtension } from "./context-prune.js";
import { mcpTimeoutPatch } from "./mcp-timeout-patch.js";
import { localLitePromptProfile } from "./local-lite-prompt-profile.js";
import { createUiPromptWatchdogExtension } from "./ui-prompt-watchdog.js";

/** Build the built-in extension factory list used for session creation. */
export function createBuiltinExtensionFactories(options?: {
  attachmentRegistry?: AttachmentRegistry;
  compactionStreamFn?: CompactionStreamFn;
  modelRuntime?: ModelRuntime;
  chatJid?: string;
}): ExtensionFactory[] {
  return [
    createFileAttachmentsExtension(options?.attachmentRegistry),
    messagesCrud,
    modelControl,
    internalTools,
    runtimeScripts,
    toolActivation,
    sqlIntrospect,
    scheduledTasks,
    workspaceSearch,
    workspaceMemoryBootstrap,
    dreamMaintenance,
    uiThemeExtension,
    createSmartCompactionExtension({ streamFn: options?.compactionStreamFn, modelRuntime: options?.modelRuntime }),
    sendAdaptiveCard,
    sendDashboardWidget,
    chatTool,
    sessionControl,
    openWorkspaceFile,
    envTools,
    exitProcess,
    imageProcessing,
    sessionStatus,
    providerRequestSanitizer,
    openRouterRequestFilter,
    providerResponseDiagnostics,
    persistedToolResultSanitizer,
    createContextPruneExtension({ modelRuntime: options?.modelRuntime }),
    llmContextNormalizer,
    mcpTimeoutPatch,
    localLitePromptProfile,
    createUiPromptWatchdogExtension(options?.chatJid),
  ];
}

/** Array of all built-in extension factories to register on session creation. */
export const builtinExtensionFactories: ExtensionFactory[] = createBuiltinExtensionFactories();
