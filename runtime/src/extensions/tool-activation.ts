/**
 * tool-activation – keeps the default active tool set small and lets the agent
 * enable specific tools on demand.
 */
import type { ExtensionAPI, ExtensionFactory } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { getToolActivationConfig } from "../core/config.js";
import { getToolCapability } from "./tool-capabilities.js";

export type ToolsetDefinition = {
  name: string;
  description: string;
  toolNames: string[];
};

export const TOOLSETS: ToolsetDefinition[] = [
  {
    name: "core",
    description: "Default coding tools for reading, editing, and shell work.",
    toolNames: ["read", "bash", "powershell", "edit", "write"],
  },
  {
    name: "discovery",
    description: "Tool discovery and lazy activation controls.",
    toolNames: ["list_tools", "list_internal_tools", "list_scripts", "activate_tools", "reset_active_tools"],
  },
  {
    name: "attachments",
    description: "Workspace file delivery and uploaded-attachment access.",
    toolNames: ["attach_file", "read_attachment", "export_attachment"],
  },
  {
    name: "model-control",
    description: "Inspect and switch the current model and thinking level.",
    toolNames: ["get_model_state", "list_models", "switch_model", "switch_thinking"],
  },
  {
    name: "data",
    description: "Structured data access for the shared message store, SQLite, and keychain.",
    toolNames: ["messages", "introspect_sql", "keychain"],
  },
  {
    name: "workspace",
    description: "Workspace search, document/diagram viewing, and image processing.",
    toolNames: [
      "search_workspace",
      "open_office_viewer",
      "office_read",
      "office_write",
      "image_process",
    ],
  },
  {
    name: "automation",
    description: "Automation helpers for scripts, scheduled tasks, and large-output inspection.",
    toolNames: ["schedule_task", "bun_run", "exec_batch", "search_tool_output"],
  },
  {
    name: "remote",
    description: "Remote execution configuration and remote-capable infrastructure tools.",
    toolNames: ["ssh"],
  },
  {
    name: "browser",
    description: "Browser automation via Chrome DevTools Protocol.",
    toolNames: ["cdp_browser"],
  },
  {
    name: "ui",
    description: "PiClaw web UI posting tools.",
    toolNames: ["send_adaptive_card", "send_dashboard_widget"],
  },
  {
    name: "experiments",
    description: "Autonomous experiment orchestration.",
    toolNames: ["start_autoresearch", "stop_autoresearch", "autoresearch_status"],
  },
  {
    name: "lifecycle",
    description: "Managed process lifecycle control.",
    toolNames: ["exit_process"],
  },
];

const DEFAULT_ACTIVE_TOOL_NAMES = [
  "read",
  "bash",
  "powershell",
  "edit",
  "write",
  "list_tools",
  "activate_tools",
  "reset_active_tools",
  "attach_file",
  "messages",
  "keychain",
  "exit_process",
] as const;

const WINDOWS_DEFAULT_ACTIVE_TOOL_NAMES = [
  "bun_run",
] as const;

const AUTO_ACTIVE_TOOL_NAMES = [
  "messages",
  "schedule_task",
  "scheduled_tasks",
  "attach_file",
  "read_attachment",
  "export_attachment",
] as const;

const TOOL_ACTIVATION_HINT = [
  "## Tool Activation",
  "Keep the active tool set small by default.",
  "Discover first: if you are unsure which capability is available, call list_tools with a focused query before activating extra tools.",
  "Use activate_tools to enable only what you need, when you need it.",
  "Newly activated tools become available immediately to subsequent tool/model steps in the same turn.",
  "Use reset_active_tools to return to the default configured tool set.",
].join("\n");

const ActivateToolsSchema = Type.Object({
  names: Type.Array(Type.String({ description: "Exact tool name to activate." }), {
    description: "Tool names to activate for the current session.",
    minItems: 1,
  }),
  mode: Type.Optional(Type.Union([
    Type.Literal("append"),
    Type.Literal("replace"),
  ], { description: "append keeps currently active tools; replace swaps to only the requested tools plus the configured default baseline." })),
});

function unique(values: Iterable<string>): string[] {
  return [...new Set(Array.from(values).map((value) => String(value || "").trim()).filter(Boolean))];
}

function toToolName(value: string | { name?: unknown }): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.name === "string") return value.name;
  return "";
}

function normalizeToolNamesForPlatform(toolNames: Iterable<string>, platform = process.platform): string[] {
  const normalized = unique(toolNames);
  if (platform !== "win32") {
    return normalized.filter((name) => name !== "powershell");
  }

  return unique(normalized.map((name) => (name === "bash" ? "powershell" : name))).filter((name) => name !== "bash");
}

export function getToolsetsForTool(toolName: string): string[] {
  return TOOLSETS.filter((toolset) => toolset.toolNames.includes(toolName)).map((toolset) => toolset.name);
}

