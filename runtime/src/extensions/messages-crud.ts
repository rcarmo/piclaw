/**
 * messages-crud – unified message CRUD tool for internal agent operations.
 */
import { Type, type Static } from "@sinclair/typebox";
import type { AgentToolResult, ExtensionAPI, ExtensionFactory } from "@mariozechner/pi-coding-agent";

import {
  attachMediaToMessage,
  deleteThreadByRowId,
  getDb,
  getMediaIdsForMessage,
  storeMessage,
} from "../db.js";
import { getChatJid } from "../core/chat-context.js";
import { stripInternalTags } from "../router.js";
import { createUuid } from "../utils/ids.js";
import { prepareFtsQuery } from "../utils/fts-query.js";

const MessagesSchema = Type.Object({
  action: Type.Optional(
    Type.Union([
      Type.Literal("search"),
      Type.Literal("get"),
      Type.Literal("grep"),
      Type.Literal("extract"),
      Type.Literal("diff"),
      Type.Literal("add"),
      Type.Literal("post"),
      Type.Literal("delete"),
    ]),
  ),
  query: Type.Optional(Type.String({ description: "Full-text query string (search action), or fallback pattern for grep/extract." })),
  pattern: Type.Optional(Type.String({ description: "Substring or regex pattern for grep/extract actions." })),
  row_ids: Type.Optional(
    Type.Array(Type.Integer({ minimum: 1 }), {
      description: "Target row IDs (get/delete actions).",
      maxItems: 50,
    }),
  ),
  chat_jid: Type.Optional(Type.String({ description: "Chat JID. Use '*' or 'all' for all chats." })),
  role: Type.Optional(
    Type.Union([Type.Literal("user"), Type.Literal("assistant")], {
      description: "Optional role filter for read/search actions.",
    }),
  ),
  sender: Type.Optional(Type.String({ description: "Optional sender/sender_name filter for read/search actions." })),
  after: Type.Optional(Type.String({ description: "Filter messages with timestamp greater than this ISO value." })),
  before: Type.Optional(Type.String({ description: "Filter messages with timestamp less than this ISO value." })),
  since: Type.Optional(Type.String({ description: "Alias for `after`." })),
  after_row: Type.Optional(Type.Integer({ description: "Filter messages with rowid greater than this value.", minimum: 1 })),
  before_row: Type.Optional(Type.Integer({ description: "Filter messages with rowid less than this value.", minimum: 1 })),
  limit: Type.Optional(Type.Integer({ description: "Max search results (1-50).", minimum: 1, maximum: 50 })),
  excerpt_chars: Type.Optional(Type.Integer({ description: "Return bounded highlighted excerpts around search matches (0 disables).", minimum: 0, maximum: 1000 })),
  offset: Type.Optional(Type.Integer({ description: "Offset for search pagination.", minimum: 0 })),
  context_before: Type.Optional(Type.Integer({ description: "Context rows before each row (get action).", minimum: 0, maximum: 20 })),
  context_after: Type.Optional(Type.Integer({ description: "Context rows after each row (get action).", minimum: 0, maximum: 20 })),
  details_max_chars: Type.Optional(
    Type.Integer({
      description: "Limit content size in details payloads (0 omits content).",
      minimum: 0,
      maximum: 20_000,
    }),
  ),
  content_lines: Type.Optional(Type.String({ description: "Line selection for get action, e.g. '10-20' or '15'." })),
  content_grep: Type.Optional(Type.String({ description: "Filter get action content lines by substring match." })),
  regex: Type.Optional(Type.Boolean({ description: "Interpret pattern as a regular expression for grep/extract actions." })),
  context_lines: Type.Optional(Type.Integer({ description: "Context lines before/after grep matches.", minimum: 0, maximum: 5 })),
  max_matches: Type.Optional(Type.Integer({ description: "Max grep/extract matches or values to return (1-200).", minimum: 1, maximum: 200 })),
  capture_group: Type.Optional(Type.Integer({ description: "Regex capture group index to extract (extract action).", minimum: 0, maximum: 10 })),
  dedupe: Type.Optional(Type.Boolean({ description: "Collapse repeated extracted values (extract action, default true)." })),
  sort: Type.Optional(Type.Union([
    Type.Literal("none"),
    Type.Literal("asc"),
    Type.Literal("desc"),
  ], { description: "Optional extract result ordering." })),
  content: Type.Optional(Type.String({ description: "Message content to insert (add action)." })),
  type: Type.Optional(
    Type.Union([Type.Literal("user"), Type.Literal("agent")], {
      description: "Message type for add action.",
    }),
  ),
  media_ids: Type.Optional(
    Type.Array(Type.Integer({ minimum: 1 }), {
      description: "Media IDs to attach to a newly added message.",
    }),
  ),
  content_blocks: Type.Optional(
    Type.Array(Type.Unknown(), {
      description: "Structured content blocks (e.g. adaptive_card) for post action.",
    }),
  ),
  dry_run: Type.Optional(Type.Boolean({ description: "For delete action, report planned changes without applying." })),
  force: Type.Optional(Type.Boolean({ description: "For delete action, ignore attachment-safety checks." })),
});

export type MessagesParams = Static<typeof MessagesSchema>;

type MessageRow = {
  rowid: number;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_bot_message: number;
  content_blocks: string | null;
};

type MessageResultRow = Omit<MessageRow, "content_blocks"> & {
  created_at: string;
  content_truncated?: boolean;
  content_full_length?: number;
  content_blocks?: unknown[];
  content_excerpt?: string;
  content_excerpt_truncated?: boolean;
};

type MessageLineMatch = {
  line_number: number;
  content: string;
};

type MessageLineView = {
  total_lines: number;
  selected_start: number;
  selected_end: number;
  grep: string | null;
  match_count: number;
  lines: MessageLineMatch[];
};

type GetResultItem = {
  message: MessageResultRow;
  context_before: MessageResultRow[];
  context_after: MessageResultRow[];
  line_view?: MessageLineView;
};

type GrepLineView = {
  total_lines: number;
  context_lines: number;
  match_count: number;
  lines: Array<{
    line_number: number;
    content: string;
    matched: boolean;
  }>;
};

type GrepResultItem = {
  message: MessageResultRow;
  line_view: GrepLineView;
};

type ExtractResultItem = {
  value: string;
  count: number;
  first_seen_rowid: number;
  first_seen_at: string;
  first_seen_chat_jid: string;
  first_seen_sender: string;
  first_seen_sender_name: string;
};

type DiffSummary = {
  checkpoint_after_row: number | null;
  checkpoint_before_row: number | null;
  checkpoint_after: string | null;
  checkpoint_before: string | null;
  first_rowid: number | null;
  last_rowid: number | null;
  user_count: number;
  assistant_count: number;
  sender_counts: Array<{ sender: string; count: number }>;
};

