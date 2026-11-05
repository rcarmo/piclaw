import { admitSqliteWrite } from '../../src/db/sqlite-async-admission.js';
// INACTIVE application-owned correlation store. No database opens or automatic migrations.
import type { Database } from "bun:sqlite";
import { assertHostSchema, initializeHostSchemaTables } from "./host-schema.js";
import { getQueuedInputIntent } from "../../src/service-effects/current-piclaw/queued-input-intent.js";
import type { ConversationId, SubmissionId } from "@earendil-works/pi-durable";
import { hashCanonicalRequest } from "../../../runtime/src/service-effects/contracts/common.js";
import { inputSnapshot, isNativeMessageInput, type AcceptedInput, type HostInputBinding, type HostDurableBindings } from "./host-runtime.js";

export interface HostBindingOptions {
  readonly domain: string;
  readonly incarnation: string;
  readonly assertOwner: () => void;
  readonly manifest: readonly { readonly chatJid: string; readonly branchId: string; readonly conversationId: ConversationId }[];
  readonly getConversationBinding?: (chat: string, branch: string) => { conversationId: ConversationId } | undefined;
  /** Resolve the EXISTING host payload. Never persist another plaintext copy here. */
  readonly resolveContent: (payloadRef: string, input: AcceptedInput) => Promise<string>;
  /** Exact persisted private context/source proof, separate from live permission. */
  readonly resolveBackground?: (input:AcceptedInput)=>ConversationId|undefined;
  readonly assertBackgroundExecution?: (input:AcceptedInput)=>void;
}
const conflict = () => new Error("Host binding conflict");
function identity(value: string) {
  if (typeof value !== "string" || !value.length || value.length > 2048) throw new TypeError("Invalid binding scope");
  return value;
}
/** Caller-controlled OFFLINE setup only, on the host-owned EF-S01 connection.
 * This is not a production migration and is never called by the factory/runtime. */
export function initializeHostDurableBindings(db: Database, assertOwner: () => void): void {
  initializeHostSchemaTables(db, assertOwner, [0, 1]);
}

type Row = { conversation_id: ConversationId; chat_jid: string; branch_id: string; operation_id: string;
  source_seq: number; source_id: string; payload_ref: string; request_id: string; request_hash: string;
  submission_id: SubmissionId | null };

/** Correlation, NOT admission, scheduling, authorization or an outbox. The supplied connection
 * MUST be the host's EF-S01 database. Its synchronous public SQL composition tables are verified
 * inside each write transaction (ServiceWorkStore has no synchronous snapshot method).
 * Payload resolution happens outside SQL; immutable reference/hash and source are rechecked inside.
 * The owner callback must fence this whole store; no distributed atomicity is claimed. */
