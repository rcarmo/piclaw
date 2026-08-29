/**
 * web/agent-utils.ts – Utility functions for agent event processing.
 *
 * Provides helpers for building previews of agent drafts/thoughts, tracking
 * tool call titles, and constructing agent profile metadata objects.
 *
 * Consumers: web/agent-events.ts, web/agent-message-store.ts.
 */

import { buildPreviewLines, countSoftLines, splitLines } from "../../../utils/preview.js";

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
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (typeof args === "object") {
    const record = args as Record<string, unknown>;
    const nested =
      (record.arguments as Record<string, unknown> | undefined) ||
      (record.input as Record<string, unknown> | undefined) ||
      (record.params as Record<string, unknown> | undefined) ||
      (record.parameters as Record<string, unknown> | undefined) ||
      (record.args as Record<string, unknown> | undefined) ||
      (record.payload as Record<string, unknown> | undefined);
    return nested ?? record;
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

function formatToolTitle(toolName: string, args: unknown): string {
  const mcpIdentity = resolveMcpToolStatusIdentity(toolName, args);
  if (mcpIdentity) return mcpIdentity.label;
  const record = extractToolArgs(args);
  if (!record) return toolName;
  let detail: string | null = null;

  const command = record.command;
  if (typeof command === "string") detail = command;

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
