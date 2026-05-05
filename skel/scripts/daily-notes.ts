#!/usr/bin/env bun
/**
 * daily-notes.ts
 *
 * Generates Obsidian-style daily note skeletons under notes/daily/YYYY-MM-DD.md.
 * Notes are summaries only — the chat DB is the source of truth.
 *
 * For web chats, the script aggregates activity from all web session trees
 * (root chats plus any branch chats) so daily notes reflect the full working day.
 *
 * Notes use YAML front matter with a date field and a summarised_until watermark.
 * When a day is partially summarised (new messages after summarised_until),
 * the script appends a "Summary update" block with a NEEDS_SUMMARY_UPDATE marker.
 *
 * Existing notes with real summaries are never overwritten (past days).
 * Today's note is always refreshed (metadata updated) but its content is preserved.
 *
 * Usage:
 *   bun run /workspace/scripts/daily-notes.ts [--days <n>] [--force] [--db <path>] [--chat <jid>]
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { parseArgs } from "util";
import { buildInClause, resolveSessionScope, summariseSessionScope } from "./lib/chat-session-scope";
import { refreshAgentMemoryFromDailyNotes } from "./lib/agent-memory-sidecar";

const defaultDbPath = `${process.env.PICLAW_STORE || "/workspace/.piclaw/store"}/messages.db`;


// --help support
if (Bun.argv.includes("--help") || Bun.argv.includes("-h")) {
  console.log("Usage: bun daily-notes.ts [options]");
  console.log("");
  console.log("  daily-notes.ts");
  process.exit(0);
}
const { values: args } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    days:  { type: "string",  default: "" },
    force: { type: "boolean", default: false },
    db:    { type: "string",  default: defaultDbPath },
    chat:  { type: "string",  default: "web:default" },
  },
  strict: true,
});

const DB_PATH   = args.db!;
const CHAT_JID  = args.chat!;
const DAYS      = args.days ? parseInt(args.days, 10) : 0;
const FORCE     = args.force!;
const NOTES_DIR = "/workspace/notes/daily";
const SUMMARY_MARKER = "<!-- NEEDS_SUMMARY -->";
const SUMMARY_UPDATE_MARKER = "<!-- NEEDS_SUMMARY_UPDATE -->";
const INCOMPLETE_WARNING_TITLE = "> ⚠ **Incomplete daily note**";
const DREAM_CUES_START = "<!-- DREAM_CUES";
const DREAM_CUES_END = "DREAM_CUES -->";

mkdirSync(NOTES_DIR, { recursive: true });

// ── Helpers ─────────────────────────────────────────────────────────────
function formatDateLong(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
  });
}
/** Extract HH:MM from an ISO timestamp. */
function time(ts: string): string { return ts.slice(11, 16); }
/** Return today's date as YYYY-MM-DD. */
function todayStr(): string { return new Date().toISOString().slice(0, 10); }

/** Parsed YAML front matter: key-value fields and remaining body text. */
interface FrontMatter {
  fields: Record<string, string>;
  body: string;
  hasFrontMatter: boolean;
}

/** Parse YAML front matter delimited by --- fences from markdown content. */
function splitFrontMatter(content: string): FrontMatter {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { fields: {}, body: content, hasFrontMatter: false };
  const fmText = match[1];
  const body = content.slice(match[0].length);
  const fields: Record<string, string> = {};
  for (const line of fmText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf(":");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    fields[key] = value;
  }
  return { fields, body, hasFrontMatter: true };
}

/** Serialize a fields record back into a YAML front matter block. */
function formatFrontMatter(fields: Record<string, string>): string {
  const order = [
    "date",
    "summarised_until",
    "messages_total",
    "messages_user",
    "messages_assistant",
    "session_trees",
    "session_chats",
    "first_message",
    "last_message",
    "scope_mode",
    "scope_anchor",
  ];
  const lines = ["---"];
  for (const key of order) {
    if (key in fields) {
      const value = fields[key];
      lines.push(value ? `${key}: ${value}` : `${key}:`);
    }
  }
  const extras = Object.keys(fields).filter(k => !order.includes(k));
  for (const key of extras.sort()) {
    const value = fields[key];
    lines.push(value ? `${key}: ${value}` : `${key}:`);
  }
  lines.push("---");
  return lines.join("\n");
}

/** Remove inline HTML watermark comments and return the extracted value. */
function stripLegacyWatermark(body: string): { body: string; watermark: string | null } {
  const match = body.match(/^\s*<!--\s*summarised_until:(\S+)\s*-->\s*\n?/m);
  if (!match) return { body, watermark: null };
  const updated = body.replace(match[0], "");
  return { body: updated, watermark: match[1] };
}

