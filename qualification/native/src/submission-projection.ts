import type { Database } from 'bun:sqlite';

/** Test-only observer of SDK terminal evidence and the host timeline projection.
 * Never submits, retries, resumes or settles execution. */
export async function waitForSubmissionProjection(root: Database, id: number, chat: string, priorBotCount: number) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const row = root.query('SELECT status FROM submissions WHERE id=?').get(id) as {status:string}|null;
    const replies = root.query('SELECT count(*) n FROM messages WHERE chat_jid=? AND is_bot_message=1').get(chat) as {n:number};
    if (row && ['done','unanswered'].includes(row.status) && replies.n > priorBotCount) return row.status;
    await Bun.sleep(10);
  }
  throw Error(`SDK submission ${id} terminal result/projection unavailable`);
}
