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
 *   - internalTools: list_tools for tool discovery (with a deprecated list_internal_tools compatibility alias).
 *   - runtimeScripts: list_scripts for packaged/workspace script discovery.
 *   - toolActivation: activate_tools/reset_active_tools for lazy tool activation.
 *   - sqlIntrospect: introspect_sql for read-only DB introspection.
 *   - scheduledTasks: /tasks and /scheduled commands for task listing.
 *   - workspaceSearch: search_workspace tool for FTS over workspace files.
 *   - dreamMaintenance: /dream memory-consolidation slash command.
 *   - sendAdaptiveCard: send_adaptive_card for agent-owned Adaptive Card posting.
 *   - sendDashboardWidget: send_dashboard_widget for posting the built-in live dashboard widget.
 *   - openWorkspaceFile: open_workspace_file for browser-side editor tab/popout launches.
 *   - envTools: env for persistent workspace-scoped environment variables.
 *
 * Note: bun_run, keychain, ssh, proxmox, and portainer now live as packaged
 * runtime extensions under runtime/extensions/integrations/* and are loaded via
 * the additionalExtensionPaths wiring in agent-pool/session.ts.
 *
 * Consumers:
 *   - agent-pool/session.ts passes builtinExtensionFactories to the resource loader.
 */
import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";
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
import { smartCompaction } from "./smart-compaction.js";
import { sendAdaptiveCard } from "./send-adaptive-card.js";
import { sendDashboardWidget } from "./send-dashboard-widget.js";
import { openWorkspaceFile } from "./open-workspace-file.js";
import { envTools } from "./env-tools.js";
import { exitProcess } from "./exit-process.js";
import { autoresearchSupervisor } from "./autoresearch-supervisor.js";
import { imageProcessing } from "./image-processing.js";
import { remotePair } from "./remote-pair.js";

/** Build the built-in extension factory list used for session creation. */
export function createBuiltinExtensionFactories(options?: {
  attachmentRegistry?: AttachmentRegistry;
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
    smartCompaction,
    sendAdaptiveCard,
    sendDashboardWidget,
    openWorkspaceFile,
    envTools,
    exitProcess,
    autoresearchSupervisor,
    imageProcessing,
    remotePair,
  ];
}

/** Array of all built-in extension factories to register on session creation. */
export const builtinExtensionFactories: ExtensionFactory[] = createBuiltinExtensionFactories();