/** Extract the ## Summary section text, returning null if only a placeholder marker. */
function extractSummary(body: string): string | null {
  const match = body.match(/## Summary\s*\n+([\s\S]*?)(?=^##\s|\s*$)/m);
  if (!match) return null;
  const raw = match[1].trim();
  if (!raw) return null;
  if (raw === SUMMARY_MARKER) return null;
  if (raw.startsWith(SUMMARY_MARKER)) {
    const cleaned = raw.replace(SUMMARY_MARKER, "").trim();
    return cleaned.length ? cleaned : null;
  }
  return raw;
}

/** Remove bold metadata lines (Messages, Time span) from the note body. */
function stripMetadataLines(body: string): string {
  body = body.replace(/^\*\*Messages:\*\*.*\n?/m, "");
  body = body.replace(/^\*\*Time span:\*\*.*\n?/m, "");
  return body;
}

/** Append a ## Summary update heading with NEEDS_SUMMARY_UPDATE marker. */
function appendSummaryUpdate(body: string, lastTs: string): string {
  if (body.includes(SUMMARY_UPDATE_MARKER)) return body;
  const heading = `## Summary update (${time(lastTs)} UTC)`;
  const suffix = `\n\n${heading}\n\n${SUMMARY_UPDATE_MARKER}\n`;
  return body.trimEnd() + suffix;
}

function stripIncompleteWarning(body: string): string {
  const lines = body.split("\n");
  const output: string[] = [];
  let skipping = false;

  for (const line of lines) {
    if (!skipping && line.trim() === INCOMPLETE_WARNING_TITLE) {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (line.startsWith("> ") || line.trim() === ">" || line.trim() === "") continue;
      skipping = false;
    }
    output.push(line);
  }

  return output.join("\n").replace(/^\n+/, "");
}

function buildIncompleteWarning(options: { summarisedUntil?: string; lastTimestamp: string; needsSummaryUpdate?: boolean }): string {
  const lines = [INCOMPLETE_WARNING_TITLE];
  if (options.needsSummaryUpdate && options.summarisedUntil) {
    lines.push(`> Summary currently covers messages only through \`${options.summarisedUntil}\`.`);
  }
  lines.push(`> Latest message currently on file: \`${options.lastTimestamp}\`.`);
  return `${lines.join("\n")}\n`;
}

function upsertIncompleteWarning(body: string, options: { summarisedUntil?: string; lastTimestamp: string; needsSummaryUpdate?: boolean } | null): string {
  const cleaned = stripIncompleteWarning(body).trimStart();
  if (!options) return cleaned;
  const warning = buildIncompleteWarning(options).trimEnd();
  const summaryIndex = cleaned.indexOf("\n## Summary");
  if (summaryIndex >= 0) {
    const before = cleaned.slice(0, summaryIndex).trimEnd();
    const after = cleaned.slice(summaryIndex + 1).trimStart();
    return `${before}\n\n${warning}\n\n${after}`;
  }
  return `${warning}\n\n${cleaned}`;
}

function stripDreamCues(body: string): string {
  return body
    .replace(/\n?<!-- DREAM_CUES[\s\S]*?DREAM_CUES -->\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

function cleanCueText(text: string, maxLen = 180): string {
  const cleaned = String(text || "")
    .replace(/--/g, "—")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1)}…` : cleaned;
}

function buildCueTerms(messages: Row[]): string[] {
  const stop = new Set(["about", "after", "again", "also", "because", "before", "could", "from", "have", "into", "just", "like", "more", "need", "only", "that", "their", "then", "there", "this", "with", "would"]);
  const counts = new Map<string, number>();
  for (const msg of messages) {
    for (const word of String(msg.content || "").toLowerCase().match(/[a-z0-9][a-z0-9_-]{3,}/g) || []) {
      if (stop.has(word)) continue;
      counts.set(word, (counts.get(word) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 16)
    .map(([word]) => word);
}

function buildDreamCues(messages: Row[], options: { firstTimestamp: string; lastTimestamp: string; totalMsgs: number; sessionTrees: number; sessionChats: number }): string {
  const includeFullSlice = options.totalMsgs <= 50 && options.sessionTrees <= 2;
  const selected = includeFullSlice
    ? messages
    : [...messages.slice(0, 5), ...messages.slice(Math.max(5, messages.length - 5))];
  const lines = [
    DREAM_CUES_START,
    "These cues are hidden recovery hints for Dream. Treat front matter as the transcript contract; use message IDs/timestamps with messages search only if more evidence is needed.",
    `slice: ${options.firstTimestamp}..${options.lastTimestamp}`,
    `messages_total: ${options.totalMsgs}`,
    `session_trees: ${options.sessionTrees}`,
    `session_chats: ${options.sessionChats}`,
    `bounded_full_slice: ${includeFullSlice ? "yes" : "no"}`,
  ];
  const terms = buildCueTerms(messages);
  if (terms.length > 0) lines.push(`cue_terms: ${terms.join(", ")}`);
  lines.push("message_snippets:");
  for (const msg of selected) {
    const role = msg.is_bot_message ? "assistant" : "user";
    lines.push(`- ${msg.timestamp} ${role} ${cleanCueText(msg.sender_name, 40)} [${cleanCueText(msg.chat_jid, 80)}]: ${cleanCueText(msg.content)}`);
  }
  if (!includeFullSlice && selected.length < messages.length) {
    lines.push(`omitted_middle_messages: ${messages.length - selected.length}`);
  }
  lines.push(DREAM_CUES_END);
  return lines.join("\n");
}

function upsertDreamCues(body: string, cues: string): string {
  const cleaned = stripDreamCues(body).trimStart();
  const summaryIndex = cleaned.indexOf("\n## Summary");
  if (summaryIndex >= 0) {
    const before = cleaned.slice(0, summaryIndex).trimEnd();
    const after = cleaned.slice(summaryIndex + 1).trimStart();
    return `${before}\n\n${cues}\n\n${after}`;
  }
  return `${cues}\n\n${cleaned}`;
}

// ── Query ───────────────────────────────────────────────────────────────
if (!existsSync(DB_PATH)) {
  console.error(`Database not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });
