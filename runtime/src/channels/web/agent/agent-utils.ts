/**
 * web/agent-utils.ts – Utility functions for agent event processing.
 *
 * Provides helpers for building previews of agent drafts/thoughts, tracking
 * tool call titles, and constructing agent profile metadata objects.
 *
 * Consumers: native-turn-view.ts and handlers/agent.ts.
 */

import { buildPreviewLines, countSoftLines, splitLines } from "../../../utils/preview.js";
import { summariseAddonToolCall } from "./addon-tool-titles.js";

/** Function type that decorates payloads with chat + profile metadata fields. */
export type AgentProfileBuilder = <T extends object>(payload: T) => T & {
  chat_jid: string;
  agent_name: string;
  agent_avatar: string | null;
  user_name: string | null;
  user_avatar: string | null;
  user_avatar_background: string | null;
};

/** Create a profile builder from the current chat, agent name, and avatar config. */
export function createAgentProfileBuilder(
  chatJid: string,
  agentName: string,
  agentAvatar?: string | null,
  userName?: string | null,
  userAvatar?: string | null,
  userAvatarBackground?: string | null
): AgentProfileBuilder {
  return (payload) => ({
    ...payload,
    chat_jid: chatJid,
    agent_name: agentName,
    agent_avatar: agentAvatar ?? null,
    user_name: userName ?? null,
    user_avatar: userAvatar ?? null,
    user_avatar_background: userAvatarBackground ?? null,
  });
}

/** Build a truncated preview of text for SSE draft/thought events. */
export function buildPreview(
  text: string,
  maxLines: number,
  maxCharsPerLine: number
): { preview: string; totalLines: number } {
  const lines = splitLines(text || "");
  if (!lines.length) return { preview: "", totalLines: 0 };
  const totalLines = countSoftLines(lines, maxCharsPerLine);
  const { preview } = buildPreviewLines(lines, { maxLines });
  return { preview, totalLines };
}

function extractToolArgs(args: unknown): Record<string, unknown> | null {
  if (!args) return null;
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args);
      if (parsed && typeof parsed === "object") return extractToolArgs(parsed);
    } catch {
      return null;
    }
  }
  if (typeof args === "object" && !Array.isArray(args)) {
    const record = args as Record<string, unknown>;
    if (["action", "workflow", "command", "cmd"].some(key => typeof record[key] === "string")) return record;
    for (const key of ["arguments", "input", "params", "parameters", "args", "payload"]) {
      const nested = record[key];
      if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested as Record<string, unknown>;
    }
    return record;
  }
  return null;
}

export interface McpToolStatusIdentity {
  operation: "call" | "connect" | "describe" | "instructions" | "search" | "action" | "status";
  server: string | null;
  tool: string | null;
  target: string | null;
  label: string;
}

function extractMcpGatewayArgs(args: unknown): Record<string, unknown> | null {
  if (!args) return null;
  if (typeof args === "string") {
    try {
      return extractMcpGatewayArgs(JSON.parse(args));
    } catch {
      return null;
    }
  }
  if (typeof args !== "object" || Array.isArray(args)) return null;
  const record = args as Record<string, unknown>;
  const operationKeys = ["tool", "server", "connect", "describe", "instructions", "search", "action"];
  if (operationKeys.some((key) => typeof record[key] === "string" && String(record[key]).trim())) return record;
  for (const key of ["arguments", "input", "params", "parameters", "payload", "args"]) {
    const nested = record[key];
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) continue;
    const nestedRecord = nested as Record<string, unknown>;
    if (operationKeys.some((operationKey) => typeof nestedRecord[operationKey] === "string" && String(nestedRecord[operationKey]).trim())) {
      return nestedRecord;
    }
  }
  return record;
}

function readNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized) return normalized;
  }
  return null;
}

/** Resolve the gateway operation and target for MCP status presentation. */
export function resolveMcpToolStatusIdentity(toolName: string, args: unknown): McpToolStatusIdentity | null {
  if (toolName.trim().toLowerCase() !== "mcp") return null;
  const record = extractMcpGatewayArgs(args) ?? {};
  const server = readNonEmptyString(record.server);
  const tool = readNonEmptyString(record.tool);
  const connect = readNonEmptyString(record.connect);
  const describe = readNonEmptyString(record.describe);
  const instructions = readNonEmptyString(record.instructions);
  const search = readNonEmptyString(record.search);
  const action = readNonEmptyString(record.action);

  if (tool) {
    const label = server ? `mcp: ${server} → ${tool}` : `mcp: ${tool}`;
    return { operation: "call", server, tool, target: tool, label };
  }
  if (connect) return { operation: "connect", server: connect, tool: null, target: connect, label: `mcp: ${connect} → connect` };
  if (describe) {
    const label = server ? `mcp: ${server} → describe ${describe}` : `mcp: describe → ${describe}`;
    return { operation: "describe", server, tool: null, target: describe, label };
  }
  if (instructions) return { operation: "instructions", server: instructions, tool: null, target: instructions, label: `mcp: ${instructions} → instructions` };
  if (search) {
    const label = server ? `mcp: ${server} → search ${search}` : `mcp: search → ${search}`;
    return { operation: "search", server, tool: null, target: search, label };
  }
  if (action) {
    const target = server || action;
    return { operation: "action", server, tool: null, target, label: server ? `mcp: ${server} → ${action}` : `mcp: ${action}` };
  }
  return { operation: "status", server, tool: null, target: server, label: server ? `mcp: ${server} → status` : "mcp: status" };
}

