/**
  * agent-pool/omp-rpc/host-tools.ts – Harvest piclaw's built-in tools as omp
  * host tools via a capturing ExtensionAPI shim.
  *
  * Mirrors the factory list in extensions/index.ts EXCLUDING
  * createSmartCompactionExtension: omp compacts natively via its own RPC
  * `compact` command, so piclaw's compaction extension must not surface as a
  * host tool (two conflicting compaction paths). Lifecycle hooks (pi.on) are
  * pi-specific and inert under omp in this pilot.
  */
import type { ExtensionFactory, ModelRuntime } from "@earendil-works/pi-coding-agent";

import { createFileAttachmentsExtension } from "../../extensions/file-attachments.js";
import { messagesCrud } from "../../extensions/messages-crud.js";
import { modelControl } from "../../extensions/model-control.js";
import { internalTools } from "../../extensions/internal-tools.js";
import { runtimeScripts } from "../../extensions/runtime-scripts.js";
import { toolActivation } from "../../extensions/tool-activation.js";
import { sqlIntrospect } from "../../extensions/sql-introspect.js";
import { scheduledTasks } from "../../extensions/scheduled-tasks.js";
import { workspaceSearch } from "../../extensions/workspace-search.js";
import { workspaceMemoryBootstrap } from "../../extensions/workspace-memory-bootstrap.js";
import { dreamMaintenance } from "../../extensions/dream-maintenance.js";
import { uiThemeExtension } from "../../extensions/ui-theme.js";
import { sendAdaptiveCard } from "../../extensions/send-adaptive-card.js";
import { sendDashboardWidget } from "../../extensions/send-dashboard-widget.js";
import { chatTool } from "../../extensions/chat-tool.js";
import { sessionControl } from "../../extensions/session-control.js";
import { openWorkspaceFile } from "../../extensions/open-workspace-file.js";
import { envTools } from "../../extensions/env-tools.js";
import { exitProcess } from "../../extensions/exit-process.js";
import { imageProcessing } from "../../extensions/image-processing.js";
import { sessionStatus } from "../../extensions/session-status.js";
import { providerRequestSanitizer } from "../../extensions/provider-request-sanitizer.js";
import { providerResponseDiagnostics } from "../../extensions/provider-response-diagnostics.js";
import { persistedToolResultSanitizer } from "../../extensions/persisted-tool-result-sanitizer.js";
import { createContextPruneExtension } from "../../extensions/context-prune.js";
import { llmContextNormalizer } from "../../extensions/llm-context-normalizer.js";
import { mcpTimeoutPatch } from "../../extensions/mcp-timeout-patch.js";
import { localLitePromptProfile } from "../../extensions/local-lite-prompt-profile.js";

import type { RpcHostToolDefinition } from "./rpc-protocol-types.js";

/** A tool captured from an extension factory for host-tool dispatch. */
export interface CapturedTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: (partial: unknown) => void,
  ) => Promise<{ content: unknown[]; details?: unknown }>;
}

/** extensions/index.ts factory array minus createSmartCompactionExtension. */
function buildOmpToolFactories(modelRuntime: ModelRuntime): ExtensionFactory[] {
  return [
    createFileAttachmentsExtension(undefined),
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
    providerResponseDiagnostics,
    persistedToolResultSanitizer,
    createContextPruneExtension({ modelRuntime }),
    llmContextNormalizer,
    mcpTimeoutPatch,
    localLitePromptProfile,
  ];
}

/** Capturing shim: records registerTool definitions; every other API call is a silent no-op. */
function createCapturingExtensionApi(sink: Map<string, CapturedTool>): unknown {
  return new Proxy({}, {
    get(_target, prop) {
      if (prop === "registerTool") {
        return (def: CapturedTool) => {
          if (def && typeof def.name === "string" && def.name) sink.set(def.name, def);
        };
      }
      if (prop === "on" || prop === "once") {
        return () => () => { };
      }
      return () => { };
    },
  });
}

/** Run all omp-compatible builtin factories against the capturing shim. */
export function harvestOmpHostTools(modelRuntime: ModelRuntime): {
  definitions: RpcHostToolDefinition[];
  execute: Map<string, CapturedTool>;
} {
  const sink = new Map<string, CapturedTool>();
  const api = createCapturingExtensionApi(sink);
  for (const factory of buildOmpToolFactories(modelRuntime)) {
    try {
      (factory as (api: unknown) => void)(api);
    } catch {
      // A factory that needs pi session APIs at registration time contributes
      // no tools to omp; skip it rather than fail the whole harvest.
    }
  }
  const definitions = [...sink.values()].map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
  return { definitions, execute: sink };
}
