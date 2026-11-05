import type Database from "bun:sqlite";
import { getDb } from "./connection.js";
import {
  OperationConflictError,
  TERMINAL_OPERATION_STATUSES,
  type OperationRecord,
  type OperationSnapshot,
  type OperationEvent,
  type OperationPrincipal,
  type OperationStatus,
} from "../addons/operation-contracts.js";

function fromRow(value: unknown): OperationRecord | null {
  if (!value) return null;
  const r = value as Record<string, any>;
  return {
    id: r.id,
    addonId: r.addon_id,
    principalId: r.principal_id,
    idempotencyKey: r.idempotency_key,
    inputHash: r.input_hash,
    target: r.target,
    text: r.text,
    grant: JSON.parse(r.grant_json),
    chatJid: r.chat_jid,
    workId: r.work_id,
    status: r.status,
    sequence: r.sequence,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    output: r.output,
    reason: r.reason,
  };
}
export function operationSnapshot(r: OperationRecord): OperationSnapshot {
  return {
    id: r.id,
    target: r.target,
    workId: r.workId,
    status: r.status,
    sequence: r.sequence,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    output: r.output,
    reason: r.reason,
  };
}
export function readAddonOperation(id: string, database:Database=getDb()): OperationRecord | null {
  return fromRow(
    database.query("SELECT * FROM addon_operations WHERE id=?").get(id),
  );
}
export const ADDON_OPERATION_RESUME_TEXT='Continue the current operation from the input already in this session. Do not repeat completed actions.';
export type AddonOperationInputEpoch=Readonly<{sequence:number;kind:'initial'|'resume'|'continuation';previousSequence:number|null}>;
/** Persisted owner transitions, not mutable text/status, identify one accepted
 * input and distinguish explicit new data from a resume of committed history. */
