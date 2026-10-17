import type { Database } from "bun:sqlite";
import { hashCanonicalRequest } from "../contracts/common.js";
const requiredText = (v: unknown): string => { if (typeof v !== "string" || !v.trim().length) throw new Error("Corrupt queued intent"); return v; };
const requiredHash = (v: unknown): string => { const s = requiredText(v); if (!/^[a-f0-9]{64}$/.test(s)) throw new Error("Corrupt queued intent hash"); return s; };
/** Exact read-only SQL proof shared by root recovery and host binding admission. */
export function getQueuedInputIntent(database: Database, operationId: string,
  source: { chatJid: string; sourceSeq: number; sourceId: string; payloadRef: string }) {
    const row = database.query(`SELECT i.operation_id, i.intent_id, i.intent_hash, i.kind, i.payload_ref, i.created_at, s.source_hash
      FROM service_effect_s01_intents i
      JOIN service_effect_s01_operations o ON o.operation_id=i.operation_id
      JOIN service_effect_s01_operation_sources m ON m.operation_id=o.operation_id AND m.chat_jid=o.chat_jid
      JOIN service_effect_s01_sources s ON s.chat_jid=m.chat_jid AND s.source_seq=m.source_seq
      WHERE o.operation_id=? AND o.chat_jid=? AND m.source_seq=? AND s.source_id=?
        AND s.payload_ref=? AND s.target_operation_id=o.operation_id
        AND s.kind='message' AND s.state IN ('claimed','consumed')
        AND o.primary_source_seq<>s.source_seq AND o.phase<>'terminal'
        AND i.intent_id=? AND i.kind='queue_input' AND i.payload_ref=s.payload_ref`)
      .get(operationId, source.chatJid, source.sourceSeq, source.sourceId,
        source.payloadRef, `queued-steer:${source.sourceId}`) as Record<string, unknown> | null;
    if (!row || source.payloadRef !== `queued-source:${source.sourceId}`) return null;
    const proof = Object.freeze({ operationId: requiredText(row.operation_id), sourceSeq: source.sourceSeq,
      sourceId: source.sourceId, intentId: requiredText(row.intent_id), kind: "queue_input" as const,
      payloadRef: requiredText(row.payload_ref), createdAt: requiredText(row.created_at), intentHash: requiredHash(row.intent_hash), sourceHash: requiredHash(row.source_hash) });
    return proof.intentHash === hashCanonicalRequest({ operationId: proof.operationId, intentId: proof.intentId,
      kind: proof.kind, payloadRef: proof.payloadRef, createdAt: proof.createdAt }) ? proof : null;
}
