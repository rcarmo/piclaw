import type Database from "bun:sqlite";

const exists = (db: Database, name: string) => !!db.query("SELECT 1 FROM main.sqlite_schema WHERE type='table' AND name=?").get(name);

type NativeControlGuard = (chats: readonly string[]) => undefined;
const controlGuards = new WeakMap<Database, Set<{ assert: NativeControlGuard }>>();
/** The live owner exposes its existing command activity, not a second activity
 * ledger. Keep a failed/uncertain closing owner registered until cleanup succeeds. */
export function registerNativeBranchControlGuard(db: Database, guard: NativeControlGuard): () => void {
  const guards = controlGuards.get(db) ?? new Set<{ assert: NativeControlGuard }>();
  const entry = { assert: guard };
  controlGuards.set(db, guards); guards.add(entry);
  return () => { guards.delete(entry); };
}

/** A conservative host-policy fence, never a conversation resolver. The private
 * SDK manifest alone selects routes; no SDK delta/runtime crosses into Core. */
export function hasNativeRouting(db: Database): boolean {
  return exists(db, "piclaw_durable_bindings_v1") || hasNativeApplicationManifest(db);
}
function hasNativeApplicationManifest(db: Database): boolean {
  return exists(db, "documents") && !!db.query(`SELECT 1 FROM main.documents
    WHERE kind='"app.application-conversations"' AND scope_kind='conversation' AND owner_id=1 AND retired_at IS NULL`).get();
}

/** A new host root is metadata only; the live native owner separately allocates
 * its SDK context on admission. Keep metadata creation in the same SQL frame. */
export function assertNativeRootCreation(db: Database): void {
  if (!db.inTransaction || !hasNativeApplicationManifest(db)) throw Error("Native root creation requires its owner transaction");
  const guards = controlGuards.get(db);
  if (!guards?.size) throw Error("Native routing owner unavailable for root creation");
  for (const guard of guards) guard.assert([]);
}

/** Native addresses/branch identities are immutable. Friendly handle rename is
 * supported separately. Legacy address moves/forks cannot publish native IDs. */
export function requireLegacyRoutingMutation(db: Database, operation: string): void {
  if (hasNativeRouting(db)) throw Error(`Native routing identities are immutable; ${operation} requires a supported native lifecycle. Rename the session handle instead.`);
}

/** Archive changes host admission policy while retaining the immutable binding.
 * All reads and the eventual metadata write must share the caller's SQL frame.
 * Creation anchors/bindings are used only to over-protect live scope, never to
 * choose a route or replace missing/conflicting manifest authority. */
export function assertNativeBranchPolicyIdle(db: Database, branchId: string): void {
  if (!hasNativeRouting(db)) return;
  if (!db.inTransaction) throw Error("Native branch policy requires an owner transaction");
  if (!hasNativeApplicationManifest(db)) throw Error("Native archive policy is unavailable for this imported routing profile");
  const branches = db.query(`WITH RECURSIVE scope(branch_id,chat_jid) AS (
    SELECT branch_id,chat_jid FROM main.chat_branches WHERE branch_id=?
    UNION SELECT b.branch_id,b.chat_jid FROM main.chat_branches b JOIN scope s ON b.parent_branch_id=s.branch_id
  ) SELECT branch_id,chat_jid FROM scope`).all(branchId) as { branch_id: string; chat_jid: string }[];
  if (!branches.length) throw Error("Native branch policy target missing");
  const chats = Object.freeze(branches.map(b => b.chat_jid)), ids = branches.map(b => b.branch_id);
  const guards = controlGuards.get(db);
  if (!guards?.size) throw Error("Native routing owner unavailable for branch policy");
  for (const guard of guards) guard.assert(chats);
  const chatMarks = chats.map(() => "?").join(","), branchMarks = ids.map(() => "?").join(",");
  for (const [table, predicate] of [
    ["service_effect_s01_chats", "active_operation_id IS NOT NULL"],
    ["service_effect_s01_operations", "phase<>'terminal'"],
    ["service_effect_s01_sources", "state NOT IN ('consumed','disposed')"],
    ["service_effect_s01_queued_inputs", "state NOT IN ('consumed','disposed')"],
  ] as const) {
    if (!exists(db, table)) throw Error("Native branch policy authority is incomplete");
    if (db.query(`SELECT 1 FROM main.${table} WHERE chat_jid IN (${chatMarks}) AND ${predicate} LIMIT 1`).get(...chats))
      throw Error("Native branch has accepted, queued or uncertain work");
  }
  const conversations = new Set<number>();
  // Immutable base anchors may also be inherited by operation forks. Include
  // every match conservatively; a first/parent/default match is never selected.
  const anchors = db.query(`SELECT d.owner_id FROM main.documents d JOIN main.document_revisions r ON r.document_id=d.id
    WHERE d.kind='"app.application-identity"' AND d.scope_kind='conversation' AND d.retired_at IS NULL AND r.kind='base'
      AND json_extract(r.content,'$.branchId') IN (${branchMarks})`).all(...ids) as { owner_id: number }[];
  for (const row of anchors) conversations.add(row.owner_id);
  for (const table of ["piclaw_durable_bindings_v1", "piclaw_durable_intent_bindings_v1"]) {
    if (exists(db, table)) for (const row of db.query(`SELECT conversation_id FROM main.${table} WHERE branch_id IN (${branchMarks})`).all(...ids) as { conversation_id: number }[])
      conversations.add(row.conversation_id);
  }
  if (conversations.size) {
    const values = [...conversations], marks = values.map(() => "?").join(",");
    // Walk ancestors of live tasks by conversation PK, rather than scanning the
    // entire retained fork history under a synchronous host writer lock.
    const busy = db.query(`WITH RECURSIVE scope(id) AS (
      SELECT conversation_id FROM main.tasks WHERE status<>'terminal'
      UNION SELECT c.owner_conversation_id FROM main.conversations c JOIN scope s ON c.id=s.id WHERE c.owner_conversation_id IS NOT NULL
      UNION SELECT json_extract(c.record,'$.parent.conversationId') FROM main.conversations c JOIN scope s ON c.id=s.id
        WHERE json_extract(c.record,'$.parent.conversationId') IS NOT NULL
    ) SELECT 1 FROM scope WHERE id IN (${marks}) LIMIT 1`).get(...values);
    if (busy) throw Error("Native branch has live SDK work");
  }
}