export function readAddonOperationInputEpoch(id:string,database:Database=getDb()):AddonOperationInputEpoch|null{
  const record=readAddonOperation(id,database);if(!record)return null;
  const events=(database.query('SELECT sequence,snapshot_json FROM addon_operation_events WHERE operation_id=? ORDER BY sequence DESC LIMIT 128').all(id) as {sequence:number;snapshot_json:string}[])
    .map(row=>({sequence:row.sequence,snapshot:JSON.parse(row.snapshot_json) as OperationSnapshot}));
  const valid=(event:typeof events[number])=>{
    const {snapshot,sequence}=event;
    if(!Number.isSafeInteger(sequence)||sequence<1||snapshot.id!==record.id||snapshot.sequence!==sequence||snapshot.workId!==record.workId||snapshot.target!==record.target)throw Error('Invalid add-on input identity event');
    return event;
  };
  const index=events.findIndex(event=>event.snapshot.status==='queued');if(index<0)return null;
  const current=valid(events[index]!);if(current.sequence===1)return Object.freeze({sequence:1,kind:'initial',previousSequence:null});
  const predecessor=events[index+1],previous=events.slice(index+1).find(event=>event.snapshot.status==='queued');
  if(!predecessor||!previous||valid(predecessor).sequence!==current.sequence-1)throw Error('Previous add-on input epoch unavailable');valid(previous);
  const status=predecessor.snapshot.status;
  if(!['input_required','budget_blocked','approval_required'].includes(status))throw Error('Unsupported add-on input transition');
  return Object.freeze({sequence:current.sequence,kind:status==='input_required'?'continuation':'resume',previousSequence:previous.sequence});
}
export function readAddonOperationInputSequence(id:string,database:Database=getDb()):number|null{
  return readAddonOperationInputEpoch(id,database)?.sequence??null;
}
export function admitAddonOperation(record: OperationRecord): {
  created: boolean;
  record: OperationRecord;
} {
  const db = getDb();
  return db
    .transaction(() => {
      const prior = fromRow(
        db
          .query(
            "SELECT * FROM addon_operations WHERE addon_id=? AND principal_id=? AND idempotency_key=?",
          )
          .get(record.addonId, record.principalId, record.idempotencyKey),
      );
      if (prior) {
        if (prior.inputHash !== record.inputHash)
          throw new OperationConflictError();
        return { created: false, record: prior };
      }
      if (
        countActiveAddonOperations({
          addonId: record.addonId,
          principalId: record.principalId,
        }) >= 16
      )
        throw new Error("Operation active quota exceeded.");
      db.query(
        `INSERT INTO addon_operations(id,addon_id,principal_id,idempotency_key,input_hash,target,text,input_bytes,grant_json,chat_jid,work_id,status,sequence,created_at,updated_at,output,reason)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        record.id,
        record.addonId,
        record.principalId,
        record.idempotencyKey,
        record.inputHash,
        record.target,
        record.text,
        Buffer.byteLength(record.text),
        JSON.stringify(record.grant),
        record.chatJid,
        record.workId,
        record.status,
        record.sequence,
        record.createdAt,
        record.updatedAt,
        record.output,
        record.reason,
      );
      db.query("INSERT INTO addon_operation_events VALUES(?,?,?)").run(
        record.id,
        record.sequence,
        JSON.stringify(operationSnapshot(record)),
      );
      return { created: true, record };
    })
    .immediate();
}
/** Compare-and-set protects terminal immutability and cancellation/completion races. */
export function transitionAddonOperation(
  id: string,
  from: OperationStatus[],
  status: OperationStatus,
  output: string | null = null,
  reason: string | null = null,
  expectedInputSequence?:number,
): OperationRecord | null {
  const db = getDb();
  return db
    .transaction(() => {
      const previous = readAddonOperation(id);
      if (
        !previous ||
        TERMINAL_OPERATION_STATUSES.has(previous.status) ||
        !from.includes(previous.status)||expectedInputSequence!==undefined&&readAddonOperationInputSequence(id,db)!==expectedInputSequence
      )
        return null;
      const next: OperationRecord = {
        ...previous,
        status,
        output,
        reason,
        sequence: previous.sequence + 1,
        updatedAt: new Date().toISOString(),
      };
      db.query(
        "UPDATE addon_operations SET status=?,output=?,reason=?,sequence=?,updated_at=? WHERE id=?",
      ).run(
        next.status,
        next.output,
        next.reason,
        next.sequence,
        next.updatedAt,
        id,
      );
      db.query("INSERT INTO addon_operation_events VALUES(?,?,?)").run(
        id,
        next.sequence,
        JSON.stringify(operationSnapshot(next)),
      );
      // Bounded replay: clients with an old cursor receive the current snapshot/gap flag.
      db.query(
        "DELETE FROM addon_operation_events WHERE operation_id=? AND sequence<=?",
      ).run(id, next.sequence - 128);
      return next;
    })
    .immediate();
}
export function readAddonOperationEvents(
  id: string,
  after: number,
): OperationEvent[] {
  return (
    getDb()
      .query(
        "SELECT sequence,snapshot_json FROM addon_operation_events WHERE operation_id=? AND sequence>? ORDER BY sequence LIMIT 128",
      )
      .all(id, after) as { sequence: number; snapshot_json: string }[]
  ).map((r) => ({
    sequence: r.sequence,
    snapshot: JSON.parse(r.snapshot_json),
  }));
}
export function listRecoverableAddonOperations(): OperationRecord[] {
  return getDb()
    .query(
      "SELECT * FROM addon_operations WHERE status IN ('queued','working','cancel_requested') ORDER BY created_at",
    )
    .all()
    .map(fromRow)
    .filter((r): r is OperationRecord => r !== null);
}
/** Purge only terminal rows in the caller namespace. Keys expire with rows. */
export function purgeAddonOperations(
  principal: OperationPrincipal,
  before: string,
): number {
  const db = getDb();
  return db
    .transaction(() => {
      const rows = db
        .query(
          "SELECT id FROM addon_operations WHERE addon_id=? AND principal_id=? AND status IN ('completed','failed','cancelled','rejected') AND updated_at<? LIMIT 1000",
        )
        .all(principal.addonId, principal.principalId, before) as {
        id: string;
      }[];
      for (const row of rows) {
        db.query("DELETE FROM addon_operation_events WHERE operation_id=?").run(
          row.id,
        );
        db.query("DELETE FROM addon_operations WHERE id=?").run(row.id);
      }
      return rows.length;
    })
    .immediate();
}

/** Bounded principal-scoped metadata page. Host grant checks still apply to every row. */
export function listAddonOperations(
  principal: OperationPrincipal,
  after: string | null,
  limit: number,
): OperationRecord[] {
  return getDb()
    .query(
      "SELECT * FROM addon_operations WHERE addon_id=? AND principal_id=? AND id>? ORDER BY id LIMIT ?",
    )
    .all(principal.addonId, principal.principalId, after || "", limit)
    .map(fromRow)
    .filter((r): r is OperationRecord => r !== null);
}
export function countActiveAddonOperations(
  principal: OperationPrincipal,
): number {
  const row = getDb()
    .query(
      "SELECT COUNT(*) AS n FROM addon_operations WHERE addon_id=? AND principal_id=? AND status NOT IN ('completed','failed','cancelled','rejected','budget_blocked')",
    )
    .get(principal.addonId, principal.principalId) as { n: number };
  return row.n;
}
export function appendOperationInput(
  id: string,
  text: string,
): OperationRecord | null {
  const db = getDb();
  return db
    .transaction(() => {
      const previous = readAddonOperation(id);
      if (!previous || previous.status !== "input_required") return null;
      const row = db
        .query("SELECT input_bytes FROM addon_operations WHERE id=?")
        .get(id) as { input_bytes: number };
      const bytes = row.input_bytes + Buffer.byteLength(text);
      if (bytes > 32 * 1024) throw new Error("Operation input limit.");
      // The persistent session already contains prior input. Send only this turn,
      // retaining the aggregate byte count without replaying earlier instructions.
      db.query(
        "UPDATE addon_operations SET text=?,input_bytes=? WHERE id=?",
      ).run(text, bytes, id);
      return transitionAddonOperation(id, ["input_required"], "queued");
    })
    .immediate();
}

/** Resume without resubmitting input already present in the SDK session history. */
export function markAddonOperationInputCommitted(id:string,expectedInputSequence?:number):void{
  const db=getDb();db.transaction(()=>{
    if(expectedInputSequence!==undefined&&readAddonOperationInputSequence(id,db)!==expectedInputSequence)throw Error('Add-on committed input epoch changed');
    const changed=db.query("UPDATE addon_operations SET text=? WHERE id=? AND status IN ('working','cancel_requested')").run(ADDON_OPERATION_RESUME_TEXT,id).changes;
    if(expectedInputSequence!==undefined&&changed!==1)throw Error('Add-on input owner changed before commit acknowledgement');
  }).immediate();
}