function normalizeChatJid(input: string | undefined, defaultChat: string): string | null {
  if (!input) return defaultChat;
  const trimmed = input.trim();
  if (!trimmed || trimmed === "*" || trimmed.toLowerCase() === "all") return null;
  return trimmed;
}

function normalizeRole(input: string | undefined): number | null {
  if (!input) return null;
  const norm = input.trim().toLowerCase();
  if (norm === "assistant") return 1;
  if (norm === "user") return 0;
  return null;
}

function normalizeSender(input: string | undefined): string | null {
  const trimmed = input?.trim();
  return trimmed ? trimmed : null;
}

function appendSenderFilter(
  conditions: string[],
  params: (string | number)[],
  senderFilter: string | null,
  qualifier = "",
): void {
  if (!senderFilter) return;
  const prefix = qualifier ? `${qualifier}.` : "";
  conditions.push(`(${prefix}sender = ? COLLATE NOCASE OR ${prefix}sender_name = ? COLLATE NOCASE)`);
  params.push(senderFilter, senderFilter);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSearchTerms(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed || trimmed === "*") return [];
  if (trimmed.startsWith("#")) {
    const tag = trimmed.replace(/^#+/, "").trim();
    return tag ? [tag] : [];
  }
  return Array.from(new Set(
    trimmed
      .split(/\s+/)
      .map((term) => term.replace(/^[^\p{L}\p{N}_-]+|[^\p{L}\p{N}_-]+$/gu, ""))
      .filter(Boolean),
  ));
}

function buildContentExcerpt(content: string, terms: string[], excerptChars: number): { text: string; truncated: boolean } | null {
  if (!terms.length || excerptChars <= 0) return null;
  const lower = content.toLowerCase();
  const normalizedTerms = Array.from(new Set(terms.map((term) => term.toLowerCase()).filter(Boolean)));
  let matchIndex = -1;
  let matchLength = 0;
  for (const term of normalizedTerms) {
    const index = lower.indexOf(term);
    if (index !== -1 && (matchIndex === -1 || index < matchIndex)) {
      matchIndex = index;
      matchLength = term.length;
    }
  }
  if (matchIndex === -1) return null;

  const safeWidth = Math.max(8, excerptChars);
  let start = Math.max(0, matchIndex - Math.floor((safeWidth - matchLength) / 2));
  let end = Math.min(content.length, start + safeWidth);
  if ((end - start) < safeWidth) {
    start = Math.max(0, end - safeWidth);
  }

  const rawSnippet = content.slice(start, end);
  const highlightPattern = new RegExp(normalizedTerms.map(escapeRegex).sort((a, b) => b.length - a.length).join("|"), "gi");
  const highlighted = rawSnippet.replace(highlightPattern, (match) => `[[${match}]]`);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < content.length ? "…" : "";
  return {
    text: `${prefix}${highlighted}${suffix}`,
    truncated: start > 0 || end < content.length,
  };
}

function parseContentLines(input: string | undefined): { start: number; end: number } | null {
  const trimmed = input?.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
  if (!match) return null;
  const start = Number.parseInt(match[1]!, 10);
  const end = Number.parseInt(match[2] ?? match[1]!, 10);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0 || start > end) {
    return null;
  }
  return { start, end };
}

function getPatternInput(params: MessagesParams): string {
  return params.pattern?.trim() || params.query?.trim() || "";
}

function compileRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "g");
  } catch {
    return null;
  }
}

function lineMatchesPattern(line: string, pattern: string, regex: boolean): boolean {
  if (!pattern) return false;
  if (!regex) return line.toLowerCase().includes(pattern.toLowerCase());
  const expression = compileRegex(pattern);
  if (!expression) return false;
  expression.lastIndex = 0;
  return expression.test(line);
}

function collectPatternMatches(content: string, pattern: string, regex: boolean, captureGroup = 0): string[] {
  if (!pattern) return [];
  if (!regex) {
    if (captureGroup > 0) return [];
    const values: string[] = [];
    const needle = pattern.toLowerCase();
    const haystack = content.toLowerCase();
    let startIndex = 0;
    while (startIndex <= haystack.length) {
      const index = haystack.indexOf(needle, startIndex);
      if (index === -1) break;
      values.push(content.slice(index, index + pattern.length));
      startIndex = index + Math.max(pattern.length, 1);
    }
    return values;
  }

  const expression = compileRegex(pattern);
  if (!expression) return [];
  const values: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = expression.exec(content)) !== null) {
    const value = match[captureGroup] ?? match[0] ?? "";
    if (value) values.push(value);
    if (match[0] === "") expression.lastIndex += 1;
  }
  return values;
}

