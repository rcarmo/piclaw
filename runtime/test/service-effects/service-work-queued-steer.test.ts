import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { hashCanonicalRequest, type CanonicalJsonValue } from "../../src/service-effects/contracts/common.js";
import { createCurrentPiclawServiceWorkStore, EffectAdmissionError, type AttachQueuedSourceRequest } from "../../src/service-effects/current-piclaw/service-work-store.js";
import { terminalOperation, terminalRequest, TERMINAL_HARNESS } from "../../src/service-effects/testing/contract-suites/terminal-settlement-store-contract.js";
import { openSqliteSubject } from "./terminal-settlement-test-support.js";

function seal<T extends { effect: { requestHash: string } }>(request: T, method?: string): T {
  request.effect.requestHash = hashCanonicalRequest((method ? { method, ...request } : request) as unknown as CanonicalJsonValue);
  return request;
}

function fixture() {
  const subject = openSqliteSubject(":memory:", [], false);
  const db = subject.database;
  const harness = { ...TERMINAL_HARNESS, state: "running" as const };
  subject.seedOperation(terminalOperation({ phase: "executing", harness }));
  let owner = true;
  let checks = 0;
  let rejectAfter = false;
  const made = createCurrentPiclawServiceWorkStore(db, { hitFault: () => false, recordTrace() {},
    validateAcceptance: () => { checks++; return owner && !(rejectAfter && checks % 2 === 0); } });
  if (!made.ok) throw Error("fixture");
  const work = made.value;
  const effect = (key: string) => ({ idempotencyKey: key, requestHash: "", operationId: null, sourceSeq: null, provenanceRef: "host", redactionClass: "private" as const });
  const accept = (id: string) => db.transaction(() => work.acceptSourceInTransaction(seal({ effect: effect(`accept-${id}`), chatJid: "web:terminal", sourceId: id,
    kind: "message" as const, payloadRef: `queued-source:${id}`, targetOperationId: null, parentSourceSeq: null,
    acceptedAt: "2026-08-14T09:00:00.000Z", createWakeIntent: false }), db))();
  const source = accept("queued");
  const sourceHash = (db.query("SELECT source_hash FROM service_effect_s01_sources WHERE source_id='queued'").get() as { source_hash: string }).source_hash;
  const request: AttachQueuedSourceRequest = seal({ effect: { ...effect("attach"), operationId: "operation-1", sourceSeq: source.sourceSeq }, chatJid: "web:terminal",
    expectedVersion: 3, expectedHarness: harness, sourceId: "queued", sourceHash, payloadRef: "queued-source:queued", createdAt: "2026-08-14T09:01:00.000Z" }, "attachQueuedSource.v1");
  // Deliberately local coordinator fixture, NOT an enabled web action or dispatch port.
  db.exec("CREATE TABLE fixture_queue(source_id TEXT PRIMARY KEY, content TEXT); CREATE TABLE fixture_users(uuid TEXT PRIMARY KEY, content TEXT)");
  db.query("INSERT INTO fixture_queue VALUES (?, ?)").run("queued", "original accepted content");
  const snapshot = () => ["sources", "chats", "operations", "operation_sources", "intents", "queued_inputs", "decisions", "wake_intents"]
    .map(table => db.query(`SELECT * FROM service_effect_s01_${table}`).all())
    .concat([db.query("SELECT * FROM fixture_queue").all(), db.query("SELECT * FROM fixture_users").all()]);
  const attach = (input = request) => db.transaction(() => work.attachQueuedSourceInTransaction(input, db))();
  const coordinate = (fail = false) => db.transaction(() => {
    const result = work.attachQueuedSourceInTransaction(request, db);
    db.query("INSERT INTO fixture_users VALUES (?, ?)").run("same-source-user-uuid", "original accepted content");
    db.query("DELETE FROM fixture_queue WHERE source_id=?").run("queued");
    if (fail) throw Error("coordinator failed");
    return result;
  })();
  return { subject, db, work, source, request, snapshot, attach, coordinate, accept,
    loseOwner: () => { owner = false; }, rejectPostGuard: () => { checks = 0; rejectAfter = true; }, dispose: () => subject.dispose?.() };
}

