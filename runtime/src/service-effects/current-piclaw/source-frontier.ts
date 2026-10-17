import type Database from "bun:sqlite";

/** Pure read under the caller's writer transaction; never crosses an open source. */
export function computeClosedSourceFrontier(database: Database, chatJid: string, consumedThrough: number, nextSourceSeq: number): number {
  if (!Number.isSafeInteger(consumedThrough) || consumedThrough < 0
    || !Number.isSafeInteger(nextSourceSeq) || nextSourceSeq <= consumedThrough) throw Error("Invalid source frontier");
  let frontier = consumedThrough;
  while (frontier + 1 < nextSourceSeq) {
    const row = database.query("SELECT state FROM service_effect_s01_sources WHERE chat_jid=? AND source_seq=?")
      .get(chatJid, frontier + 1) as { state?: unknown } | null;
    if (!row || !["pending", "claimed", "queued", "consumed", "disposed"].includes(String(row.state))) throw Error("Invalid source frontier");
    if (row.state !== "consumed" && row.state !== "disposed") break;
    frontier++;
  }
  return frontier;
}