function clipText(value: string, limit?: number): string {
  const max = Number.isFinite(limit ?? NaN) ? Math.max(limit as number, 0) : undefined;
  if (max === undefined) return value;
  if (max <= 0) return "";
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(1, max - 1))}…`;
}

function buildLineView(
  content: string,
  range: { start: number; end: number } | null,
  grep: string | undefined,
  detailsMaxChars?: number,
): MessageLineView {
  const rawLines = content.split(/\r?\n/);
  const totalLines = rawLines.length;
  const selectedStart = Math.min(Math.max(range?.start ?? 1, 1), Math.max(totalLines, 1));
  const selectedEnd = Math.min(Math.max(range?.end ?? totalLines, selectedStart), Math.max(totalLines, 1));
  const grepNeedle = grep?.trim().toLowerCase() || null;
  const lines: MessageLineMatch[] = [];

  for (let lineNumber = selectedStart; lineNumber <= selectedEnd; lineNumber += 1) {
    const line = rawLines[lineNumber - 1] ?? "";
    if (grepNeedle && !line.toLowerCase().includes(grepNeedle)) continue;
    lines.push({ line_number: lineNumber, content: clipText(line, detailsMaxChars) });
  }

  return {
    total_lines: totalLines,
    selected_start: selectedStart,
    selected_end: selectedEnd,
    grep: grep?.trim() || null,
    match_count: lines.length,
    lines,
  };
}

function parseMessageContentBlocks(raw: string | null | undefined): unknown[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function clipContent(row: MessageRow, limit?: number): MessageResultRow {
  const max = Number.isFinite(limit ?? NaN) ? Math.max(limit as number, 0) : undefined;
  const base = {
    ...row,
    content_blocks: parseMessageContentBlocks(row.content_blocks),
    created_at: row.timestamp,
  };
  if (max === undefined) return base;
  if (max <= 0) {
    return {
      ...base,
      content: "",
      content_truncated: row.content.length > 0,
      content_full_length: row.content.length,
    };
  }
  if (row.content.length <= max) return base;
  return {
    ...base,
    content: `${row.content.slice(0, Math.max(1, max - 1))}…`,
    content_truncated: true,
    content_full_length: row.content.length,
  };
}

function listMessageWindow(
  chatJid: string | null,
  roleFilter: number | null,
  senderFilter: string | null,
  limit: number,
  offset: number,
  afterTs?: string,
  beforeTs?: string,
  afterRow?: number,
  beforeRow?: number,
): MessageRow[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (chatJid) {
    conditions.push("chat_jid = ?");
    params.push(chatJid);
  }
  if (roleFilter !== null) {
    conditions.push("is_bot_message = ?");
    params.push(roleFilter);
  }
  appendSenderFilter(conditions, params, senderFilter);
  if (afterTs) {
    conditions.push("timestamp > ?");
    params.push(afterTs);
  }
  if (beforeTs) {
    conditions.push("timestamp < ?");
    params.push(beforeTs);
  }
  if (typeof afterRow === "number" && Number.isInteger(afterRow) && afterRow > 0) {
    conditions.push("rowid > ?");
    params.push(afterRow);
  }
  if (typeof beforeRow === "number" && Number.isInteger(beforeRow) && beforeRow > 0) {
    conditions.push("rowid < ?");
    params.push(beforeRow);
  }

  const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const sql = `SELECT rowid, chat_jid, sender, sender_name, content, content_blocks, timestamp, is_bot_message
    FROM messages${whereClause} ORDER BY rowid DESC LIMIT ? OFFSET ?`;
  return db.prepare(sql).all(...params, limit, offset) as MessageRow[];
}

function buildGrepLineView(
  content: string,
  pattern: string,
  regex: boolean,
  contextLines: number,
  detailsMaxChars?: number,
): GrepLineView | null {
  const rawLines = content.split(/\r?\n/);
  const matchedLineNumbers = new Set<number>();
  for (let index = 0; index < rawLines.length; index += 1) {
    if (lineMatchesPattern(rawLines[index] ?? "", pattern, regex)) {
      matchedLineNumbers.add(index + 1);
    }
  }
  if (matchedLineNumbers.size === 0) return null;

  const selectedLineNumbers = new Set<number>();
  for (const lineNumber of matchedLineNumbers) {
    const start = Math.max(1, lineNumber - contextLines);
    const end = Math.min(rawLines.length, lineNumber + contextLines);
    for (let current = start; current <= end; current += 1) {
      selectedLineNumbers.add(current);
    }
  }

  const lines = Array.from(selectedLineNumbers)
    .sort((a, b) => a - b)
    .map((lineNumber) => ({
      line_number: lineNumber,
      content: clipText(rawLines[lineNumber - 1] ?? "", detailsMaxChars),
      matched: matchedLineNumbers.has(lineNumber),
    }));

  return {
    total_lines: rawLines.length,
    context_lines: contextLines,
    match_count: matchedLineNumbers.size,
    lines,
  };
}

function runSearch(
  query: string,
  chatJid: string | null,
  roleFilter: number | null,
  senderFilter: string | null,
  limit: number,
  offset: number,
  afterTs?: string,
  beforeTs?: string,
  afterRow?: number,
  beforeRow?: number,
): MessageRow[] {
  const db = getDb();
  const trimmed = query.trim();
  if (!trimmed) return [];

  const timeClauses: string[] = [];
  const timeValues: string[] = [];
  const rowClauses: string[] = [];
  const rowValues: number[] = [];
  if (afterTs) {
    timeClauses.push("timestamp > ?");
    timeValues.push(afterTs);
  }
  if (beforeTs) {
    timeClauses.push("timestamp < ?");
    timeValues.push(beforeTs);
  }
  if (typeof afterRow === "number" && Number.isInteger(afterRow) && afterRow > 0) {
    rowClauses.push("rowid > ?");
    rowValues.push(afterRow);
  }
  if (typeof beforeRow === "number" && Number.isInteger(beforeRow) && beforeRow > 0) {
    rowClauses.push("rowid < ?");
    rowValues.push(beforeRow);
  }

  if (trimmed === "*") {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    if (chatJid) {
      conditions.push("chat_jid = ?");
      params.push(chatJid);
    }
    if (roleFilter !== null) {
      conditions.push("is_bot_message = ?");
      params.push(roleFilter);
    }
    appendSenderFilter(conditions, params, senderFilter);
    for (const c of timeClauses) conditions.push(c);
    params.push(...timeValues);
    for (const c of rowClauses) conditions.push(c);
    params.push(...rowValues);

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
    const sql = `SELECT rowid, chat_jid, sender, sender_name, content, content_blocks, timestamp, is_bot_message
      FROM messages${whereClause} ORDER BY rowid DESC LIMIT ? OFFSET ?`;
    return db.prepare(sql).all(...params, limit, offset) as MessageRow[];
  }

  if (trimmed.startsWith("#")) {
    const tag = trimmed.replace(/^#+/, "");
    if (!tag) return [];
    const pattern = `%#${tag}%`;
    const conditions: string[] = ["content LIKE ? COLLATE NOCASE"];
    const params: (string | number)[] = [pattern];
    if (chatJid) {
      conditions.unshift("chat_jid = ?");
      params.unshift(chatJid);
    }
    if (roleFilter !== null) {
      conditions.push("is_bot_message = ?");
      params.push(roleFilter);
    }
    appendSenderFilter(conditions, params, senderFilter);
    for (const c of timeClauses) conditions.push(c);
    params.push(...timeValues);
    for (const c of rowClauses) conditions.push(c);
    params.push(...rowValues);
    const sql = `SELECT rowid, chat_jid, sender, sender_name, content, content_blocks, timestamp, is_bot_message
      FROM messages WHERE ${conditions.join(" AND ")} ORDER BY rowid DESC LIMIT ? OFFSET ?`;
    return db.prepare(sql).all(...params, limit, offset) as MessageRow[];
  }

  try {
    const conditions: string[] = ["messages_fts MATCH ?"];
    const params: (string | number)[] = [];
    const ftsQuery = prepareFtsQuery(trimmed) ?? trimmed;
    params.push(ftsQuery);

    if (chatJid) {
      conditions.unshift("messages.chat_jid = ?");
      params.unshift(chatJid);
    }
    if (roleFilter !== null) {
      conditions.push("messages.is_bot_message = ?");
      params.push(roleFilter);
    }
    appendSenderFilter(conditions, params, senderFilter, "messages");
    for (const c of timeClauses) conditions.push(c);
    params.push(...timeValues);
    for (const c of rowClauses) conditions.push(c.replace(/\browid\b/g, "messages.rowid"));
    params.push(...rowValues);

    const sql = `SELECT messages.rowid, messages.chat_jid, messages.sender,
      messages.sender_name, messages.content, messages.content_blocks, messages.timestamp, messages.is_bot_message
      FROM messages
      JOIN messages_fts ON messages_fts.rowid = messages.rowid
      WHERE ${conditions.join(" AND ")} ORDER BY messages.rowid DESC LIMIT ? OFFSET ?`;
    return db.prepare(sql).all(...params, limit, offset) as MessageRow[];
  } catch {
    const terms = trimmed
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => `%${term}%`);
    if (terms.length === 0) return [];

    const clauses = terms.map(() => "content LIKE ? COLLATE NOCASE");
    const conditions: string[] = [`(${clauses.join(" AND ")})`];
    const params: (string | number)[] = [...terms];
    if (chatJid) {
      conditions.unshift("chat_jid = ?");
      params.unshift(chatJid);
    }
    if (roleFilter !== null) {
      conditions.push("is_bot_message = ?");
      params.push(roleFilter);
    }
    appendSenderFilter(conditions, params, senderFilter);
    for (const c of timeClauses) conditions.push(c);
    params.push(...timeValues);
    for (const c of rowClauses) conditions.push(c);
    params.push(...rowValues);

    const sql = `SELECT rowid, chat_jid, sender, sender_name, content, content_blocks, timestamp, is_bot_message
      FROM messages WHERE ${conditions.join(" AND ")} ORDER BY rowid DESC LIMIT ? OFFSET ?`;
    return db.prepare(sql).all(...params, limit, offset) as MessageRow[];
  }
}

