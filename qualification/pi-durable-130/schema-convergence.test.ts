import "./src/test-guard.js";
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { initializeHostSchema, initializeHostDurableBindings, createHostDurableBindings, HostCutoverController } from "../../runtime/durable-engine/src/index.js";
import { acceptedPayloadRecoveryIndex, migrateHostAcceptedPayloadLookup, prepareHostSchema } from '../../runtime/durable-engine/src/host-schema.js';
import { acceptedPayloadRecoverySql, readApplicationMessagePayload } from '../../runtime/durable-engine/src/accepted-payload-recovery.js';
import {nativeMessageFixture} from './src/native-message-fixture.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

for (const offline of [true, false]) {
  test(`host schema preparation yields before its one owned transaction; offline=${offline}`, async () => {
    const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, 'schema-admission-'));
    const path = join(dir, 'root.sqlite'), db = new Database(path), blocker = new Database(path);
    let release: ReturnType<typeof setTimeout> | undefined;
    try {
      db.exec('PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;PRAGMA busy_timeout=0');
      if (!offline) { initializeHostSchema(db, () => {}); removeLookupStep(db); }
      blocker.exec('BEGIN IMMEDIATE');
      let released = false, turns = 0;
      const tick = setInterval(() => { turns++; }, 5);
      try {
        release = setTimeout(() => { blocker.exec('ROLLBACK'); released = true; }, 75);
        await prepareHostSchema(db, () => {}, offline);
      } finally { clearInterval(tick); }
      expect(released).toBe(true); expect(turns).toBeGreaterThan(0);
      expect(db.inTransaction).toBe(false); expect(lookupReceipt(db)).toHaveLength(1);
      expect(db.query('PRAGMA busy_timeout').get()).toEqual({ timeout: 0 });
      expect(db.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    } finally {
      clearTimeout(release); if (blocker.inTransaction) blocker.exec('ROLLBACK');
      blocker.close(); db.close(); await rm(dir, { recursive: true, force: true });
    }
  });
}

for (const failure of ['abort', 'owner', 'binding'] as const) {
  test(`host schema preparation fences ${failure} across acquisition without publishing DDL`, async () => {
    const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, 'schema-revocation-'));
    const path = join(dir, 'root.sqlite'), db = new Database(path), blocker = new Database(path);
    const signal = new AbortController(); let allowed = true;
    const guard = (kind: typeof failure) => { if (failure === kind && !allowed) throw Error('schema revoked'); };
    try {
      db.exec('PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;PRAGMA busy_timeout=0');
      blocker.exec('BEGIN IMMEDIATE');
      const pending = prepareHostSchema(db, () => guard('owner'), true, signal.signal, () => guard('binding'));
      await Bun.sleep(0); allowed = false;
      if (failure === 'abort') signal.abort(Error('schema revoked'));
      blocker.exec('ROLLBACK');
      await expect(pending).rejects.toThrow('schema revoked');
      expect(db.query("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);
      expect(db.inTransaction).toBe(false);
      expect(db.query('PRAGMA busy_timeout').get()).toEqual({ timeout: 0 });
      allowed = true; await prepareHostSchema(db, () => {}, true);
      expect(lookupReceipt(db)).toHaveLength(1);
    } finally {
      if (blocker.inTransaction) blocker.exec('ROLLBACK');
      blocker.close(); db.close(); await rm(dir, { recursive: true, force: true });
    }
  });
}


test("host schema: FK, exact synchronous guard, atomic DDL and incompatible shapes fail closed", () => {
  const db = new Database(":memory:");
  const tables = () => db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  try {
    expect(() => initializeHostSchema(db, () => {})).toThrow("foreign_keys ON");
    db.exec("PRAGMA foreign_keys=ON");
    for (const guard of [() => true, () => Promise.resolve()]) {
      expect(() => initializeHostSchema(db, guard as () => void)).toThrow("owner guard");
      expect(tables()).toEqual([]);
    }
    let calls = 0;
    expect(() => initializeHostSchema(db, () => { if (++calls === 3) throw Error("Owner lost"); })).toThrow("Owner lost");
    expect(tables()).toEqual([]);
    db.exec("CREATE TABLE qualification_cutover_work_v1 (domain TEXT)");
    expect(() => initializeHostSchema(db, () => {})).toThrow("Unsupported host schema");
    expect(tables()).toEqual([{ name: "qualification_cutover_work_v1" }]);
  } finally { db.close(); }
});

