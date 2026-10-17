import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { createTempWorkspace, setEnv } from "../helpers.js";
import { closeDatabase, getDb, initDatabase } from "../../src/db/connection.js";
import { getWebPreviewMaxChars } from "../../src/db/web-content.js";
import { admitWebUserMessage, type WebUserMessageStoreOptions } from "../../src/channels/web/messaging/message-store.js";
import { hashCanonicalRequest, type CanonicalJsonValue } from "../../src/service-effects/contracts/common.js";
import type { AcceptSourceRequest } from "../../src/service-effects/contracts/service-work-store.js";
import { installServiceWorkSchema } from "../../src/service-effects/current-piclaw/service-work-schema.js";
import { createCurrentPiclawServiceWorkStore, EffectAdmissionError, type ServiceWorkAcceptanceRuntime } from "../../src/service-effects/current-piclaw/service-work-store.js";

let cleanup = () => {};
afterEach(() => { closeDatabase(); cleanup(); });
function fixture(overrides: Partial<ServiceWorkAcceptanceRuntime> = {}) {
  const ws = createTempWorkspace("atomic-source-admission-");
  const restore = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  cleanup = () => { restore(); ws.cleanup(); };
  initDatabase();
  const db = getDb();
  installServiceWorkSchema(db); // Explicit fixture setup, never a production migration.
  db.query("INSERT INTO chats(jid, name, last_message_time) VALUES (?, ?, ?)").run("web:atomic", "Fixture", "2026-08-13T00:00:00.000Z");
  const made = createCurrentPiclawServiceWorkStore(db, { hitFault: () => false, recordTrace() {}, ...overrides });
  if (!made.ok) throw Error("fixture construction");
  return { db, store: made.value };
}
function seal(input: AcceptSourceRequest): AcceptSourceRequest {
  return { ...input, effect: { ...input.effect, requestHash: hashCanonicalRequest({ ...input,
    effect: { ...input.effect, requestHash: "" } } as unknown as CanonicalJsonValue) } };
}
function request(id = "host-source"): AcceptSourceRequest {
  return seal({ effect: { idempotencyKey: id, requestHash: "", operationId: null, sourceSeq: null,
    provenanceRef: "engine:legacy", redactionClass: "private" }, chatJid: "web:atomic", sourceId: id,
    kind: "message", payloadRef: `message:${id}`, targetOperationId: null, parentSourceSeq: null,
    acceptedAt: "2026-08-13T07:00:00.000Z", createWakeIntent: false });
}
const channel = { broadcastEvent() {} };
const params = { chatJid: "web:atomic", content: "private ordinary input", isBot: false, mediaIds: [], agentId: "default", agentName: "Fixture" };
function admit(options: WebUserMessageStoreOptions, authorise: (phase?: "before" | "after") => void = () => {}) {
  return admitWebUserMessage(channel, params, options, authorise, new AbortController().signal);
}
function snapshot(db: Database) {
  return ["messages", "chats", "media", "message_media", "sqlite_sequence", "service_effect_s01_chats", "service_effect_s01_sources",
    "service_effect_s01_decisions", "service_effect_s01_wake_intents"].map(table => db.query(`SELECT * FROM ${table}`).all());
}
function coordinator(store: ReturnType<typeof fixture>["store"], after?: () => void): WebUserMessageStoreOptions {
  return { acceptSource({ message, rowId, database }) {
    expect(database.inTransaction).toBe(true);
    const input = seal({ ...request(message.id), chatJid: message.chat_jid, acceptedAt: message.timestamp,
      payloadRef: `message-row:${rowId}` });
    const receipt = store.acceptSourceInTransaction(input, database);
    expect(receipt.sourceId).toBe(message.id);
    after?.();
  } };
}