function fetchByRowId(
  chatJid: string | null,
  roleFilter: number | null,
  senderFilter: string | null,
  rowId: number,
): MessageRow | null {
  const db = getDb();
  const conditions: string[] = ["rowid = ?"];
  const params: (string | number)[] = [rowId];
  if (chatJid) {
    conditions.unshift("chat_jid = ?");
    params.unshift(chatJid);
  }
  if (roleFilter !== null) {
    conditions.push("is_bot_message = ?");
    params.push(roleFilter);
  }
  appendSenderFilter(conditions, params, senderFilter);
  const sql = `SELECT rowid, chat_jid, sender, sender_name, content, content_blocks, timestamp, is_bot_message
      FROM messages WHERE ${conditions.join(" AND ")} LIMIT 1`;
  return (db.prepare(sql).get(...params) as MessageRow | undefined) ?? null;
}

function fetchContextRows(
  chatJid: string,
  rowId: number,
  roleFilter: number | null,
  senderFilter: string | null,
  before: number,
  after: number,
): { context_before: MessageRow[]; context_after: MessageRow[] } {
  const db = getDb();

  const beforeConditions = ["chat_jid = ?", "rowid < ?"];
  const beforeParams: (string | number)[] = [chatJid, rowId];
  if (roleFilter !== null) {
    beforeConditions.push("is_bot_message = ?");
    beforeParams.push(roleFilter);
  }
  appendSenderFilter(beforeConditions, beforeParams, senderFilter);
  const beforeSql = `SELECT rowid, chat_jid, sender, sender_name, content, content_blocks, timestamp, is_bot_message
      FROM messages WHERE ${beforeConditions.join(" AND ")} ORDER BY rowid DESC LIMIT ?`;

  const afterConditions = ["chat_jid = ?", "rowid > ?"];
  const afterParams: (string | number)[] = [chatJid, rowId];
  if (roleFilter !== null) {
    afterConditions.push("is_bot_message = ?");
    afterParams.push(roleFilter);
  }
  appendSenderFilter(afterConditions, afterParams, senderFilter);
  const afterSql = `SELECT rowid, chat_jid, sender, sender_name, content, content_blocks, timestamp, is_bot_message
      FROM messages WHERE ${afterConditions.join(" AND ")} ORDER BY rowid ASC LIMIT ?`;

  const beforeRows = before > 0 ? (db.prepare(beforeSql).all(...beforeParams, before) as MessageRow[]) : [];
  beforeRows.reverse();
  const afterRows = after > 0 ? (db.prepare(afterSql).all(...afterParams, after) as MessageRow[]) : [];

  return { context_before: beforeRows, context_after: afterRows };
}

function fetchCascadeRows(chatJid: string, rowId: number): MessageRow[] {
  return getDb()
    .prepare(
      "SELECT rowid, chat_jid, sender, sender_name, content, content_blocks, timestamp, is_bot_message FROM messages WHERE chat_jid = ? AND (rowid = ? OR thread_id = ?)",
    )
    .all(chatJid, rowId, rowId) as MessageRow[];
}

function rowHasAttachments(rowId: number): boolean {
  return getMediaIdsForMessage(rowId).length > 0;
}

function executeSearch(params: MessagesParams, defaultChat: string): AgentToolResult<Record<string, unknown>> {
  const query = params.query?.trim() ?? "";
  if (!query) {
    return {
      content: [{ type: "text", text: "Provide query for action=search." }],
      details: { action: "search", count: 0, results: [] },
    };
  }

  const chatJid = normalizeChatJid(params.chat_jid, defaultChat);
  const roleFilter = normalizeRole(params.role);
  const senderFilter = normalizeSender(params.sender);
  const limit = Math.min(Math.max(params.limit ?? 10, 1), 50);
  const offset = Math.max(params.offset ?? 0, 0);
  const detailsMaxChars = typeof params.details_max_chars === "number" ? Math.max(params.details_max_chars, 0) : undefined;
  const excerptChars = typeof params.excerpt_chars === "number" ? Math.min(Math.max(params.excerpt_chars, 0), 1000) : undefined;
  const afterTs = params.since || params.after;
  const rows = runSearch(query, chatJid, roleFilter, senderFilter, limit, offset, afterTs, params.before, params.after_row, params.before_row);

  if (rows.length === 0) {
    return {
      content: [{ type: "text", text: "No matching messages found." }],
      details: { action: "search", count: 0, results: [] },
    };
  }

  const searchTerms = excerptChars ? extractSearchTerms(query) : [];
  const clipped = rows.map((row) => {
    const base = clipContent(row, detailsMaxChars);
    const excerpt = excerptChars ? buildContentExcerpt(row.content, searchTerms, excerptChars) : null;
    return excerpt
      ? { ...base, content_excerpt: excerpt.text, content_excerpt_truncated: excerpt.truncated }
      : base;
  });
  const preview = clipped
    .map((row) => `[${row.rowid}] ${row.sender_name || row.sender}: ${row.content_excerpt ?? row.content}`)
    .join("\n");

  return {
    content: [{ type: "text", text: `Found ${clipped.length} message${clipped.length === 1 ? "" : "s"}.\n${preview}` }],
    details: {
      action: "search",
      count: clipped.length,
      query,
      results: clipped,
      limit,
      offset,
      chat_jid: chatJid,
      role: params.role,
      sender: senderFilter,
      after: params.after || params.since,
      before: params.before,
      after_row: params.after_row,
      before_row: params.before_row,
      excerpt_chars: excerptChars,
      details_max_chars: detailsMaxChars,
    },
  };
}

