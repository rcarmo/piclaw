/**
 * web/handlers/turn-activity.ts – read the "Worked for …" log of one agent reply.
 *
 * GET /agent/turn-activity?chat_jid&message_id[&step&offset]
 * message_id is the reply's timeline row id, as for /agent/thinking. The stored
 * reply's native-answer id names its committed answer entry; the agent pool
 * reads that turn's committed window from the durable runtime. Responses are a
 * bounded projection (list) or one paged step (detail). Any lookup failure is a
 * uniform 404, so message ids cannot be probed across chats.
 *
 * Consumers: http/dispatch-agent.ts.
 */

import { getAgentMessageIdByRowId } from "../../../db/messages.js";
import type { DurableTurnEntries } from "../../../agent-pool/durable-runtime-adapter.js";
import { projectTurnActivity, projectTurnStepDetail } from "../agent/turn-activity.js";

export interface TurnActivityReader {
  getTurnEntriesForChat?(chatJid: string, answerEntryId: number): Promise<DurableTurnEntries | null>;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

/** `native-answer:<incarnation>:<conversation>:<answer entry>` → answer entry id. */
export function answerEntryIdFromMessageId(messageId: string): number | null {
  const match = /^native-answer:[^:]+:\d+:(\d+)$/.exec(messageId);
  const id = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function handleTurnActivity(pool: TurnActivityReader | undefined, url: URL): Promise<Response> {
  const chatJid = url.searchParams.get("chat_jid");
  const messageId = url.searchParams.get("message_id");
  if (!chatJid || !messageId) return json({ error: "Missing message_id or chat_jid" }, 400);
  const storedId = /^\d+$/.test(messageId) ? getAgentMessageIdByRowId(chatJid, Number(messageId)) : null;
  const answerEntryId = storedId === null ? null : answerEntryIdFromMessageId(storedId);
  if (answerEntryId === null || !pool?.getTurnEntriesForChat) {
    return json({ error: "Not found" }, 404);
  }
  let turn: DurableTurnEntries | null;
  try {
    turn = await pool.getTurnEntriesForChat(chatJid, answerEntryId);
  } catch {
    return json({ error: "Not found" }, 404);
  }
  if (!turn) return json({ error: "Not found" }, 404);
  const step = url.searchParams.get("step");
  if (!step) return json(projectTurnActivity(turn, answerEntryId));
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const detail = projectTurnStepDetail(turn, step, Number.isSafeInteger(offset) && offset > 0 ? offset : 0);
  return detail ? json(detail) : json({ error: "Not found" }, 404);
}
