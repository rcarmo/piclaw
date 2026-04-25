/**
 * agent-control/handlers/info.ts – Handlers for informational / read-only commands.
 *
 * Handles /commands, /state, /stats, /context, /last, /search-workspace,
 * /labels, and /label. These commands display session state, token usage,
 * and search results without modifying the session.
 *
 * Consumers: agent-control-handlers.ts dispatches to these handlers.
 */

import type { AgentSession } from "@mariozechner/pi-coding-agent";
import { statSync } from "fs";
import type { AgentControlCommand, AgentControlResult } from "../agent-control-types.js";
import { formatBytes, formatCompactNumber, formatCurrency } from "../agent-control-helpers.js";
import { CONTROL_COMMAND_DEFINITIONS } from "../command-registry.js";
import { getChatJid } from "../../core/chat-context.js";
import { getSessionStorageConfig } from "../../core/config.js";
import { getSessionFileLineCount } from "../../session-rotation.js";
import { getTokenUsageByModel, getTokenUsageByProvider, getTokenUsageTotals } from "../../db.js";
import { createLogger, debugSuppressedError } from "../../utils/logger.js";
import { searchWorkspace } from "../../workspace-search.js";

const log = createLogger("agent-control.info");

type StateCommand = Extract<AgentControlCommand, { type: "state" }>;
type StatsCommand = Extract<AgentControlCommand, { type: "stats" }>;
type ContextCommand = Extract<AgentControlCommand, { type: "context" }>;
type LastCommand = Extract<AgentControlCommand, { type: "last" }>;
type CommandsCommand = Extract<AgentControlCommand, { type: "commands" }>;
type SearchCommand = Extract<AgentControlCommand, { type: "search_workspace" }>;

/** Handle /state: display current session state summary. */
export async function handleState(session: AgentSession, _command: StateCommand): Promise<AgentControlResult> {
  const modelLabel = session.model ? `${session.model.provider}/${session.model.id}` : "none";
  const steeringCount = session.getSteeringMessages().length;
  const followUpCount = session.getFollowUpMessages().length;
  const sessionFileSize = (() => {
    if (!session.sessionFile) return null;
    try {
      return statSync(session.sessionFile).size;
    } catch {
      return null;
    }
  })();

  const sessionStorageConfig = getSessionStorageConfig();
  const isOversizedSession = sessionFileSize !== null && sessionFileSize >= sessionStorageConfig.maxSizeBytes;
  const sessionLineCount = getSessionFileLineCount(session.sessionFile);

  const lines = [
    "**Session state**",
    "",
    "| Setting | Value |",
    "|---|---|",
    `| **Model** | ${modelLabel} |`,
    `| **Thinking** | ${session.thinkingLevel}${session.supportsThinking() ? "" : " (off)"} |`,
    `| **Streaming** | ${session.isStreaming ? "yes" : "no"} |`,
    `| **Compacting** | ${session.isCompacting ? "yes" : "no"} |`,
    `| **Retrying** | ${session.isRetrying ? "yes" : "no"} |`,
    `| **Auto-compaction** | ${session.autoCompactionEnabled ? "on" : "off"} |`,
    `| **Auto-retry** | ${session.autoRetryEnabled ? "on" : "off"} |`,
    `| **Steering mode** | ${session.steeringMode} |`,
    `| **Follow-up mode** | ${session.followUpMode} |`,
    `| **Pending** | ${session.pendingMessageCount} (steer ${steeringCount}, follow-up ${followUpCount}) |`,
    `| **Session id** | ${session.sessionId} |`,
    `| **Session name** | ${session.sessionName || "none"} |`,
    `| **Session file** | ${session.sessionFile || "none"} |`,
    `| **File size** | ${sessionFileSize === null ? "unknown" : formatBytes(sessionFileSize)} |`,
  ];

  if (sessionLineCount !== null) {
    lines.push(`| **File lines** | ${sessionLineCount}${sessionStorageConfig.maxLines > 0 ? ` / ${sessionStorageConfig.maxLines} max` : ""} |`);
  }

  if (isOversizedSession && sessionFileSize !== null) {
    lines.push("", `> [!WARNING]\n> Session file exceeds threshold (${formatBytes(sessionFileSize)} >= ${sessionStorageConfig.maxSizeMb} MB). Consider \`/session-rotate\`.`);
  }
  return { status: "success", message: lines.join("\n") };
}

