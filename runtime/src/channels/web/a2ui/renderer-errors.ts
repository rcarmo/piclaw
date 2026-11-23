import type { Database } from 'bun:sqlite';
import type { ErrorMessage } from '@a2ui/web_core/v1_0';

const REPORT_TTL_MS = 5 * 60_000;
export const A2UI_ERROR_TEXT = {
  EXPRESSION_ERROR:'The agent function did not complete.',
  EXECUTION_ERROR:'The renderer could not execute the action.',
  INTEGRITY_ERROR:'The renderer could not reconstruct the surface.',
  INVALID_FUNCTION_CALL:'The renderer rejected the function call.',
  VALIDATION_FAILED:'The renderer rejected the surface definition.',
  UNALLOWED_PARENT:'The renderer rejected the component parent.',
  UNALLOWED_CHILD:'The renderer rejected the component child.',
} as const;

/** Store only the scrubbed wire envelope, with an expiring receipt even after delivery. */
export function enqueueA2uiRendererError(db: Database, chat: string, conversation: number, messageId: string, revision: number, message: ErrorMessage): boolean {
  if (!db.inTransaction) throw Error('Renderer error requires the owned surface transaction');
  const now=Date.now();
  const wire=JSON.stringify(message);
  db.query('DELETE FROM a2ui_renderer_errors WHERE expires_at<=?').run(now);
  if (db.query(`SELECT 1 FROM a2ui_renderer_errors
    WHERE chat_jid=? AND conversation_id=? AND message_id=? AND revision=? AND envelope=?`)
    .get(chat,conversation,messageId,revision,wire)) return true;
  const counts=db.query(`SELECT count(*) AS total,
    count(CASE WHEN chat_jid=? AND conversation_id=? THEN 1 END) AS owned FROM a2ui_renderer_errors`)
    .get(chat,conversation) as {total:number;owned:number};
  if (counts.total>=256 || counts.owned>=16) return false;
  db.query(`INSERT INTO a2ui_renderer_errors (chat_jid,conversation_id,message_id,revision,envelope,expires_at)
    VALUES (?,?,?,?,?,?)`).run(chat,conversation,messageId,revision,wire,now+REPORT_TTL_MS);
  return true;
}

/** Inclusion and acknowledgement roll back with the accepted native input. No new turn is created. */
export function takeA2uiRendererErrors(db: Database, chat: string, conversation: number, budget = Infinity): ErrorMessage[] {
  if (!db.inTransaction) throw Error('Renderer error delivery requires the source admission transaction');
  const rows=db.query(`SELECT rowid,envelope FROM a2ui_renderer_errors WHERE chat_jid=? AND conversation_id=?
    AND delivered=0 AND expires_at>? ORDER BY rowid LIMIT 8`).all(chat,conversation,Date.now()) as {rowid:number;envelope:string}[];
  const accept=db.query('UPDATE a2ui_renderer_errors SET delivered=1 WHERE rowid=?');
  const messages: ErrorMessage[]=[];
  for (const row of rows) {
    budget-=Buffer.byteLength(row.envelope)+1;
    if (budget<0) break; // Keep older reports pending if this input is already large.
    accept.run(row.rowid);
    messages.push(JSON.parse(row.envelope) as ErrorMessage);
  }
  return messages;
}