const scope = resolveSessionScope(db, CHAT_JID);
const scopeFilter = buildInClause("m.chat_jid", scope.chats.map(chat => chat.chatJid));

let whereClause = scopeFilter.clause;
const params: any[] = [...scopeFilter.params];
if (DAYS > 0) {
  const cutoff = new Date(Date.now() - DAYS * 86400000).toISOString();
  whereClause += " AND m.timestamp >= ?";
  params.push(cutoff);
}

/** Database row shape for queried messages. */
interface Row {
  sender_name: string;
  is_bot_message: number;
  content: string;
  timestamp: string;
  chat_jid: string;
  root_chat_jid: string;
  day: string;
}

const rows = db.query<Row, any[]>(
  `SELECT m.sender_name,
          m.is_bot_message,
          m.content,
          m.timestamp,
          m.chat_jid,
          COALESCE(cb.root_chat_jid, m.chat_jid) AS root_chat_jid,
          substr(m.timestamp, 1, 10) AS day
   FROM messages m
   LEFT JOIN chat_branches cb ON cb.chat_jid = m.chat_jid
   WHERE ${whereClause}
   ORDER BY m.timestamp ASC`
).all(...params);
db.close();

if (rows.length === 0) {
  console.log(`No messages found for scope: ${summariseSessionScope(scope)}`);
  process.exit(0);
}

// ── Group by day ────────────────────────────────────────────────────────
const dayMap = new Map<string, Row[]>();
for (const row of rows) {
  if (!dayMap.has(row.day)) dayMap.set(row.day, []);
  dayMap.get(row.day)!.push(row);
}

// ── Generate notes ──────────────────────────────────────────────────────
let created = 0, updated = 0, skipped = 0;
const needsSummary: string[] = [];
const stale: { path: string; watermark: string; lastMsg: string }[] = [];
const missingWatermark: string[] = [];
const dateMismatches: { path: string; expected: string; actual: string }[] = [];
const sortedDays = [...dayMap.keys()].sort();
const today = todayStr();