export function createHostDurableBindings(db: Database, options: HostBindingOptions): HostDurableBindings & {
  findSource(chatJid: string, sourceSeq: number): Promise<HostInputBinding | null>;
  resolveConversation(input: AcceptedInput): ConversationId | undefined;
} {
  const domain = identity(options.domain), incarnation = identity(options.incarnation);
  const assertOwner = options.assertOwner.bind(options), resolveContent = options.resolveContent.bind(options);
  const resolveBackground=options.resolveBackground?.bind(options),assertBackgroundExecution=options.assertBackgroundExecution?.bind(options);
  const manifest = options.manifest.map(b => Object.freeze({ chatJid: identity(b.chatJid),
    branchId: identity(b.branchId), conversationId: b.conversationId }));
  const lookup = options.getConversationBinding?.bind(options) ?? ((chat: string, branch: string) => manifest.find(b => b.chatJid === chat && b.branchId === branch));
  assertOwner();
  function resolveConversation(input: AcceptedInput): ConversationId | undefined {
    assertOwner();
    const i = inputSnapshot(input), root = lookup(i.chatJid, i.branchId)?.conversationId;
    if (i.incarnation !== incarnation || !root) return undefined;
    const background=resolveBackground?.(i);
    if(background!==undefined){if(background!==root||background!==i.conversationId)throw conflict();return background;}
    if(i.conversationId===root)return undefined;
    const side = db.query(`SELECT b.* FROM piclaw_durable_bindings_v1 b
      JOIN service_effect_s01_sources s ON s.chat_jid=b.chat_jid AND s.source_seq=b.source_seq
      JOIN service_effect_s01_operations o ON o.operation_id=b.operation_id AND o.chat_jid=b.chat_jid AND o.primary_source_seq=b.source_seq
      JOIN service_effect_s01_operation_sources os ON os.operation_id=o.operation_id AND os.chat_jid=s.chat_jid AND os.source_seq=s.source_seq
      JOIN service_effect_s01_chats ch ON ch.chat_jid=s.chat_jid AND ch.active_operation_id=o.operation_id
      WHERE b.domain=? AND b.incarnation=? AND b.operation_id=? AND b.source_seq=?
        AND s.kind='internal' AND s.state='claimed' AND s.source_id=? AND s.payload_ref=?
        AND o.phase IN ('claimed','executing','cancelling','settling')`)
      .get(domain, incarnation, i.operationId, i.sourceSeq, i.sourceId, i.payloadRef) as Row | null;
    if (side && /^side-prompt:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(i.sourceId) &&
      i.requestId === i.sourceId && i.payloadRef === i.sourceId && side.conversation_id !== root &&
      side.chat_jid === i.chatJid && side.branch_id === i.branchId && side.conversation_id === i.conversationId &&
      side.request_id === i.requestId && side.request_hash === i.requestHash) {
      return side.conversation_id;
    }
    if (!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='service_effect_s07_occurrences'").get()) return undefined;
    const row = db.query(`SELECT b.*, r.task_id FROM piclaw_durable_bindings_v1 b
      JOIN service_effect_s01_sources s ON s.chat_jid=b.chat_jid AND s.source_seq=b.source_seq
      JOIN service_effect_s07_occurrences r ON r.run_id=s.source_id AND r.operation_id=b.operation_id AND r.accepted_source_seq=s.source_seq
      JOIN service_effect_s07_tasks h ON h.task_id=r.task_id AND h.current_revision=r.task_revision AND h.status='active' AND h.next_run_at=r.scheduled_for
      JOIN service_effect_s01_operations o ON o.operation_id=b.operation_id AND o.chat_jid=b.chat_jid AND o.primary_source_seq=b.source_seq
      JOIN service_effect_s01_chats ch ON ch.chat_jid=b.chat_jid AND ch.active_operation_id=o.operation_id
      WHERE b.domain=? AND b.incarnation=? AND b.operation_id=? AND b.source_seq=?
        AND s.kind='scheduled_agent' AND s.state='claimed' AND s.source_id=? AND s.payload_ref=?
        AND r.state='source_bound' AND r.lease_expires_at>? AND o.phase IN ('claimed','executing','settling')`)
      .get(domain, incarnation, i.operationId, i.sourceSeq, i.sourceId, i.payloadRef, new Date().toISOString()) as (Row & { task_id: string }) | null;
    if (!row || row.conversation_id === root || row.chat_jid !== i.chatJid || row.branch_id !== i.branchId ||
      row.conversation_id !== i.conversationId || row.request_id !== i.requestId || row.request_hash !== i.requestHash) return undefined;
    return row.conversation_id;
  }
  function capture(input: AcceptedInput) {
    const i = inputSnapshot(input);
    assertOwner();
    if (i.incarnation !== incarnation || (lookup(i.chatJid, i.branchId)?.conversationId !== i.conversationId && resolveConversation(i) !== i.conversationId)) throw conflict();
    return i;
  }
  function assertNativeMessage(i: AcceptedInput) {
    if (!isNativeMessageInput(i)) throw conflict();
    const source = db.query(`SELECT s.source_id,s.payload_ref,s.state,m.rowid FROM service_effect_s01_sources s
      JOIN messages m ON m.chat_jid=s.chat_jid AND m.id=s.source_id AND m.is_bot_message=0
      WHERE s.chat_jid=? AND s.source_seq=? AND s.kind='message'`).get(i.chatJid,i.sourceSeq) as
      {source_id:string;payload_ref:string;state:string;rowid:number}|null;
    if (!source || source.source_id!==i.sourceId || source.payload_ref!==i.payloadRef ||
      !["pending","consumed"].includes(source.state) ||
      ![`message-row:${source.rowid}`,`queued-source:${i.sourceId}`].includes(i.payloadRef) ||
      i.requestId!==`message:${source.rowid}:${i.sourceId}`) throw Error("Native accepted message changed");
    assertOwner();
  }
  function makePort(intent = false) {
  const table = intent ? "piclaw_durable_intent_bindings_v1" : "piclaw_durable_bindings_v1";
  const otherTable = intent ? "piclaw_durable_bindings_v1" : "piclaw_durable_intent_bindings_v1";
  function read(i: AcceptedInput): HostInputBinding | null {
    assertHostSchema(db);
    const r = db.query(`SELECT * FROM ${table}
      WHERE domain=? AND incarnation=? AND conversation_id=? AND request_id=?`)
      .get(domain, incarnation, i.conversationId, i.requestId) as Row | null;
    if (!r) return null;
    const result = Object.freeze({ incarnation, conversationId: r.conversation_id, chatJid: r.chat_jid,
      branchId: r.branch_id, operationId: r.operation_id, sourceSeq: r.source_seq, sourceId: r.source_id,
      payloadRef: r.payload_ref, requestId: r.request_id, requestHash: r.request_hash, submissionId: r.submission_id });
    if (Object.entries(i).some(([k, v]) => result[k as keyof AcceptedInput] !== v)) throw conflict();
    return result;
  }
  function verifySource(i: AcceptedInput) {
    assertHostSchema(db);
    if (!intent && isNativeMessageInput(i)) { assertNativeMessage(i); return; }
    // A committed exact binding may replay after terminal settlement. Fresh admission
    // must use the same nonterminal proof as root recovery.
    if (intent) {
      if (read(i)) return;
      const proof = getQueuedInputIntent(db, i.operationId, i);
      if (!proof || proof.intentId !== i.requestId) throw new Error("Unverified host source");
      return;
    }
    const source = db.query(`SELECT s.kind,s.source_id,s.payload_ref FROM service_effect_s01_sources s
      JOIN service_effect_s01_operation_sources c ON c.chat_jid=s.chat_jid AND c.source_seq=s.source_seq
      JOIN service_effect_s01_operations o ON o.operation_id=c.operation_id AND o.chat_jid=s.chat_jid
      WHERE s.chat_jid=? AND s.source_seq=? AND s.source_id=? AND s.payload_ref=?
        AND s.state IN ('claimed','consumed') AND o.operation_id=?
        AND o.primary_source_seq=s.source_seq AND s.kind IN ('message','scheduled_agent','internal')`)
      .get(i.chatJid, i.sourceSeq, i.sourceId, i.payloadRef, i.operationId) as { kind: string; source_id: string; payload_ref: string } | null;
    // Internal work is not blanket tool authority. Only the exact side-prompt
    // namespace can bind here; execution/recovery still need their own routing.
    if (!source || (source.kind === "internal" &&
      (!(/^side-prompt:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(source.source_id) ||
          /^background:[0-9a-f]{64}$/.test(source.source_id)&&resolveBackground?.(i)===i.conversationId) ||
        source.payload_ref !== source.source_id || i.requestId !== source.source_id))) throw new Error("Unverified host source");
  }
  async function bindContent(i: AcceptedInput) {
    assertOwner(); verifySource(i); read(i); assertOwner();
    const content = await resolveContent(i.payloadRef, i);
    assertOwner();
    if (typeof content !== "string" || hashCanonicalRequest({ type: "input", requestId: i.requestId, content }) !== i.requestHash)
      throw new Error("Host payload hash conflict");
    // Reconciliation is a read when the immutable correlation already exists.
    // Taking BEGIN IMMEDIATE here contends with the SDK's committing writer,
    // even though no host state would change, and can strand a completed reply.
    verifySource(i);
    const existing = read(i);
    if (existing) {
      if (db.query(`SELECT 1 FROM ${otherTable} WHERE domain=? AND incarnation=? AND ((conversation_id=? AND request_id=?) OR (chat_jid=? AND source_seq=?))`)
        .get(domain, incarnation, i.conversationId, i.requestId, i.chatJid, i.sourceSeq)) throw conflict();
      assertOwner(); return { binding: existing, content };
    }
    const binding = await admitSqliteWrite(db, () => {
      assertOwner(); verifySource(i);
      if (db.query(`SELECT 1 FROM ${otherTable} WHERE domain=? AND incarnation=? AND ((conversation_id=? AND request_id=?) OR (chat_jid=? AND source_seq=?))`)
        .get(domain, incarnation, i.conversationId, i.requestId, i.chatJid, i.sourceSeq)) throw conflict();
      db.query(`INSERT OR IGNORE INTO ${table}
        (domain,incarnation,conversation_id,chat_jid,branch_id,operation_id,source_seq,source_id,payload_ref,request_id,request_hash)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(domain, incarnation, i.conversationId, i.chatJid, i.branchId,
          i.operationId, i.sourceSeq, i.sourceId, i.payloadRef, i.requestId, i.requestHash);
      const bound = read(i);
      if (!bound) throw conflict();
      assertOwner(); return bound;
    }, assertOwner);
    return { binding, content };
  }
  function prepareSubmission(input: AcceptedInput, submissionId: SubmissionId): AcceptedInput {
    const i = capture(input);
    if (!Number.isSafeInteger(submissionId) || submissionId <= 0) throw new TypeError("Invalid submission identity");
    return i;
  }
  function applySubmission(i: AcceptedInput, submissionId: SubmissionId): void {
    assertOwner(); verifySource(i);
    const prior = read(i);
    if (!prior || (prior.submissionId !== null && prior.submissionId !== submissionId)) throw conflict();
    const other = db.query(`SELECT 1 FROM ${table} WHERE domain=? AND incarnation=?
      AND submission_id=? AND NOT (conversation_id=? AND request_id=?)
      UNION ALL SELECT 1 FROM ${otherTable} WHERE domain=? AND incarnation=? AND submission_id=?`)
      .get(domain, incarnation, submissionId, i.conversationId, i.requestId, domain, incarnation, submissionId);
    if (other) throw conflict();
    db.query(`UPDATE ${table} SET submission_id=?
      WHERE domain=? AND incarnation=? AND conversation_id=? AND request_id=? AND submission_id IS NULL`)
      .run(submissionId, domain, incarnation, i.conversationId, i.requestId);
    if (read(i)?.submissionId !== submissionId) throw conflict();
    assertOwner();
  }
  return Object.freeze({
    async list(input: AcceptedInput) {
      const i = capture(input);
      assertHostSchema(db);
      const rows = db.query(`SELECT request_id FROM ${table} WHERE domain=? AND incarnation=? AND operation_id=?`)
        .all(domain, incarnation, i.operationId) as { request_id: string }[];
      const result = rows.map(r => {
        const row = db.query(`SELECT * FROM ${table} WHERE domain=? AND incarnation=? AND conversation_id=? AND request_id=?`)
          .get(domain, incarnation, i.conversationId, r.request_id) as Row | null;
        if (!row) throw conflict();
        const bound = read({ incarnation, conversationId: row.conversation_id, chatJid: row.chat_jid, branchId: row.branch_id,
          operationId: row.operation_id, sourceSeq: row.source_seq, sourceId: row.source_id, payloadRef: row.payload_ref,
          requestId: row.request_id, requestHash: row.request_hash });
        if (!bound) throw conflict(); verifySource(bound); return bound;
      });
      assertOwner(); return Object.freeze(result);
    },
    async get(input: AcceptedInput) {
      const i = capture(input), result = read(i); assertOwner(); return result;
    },
    async bind(input: AcceptedInput) { const i = capture(input); return (await bindContent(i)).binding; },
    async getOrBind(input: AcceptedInput) { const i = capture(input); return { content: (await bindContent(i)).content }; },
    async recordSubmission(input: AcceptedInput, submissionId: SubmissionId) {
      const i = prepareSubmission(input, submissionId);
      await admitSqliteWrite(db, () => applySubmission(i, submissionId), assertOwner);
    },
    /** Host-only precommit correlation, not execution authority or acknowledgement.
     * Caller owns this exact connection's transaction and MUST roll back on failure. */
    recordSubmissionInTransaction(input: AcceptedInput, submissionId: SubmissionId, transactionDatabase: Database): void {
      if (transactionDatabase !== db || !db.inTransaction) throw conflict();
      const i = prepareSubmission(input, submissionId);
      applySubmission(i, submissionId);
    },
  });
  }
  return Object.freeze({ ...makePort(), intents: makePort(true), resolveConversation,
    assertSourceCurrent(input: AcceptedInput) {
      const i = capture(input);
      assertHostSchema(db);
      if (isNativeMessageInput(i)) { assertNativeMessage(i); return; }
      // Unlike correlation replay, an effect requires a currently executing,
      // uncancelled operation and its exact still-claimed accepted source.
      const current = db.query(`SELECT 1 FROM service_effect_s01_sources s
        JOIN service_effect_s01_operation_sources c ON c.chat_jid=s.chat_jid AND c.source_seq=s.source_seq
        JOIN service_effect_s01_operations o ON o.operation_id=c.operation_id AND o.chat_jid=s.chat_jid
        JOIN service_effect_s01_chats ch ON ch.chat_jid=o.chat_jid AND ch.active_operation_id=o.operation_id
        WHERE s.chat_jid=? AND s.source_seq=? AND s.source_id=? AND s.payload_ref=?
          AND s.state='claimed' AND o.operation_id=? AND o.phase='executing'
          AND o.cancellation_source_id IS NULL AND o.terminal_disposition IS NULL`)
        .get(i.chatJid, i.sourceSeq, i.sourceId, i.payloadRef, i.operationId);
      if (!current) throw Error("Host operation authority unavailable");
      if(i.sourceId.startsWith('background:')){
        if(resolveBackground?.(i)!==i.conversationId||!assertBackgroundExecution)throw Error('Background execution authority unavailable');
        assertBackgroundExecution(i);
      }
      assertOwner();
    },
    async findSource(chatJid: string, sourceSeq: number) {
      assertOwner();
      assertHostSchema(db);
      const rows = db.query(`SELECT * FROM piclaw_durable_bindings_v1
        WHERE domain=? AND incarnation=? AND chat_jid=? AND source_seq=?
        UNION ALL SELECT * FROM piclaw_durable_intent_bindings_v1
        WHERE domain=? AND incarnation=? AND chat_jid=? AND source_seq=?`)
        .all(domain, incarnation, chatJid, sourceSeq, domain, incarnation, chatJid, sourceSeq) as Row[];
      if (rows.length > 1) throw conflict();
      const row = rows[0];
      if (!row) return null;
      const input = capture({ incarnation, conversationId: row.conversation_id, chatJid: row.chat_jid,
        branchId: row.branch_id, operationId: row.operation_id, sourceSeq: row.source_seq,
        sourceId: row.source_id, payloadRef: row.payload_ref, requestId: row.request_id, requestHash: row.request_hash });
      assertOwner();
      return Object.freeze({ ...input, submissionId: row.submission_id });
    },
  });
}

/** One host-root completion, shared by production and real-store fixtures. SDK
 * evidence is resolved by the fresh runtime producer BEFORE entering this port. */
export function createInputHandoffCompletion(db: Database, options: {
  domain: string; incarnation: string; sessionId: string;
  bindings: HostDurableBindings;
  work: Pick<import('../../src/service-effects/current-piclaw/service-work-store.js').CurrentPiclawServiceWorkStore, 'bindHarnessInTransaction'>;
  assertCurrent(input: AcceptedInput): void;
}): NonNullable<import('./host-runtime.js').RuntimeOptions['completeInputHandoff']> {
  const { domain, incarnation, sessionId, bindings, work } = options;
  const assert = options.assertCurrent.bind(options), bindHarness = work.bindHarnessInTransaction.bind(work);
  const primaryAck = bindings.recordSubmissionInTransaction?.bind(bindings);
  const intentAck = bindings.intents?.recordSubmissionInTransaction?.bind(bindings.intents);
  return async (input, submissionId, captured, intent, signal) => {
    const i = inputSnapshot(input), check = () => { signal?.throwIfAborted(); assert(i); };
    await admitSqliteWrite(db, () => {
      check();
      if (i.incarnation !== incarnation || captured.operationId !== i.operationId || captured.chatJid !== i.chatJid ||
        captured.terminal || captured.cancellation || !captured.claimedSourceSeqs.includes(i.sourceSeq)) throw conflict();
      const row = db.query(`SELECT o.* FROM service_effect_s01_operations o
        JOIN service_effect_s01_chats ch ON ch.chat_jid=o.chat_jid AND ch.active_operation_id=o.operation_id
        JOIN service_effect_s01_operation_sources os ON os.operation_id=o.operation_id AND os.chat_jid=o.chat_jid
        JOIN service_effect_s01_sources s ON s.chat_jid=os.chat_jid AND s.source_seq=os.source_seq
        WHERE o.operation_id=? AND o.chat_jid=? AND o.version=?
          AND o.cancellation_source_id IS NULL AND o.terminal_disposition IS NULL
          AND s.source_seq=? AND s.source_id=? AND s.payload_ref=? AND s.state='claimed'`)
        .get(i.operationId, i.chatJid, captured.version, i.sourceSeq, i.sourceId, i.payloadRef) as {
          phase: string; primary_source_seq: number; harness_session_id: string | null; harness_operation_id: string | null;
        } | null;
      if (!row || row.harness_session_id !== (captured.harness?.sessionId ?? null) ||
        row.harness_operation_id !== (captured.harness?.harnessOperationId ?? null)) throw conflict();
      if (intent) {
        const primary = Number(row.harness_operation_id);
        if (!Number.isSafeInteger(primary) || primary <= 0 || String(primary) !== row.harness_operation_id ||
          row.phase !== 'executing' || row.primary_source_seq === i.sourceSeq || row.harness_session_id !== sessionId ||
          !db.query(`SELECT 1 FROM piclaw_durable_bindings_v1 WHERE domain=? AND incarnation=? AND conversation_id=?
            AND operation_id=? AND source_seq=? AND submission_id=?`)
            .get(domain, incarnation, i.conversationId, i.operationId, row.primary_source_seq, primary)) throw conflict();
      } else {
        if (row.primary_source_seq !== i.sourceSeq || !['claimed', 'starting_harness', 'executing'].includes(row.phase) ||
          (row.harness_session_id !== null && (row.harness_session_id !== sessionId || row.harness_operation_id !== String(submissionId)))) throw conflict();
      }
      const ack = intent ? intentAck : primaryAck;
      if (!ack) throw conflict();
      ack(i, submissionId, db); // Revalidates route/incarnation/source and exact identity.
      if (!intent) bindHarness(sealHandoff({
        effect: { idempotencyKey: `input-handoff:${hashCanonicalRequest({ incarnation, conversationId: i.conversationId, requestId: i.requestId, submissionId })}`, requestHash: '',
          operationId: i.operationId, sourceSeq: i.sourceSeq, provenanceRef: 'host:input-handoff', redactionClass: 'private' as const },
        expectedVersion: captured.version, sessionId, harnessOperationId: String(submissionId),
      }), db);
      const final = db.query(`SELECT 1 FROM service_effect_s01_operations WHERE operation_id=? AND phase='executing'
        AND cancellation_source_id IS NULL AND terminal_disposition IS NULL AND harness_session_id=? AND harness_operation_id=?`)
        .get(i.operationId, sessionId, intent ? row.harness_operation_id : String(submissionId));
      if (!final) throw conflict();
      check();
    }, check, signal);
  };
}
import { sealed as sealHandoff } from './host-effects.js';
