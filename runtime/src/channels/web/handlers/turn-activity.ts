/**
 * web/handlers/turn-activity.ts – read the "Worked for …" log of one agent reply.
 *
 * GET /agent/turn-activity?chat_jid&message_id[&step&offset]
 * GET /agent/turn-activity?chat_jid&live=1[&step&offset] reads the running turn.
 * Adding `image=<n>` to a tool step returns a WebP preview of the n-th image
 * that tool returned to the model, stored with the reply (see
 * media/tool-image-thumbnails.ts); the running turn's previews are not kept.
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
import { projectTurnActivity, projectTurnStepDetail, toolResultFor, toolResultImage } from "../agent/turn-activity.js";
import { renderToolImageThumbnail, storedToolImageThumbnail } from "../media/tool-image-thumbnails.js";
import { emittedToolOutput } from "../agent/tool-presentation.js";

export interface TurnActivityReader {
  getTurnEntriesForChat?(chatJid: string, answerEntryId?: number): Promise<DurableTurnEntries | null>;
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
  const live = url.searchParams.get("live") === "1";
  if (!chatJid || (!messageId && !live)) return json({ error: "Missing message_id or chat_jid" }, 400);
  let answerEntryId: number | null = null;
  if (!live) {
    const storedId = /^\d+$/.test(messageId!) ? getAgentMessageIdByRowId(chatJid, Number(messageId)) : null;
    answerEntryId = storedId === null ? null : answerEntryIdFromMessageId(storedId);
    if (answerEntryId === null) return json({ error: "Not found" }, 404);
  }
  if (!pool?.getTurnEntriesForChat) return json({ error: "Not found" }, 404);
  let turn: DurableTurnEntries | null;
  try {
    turn = await pool.getTurnEntriesForChat(chatJid, answerEntryId ?? undefined);
  } catch {
    return json({ error: "Not found" }, 404);
  }
  if (!turn) return json({ error: "Not found" }, 404);
  const step = url.searchParams.get("step");
  if (!step) return json(projectTurnActivity(turn, answerEntryId, { commentary: !live }));
  const imageParam = url.searchParams.get("image");
  if (imageParam !== null) {
    const index = /^\d{1,3}$/.test(imageParam) ? Number(imageParam) : -1;
    const callId = step.startsWith("tool:") ? step.slice("tool:".length) : "";
    const image = index >= 0 && callId ? toolResultImage(turn, callId, index) : null;
    const preview = !image ? null
      : live ? (await renderToolImageThumbnail(image.data))?.data ?? null
      : await storedToolImageThumbnail(chatJid, Number(messageId), callId, index, image.data);
    if (!preview) return json({ error: "Not found" }, 404);
    return new Response(new Blob([preview as BlobPart], { type: "image/webp" }), { headers: {
      "Content-Type": "image/webp", "Cache-Control": live ? "no-store" : "private, max-age=86400", "X-Content-Type-Options": "nosniff" } });
  }
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const detail = projectTurnStepDetail(turn, step, Number.isSafeInteger(offset) && offset > 0 ? offset : 0);
  if (!detail) return json({ error: "Not found" }, 404);
  if (detail.kind === "tool") {
    // The emitted view pages by bytes, independently of the model view.
    const emittedOffset = Number(url.searchParams.get("emitted_offset") ?? 0);
    const result = toolResultFor(turn, step.slice("tool:".length));
    detail.emitted = result ? emittedToolOutput(chatJid, result.details, result.text, Number.isSafeInteger(emittedOffset) && emittedOffset > 0 ? emittedOffset : 0) : null;
  }
  return json(detail);
}
