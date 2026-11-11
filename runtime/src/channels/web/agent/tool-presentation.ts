/**
 * web/agent/tool-presentation.ts – readable views of tool inputs and outputs.
 *
 * Kintsugi-style: a tool's arguments show both as the model wrote them
 * (Original) and, when formatting helps, as a Readable view (formatted shell,
 * a script, an edit diff, file content). A tool's output shows as the model saw
 * it, and, when the tool emitted more or something different, as emitted (the
 * full stored output or a diff). Pure apart from the bounded output readers.
 *
 * Consumers: handlers/turn-activity.ts.
 */

import { closeSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute } from "node:path";
import { getDb } from "../../../db/connection.js";

export interface ReadableInput {
  kind: "shell" | "code" | "diff" | "json";
  label: string;
  language?: string;
  text: string;
  /** The readable view is the whole story (an unformatted command): no Original toggle. */
  only?: true;
}

export interface EmittedOutput {
  kind: "text" | "diff";
  label: string;
  text: string;
  offset: number;
  /** Byte offset of the next page; pages end on UTF-8 character boundaries. */
  next_offset: number;
  total: number;
  truncated: boolean;
  source: "details" | "tool-output" | "log";
}

export const EMITTED_PAGE_BYTES = 256 * 1024;

const SHELL_TOOLS = new Set(["bash", "exec_command", "shell"]);

/** Exact arguments as the model emitted them (compact JSON). */
export function originalToolInput(args: unknown): string {
  if (typeof args === "string") return args;
  try { return JSON.stringify(args ?? {}); } catch { return String(args); }
}

/**
 * Split a one-line shell command at top-level `&&`, `||`, `|` and `;`, outside
 * quotes, `$(…)`, backticks and brackets. Commands that already span lines or
 * use heredocs are left alone. Null when nothing would change.
 */
export function formatShellCommand(command: string): string | null {
  if (!command || command.includes("\n") || command.includes("<<")) return null;
  const parts: Array<{ op: string; text: string }> = [];
  let current = "", depth = 0, quote: string | null = null, op = "";
  const push = (nextOp: string) => { parts.push({ op, text: current.trim() }); current = ""; op = nextOp; };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!, next = command[i + 1];
    if (quote) {
      current += ch;
      if (ch === "\\" && quote !== "'" && next !== undefined) { current += next; i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "\\" && next !== undefined) { current += ch + next; i++; continue; }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; current += ch; continue; }
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    if (ch === ")" || ch === "}" || ch === "]") depth = Math.max(0, depth - 1);
    if (depth === 0) {
      if ((ch === "&" && next === "&") || (ch === "|" && next === "|")) { push(ch + next); i++; continue; }
      if (ch === "|" && next !== "&") { push("|"); continue; }
      if (ch === ";") { push(";"); continue; }
    }
    current += ch;
  }
  if (quote) return null;
  push("");
  const segments = parts.filter((part) => part.text);
  if (segments.length < 2) return null;
  const lines = [segments[0]!.text];
  for (const part of segments.slice(1)) {
    if (part.op === ";") { lines.push(part.text); continue; }
    // A continued chain stays valid shell with a trailing backslash.
    lines[lines.length - 1] += " \\";
    lines.push(`  ${part.op} ${part.text}`);
  }
  return lines.join("\n");
}

const EXTENSION_LANGUAGES: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  py: "python", sh: "shell", bash: "shell", md: "markdown", json: "json", css: "css", html: "html", yaml: "yaml", yml: "yaml",
  rs: "rust", go: "go", sql: "sql", toml: "toml",
};

/** Highlighting language for a file path, by extension. */
export function languageForPath(path: unknown): string | undefined {
  const extension = typeof path === "string" ? /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase() : undefined;
  return extension ? EXTENSION_LANGUAGES[extension] : undefined;
}

function editDiff(edits: Array<{ oldText?: unknown; newText?: unknown }>): string | null {
  const blocks = edits.flatMap((edit, index) => {
    if (typeof edit?.oldText !== "string" || typeof edit?.newText !== "string") return [];
    const minus = edit.oldText.split("\n").map((line) => `-${line}`);
    const plus = edit.newText.split("\n").map((line) => `+${line}`);
    return [[`@@ edit ${index + 1} @@`, ...minus, ...plus].join("\n")];
  });
  return blocks.length ? blocks.join("\n") : null;
}