test("actual web admission commits timeline + source + decision on its owned connection", async () => {
  const { db, store } = fixture();
  const row = await admit(coordinator(store));
  expect(row!.id).toBeGreaterThan(0);
  const source = db.query("SELECT * FROM service_effect_s01_sources").get() as Record<string, unknown>;
  const message = db.query("SELECT id, timestamp FROM messages").get() as { id: string; timestamp: string };
  expect(source.source_id).toBe(message.id);
  expect(source.accepted_at).toBe(message.timestamp);
  expect(source.payload_ref).toBe(`message-row:${row!.id}`);
  expect(source.provenance_ref).toBe("engine:legacy");
  expect(JSON.stringify(source)).not.toContain(params.content);
  expect(db.query("SELECT * FROM service_effect_s01_decisions").all()).toHaveLength(1);
  expect(db.query("SELECT * FROM service_effect_s01_wake_intents").all()).toHaveLength(0);
});

for (const phase of ["before", "after"] as const) {
  test(`source ownership denial ${phase} apply rolls back host and every source table`, async () => {
    let checks = 0;
    const { db, store } = fixture({ validateAcceptance: () => ++checks !== (phase === "before" ? 1 : 2) });
    const before = snapshot(db);
    await expect(admit(coordinator(store))).rejects.toThrow("owner_conflict");
    expect(snapshot(db)).toEqual(before);
  });
}

test("fault after S01 receipt and host after-authority rejection each roll back both sides", async () => {
  const { db, store } = fixture(); const before = snapshot(db);
  await expect(admit(coordinator(store, () => { throw Error("after S01"); }))).rejects.toThrow("after S01");
  expect(snapshot(db)).toEqual(before);
  await expect(admit(coordinator(store), phase => { if (phase === "after") throw Error("writer flipped"); })).rejects.toThrow("writer flipped");
  expect(snapshot(db)).toEqual(before);
});

test("writer flips before callback: source guard rejects rather than accepting stale selection", async () => {
  let writer = "legacy";
  const { db, store } = fixture({ validateAcceptance: () => writer === "legacy" });
  const before = snapshot(db), options = coordinator(store);
  await expect(admit({ acceptSource(stored) { writer = "candidate"; options.acceptSource!(stored); } })).rejects.toThrow("owner_conflict");
  expect(snapshot(db)).toEqual(before);
});

test("requires same connection and active transaction; no own transaction or implicit schema setup", () => {
  const { db, store } = fixture(); const input = request();
  expect(() => store.acceptSourceInTransaction(input, db)).toThrow(EffectAdmissionError);
  const other = new Database(":memory:");
  try {
    other.transaction(() => expect(() => store.acceptSourceInTransaction(input, other)).toThrow("owner_conflict"))();
    db.transaction(() => expect(() => store.acceptSourceInTransaction(input, other)).toThrow("owner_conflict"))();
    expect(db.query("SELECT * FROM service_effect_s01_sources").all()).toHaveLength(0);
  } finally { other.close(); }
});

test("replay is observational with denied owner; canonical mismatch and semantic conflict throw", async () => {
  let allowed = true;
  const { db, store } = fixture({ validateAcceptance: () => allowed });
  const input = request();
  const accepted = db.transaction(() => store.acceptSourceInTransaction(input, db))();
  const before = snapshot(db); allowed = false;
  expect(db.transaction(() => store.acceptSourceInTransaction(input, db))()).toEqual(accepted);
  expect(snapshot(db)).toEqual(before);
  allowed = true;
  const conflict = seal({ ...input, payloadRef: "message:changed" });
  await expect(admit({ acceptSource: ({ database }) => { store.acceptSourceInTransaction(conflict, database); } })).rejects.toThrow("idempotency_conflict");
  await expect(admit({ acceptSource: ({ database }) => { store.acceptSourceInTransaction({ ...input, payloadRef: "unsealed" }, database); } })).rejects.toThrow("invalid_transition");
  const semanticConflict = seal({ ...conflict, effect: { ...conflict.effect, idempotencyKey: "different-effect" } });
  await expect(admit({ acceptSource: ({ database }) => { store.acceptSourceInTransaction(semanticConflict, database); } })).rejects.toThrow("idempotency_conflict");
  expect(snapshot(db)).toEqual(before);
});