test("queued steer attaches the same accepted source and intent atomically; replay is observational", () => {
  const f = fixture();
  try {
    const before = f.work.getAcceptedSource("web:terminal", "queued")!;
    const operation = f.coordinate();
    expect(operation.version).toBe(4);
    expect(operation.primarySourceSeq).toBe(1);
    expect(operation.claimedSourceSeqs).toEqual([1, before.sourceSeq]);
    expect(f.work.getAcceptedSource("web:terminal", "queued")).toEqual({ ...before, state: "claimed", targetOperationId: "operation-1" });
    expect(f.db.query("SELECT COUNT(*) AS n FROM service_effect_s01_sources").get()).toEqual({ n: 2 });
    expect(f.db.query("SELECT kind, payload_ref FROM service_effect_s01_intents").all()).toEqual([{ kind: "queue_input", payload_ref: before.payloadRef }]);
    expect(f.db.query("SELECT * FROM fixture_queue").all()).toEqual([]);
    expect(f.db.query("SELECT * FROM fixture_users").all()).toEqual([{ uuid: "same-source-user-uuid", content: "original accepted content" }]);
    const committed = f.snapshot();
    expect(f.attach()).toEqual(operation);
    expect(f.snapshot()).toEqual(committed);
    const changed = seal({ ...f.request, createdAt: "2026-08-14T09:02:00.000Z", effect: { ...f.request.effect } }, "attachQueuedSource.v1");
    expect(() => f.attach(changed)).toThrow("idempotency_conflict");
    expect(f.snapshot()).toEqual(committed);
    f.loseOwner();
    expect(() => f.attach()).toThrow("owner_conflict");
  } finally { f.dispose(); }
});

test("queued recovery lookup reads exact SQL membership and validates selected intent fields against hash", () => {
  const f = fixture();
  try {
    f.attach();
    const source = f.work.getSourceBySeq("web:terminal", f.source.sourceSeq)!;
    expect(source).toEqual(f.work.getAcceptedSource("web:terminal", "queued")!);
    const before = f.snapshot();
    const proof = f.work.getQueuedInputIntent("operation-1", source)!;
    expect(proof).toMatchObject({ operationId: "operation-1", sourceId: "queued", sourceSeq: source.sourceSeq,
      intentId: "queued-steer:queued", kind: "queue_input", payloadRef: source.payloadRef });
    expect(proof.intentHash).toBe(hashCanonicalRequest({ operationId: proof.operationId, intentId: proof.intentId,
      kind: proof.kind, payloadRef: proof.payloadRef, createdAt: proof.createdAt }));
    expect(f.snapshot()).toEqual(before);
    expect(f.work.getQueuedInputIntent("other", source)).toBeNull();
    expect(f.work.getQueuedInputIntent("operation-1", { ...source, sourceId: "other" })).toBeNull();
    expect(f.work.getQueuedInputIntent("operation-1", { ...source, chatJid: "other" })).toBeNull();
    expect(f.work.getQueuedInputIntent("operation-1", { ...source, sourceSeq: 1 })).toBeNull();
    f.db.query("UPDATE service_effect_s01_intents SET created_at='changed'").run();
    expect(f.work.getQueuedInputIntent("operation-1", source)).toBeNull();
    f.db.query("DELETE FROM service_effect_s01_intents").run();
    expect(f.work.getQueuedInputIntent("operation-1", source)).toBeNull();
  } finally { f.dispose(); }
});

for (const [name, patch] of Object.entries({
  "stale operation version": { expectedVersion: 2 },
  "missing operation": { effect: { operationId: "missing" } },
  "foreign chat": { chatJid: "foreign" },
  "wrong source id": { sourceId: "other" },
  "stale source hash": { sourceHash: "a".repeat(64) },
  "wrong payload": { payloadRef: "message-row:1" },
  "wrong source sequence": { effect: { sourceSeq: 1 } },
  "stale attempt": { expectedHarness: { watchGeneration: 99 } },
  "foreign harness operation": { expectedHarness: { harnessOperationId: "other" } },
  "foreign session": { expectedHarness: { sessionId: "other" } },
  "foreign lane": { expectedHarness: { lane: "other" } },
})) {
  test(`queued steer rejects ${name} without queue/source effects`, () => {
    const f = fixture();
    try {
      const request = seal({ ...f.request, ...patch,
        effect: { ...f.request.effect, ...("effect" in patch ? patch.effect : {}) },
        expectedHarness: { ...f.request.expectedHarness, ...("expectedHarness" in patch ? patch.expectedHarness : {}) },
      }, "attachQueuedSource.v1");
      const before = f.snapshot();
      expect(() => f.attach(request)).toThrow(EffectAdmissionError);
      expect(f.snapshot()).toEqual(before);
    } finally { f.dispose(); }
  });
}

for (const phase of ["claimed", "suspended", "settling", "terminal", "cancelling"]) {
  test(`queued steer rejects non-running ${phase} operation`, () => {
    const f = fixture();
    try {
      f.db.query("UPDATE service_effect_s01_operations SET phase=?").run(phase);
      const before = f.snapshot();
      expect(() => f.coordinate()).toThrow("owner_conflict");
      expect(f.snapshot()).toEqual(before);
    } finally { f.dispose(); }
  });
}