/** Handle /stats: display token usage and cost statistics. */
export async function handleStats(session: AgentSession, _command: StatsCommand): Promise<AgentControlResult> {
  const stats = session.getSessionStats();
  const tokens = stats.tokens;
  const lines = [
    "**Session stats**",
    "",
    "| Metric | Value |",
    "|---|---|",
    `| Messages | ${stats.userMessages} user, ${stats.assistantMessages} assistant, ${stats.toolResults} tool (${stats.totalMessages} total) |`,
    `| Tool calls | ${stats.toolCalls} |`,
    `| Tokens | in ${formatCompactNumber(tokens.input)}, out ${formatCompactNumber(tokens.output)}, cache-r ${formatCompactNumber(tokens.cacheRead)}, cache-w ${formatCompactNumber(tokens.cacheWrite)}, total ${formatCompactNumber(tokens.total)} |`,
    `| Cost | ${formatCurrency(stats.cost)} |`,
  ];

  const chatJid = getChatJid();
  try {
    const totals = getTokenUsageTotals(chatJid);
    if (totals.runs > 0) {
      const providerRows = getTokenUsageByProvider(chatJid, 5);
      const modelRows = getTokenUsageByModel(chatJid, 5);

      lines.push(
        "",
        "**Tracked usage (persisted)**",
        "",
        "| Metric | Value |",
        "|---|---|",
        `| Tokens | in ${formatCompactNumber(totals.input_tokens)}, out ${formatCompactNumber(totals.output_tokens)}, cache-r ${formatCompactNumber(totals.cache_read_tokens)}, cache-w ${formatCompactNumber(totals.cache_write_tokens)}, total ${formatCompactNumber(totals.total_tokens)} |`,
        `| Cost | ${formatCurrency(totals.cost_total)} |`,
        `| Runs | ${formatCompactNumber(totals.runs)} |`,
      );

      if (providerRows.length > 0) {
        lines.push(
          "",
          "**Per provider**",
          "",
          "| Provider | Tokens | Cost | Runs |",
          "|---|---|---|---|",
        );
        for (const row of providerRows) {
          lines.push(`| ${row.provider || "unknown"} | ${formatCompactNumber(row.total_tokens)} | ${formatCurrency(row.cost_total)} | ${formatCompactNumber(row.runs)} |`);
        }
      }

      if (modelRows.length > 0) {
        lines.push(
          "",
          "**Per model**",
          "",
          "| Model | Tokens | Cost | Runs |",
          "|---|---|---|---|",
        );
        for (const row of modelRows) {
          lines.push(`| ${row.model || "unknown"} | ${formatCompactNumber(row.total_tokens)} | ${formatCurrency(row.cost_total)} | ${formatCompactNumber(row.runs)} |`);
        }
      }
    }
  } catch (err) {
    debugSuppressedError(log, "Token-usage statistics were unavailable while building /stats output.", err, {
      operation: "agent_control.info.stats.token_usage",
      chatJid,
    });
  }

  return { status: "success", message: lines.join("\n") };
}

/** Handle /context: display context window usage breakdown. */
export async function handleContext(session: AgentSession, _command: ContextCommand): Promise<AgentControlResult> {
  const usage = session.getContextUsage();
  if (!usage) {
    return { status: "error", message: "Context usage unavailable (no model configured)." };
  }
  if (usage.tokens === null) {
    return {
      status: "success",
      message: `Context window: ${formatCompactNumber(usage.contextWindow)} tokens. Usage unknown.`,
    };
  }
  const percent = usage.percent ?? (usage.tokens / usage.contextWindow) * 100;
  const bar = percent > 90 ? "🟥" : percent > 75 ? "🟧" : "🟩";
  return {
    status: "success",
    message: [
      "**Context usage**",
      "",
      "| Metric | Value |",
      "|---|---|",
      `| **Used** | ${formatCompactNumber(usage.tokens)} / ${formatCompactNumber(usage.contextWindow)} tokens |`,
      `| **Fill** | ${bar} ${percent.toFixed(1)}% |`,
    ].join("\n"),
  };
}

/** Handle /last: display the last assistant response. */
export async function handleLast(session: AgentSession, _command: LastCommand): Promise<AgentControlResult> {
  const last = session.getLastAssistantText();
  if (!last) {
    return { status: "error", message: "No assistant messages yet." };
  }
  return { status: "success", message: `Last assistant response:\n\n${last}` };
}

/** Handle /search-workspace: full-text search across workspace files. */
export async function handleSearchWorkspace(_session: AgentSession, command: SearchCommand): Promise<AgentControlResult> {
  const query = command.query?.trim();
  if (!query) {
    return {
      status: "error",
      message: "Usage: /search <query> [--scope notes|skills|all] [--limit N] [--offset N] [--no-refresh] [--max-kb N]",
    };
  }

  const { rows, limit, offset, error } = await searchWorkspace({
    query,
    scope: command.scope,
    limit: command.limit,
    offset: command.offset,
    refresh: command.refresh ?? true,
    max_kb: command.max_kb,
  });

  if (error) {
    return { status: "error", message: error };
  }

  if (!rows.length) {
    return { status: "success", message: "No matching workspace files found." };
  }

  const header = `Workspace matches (${rows.length} result${rows.length === 1 ? "" : "s"}; limit ${limit}, offset ${offset}):`;
  const lines = rows.map((row) => `• ${row.path} — ${row.snippet}`);
  return { status: "success", message: `${header}\n${lines.join("\n")}` };
}