test("before-effect faults abort outer admission; no precommit lost-ack fault or applied trace", async () => {
  const points: string[] = [], traces: unknown[] = [];
  let failAt = 1;
  const { db, store } = fixture({ hitFault(point) { points.push(point); return points.length === failAt; }, recordTrace(trace) { traces.push(trace); } });
  const before = snapshot(db);
  await expect(admit(coordinator(store))).rejects.toThrow("storage_unavailable");
  expect(snapshot(db)).toEqual(before);
  points.length = 0; failAt = 2;
  await expect(admit(coordinator(store))).rejects.toThrow("storage_unavailable");
  expect(snapshot(db)).toEqual(before);
  points.length = 0; failAt = 0;
  await admit(coordinator(store));
  expect(points).toEqual(["before_effect", "before_effect"]);
  expect(JSON.stringify(traces)).not.toContain('"certainty":"applied"');
});

test("confirmed outer contention rollback retries stable host/source identity without duplicate wake", async () => {
  const { db, store } = fixture(); let attempts = 0; const ids: string[] = [];
  const options = coordinator(store);
  await admit({ acceptSource(stored) {
    ids.push(stored.message.id); options.acceptSource!(stored);
    if (++attempts === 1) throw Object.assign(Error("retry"), { code: "SQLITE_BUSY" });
  } });
  expect(attempts).toBe(2); expect(new Set(ids).size).toBe(1);
  expect(db.query("SELECT * FROM messages").all()).toHaveLength(1);
  expect(db.query("SELECT * FROM service_effect_s01_sources").all()).toHaveLength(1);
  expect(db.query("SELECT * FROM service_effect_s01_decisions").all()).toHaveLength(1);
  expect(db.query("SELECT next_source_seq FROM service_effect_s01_chats").get()).toEqual({ next_source_seq: 2 });
});

test("cancellation after source and wake writes rolls back all effects; preflight never calls coordinator", async () => {
  const { db, store } = fixture(); const before = snapshot(db);
  const abort = new AbortController(); let calls = 0;
  const options: WebUserMessageStoreOptions = { acceptSource({ message, rowId, database }) {
    calls++;
    store.acceptSourceInTransaction(seal({ ...request(message.id), acceptedAt: message.timestamp,
      payloadRef: `message-row:${rowId}`, createWakeIntent: true }), database);
    expect(db.query("SELECT * FROM service_effect_s01_wake_intents").all()).toHaveLength(1);
    abort.abort(Error("cancel after SQL"));
  } };
  await expect(admitWebUserMessage(channel, params, options, () => {}, abort.signal)).rejects.toThrow("cancel after SQL");
  expect(calls).toBe(1); expect(snapshot(db)).toEqual(before);
  await expect(admitWebUserMessage(channel, { ...params, mediaIds: [999999] }, options, () => {}, new AbortController().signal)).rejects.toThrow("unavailable");
  expect(calls).toBe(1); expect(snapshot(db)).toEqual(before);
  const deferred = await admitWebUserMessage(channel, params, options, () => {}, new AbortController().signal, () => true);
  expect(deferred).toBeNull(); expect(calls).toBe(1); expect(snapshot(db)).toEqual(before);
});

