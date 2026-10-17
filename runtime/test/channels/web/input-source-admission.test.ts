import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createDurableQueuedSteering } from '../../../src/agent-pool/durable-queued-steering.js';
import { createDurableRecoveryDispatch } from '../../../src/agent-pool/durable-recovery-dispatch.js';
import { storeWebMessage } from '../../../src/channels/web/messaging/message-store.js';
import { createDurableQueueDispatch } from "../../../src/agent-pool/durable-queue-dispatch.js";
import { createDurableConversationAdapter } from "../../../src/agent-pool/durable-runtime-adapter.js";
import { join } from "node:path";
import { createTempWorkspace, setEnv } from "../../helpers.js";
import { closeDatabase, getDb, initDatabase } from "../../../src/db/connection.js";
import { WebChannel, type WebChannelOpts } from "../../../src/channels/web.js";
import type { WebUserMessageStoreOptions } from "../../../src/channels/web/messaging/message-store.js";
import { installServiceWorkSchema } from "../../../src/service-effects/current-piclaw/service-work-schema.js";
import { createCurrentPiclawServiceWorkStore } from "../../../src/service-effects/current-piclaw/service-work-store.js";
import { hashCanonicalRequest, type CanonicalJsonValue } from "../../../src/service-effects/contracts/common.js";
import type { AcceptSourceRequest } from "../../../src/service-effects/contracts/service-work-store.js";
import { resetRateLimiterStateForTests } from "../../../src/channels/web/http/rate-limit.js";
import { acceptQueuedInputSource, QueuedFollowupLifecycleService } from "../../../src/channels/web/runtime/queued-followup-lifecycle-service.js";
import { getDeferredQueuedFollowups, setDeferredQueuedFollowups } from "../../../src/db.js";

let cleanup = () => {};
afterEach(() => { closeDatabase(); cleanup(); resetRateLimiterStateForTests(); });
function fixture(select?: WebChannelOpts["getInputSourceAdmission"], validateAcceptance?: () => boolean) {
  const ws = createTempWorkspace("http-source-admission-");
  const restore = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  cleanup = () => { restore(); ws.cleanup(); };
  mkdirSync(join(ws.workspace, ".piclaw"), { recursive: true });
  writeFileSync(join(ws.workspace, ".piclaw/config.json"), JSON.stringify({ domains: { access: { mode: "single-user" } } }));
  initDatabase();
  const db = getDb();
  installServiceWorkSchema(db); // Fixture-only, not production activation.
  db.query("INSERT INTO chats(jid, name, last_message_time) VALUES (?, ?, ?)").run("web:default", "Fixture", "2026-08-13T00:00:00.000Z");
  const made = createCurrentPiclawServiceWorkStore(db, { hitFault: () => false, recordTrace() {}, validateAcceptance });
  if (!made.ok) throw Error("fixture construction");
  const events: string[] = [], jobs: Array<{ key: string; lane?: string; task: () => Promise<void> }> = [];
  let expectedSources = 0;
  let active = false, streaming = false;
  const channel = new WebChannel({
    queue: { enqueue(task: () => Promise<void>, key: string, lane?: string) {
      expect(db.inTransaction).toBe(false);
      expect(db.query("SELECT * FROM service_effect_s01_sources").all()).toHaveLength(expectedSources);
      jobs.push({ key, lane, task });
    } } as any,
    agentPool: { setSessionBinder() {}, isStreaming: () => streaming, isActive: () => active } as any,
    ...(select ? { getInputSourceAdmission: select } : {}),
  });
  channel.broadcastEvent = type => {
    expect(db.inTransaction).toBe(false);
    expect(db.query("SELECT * FROM service_effect_s01_sources").all()).toHaveLength(expectedSources);
    events.push(type);
  };
  const accept: NonNullable<WebUserMessageStoreOptions["acceptSource"]> = ({ message, rowId, database }) => {
    expect(database).toBe(db);
    expect(database.inTransaction).toBe(true);
    const input: AcceptSourceRequest = {
      effect: { idempotencyKey: message.id, requestHash: "", operationId: null, sourceSeq: null,
        provenanceRef: "engine:host-selected", redactionClass: "private" },
      chatJid: message.chat_jid, sourceId: message.id, kind: "message", payloadRef: `message-row:${rowId}`,
      targetOperationId: null, parentSourceSeq: null, acceptedAt: message.timestamp, createWakeIntent: false,
    };
    input.effect.requestHash = hashCanonicalRequest(input as unknown as CanonicalJsonValue);
    made.value.acceptSourceInTransaction(input, database);
  };
  const acceptQueued: NonNullable<ReturnType<NonNullable<WebChannelOpts["getQueuedInputSourceAdmission"]>>> = ({ chatJid, item, database }) => {
    expect(database).toBe(db);
    expect(database.inTransaction).toBe(true);
    const sourceId = item.source_id;
    const input: AcceptSourceRequest = {
      effect: { idempotencyKey: `${chatJid}:${sourceId}`, requestHash: "", operationId: null, sourceSeq: null,
        provenanceRef: "engine:host-selected", redactionClass: "private" },
      chatJid, sourceId, kind: "message", payloadRef: `queued-source:${sourceId}`,
      targetOperationId: null, parentSourceSeq: null, acceptedAt: item.queuedAt, createWakeIntent: false,
    };
    const { source_accepted, materializeRetries, ...immutableInput } = item;
    input.effect.provenanceRef += `:${hashCanonicalRequest(JSON.parse(JSON.stringify(immutableInput)) as CanonicalJsonValue)}`;
    input.effect.requestHash = hashCanonicalRequest(input as unknown as CanonicalJsonValue);
    made.value.acceptSourceInTransaction(input, database);
  };
  const route = (body: Record<string, unknown> = { content: "ordinary input" }, signal?: AbortSignal) => channel.handleRequest(new Request(
    "http://fixture/agent/default/message", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://fixture" },
      body: JSON.stringify(body), signal }));
  const snapshot = () => ["chat_cursors", "messages", "chats", "media", "message_media", "sqlite_sequence", "service_effect_s01_chats",
    "service_effect_s01_sources", "service_effect_s01_decisions", "service_effect_s01_wake_intents"].map(table => db.query(`SELECT * FROM ${table}`).all());
  return { channel, db, work: made.value, accept, acceptQueued, route, snapshot, events, jobs,
    expectSources(count: number) { expectedSources = count; },
    busy(value: boolean, stream = false) { active = value; streaming = stream; } };
}