export function getDefaultActiveToolNames(platform = process.platform): string[] {
  return normalizeToolNamesForPlatform([
    ...DEFAULT_ACTIVE_TOOL_NAMES,
    ...(platform === "win32" ? WINDOWS_DEFAULT_ACTIVE_TOOL_NAMES : []),
    ...getToolActivationConfig().additionalDefaultTools,
  ], platform);
}

export function getAutoActiveToolNames(
  tools: Iterable<string | { name?: unknown }>,
  platform = process.platform,
): string[] {
  const names = normalizeToolNamesForPlatform(
    Array.from(tools, (tool) => toToolName(tool)).filter(Boolean),
    platform,
  );
  const explicit = new Set<string>(AUTO_ACTIVE_TOOL_NAMES);
  return names.filter((name) => {
    if (explicit.has(name)) return true;
    const capability = getToolCapability(name);
    return capability.kind === "read-only" && capability.weight !== "heavy";
  });
}

export function getEffectiveDefaultActiveToolNames(
  tools: Iterable<string | { name?: unknown }>,
  platform = process.platform,
): string[] {
  const availableNames = normalizeToolNamesForPlatform(
    Array.from(tools, (tool) => toToolName(tool)).filter(Boolean),
    platform,
  );
  const availableSet = new Set(availableNames);
  return unique([
    ...getDefaultActiveToolNames(platform),
    ...getAutoActiveToolNames(availableNames, platform),
  ]).filter((name) => availableSet.has(name));
}

function getCatalog(api: ExtensionAPI) {
  const allTools = api.getAllTools();
  const allToolNames = new Set(allTools.map((tool) => tool.name));
  const activeToolNames = normalizeToolNamesForPlatform(api.getActiveTools());
  const activeSet = new Set(activeToolNames);
  return { allTools, allToolNames, activeToolNames, activeSet };
}

function applyActiveToolNames(
  api: ExtensionAPI,
  requestedNames: string[],
  mode: string | undefined,
): {
  activeToolNames: string[];
  requested: string[];
  accepted: string[];
  missing: string[];
  alreadyActive: string[];
  newlyActivated: string[];
} {
  const { allTools, allToolNames, activeToolNames, activeSet } = getCatalog(api);
  const requested = normalizeToolNamesForPlatform(requestedNames);
  const accepted = requested.filter((name) => allToolNames.has(name));
  const missing = requested.filter((name) => !allToolNames.has(name));
  const base = mode === "replace" ? getEffectiveDefaultActiveToolNames(allTools) : activeToolNames;
  const next = unique([...base, ...accepted]).filter((name) => allToolNames.has(name));

  api.setActiveTools(next);

  const alreadyActive = accepted.filter((name) => activeSet.has(name));
  const newlyActivated = accepted.filter((name) => !activeSet.has(name));

  return {
    activeToolNames: next,
    requested,
    accepted,
    missing,
    alreadyActive,
    newlyActivated,
  };
}

function formatActivationSummary(result: ReturnType<typeof applyActiveToolNames>, label: string): string {
  const lines = [
    `${label}: ${result.accepted.length} accepted, ${result.newlyActivated.length} newly active, ${result.alreadyActive.length} already active, ${result.missing.length} missing.`,
    `Active tools now: ${result.activeToolNames.join(", ") || "(none)"}.`,
  ];
  if (result.missing.length > 0) {
    lines.push(`Missing tools: ${result.missing.join(", ")}.`);
  }
  lines.push("Changes apply immediately to subsequent tool/model steps in the same turn.");
  lines.push("For frequently used or safety-critical tools, prefer the default active baseline or config-defined defaults.");
  return lines.join("\n");
}

/** Extension factory that registers lazy tool activation controls. */
export const toolActivation: ExtensionFactory = (pi: ExtensionAPI) => {
  pi.on("session_start", async () => {
    const { allTools } = getCatalog(pi);
    pi.setActiveTools(getEffectiveDefaultActiveToolNames(allTools));
  });

  pi.on("before_agent_start", async (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${TOOL_ACTIVATION_HINT}`,
  }));

  pi.registerTool({
    name: "activate_tools",
    label: "activate_tools",
    description: "Activate one or more available tools for the current session.",
    promptSnippet: "activate_tools: enable one or more available tools for the current session.",
    parameters: ActivateToolsSchema,
    async execute(_toolCallId, params) {
      const result = applyActiveToolNames(pi, params.names, params.mode);
      return {
        content: [{ type: "text", text: formatActivationSummary(result, "Tool activation updated") }],
        details: {
          availability: "same_turn",
          ...result,
        },
      };
    },
  });

  pi.registerTool({
    name: "reset_active_tools",
    label: "reset_active_tools",
    description: "Reset the current session to the configured default active tool set.",
    promptSnippet: "reset_active_tools: restore the configured default active tool set.",
    parameters: Type.Object({}),
    async execute() {
      const defaults = getEffectiveDefaultActiveToolNames(pi.getAllTools());
      const result = applyActiveToolNames(pi, defaults, "replace");
      return {
        content: [{ type: "text", text: formatActivationSummary(result, "Active tools reset") }],
        details: { availability: "same_turn", defaults, ...result },
      };
    },
  });
};