/** A readable view of a tool's arguments, or null when the original is already readable. */
export function readableToolInput(name: string, args: unknown): ReadableInput | null {
  const record = args && typeof args === "object" ? args as Record<string, unknown> : null;
  if (!record) return null;
  const command = record.command ?? (name === "exec_command" ? record.cmd : undefined);
  if (SHELL_TOOLS.has(name) && typeof command === "string") {
    const formatted = formatShellCommand(command);
    return formatted ? { kind: "shell", label: "Command", language: "shell", text: formatted } : { kind: "shell", label: "Command", language: "shell", text: command, only: true };
  }
  if (name === "codemode" && typeof record.code === "string") return { kind: "code", label: "Script", language: "javascript", text: record.code };
  if (name === "edit") {
    const edits = Array.isArray(record.edits) ? record.edits : [record];
    const diff = editDiff(edits as Array<{ oldText?: unknown; newText?: unknown }>);
    if (diff) return { kind: "diff", label: typeof record.path === "string" ? `Changes to ${record.path}` : "Changes", text: diff };
  }
  if (name === "write" && typeof record.content === "string") {
    return { kind: "code", label: typeof record.path === "string" ? `Content of ${record.path}` : "Content", language: languageForPath(record.path), text: record.content };
  }
  const pretty = JSON.stringify(record, null, 2);
  return pretty !== JSON.stringify(record) ? { kind: "json", label: "Arguments", text: pretty } : null;
}

const isContinuation = (byte: number | undefined) => byte !== undefined && (byte & 0xc0) === 0x80;

/**
 * Decode one page from up to one byte more than a page, so it can end before a
 * character the page boundary would cut. The next page starts at `next`.
 */
function utf8Page(bytes: Buffer, start: number, total: number): { text: string; offset: number; next: number } {
  let end = Math.min(bytes.length, EMITTED_PAGE_BYTES);
  if (start + end < total) {
    let back = end;
    while (back > 0 && isContinuation(bytes[back])) back--;
    if (back > 0) end = back;
  }
  return { text: bytes.subarray(0, end).toString("utf8"), offset: start, next: start + end };
}

function readBytes(path: string, offset: number): { text: string; total: number; offset: number; next: number } | null {
  let fd: number | undefined;
  try {
    const total = statSync(path).size;
    const start = Math.max(0, Math.min(offset, total));
    const length = Math.min(EMITTED_PAGE_BYTES + 1, total - start);
    const buffer = Buffer.alloc(length);
    fd = openSync(path, "r");
    const read = readSync(fd, buffer, 0, length, start);
    return { ...utf8Page(buffer.subarray(0, read), start, total), total };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Only bash's own temporary full-output logs, directly in the process temp directory. */
export function isBashOutputLog(path: unknown): path is string {
  if (typeof path !== "string" || !isAbsolute(path) || !/^pi-bash-[0-9a-f]+\.log$/.test(basename(path))) return false;
  try { return dirname(realpathSync(path)) === realpathSync(tmpdir()); } catch { return false; }
}

/**
 * What the tool emitted when the model saw something else: an edit/write diff,
 * the full output of a bash call stored as a tool output for this chat, or
 * bash's own full-output log. Paged by bytes.
 */
export function emittedToolOutput(chatJid: string, details: unknown, modelText: string, offset = 0): EmittedOutput | null {
  const record = details && typeof details === "object" ? details as Record<string, unknown> : {};
  if (typeof record.diff === "string" && record.diff) {
    const bytes = Buffer.from(record.diff, "utf8");
    const start = Math.max(0, Math.min(offset, bytes.length));
    const page = utf8Page(bytes.subarray(start, start + EMITTED_PAGE_BYTES + 1), start, bytes.length);
    return { kind: "diff", label: "Diff", text: page.text, offset: start, next_offset: page.next, total: bytes.length, truncated: page.next < bytes.length, source: "details" };
  }
  const handle = /tool-output:([A-Za-z0-9_-]{1,128})/.exec(modelText)?.[1];
  if (handle) {
    const row = getDb().prepare("SELECT path FROM tool_outputs WHERE id = ? AND (chat_jid = ? OR chat_jid IS NULL)").get(handle, chatJid) as { path: string } | null;
    const page = row?.path ? readBytes(row.path, offset) : null;
    if (page) return { kind: "text", label: "Output", text: page.text, offset: page.offset, next_offset: page.next, total: page.total, truncated: page.next < page.total, source: "tool-output" };
  }
  if (isBashOutputLog(record.fullOutputPath)) {
    const page = readBytes(record.fullOutputPath, offset);
    if (page && page.text !== modelText) return { kind: "text", label: "Output", text: page.text, offset: page.offset, next_offset: page.next, total: page.total, truncated: page.next < page.total, source: "log" };
  }
  return null;
}