for (const mutation of [
  "UPDATE service_effect_s01_chats SET active_operation_id=NULL",
  "UPDATE service_effect_s01_operations SET cancellation_source_seq=1",
  "UPDATE service_effect_s01_sources SET state='claimed' WHERE source_id='queued'",
  "UPDATE service_effect_s01_sources SET target_operation_id='operation-1' WHERE source_id='queued'",
]) {
  test(`queued steer fails closed on changed ownership: ${mutation}`, () => {
    const f = fixture();
    try {
      f.db.exec(mutation);
      const before = f.snapshot();
      expect(() => f.coordinate()).toThrow(EffectAdmissionError);
      expect(f.snapshot()).toEqual(before);
    } finally { f.dispose(); }
  });
}

test("queued steer requires the exact transaction connection and explicit synchronous writer guard", () => {
  const f = fixture();
  const other = new Database(":memory:");
  try {
    const before = f.snapshot();
    expect(() => f.work.attachQueuedSourceInTransaction(f.request, f.db)).toThrow("owner_conflict");
    expect(() => f.db.transaction(() => f.work.attachQueuedSourceInTransaction(f.request, other))()).toThrow("owner_conflict");
    const unguarded = createCurrentPiclawServiceWorkStore(f.db, { hitFault: () => false, recordTrace() {} });
    if (!unguarded.ok) throw Error("fixture");
    expect(() => f.db.transaction(() => unguarded.value.attachQueuedSourceInTransaction(f.request, f.db))()).toThrow("owner_conflict");
    f.rejectPostGuard();
    expect(() => f.coordinate()).toThrow("owner_conflict");
    expect(f.snapshot()).toEqual(before);
  } finally { other.close(); f.dispose(); }
});

test("coordinator failure rolls back source, intent, decision, queue removal and user materialization", () => {
  const f = fixture();
  try {
    const before = f.snapshot();
    expect(() => f.coordinate(true)).toThrow("coordinator failed");
    expect(f.snapshot()).toEqual(before);
    expect(f.coordinate().version).toBe(4);
  } finally { f.dispose(); }
});

test("attachment preserves pending gaps and sorts claimed sequences without moving the frontier", () => {
  const f = fixture();
  try {
    const later = f.accept("later");
    const row = f.db.query("SELECT source_hash FROM service_effect_s01_sources WHERE source_id='later'").get() as { source_hash: string };
    const request = seal({ ...f.request, effect: { ...f.request.effect, sourceSeq: later.sourceSeq, idempotencyKey: "attach-later" },
      sourceId: "later", sourceHash: row.source_hash, payloadRef: later.payloadRef }, "attachQueuedSource.v1");
    expect(f.attach(request).claimedSourceSeqs).toEqual([1, later.sourceSeq]);
    expect(f.work.getAcceptedSource("web:terminal", "queued")?.state).toBe("pending");
    const next = seal({ ...f.request, expectedVersion: 4, effect: { ...f.request.effect } }, "attachQueuedSource.v1");
    expect(f.attach(next).claimedSourceSeqs).toEqual([1, f.source.sourceSeq, later.sourceSeq]);
    expect(f.db.query("SELECT consumed_through_source_seq, next_source_seq FROM service_effect_s01_chats").get())
      .toEqual({ consumed_through_source_seq: 0, next_source_seq: 4 });
  } finally { f.dispose(); }
});

test("attachment rejects malformed/versionless authority and async writer guards without effects", () => {
  const f = fixture();
  try {
    const before = f.snapshot();
    for (const patch of [{ unexpected: true }, { sourceHash: "invalid" }, { expectedVersion: 0 },
      { expectedHarness: { ...f.request.expectedHarness, state: "finished" } },
      { effect: { ...f.request.effect, sourceSeq: null } }, { effect: { ...f.request.effect, requestHash: "a".repeat(64) } }]) {
      const request = { ...f.request, ...patch };
      expect(() => f.attach(request as AttachQueuedSourceRequest)).toThrow("invalid_transition");
      expect(f.snapshot()).toEqual(before);
    }
    const made = createCurrentPiclawServiceWorkStore(f.db, { hitFault: () => false, recordTrace() {},
      validateAcceptance: (() => Promise.resolve(true)) as unknown as () => boolean });
    if (!made.ok) throw Error("fixture");
    expect(() => f.db.transaction(() => made.value.attachQueuedSourceInTransaction(f.request, f.db))()).toThrow("owner_conflict");
    expect(f.snapshot()).toEqual(before);
  } finally { f.dispose(); }
});

test("attachment fences an older real EF-S02 terminal write", async () => {
  const f = fixture();
  try {
    const stale = terminalRequest({ expectedVersion: 3, expectedHarness: f.request.expectedHarness });
    f.coordinate();
    const before = f.snapshot();
    const result = await f.subject.store.commitTerminal(stale);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error._tag).toBe("version_mismatch");
    expect(f.snapshot()).toEqual(before);
  } finally { f.dispose(); }
});
