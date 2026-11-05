import type { Database } from 'bun:sqlite';

/** Correlation lookup only. The existing binding port still verifies the input
 * hash and current source authority before accepting these SDK-owned bytes. */
export const acceptedPayloadRecoverySql = `SELECT e.record,b.conversation_id,b.operation_id,b.source_seq,b.branch_id,b.request_id,b.request_hash
  FROM piclaw_durable_bindings_v1 b JOIN submissions s ON s.id=b.submission_id
  JOIN entries e ON e.id=json_extract(s.record,'$.entry')
  WHERE b.chat_jid=? AND b.source_id=? AND b.payload_ref=? AND b.incarnation=?`;

const acceptedIntentPayloadRecoverySql = `SELECT e.record,b.conversation_id,b.operation_id,b.source_seq,b.branch_id,b.request_id,b.request_hash
  FROM piclaw_durable_intent_bindings_v1 b JOIN submissions s ON s.id=b.submission_id
  JOIN entries e ON e.id=json_extract(s.record,'$.entry')
  WHERE b.chat_jid=? AND b.source_id=? AND b.payload_ref=? AND b.incarnation=?`;

/** Existing projection selection and SDK fallback; callers fence ownership and
 * the binding port checks the returned bytes against the accepted request hash. */
export function readApplicationMessagePayload(root: Database, incarnation: string,
  input: { chatJid: string; sourceId: string }, ref: string): string {
  const row = (/^message-row:[1-9][0-9]*$/.test(ref)
    ? root.query("SELECT id, content FROM messages WHERE rowid=? AND chat_jid=?").get(Number(ref.slice(12)), input.chatJid)
    : ref === `queued-source:${input.sourceId}`
      ? root.query("SELECT id, content FROM messages WHERE id=? AND chat_jid=?").get(input.sourceId, input.chatJid) : null) as { id: string; content: string } | null;
  if (row?.id === input.sourceId) return row.content;
  // Mutable/missing projections cannot replace the SDK accepted payload.
  // Steering acceptance uses the intent binding, not the primary binding.
  // Read only SDK-accepted bytes and reject ambiguous correlations.
  const params = [input.chatJid, input.sourceId, ref, incarnation];
  const matches = [
    ...root.query(acceptedPayloadRecoverySql).all(...params),
    ...root.query(acceptedIntentPayloadRecoverySql).all(...params),
  ] as { record: string; conversation_id: number; operation_id: string; source_seq: number;
    branch_id: string; request_id: string; request_hash: string;
  }[];
  if (matches.length !== 1) throw Error('Unverified application payload');
  const saved = matches[0]!;
  const entry = JSON.parse(saved.record), host = entry.data, user = entry.model;
  if (entry.kind !== 'host.accepted' || entry.conversationId !== saved.conversation_id ||
    host?.incarnation !== incarnation || host.chatJid !== input.chatJid || host.branchId !== saved.branch_id ||
    host.operationId !== saved.operation_id || host.sourceSeq !== saved.source_seq || host.sourceId !== input.sourceId || host.payloadRef !== ref ||
    host.requestId !== saved.request_id || host.requestHash !== saved.request_hash ||
    !Array.isArray(user) || user.length !== 1 || user[0]?.role !== 'user' || typeof user[0].content !== 'string') throw Error('Unverified SDK accepted payload');
  return user[0].content;
}
