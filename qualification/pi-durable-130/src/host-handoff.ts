// Qualification only: no startup registration, scheduler, provider or production schema activation.
import type { Database } from "bun:sqlite";
import { AssistantEntry } from "../../../runtime/durable-engine/qualification/durable.ts";
import { context, type openFixture } from "./fixture.js";
import { hashCanonicalRequest } from "../../../runtime/src/service-effects/contracts/common.js";
import type { ServiceWorkStore } from "../../../runtime/src/service-effects/contracts/service-work-store.js";
import type { TerminalSettlementStore, CommitTerminalRequest } from "../../../runtime/src/service-effects/contracts/terminal-settlement-store.js";
import { value, effect, sealed } from "../../../runtime/durable-engine/src/host-effects.js";
export { value, effect, sealed };

export const at = "2026-10-15T12:00:00.000Z";
interface Intent { request_id: string; request_hash: string; content: string; incarnation: string; conversation_id: string; submission_id: string | null }
type Fixture = Awaited<ReturnType<typeof openFixture>>;

/** Qualification generation check only: does not acquire exclusive ownership. */
export function assertHandoffOwner(db: Database, fixture: Fixture, incarnation: string, generation: number): void {
  const owner = db.query("SELECT generation FROM qualification_owner WHERE incarnation=?").get(incarnation) as { generation: number } | null;
  if (owner?.generation !== generation || !fixture.owner.acquired) throw new Error("Host owner lost");
}

/** Qualification requires uninterrupted exclusive ownership, including inside adapters.
 * Generation checks do NOT establish that precondition or undo an adapter commit.
 * Own this connection exclusively. Never hold an SQL transaction across an await. */
export function hostHandoff(db: Database, work: ServiceWorkStore, terminal: TerminalSettlementStore,
  fixture: Fixture, incarnation: string, generation: number, payload: (ref: string, text: string) => void) {
  if (!incarnation) throw new Error("Store incarnation required");
  db.exec(`CREATE TABLE IF NOT EXISTS qualification_owner (singleton INTEGER PRIMARY KEY CHECK(singleton=1), incarnation TEXT NOT NULL, generation INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS qualification_handoff (request_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL,
      content TEXT NOT NULL, incarnation TEXT NOT NULL, conversation_id TEXT NOT NULL, submission_id TEXT)`);
  if (!Number.isSafeInteger(generation) || generation < 1) throw new Error("Invalid owner generation");
  db.query("INSERT OR IGNORE INTO qualification_owner VALUES (1,?,?)").run(incarnation, generation);
  const binding = db.query("SELECT incarnation FROM qualification_owner WHERE singleton=1").get() as { incarnation: string };
  if (binding.incarnation !== incarnation) throw new Error("Host store incarnation binding conflict");
  db.query("UPDATE qualification_owner SET generation=? WHERE singleton=1 AND generation<?").run(generation, generation);
  function fence() {
    assertHandoffOwner(db, fixture, incarnation, generation);
  }
  return async function handoff(requestId: string, content: string, stop?: "accepted" | "submitted") {
    fence();
    const requestHash = hashCanonicalRequest({ type: "input", requestId, content });
    db.query("INSERT OR IGNORE INTO qualification_handoff VALUES (?,?,?,?,?,NULL)")
      .run(requestId, requestHash, content, incarnation, String(fixture.root.id));
    const intent = db.query("SELECT * FROM qualification_handoff WHERE request_id=?").get(requestId) as Intent;
    if (intent.request_hash !== requestHash || intent.incarnation !== incarnation || intent.conversation_id !== String(fixture.root.id))
      throw new Error("Host request binding conflict");
    const opId = `host:${requestId}`, chatJid = "web:qualification";
    const source = value(await work.acceptSource(sealed({ effect: effect(`accept:${requestId}`), chatJid,
      sourceId: requestId, kind: "message" as const, payloadRef: `input:${requestHash}`, targetOperationId: null,
      parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
    fence();
    let operation = value(await work.getOperation(opId));
    fence();
    if (!operation) {
      operation = value(await work.claimNext(sealed({ effect: effect(`claim:${requestId}`), chatJid,
        expectedFrontier: source.sourceSeq - 1, newOperationId: opId, claimedAt: at })))?.operation ?? null;
      fence();
    }
    if (!operation) throw new Error("No claimed operation");
    if (stop === "accepted") return null;
    fence();
    // Pure lookup first: do not call wait/resume/submit just to reconcile an uncertain acknowledgement.
    let submission = (await fixture.storage.submissionByRequest(fixture.root.id, requestId, context))?.id;
    fence();
    if (submission === undefined) {
      submission = (await fixture.submit(requestId, content)).id;
      fence();
    }
    if (stop === "submitted") return null; // Simulated committed submit / lost acknowledgement.
    if (intent.submission_id && intent.submission_id !== String(submission)) throw new Error("Submission binding conflict");
    db.query("UPDATE qualification_handoff SET submission_id=? WHERE request_id=?").run(String(submission), requestId);
    if (operation.terminal) {
      const settled = value(await terminal.getTerminal(opId));
      fence();
      return settled;
    }
    const handle = await fixture.harness.submission(submission, context);
    fence();
    if (!handle) throw new Error("Missing durable submission");
    const status = await handle.status(context); // Passive; never wait here.
    fence();
    if (status.type !== "input" || status.status !== "done") return null;
    const answer = await fixture.root.commit(tx => tx.entry(AssistantEntry, status.answer), context);
    fence();
    if (!answer || String(answer.conversationId) !== intent.conversation_id) throw new Error("Missing committed answer");
    operation = value(await work.getOperation(opId));
    fence();
    if (!operation) throw new Error("Missing host operation");
    // The real adapter binds once, not a general running->finished lifecycle API.
    // Bind only committed completion in this deliberately bounded qualification slice.
    if (!operation.harness) {
      operation = value(await work.bindHarness(sealed({
        effect: effect(`bind:${requestId}:${generation}`, opId, source.sourceSeq), expectedVersion: operation.version,
        sessionId: "qualification-session", lane: "main", harnessOperationId: opId,
        state: "finished" as const, watchGeneration: generation })));
      fence();
    }
    const cancelled = operation.cancellation !== null;
    const ref = `answer:${submission}`;
    const text = (answer.model ?? []).filter(message => message.role === "assistant").flatMap(message => typeof message.content === "string" ? [message.content] : message.content.filter(part => part.type === "text").map(part => part.text)).join("");
    if (!cancelled) payload(ref, text);
    const request: CommitTerminalRequest = sealed({ effect: effect(`terminal:${requestId}`, opId, source.sourceSeq) as ReturnType<typeof effect> & { operationId: string },
      expectedChatJid: chatJid, expectedVersion: operation.version, expectedHarness: operation.harness,
      disposition: cancelled ? "cancelled" : "completed", errorCode: null, terminalAuthorityRef: null,
      timeline: cancelled ? { mode: "none", placeholderRowId: null, chatJid, contentRef: null, threadId: null, mediaIds: [], contentBlocksRef: null }
        : { mode: "insert", placeholderRowId: null, chatJid, contentRef: ref, threadId: null, mediaIds: [], contentBlocksRef: null },
      sourceDispositions: [{ sourceSeq: source.sourceSeq, state: "consumed", reason: "qualification settled" }],
      outboxIntents: [], committedAt: at });
    fence();
    const settled = value(await terminal.commitTerminal(request));
    // Detection only: this cannot undo publication during the adapter's internal await.
    fence();
    return settled;
  };
}