test("host schema: existing primary/submission identity preserved; missing intents unsupported on reads", async () => {
  const db = new Database(":memory:"); db.exec("PRAGMA foreign_keys=ON");
  try {
    initializeHostDurableBindings(db, () => {});
    db.query("INSERT INTO piclaw_durable_bindings_v1 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run("d", "i", 1, "chat", "main", "op", 1, "source", "payload", "request", "a".repeat(64), 42);
    const rows = () => db.query("SELECT * FROM piclaw_durable_bindings_v1").all();
    const before = rows(); initializeHostSchema(db, () => {}); expect(rows()).toEqual(before);
    const drift = new Database(":memory:");
    try {
      drift.exec("PRAGMA foreign_keys=ON");
      const ddl = (db.query("SELECT sql FROM sqlite_master WHERE name='piclaw_durable_bindings_v1'").get() as { sql: string }).sql;
      drift.exec(ddl.replace("UNIQUE(domain,incarnation,submission_id),", ""));
      expect(() => initializeHostSchema(drift, () => {})).toThrow("Unsupported host schema");
      expect(drift.query("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([{ name: "piclaw_durable_bindings_v1" }]);
    } finally { drift.close(); }
    expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(0);
    db.exec("DROP TABLE piclaw_durable_intent_bindings_v1");
    const store = createHostDurableBindings(db, { domain: "d", incarnation: "i", manifest: [], assertOwner() {}, async resolveContent() { return ""; } });
    await expect(store.findSource("chat", 1)).rejects.toThrow("Unsupported host schema");
    expect(rows()).toEqual(before);
    expect(db.query("SELECT name FROM sqlite_master WHERE name='piclaw_durable_intent_bindings_v1'").get()).toBeNull();
  } finally { db.close(); }
});

test("cutover: stale JSON count cannot override existing work rows on inspect, record or rollback", () => {
  const db = new Database(":memory:"); db.exec("PRAGMA foreign_keys=ON");
  try {
    initializeHostSchema(db, () => {});
    const identity = { domain: "d", incarnation: "i", ownerGeneration: 1, sourceEngineId: "source", candidateStoreRef: "candidate" };
    const digest = "a".repeat(64);
    const manifest = { phase: "active", revision: 0, writer: "candidate", postCutoverCount: 999,
      request: { requestKey: "r", sourceDigest: digest, importHash: digest }, receipt: null };
    db.query("INSERT INTO qualification_cutover_v1 VALUES (?,?,?,?)").run("d", JSON.stringify(identity), digest, JSON.stringify(manifest));
    const controller = new HostCutoverController(db, identity, { assertOwner() {}, assertCurrentWriter() {},
      checkDrained() { return { sourceDigest: digest, pending: 0, inflight: 0 }; } });
    expect(controller.inspect()!.postCutoverCount).toBe(0);
    db.query("INSERT INTO qualification_cutover_work_v1 VALUES (?,?,?)").run("d", "op", digest);
    expect(controller.inspect()!.postCutoverCount).toBe(1);
    expect(controller.recordPostCutoverWork(0, { operationId: "op", contentHash: digest }).postCutoverCount).toBe(1);
    expect(controller.recordPostCutoverWork(1, { operationId: "op2", contentHash: digest }).postCutoverCount).toBe(2);
    expect(controller.prepareRollback(2).reasons).toContain("recorded_work");
  } finally { db.close(); }
});

const lookupReceipt = (db: Database) => db.query("SELECT * FROM piclaw_schema_migrations WHERE owner='host.native-bindings' ORDER BY migration_order").all();
function removeLookupStep(db: Database) {
  db.exec(`DROP INDEX ${acceptedPayloadRecoveryIndex}`);
  db.exec("DELETE FROM piclaw_schema_migrations WHERE owner='host.native-bindings'");
}

test('host binding lookup migration is owned, atomic, exact and idempotent without row changes', () => {
  const db = new Database(':memory:'); db.exec('PRAGMA foreign_keys=ON');
  try {
    initializeHostSchema(db, () => {});
    expect(lookupReceipt(db)).toHaveLength(1);
    expect(db.query(`PRAGMA index_info(${acceptedPayloadRecoveryIndex})`).all().map(row => (row as {name:string}).name))
      .toEqual(['incarnation', 'chat_jid', 'source_id', 'payload_ref']);
    db.query('INSERT INTO piclaw_durable_bindings_v1 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('d','i',1,'chat','main','op',1,'source','payload','request','a'.repeat(64),null);
    const rows = db.query('SELECT * FROM piclaw_durable_bindings_v1').all();
    removeLookupStep(db);
    let calls = 0;
    expect(() => migrateHostAcceptedPayloadLookup(db, () => { if (++calls === 3) throw Error('owner lost'); })).toThrow('owner lost');
    expect(lookupReceipt(db)).toEqual([]);
    expect(db.query('SELECT 1 FROM sqlite_master WHERE name=?').get(acceptedPayloadRecoveryIndex)).toBeNull();
    expect(db.query('SELECT * FROM piclaw_durable_bindings_v1').all()).toEqual(rows);
    migrateHostAcceptedPayloadLookup(db, () => {});
    const receipt = lookupReceipt(db);
    const index = db.query('SELECT sql,rootpage FROM sqlite_master WHERE name=?').get(acceptedPayloadRecoveryIndex);
    migrateHostAcceptedPayloadLookup(db, () => {}); initializeHostSchema(db, () => {});
    expect(lookupReceipt(db)).toEqual(receipt);
    expect(db.query('SELECT sql,rootpage FROM sqlite_master WHERE name=?').get(acceptedPayloadRecoveryIndex)).toEqual(index);
    expect(db.query('SELECT * FROM piclaw_durable_bindings_v1').all()).toEqual(rows);
    // A receipt without its index is drift, never a silently successful reopen.
    db.exec(`DROP INDEX ${acceptedPayloadRecoveryIndex}`);
    expect(() => migrateHostAcceptedPayloadLookup(db, () => {})).toThrow('Unsupported host schema');
    expect(lookupReceipt(db)).toEqual(receipt);
    expect(db.query('SELECT 1 FROM sqlite_master WHERE name=?').get(acceptedPayloadRecoveryIndex)).toBeNull();
    db.exec((index as {sql:string}).sql);
    removeLookupStep(db);
    db.exec(`CREATE INDEX ${acceptedPayloadRecoveryIndex} ON piclaw_durable_bindings_v1(chat_jid)`);
    expect(() => migrateHostAcceptedPayloadLookup(db, () => {})).toThrow('Unsupported host schema');
    expect(lookupReceipt(db)).toEqual([]);
    expect(db.query('SELECT * FROM piclaw_durable_bindings_v1').all()).toEqual(rows);
  } finally { db.close(); }
});

test('real native accepted-payload fallback uses retained indexed bindings without granting changed/deleted display input',async()=>{
  const f=await nativeMessageFixture();
  try{
    await f.open();const primary=f.accept('primary A'),id=await f.runtime.submitMessage(primary);expect((await f.runtime.waitForMessage(primary,id)).status).toBe('done');
    // All subsequent corruption is disposable forensic test input, after the
    // real SDK owner is closed; never mutate beneath a live Session.
    await f.runtime.close();const db=f.root,params=[primary.chatJid,primary.sourceId,primary.payloadRef,f.domain];
    const original=db.query(acceptedPayloadRecoverySql).get(...params);expect(original).not.toBeNull();
    const insert=db.query('INSERT INTO piclaw_durable_bindings_v1 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
    db.transaction(()=>{for(let i=0;i<4000;i++)insert.run('retained',f.domain,f.base.root.id,`retained-chat-${i%20}`,'main',`retained-op-${i}`,i+1000,`retained-source-${i}`,`retained-payload-${i}`,`retained-request-${i}`,'a'.repeat(64),null);}).immediate();
    const rows=()=>db.query('SELECT * FROM piclaw_durable_bindings_v1 ORDER BY domain,operation_id').all(),retained=rows();removeLookupStep(db);
    const plan=()=>(db.query(`EXPLAIN QUERY PLAN ${acceptedPayloadRecoverySql}`).all(...params) as {detail:string}[]).map(row=>row.detail);
    expect(plan().some(detail=>/SCAN b\b/.test(detail))).toBe(true);migrateHostAcceptedPayloadLookup(db,f.options.owner.assert);const indexed=plan();
    expect(indexed.some(detail=>detail.includes(`SEARCH b USING INDEX ${acceptedPayloadRecoveryIndex}`))).toBe(true);
    for(const alias of ['s','e'])expect(indexed.some(detail=>detail.startsWith(`SEARCH ${alias} `)&&/PRIMARY KEY|rowid/.test(detail))).toBe(true);
    expect(rows()).toEqual(retained);expect(db.query(acceptedPayloadRecoverySql).get(...params)).toEqual(original);
    const bindings=createHostDurableBindings(db,{domain:f.domain,incarnation:f.domain,manifest:[{chatJid:f.chat,branchId:'main',conversationId:f.base.root.id}],assertOwner:f.options.owner.assert,async resolveContent(ref,input){return readApplicationMessagePayload(db,f.domain,input,ref);}});
    expect(await bindings.getOrBind(primary)).toEqual({content:'primary A'});
    db.query('UPDATE messages SET content=? WHERE id=? AND chat_jid=?').run('edited display',primary.sourceId,f.chat);
    await expect(bindings.getOrBind(primary)).rejects.toThrow('Host payload hash conflict');
    const editedId=primary.sourceId+':edited-display';db.query('UPDATE messages SET id=? WHERE id=? AND chat_jid=?').run(editedId,primary.sourceId,f.chat);
    expect(readApplicationMessagePayload(db,f.domain,primary,primary.payloadRef)).toBe('primary A');
    await expect(bindings.getOrBind(primary)).rejects.toThrow('Native accepted message changed'); // Passive recovery is not admission permission.
    db.query('DELETE FROM messages WHERE id=? AND chat_jid=?').run(editedId,f.chat);expect(readApplicationMessagePayload(db,f.domain,primary,primary.payloadRef)).toBe('primary A');
    expect(()=>readApplicationMessagePayload(db,f.domain,{...primary,sourceId:'wrong'},primary.payloadRef)).toThrow('Unverified application payload');
    db.query('UPDATE piclaw_durable_bindings_v1 SET request_hash=? WHERE domain=? AND request_id=?').run('b'.repeat(64),f.domain,primary.requestId);
    expect(()=>readApplicationMessagePayload(db,f.domain,primary,primary.payloadRef)).toThrow('Unverified SDK accepted payload');
    db.query('UPDATE piclaw_durable_bindings_v1 SET request_hash=? WHERE domain=? AND request_id=?').run(primary.requestHash,f.domain,primary.requestId);
    const accepted=db.query(`SELECT e.id,e.record FROM submissions s JOIN entries e ON e.id=json_extract(s.record,'$.entry') WHERE s.id=?`).get(id) as {id:number;record:string};
    const changed=JSON.parse(accepted.record);changed.data.sourceId='forged-owner';
    try{db.query('UPDATE entries SET record=? WHERE id=?').run(JSON.stringify(changed),accepted.id);expect(()=>readApplicationMessagePayload(db,f.domain,primary,primary.payloadRef)).toThrow('Unverified SDK accepted payload');}finally{db.query('UPDATE entries SET record=? WHERE id=?').run(accepted.record,accepted.id);}
    expect(readApplicationMessagePayload(db,f.domain,primary,primary.payloadRef)).toBe('primary A');expect(rows()).toEqual(retained);
  }finally{await f.close();}
});
