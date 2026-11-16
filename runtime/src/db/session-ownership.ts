import type Database from "bun:sqlite";

import type { AuthenticatedPrincipal, AccessAction } from "../core/access-types.js";
import { getUser } from "./users.js";

interface BranchRow {
  branch_id: string;
  chat_jid: string;
  root_chat_jid: string;
  parent_branch_id: string | null;
  archived_at: string | null;
}

export interface RootOwnership {
  rootBranchId: string;
  rootChatJid: string;
  ownerUserId: string;
  policy: "private";
}

export class ChatAccessDenied extends Error {
  readonly status = 403;
  constructor() { super("Session access denied."); }
}

/** No ownership is inferred or assigned at schema creation time. */
export function initializeSessionOwnershipSchema(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS session_roots (
      root_branch_id TEXT PRIMARY KEY REFERENCES chat_branches(branch_id),
      owner_user_id TEXT NOT NULL REFERENCES users(id),
      policy TEXT NOT NULL DEFAULT 'private' CHECK (policy = 'private'),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_session_roots_owner ON session_roots(owner_user_id);
    CREATE TRIGGER IF NOT EXISTS session_root_owner_immutable
      BEFORE UPDATE OF root_branch_id, owner_user_id ON session_roots
      WHEN NEW.root_branch_id != OLD.root_branch_id OR NEW.owner_user_id != OLD.owner_user_id
      BEGIN SELECT RAISE(ABORT, 'Session root ownership is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS session_home_root_no_archive
      BEFORE UPDATE OF archived_at ON chat_branches
      WHEN NEW.archived_at IS NOT NULL AND EXISTS (
        SELECT 1 FROM session_roots r JOIN users u ON u.id = r.owner_user_id
        WHERE r.root_branch_id = OLD.branch_id AND u.home_chat_jid = OLD.chat_jid
      )
      BEGIN SELECT RAISE(ABORT, 'Assign another owned home root before archiving'); END;
    CREATE TRIGGER IF NOT EXISTS session_home_follows_root_jid
      AFTER UPDATE OF chat_jid ON chat_branches WHEN NEW.chat_jid != OLD.chat_jid
      BEGIN
        UPDATE users SET home_chat_jid = NEW.chat_jid
        WHERE home_chat_jid = OLD.chat_jid AND id IN (
          SELECT owner_user_id FROM session_roots WHERE root_branch_id = OLD.branch_id
        );
      END;
    CREATE TRIGGER IF NOT EXISTS session_owned_branch_no_delete
      BEFORE DELETE ON chat_branches WHEN EXISTS (
        SELECT 1 FROM session_roots WHERE root_branch_id = OLD.branch_id
      )
      BEGIN SELECT RAISE(ABORT, 'Owned root deletion requires explicit ownership cleanup'); END;
  `);
}

function branchForChat(database: Database, chatJid: string): BranchRow | null {
  return database.query(`SELECT branch_id, chat_jid, root_chat_jid, parent_branch_id, archived_at
    FROM chat_branches WHERE chat_jid = ?`).get(chatJid) as BranchRow | null;
}

/** Validate the authoritative parent chain; JID prefixes never establish ownership. */
function rootForBranch(database: Database, leaf: BranchRow, allowArchived = false): BranchRow {
  const seen = new Set<string>();
  let row = leaf;
  for (;;) {
    if (seen.has(row.branch_id) || row.root_chat_jid !== leaf.root_chat_jid || (!allowArchived && row.archived_at)) throw new ChatAccessDenied();
    seen.add(row.branch_id);
    if (!database.query("SELECT 1 FROM chats WHERE jid = ?").get(row.chat_jid)) throw new ChatAccessDenied();
    if (!row.parent_branch_id) {
      if (row.chat_jid !== leaf.root_chat_jid) throw new ChatAccessDenied();
      return row;
    }
    const parent = database.query(`SELECT branch_id, chat_jid, root_chat_jid, parent_branch_id, archived_at
      FROM chat_branches WHERE branch_id = ?`).get(row.parent_branch_id) as BranchRow | null;
    if (!parent) throw new ChatAccessDenied();
    row = parent;
  }
}

export function getRootOwnership(database: Database, chatJid: string, allowArchived = false): RootOwnership | null {
  const branch = branchForChat(database, chatJid);
  if (!branch) return null;
  const root = rootForBranch(database, branch, allowArchived);
  const ownership = database.query("SELECT owner_user_id, policy FROM session_roots WHERE root_branch_id = ?").get(root.branch_id) as { owner_user_id: string; policy: string } | null;
  if (!ownership) return null;
  if (ownership.policy !== "private") throw new ChatAccessDenied();
  return { rootBranchId: root.branch_id, rootChatJid: root.chat_jid, ownerUserId: ownership.owner_user_id, policy: "private" };
}

/** Internal provisioning boundary. The caller must authorise administration first. */
export function assignRootOwner(database: Database, rootChatJid: string, ownerUserId: string): RootOwnership {
  return database.transaction(() => {
    if (!getUser(database, ownerUserId)) throw new ChatAccessDenied();
    const branch = branchForChat(database, rootChatJid);
    if (!branch || rootForBranch(database, branch, true).branch_id !== branch.branch_id) throw new ChatAccessDenied();
    const existing = getRootOwnership(database, rootChatJid, true);
    if (existing) {
      if (existing.ownerUserId !== ownerUserId) throw new ChatAccessDenied();
      return existing;
    }
    database.query("INSERT INTO session_roots(root_branch_id,owner_user_id,policy,created_at) VALUES (?,?,'private',?)")
      .run(branch.branch_id, ownerUserId, new Date().toISOString());
    return getRootOwnership(database, rootChatJid, true)!;
  }).immediate();
}

/** Assign an already registered root and home together; retry preserves owner and timestamps. */
export function provisionUserHome(database: Database, userId: string, rootChatJid: string): RootOwnership {
  return database.transaction(() => {
    const user = getUser(database, userId);
    const root = branchForChat(database, rootChatJid);
    if (!user || !root || root.archived_at) throw new ChatAccessDenied();
    const ownership = assignRootOwner(database, rootChatJid, userId);
    if (user.home_chat_jid !== rootChatJid) database.query("UPDATE users SET home_chat_jid = ?, updated_at = ? WHERE id = ?")
      .run(rootChatJid, new Date().toISOString(), userId);
    return ownership;
  }).immediate();
}

/** Revalidate live user and ownership before returning a target; no hydration or silent redirection. */
export function resolveAuthorisedChat(
  database: Database,
  principal: AuthenticatedPrincipal,
  requestedChatJid: string | undefined,
  action: AccessAction,
): RootOwnership & { chatJid: string } {
  if (requestedChatJid !== undefined && !requestedChatJid.trim()) throw new ChatAccessDenied();
  const user = getUser(database, principal.userId);
  if (!user?.enabled || user.role !== principal.role) throw new ChatAccessDenied();
  const chatJid = requestedChatJid ?? user.home_chat_jid;
  if (!chatJid) throw new ChatAccessDenied();
  const ownership = getRootOwnership(database, chatJid);
  if (!ownership || ownership.ownerUserId !== principal.userId
    || !["session.read", "session.write", "session.fork", "session.rename", "session.archive"].includes(action)) {
    throw new ChatAccessDenied();
  }
  return { ...ownership, chatJid };
}
