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
import { getDeferredQueuedFollowups, setDeferredQueuedFollowups } from "../../../src/db.js";

let cleanup = () => {};
afterEach(async () => { await closeDatabase(); cleanup(); resetRateLimiterStateForTests(); });
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
  channel.getInputSourceAdmission ??= () => accept;
  channel.dispatchAcceptedInput = async (_chat, _id, row) => ({ submission_id: row, queued: active || streaming });
  const route = (body: Record<string, unknown> = { content: "ordinary input" }, signal?: AbortSignal) => channel.handleRequest(new Request(
    "http://fixture/agent/default/message", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://fixture" },
      body: JSON.stringify(body), signal }));
  const snapshot = () => ["chat_cursors", "messages", "chats", "media", "message_media", "sqlite_sequence", "service_effect_s01_chats",
    "service_effect_s01_sources", "service_effect_s01_decisions", "service_effect_s01_wake_intents"].map(table => db.query(`SELECT * FROM ${table}`).all());
  return { channel, db, work: made.value, accept, route, snapshot, events, jobs,
    expectSources(count: number) { expectedSources = count; },
    busy(value: boolean, stream = false) { active = value; streaming = stream; } };
}

test("missing native ports fail closed, including forged engine and callback fields", async () => {
  const f = fixture();
  f.channel.getInputSourceAdmission = undefined; f.channel.dispatchAcceptedInput = undefined;
  expect(f.channel.getInputSourceAdmission).toBeUndefined();
  expect(f.channel.getQueuedInputSourceAdmission).toBeUndefined();
  expect(f.channel.dispatchAcceptedInput).toBeUndefined();
  const response = await f.route({ content: "ordinary input", engine: "durable", acceptSource: "forged", getInputSourceAdmission: "forged" });
  expect(response.status).toBe(503);
  expect(f.db.query("SELECT * FROM messages").all()).toHaveLength(0);
  expect(f.db.query("SELECT * FROM service_effect_s01_sources").all()).toHaveLength(0);
  expect(f.jobs).toHaveLength(0);
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
  expect(f.jobs).toHaveLength(0);
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
  let captured = false;
  Object.defineProperty(f.channel, 'getInputSourceAdmission', { configurable: true, get() {
    captured = true; return () => { selected++; return f.accept; };
  } });
  let release!: () => void, reading!: () => void;
  const entered = new Promise<void>(resolve => { reading = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const req = new Request("http://fixture/agent/default/message", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://fixture" },
    body: new ReadableStream({ async pull(controller) { reading(); await gate; controller.enqueue(new TextEncoder().encode(JSON.stringify({ content: "delayed input", engine: "forged" }))); controller.close(); } }) });
  const pending = f.channel.handleRequest(req);
  await entered;
  // Stream prefetch can precede route guards. Observe capture, not invocation.
  for (let n = 0; n < 100 && !captured; n++) await Bun.sleep(0);
  expect(captured).toBe(true); expect(selected).toBe(0);
  Object.defineProperty(f.channel, 'getInputSourceAdmission', { configurable: true,
    value: () => { throw Error('replacement must not be consulted'); } });
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
  expect(f.jobs).toHaveLength(0);
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
    f.channel.agentPool.applyControlCommand = async () => { throw Error("Must not dispatch queued input as a legacy control"); };
    f.busy(busy); f.expectSources(1);
    const response = await f.route({ content: `/${command} qualified payload` });
    expect(response.status).toBe(201);
    expect(prepared).toBe(1);
    expect(f.db.query("SELECT * FROM service_effect_s01_sources").all()).toHaveLength(1);
    expect(f.db.query("SELECT content FROM messages").all()).toEqual([{ content: "prepared:qualified payload" }]);
    expect((await response.json()).queued).toBe(busy ? (command === 'steer' ? 'steer' : 'followup') : undefined);
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

test('prepared text keeps one source and the same SQL authority on direct and SDK-queued admission', async()=>{
 const f=fixture(undefined,()=>true);let checks=0,preparations=0;
 f.channel.prepareInputText=(_chat,text)=>{preparations++;return {text:'prepared:'+text,assertCurrent(){checks++;}};};
 for(const busy of [false,true]){f.busy(busy);f.expectSources(busy?2:1);expect((await f.route({content:busy?'queued':'direct'})).status).toBe(201);}
 expect(f.db.query('SELECT content FROM messages ORDER BY rowid').all()).toEqual([{content:'prepared:direct'},{content:'prepared:queued'}]);
 expect(checks).toBeGreaterThan(2);expect(preparations).toBe(2);
 const before=f.snapshot();f.channel.prepareInputText=()=>({text:'stale',assertCurrent(){throw Error('Goal lifecycle revoked');}});
 expect((await f.route()).status).toBe(503);expect(f.snapshot()).toEqual(before);
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

for (const timing of ['json', 'preparation'] as const) for (const busy of [false, true]) {
  test(`prepared request retains pre-JSON database profile authority through SQL phases: ${timing}, queued=${busy}`, async () => {
    const f = fixture(undefined, () => true), store = process.env.PICLAW_STORE, before = f.snapshot();
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
      expect(f.events).toEqual([]); expect(f.jobs).toEqual([]);
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
