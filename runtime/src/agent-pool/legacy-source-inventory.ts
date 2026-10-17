// Inactive, read-only prerequisite. Never opens an SDK session or an import journal.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import type { Database } from "bun:sqlite";
import type { RuntimeLockHandle } from "../runtime/single-instance.js";

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const stamp = (path: string) => {
  const s = statSync(path, { bigint: true });
  assert(s.isFile(), `Not a regular legacy source: ${path}`);
  return [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(":");
};
const ordinal = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
// Pi 1.2.0 public SessionEntry fields. Unknown schemas remain captured, not importable.
const entryFields: Record<string, readonly string[]> = {
  message: ["message"], model_change: ["provider", "modelId"], thinking_level_change: ["thinkingLevel"],
  usage: ["kind", "provider", "model", "usage", "note"],
  compaction: ["summary", "firstKeptEntryId", "tokensBefore", "details", "usage", "fromHook", "systemMessage"],
  branch_summary: ["fromId", "summary", "details", "usage", "fromHook"],
  custom: ["customType", "data"], custom_message: ["customType", "content", "details", "display"],
  label: ["targetId", "label"], session_info: ["name"], context_edit: ["targetId", "replacement"],
};
const clean = (value: unknown): value is string => typeof value === "string" && !!value && value.trim() === value;

/** Root schema at f35a7ffca has chats + chat_branches, NOT an agent_sessions
 * session_id/session_file registry. session.ts derives sanitized directories and
 * continueRecent selects a file; runtime-facade saves positions only in memory.
 * Do not turn filesystem recency, a system message, or a tree leaf into a host
 * binding. Those missing facts deliberately make every existing history BLOCKED.
 * JSONL is legacy input only; this API creates no ongoing persistence format.
 */
export function inventoryLegacySources(options: {
  root: Database;
  legacySessionRoot: string;
  owner: Pick<RuntimeLockHandle, "enabled" | "strictOwnership" | "assertCurrentOwner">;
}) {
  const { root, legacySessionRoot, owner } = options;
  assert(owner.enabled && owner.strictOwnership, "Strict runtime owner required");
  const assertOwner = owner.assertCurrentOwner.bind(owner);
  const assertAutocommit = () => assert(!root.inTransaction, "Root DB transaction active; committed frontier required");
  assertAutocommit();
  assertOwner();
  assert(isAbsolute(legacySessionRoot), "Explicit absolute legacy session root required");
  const canonicalRoot = realpathSync(legacySessionRoot);
  const confined = (path: string) => {
    const canonical = realpathSync(path);
    const rel = relative(canonicalRoot, canonical);
    assert(rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), `Legacy path escape: ${path}`);
    return canonical;
  };
  // Snapshot the actual root DB, not a caller-produced reference manifest. serialize
  // also catches changes outside the registry (pending work, prompts, incarnation).
  const frontier = () => {
    assertAutocommit(); assertOwner(); assertAutocommit();
    const hash = sha(root.serialize());
    assertAutocommit();
    return hash;
  };
  const dbSHA256 = frontier();
  const chats = root.query("SELECT jid FROM chats ORDER BY jid").all() as { jid: string }[];
  const branches = root.query("SELECT * FROM chat_branches ORDER BY branch_id").all() as {
    branch_id: string; chat_jid: string; root_chat_jid: string; parent_branch_id: string | null;
  }[];
  const messageChats = root.query("SELECT DISTINCT chat_jid FROM messages ORDER BY chat_jid").all() as { chat_jid: string }[];
  const chatIds = [...new Set([...chats.map(c => c.jid), ...branches.map(b => b.chat_jid), ...messageChats.map(m => m.chat_jid)])].sort();
  assert(chatIds.every(clean), "Malformed persisted chat identity");
  assert(branches.every(b => clean(b.branch_id) && clean(b.root_chat_jid)), "Malformed persisted branch identity");
  const directoryChats = new Map<string, string[]>();
  for (const chat of chatIds) {
    const directory = chat.replace(/[^a-zA-Z0-9._-]/g, "_"); // session.ts sanitiseJid; no importing its writable bootstrap
    const matches = directoryChats.get(directory) ?? [];
    matches.push(chat); directoryChats.set(directory, matches);
  }
  const files = new Map<string, { canonicalPath: string; sourceSHA256: string; sourceBytesBase64: string;
    sourceSessionId: string; leafIds: readonly string[]; unsupportedRecords: readonly Readonly<{ recordId: string | null; type: string; reason: string }>[];
    fileStamp: string; paths: string[]; chatJids: string[] }>();
  const directories = new Map<string, { names: string; canonical: string }>();
  const listing = (dir: string) => readdirSync(dir).sort().join("\0");
  const walk = (dir: string, top: string | null, ancestors: readonly string[]) => {
    directories.set(dir, { names: listing(dir), canonical: realpathSync(dir) });
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => ordinal(a.name, b.name))) {
      const path = join(dir, entry.name), canonical = confined(path);
      const stat = statSync(canonical);
      if (stat.isDirectory()) {
        assert(!ancestors.includes(canonical), `Legacy directory cycle: ${path}`);
        walk(path, top ?? entry.name, [...ancestors, canonical]);
      } else if (entry.name.endsWith(".jsonl")) {
        assertOwner();
        const before = stamp(canonical), bytes = readFileSync(canonical);
        assert(before === stamp(canonical) && realpathSync(path) === canonical, `Legacy source changed: ${path}`);
        assertOwner();
        const sourceSHA256 = sha(bytes), sourceJSONL = bytes.toString("utf8");
        assert(Buffer.from(sourceJSONL).equals(bytes), `Invalid UTF-8: ${path}`);
        const records: unknown[] = sourceJSONL.trim().split("\n").map(line => JSON.parse(line));
        const [header, ...entries] = records as Record<string, unknown>[];
        assert(header && !Array.isArray(header) && header.type === "session" && clean(header.id) && clean(header.cwd) &&
          (header.version === undefined || (Number.isInteger(header.version) && Number(header.version) > 0)) &&
          (header.parentSession === undefined || clean(header.parentSession)) &&
          typeof header.timestamp === "string" && Number.isFinite(Date.parse(header.timestamp)), `Malformed session header: ${path}`);
        const unsupportedRecords: Readonly<{ recordId: string | null; type: string; reason: string }>[] = [];
        const unsupported = (recordId: string | null, type: string, reason: string) =>
          unsupportedRecords.push(Object.freeze({ recordId, type, reason }));
        if (header.version !== 3 || Object.keys(header).some(k => !["type", "version", "id", "timestamp", "cwd", "parentSession"].includes(k)))
          unsupported(null, "session", "Unsupported header schema/version");
        assert(entries.length, `Incomplete legacy history: ${path}`);
        const ids = new Set<string>(), parents = new Set<string>();
        for (const item of entries) {
          assert(item && typeof item === "object" && !Array.isArray(item) && clean(item.type) && clean(item.id) &&
            typeof item.timestamp === "string" && Number.isFinite(Date.parse(item.timestamp)) && !ids.has(item.id) &&
            (item.parentId === null || (clean(item.parentId) && ids.has(item.parentId))), `Malformed legacy tree: ${path}`);
          const fields = Object.hasOwn(entryFields, item.type) ? entryFields[item.type] : undefined;
          if (!fields || Object.keys(item).some(k => !["type", "id", "parentId", "timestamp", ...(fields ?? [])].includes(k)))
            unsupported(item.id, item.type, "Unsupported record kind/fields");
          if (item.type === "message") {
            const message = item.message as Record<string, unknown>;
            assert(message && typeof message === "object" && !Array.isArray(message) && clean(message.role) &&
              typeof message.timestamp === "number" && Number.isFinite(message.timestamp), `Malformed legacy message: ${path}`);
            if (["user", "assistant", "system", "toolResult", "custom"].includes(message.role as string)) {
              assert(typeof message.content === "string" || Array.isArray(message.content), `Malformed legacy message: ${path}`);
            } else if (message.role === "bashExecution") {
              assert(typeof message.command === "string" && typeof message.output === "string" &&
                typeof message.cancelled === "boolean" && typeof message.truncated === "boolean" &&
                (message.exitCode === undefined || (typeof message.exitCode === "number" && Number.isFinite(message.exitCode))), `Malformed legacy message: ${path}`);
            } else if (message.role === "branchSummary" || message.role === "compactionSummary") {
              assert(typeof message.summary === "string", `Malformed legacy message: ${path}`);
            } else unsupported(item.id, item.type, `Unsupported message role: ${message.role}`);
          }
          if (item.parentId) parents.add(item.parentId as string);
          ids.add(item.id);
        }
        const associated = top ? directoryChats.get(top) ?? [] : [];
        const prior = files.get(canonical);
        if (prior) {
          assert(prior.sourceSHA256 === sourceSHA256 && prior.fileStamp === before, `Legacy source changed: ${path}`);
          prior.paths.push(path); prior.chatJids.push(...associated);
        } else files.set(canonical, { canonicalPath: canonical, sourceSHA256, sourceBytesBase64: bytes.toString("base64"),
          sourceSessionId: header.id as string, leafIds: Object.freeze([...ids].filter(id => !parents.has(id))),
          unsupportedRecords: Object.freeze(unsupportedRecords), fileStamp: before, paths: [path], chatJids: [...associated] });
      }
    }
  };
  walk(canonicalRoot, null, [canonicalRoot]);
  const sources = Object.freeze([...files.values()].map(file => Object.freeze({ ...file,
    paths: Object.freeze(file.paths), chatJids: Object.freeze([...new Set(file.chatJids)]) })));
  const references = Object.freeze(chatIds.map(chatJid => Object.freeze({
    chatJid, branchId: branches.find(b => b.chat_jid === chatJid)?.branch_id ?? null,
    persistedBranch: branches.some(b => b.chat_jid === chatJid) ? Object.freeze({ ...branches.find(b => b.chat_jid === chatJid)! }) : null,
    // Deliberate nulls: source header ID is NOT a persisted host session reference.
    sessionId: null, incarnation: null, persistedLeafId: null, hostBaseline: null,
    sourcePaths: Object.freeze(sources.filter(s => s.chatJids.includes(chatJid)).map(s => s.canonicalPath)),
    classification: sources.some(s => s.chatJids.includes(chatJid)) ? "existing-history" :
      messageChats.some(m => m.chat_jid === chatJid) ? "missing-history" : "existing-empty-unproven",
    reasons: Object.freeze([
      "Root DB has no persisted source session/file reference, leaf position, chat incarnation or host baseline binding",
      ...(!branches.some(b => b.chat_jid === chatJid) ? ["Missing persisted branch registry row"] : []),
      ...(!sources.some(s => s.chatJids.includes(chatJid)) ? ["No legacy source file; cannot prove this existing chat is new/empty"] : []),
      ...((directoryChats.get(chatJid.replace(/[^a-zA-Z0-9._-]/g, "_"))?.length ?? 0) > 1 ? ["Sanitized legacy directory aliases multiple chats"] : []),
    ]),
  })));
  // Candidate journal/SDK writes legitimately change the whole database after
  // preflight. Retain a separate read-only source check for the owned upgrade.
  const revalidateSources = () => {
    assertAutocommit();
    assertOwner();
    assert(realpathSync(legacySessionRoot) === canonicalRoot, "Legacy root changed");
    for (const [dir, captured] of directories) {
      assert(realpathSync(dir) === captured.canonical, `Legacy directory path changed: ${dir}`);
      assert(listing(dir) === captured.names, `Legacy directory changed: ${dir}`);
    }
    for (const source of sources) {
      for (const path of source.paths) assert(confined(path) === source.canonicalPath, "Legacy source path changed");
      const before = stamp(source.canonicalPath), bytes = readFileSync(source.canonicalPath);
      assert(before === source.fileStamp && stamp(source.canonicalPath) === before && sha(bytes) === source.sourceSHA256,
        `Legacy source changed: ${source.canonicalPath}`);
    }
    assertOwner();
    assertAutocommit();
  };
  const revalidate = () => {
    assert(frontier() === dbSHA256, "Root DB frontier changed");
    revalidateSources();
    assert(frontier() === dbSHA256, "Root DB frontier changed");
  };
  revalidate();
  return Object.freeze({ status: "BLOCKED" as const, preparable: false as const, dbSHA256, sources, references,
    unboundSourcePaths: Object.freeze(sources.filter(s => !s.chatJids.length).map(s => s.canonicalPath)), revalidate, revalidateSources });
}