for (const day of sortedDays) {
  const filePath = `${NOTES_DIR}/${day}.md`;
  const isToday = day === today;
  const messages = dayMap.get(day)!;
  const firstTimestamp = messages[0].timestamp;
  const lastTimestamp = messages[messages.length - 1].timestamp;
  const totalMsgs = messages.length;
  const userMsgs = messages.filter(m => !m.is_bot_message).length;
  const botMsgs  = messages.filter(m => m.is_bot_message).length;
  const sessionTrees = new Set(messages.map(m => m.root_chat_jid)).size;
  const sessionChats = new Set(messages.map(m => m.chat_jid)).size;

  if (existsSync(filePath)) {
    const original = readFileSync(filePath, "utf-8");
    const { fields, body: rawBody, hasFrontMatter } = splitFrontMatter(original);
    const stripped = stripLegacyWatermark(rawBody);
    let body = stripped.body;

    const summary = extractSummary(body);
    const existingDate = fields.date || "";
    const frontMatterDate = existingDate || day;

    if (existingDate && existingDate !== day) {
      dateMismatches.push({ path: filePath, expected: day, actual: existingDate });
    }

    const existingWm = fields.summarised_until || stripped.watermark || "";
    const hasWm = existingWm && existingWm.length > 0;
    const needsPartialUpdate = !!(summary && hasWm && lastTimestamp > existingWm);
    const needsMigration = !hasFrontMatter || !("date" in fields) || !("summarised_until" in fields);
    let shouldWrite = isToday || FORCE || needsMigration || needsPartialUpdate;

    if (!isToday && !FORCE) {
      if (!summary) {
        needsSummary.push(filePath);
      } else if (!hasWm) {
        missingWatermark.push(filePath);
      } else if (lastTimestamp > existingWm) {
        stale.push({ path: filePath, watermark: existingWm, lastMsg: lastTimestamp });
      }
      if (!shouldWrite) {
        skipped++;
        continue;
      }
    }

    // Refresh metadata and optionally append update marker for partial day
    body = stripMetadataLines(body);

    if (needsPartialUpdate) {
      body = appendSummaryUpdate(body, lastTimestamp);
    }

    const incompleteState = !summary
      ? { lastTimestamp }
      : needsPartialUpdate
        ? { summarisedUntil: existingWm, lastTimestamp, needsSummaryUpdate: true }
        : !hasWm
          ? { lastTimestamp }
          : null;
    body = upsertIncompleteWarning(body, incompleteState);
    body = incompleteState
      ? upsertDreamCues(body, buildDreamCues(messages, { firstTimestamp, lastTimestamp, totalMsgs, sessionTrees, sessionChats }))
      : stripDreamCues(body);

    const nextFields: Record<string, string> = {
      ...fields,
      date: frontMatterDate,
      summarised_until: existingWm,
      messages_total: String(totalMsgs),
      messages_user: String(userMsgs),
      messages_assistant: String(botMsgs),
      session_trees: String(sessionTrees),
      session_chats: String(sessionChats),
      first_message: firstTimestamp,
      last_message: lastTimestamp,
      scope_mode: scope.mode,
      scope_anchor: CHAT_JID,
    };

    const output = `${formatFrontMatter(nextFields)}\n${body.trimStart()}`;
    await Bun.write(filePath, output);
    updated++;
    continue;
  }

  // New note
  const lines: string[] = [];
  lines.push(`# ${formatDateLong(day)}`);
  lines.push("");
  lines.push(`← ${sortedDays[sortedDays.indexOf(day) - 1] ? `[[${sortedDays[sortedDays.indexOf(day) - 1]}]]` : "—"} | ${sortedDays[sortedDays.indexOf(day) + 1] ? `[[${sortedDays[sortedDays.indexOf(day) + 1]}]]` : "—"} →`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(INCOMPLETE_WARNING_TITLE);
  lines.push(`> Latest message currently on file: \`${lastTimestamp}\`.`);
  lines.push("");
  lines.push(buildDreamCues(messages, { firstTimestamp, lastTimestamp, totalMsgs, sessionTrees, sessionChats }));
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(SUMMARY_MARKER);
  lines.push("");

  const fmFields: Record<string, string> = {
    date: day,
    summarised_until: "",
    messages_total: String(totalMsgs),
    messages_user: String(userMsgs),
    messages_assistant: String(botMsgs),
    session_trees: String(sessionTrees),
    session_chats: String(sessionChats),
    first_message: firstTimestamp,
    last_message: lastTimestamp,
    scope_mode: scope.mode,
    scope_anchor: CHAT_JID,
  };
  const output = `${formatFrontMatter(fmFields)}\n${lines.join("\n")}`;
  await Bun.write(filePath, output);
  created++;
  needsSummary.push(filePath);
  console.log(`  created ${filePath}`);
}

console.log(`\nScope: ${summariseSessionScope(scope)} (anchor ${CHAT_JID})`);
console.log(`Daily notes: ${created} created, ${updated} updated, ${skipped} unchanged.`);
if (needsSummary.length > 0) {
  console.log(`\nNotes needing summaries:`);
  for (const f of needsSummary) console.log(`  → ${f}`);
}
if (missingWatermark.length > 0) {
  console.log(`\nNotes missing summarised_until:`);
  for (const f of missingWatermark) console.log(`  → ${f}`);
}
if (stale.length > 0) {
  console.log(`\nNotes with partial summaries:`);
  for (const s of stale)
    console.log(`  → ${s.path} (summarised until ${s.watermark.slice(11,16)}, last msg ${s.lastMsg.slice(11,16)})`);
}
if (dateMismatches.length > 0) {
  console.log(`\nDate field mismatches:`);
  for (const d of dateMismatches)
    console.log(`  → ${d.path} (front matter ${d.actual}, expected ${d.expected})`);
}

const agentMemory = refreshAgentMemoryFromDailyNotes({ recentDays: Math.max(DAYS || 0, 7) });
console.log(`\nAgent memory refreshed:`);
console.log(`  → ${agentMemory.currentStatePath}`);
console.log(`  → ${agentMemory.recentContextPath}`);