function executeGet(params: MessagesParams, defaultChat: string): AgentToolResult<Record<string, unknown>> {
  const rowIds = Array.from(new Set((params.row_ids ?? []).filter((rowId) => Number.isInteger(rowId) && rowId > 0)));
  if (rowIds.length === 0) {
    return {
      content: [{ type: "text", text: "Provide row_ids for action=get." }],
      details: { action: "get", count: 0, messages: [], missing_row_ids: [] },
    };
  }

  const chatJid = normalizeChatJid(params.chat_jid, defaultChat);
  const roleFilter = normalizeRole(params.role);
  const senderFilter = normalizeSender(params.sender);
  const contextBefore = Math.min(Math.max(params.context_before ?? 0, 0), 20);
  const contextAfter = Math.min(Math.max(params.context_after ?? 0, 0), 20);
  const detailsMaxChars = typeof params.details_max_chars === "number" ? Math.max(params.details_max_chars, 0) : undefined;
  const contentLines = parseContentLines(params.content_lines);
  if (params.content_lines && !contentLines) {
    return {
      content: [{ type: "text", text: "Invalid content_lines. Use 'start-end' or a single line number." }],
      details: { action: "get", count: 0, messages: [], missing_row_ids: [], content_lines: params.content_lines, error: "invalid_content_lines" },
    };
  }
  const contentGrep = params.content_grep?.trim() || undefined;

  const messages: GetResultItem[] = [];
  const missing: number[] = [];

  for (const rowId of rowIds) {
    const row = fetchByRowId(chatJid, roleFilter, senderFilter, rowId);
    if (!row) {
      missing.push(rowId);
      continue;
    }

    const { context_before, context_after } = fetchContextRows(
      row.chat_jid,
      row.rowid,
      roleFilter,
      senderFilter,
      contextBefore,
      contextAfter,
    );

    const lineView = (contentLines || contentGrep)
      ? buildLineView(row.content, contentLines, contentGrep, detailsMaxChars)
      : undefined;

    messages.push({
      message: clipContent(row, detailsMaxChars),
      context_before: context_before.map((item) => clipContent(item, detailsMaxChars)),
      context_after: context_after.map((item) => clipContent(item, detailsMaxChars)),
      line_view: lineView,
    });
  }

  const output = messages
    .map((item) => {
      const header = `- [${item.message.rowid}] ${item.message.sender_name || item.message.sender}: ${item.message.content}`;
      const before = item.context_before
        .map((r) => `  [${r.rowid}] ${r.sender_name || r.sender}: ${r.content}`)
        .join("\n");
      const after = item.context_after
        .map((r) => `  [${r.rowid}] ${r.sender_name || r.sender}: ${r.content}`)
        .join("\n");
      const parts = [header];
      if (item.line_view) {
        const lineHeader = `  lines ${item.line_view.selected_start}-${item.line_view.selected_end}${item.line_view.grep ? ` grep=${JSON.stringify(item.line_view.grep)}` : ""}:`;
        const lineBody = item.line_view.lines.length > 0
          ? item.line_view.lines.map((line) => `  ${line.line_number}| ${line.content}`).join("\n")
          : "  [no matching lines]";
        parts.push(`${lineHeader}\n${lineBody}`);
      }
      if (before) parts.push(`  before:\n${before}`);
      if (after) parts.push(`  after:\n${after}`);
      return parts.join("\n");
    })
    .filter(Boolean)
    .join("\n\n");

  return {
    content: [{ type: "text", text: output || "No messages found for requested row IDs." }],
    details: {
      action: "get",
      count: messages.length,
      messages,
      missing_row_ids: missing,
      context_before: contextBefore,
      context_after: contextAfter,
      sender: senderFilter,
      content_lines: params.content_lines,
      content_grep: contentGrep,
      details_max_chars: detailsMaxChars,
    },
  };
}

function executeGrep(params: MessagesParams, defaultChat: string): AgentToolResult<Record<string, unknown>> {
  const pattern = getPatternInput(params);
  if (!pattern) {
    return {
      content: [{ type: "text", text: "Provide pattern (or query) for action=grep." }],
      details: { action: "grep", count: 0, matching_lines: 0, results: [] },
    };
  }

  const regex = params.regex === true;
  if (regex && !compileRegex(pattern)) {
    return {
      content: [{ type: "text", text: "Invalid regex pattern." }],
      details: { action: "grep", count: 0, matching_lines: 0, results: [], error: "invalid_regex", pattern },
    };
  }

  const chatJid = normalizeChatJid(params.chat_jid, defaultChat);
  const roleFilter = normalizeRole(params.role);
  const senderFilter = normalizeSender(params.sender);
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);
  const offset = Math.max(params.offset ?? 0, 0);
  const maxMatches = Math.min(Math.max(params.max_matches ?? 50, 1), 200);
  const contextLines = Math.min(Math.max(params.context_lines ?? 0, 0), 5);
  const detailsMaxChars = typeof params.details_max_chars === "number" ? Math.max(params.details_max_chars, 0) : undefined;
  const rows = listMessageWindow(chatJid, roleFilter, senderFilter, limit, offset, params.since || params.after, params.before, params.after_row, params.before_row);

  const results: GrepResultItem[] = [];
  let matchingLines = 0;
  for (const row of rows) {
    if (matchingLines >= maxMatches) break;
    const lineView = buildGrepLineView(row.content, pattern, regex, contextLines, detailsMaxChars);
    if (!lineView) continue;
    const remaining = maxMatches - matchingLines;
    const matchedNumbers = new Set(lineView.lines.filter((line) => line.matched).map((line) => line.line_number));
    const limitedMatched = new Set(Array.from(matchedNumbers).sort((a, b) => a - b).slice(0, remaining));
    const limitedLines = lineView.lines.filter((line) => !line.matched || limitedMatched.has(line.line_number));
    const limitedLineView: GrepLineView = {
      ...lineView,
      match_count: limitedMatched.size,
      lines: limitedLines,
    };
    results.push({
      message: clipContent(row, detailsMaxChars),
      line_view: limitedLineView,
    });
    matchingLines += limitedMatched.size;
  }

  if (results.length === 0) {
    return {
      content: [{ type: "text", text: "No matching lines found." }],
      details: { action: "grep", count: 0, matching_lines: 0, results: [], pattern, regex },
    };
  }

  const preview = results.map((item) => {
    const lines = item.line_view.lines.map((line) => `${line.matched ? ">" : " "} ${line.line_number}| ${line.content}`).join("\n");
    return `[${item.message.rowid}] ${item.message.sender_name || item.message.sender}:\n${lines}`;
  }).join("\n\n");

  return {
    content: [{ type: "text", text: `Found ${matchingLines} matching line${matchingLines === 1 ? "" : "s"} across ${results.length} message${results.length === 1 ? "" : "s"}.\n${preview}` }],
    details: {
      action: "grep",
      count: results.length,
      matching_lines: matchingLines,
      results,
      pattern,
      regex,
      context_lines: contextLines,
      max_matches: maxMatches,
      limit,
      offset,
      chat_jid: chatJid,
      role: params.role,
      sender: senderFilter,
      after: params.after || params.since,
      before: params.before,
      after_row: params.after_row,
      before_row: params.before_row,
      details_max_chars: detailsMaxChars,
    },
  };
}

