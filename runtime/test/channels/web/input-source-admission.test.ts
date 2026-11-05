import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { admitWebMessage } from '../../../src/channels/web/messaging/message-store.js';
import { join } from "node:path";
import { createTempWorkspace, setEnv } from "../../helpers.js";
import { closeDatabase, getDb, initDatabase } from "../../../src/db/connection.js";
import { WebChannel, type WebChannelOpts } from "../../../src/channels/web.js";
import type { StoreWebMessageOptions } from "../../../src/channels/web/messaging/message-store.js";
import { installServiceWorkSchema } from "../../../src/service-effects/current-piclaw/service-work-schema.js";
import { createCurrentPiclawServiceWorkStore } from "../../../src/service-effects/current-piclaw/service-work-store.js";
import { hashCanonicalRequest, type CanonicalJsonValue } from "../../../src/service-effects/contracts/common.js";
import type { AcceptSourceRequest } from "../../../src/service-effects/contracts/service-work-store.js";
import { resetRateLimiterStateForTests } from "../../../src/channels/web/http/rate-limit.js";
import { acceptQueuedInputSource, QueuedFollowupLifecycleService } from "../../../src/channels/web/runtime/queued-followup-lifecycle-service.js";
import { getDeferredQueuedFollowups, setDeferredQueuedFollowups } from "../../../src/db.js";