for (const denial of ["async", "true", "object", "resolved", "rejected", "throwing-thenable", "throwing-then-getter", "async-throw-after-write"] as const) {
  test(`non-undefined source callback ${denial} rolls back host/media/source/wake and observes rejection`, async () => {
    const traces: unknown[] = [], unhandled: unknown[] = [];
    const { db, store } = fixture({ recordTrace(trace) { traces.push(trace); } });
    const before = snapshot(db), secret = "protected-source-callback-secret";
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    const thenableTransactions: boolean[] = [];
    process.on("unhandledRejection", onUnhandled);
    try {
      const options: WebUserMessageStoreOptions = { acceptSource(stored) {
        store.acceptSourceInTransaction(seal({ ...request(stored.message.id),
          payloadRef: `message-row:${stored.rowId}`, createWakeIntent: true }), stored.database);
        expect(db.query("SELECT * FROM media").all()).toHaveLength(1);
        expect(db.query("SELECT * FROM message_media").all()).toHaveLength(1);
        expect(db.query("SELECT * FROM service_effect_s01_wake_intents").all()).toHaveLength(1);
        if (denial === "async") return (async () => {})();
        if (denial === "true") return true;
        if (denial === "object") return {};
        if (denial === "resolved") return Promise.resolve(undefined);
        if (denial === "rejected") return Promise.reject(Error(secret));
        if (denial === "throwing-thenable") return { then() {
          thenableTransactions.push(db.inTransaction); throw Error(secret);
        } };
        if (denial === "throwing-then-getter") return { get then() { throw Error(secret); } };
        return undefined;
      } };
      if (denial === "async-throw-after-write") {
        const write = options.acceptSource!;
        options.acceptSource = async stored => { write(stored); throw Error(secret); };
      }
      let failure: unknown;
      try {
        await admitWebUserMessage(channel, { ...params, content: "x".repeat(getWebPreviewMaxChars() + 1) },
          options, () => {}, new AbortController().signal);
      } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe("Source admission callback must be synchronous");
      expect((failure as Error).cause).toBeUndefined();
      expect(snapshot(db)).toEqual(before);
      await Bun.sleep(0);
      expect(unhandled).toEqual([]);
      expect(thenableTransactions).toEqual(denial === "throwing-thenable" ? [false] : []);
      expect(snapshot(db)).toEqual(before);
      expect(JSON.stringify(traces)).not.toContain(secret);
    } finally { process.off("unhandledRejection", onUnhandled); }
  });
}

test("async source callback awaiting before write is denied and late guarded write rejects outside transaction", async () => {
  const { db, store } = fixture(), before = snapshot(db);
  const unhandled: unknown[] = [], continuationTransactions: boolean[] = [];
  const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
  process.on("unhandledRejection", onUnhandled);
  try {
    await expect(admit({ async acceptSource({ database }) {
      await Promise.resolve();
      continuationTransactions.push(database.inTransaction);
      // Trusted callbacks must remain SQL-sync-only; arbitrary raw SQL after await cannot be cancelled.
      store.acceptSourceInTransaction(request("late-source"), database);
    } })).rejects.toThrow("Source admission callback must be synchronous");
    await Bun.sleep(0);
    expect(continuationTransactions).toEqual([false]);
    expect(unhandled).toEqual([]);
    expect(snapshot(db)).toEqual(before);
  } finally { process.off("unhandledRejection", onUnhandled); }
});

test("exact undefined callback succeeds and synchronous typed admission errors propagate unchanged", async () => {
  const { db, store } = fixture();
  expect(await admit({ acceptSource: () => undefined })).not.toBeNull();
  const before = snapshot(db), failure = new EffectAdmissionError("owner_conflict");
  await expect(admit(coordinator(store, () => { throw failure; }))).rejects.toBe(failure);
  expect(snapshot(db)).toEqual(before);
});

test("invalid parent after ensureChat cannot leave partial source writes when propagated", async () => {
  const { db, store } = fixture(); const before = snapshot(db);
  const bad = seal({ ...request(), parentSourceSeq: 99, createWakeIntent: true });
  await expect(admit({ acceptSource: ({ database }) => { store.acceptSourceInTransaction(bad, database); } })).rejects.toThrow("not_found");
  expect(snapshot(db)).toEqual(before);
});