function executeExtract(params: MessagesParams, defaultChat: string): AgentToolResult<Record<string, unknown>> {
  const pattern = getPatternInput(params);
  if (!pattern) {
    return {
      content: [{ type: "text", text: "Provide pattern (or query) for action=extract." }],
      details: { action: "extract", count: 0, values: [] },
    };
  }

  const regex = params.regex === true;
  const captureGroup = Math.min(Math.max(params.capture_group ?? 0, 0), 10);
  if (!regex && captureGroup > 0) {
    return {
      content: [{ type: "text", text: "capture_group requires regex=true." }],
      details: { action: "extract", count: 0, values: [], error: "capture_group_requires_regex" },
    };
  }
  if (regex && !compileRegex(pattern)) {
    return {
      content: [{ type: "text", text: "Invalid regex pattern." }],
      details: { action: "extract", count: 0, values: [], error: "invalid_regex", pattern },
    };
  }

  const chatJid = normalizeChatJid(params.chat_jid, defaultChat);
  const roleFilter = normalizeRole(params.role);
  const senderFilter = normalizeSender(params.sender);
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 50);
  const offset = Math.max(params.offset ?? 0, 0);
  const maxMatches = Math.min(Math.max(params.max_matches ?? 50, 1), 200);
  const dedupe = params.dedupe !== false;
  const sort = params.sort ?? "none";
  const rows = listMessageWindow(chatJid, roleFilter, senderFilter, limit, offset, params.since || params.after, params.before, params.after_row, params.before_row).slice().reverse();

  const values: ExtractResultItem[] = [];
  const byValue = new Map<string, ExtractResultItem>();
  for (const row of rows) {
    const matches = collectPatternMatches(row.content, pattern, regex, captureGroup);
    for (const match of matches) {
      if (dedupe) {
        const existing = byValue.get(match);
        if (existing) {
          existing.count += 1;
          continue;
        }
        const item: ExtractResultItem = {
          value: match,
          count: 1,
          first_seen_rowid: row.rowid,
          first_seen_at: row.timestamp,
          first_seen_chat_jid: row.chat_jid,
          first_seen_sender: row.sender,
          first_seen_sender_name: row.sender_name,
        };
        byValue.set(match, item);
      } else {
        values.push({
          value: match,
          count: 1,
          first_seen_rowid: row.rowid,
          first_seen_at: row.timestamp,
          first_seen_chat_jid: row.chat_jid,
          first_seen_sender: row.sender,
          first_seen_sender_name: row.sender_name,
        });
      }
    }
  }

  const resultValues = dedupe ? Array.from(byValue.values()) : values;
  if (sort === "asc") resultValues.sort((a, b) => a.value.localeCompare(b.value));
  if (sort === "desc") resultValues.sort((a, b) => b.value.localeCompare(a.value));
  const bounded = resultValues.slice(0, maxMatches);

  if (bounded.length === 0) {
    return {
      content: [{ type: "text", text: "No values extracted." }],
      details: { action: "extract", count: 0, values: [], pattern, regex, capture_group: captureGroup, dedupe, sort },
    };
  }

  const preview = bounded.map((item) => `${item.value} (${item.count}) first_seen=[${item.first_seen_rowid}] ${item.first_seen_at}`).join("\n");
  return {
    content: [{ type: "text", text: `Extracted ${bounded.length} value${bounded.length === 1 ? "" : "s"}.\n${preview}` }],
    details: {
      action: "extract",
      count: bounded.length,
      values: bounded,
      pattern,
      regex,
      capture_group: captureGroup,
      dedupe,
      sort,
      max_matches: maxMatches,
      limit,
      offset,
      chat_jid: chatJid,
      role: params.role,
      sender: senderFilter,
      after: params.after || params.since,
      before: params.before,
      after_row: params.after_row,
      before_row: params.before_row,
    },
  };
}

function executeDiff(params: MessagesParams, defaultChat: string): AgentToolResult<Record<string, unknown>> {
  const hasCheckpoint = typeof params.after_row === "number" || typeof params.before_row === "number" || Boolean(params.after || params.since || params.before);
  if (!hasCheckpoint) {
    return {
      content: [{ type: "text", text: "Provide at least after_row, before_row, after, or before for action=diff." }],
      details: { action: "diff", count: 0, messages: [], error: "missing_checkpoint" },
    };
  }

  const chatJid = normalizeChatJid(params.chat_jid, defaultChat);
  const roleFilter = normalizeRole(params.role);
  const senderFilter = normalizeSender(params.sender);
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);
  const offset = Math.max(params.offset ?? 0, 0);
  const detailsMaxChars = typeof params.details_max_chars === "number" ? Math.max(params.details_max_chars, 0) : undefined;
  const rows = listMessageWindow(chatJid, roleFilter, senderFilter, limit, offset, params.since || params.after, params.before, params.after_row, params.before_row)
    .slice()
    .reverse();

  if (rows.length === 0) {
    return {
      content: [{ type: "text", text: "No changes found in the requested checkpoint window." }],
      details: {
        action: "diff",
        count: 0,
        messages: [],
        summary: {
          checkpoint_after_row: params.after_row ?? null,
          checkpoint_before_row: params.before_row ?? null,
          checkpoint_after: params.after || params.since || null,
          checkpoint_before: params.before || null,
          first_rowid: null,
          last_rowid: null,
          user_count: 0,
          assistant_count: 0,
          sender_counts: [],
        } satisfies DiffSummary,
      },
    };
  }

  const messages = rows.map((row) => clipContent(row, detailsMaxChars));
  const senderCounts = new Map<string, number>();
  let userCount = 0;
  let assistantCount = 0;
  for (const row of rows) {
    const senderKey = row.sender_name || row.sender;
    senderCounts.set(senderKey, (senderCounts.get(senderKey) ?? 0) + 1);
    if (row.is_bot_message === 1) assistantCount += 1;
    else userCount += 1;
  }

  const summary: DiffSummary = {
    checkpoint_after_row: params.after_row ?? null,
    checkpoint_before_row: params.before_row ?? null,
    checkpoint_after: params.after || params.since || null,
    checkpoint_before: params.before || null,
    first_rowid: rows[0]?.rowid ?? null,
    last_rowid: rows[rows.length - 1]?.rowid ?? null,
    user_count: userCount,
    assistant_count: assistantCount,
    sender_counts: Array.from(senderCounts.entries())
      .map(([sender, count]) => ({ sender, count }))
      .sort((a, b) => b.count - a.count || a.sender.localeCompare(b.sender)),
  };

  const senderPreview = summary.sender_counts.slice(0, 5).map((entry) => `${entry.sender}=${entry.count}`).join(", ");
  const preview = messages.map((row) => `[${row.rowid}] ${row.sender_name || row.sender}: ${row.content}`).join("\n");
  return {
    content: [{
      type: "text",
      text: `Changed messages: ${messages.length}. Rows ${summary.first_rowid}–${summary.last_rowid}. User ${summary.user_count}, assistant ${summary.assistant_count}.${senderPreview ? ` Senders: ${senderPreview}.` : ""}\n${preview}`,
    }],
    details: {
      action: "diff",
      count: messages.length,
      messages,
      summary,
      limit,
      offset,
      chat_jid: chatJid,
      role: params.role,
      sender: senderFilter,
      after: params.after || params.since,
      before: params.before,
      after_row: params.after_row,
      before_row: params.before_row,
      details_max_chars: detailsMaxChars,
    },
  };
}

