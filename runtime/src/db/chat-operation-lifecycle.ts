import { getDb } from "./connection.js";

/** Explicit chat destruction hook; callers delete the cursor only after this returns. */
export function deleteChatOperationLifecycleState(chatJid: string): void {
  const db = getDb();
  const apply = () => {
    db.prepare(`DELETE FROM chat_goal_continuation_intents WHERE continuation_source_seq IN
      (SELECT source_seq FROM chat_accepted_sources WHERE chat_jid = ?)
      OR intent_source_seq IN (SELECT source_seq FROM chat_accepted_sources WHERE chat_jid = ?)`)
      .run(chatJid, chatJid);
    db.prepare("DELETE FROM chat_operation_dispositions WHERE chat_jid = ?").run(chatJid);
    db.prepare("DELETE FROM chat_accepted_sources WHERE chat_jid = ?").run(chatJid);
    db.prepare(`UPDATE chat_cursors SET operation_id = NULL, operation_source_seq = NULL,
      operation_phase = NULL, operation_generation = NULL, operation_cancel_cause = NULL,
      operation_cancel_requested_at = NULL WHERE chat_jid = ?`).run(chatJid);
  };
  if (db.inTransaction) apply();
  else db.transaction(apply).immediate();
}
