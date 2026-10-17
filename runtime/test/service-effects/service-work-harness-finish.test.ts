import { expect, test } from "bun:test";
import { hashCanonicalRequest, type CanonicalJsonValue } from "../../src/service-effects/contracts/common.js";
import { createCurrentPiclawServiceWorkStore, type FinishHarnessRequest } from "../../src/service-effects/current-piclaw/service-work-store.js";
import { terminalOperation, TERMINAL_HARNESS } from "../../src/service-effects/testing/contract-suites/terminal-settlement-store-contract.js";
import { openSqliteSubject } from "./terminal-settlement-test-support.js";

function fixture(validateAcceptance?: () => boolean) {
  const subject = openSqliteSubject(":memory:", [], false);
  const db = subject.database;
  const harness = { ...TERMINAL_HARNESS, state: "running" as const };
  subject.seedOperation(terminalOperation({ phase: "executing", harness }));
  let lost = false, fault = false;
  const made = createCurrentPiclawServiceWorkStore(db, { validateAcceptance, recordTrace() {}, hitFault(point, method) {
    if (method !== "finishHarness") return false;
    if (fault && point === "before_effect") return true;
    if (lost && point === "effect_then_lost_acknowledgement") { lost = false; return true; }
    return false;
  } });
  if (!made.ok) throw Error("fixture");
  const request = seal({ effect: { idempotencyKey: "finish", requestHash: "", operationId: "operation-1", sourceSeq: 1,
    provenanceRef: "host", redactionClass: "private" as const }, expectedVersion: 3, expectedHarness: harness });
  const snapshot = () => ["operations", "chats", "sources", "decisions"].map(t => db.query(`SELECT * FROM service_effect_s01_${t}`).all());
  return { subject, db, work: made.value, request, snapshot, loseAck() { lost = true; }, fail() { fault = true; } };
}
function seal<T extends FinishHarnessRequest>(r: T): T {
  return { ...r, effect: { ...r.effect, requestHash: hashCanonicalRequest({ method: "finishHarness.v1", ...r } as unknown as CanonicalJsonValue) } };
}

test("finish harness commits running -> finished/settling once, replays original decision and fences changed identity", async () => {
  const f = fixture();
  try {
    const result = await f.work.finishHarness(f.request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error("finish");
    expect(result.value.version).toBe(4);
    expect(result.value.phase).toBe("settling");
    expect(result.value.harness).toEqual({ ...f.request.expectedHarness, state: "finished" });
    const committed = f.snapshot();
    expect(await f.work.finishHarness(f.request)).toEqual(result);
    expect(f.snapshot()).toEqual(committed);
    const changed = await f.work.finishHarness(seal({ ...f.request, expectedVersion: 4 }));
    expect(!changed.ok && changed.error._tag).toBe("idempotency_conflict");
    const fresh = await f.work.finishHarness(seal({ ...f.request, expectedVersion: 4, effect: { ...f.request.effect, idempotencyKey: "fresh" } }));
    expect(!fresh.ok && fresh.error._tag).toBe("owner_conflict");
    expect(f.snapshot()).toEqual(committed);
  } finally { f.subject.dispose?.(); }
});

for (const check of [1, 2]) for (const denial of ["false", "reject", "thenable"] as const) {
  test(`finish harness writer fence ${denial} at check ${check} rolls back and observes invalid async guard`, async () => {
    let calls = 0;
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on("unhandledRejection", onUnhandled);
    const f = fixture((() => {
      if (++calls !== check) return true;
      if (denial === "reject") return Promise.reject(Error("private writer failure"));
      if (denial === "thenable") return { then() { throw Error("private writer failure"); } };
      return false;
    }) as () => boolean);
    try {
      const before = f.snapshot();
      expect(await f.work.finishHarness(f.request)).toEqual({ ok: false,
        error: { _tag: "owner_conflict", certainty: "not_applied", retryable: false } });
      expect(calls).toBe(check);
      expect(f.snapshot()).toEqual(before);
      await Bun.sleep(0);
      expect(unhandled).toEqual([]);
      expect(f.snapshot()).toEqual(before);
    } finally { process.off("unhandledRejection", onUnhandled); f.subject.dispose?.(); }
  });
}

for (const patch of [{ sessionId: "foreign" }, { lane: "foreign" }, { harnessOperationId: "foreign" }, { watchGeneration: 999 }, { state: "finished" as const }]) {
  test(`finish rejects changed harness ${JSON.stringify(patch)} without mutation`, async () => {
    const f = fixture();
    try {
      const before = f.snapshot();
      const r = await f.work.finishHarness(seal({ ...f.request, expectedHarness: { ...f.request.expectedHarness, ...patch } }));
      expect(r.ok).toBe(false);
      expect(f.snapshot()).toEqual(before);
    } finally { f.subject.dispose?.(); }
  });
}

for (const mutation of [
  "UPDATE service_effect_s01_operations SET version=version+1",
  "UPDATE service_effect_s01_chats SET active_operation_id=NULL",
  "UPDATE service_effect_s01_operations SET phase='terminal'",
  "UPDATE service_effect_s01_operations SET phase='suspended'",
]) {
  test(`finish fences stale completion: ${mutation}`, async () => {
    const f = fixture();
    try {
      f.db.exec(mutation);
      const before = f.snapshot();
      expect((await f.work.finishHarness(f.request)).ok).toBe(false);
      expect(f.snapshot()).toEqual(before);
    } finally { f.subject.dispose?.(); }
  });
}

test("finish preserves accepted cancellation and active ownership while moving cancelling -> settling", async () => {
  const f = fixture();
  try {
    f.db.exec("UPDATE service_effect_s01_operations SET phase='cancelling', cancellation_source_id='cancel', cancellation_source_seq=1, cancellation_cause='user', cancellation_requested_at='2026-08-14T09:00:00.000Z'");
    const before = await f.work.getOperation("operation-1");
    const result = await f.work.finishHarness(f.request);
    expect(result.ok).toBe(true);
    if (result.ok && before.ok) expect(result.value.cancellation).toEqual(before.value!.cancellation);
    expect(f.db.query("SELECT active_operation_id FROM service_effect_s01_chats").get()).toEqual({ active_operation_id: "operation-1" });
  } finally { f.subject.dispose?.(); }
});

test("finish lost acknowledgement is replayable; invalid hash and pre-effect fault do not mutate", async () => {
  const f = fixture();
  try {
    const before = f.snapshot();
    expect((await f.work.finishHarness({ ...f.request, effect: { ...f.request.effect, requestHash: "a".repeat(64) } })).ok).toBe(false);
    expect(f.snapshot()).toEqual(before);
    f.loseAck();
    const lost = await f.work.finishHarness(f.request);
    expect(!lost.ok && lost.error.certainty).toBe("unknown");
    expect((await f.work.finishHarness(f.request)).ok).toBe(true);
  } finally { f.subject.dispose?.(); }
  const g = fixture();
  try { g.fail(); const before = g.snapshot(); expect((await g.work.finishHarness(g.request)).ok).toBe(false); expect(g.snapshot()).toEqual(before); }
  finally { g.subject.dispose?.(); }
});
