import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import type { Database } from "bun:sqlite";
import { apply } from "@earendil-works/chord/delta";
import { parseVisibleContentBlocks } from "../../src/db/messages.js";
import type { NativeSessionTarget } from "./host-application-input.js";
/** Static resources are registered ONLY by the qualified public resourceLoader. */
export interface NativeResourceDescriptor {
  readonly id: string;
  readonly version: 1;
  readonly factoryExport?: string;
  readonly registration: "public-resource-loader";
  readonly webEntries: readonly string[];
  readonly skillPaths: readonly string[];
  readonly routes: readonly string[];
  readonly settingsActions: readonly string[];
}
export function qualifyNativeResources(id: string, value: NativeResourceDescriptor) {
  if (value.id !== id || value.version !== 1 || value.registration !== "public-resource-loader") throw new Error("Invalid resource descriptor");
  for (const path of [...value.webEntries, ...value.skillPaths]) {
    if (!path || path.startsWith("/") || path.split(/[\\/]/).includes("..")) throw new Error("Invalid resource path");
  }
  return Object.freeze({ ...value, webEntries: Object.freeze([...value.webEntries]), skillPaths: Object.freeze([...value.skillPaths]),
    routes: Object.freeze([...value.routes]), settingsActions: Object.freeze([...value.settingsActions]) });
}
export interface ResourceDashboardScope { ownerId: string; authScope: string }
export interface ResourceDashboardRow {
  conversationId: string; chatJid: string; agentName?: string; updatedAt: string | null;
  messageCount: number; latestOutput?: string; latestBlocks?: string;
  sessionId?: string; usage?: unknown | null; tasks?: readonly {id: number; status: string}[];
  history?: { rootChatJid?: string; branchId?: string; archivedAt?: string };
}
/** Reads only the passed application Root. Routes are native application authority,
 * not inferred from historical session copies or chat naming conventions. */
export function createRootDashboardReader(options: {
  root: Database;
  scope: ResourceDashboardScope;
  isCurrent(): boolean;
  sessionTargets(): { list(): readonly NativeSessionTarget[]; resolve(target: NativeSessionTarget): NativeSessionTarget };
  canReadTarget(scope: ResourceDashboardScope, target: NativeSessionTarget): boolean;
}) {
  const scope = Object.freeze({ ...options.scope });
  if (!scope.ownerId || !scope.authScope) throw new Error("Root owner/auth scope required");
  const check = (request: ResourceDashboardScope & { limit: number }) => {
    if (!options.isCurrent() || request.ownerId !== scope.ownerId || request.authScope !== scope.authScope ||
        !Number.isInteger(request.limit) || request.limit < 1 || request.limit > 12) throw new Error("Root dashboard scope/options rejected");
  };
  function usage(conversationId: number): unknown | null {
    const docs = options.root.query(`SELECT id FROM documents WHERE kind='"pi.usage"'
      AND scope_kind='conversation' AND owner_id=? AND retired_at IS NULL`).all(conversationId) as { id: number }[];
    if (docs.length > 1) throw Error("Ambiguous Root usage document");
    if (!docs.length) return null; // absent telemetry is unknown, not zero spend
    let value: any;
    for (const revision of options.root.query("SELECT kind,version,content FROM document_revisions WHERE document_id=? ORDER BY seq").all(docs[0]!.id) as {kind: string; version: number; content: string}[]) {
      if (revision.version !== 1) throw Error("Unsupported Root usage version");
      if (revision.kind === "base") value = JSON.parse(revision.content);
      else if (revision.kind === "delta" && value) value = apply(value, JSON.parse(revision.content));
      else throw Error("Invalid Root usage revision");
    }
    if (!value) throw Error("Missing Root usage revision");
    return value;
  }
  return Object.freeze({ read: async (request: ResourceDashboardScope & { limit: number }) => {
    const accepted = { ownerId: request.ownerId, authScope: request.authScope, limit: request.limit };
    check(accepted);
    return options.root.transaction(() => {
      const targets = options.sessionTargets();
      const rows = targets.list().filter(target => options.canReadTarget(scope, target)).map(target => {
        check(accepted); targets.resolve(target);
        if (!options.root.query("SELECT 1 FROM conversations WHERE id=?").get(target.conversationId)) throw Error("Missing native conversation");
        const branch = options.root.query("SELECT agent_name,root_chat_jid,branch_id,archived_at FROM chat_branches WHERE chat_jid=? AND branch_id=?").get(target.chatJid, target.branchId) as any;
        if (!branch) throw Error("Native branch mapping changed");
        const timeline = options.root.query("SELECT count(*) AS count,max(timestamp) AS updated FROM messages WHERE chat_jid=?").get(target.chatJid) as {count: number; updated: string | null};
        const candidates = options.root.query<{content: string | null; content_blocks: string | null}, [string]>(
          `SELECT content,content_blocks FROM messages WHERE chat_jid=?
          AND (coalesce(trim(content),'')<>'' OR coalesce(trim(content_blocks),'')<>'')
          ORDER BY (is_bot_message=1 OR is_terminal_agent_reply=1 OR lower(coalesce(sender,'')) IN ('assistant','agent')) DESC,
          datetime(timestamp) DESC,rowid DESC`).iterate(target.chatJid);
        let latestOutput: string | undefined, latestBlocks: string | undefined;
        for (const candidate of candidates) {
          const blocks = parseVisibleContentBlocks(candidate.content_blocks);
          if (!candidate.content?.trim() && !blocks?.length) continue;
          latestOutput = candidate.content || undefined;
          latestBlocks = blocks?.length ? JSON.stringify(blocks) : undefined;
          break;
        }
        const tasks = options.root.query("SELECT id,status FROM tasks WHERE conversation_id=? ORDER BY id").all(target.conversationId) as {id: number; status: string}[];
        const row = { conversationId: String(target.conversationId), sessionId: target.sessionId, chatJid: target.chatJid,
          agentName: branch.agent_name, updatedAt: timeline.updated, messageCount: timeline.count,
          latestOutput, latestBlocks,
          history: { rootChatJid: branch.root_chat_jid || undefined, branchId: target.branchId, archivedAt: branch.archived_at || undefined },
          usage: usage(target.conversationId), tasks };
        check(accepted); targets.resolve(target);
        if (!options.canReadTarget(scope, target)) throw Error("Dashboard target authorization changed");
        return row;
      });
      check(accepted);
      return rows.sort((a,b) => (b.updatedAt || "").localeCompare(a.updatedAt || "") || a.chatJid.localeCompare(b.chatJid)).slice(0, accepted.limit);
    })();
  } });
}

/** Source-qualified declaration: parent can bind the actual exported service factory.
 * Resolves only caller-selected installed source; no catalog or default registration. */
export async function qualifyNativeResourceSource(id: string, moduleUrl: URL) {
  if (moduleUrl.protocol !== "file:") throw Error("Local resource source required");
  const source = fileURLToPath(moduleUrl);
  const exports = await import(source);
  const descriptor = qualifyNativeResources(id, exports.nativeResources);
  for (const path of [...descriptor.webEntries, ...descriptor.skillPaths]) {
    if (!(await Bun.file(resolve(dirname(source), path)).exists())) throw Error("Missing resource source: " + path);
  }
  const factory = descriptor.factoryExport ? exports[descriptor.factoryExport] : undefined;
  if (descriptor.settingsActions.length && typeof factory !== "function") throw Error("Resource settings factory required");
  return Object.freeze({ descriptor, moduleUrl: moduleUrl.href, factory });
}