function sanitizeMessageToolContent(rawContent: string | undefined, isBot: boolean): string {
  const trimmed = rawContent?.trim() ?? "";
  if (!isBot) return trimmed;
  return stripInternalTags(trimmed);
}

function executeAdd(params: MessagesParams, defaultChat: string): AgentToolResult<Record<string, unknown>> {
  const isBot = params.type === "agent";
  const rawContent = params.content?.trim() ?? "";
  const content = sanitizeMessageToolContent(params.content, isBot);
  if (!content) {
    return {
      content: [{ type: "text", text: rawContent ? "No visible content remains after stripping internal tags." : "Provide content for action=add." }],
      details: { action: "add", inserted: 0 },
    };
  }

  const chatJid = normalizeChatJid(params.chat_jid, defaultChat);
  if (!chatJid) {
    return {
      content: [{ type: "text", text: "Cannot infer target chat. Provide chat_jid." }],
      details: { action: "add", inserted: 0 },
    };
  }

  const timestamp = new Date().toISOString();
  const rowId = storeMessage({
    id: createUuid("msg"),
    chat_jid: chatJid,
    sender: isBot ? "web-agent" : "web-user",
    sender_name: isBot ? "Pi" : "You",
    content,
    timestamp,
    is_from_me: false,
    is_bot_message: isBot,
    content_blocks: undefined,
    link_previews: undefined,
    thread_id: null,
  });

  if (rowId <= 0) {
    return {
      content: [{ type: "text", text: "Failed to add message." }],
      details: { action: "add", inserted: 0 },
    };
  }

  const mediaIds = Array.from(new Set((params.media_ids ?? []).filter((id) => Number.isInteger(id) && id > 0)));
  if (mediaIds.length > 0) {
    attachMediaToMessage(rowId, mediaIds);
  }

  const inserted = {
    rowid: rowId,
    chat_jid: chatJid,
    sender: isBot ? "web-agent" : "web-user",
    sender_name: isBot ? "Pi" : "You",
    content,
    timestamp,
    is_bot_message: isBot ? 1 : 0,
    created_at: timestamp,
  } satisfies MessageResultRow;

  return {
    content: [{ type: "text", text: `Added message ${rowId} to ${chatJid}.` }],
    details: {
      action: "add",
      inserted: 1,
      row_id: rowId,
      chat_jid: chatJid,
      message: inserted,
    },
  };
}

function executePost(
  params: MessagesParams,
  defaultChat: string,
  postFn?: (chatJid: string, content: string, isBot: boolean, mediaIds: number[], contentBlocks?: unknown[]) => number | null,
): AgentToolResult<Record<string, unknown>> {
  const isBot = params.type === "agent";
  const rawContent = params.content?.trim() ?? "";
  const content = sanitizeMessageToolContent(params.content, isBot);
  if (!content) {
    return {
      content: [{ type: "text", text: rawContent ? "No visible content remains after stripping internal tags." : "Provide content for action=post." }],
      details: { action: "post", posted: 0 },
    };
  }

  const chatJid = normalizeChatJid(params.chat_jid, defaultChat);
  if (!chatJid) {
    return {
      content: [{ type: "text", text: "Cannot infer target chat. Provide chat_jid." }],
      details: { action: "post", posted: 0 },
    };
  }

  const mediaIds = Array.from(new Set((params.media_ids ?? []).filter((id) => Number.isInteger(id) && id > 0)));
  const contentBlocks = Array.isArray(params.content_blocks) ? params.content_blocks : undefined;

  if (postFn) {
    const rowId = postFn(chatJid, content, isBot, mediaIds, contentBlocks);
    if (!rowId) {
      return {
        content: [{ type: "text", text: "Failed to post message." }],
        details: { action: "post", posted: 0 },
      };
    }
    return {
      content: [{ type: "text", text: `Posted message ${rowId} to ${chatJid} (broadcast).` }],
      details: { action: "post", posted: 1, row_id: rowId, chat_jid: chatJid, broadcast: true },
    };
  }

  // Fallback: plain DB insert without broadcast (same as add but with content_blocks)
  const timestamp = new Date().toISOString();
  const rowId = storeMessage({
    id: createUuid("msg"),
    chat_jid: chatJid,
    sender: isBot ? "web-agent" : "web-user",
    sender_name: isBot ? "Pi" : "You",
    content,
    timestamp,
    is_from_me: false,
    is_bot_message: isBot,
    content_blocks: contentBlocks,
    link_previews: undefined,
    thread_id: null,
  });

  if (rowId <= 0) {
    return {
      content: [{ type: "text", text: "Failed to post message." }],
      details: { action: "post", posted: 0 },
    };
  }

  if (mediaIds.length > 0) {
    attachMediaToMessage(rowId, mediaIds);
  }

  return {
    content: [{ type: "text", text: `Posted message ${rowId} to ${chatJid} (no broadcast — channel not available).` }],
    details: { action: "post", posted: 1, row_id: rowId, chat_jid: chatJid, broadcast: false },
  };
}