function withdrawalFixture() {
  const f = fixture(undefined, () => true);
  f.channel.getQueuedInputSourceAdmission = () => f.acceptQueued;
  f.busy(true);
  const withdraw: NonNullable<ReturnType<NonNullable<WebChannelOpts['getQueuedInputSourceWithdrawal']>>> = ({ chatJid, item, database }) => {
    const accepted = f.work.getAcceptedSource(chatJid, item.source_id)!;
    const { source_accepted, materializeRetries, ...immutableInput } = item;
    expect(accepted.provenanceRef).toBe(`engine:host-selected:${hashCanonicalRequest(JSON.parse(JSON.stringify(immutableInput)) as CanonicalJsonValue)}`);
    const sourceHash = (database.query('SELECT source_hash FROM service_effect_s01_sources WHERE chat_jid=? AND source_id=?').get(chatJid, item.source_id) as { source_hash: string }).source_hash;
    const request = { effect: { idempotencyKey: `withdraw:${item.source_id}`, requestHash: '', operationId: null, sourceSeq: null,
      provenanceRef: 'host:queue-remove', redactionClass: 'private' as const }, chatJid, sourceId: item.source_id,
      sourceHash, payloadRef: `queued-source:${item.source_id}`, actor: 'single-user' };
    request.effect.requestHash = hashCanonicalRequest({ method: 'withdrawUnclaimedSource.v1', ...request } as unknown as CanonicalJsonValue);
    f.work.withdrawUnclaimedSourceInTransaction(request, database);
  };
  f.channel.getQueuedInputSourceWithdrawal = () => withdraw;
  const remove = (rowId: number, path = '/agent/queue-remove') => f.channel.handleRequest(new Request(`http://fixture${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://fixture' }, body: JSON.stringify({ row_id: rowId }) }));
  return { ...f, withdraw, remove };
}

test('accepted HTTP queue withdrawal is atomic, private, duplicate-safe and preserves FIFO', async () => {
  const f = withdrawalFixture();
  f.expectSources(1); expect((await f.route({ content: 'first queued' })).status).toBe(201);
  f.expectSources(2); expect((await f.route({ content: 'second queued' })).status).toBe(201);
  const [first, second] = getDeferredQueuedFollowups('web:default');
  const response = await f.remove(first!.rowId);
  const body = await response.json(); expect(body.error).toBeUndefined();
  expect(response.status).toBe(200);
  expect(body.removed).toBe(true); expect(JSON.stringify(body)).not.toContain(first!.source_id!);
  expect(f.work.getAcceptedSource('web:default', first!.source_id!)?.state).toBe('disposed');
  expect(getDeferredQueuedFollowups('web:default').map(item => item.rowId)).toEqual([second!.rowId]);
  const frontier = await f.work.getChatFrontier('web:default'); expect(frontier.ok && frontier.value.consumedThroughSourceSeq).toBe(1);
  const before = f.snapshot(), events = f.events.length;
  expect((await (await f.remove(first!.rowId)).json()).removed).toBe(false);
  expect(f.snapshot()).toEqual(before); expect(f.events.length).toBe(events);
  const claim = { effect: { idempotencyKey: 'claim-after-withdrawal', requestHash: '', operationId: null, sourceSeq: null,
    provenanceRef: 'host', redactionClass: 'private' as const }, chatJid: 'web:default', expectedFrontier: 1,
    newOperationId: 'after-withdrawal', claimedAt: '2026-08-13T00:00:01.000Z' };
  claim.effect.requestHash = hashCanonicalRequest(claim as unknown as CanonicalJsonValue);
  const claimed = await f.work.claimNext(claim); expect(claimed.ok && claimed.value?.source.sourceSeq).toBe(2);
});

test('claimed accepted source cannot be withdrawn and missing queue cannot dispose materialized work', async () => {
  const f = withdrawalFixture(); f.expectSources(1); await f.route({ content: 'claimed queued' });
  const item = getDeferredQueuedFollowups('web:default')[0]!;
  const claim = { effect: { idempotencyKey: 'claimed-blocks-withdrawal', requestHash: '', operationId: null, sourceSeq: null,
    provenanceRef: 'host', redactionClass: 'private' as const }, chatJid: 'web:default', expectedFrontier: 0,
    newOperationId: 'claimed-blocks', claimedAt: '2026-08-13T00:00:01.000Z' };
  claim.effect.requestHash = hashCanonicalRequest(claim as unknown as CanonicalJsonValue);
  expect((await f.work.claimNext(claim)).ok).toBe(true);
  const before = f.snapshot(), events = f.events.length;
  expect((await f.remove(item.rowId)).status).toBe(500); expect(f.snapshot()).toEqual(before); expect(f.events.length).toBe(events);
  setDeferredQueuedFollowups('web:default', []);
  const materialized = f.snapshot();
  expect((await (await f.remove(item.rowId)).json()).removed).toBe(false);
  expect(f.snapshot()).toEqual(materialized);
});

test('steer never invokes registered withdrawal or creates legacy work for accepted input', async () => {
  const f = withdrawalFixture(); f.expectSources(1); await f.route({ content: 'do not steer' });
  const item = getDeferredQueuedFollowups('web:default')[0]!;
  let calls = 0; f.channel.getQueuedInputSourceWithdrawal = () => () => { calls++; };
  const before = f.snapshot(), jobs = f.jobs.length;
  const response = await f.remove(item.rowId, '/agent/queue-steer');
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: 'Accepted input requires host cancellation' });
  expect(calls).toBe(0); expect(f.snapshot()).toEqual(before); expect(f.jobs.length).toBe(jobs);
});

test('withdrawal callback post-write failure rolls back source, queue and publication', async () => {
  const f = withdrawalFixture(); f.expectSources(1); await f.route({ content: 'rollback queued' });
  const item = getDeferredQueuedFollowups('web:default')[0]!;
  f.channel.getQueuedInputSourceWithdrawal = () => stored => { f.withdraw(stored); throw Error('after source write'); };
  const before = f.snapshot(), events = f.events.length;
  expect((await f.remove(item.rowId)).status).toBe(500);
  expect(f.snapshot()).toEqual(before); expect(f.events.length).toBe(events);
});

test('accepted withdrawal is denied without host hook and async callbacks roll back', async () => {
  const f = withdrawalFixture(); f.expectSources(1); await f.route({ content: 'deny queued' });
  const item = getDeferredQueuedFollowups('web:default')[0]!, before = f.snapshot();
  f.channel.getQueuedInputSourceWithdrawal = undefined;
  expect((await f.remove(item.rowId)).status).toBe(500); expect(f.snapshot()).toEqual(before);
  f.channel.getQueuedInputSourceWithdrawal = () => (stored => { f.withdraw(stored); return Promise.reject(Error('invalid async')); }) as any;
  expect((await f.remove(item.rowId)).status).toBe(500); expect(f.snapshot()).toEqual(before);
});

test('queue-remove rejects before selector on CSRF, ignores forged authority, and never calls withdrawal for missing rows', async () => {
  const f = withdrawalFixture(); f.expectSources(1); await f.route({ content: 'authority queued' });
  const item = getDeferredQueuedFollowups('web:default')[0]!;
  let selected = 0, called = 0;
  f.channel.getQueuedInputSourceWithdrawal = jid => {
    selected++; expect(jid).toBe('web:default');
    return stored => { called++; expect(stored.item.source_id).toBe(item.source_id); expect(stored.database.inTransaction).toBe(true); f.withdraw(stored); };
  };
  const before = f.snapshot();
  const request = (origin: string, extra: Record<string, unknown> = {}) => f.channel.handleRequest(new Request('http://fixture/agent/queue-remove', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ row_id: item.rowId, ...extra }) }));
  expect((await request('http://evil.invalid')).status).toBe(403);
  expect(selected).toBe(0); expect(called).toBe(0); expect(f.snapshot()).toEqual(before);
  setDeferredQueuedFollowups('web:default', []);
  expect((await (await request('http://fixture')).json()).removed).toBe(false);
  expect(called).toBe(0); expect(f.work.getAcceptedSource('web:default', item.source_id!)?.state).toBe('pending');
  setDeferredQueuedFollowups('web:default', [item]);
  expect((await request('http://fixture', { actor: 'forged', user: 'admin', engine: 'forged', source_id: 'forged', getQueuedInputSourceWithdrawal: 'forged', withdrawAcceptedSource: 'forged' })).status).toBe(200);
  expect(called).toBe(1);
  expect(f.work.getAcceptedSource('web:default', item.source_id!)?.state).toBe('disposed');
});

test('queue-remove callback errors are private and mismatched chat cannot withdraw the accepted source', async () => {
  const f = withdrawalFixture(); f.expectSources(1); await f.route({ content: 'private queue' });
  const item = getDeferredQueuedFollowups('web:default')[0]!;
  const before = f.snapshot(), events = f.events.length;
  f.channel.getQueuedInputSourceWithdrawal = () => stored => f.withdraw({ ...stored, chatJid: 'web:other' });
  const mismatch = await f.remove(item.rowId);
  expect(mismatch.status).toBe(500); expect(f.snapshot()).toEqual(before);
  f.channel.getQueuedInputSourceWithdrawal = () => () => { throw Error('PRIVATE_SOURCE_UUID_SECRET'); };
  const denied = await f.remove(item.rowId);
  expect(denied.status).toBe(500); expect(await denied.text()).not.toContain('PRIVATE_SOURCE_UUID_SECRET');
  expect(f.snapshot()).toEqual(before); expect(f.events.length).toBe(events);
  f.channel.getQueuedInputSourceWithdrawal = () => () => Promise.reject(Error('PRIVATE_ASYNC_SECRET')) as never;
  expect((await f.remove(item.rowId)).status).toBe(500);
  await Bun.sleep(0); // bun:test itself fails on any raw unhandled rejection.
  expect(f.snapshot()).toEqual(before);
});

test("HTTP default is off, including forged engine and callback fields", async () => {
  const f = fixture();
  expect(f.channel.getInputSourceAdmission).toBeUndefined();
  expect(f.channel.getQueuedInputSourceAdmission).toBeUndefined();
  expect(f.channel.dispatchAcceptedInput).toBeUndefined();
  expect(f.channel.getAcceptedQueuedSteering).toBeUndefined();
  const response = await f.route({ content: "ordinary input", engine: "durable", acceptSource: "forged", getInputSourceAdmission: "forged" });
  expect(response.status).toBe(201);
  expect(f.db.query("SELECT * FROM messages").all()).toHaveLength(1);
  expect(f.db.query("SELECT * FROM service_effect_s01_sources").all()).toHaveLength(0);
  expect(f.jobs).toHaveLength(1);
  expect(f.jobs[0].lane).toBe("chat:web:default");
});

test("actual HTTP + prototype + storage wrapper commit source and timeline before publication/wake", async () => {
  let callback: WebUserMessageStoreOptions["acceptSource"];
  const routes: string[] = [];
  const f = fixture(jid => { routes.push(jid); return callback; });
  callback = f.accept;
  f.expectSources(1);
  const response = await f.route({ content: "private input", engine: "untrusted-other-engine" });
  expect(response.status).toBe(201);
  expect(routes).toEqual(["web:default"]);
  const message = f.db.query("SELECT rowid, id, timestamp FROM messages").get() as any;
  const source = f.db.query("SELECT * FROM service_effect_s01_sources").get() as any;
  expect(source.source_id).toBe(message.id);
  expect(source.payload_ref).toBe(`message-row:${message.rowid}`);
  expect(source.accepted_at).toBe(message.timestamp);
  expect(source.provenance_ref).toBe("engine:host-selected");
  expect(f.db.query("SELECT * FROM service_effect_s01_decisions").all()).toHaveLength(1);
  expect(f.db.query("SELECT * FROM service_effect_s01_wake_intents").all()).toHaveLength(0);
  expect(f.events).toContain("new_post");
  expect(f.jobs).toHaveLength(1);
});

for (const failure of ["selection", "after-write", "async"] as const) test(`HTTP ${failure} failure exposes no private detail or accepted side effects`, async () => {
  let callback: WebUserMessageStoreOptions["acceptSource"];
  const f = fixture(() => { if (failure === "selection") throw Error("private selector detail"); return callback; });
  callback = stored => { f.accept(stored); if (failure === "async") return Promise.reject(Error("private callback detail")) as never; throw Error("private callback detail"); };
  const before = f.snapshot();
  const response = await f.route();
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private");
  expect(f.snapshot()).toEqual(before);
  expect(f.jobs).toEqual([]);
  expect(f.events).toEqual([]);
});

test("selection is captured before awaited HTTP body, even if coordinator is replaced", async () => {
  const f = fixture();
  let selected = 0;
  f.expectSources(1);
  f.channel.getInputSourceAdmission = () => { selected++; return f.accept; };
  let release!: () => void, reading!: () => void;
  const entered = new Promise<void>(resolve => { reading = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const req = new Request("http://fixture/agent/default/message", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://fixture" },
    body: new ReadableStream({ async pull(controller) { reading(); await gate; controller.enqueue(new TextEncoder().encode(JSON.stringify({ content: "delayed input", engine: "forged" }))); controller.close(); } }) });
  const pending = f.channel.handleRequest(req);
  await entered;
  // Wait until handler has pinned the callback, not merely until the stream prefetches.
  for (let n = 0; n < 100 && !selected; n++) await Bun.sleep(0);
  expect(selected).toBe(1);
  f.channel.getInputSourceAdmission = () => { throw Error("replacement must not be consulted"); };
  release();
  expect((await pending).status).toBe(201);
  expect(f.db.query("SELECT * FROM service_effect_s01_sources").all()).toHaveLength(1);
});

for (const mutation of ["owner-before", "owner-after", "abort"] as const) test(`HTTP ${mutation} rejects atomically before acknowledgement`, async () => {
  let callback: WebUserMessageStoreOptions["acceptSource"], checks = 0;
  const abort = new AbortController();
  const f = fixture(() => callback, () => ++checks !== (mutation === "owner-before" ? 1 : mutation === "owner-after" ? 2 : -1));
  callback = stored => {
    f.accept(stored);
    if (mutation === "abort") abort.abort();
  };
  const before = f.snapshot();
  const response = await f.route({ content: "fenced input" }, abort.signal);
  expect(response.status).toBe(mutation === "abort" ? 400 : 503);
  expect(f.snapshot()).toEqual(before);
  expect(f.events).toEqual([]);
  expect(f.jobs).toEqual([]);
});

test("HTTP SQL busy retry retains the selected callback and commits exactly once", async () => {
  let callback: WebUserMessageStoreOptions["acceptSource"], selections = 0, attempts = 0;
  const f = fixture(() => { selections++; return callback; });
  callback = stored => {
    f.accept(stored);
    if (++attempts === 1) {
      f.channel.getInputSourceAdmission = () => { throw Error("must not reselect on retry"); };
      throw Object.assign(Error("retry"), { code: "SQLITE_BUSY" });
    }
  };
  f.expectSources(1);
  expect((await f.route()).status).toBe(201);
  expect(selections).toBe(1);
  expect(attempts).toBe(2);
  expect(f.db.query("SELECT * FROM messages").all()).toHaveLength(1);
  expect(f.db.query("SELECT * FROM service_effect_s01_sources").all()).toHaveLength(1);
  expect(f.db.query("SELECT * FROM service_effect_s01_decisions").all()).toHaveLength(1);
  expect(f.jobs).toHaveLength(1);
});

for (const duringAdmission of [false, true]) test(`HTTP queued input preserves order and skips ordinary source callback: race ${duringAdmission}`, async () => {
  let calls = 0;
  const f = fixture(() => () => { calls++; });
  if (duringAdmission) {
    const admit = f.channel.admitUserMessage!.bind(f.channel);
    f.channel.admitUserMessage = async (...args) => { f.busy(true); return admit(...args); };
  } else f.busy(true);
  expect((await f.route({ content: "first follow-up" })).status).toBe(201);
  expect((await f.route({ content: "second follow-up" })).status).toBe(201);
  expect(calls).toBe(0);
  expect(f.db.query("SELECT * FROM messages").all()).toHaveLength(0);
  expect(f.channel.getQueuedFollowupItems("web:default").map(item => item.queuedContent)).toEqual(["first follow-up", "second follow-up"]);
  expect(f.jobs).toEqual([]);
  expect(f.events).toEqual(["agent_followup_queued", "agent_followup_queued"]);
});

for (const mode of ["active", "backlog", "race"] as const) test(`HTTP queued source commits existing FIFO atomically: ${mode}`, async () => {
  const f = fixture(() => () => { throw Error("ordinary callback must not run"); });
  const seen: unknown[] = [];
  f.channel.getQueuedInputSourceAdmission = jid => {
    expect(jid).toBe("web:default");
    return stored => { seen.push(structuredClone(stored.item)); f.acceptQueued(stored); };
  };
  if (mode === "active") f.busy(true);
  if (mode === "backlog") f.channel.enqueueQueuedFollowupItem("web:default", 0, "older backlog");
  if (mode === "race") {
    const admit = f.channel.admitUserMessage!.bind(f.channel);
    f.channel.admitUserMessage = async (...args) => { f.busy(true); return admit(...args); };
  }
  for (let n = 1; n <= 2; n++) {
    f.expectSources(n);
    expect((await f.route({ content: `follow-up ${n}`, mode: "auto", content_blocks: [{ type: "text", text: "actual body" }],
      engine: "forged", getQueuedInputSourceAdmission: "forged", source_id: "forged", accepted_source_id: "forged" })).status).toBe(201);
  }
  const items = f.channel.getQueuedFollowupItems("web:default");
  expect(items.map(item => item.queuedContent)).toEqual(mode === "backlog" ? ["older backlog", "follow-up 1", "follow-up 2"] : ["follow-up 1", "follow-up 2"]);
  expect(seen).toEqual(items.slice(-2).map(({ source_accepted, ...item }) => item));
  const sources = f.db.query("SELECT source_id, payload_ref, accepted_at FROM service_effect_s01_sources ORDER BY source_seq").all();
  expect(sources).toEqual(items.slice(-2).map(item => ({ source_id: item.source_id,
    payload_ref: `queued-source:${item.source_id}`, accepted_at: item.queuedAt })));
  for (const item of items.slice(-2)) expect(item.source_id).toMatch(/^source-[0-9a-f-]{36}$/);
  expect(f.channel.getQueuedFollowupItems("web:default")).toEqual(items);
  expect(f.db.query("SELECT * FROM service_effect_s01_sources").all()).toHaveLength(2);
  expect(f.db.query("SELECT * FROM messages").all()).toHaveLength(0);
  expect(f.events).toEqual(["agent_followup_queued", "agent_followup_queued"]);
  expect(f.jobs).toHaveLength(mode === "backlog" ? 2 : 0);
  for (const job of f.jobs) expect(job.lane).toBe("chat:web:default");
});

test("idle steer becoming active inside admission remains an unaccepted startup fallback", async () => {
  const f = fixture(() => () => { throw Error("ordinary source must not run"); });
  let selections = 0;
  f.channel.getQueuedInputSourceAdmission = () => {
    selections++;
    return () => { throw Error("steer fallback must not accept a queued source"); };
  };
  const published: unknown[] = [];
  const broadcast = f.channel.broadcastEvent.bind(f.channel);
  f.channel.broadcastEvent = (type, data) => { published.push(data); broadcast(type, data); };
  const admit = f.channel.admitUserMessage!.bind(f.channel);
  f.channel.admitUserMessage = (...args) => {
    const validate = args[4];
    args[4] = phase => { validate(phase); if (phase === "before") f.busy(true); };
    return admit(...args);
  };
  const response = await f.route({ content: "startup steer", mode: "steer" });
  expect(response.status).toBe(201);
  const receipt = await response.json();
  expect(receipt).toEqual({ thread_id: null, queued: "followup" });
  expect(JSON.stringify(receipt)).not.toContain("source-");
  expect(selections).toBe(1); // Read-only host selection is pinned before body parsing.
  const items = f.channel.getQueuedFollowupItems("web:default");
  expect(items).toHaveLength(1);
  expect(items[0]!.source).toBe("web.steer_startup_fallback");
  expect(items[0]!.source_accepted).not.toBe(true);
  expect(items[0]!.source_id).toMatch(/^source-[0-9a-f-]{36}$/);
  expect(published).toEqual([expect.objectContaining({ source: "web.steer_startup_fallback" })]);
  expect(f.db.query("SELECT * FROM service_effect_s01_sources").all()).toEqual([]);
  expect(f.db.query("SELECT * FROM service_effect_s01_wake_intents").all()).toEqual([]);
  expect(f.db.query("SELECT * FROM messages").all()).toEqual([]);
  expect(f.jobs).toEqual([]);
});

for (const failure of ["throw", "owner-after", "abort"] as const) test(`idle-race ${failure} rollback leaves only a harmless public allocator gap`, async () => {
  const f = fixture();
  const abort = new AbortController();
  const admit = f.channel.admitUserMessage!.bind(f.channel);
  f.channel.admitUserMessage = (...args) => {
    const validate = args[4];
    args[4] = phase => {
      validate(phase);
      if (phase === "before") f.busy(true);
      if (phase === "after" && failure === "owner-after") throw Error("authority lost");
    };
    return admit(...args);
  };
  let rejectedSourceId = "";
  f.channel.getQueuedInputSourceAdmission = () => stored => {
    rejectedSourceId = stored.item.source_id;
    f.acceptQueued(stored);
    if (failure === "throw") throw Error("source rejected");
    if (failure === "abort") abort.abort();
  };
  const before = f.snapshot();
  const rejected = await f.route({ content: "rejected idle race" }, abort.signal);
  expect(rejected.status).toBe(failure === "abort" ? 400 : 503);
  expect(f.snapshot()).toEqual(before);
  expect(f.channel.getQueuedFollowupItems("web:default")).toEqual([]);
  expect(f.events).toEqual([]);
  expect(f.jobs).toEqual([]);
  // Public action IDs need uniqueness, not contiguous numbering. Durable source
  // identity/sequence come from accepted UUIDs, never this in-memory allocator.
  f.channel.admitUserMessage = admit;
  f.channel.getQueuedInputSourceAdmission = () => f.acceptQueued;
  f.expectSources(1);
  expect((await f.route({ content: "accepted after idle race" })).status).toBe(201);
  const accepted = f.channel.peekQueuedFollowupItem("web:default")!;
  expect(accepted.rowId).toBe(-2);
  expect(accepted.source_id).not.toBe(rejectedSourceId);
  expect(accepted.source_accepted).toBe(true);
  expect(f.db.query("SELECT source_id, source_seq FROM service_effect_s01_sources").all()).toEqual([
    { source_id: accepted.source_id, source_seq: 1 },
  ]);
  expect(f.db.query("SELECT * FROM service_effect_s01_wake_intents").all()).toEqual([]);
  expect(f.db.query("SELECT * FROM messages").all()).toEqual([]);
  expect(f.channel.removeQueuedFollowupItem("web:default", -1)).toBeNull();
  expect(() => f.channel.removeQueuedFollowupItem("web:default", accepted.rowId)).toThrow("host cancellation");
  expect(f.channel.peekQueuedFollowupItem("web:default")).toEqual(accepted);
});

test("persisted queue replay keeps source identity while reconstructed empty queue can reuse public row id", async () => {
  const f = fixture();
  const signal = new AbortController().signal;
  const stamp = "2026-08-13T00:00:00.000Z";
  const first = new QueuedFollowupLifecycleService();
  const rowId = await first.admitQueuedFollowupItem(["web:default", 0, "same input", null, stamp], () => {}, signal, f.acceptQueued);
  const before = first.peekQueuedFollowupItem("web:default")!;
  const persisted = f.db.query("SELECT queued_followups_json FROM chat_cursors WHERE chat_jid = ?").get("web:default") as { queued_followups_json: string };
  expect(JSON.parse(persisted.queued_followups_json)[0].source_id).toBe(before.source_id);
  const restored = new QueuedFollowupLifecycleService();
  expect(restored.peekQueuedFollowupItem("web:default")).toEqual(before);
  f.db.transaction(() => acceptQueuedInputSource("web:default", rowId, f.db, f.acceptQueued)).immediate();
  expect(f.db.query("SELECT * FROM service_effect_s01_sources").all()).toHaveLength(1);
  expect(restored.consumeQueuedFollowupItem("web:default")).toEqual(before);
  const restartedEmpty = new QueuedFollowupLifecycleService();
  const reused = await restartedEmpty.admitQueuedFollowupItem(["web:default", 0, "same input", null, stamp], () => {}, signal, f.acceptQueued);
  const after = restartedEmpty.peekQueuedFollowupItem("web:default")!;
  expect(reused).toBe(rowId);
  expect(after.queuedAt).toBe(before.queuedAt);
  expect(after.source_id).not.toBe(before.source_id);
  expect(f.db.query("SELECT source_id FROM service_effect_s01_sources ORDER BY source_seq").all()).toEqual([
    { source_id: before.source_id }, { source_id: after.source_id },
  ]);
  expect(restartedEmpty.listQueuedStateItems("web:default")).toEqual([
    { row_id: rowId, content: "same input", timestamp: stamp, thread_id: null },
  ]);
});

test("legacy identity is assigned only on transactional adoption and rolls back with rejected source", () => {
  const f = fixture();
  setDeferredQueuedFollowups("web:default", [{ rowId: -1, queuedContent: "legacy", threadId: null, queuedAt: "2026-08-13T00:00:00.000Z" }]);
  const before = f.snapshot();
  const service = new QueuedFollowupLifecycleService();
  expect(service.peekQueuedFollowupItem("web:default")).not.toHaveProperty("source_id");
  expect(service.peekQueuedFollowupItem("web:default")).not.toHaveProperty("source_id");
  expect(f.snapshot()).toEqual(before);
  let rejectedId = "";
  expect(() => f.db.transaction(() => acceptQueuedInputSource("web:default", -1, f.db, stored => {
    rejectedId = stored.item.source_id;
    expect(getDeferredQueuedFollowups("web:default")[0]!.source_id).toBe(rejectedId);
    f.acceptQueued(stored);
    throw Error("reject legacy adoption");
  })).immediate()).toThrow("reject legacy adoption");
  expect(f.snapshot()).toEqual(before);
  expect(() => acceptQueuedInputSource("web:default", -1, f.db, f.acceptQueued)).toThrow("transaction");
  expect(f.snapshot()).toEqual(before);
  f.db.transaction(() => acceptQueuedInputSource("web:default", -1, f.db, f.acceptQueued)).immediate();
  const adopted = service.peekQueuedFollowupItem("web:default")!;
  expect(adopted.source_id).toMatch(/^source-[0-9a-f-]{36}$/);
  expect(adopted.source_id).not.toBe(rejectedId);
  f.db.transaction(() => acceptQueuedInputSource("web:default", -1, f.db, f.acceptQueued)).immediate();
  expect(service.peekQueuedFollowupItem("web:default")).toEqual(adopted);
  expect(f.db.query("SELECT source_id FROM service_effect_s01_sources").all()).toEqual([{ source_id: adopted.source_id }]);
});

for (const failure of ["throw", "async", "value", "owner-after", "abort"] as const) test(`HTTP queued ${failure} rolls back queue and EF without publication`, async () => {
  let checks = 0;
  const f = fixture(undefined, () => ++checks !== (failure === "owner-after" ? 2 : -1));
  f.busy(true);
  const abort = new AbortController();
  f.channel.getQueuedInputSourceAdmission = () => stored => {
    f.acceptQueued(stored);
    if (failure === "async") return Promise.reject(Error("private detail")) as never;
    if (failure === "value") return 123 as never;
    if (failure === "abort") { abort.abort(); return; }
    if (failure === "throw") throw Error("private detail");
  };
  const before = f.snapshot();
  const response = await f.route({ content: "rejected follow-up" }, abort.signal);
  expect(response.ok).toBe(false);
  expect(await response.text()).not.toContain("private detail");
  expect(f.snapshot()).toEqual(before);
  expect(f.channel.getQueuedFollowupItems("web:default")).toEqual([]);
  expect(f.events).toEqual([]); expect(f.jobs).toEqual([]);
  f.channel.getQueuedInputSourceAdmission = () => f.acceptQueued;
  f.expectSources(1);
  expect((await f.route({ content: "accepted after rollback" })).status).toBe(201);
  expect(f.channel.peekQueuedFollowupItem("web:default")!.rowId).toBe(-1);
});

test("queued retry captures selector once and preserves intervening queue mutation", async () => {
  const f = fixture(); f.busy(true);
  let selections = 0, attempts = 0;
  const attemptedSourceIds: string[] = [];
  f.channel.getQueuedInputSourceAdmission = () => { selections++; return stored => {
    attemptedSourceIds.push(stored.item.source_id);
    f.acceptQueued(stored);
    if (++attempts === 1) {
      setTimeout(() => { f.channel.enqueueQueuedFollowupItem("web:default", 0, "intervening"); }, 0);
      throw Object.assign(Error("retry"), { code: "SQLITE_BUSY" });
    }
  }; };
  f.expectSources(1);
  expect((await f.route({ content: "retried" })).status).toBe(201);
  expect(selections).toBe(1); expect(attempts).toBe(2);
  expect(new Set(attemptedSourceIds).size).toBe(2);
  expect(f.db.query("SELECT source_id FROM service_effect_s01_sources").all()).toEqual([{ source_id: attemptedSourceIds[1] }]);
  expect(f.channel.getQueuedFollowupItems("web:default").map(item => [item.rowId, item.queuedContent])).toEqual([[-1, "intervening"], [-2, "retried"]]);
  expect(f.db.query("SELECT source_id FROM service_effect_s01_sources").all()).toEqual([
    { source_id: f.channel.getQueuedFollowupItems("web:default")[1]!.source_id },
  ]);
});

test("queued host callback is captured before body await and cannot be replaced", async () => {
  const f = fixture(); f.busy(true); f.expectSources(1);
  let selected = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.channel.getQueuedInputSourceAdmission = () => { selected++; return f.acceptQueued; };
  const req = new Request("http://fixture/agent/default/message", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://fixture" },
    body: new ReadableStream({ async pull(controller) { await gate; controller.enqueue(new TextEncoder().encode(JSON.stringify({ content: "captured queue input" }))); controller.close(); } }) });
  const pending = f.channel.handleRequest(req);
  for (let n = 0; n < 100 && !selected; n++) await Bun.sleep(0);
  expect(selected).toBe(1);
  f.channel.getQueuedInputSourceAdmission = () => { throw Error("replacement selector"); };
  release();
  expect((await pending).status).toBe(201);
  expect(f.db.query("SELECT * FROM service_effect_s01_sources").all()).toHaveLength(1);
});

test("manual queue command does not adopt ordinary queued source hook", async () => {
  const f = fixture(); f.busy(true, true);
  f.channel.getQueuedInputSourceAdmission = () => () => { throw Error("command must not be adopted"); };
  expect((await f.route({ content: "/queue manual command" })).status).toBe(201);
  expect(f.db.query("SELECT * FROM service_effect_s01_sources").all()).toEqual([]);
});

for (const failure of ["selection", "pending", "wait"] as const) test(`worker ${failure} retains lane and recovery marker without legacy`, async () => {
  const f = fixture();
  let legacy = 0;
  (f.channel.agentPool as any).runAgent = () => { legacy++; throw Error("legacy forbidden"); };
  const shutdown = new AbortController();
  const host = createDurableQueueDispatch({ work: f.work, adapter: { submit() {}, wait() {}, settle() {} } as any, branchId: "main",
    assertCurrentWriter() {}, shutdown: shutdown.signal,
    waitForReconciliation: (_identity, signal) => new Promise(resolve => signal.addEventListener("abort", () => resolve(), { once: true })) });
  f.channel.dispatchAcceptedInput = Object.assign(() => {
    if (failure === "selection") throw Error("owner lost");
    return async () => { if (failure === "wait") throw Error("wait failed"); return "pending" as const; };
  }, { waitForPending: host.waitForPending });
  expect((await f.route()).status).toBe(201);
  let released = false;
  const original = f.jobs[0]!.task().then(() => { released = true; });
  await Bun.sleep(10);
  expect(released).toBe(false);
  expect(legacy).toBe(0);
  expect(f.db.query("SELECT inflight_message_id FROM chat_cursors").get()).toEqual({
    inflight_message_id: (f.db.query("SELECT id FROM messages").get() as { id: string }).id,
  });
  const before = f.db.query("SELECT * FROM chat_cursors").get();
  shutdown.abort(); await original;
  expect(released).toBe(true);
  expect(f.db.query("SELECT * FROM chat_cursors").get()).toEqual(before);
  expect(legacy).toBe(0);
});

const hasEngine = existsSync(new URL("../../../durable-engine/node_modules/@earendil-works/pi-durable/package.json", import.meta.url));
test("required engine integration prerequisite cannot silently skip", () => {
  if (process.env.PICLAW_REQUIRE_DURABLE_ENGINE === "1") expect(hasEngine).toBe(true);
});
for (const [queuedInput, pending, steering] of [[false,false,false], [false,true,false], [true,false,false], [true,true,false], [false,false,true], [false,false,'ack-lost'], [false,false,'stale-target']] as const) test.skipIf(!hasEngine)(`HTTP accepted message uses current worker and real engine exactly once; queued=${queuedInput}; pending=${pending}; steering=${steering}`, async () => {
  const { HostConversationRuntime, BunSqliteDatabase, createHostDurableBindings, initializeHostDurableBindings } = await import("../../../durable-engine/src/index.js");
  const { SqliteStorage } = await import("../../../durable-engine/qualification/sqlite.ts");
  const { context, openFixture, barrier } = await import("../../../../qualification/pi-durable-130/src/fixture.js");
  const { installTerminalSettlementCompositionSchema } = await import("../../../src/service-effects/current-piclaw/terminal-settlement-schema.js");
  const { createCurrentPiclawTerminalSettlementStore } = await import("../../../src/service-effects/current-piclaw/terminal-settlement-store.js");
  const { InMemoryEffectPayloadResolver } = await import("../../../src/service-effects/testing/in-memory-payload-resolver.js");
  let callback: WebUserMessageStoreOptions["acceptSource"];
  const f = fixture(() => callback, () => true);
  callback = f.accept;
  installTerminalSettlementCompositionSchema(f.db);
  const path = join(process.env.PICLAW_WORKSPACE!, "engine.sqlite");
  const base = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new BunSqliteDatabase(path)));
  const conversationId = base.root.id;
  await base.close();
  let owner = true;
  const assert = () => { if (!owner) throw Error("owner lost"); };
  initializeHostDurableBindings(f.db, assert);
  const payloads = new InMemoryEffectPayloadResolver();
  const terminal = createCurrentPiclawTerminalSettlementStore(f.db, payloads, {
    hitFault: () => false, recordTrace() {}, validateOwnership() { assert(); return f.db.inTransaction; },
  });
  if (!terminal.ok) throw Error("terminal construction");
  const manifest = [{ chatJid: "web:default", branchId: "main", conversationId }];
  const runtime = await HostConversationRuntime.open({
    incarnation: "queue-test", owner: { assert, release() {} }, work: f.work, terminal: terminal.value,
    openStorage: () => SqliteStorage.open(new BunSqliteDatabase(path)),
    harnessOptions: { models: base.models, registry: base.registry, settings: { retry: { enabled: false }, compaction: { enabled: false } } },
    existingConversationIds: [conversationId], conversationFor(chat, branch) {
      if (chat !== "web:default" || branch !== "main") throw Error("binding conflict"); return conversationId;
    },
    bindings: createHostDurableBindings(f.db, { domain: "queue-test", incarnation: "queue-test", assertOwner: assert, manifest,
      async resolveContent(ref) {
        const row = (ref.startsWith('queued-source:')
          ? f.db.query('SELECT content FROM messages WHERE id=? AND chat_jid=?').get(ref.slice('queued-source:'.length), 'web:default')
          : f.db.query("SELECT content FROM messages WHERE rowid=?").get(Number(ref.split(":")[1]))) as { content: string };
        return row.content;
      } }),
    authorizeScheduling() { assert(); }, putAnswer(ref, text) { payloads.putText(ref, text); },
    sessionId: "queue-test", lane: "main", generation: 1, now: () => new Date().toISOString(),
  }, context);
  const adapter = createDurableConversationAdapter({ incarnation: "queue-test", manifest, runtime });
  const shutdown = new AbortController();
  let repairs = 0;
  const recoveryDispatch = createDurableRecoveryDispatch({ assertCurrentWriter: assert, shutdown: shutdown.signal,
    async submitIntent(input) { repairs++; return adapter.submitIntent(input); } });
  const reconcile = recoveryDispatch.onReconcile;
  const lifecycle = { shutdown: shutdown.signal, waitForReconciliation: recoveryDispatch.waitForReconciliation };
  let pendingIntent: Parameters<typeof adapter.submitIntent>[0] | undefined;
  let accepted: Parameters<typeof adapter.settle>[0] | undefined;
  const selectedAdapter = pending ? { ...adapter, async wait(work: Parameters<typeof adapter.wait>[0], id: number) {
    await adapter.wait(work, id);
    if (!accepted) { accepted = work; throw Error("lost wait acknowledgement"); }
  } } : adapter;
  f.channel.dispatchAcceptedInput = createDurableQueueDispatch({ ...lifecycle, work: f.work, adapter: selectedAdapter, branchId: "main", assertCurrentWriter: assert,
    ...(steering ? { runningCorrelation: (id: number) => ({ sessionId: 'queue-test', lane: 'main', harnessOperationId: String(id), state: 'running' as const, watchGeneration: 1 }) } : {}) });
  let legacyCalls = 0;
  (f.channel.agentPool as any).runAgent = () => { legacyCalls++; throw Error("legacy forbidden"); };
  const resumeQueued = f.channel.resumeChat.bind(f.channel);
  f.channel.resumeChat = () => {};
  try {
    f.expectSources(1);
    if (queuedInput) {
      f.busy(true);
      f.channel.getQueuedInputSourceAdmission = () => f.acceptQueued;
      f.channel.getQueuedInputMaterialization = () => ({ item, message, rowId, database }) => {
        expect(database.inTransaction).toBe(true);
        const source = f.work.getAcceptedSource('web:default', item.source_id);
        expect(source?.payloadRef).toBe(`queued-source:${message.id}`);
        const { source_accepted, materializeRetries, ...immutableInput } = item;
        expect(source?.provenanceRef).toBe(`engine:host-selected:${hashCanonicalRequest(JSON.parse(JSON.stringify(immutableInput)) as CanonicalJsonValue)}`);
        expect(message.id).toBe(item.source_id);
        expect(database.query('SELECT id FROM messages WHERE rowid=?').get(rowId)).toEqual({ id: item.source_id });
      };
    }
    expect((await f.route({ content: "ordinary input", engine: "forged" })).status).toBe(201);
    const originalSources = f.db.query('SELECT source_id, source_seq, payload_ref FROM service_effect_s01_sources').all();
    if (queuedInput) {
      expect(f.jobs).toHaveLength(0);
      f.busy(false);
      f.channel.resumeChat = resumeQueued;
      const queuedRowId = getDeferredQueuedFollowups('web:default')[0]!.rowId;
      const { materializeDeferredFollowups } = await import('../../../src/channels/web/runtime/process-chat-control-runtime.js');
      expect((await materializeDeferredFollowups({ channel: f.channel as any, chatJid: 'web:default', agentId: 'default' })).status).toBe('resumed');
      for (let n = 0; n < 200 && !f.jobs.length; n++) await Bun.sleep(1);
      expect(f.jobs).toHaveLength(1);
      expect(getDeferredQueuedFollowups('web:default')).toEqual([]);
      let withdrawalCalls = 0;
      f.channel.getQueuedInputSourceWithdrawal = () => () => { withdrawalCalls++; throw Error('materialized source must not withdraw'); };
      const materializedSnapshot = f.snapshot(), published = f.events.length;
      const remove = await f.channel.handleRequest(new Request('http://fixture/agent/queue-remove', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://fixture' }, body: JSON.stringify({ row_id: queuedRowId }) }));
      expect(remove.status).toBe(200); expect((await remove.json()).removed).toBe(false);
      expect(withdrawalCalls).toBe(0); expect(f.snapshot()).toEqual(materializedSnapshot); expect(f.events.length).toBe(published);
      expect(f.db.query('SELECT source_id, source_seq, payload_ref FROM service_effect_s01_sources').all()).toEqual(originalSources);
    }
    let releases = 0;
    const hold = barrier(), intentHold = barrier();
    if (steering) base.host.modelHold = hold;
    const original = f.jobs[0]!.task().then(() => { releases++; });
    if (steering) {
      for (let n = 0; n < 500; n++) {
        const active = await f.work.getChatFrontier('web:default');
        const op = active.ok && active.value.activeOperationId ? await f.work.getOperation(active.value.activeOperationId) : null;
        if (op?.ok && op.value?.harness?.state === 'running') break;
        await Bun.sleep(1);
      }
      f.busy(true, true); f.expectSources(2);
      f.channel.getQueuedInputSourceAdmission = () => f.acceptQueued;
      expect((await f.route({ content: 'accepted B' })).status).toBe(201);
      const queued = getDeferredQueuedFollowups('web:default')[0]!;
      const before = f.work.getAcceptedSource('web:default', queued.source_id!)!;
      let stale = true;
      let dispatches = 0;
      const coordinator = createDurableQueuedSteering({ work: f.work,
        adapter: { ...adapter, async submitIntent(input) {
          dispatches++;
          const id = await adapter.submitIntent(input);
          if (steering === 'ack-lost') throw Error('lost dispatch ACK');
          return id;
        } },
        onPendingIntent(input) { pendingIntent = input; recoveryDispatch.onPendingIntent(input); },
        chatJid: 'web:default', branchId: 'main', assertCurrentWriter: assert,
        runningBinding: { sessionId: 'queue-test', lane: 'main', watchGeneration: 1 },
        readQueued: id => getDeferredQueuedFollowups('web:default').find(item => item.rowId === id),
        validatePayload: ({ item }) => {
          const { source_accepted, materializeRetries, ...immutable } = item;
          expect(f.work.getAcceptedSource('web:default', item.source_id)?.provenanceRef).toBe(`engine:host-selected:${hashCanonicalRequest(JSON.parse(JSON.stringify(immutable)) as CanonicalJsonValue)}`);
        },
        materialize: (item, accept) => storeWebMessage(f.channel as any, { chatJid: 'web:default', content: item.queuedContent,
          isBot: false, mediaIds: item.mediaIds ?? [], agentId: 'default', agentName: 'Fixture' }, {
          contentBlocks: item.contentBlocks, linkPreviews: item.linkPreviews, threadId: item.threadId,
          screenHint: item.screenHint, isSteeringMessage: true, consumeDeferredFollowupRowId: item.rowId,
          materializeQueuedSource: stored => {
            accept(stored);
            // Prove attachment, timeline insert and queue consumption share rollback.
            if (stale) throw Error('private post-attachment failure');
          } }),
      });
      f.channel.getAcceptedQueuedSteering = () => coordinator;
      const click = () => f.channel.handleRequest(new Request('http://fixture/agent/queue-steer', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://fixture' }, body: JSON.stringify({ row_id: queued.rowId }) }));
      if (steering === 'stale-target') {
        // Finish through the host lifecycle API, never by editing operation SQL.
        const frontier = await f.work.getChatFrontier('web:default');
        if (!frontier.ok || !frontier.value.activeOperationId) throw Error('active operation');
        const current = await f.work.getOperation(frontier.value.activeOperationId);
        if (!current.ok || !current.value?.harness) throw Error('running harness');
        const finish = { effect: { idempotencyKey: 'stale-target-finish', requestHash: '',
          operationId: current.value.operationId, sourceSeq: current.value.primarySourceSeq,
          provenanceRef: 'host:test', redactionClass: 'private' as const },
          expectedVersion: current.value.version, expectedHarness: current.value.harness };
        finish.effect.requestHash = hashCanonicalRequest({ method: 'finishHarness.v1', ...finish } as unknown as CanonicalJsonValue);
        expect((await f.work.finishHarness(finish)).ok).toBe(true);
        const unchanged = f.snapshot(), queue = getDeferredQueuedFollowups('web:default'), events = [...f.events];
        const operations = f.db.query('SELECT * FROM service_effect_s01_operations').all();
        const denied = await click();
        expect(denied.status).toBe(500);
        expect(await denied.json()).toEqual({ error: 'Accepted steering is unavailable.' });
        expect(f.snapshot()).toEqual(unchanged);
        expect(getDeferredQueuedFollowups('web:default')).toEqual(queue);
        expect(f.db.query('SELECT * FROM service_effect_s01_operations').all()).toEqual(operations);
        expect(f.events).toEqual(events); expect(dispatches).toBe(0);
        hold.release(); await original;
        expect(f.work.getAcceptedSource('web:default', queued.source_id!)?.state).toBe('pending');
        expect(getDeferredQueuedFollowups('web:default')).toEqual(queue);
        expect(f.db.query('SELECT * FROM service_effect_s02_commits').all()).toHaveLength(1);
        expect(base.host.modelCalls).toBe(1); expect(legacyCalls).toBe(0);
        return;
      }
      const unchanged = f.snapshot(), queuedBefore = getDeferredQueuedFollowups('web:default');
      const eventsBefore = [...f.events];
      const operationsBefore = f.db.query('SELECT * FROM service_effect_s01_operations').all();
      expect((await click()).status).toBe(500);
      expect(f.snapshot()).toEqual(unchanged);
      expect(f.events).toEqual(eventsBefore);
      expect(dispatches).toBe(0);
      expect(getDeferredQueuedFollowups('web:default')).toEqual(queuedBefore);
      expect(f.db.query('SELECT * FROM service_effect_s01_operations').all()).toEqual(operationsBefore);
      owner = true; stale = false;
      const response = await click(); expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ queued: 'steer', steering_delivery: 'pending', removed: true });
      expect(getDeferredQueuedFollowups('web:default')).toEqual([]);
      const claimed = f.work.getAcceptedSource('web:default', queued.source_id!)!;
      expect(claimed.sourceSeq).toBe(before.sourceSeq); expect(claimed.state).toBe('claimed');
      expect(f.db.query('SELECT id FROM messages WHERE id=?').get(queued.source_id!)).toEqual({ id: queued.source_id });
      expect(releases).toBe(0);
      const committed = f.snapshot(), published = [...f.events];
      expect((await (await click()).json()).removed).toBe(false);
      expect(f.snapshot()).toEqual(committed); expect(f.events).toEqual(published);
      expect(dispatches).toBe(1);
      if (steering === 'ack-lost') {
        for (let n = 0; n < 500 && !pendingIntent; n++) await Bun.sleep(1);
        expect(pendingIntent).toBeDefined();
        base.host.modelHold = intentHold;
        base.host.finalContent = [{ type: 'text', text: 'primary answer A' }];
        hold.release();
        // Primary finishes while the committed intent has no observed host receipt.
        for (let n = 0; n < 500; n++) {
          const primary = f.db.query('SELECT rowid, id FROM messages WHERE is_bot_message=0 ORDER BY rowid').get() as { rowid: number; id: string };
          const source = f.work.getAcceptedSource('web:default', primary.id)!;
          const op = await f.work.getOperation(`message:${primary.rowid}:${source.sourceSeq}`);
          const primaryInput = { claimed: { source, operation: op.ok ? op.value! : (() => { throw Error('operation'); })() },
            branchId: 'main', requestId: `message:${primary.rowid}:${primary.id}`, content: 'ordinary input' };
          const state = await adapter.reconcile(primaryInput);
          if (state.status?.status === 'done') break;
          await Bun.sleep(1);
        }
        await Bun.sleep(10);
        expect(releases).toBe(0);
        expect(f.db.query('SELECT * FROM service_effect_s02_commits').all()).toHaveLength(0);
        expect(f.work.getAcceptedSource('web:default', queued.source_id!)?.state).toBe('claimed');
        expect(getDeferredQueuedFollowups('web:default')).toEqual([]);
        expect(f.db.query('SELECT id FROM messages WHERE id=?').get(queued.source_id!)).toEqual({ id: queued.source_id });
        expect(legacyCalls).toBe(0); expect(dispatches).toBe(1);
        const beforeRepair = f.snapshot();
        owner = false;
        await expect(recoveryDispatch.retryRecoveredWork()).rejects.toThrow('owner lost');
        expect(f.snapshot()).toEqual(beforeRepair); expect(repairs).toBe(0);
        owner = true;
        const repairing = recoveryDispatch.retryRecoveredWork();
        expect(recoveryDispatch.retryRecoveredWork()).toBe(repairing);
        await repairing;
        await recoveryDispatch.retryRecoveredWork();
        expect(repairs).toBe(1);
        base.host.finalContent = [{ type: 'text', text: 'latest answer B' }];
        intentHold.release();
        // Explicit host-controller settlement; a queue observer never re-dispatches work.
        const primary = f.db.query('SELECT rowid, id FROM messages WHERE is_bot_message=0 ORDER BY rowid').get() as { rowid: number; id: string };
        const source = f.work.getAcceptedSource('web:default', primary.id)!;
        const op = await f.work.getOperation(`message:${primary.rowid}:${source.sourceSeq}`);
        if (!op.ok || !op.value) throw Error('operation');
        const input = { claimed: { source, operation: op.value }, branchId: 'main',
          requestId: `message:${primary.rowid}:${primary.id}`, content: 'ordinary input' };
        for (let n = 0; n < 500 && !(await adapter.settle(input)); n++) await Bun.sleep(1);
        reconcile(); // retained event resolves even if committed before listener subscription
      }
      for (let n = 0; n < 500; n++) {
        if (f.db.query('SELECT * FROM piclaw_durable_intent_bindings_v1 WHERE submission_id IS NOT NULL').all().length) break;
        await Bun.sleep(1);
      }
      hold.release();
    }
    if (pending) {
      for (let n = 0; n < 200 && !accepted; n++) await Bun.sleep(1);
      expect(accepted).toBeDefined();
      expect(releases).toBe(0);
      expect(f.db.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(0);
      expect(await adapter.settle(accepted!)).not.toBeNull();
      reconcile();
    }
    await original;
    expect(releases).toBe(1);
    expect(base.host.modelCalls).toBe(steering ? 2 : 1);
    expect(f.db.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(1);
    expect(f.db.query("SELECT * FROM messages WHERE is_bot_message=1").all()).toHaveLength(1);
    if (steering) {
      const frontier = await f.work.getChatFrontier('web:default');
      expect(frontier.ok && frontier.value.consumedThroughSourceSeq).toBe(2);
      expect(f.db.query('SELECT state FROM service_effect_s01_sources ORDER BY source_seq').all()).toEqual([{ state: 'consumed' }, { state: 'consumed' }]);
      const operation = f.db.query('SELECT operation_id FROM service_effect_s01_operations').get() as { operation_id: string };
      const state = await f.work.getOperation(operation.operation_id);
      expect(state.ok && state.value?.claimedSourceSeqs).toEqual([1, 2]);
      if (steering === 'ack-lost') expect(f.db.query('SELECT content FROM messages WHERE is_bot_message=1').get()).toEqual({ content: 'latest answer B' });
    }
    await f.jobs[0]!.task();
    expect(base.host.modelCalls).toBe(steering ? 2 : 1);
    expect(legacyCalls).toBe(0);
    const row = f.db.query("SELECT rowid, id FROM messages WHERE is_bot_message=0").get() as { rowid: number; id: string };
    const retry = f.channel.dispatchAcceptedInput("web:default", row.id, row.rowid)!;
    expect(await retry()).toBe("settled");
    expect(f.db.query('SELECT * FROM service_effect_s02_commits').all()).toHaveLength(1);
    expect(f.db.query('SELECT * FROM messages WHERE is_bot_message=1').all()).toHaveLength(1);
    expect(base.host.modelCalls).toBe(steering ? 2 : 1);
    // Settlement notification happened before this observer attached. Its SQL recheck
    // must return without waiting for a second event (edge-triggered bridge, no replay).
    expect(await Promise.race([f.channel.dispatchAcceptedInput.waitForPending({ chatJid: 'web:default', messageId: row.id, rowId: row.rowid }),
      Bun.sleep(100).then(() => 'lost-wake')])).toBe('settled');
    const failedWait = createDurableQueueDispatch({ ...lifecycle, work: f.work, branchId: "main", assertCurrentWriter: assert,
      adapter: { ...adapter, async wait() { throw Error("uncertain wait"); } } });
    expect(await failedWait("web:default", row.id, row.rowid)!()).toBe("pending");
    expect(legacyCalls).toBe(0);
    expect(() => failedWait("web:default", row.id, row.rowid + 1000)).toThrow("identity conflict");
    owner = false;
    expect(() => f.channel.dispatchAcceptedInput!("web:default", row.id, row.rowid)).toThrow("owner lost");
    expect(legacyCalls).toBe(0);
    owner = true;
  } finally { owner = true; shutdown.abort(); await adapter.close(); }
}, 15000);