/** Handle /commands: list all available control commands. */
export async function handleCommands(session: AgentSession, _command: CommandsCommand): Promise<AgentControlResult> {
  type CommandSource = "core" | "extension" | "pi-extension" | "template" | "skill";
  type ExtensionMeta = { source: CommandSource; detail?: string };
  interface CommandEntry {
    name: string;
    description?: string;
    source: CommandSource;
    detail?: string;
    scope?: string;
    extensions: ExtensionMeta[];
  }

  const describeSource = (source: CommandSource, detail?: string, scope?: string): string => {
    const base =
      source === "core" ? "core"
        : source === "extension" ? "workspace extension"
          : source === "pi-extension" ? "pi extension"
            : source === "template" ? "prompt template"
              : "skill";
    const parts = [base];
    if (scope && scope !== "project") parts.push(scope);
    if (detail) parts.push(detail);
    return parts.length > 1 ? `${parts[0]} (${parts.slice(1).join(", ")})` : parts[0];
  };

  const entries = new Map<string, CommandEntry>();
  const addEntry = (name: string, description: string | undefined, source: CommandSource, detail?: string, scope?: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    const existing = entries.get(key);
    if (!existing) {
      entries.set(key, { name: trimmed, description, source, detail, scope, extensions: [] });
      return;
    }

    if (!existing.description && description) {
      existing.description = description;
    }

    if (existing.source === "core") {
      existing.extensions.push({ source, detail });
      return;
    }

    if (source === "core") {
      const previous: ExtensionMeta = { source: existing.source, detail: existing.detail };
      entries.set(key, {
        name: trimmed,
        description: description ?? existing.description,
        source: "core",
        detail: undefined,
        extensions: [...existing.extensions, previous],
      });
      return;
    }

    existing.extensions.push({ source, detail });
  };

  for (const command of CONTROL_COMMAND_DEFINITIONS) {
    addEntry(command.name, command.description, "core");
  }

  const extensionRunner = session.extensionRunner;
  if (extensionRunner) {
    const extCommands = extensionRunner.getRegisteredCommands();
    const isPiBuiltin = (path: string | undefined) => {
      if (!path) return false;
      return path.includes("node_modules/@mariozechner/pi-");
    };
    for (const entry of extCommands) {
      const name = entry.invocationName || entry.name;
      if (!name) continue;
      const si = entry.sourceInfo;
      const entryPath = si?.path;
      const entryScope = si?.scope;
      const description = entry.description || `extension (${entryPath || "unknown"})`;
      const source: CommandSource = isPiBuiltin(entryPath) ? "pi-extension" : "extension";
      const detail = si ? `${si.source}${si.origin === "package" ? " pkg" : ""}` : (entryPath || undefined);
      addEntry(`/${name}`, description, source, detail, entryScope);
    }
  }

  for (const template of session.promptTemplates) {
    const description = template.description || "prompt template";
    const si = template.sourceInfo;
    const detail = si ? si.source : template.name;
    addEntry(`/${template.name}`, description, "template", detail, si?.scope);
  }

  const skills = session.resourceLoader.getSkills().skills;
  for (const skill of skills) {
    const description = skill.description || "skill";
    const si = skill.sourceInfo;
    const detail = si ? si.source : skill.name;
    addEntry(`/skill:${skill.name}`, description, "skill", detail, si?.scope);
  }

  const sorted = Array.from(entries.values()).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const rows: string[] = [];
  for (const entry of sorted) {
    const desc = entry.description || "";
    const notes: string[] = [];
    if (entry.source !== "core") {
      notes.push(describeSource(entry.source, entry.detail, entry.scope));
    }
    if (entry.extensions.length) {
      const extNotes = entry.extensions.map((ext) => describeSource(ext.source, ext.detail));
      notes.push(`extended by ${extNotes.join(", ")}`);
    }
    const noteText = notes.length ? ` _[${notes.join("; ")}]_` : "";
    rows.push(`| \`${entry.name}\` | ${desc}${noteText} |`);
  }

  return {
    status: "success",
    message: [
      "**Available commands**",
      "",
      "| Command | Description |",
      "|---|---|",
      ...rows,
    ].join("\n"),
  };
}