let cleanup = () => {};
afterEach(() => { closeDatabase(); cleanup(); resetRateLimiterStateForTests(); });
function fixture(select?: WebChannelOpts["getInputSourceAdmission"], validateAcceptance?: () => boolean, pendingQueuedSourceOrder?: (chat: string) => readonly string[]) {
  const ws = createTempWorkspace("http-source-admission-");
  const restore = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  cleanup = () => { restore(); ws.cleanup(); };
  mkdirSync(join(ws.workspace, ".piclaw"), { recursive: true });
  writeFileSync(join(ws.workspace, ".piclaw/config.json"), JSON.stringify({ domains: { access: { mode: "single-user" } } }));
  initDatabase();
  const db = getDb();
  installServiceWorkSchema(db); // Fixture-only, not production activation.
  db.query("INSERT INTO chats(jid, name, last_message_time) VALUES (?, ?, ?)").run("web:default", "Fixture", "2026-08-13T00:00:00.000Z");
  const made = createCurrentPiclawServiceWorkStore(db, { hitFault: () => false, recordTrace() {}, validateAcceptance, pendingQueuedSourceOrder });
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
  const accept: NonNullable<StoreWebMessageOptions["acceptSource"]> = ({ message, rowId, database }) => {
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
    const { source_accepted: _sourceAccepted, materializeRetries: _materializeRetries, ...immutableInput } = item;
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

test("host follow-up identity replay reuses accepted queue row and denies changed or materialized sources", () => {
  const f = fixture(undefined, () => true);
  const service = new QueuedFollowupLifecycleService();
  const chat = 'web:durable-admission';
  const admit = (content = 'Continue verified Goal') => f.db.transaction(() => service.enqueueAcceptedFollowupOnce(
    'goal-continuation:operation-1', chat, content, '2026-10-19T00:00:00.000Z', { source: ' goal.continuation ', queuedBy: { source: ' goal ', sourceMessageId: ' operation-1 ' },
      mediaIds: [999], source_id: 'forged' } as any, f.acceptQueued,
  )).immediate();
  const row = admit();
  expect(admit()).toBe(row);
  expect(f.db.transaction(() => service.enqueueAcceptedFollowupOnce('goal-continuation:operation-1', chat,
    'Continue verified Goal', '2026-10-19T00:00:00.000Z', { source: 'goal.continuation', queuedBy: { source: 'goal', sourceMessageId: 'operation-1' } }, f.acceptQueued)).immediate()).toBe(row);
  const queued = getDeferredQueuedFollowups(chat);
  expect(queued).toHaveLength(1);
  expect(queued[0]).toMatchObject({ source_id: 'goal-continuation:operation-1', source: 'goal.continuation', queuedBy: { source: 'goal', sourceMessageId: 'operation-1' } });
  expect(queued[0]!.mediaIds ?? []).toHaveLength(0);
  expect(f.db.query('SELECT * FROM service_effect_s01_sources').all()).toHaveLength(1);
  expect(() => admit('Changed objective')).toThrow('identity conflict');
  const before = f.snapshot();
  expect(() => f.db.transaction(() => { admit(); throw Error('rollback'); }).immediate()).toThrow('rollback');
  expect(f.snapshot()).toEqual(before);
  setDeferredQueuedFollowups(chat, []);
  expect(() => admit()).toThrow('already materialized');
  expect(getDeferredQueuedFollowups(chat)).toHaveLength(0);
});

test("autonomous stable follow-up yields to pending sources and legacy queue items", () => {
  const f = fixture(undefined, () => true);
  const service = new QueuedFollowupLifecycleService(), chat = 'web:continuation-priority';
  const admit = (id: string) => f.db.transaction(() => service.enqueueAcceptedFollowupOnce(id, chat, 'Continue Goal',
    '2026-10-19T00:00:00.000Z', { source: 'goal.continuation' }, f.acceptQueued, true)).immediate();
  f.db.transaction(() => service.enqueueQueuedFollowupItem(chat, 0, 'User input', undefined, '2026-10-19T00:00:00.000Z')).immediate();
  expect(admit('goal:first')).toBeNull();
  expect(f.db.query('SELECT * FROM service_effect_s01_sources').all()).toHaveLength(0);
  setDeferredQueuedFollowups(chat, []);
  const first = admit('goal:first');
  expect(first).not.toBeNull();
  expect(admit('goal:first')).toBe(first); // Reconciliation wins over the idle guard.
  setDeferredQueuedFollowups(chat, []); // Accepted pending source remains durable.
  expect(admit('goal:second')).toBeNull();
  expect(f.db.query('SELECT source_id FROM service_effect_s01_sources').all()).toEqual([{ source_id: 'goal:first' }]);
});



function withdrawalFixture() {
  const f = fixture(undefined, () => true);
  f.channel.getQueuedInputSourceAdmission = () => f.acceptQueued;
  f.busy(true);
  const withdraw: NonNullable<ReturnType<NonNullable<WebChannelOpts['getQueuedInputSourceWithdrawal']>>> = ({ chatJid, item, database }) => {
    const accepted = f.work.getAcceptedSource(chatJid, item.source_id)!;
    const { source_accepted: _sourceAccepted, materializeRetries: _materializeRetries, ...immutableInput } = item;
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
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: 'This preserved legacy queue item has no SDK submission; it was not changed.' });
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
  let callback: StoreWebMessageOptions["acceptSource"];
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
  let callback: StoreWebMessageOptions["acceptSource"];
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
  let callback: StoreWebMessageOptions["acceptSource"], checks = 0;
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

test("HTTP callback contention rolls back without replaying admission", async () => {
  let callback: StoreWebMessageOptions["acceptSource"], selections = 0, attempts = 0;
  const f = fixture(() => { selections++; return callback; });
  callback = stored => {
    f.accept(stored);
    if (++attempts === 1) {

      throw Object.assign(Error("retry"), { code: "SQLITE_BUSY" });
    }
  };
  expect((await f.route()).status).toBe(503);
  expect(selections).toBe(1); expect(attempts).toBe(1);
  expect(f.db.query("SELECT * FROM messages").all()).toEqual([]);
  expect(f.db.query("SELECT * FROM service_effect_s01_sources").all()).toEqual([]);
  expect(f.events).toEqual([]); expect(f.jobs).toEqual([]);
  f.expectSources(1);
  expect((await f.route()).status).toBe(201);
  expect(selections).toBe(2); expect(attempts).toBe(2);
  expect(f.db.query("SELECT * FROM messages").all()).toHaveLength(1);
  expect(f.db.query("SELECT * FROM service_effect_s01_sources").all()).toHaveLength(1);
  expect(f.db.query("SELECT * FROM service_effect_s01_decisions").all()).toHaveLength(1);
  expect(f.jobs).toHaveLength(1);
});

for (const duringAdmission of [false, true]) test(`HTTP queued input preserves order and skips ordinary source callback: race ${duringAdmission}`, async () => {
  let calls = 0;
  const f = fixture(() => () => { calls++; });
  if (duringAdmission) {
    const admit = f.channel.admitMessage!.bind(f.channel);
    f.channel.admitMessage = async (...args) => { f.busy(true); return admit(...args); };
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
    const admit = f.channel.admitMessage!.bind(f.channel);
    f.channel.admitMessage = async (...args) => { f.busy(true); return admit(...args); };
  }
  for (let n = 1; n <= 2; n++) {
    f.expectSources(n);
    expect((await f.route({ content: `follow-up ${n}`, mode: "auto", content_blocks: [{ type: "text", text: "actual body" }],
      engine: "forged", getQueuedInputSourceAdmission: "forged", source_id: "forged", accepted_source_id: "forged" })).status).toBe(201);
  }
  const items = f.channel.getQueuedFollowupItems("web:default");
  expect(items.map(item => item.queuedContent)).toEqual(mode === "backlog" ? ["older backlog", "follow-up 1", "follow-up 2"] : ["follow-up 1", "follow-up 2"]);
  expect(seen).toEqual(items.slice(-2).map(({ source_accepted: _sourceAccepted, ...item }) => item));
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

test("idle steer becoming active inside admission accepts a durable startup fallback", async () => {
  const f = fixture(() => () => { throw Error("ordinary source must not run"); });
  let selections = 0;
  f.channel.getQueuedInputSourceAdmission = () => {
    selections++;
    return f.acceptQueued;
  };
  const published: unknown[] = [];
  const broadcast = f.channel.broadcastEvent.bind(f.channel);
  f.channel.broadcastEvent = (type, data) => { published.push(data); broadcast(type, data); };
  const admit = f.channel.admitMessage!.bind(f.channel);
  f.channel.admitMessage = (...args) => {
    const validate = args[5];
    args[5] = phase => { validate(phase); if (phase === "before") f.busy(true); };
    return admit(...args);
  };
  f.expectSources(1);
  const response = await f.route({ content: "startup steer", mode: "steer" });
  expect(response.status).toBe(201);
  const receipt = await response.json();
  expect(receipt).toEqual({ thread_id: null, queued: "followup" });
  expect(JSON.stringify(receipt)).not.toContain("source-");
  expect(selections).toBe(1); // Read-only host selection is pinned before body parsing.
  const items = f.channel.getQueuedFollowupItems("web:default");
  expect(items).toHaveLength(1);
  expect(items[0]!.source).toBe("web.steer_startup_fallback");
  expect(items[0]!.source_accepted).toBe(true);
  expect(items[0]!.source_id).toMatch(/^source-[0-9a-f-]{36}$/);
  expect(published).toEqual([expect.objectContaining({ source: "web.steer_startup_fallback" })]);
  expect(f.db.query("SELECT * FROM service_effect_s01_sources").all()).toHaveLength(1);
  expect(f.db.query("SELECT * FROM service_effect_s01_wake_intents").all()).toEqual([]);
  expect(f.db.query("SELECT * FROM messages").all()).toEqual([]);
  expect(f.jobs).toEqual([]);
});

for (const failure of ["throw", "owner-after", "abort"] as const) test(`idle-race ${failure} rollback leaves only a harmless public allocator gap`, async () => {
  const f = fixture();
  const abort = new AbortController();
  const admit = f.channel.admitMessage!.bind(f.channel);
  f.channel.admitMessage = (...args) => {
    const validate = args[5];
    args[5] = phase => {
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
  f.channel.admitMessage = admit;
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
  expect((await f.channel.queuedFollowupLifecycle.removeQueuedFollowupForAction("web:default", -1)).removed).toBeNull();
  await expect(f.channel.queuedFollowupLifecycle.removeQueuedFollowupForAction("web:default", accepted.rowId)).rejects.toThrow("host cancellation");
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
  const materialized = await admitWebMessage(f.channel, { chatJid: 'web:default', content: before.queuedContent,
    isBot: false, mediaIds: [], agentId: 'default', agentName: 'Fixture' }, { consumeDeferredFollowupRowId: rowId,
    materializeQueuedSource({ database, item, message }) {
      expect(database).toBe(f.db); expect(database.inTransaction).toBe(true); expect(item).toEqual(before);
      expect(message.id).toBe(before.source_id); expect(f.work.getAcceptedSource('web:default', message.id)?.state).toBe('pending');
    } });
  expect(materialized).not.toBeNull(); expect(restored.peekQueuedFollowupItem('web:default')).toBeNull();
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

test("queued callback contention rolls back once and preserves later queue mutation", async () => {
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
  expect((await f.route({ content: "retried" })).status).toBe(503);
  expect(selections).toBe(1); expect(attempts).toBe(1);
  expect(f.channel.getQueuedFollowupItems("web:default")).toEqual([]);
  expect(f.db.query("SELECT * FROM service_effect_s01_sources").all()).toEqual([]);
  expect(f.events).toEqual([]); expect(f.jobs).toEqual([]);
  await Bun.sleep(10);
  f.expectSources(1);
  expect((await f.route({ content: "retried" })).status).toBe(201);
  expect(selections).toBe(2); expect(attempts).toBe(2);
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

test("manual queue input is adopted by the durable queued source hook", async () => {
  const f = fixture(); f.busy(true, true);
  f.channel.getQueuedInputSourceAdmission = () => f.acceptQueued;
  f.expectSources(1);
  expect((await f.route({ content: "/queue manual command" })).status).toBe(201);
  expect(f.db.query("SELECT * FROM service_effect_s01_sources").all()).toHaveLength(1);
});



const hasEngine = existsSync(new URL("../../../durable-engine/node_modules/@earendil-works/pi-durable/package.json", import.meta.url));
test("required engine integration prerequisite cannot silently skip", () => {
  if (process.env.PICLAW_REQUIRE_DURABLE_ENGINE === "1") expect(hasEngine).toBe(true);
});


for (const command of ["queue", "steer"] as const) for (const busy of [false, true]) {
  test(`native /${command} uses prepared accepted input, busy=${busy}`, async () => {
    const f = fixture(undefined, () => true);
    let prepared = 0;
    f.channel.prepareInputText = (_chat, text) => {
      expect(text).toBe("qualified payload"); prepared++;
      return { text: `prepared:${text}`, assertCurrent() {} };
    };
    f.channel.getInputSourceAdmission = () => f.accept;
    f.channel.getQueuedInputSourceAdmission = () => f.acceptQueued;
    f.channel.agentPool.applyControlCommand = async () => { throw Error("Must not dispatch queued input as a legacy control"); };
    f.busy(busy); f.expectSources(1);
    const response = await f.route({ content: `/${command} qualified payload` });
    expect(response.status).toBe(201);
    expect(prepared).toBe(1);
    expect(f.db.query("SELECT * FROM service_effect_s01_sources").all()).toHaveLength(1);
    if (busy || command === "queue") {
      expect(f.channel.getQueuedFollowupItems("web:default").at(-1)?.queuedContent).toBe("prepared:qualified payload");
      expect(f.db.query("SELECT * FROM messages").all()).toHaveLength(0);
    } else {
      expect(f.db.query("SELECT content FROM messages").all()).toEqual([{ content: "prepared:qualified payload" }]);
    }
  });
}

test("native command acknowledges execution but reports failed reply persistence without retry", async () => {
  const f = fixture(); f.expectSources(0);
  let commands = 0, sends = 0;
  f.channel.prepareInputText = () => { throw Error("Control must not become model input"); };
  f.channel.agentPool.applyControlCommand = async () => { commands++; return { status: "success", message: "Control accepted" }; };
  f.channel.sendMessage = async (_chat, _text, options) => {
    sends++; expect(options).toMatchObject({ requirePersistence: true }); throw Error("Simulated reply persistence failure");
  };
  const response = await f.route({ content: "/stats" });
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ command: { status: "success", message: "Control accepted" }, response_delivery: "failed" });
  expect(commands).toBe(1); expect(sends).toBe(1); expect(f.jobs).toHaveLength(0);
  expect(f.db.query("SELECT count(*) n FROM service_effect_s01_sources").get()).toEqual({ n: 0 });
});

test("busy native compaction executes without model admission or overwriting the active turn", async () => {
  const f = fixture(undefined, () => true);
  f.busy(true, true); f.expectSources(0);
  f.channel.agentPool.isDurableRuntime = () => true;
  let prepared = 0, controlled = 0;
  const statuses: Record<string, unknown>[] = [];
  f.channel.prepareInputText = () => { prepared++; return "must not become a prompt"; };
  f.channel.agentPool.applyControlCommand = async (_chat, command) => {
    controlled++; expect(command.type).toBe("compact");
    return { status: "success", message: "Context compacted.", contextUsage: { tokens: 20, contextWindow: 100, percent: 20 } };
  };
  f.channel.sendMessage = async () => {};
  f.channel.updateAgentStatus = (_chat, data) => { statuses.push(data); };
  const response = await f.route({ content: "/compact preserve user context" });
  expect(response.status).toBe(201); expect(await response.json()).toMatchObject({command:{status:"success",message:"Context compacted."}});
  expect(prepared).toBe(0); expect(controlled).toBe(1);
  expect(statuses).toEqual([]); // Native status belongs only to SDK watches.
  expect(f.events).toContain('agent_status'); // Context telemetry uses its independent broadcast.
  expect(f.db.query("SELECT * FROM service_effect_s01_sources").all()).toEqual([]);
  expect(getDeferredQueuedFollowups("web:default")).toEqual([]); expect(f.jobs).toHaveLength(0);
});

for (const content of ["/queue", "/steer", "/queue /exit", "/steer /model hidden", "/queue-all payload"]) {
  test(`native queued command rejects empty or nested control without admission: ${content}`, async () => {
    const f = fixture(undefined, () => true), before = f.snapshot();
    f.channel.prepareInputText = () => { throw Error("Must not prepare invalid queued command"); };
    expect((await f.route({ content })).status).toBe(400);
    expect(f.snapshot()).toEqual(before);
    expect(f.jobs).toEqual([]);
  });
}

for (const content of ["/steer payload", "ordinary payload"]) test(`native admission ignores legacy persistence hints: ${content}`, async () => {
  const f = fixture(undefined, () => true);
  f.channel.prepareInputText = (_chat, text) => ({ text, assertCurrent() {} });
  f.channel.getInputSourceAdmission = () => f.accept;
  f.expectSources(1);
  expect((await f.route({ content, mode: "steer", persist_steer: true })).status).toBe(201);
  expect((getDb().query("SELECT COUNT(*) n FROM service_effect_s01_sources").get() as { n: number }).n).toBe(1);
});

test("native Cancel reaches abort even from an older browser", async () => {
  const f = fixture(undefined, () => true), before = f.snapshot();
  f.channel.prepareInputText = () => { throw Error("abort is not model input"); };
  const commands: any[] = [];
  f.channel.agentPool.applyControlCommand = async (_chat: string, command: any) => { commands.push(command); return { status: "success", message: "Aborted" }; };
  expect((await f.route({ content: "/abort", mode: "steer", persist_steer: true })).status).toBe(200);
  expect(commands.map(command => command.type)).toEqual(["abort"]);
  expect(f.snapshot()).toEqual(before);
  expect(f.jobs).toEqual([]);
});

test("prepared input text reaches direct and queued admissions with the same synchronous authority", async () => {
  const f = fixture(undefined, () => true);
  let checks = 0, preparations = 0;
  f.channel.prepareInputText = (_chat, text) => {
    preparations++;
    return { text: `prepared:${text}`, assertCurrent() { checks++; } };
  };
  const response = await f.route({ content: "direct text", mode: "queue" });
  expect(response.status).toBe(201);
  expect((getDb().query("SELECT content FROM messages ORDER BY rowid DESC LIMIT 1").get() as { content: string }).content).toBe("prepared:direct text");
  expect(checks).toBeGreaterThan(1);
  f.busy(true); f.expectSources(1);
  f.channel.getQueuedInputSourceAdmission = () => f.acceptQueued;
  const queued = await f.route({ content: "queued text", mode: "queue" });
  expect(queued.status).toBe(201);
  const queuedItem = f.channel.getQueuedFollowupItems("web:default").at(-1)!;
  expect(queuedItem.queuedContent).toBe("prepared:queued text");
  expect(preparations).toBe(2);
  f.channel.prepareInputText = () => { throw Error("Materialisation must not prepare input again"); };
  f.channel.getQueuedInputMaterialization = () => ({ database, item, message, rowId }) => {
    expect(database).toBe(f.db); expect(database.inTransaction).toBe(true);
    expect(message.id).toBe(item.source_id);
    const source = f.work.getAcceptedSource('web:default', item.source_id);
    const { source_accepted: _accepted, materializeRetries: _retries, ...immutable } = item;
    expect(source?.state).toBe('pending'); expect(source?.payloadRef).toBe(`queued-source:${message.id}`);
    expect(source?.provenanceRef).toBe(`engine:host-selected:${hashCanonicalRequest(JSON.parse(JSON.stringify(immutable)) as CanonicalJsonValue)}`);
    expect(database.query('SELECT id FROM messages WHERE rowid=?').get(rowId)).toEqual({ id: item.source_id });
  };
  const materialized = await f.channel.admitMessage("web:default", queuedItem.queuedContent, false, queuedItem.mediaIds ?? [],
    { contentBlocks: queuedItem.contentBlocks, linkPreviews: queuedItem.linkPreviews, threadId: queuedItem.threadId,
      consumeDeferredFollowupRowId: queuedItem.rowId });
  expect(materialized?.id).toBeGreaterThan(0);
  expect((getDb().query("SELECT content FROM messages WHERE rowid=?").get(materialized!.id) as { content: string }).content).toBe("prepared:queued text");
  expect(preparations).toBe(2);
  expect(f.channel.getQueuedFollowupItems("web:default").some(item => item.rowId === queuedItem.rowId)).toBe(false);
  expect(getDb().query('SELECT id FROM messages WHERE rowid=?').get(materialized!.id)).toEqual({ id: queuedItem.source_id });
  // Materialisation consumes the persisted intent in the same source transaction.
  const before = f.snapshot();
  const queueBefore = f.channel.getQueuedFollowupItems("web:default");
  f.channel.prepareInputText = () => ({ text: "must not be accepted", assertCurrent() { throw Error("Goal lifecycle revoked"); } });
  expect((await f.route({ content: "stale continuation", mode: "queue" })).status).toBe(503);
  expect(f.snapshot()).toEqual(before);
  expect(f.channel.getQueuedFollowupItems("web:default")).toEqual(queueBefore);
});

for (const malformed of ["async-prepare", "async-authority", "slash", "empty"] as const) {
  test(`prepared input ${malformed} fails closed without admission or unhandled rejection`, async () => {
    const f = fixture(undefined, () => true), before = f.snapshot();
    const unhandled: unknown[] = [];
    const listener = (error: unknown) => { unhandled.push(error); };
    process.on("unhandledRejection", listener);
    try {
      f.channel.prepareInputText = (() => {
        if (malformed === "async-prepare") return Promise.reject(Error("private preparation error"));
        return { text: malformed === "slash" ? "/model hidden" : malformed === "empty" ? "  " : "prepared text",
          assertCurrent() { if (malformed === "async-authority") return Promise.reject(Error("private authority error")); } };
      }) as any;
      expect((await f.route()).status).toBe(503);
      await Bun.sleep(0);
      expect(unhandled).toEqual([]);
      expect(f.snapshot()).toEqual(before);
      expect(f.jobs).toEqual([]);
    } finally { process.off("unhandledRejection", listener); }
  });
}

test("prepared queued source authority revocation rolls back item and accepted source together", async () => {
  const f = fixture(undefined, () => true);
  f.busy(true);
  let revoked = false, transformed = "";
  f.channel.prepareInputText = () => ({ text: "prepared atomic queue", assertCurrent() { if (revoked) throw Error("prepared Goal revoked"); } });
  (f.channel as any).getQueuedInputSourceAdmission = () => (input: Parameters<typeof f.acceptQueued>[0]) => {
    transformed = input.item.queuedContent;
    f.acceptQueued(input);
    revoked = true;
  };
  const before = f.snapshot();
  const result = await f.route({ content: "original", mode: "queue" });
  expect(result.status).toBe(403);
  expect(transformed).toBe("prepared atomic queue");
  expect(f.snapshot()).toEqual(before);
  expect(f.channel.getQueuedFollowupItems("web:default")).toEqual([]);
});

// Deterministic SDK integration, not a provider-backed/live-user queue mutation.


for (const timing of ['json', 'preparation'] as const) for (const busy of [false, true]) {
  test(`prepared request retains pre-JSON database profile authority through SQL phases: ${timing}, queued=${busy}`, async () => {
    const f = fixture(undefined, () => true), store = process.env.PICLAW_STORE, before = f.snapshot();
    f.channel.getInputSourceAdmission = () => f.accept; f.channel.getQueuedInputSourceAdmission = () => f.acceptQueued;
    f.busy(busy); f.expectSources(1);
    f.channel.prepareInputText = (_chat, text) => {
      if (timing === 'preparation') process.env.PICLAW_STORE = store + '-rebound';
      return { text, assertCurrent() {} };
    };
    const req = new Request('http://fixture/agent/default/message', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://fixture' }, body: JSON.stringify({ content: 'must not adopt a different profile' }) });
    if (timing === 'json') {
      const json = req.json.bind(req); req.json = async () => { process.env.PICLAW_STORE = store + '-rebound'; return json(); };
    }
    try {
      const response = await f.channel.handleRequest(req);
      expect(response.status).toBeGreaterThanOrEqual(400); expect(f.snapshot()).toEqual(before);
      expect(f.channel.getQueuedFollowupItems('web:default')).toEqual([]); expect(f.events).toEqual([]); expect(f.jobs).toEqual([]);
    } finally { if (store === undefined) delete process.env.PICLAW_STORE; else process.env.PICLAW_STORE = store; }
  });
}

test('stale request profile is rejected before source preparation can publish native allocation metadata', async () => {
  const f = fixture(), store = process.env.PICLAW_STORE, before = f.snapshot(); let preparations = 0;
  f.channel.prepareInputSourceAdmission = async () => { preparations++; f.db.query("INSERT INTO router_state(key,value) VALUES ('stale-allocation','must not run')").run(); };
  const req = new Request('http://fixture/agent/default/message', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://fixture' }, body: JSON.stringify({ content: 'stale preparation' }) });
  const json = req.json.bind(req); req.json = async () => { process.env.PICLAW_STORE = store + '-rebound'; return json(); };
  try {
    const response = await f.channel.handleRequest(req);
    expect(response.status).toBeGreaterThanOrEqual(400); expect(preparations).toBe(0); expect(f.snapshot()).toEqual(before);
    expect(f.db.query("SELECT value FROM router_state WHERE key='stale-allocation'").get()).toBeNull();
  } finally { if (store === undefined) delete process.env.PICLAW_STORE; else process.env.PICLAW_STORE = store; }
});

for (const busy of [false, true]) test(`prepared request forwards synchronous SQL authority phases for direct/queued admission: queued=${busy}`, async () => {
  const f = fixture(undefined, () => true); f.busy(busy); f.expectSources(1);
  f.channel.prepareInputText = (_chat, text) => ({ text, assertCurrent() {} });
  f.channel.getInputSourceAdmission = () => f.accept; f.channel.getQueuedInputSourceAdmission = () => f.acceptQueued;
  const body = JSON.stringify({ content: 'phase-pinned prepared input' });
  const req = new Request('http://fixture/agent/default/message', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://fixture' }, body });
  const { bindInputRequestAuthority, releaseInputRequestAuthority } = await import('../../../src/channels/web/messaging/input-request-authority.js');
  const phases: string[] = [];
  bindInputRequestAuthority(req, 'web:default', body, phase => {
    if (f.db.inTransaction) phases.push(phase ?? 'missing');
  });
  try { expect((await f.channel.handleRequest(req)).status).toBe(201); expect(phases).toEqual(['before', 'after']); }
  finally { releaseInputRequestAuthority(req); }
});