/**
 * First sentence of a prompt's first non-empty line, without Markdown
 * heading/list/quote markers. A sentence ends at . ! or ? before a capital.
 */
function firstPromptLine(prompt: string): string | null {
  for (const line of prompt.split("\n")) {
    const text = line.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|>\s*|\d+[.)]\s+)/, "").trim();
    if (text) return text.match(/^.+?[.!?](?=\s+[A-Z])/)?.[0] ?? text;
  }
  return null;
}

const quoted = (text: string) => `‘${text.replace(/\s+/g, " ").trim()}’`;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** One line for a plan tool call: what it read or changed. */
function summarisePlanCall(record: Record<string, unknown>): string | null {
  const action = typeof record.action === "string" ? record.action : "";
  if (action === "read") return "read the checklist";
  if (action === "update" && Array.isArray(record.plan)) {
    const steps = record.plan.filter((item): item is { step?: unknown; status?: unknown } => Boolean(item) && typeof item === "object");
    const done = steps.filter((item) => item.status === "completed").length;
    const current = steps.find((item) => item.status === "in_progress" && typeof item.step === "string");
    return `${done}/${steps.length} done${current ? `, now ${quoted(String(current.step))}` : ""}`;
  }
  if (action === "patch" && Array.isArray(record.patches)) {
    const parts = record.patches.flatMap((patch) => {
      if (!patch || typeof patch !== "object") return [];
      const item = patch as { operation?: unknown; index?: unknown; match?: unknown; step?: unknown; status?: unknown };
      const target = typeof item.match === "string" && item.match.trim() ? quoted(item.match)
        : typeof item.index === "number" ? `step ${item.index}`
          : typeof item.step === "string" && item.step.trim() ? quoted(item.step) : "a step";
      if (item.operation === "add") return [`added ${typeof item.step === "string" && item.step.trim() ? quoted(item.step) : "a step"}`];
      if (item.operation === "remove") return [`removed ${target}`];
      if (item.operation !== "update") return [];
      if (item.status === "completed") return [`completed ${target}`];
      if (item.status === "in_progress") return [`started ${target}`];
      if (item.status === "pending") return [`reopened ${target}`];
      return typeof item.step === "string" ? [`reworded ${target}`] : [];
    });
    return parts.length ? parts.join(", ") : null;
  }
  if (action === "write" && typeof record.markdown === "string") {
    return `wrote ${plural(record.markdown.split("\n").filter((line) => /^\s*[-*]\s+\[[ xX-]\]/.test(line)).length, "step")}`;
  }
  if (action === "edit" && Array.isArray(record.edits)) return `edited the checklist (${plural(record.edits.length, "change")})`;
  return null;
}

/** Short "tool: detail" label shared by live status and the turn activity log. */
export function formatToolTitle(toolName: string, args: unknown): string {
  const mcpIdentity = resolveMcpToolStatusIdentity(toolName, args);
  if (mcpIdentity) return mcpIdentity.label;
  const record = extractToolArgs(args) ?? {};
  let detail: string | null = summariseAddonToolCall(toolName, record);

  // Delegate's brief is a long prompt; its first line names the task.
  if (toolName === "delegate" && typeof record.prompt === "string") detail = firstPromptLine(record.prompt);
  if (toolName === "plan") detail = summarisePlanCall(record);

  const command = record.command ?? (toolName === "exec_command" ? record.cmd : undefined);
  if (!detail && typeof command === "string") detail = command;

  if (!detail && Array.isArray(record.commands)) {
    detail = record.commands.filter((item) => typeof item === "string").join(" && ");
  }

  const path = record.path || record.filePath || record.target;
  if (!detail && typeof path === "string") detail = path;

  if (!detail && Array.isArray(record.paths)) {
    detail = record.paths.filter((item) => typeof item === "string").join(", ");
  }

  const filename = record.fileName || record.filename || record.file;
  if (!detail && typeof filename === "string") detail = filename;

  const url = record.url;
  if (!detail && typeof url === "string") detail = url;

  const query = record.query;
  if (!detail && typeof query === "string") detail = query;

  if (!detail) return toolName;

  const normalized = detail.replace(/\s+/g, " ").trim();
  const maxLen = 120;
  const clipped = normalized.length > maxLen ? `${normalized.slice(0, maxLen)}…` : normalized;
  return `${toolName}: ${clipped}`;
}

/** Track and return the title of the last tool call for status display. */
export function createToolTitleTracker() {
  const toolTitles = new Map<string, string>();

  const remember = (toolCallId: string, toolName: string, args: unknown): string => {
    const title = formatToolTitle(toolName, args);
    toolTitles.set(toolCallId, title);
    return title;
  };

  const lookup = (toolCallId: string, toolName: string, args?: unknown): string => {
    return toolTitles.get(toolCallId) ?? formatToolTitle(toolName, args);
  };

  const forget = (toolCallId: string): void => {
    toolTitles.delete(toolCallId);
  };

  return { remember, lookup, forget };
}