function executeDelete(params: MessagesParams, defaultChat: string): AgentToolResult<Record<string, unknown>> {
  const requested = Array.from(new Set((params.row_ids ?? []).filter((id) => Number.isInteger(id) && id > 0)));
  if (requested.length === 0) {
    return {
      content: [{ type: "text", text: "Provide row_ids for action=delete." }],
      details: { action: "delete", deleted_row_ids: [], skipped_row_ids: [] },
    };
  }

  const chatJid = normalizeChatJid(params.chat_jid, defaultChat);
  const force = params.force === true;
  const dryRun = params.dry_run === true;
  const roleFilter = normalizeRole(params.role);

  const skipped = new Map<number, string[]>();
  const rootDeletePlan = new Map<number, { chatJid: string; rowIds: number[] }>();
  const alreadyPlanned = new Set<number>();

  for (const rootId of requested) {
    const root = fetchByRowId(chatJid, roleFilter, null, rootId);
    if (!root) {
      skipped.set(rootId, ["not_found"]);
      continue;
    }

    const targetChatJid = root.chat_jid;
    const cascade = fetchCascadeRows(targetChatJid, root.rowid);
    const overlapsSkipped = cascade.some((row) => skipped.has(row.rowid));
    if (overlapsSkipped) {
      skipped.set(root.rowid, ["cascade_dependency_skipped"]);
      continue;
    }

    const overlapsPlanned = cascade.some((row) => alreadyPlanned.has(row.rowid));
    if (overlapsPlanned) {
      skipped.set(root.rowid, ["cascade_dependency_planned"]);
      continue;
    }

    const hasAttachments = cascade.some((row) => rowHasAttachments(row.rowid));
    if (!force && hasAttachments) {
      for (const row of cascade) {
        skipped.set(row.rowid, ["media_attachments_present"]);
      }
      continue;
    }

    const rowIds = cascade.map((row) => row.rowid);
    rootDeletePlan.set(root.rowid, { chatJid: targetChatJid, rowIds });
    for (const id of rowIds) alreadyPlanned.add(id);
  }

  const planned = new Set<number>();
  for (const plan of rootDeletePlan.values()) {
    for (const id of plan.rowIds) planned.add(id);
  }

  const finalDeleted = new Set<number>();
  if (!dryRun) {
    for (const [rootId, plan] of rootDeletePlan.entries()) {
      const removed = deleteThreadByRowId(plan.chatJid, rootId);
      for (const removedRowId of removed) {
        if (!skipped.has(removedRowId)) finalDeleted.add(removedRowId);
      }
    }
  } else {
    for (const id of planned) finalDeleted.add(id);
  }

  const skippedRowIds = Array.from(skipped.keys()).sort((a, b) => a - b);
  const skippedReasons = Object.fromEntries(Array.from(skipped.entries()).map(([id, reasons]) => [String(id), reasons]));

  return {
    content: [
      {
        type: "text",
        text: dryRun
          ? `Delete plan: ${finalDeleted.size} row(s) would be deleted, ${skippedRowIds.length} skipped.`
          : `Deleted ${finalDeleted.size} row(s), skipped ${skippedRowIds.length}.`,
      },
    ],
    details: {
      action: "delete",
      requested_row_ids: requested,
      deleted_row_ids: Array.from(finalDeleted).sort((a, b) => a - b),
      skipped_row_ids: skippedRowIds,
      skipped_reasons: skippedReasons,
      dry_run: dryRun,
      force,
      count: finalDeleted.size,
      skipped_count: skippedRowIds.length,
      chat_jid: chatJid,
    },
  };
}

/**
 * Shared helper for external callers that want direct access to message-tool
 * semantics without an agent extension context.
 *
 * @param postFn Optional callback for action=post that stores + broadcasts
 *               a message through the web channel pipeline. If not provided,
 *               action=post falls back to a plain DB insert (like add).
 */
export function runMessagesTool(
  params: MessagesParams,
  defaultChat: string = "web:default",
  postFn?: (chatJid: string, content: string, isBot: boolean, mediaIds: number[], contentBlocks?: unknown[]) => number | null,
): AgentToolResult<Record<string, unknown>> {
  const action = params.action || "search";

  if (action === "search") return executeSearch(params, defaultChat);
  if (action === "get") return executeGet(params, defaultChat);
  if (action === "grep") return executeGrep(params, defaultChat);
  if (action === "extract") return executeExtract(params, defaultChat);
  if (action === "diff") return executeDiff(params, defaultChat);
  if (action === "add") return executeAdd(params, defaultChat);
  if (action === "post") return executePost(params, defaultChat, postFn);
  if (action === "delete") return executeDelete(params, defaultChat);

  return {
    content: [{ type: "text", text: `Unknown action: ${action}` }],
    details: {
      error: `Unknown action: ${action}`,
      requested_action: action,
    },
  };
}

/**
 * Helper for extensions that want the messages tool's post semantics using the
 * globally registered broadcast callback.
 */
export function postMessagesToolMessage(
  params: MessagesParams,
  defaultChat: string = "web:default",
): AgentToolResult<Record<string, unknown>> {
  return executePost(params, defaultChat, registeredPostFn);
}

const MESSAGES_TOOL_HINT = [
  "## Messages",
  "Use the messages tool to search, retrieve, grep, extract, diff, add, post, and delete chat messages.",
  "Read operations are safe by default; delete requires explicit action=delete and can be dry-run with dry_run=true.",
  "Read/search/get results include message metadata and include parsed content_blocks when available.",
  "The post action stores a message with content_blocks and broadcasts it to connected clients.",
  "Example:",
  "- search: { action: \"search\", query: \"keyword\", limit: 10 }",
  "- get: { action: \"get\", row_ids: [123], context_before: 2, context_after: 1 }",
  "- grep: { action: \"grep\", pattern: \"error\", after_row: 100, context_lines: 1 }",
  "- extract: { action: \"extract\", pattern: \"pc=(0x[0-9a-f]+)\", regex: true, capture_group: 1 }",
  "- diff: { action: \"diff\", after_row: 12345, limit: 20 }",
  "- add: { action: \"add\", type: \"agent\", content: \"Hello\" }",
  "- post: { action: \"post\", type: \"agent\", content: \"Card fallback\", content_blocks: [...] }",
  "- delete: { action: \"delete\", row_ids: [123, 124], dry_run: true, force: true }",
].join("\n");

/** Post function type for broadcasting messages via the web channel. */
export type MessagePostFn = (
  chatJid: string,
  content: string,
  isBot: boolean,
  mediaIds: number[],
  contentBlocks?: unknown[],
) => number | null;

/** Optional post function injected by the web channel for broadcast support. */
let registeredPostFn: MessagePostFn | undefined;

/** Set the post function for the messages tool. Called by web channel wiring. */
export function setMessagesPostFn(fn: MessagePostFn | undefined): void {
  registeredPostFn = fn;
}

export const messagesCrud: ExtensionFactory = (pi: ExtensionAPI) => {
  pi.on("before_agent_start", async (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${MESSAGES_TOOL_HINT}`,
  }));

  pi.registerTool({
    name: "messages",
    label: "messages",
    description: "Search, retrieve, grep, extract, diff, add, post, or delete messages via shared store.",
    promptSnippet: "messages: search/get/grep/extract/diff/add/post/delete rows in the shared message timeline store.",
    parameters: MessagesSchema,
    async execute(_toolCallId, params) {
      const defaultChat = getChatJid("web:default");
      return runMessagesTool(params, defaultChat, registeredPostFn);
    },
  });
};
