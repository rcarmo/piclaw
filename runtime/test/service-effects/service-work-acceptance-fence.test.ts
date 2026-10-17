import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { hashCanonicalRequest, type CanonicalJsonValue } from "../../src/service-effects/contracts/common.js";
import { installServiceWorkSchema } from "../../src/service-effects/current-piclaw/service-work-schema.js";
import { createCurrentPiclawServiceWorkStore, type ServiceWorkAcceptanceRuntime } from "../../src/service-effects/current-piclaw/service-work-store.js";

function request(id: string) {
  const input = { effect: { idempotencyKey: id, requestHash: "", operationId: null, sourceSeq: null,
    provenanceRef: "opaque:test", redactionClass: "private" }, chatJid: "web:fence", sourceId: id,
    kind: "message" as const, payloadRef: `opaque:${id}`, targetOperationId: null, parentSourceSeq: null,
    acceptedAt: "2026-08-13T07:00:00.000Z", createWakeIntent: true };
  return { ...input, effect: { ...input.effect, requestHash: hashCanonicalRequest(input as CanonicalJsonValue) } };
}
function snapshot(db: Database) {
  return ["chats", "sources", "wake_intents", "decisions"].map(table =>
    db.query(`SELECT * FROM service_effect_s01_${table}`).all());
}
for (const denial of [false, undefined, "true", "throw", "promise", "async-reject", "rejected-promise", "thenable-reject", "then-getter-throw", "function-thenable", "object"] as const) {
  for (const phase of ["before", "after"] as const) {
    test(`acceptance fence: ${phase} apply ${String(denial)} rolls back all source effects`, async () => {
      const db = new Database(":memory:", { strict: true });
      installServiceWorkSchema(db);
      let calls = 0;
      const traces: unknown[] = [];
      const thenableTransactions: boolean[] = [];
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
      process.on("unhandledRejection", onUnhandled);
      const runtime: ServiceWorkAcceptanceRuntime = { hitFault: () => false, recordTrace(input) { traces.push(input); }, validateAcceptance: (() => {
        expect(db.inTransaction).toBe(true);
        if (++calls === (phase === "before" ? 1 : 2)) {
          if (denial === "throw") throw Error("protected-acceptance-guard-secret");
          if (denial === "promise") return Promise.resolve(true);
          if (denial === "async-reject") return (async () => { throw Error("protected-acceptance-guard-secret"); })();
          if (denial === "rejected-promise") return Promise.reject(Error("protected-acceptance-guard-secret"));
          if (denial === "thenable-reject") return { then() { thenableTransactions.push(db.inTransaction); throw Error("protected-acceptance-guard-secret"); } };
          if (denial === "then-getter-throw") return { get then() { throw Error("protected-acceptance-guard-secret"); } };
          if (denial === "function-thenable") return Object.assign(() => undefined, { then() { thenableTransactions.push(db.inTransaction); throw Error("protected-acceptance-guard-secret"); } });
          if (denial === "object") return {};
          return denial;
        }
        return true;
      }) as () => boolean }; // Invalid JavaScript callers must fail closed too.
      try {
        const created = createCurrentPiclawServiceWorkStore(db, runtime);
        if (!created.ok) throw Error("construction");
        const before = snapshot(db), result = await created.value.acceptSource(request("denied"));
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error._tag).toBe("owner_conflict");
          expect(result.error.certainty).toBe("not_applied");
          expect(JSON.stringify(result)).not.toContain("secret");
        }
        expect(calls).toBe(phase === "before" ? 1 : 2);
        expect(snapshot(db)).toEqual(before);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(unhandled).toEqual([]);
        expect(thenableTransactions).toEqual(denial === "thenable-reject" || denial === "function-thenable" ? [false] : []);
        expect(snapshot(db)).toEqual(before);
        expect(JSON.stringify(traces)).not.toContain("protected-acceptance-guard-secret");
      } finally { process.off("unhandledRejection", onUnhandled); db.close(); }
    });
  }
}
test("acceptance fence: caller await cannot retain writer permission; committed replay remains observational", async () => {
  const db = new Database(":memory:", { strict: true }); installServiceWorkSchema(db);
  db.exec("CREATE TABLE writer (id TEXT); INSERT INTO writer VALUES ('legacy')");
  const created = createCurrentPiclawServiceWorkStore(db, { hitFault: () => false, recordTrace() {}, validateAcceptance() {
    expect(db.inTransaction).toBe(true);
    return (db.query("SELECT id FROM writer").get() as { id: string }).id === "legacy";
  } });
  if (!created.ok) throw Error("construction");
  try {
    const committed = request("committed"); expect((await created.value.acceptSource(committed)).ok).toBe(true);
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    const pending = (async () => { await hold; return created.value.acceptSource(request("stale")); })();
    db.exec("UPDATE writer SET id='candidate'"); const before = snapshot(db); release();
    const rejected = await pending;
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error._tag).toBe("owner_conflict");
    expect((await created.value.acceptSource(committed)).ok).toBe(true);
    expect(snapshot(db)).toEqual(before);
  } finally { db.close(); }
});
