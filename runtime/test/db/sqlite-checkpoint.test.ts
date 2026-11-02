import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, statSync, renameSync, symlinkSync, linkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerSqliteCheckpoint } from "../../src/db/sqlite-checkpoint.js";
import { addLogSink, removeLogSink, type LogRecord } from "../../src/utils/logger.js";
import { waitFor } from "../helpers.js";
function fixture() {
  const base = join(process.env.PICLAW_WORKSPACE || tmpdir(), "piclaw/tests/checkpoint"); mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, "run-")), path = join(root, "test.db"), db = new Database(path);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE fixture(value BLOB)");
  return { root, path, db, close() { db.close(); rmSync(root, { recursive: true, force: true }); } };
}
test("checkpoint coordinator retains FULL durability and shares a worker across writers", async () => {
  const f = fixture(), second = new Database(f.path);
  const stop = registerSqliteCheckpoint(f.db, f.path, true)!, stopSecond = registerSqliteCheckpoint(second, f.path, true)!;
  try {
    await waitFor(() => (f.db.query("PRAGMA wal_autocheckpoint").get() as any).wal_autocheckpoint === 0, 3000);
    expect(second.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 0 });
    expect(f.db.query("PRAGMA synchronous").get()).toEqual({ synchronous: 2 });
    expect(second.query("PRAGMA synchronous").get()).toEqual({ synchronous: 2 });
    f.db.query("INSERT INTO fixture VALUES (zeroblob(5000000))").run();
    expect(second.query("SELECT length(value) n FROM fixture").get()).toEqual({ n: 5000000 });
    stop(); f.db.close();
    expect(second.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 0 });
    await Bun.sleep(1200);
    expect(second.query("SELECT length(value) n FROM fixture").get()).toEqual({ n: 5000000 });
  } finally { stop(); stopSecond(); second.close(); f.close(); }
});
test("checkpoint worker performs PASSIVE IO off-thread and preserves a live reader", async () => {
  const f = fixture(), identity = statSync(f.path), reader = new Database(f.path);
  const worker = new Worker(new URL("../../src/db/sqlite-checkpoint-worker.ts", import.meta.url).href);
  const messages: any[] = [];
  worker.addEventListener("message", event => messages.push(event.data));
  try {
    worker.postMessage({ path: f.path, dev: identity.dev, ino: identity.ino });
    await waitFor(() => messages.some(m => m.type === "ready"), 3000);
    f.db.exec("PRAGMA wal_autocheckpoint=0");
    reader.exec("BEGIN"); reader.query("SELECT count(*) FROM fixture").get();
    f.db.query("INSERT INTO fixture VALUES (zeroblob(5000000))").run();
    await waitFor(() => messages.some(m => m.type === "checkpoint"), 3000);
    const result = messages.find(m => m.type === "checkpoint").result;
    expect(result.log).toBeGreaterThan(result.checkpointed);
    expect(reader.query("SELECT count(*) n FROM fixture").get()).toEqual({ n: 0 });
    reader.exec("ROLLBACK");
    await waitFor(() => messages.some(m => m.type === "checkpoint" && m.result.log === m.result.checkpointed), 3000);
    expect(f.db.query("PRAGMA synchronous").get()).toEqual({ synchronous: 2 });
  } finally { worker.terminate(); reader.close(); f.close(); }
});
test("worker failure restores safe checkpointing despite an already closed peer", async () => {
  const f = fixture(), second = new Database(f.path);
  const stop = registerSqliteCheckpoint(f.db, f.path, true)!, stopSecond = registerSqliteCheckpoint(second, f.path, true)!;
  let moved = false;
  try {
    await waitFor(() => (f.db.query("PRAGMA wal_autocheckpoint").get() as any).wal_autocheckpoint === 0, 3000);
    second.close();
    renameSync(f.path, f.path + ".moved"); moved = true;
    await waitFor(() => (f.db.query("PRAGMA wal_autocheckpoint").get() as any).wal_autocheckpoint === 1000, 3000);
    expect(f.db.query("PRAGMA synchronous").get()).toEqual({ synchronous: 2 });
  } finally { if (moved) renameSync(f.path + ".moved", f.path); stopSecond(); stop(); second.close(); f.close(); }
});
test("non-ZFS policy leaves built-in checkpoint unchanged", () => {
  const f = fixture(); try { expect(registerSqliteCheckpoint(f.db, f.path, false)).toBeUndefined();
    expect(f.db.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 1000 });
  } finally { f.close(); }
});

test("non-WAL databases never start a checkpoint reader", () => {
  const f = fixture();
  try {
    f.db.exec("PRAGMA journal_mode=DELETE");
    expect(registerSqliteCheckpoint(f.db, f.path, true)).toBeUndefined();
    expect(f.db.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "delete" });
    expect(f.db.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 1000 });
    expect(f.db.query("PRAGMA synchronous").get()).toEqual({ synchronous: 2 });
  } finally { f.close(); }
});

test("unregistering a closed writer is safe and repeatable", async () => {
  const f = fixture(), stop = registerSqliteCheckpoint(f.db, f.path, true)!;
  try {
    await waitFor(() => (f.db.query("PRAGMA wal_autocheckpoint").get() as any).wal_autocheckpoint === 0, 3000);
    f.db.close();
    expect(stop).not.toThrow();
    expect(stop).not.toThrow();
  } finally { stop(); f.close(); }
});


test("canonical symlink writers share one worker and repeated registrations retain custom policies", async () => {
  const f = fixture(), alias = join(f.root, "alias.db");
  symlinkSync(f.path, alias);
  const peer = new Database(alias), records: LogRecord[] = [];
  const sink = (record: LogRecord) => { if (record.path === f.path) records.push(record); };
  addLogSink(sink);
  f.db.exec("PRAGMA wal_autocheckpoint=37");
  peer.exec("PRAGMA wal_autocheckpoint=81");
  const stop = registerSqliteCheckpoint(f.db, alias, true)!;
  const repeat = registerSqliteCheckpoint(f.db, f.path, true)!;
  const stopPeer = registerSqliteCheckpoint(peer, alias, true)!;
  try {
    await waitFor(() => (peer.query("PRAGMA wal_autocheckpoint").get() as any).wal_autocheckpoint === 0, 3000);
    const lateRepeat = registerSqliteCheckpoint(f.db, alias, true)!;
    stop(); stop(); repeat();
    expect(f.db.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 0 });
    lateRepeat();
    expect(f.db.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 37 });
    expect(peer.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 0 });
    expect(records.filter(r => r.operation === "sqlite_checkpoint.ready")).toHaveLength(1);
    stopPeer();
    expect(peer.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 81 });
  } finally { stop(); repeat(); stopPeer(); removeLogSink(sink); peer.close(); f.close(); }
});

test("mismatched paths, hardlink WAL names and non-FULL writers keep their original policy", () => {
  const f = fixture(), other = fixture();
  try {
    f.db.exec("PRAGMA wal_autocheckpoint=19");
    expect(registerSqliteCheckpoint(f.db, other.path, true)).toBeUndefined();
    const hardlink = join(f.root, "hard.db"); linkSync(f.path, hardlink);
    expect(registerSqliteCheckpoint(f.db, hardlink, true)).toBeUndefined();
    rmSync(hardlink);
    f.db.exec("PRAGMA synchronous=NORMAL");
    expect(registerSqliteCheckpoint(f.db, f.path, true)).toBeUndefined();
    expect(f.db.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 19 });
  } finally { other.close(); f.close(); }
});

test("real pinned-reader checkpoint reports stall and resume without confusing allocation", async () => {
  const f = fixture(), reader = new Database(f.path), records: LogRecord[] = [];
  const sink = (record: LogRecord) => {
    if (record.path === f.path && record.operation === "sqlite_checkpoint.progress") records.push(record);
  };
  addLogSink(sink);
  const stop = registerSqliteCheckpoint(f.db, f.path, true)!;
  try {
    await waitFor(() => (f.db.query("PRAGMA wal_autocheckpoint").get() as any).wal_autocheckpoint === 0, 3000);
    reader.exec("BEGIN"); reader.query("SELECT count(*) FROM fixture").get();
    f.db.query("INSERT INTO fixture VALUES (zeroblob(5000000))").run();
    await waitFor(() => records.some(r => r.state === "stalled"), 3000);
    const stalled = records.find(r => r.state === "stalled")!;
    expect(stalled.pendingFrames).toBeGreaterThan(0);
    expect(stalled.activeConnectionCount).toBe(1);
    reader.exec("ROLLBACK");
    await waitFor(() => records.some(r => r.state === "complete" && r.pendingFrames === 0), 3000);
    const complete = records.find(r => r.state === "complete" && r.pendingFrames === 0)!;
    expect(complete.walBytes).toBeGreaterThan(4 * 1024 * 1024);
    expect(statSync(f.path + "-wal").size).toBeGreaterThan(4 * 1024 * 1024);
  } finally { stop(); removeLogSink(sink); reader.close(); f.close(); }
});

test("structured checkpoint observations suppress duplicate heartbeats until the reporting bound", async () => {
  const f = fixture(), records: LogRecord[] = [], RealWorker = globalThis.Worker, realNow = Date.now;
  let worker: EventTarget, now = realNow();
  const sink = (record: LogRecord) => { if (record.path === f.path && record.operation === "sqlite_checkpoint.progress") records.push(record); };
  let stop: (() => void) | undefined;
  try {
    globalThis.Worker = class extends EventTarget {
      constructor() { super(); worker = this; }
      postMessage() { queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: { type: "ready" } }))); }
      terminate() {}
    } as unknown as typeof Worker;
    Date.now = () => now;
    addLogSink(sink); stop = registerSqliteCheckpoint(f.db, f.path, true)!;
    await Promise.resolve();
    expect(f.db.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 0 });
    const report = (checkpointed: number) => worker.dispatchEvent(new MessageEvent("message", {
      data: { type: "checkpoint", result: { busy: 0, log: 1225, checkpointed }, walBytes: 5_047_032 },
    }));
    report(2); now += 1000; report(2);
    expect(records.map(r => r.state)).toEqual(["progress", "stalled"]);
    now += 1200; report(2); expect(records).toHaveLength(2);
    now += 28_799; report(2); expect(records).toHaveLength(2);
    now++; report(2); expect(records).toHaveLength(3);
    report(1225); expect(records.map(r => r.state)).toEqual(["progress", "stalled", "stalled", "complete"]);
    expect(records.at(-1)).toMatchObject({ pendingFrames: 0, walBytes: 5_047_032, activeConnectionCount: 1 });
  } finally { stop?.(); removeLogSink(sink); Date.now = realNow; globalThis.Worker = RealWorker; f.close(); }
});

test("failed groups restore custom policies and never restart for late writers", async () => {
  const f = fixture(), peer = new Database(f.path), records: LogRecord[] = [];
  const sink = (record: LogRecord) => { if (record.path === f.path) records.push(record); };
  addLogSink(sink);
  f.db.exec("PRAGMA wal_autocheckpoint=23"); peer.exec("PRAGMA wal_autocheckpoint=67");
  const stop = registerSqliteCheckpoint(f.db, f.path, true)!, stopPeer = registerSqliteCheckpoint(peer, f.path, true)!;
  let late: Database | undefined, stopLate: (() => void) | undefined, moved = false;
  try {
    await waitFor(() => (f.db.query("PRAGMA wal_autocheckpoint").get() as any).wal_autocheckpoint === 0, 3000);
    renameSync(f.path, f.path + ".moved"); moved = true;
    await waitFor(() => (f.db.query("PRAGMA wal_autocheckpoint").get() as any).wal_autocheckpoint === 23, 3000);
    expect(peer.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 67 });
    renameSync(f.path + ".moved", f.path); moved = false;
    late = new Database(f.path); late.exec("PRAGMA wal_autocheckpoint=91");
    stopLate = registerSqliteCheckpoint(late, f.path, true)!;
    await Bun.sleep(1200);
    expect(late.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 91 });
    expect(records.filter(r => r.operation === "sqlite_checkpoint.ready")).toHaveLength(1);
    expect(records.filter(r => r.operation === "sqlite_checkpoint.fallback")).toHaveLength(1);
  } finally {
    if (moved) renameSync(f.path + ".moved", f.path);
    stopLate?.(); late?.close(); stopPeer(); stop(); peer.close(); removeLogSink(sink); f.close();
  }
});

test("startup and postMessage failures retain custom built-in policies without leaking workers", () => {
  const f = fixture(), RealWorker = globalThis.Worker;
  let terminated = 0;
  try {
    f.db.exec("PRAGMA wal_autocheckpoint=43");
    for (const stage of ["construct", "post"]) {
      globalThis.Worker = class extends EventTarget {
        constructor() { super(); if (stage === "construct") throw Error("startup failure"); }
        postMessage() { throw Error("post failure"); }
        terminate() { terminated++; }
      } as any;
      const stop = registerSqliteCheckpoint(f.db, f.path, true)!;
      expect(f.db.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 43 });
      stop(); stop();
    }
    expect(terminated).toBeGreaterThan(0);
  } finally { globalThis.Worker = RealWorker; f.close(); }
});

test("a ready-time closed peer triggers sticky fallback and a late ready cannot disable writers", () => {
  const f = fixture(), peer = new Database(f.path), RealWorker = globalThis.Worker;
  let worker: EventTarget;
  globalThis.Worker = class extends EventTarget {
    constructor() { super(); worker = this; }
    postMessage() {}
    terminate() {}
  } as any;
  f.db.exec("PRAGMA wal_autocheckpoint=53");
  const stop = registerSqliteCheckpoint(f.db, f.path, true)!, stopPeer = registerSqliteCheckpoint(peer, f.path, true)!;
  try {
    peer.close();
    worker!.dispatchEvent(new MessageEvent("message", { data: { type: "ready" } }));
    expect(f.db.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 53 });
    worker!.dispatchEvent(new MessageEvent("message", { data: { type: "ready" } }));
    expect(f.db.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 53 });
  } finally { stopPeer(); stop(); globalThis.Worker = RealWorker; peer.close(); f.close(); }
});


test("frame-counter resets do not fabricate stalls and unavailable counters are not zero pending work", () => {
  const f=fixture(), RealWorker=globalThis.Worker, records:LogRecord[]=[];
  let worker:EventTarget;
  const sink=(record:LogRecord)=>{if(record.path===f.path&&record.operation==='sqlite_checkpoint.progress')records.push(record);};
  addLogSink(sink);
  globalThis.Worker=class extends EventTarget {constructor(){super();worker=this;}postMessage(){}terminate(){}} as any;
  const stop=registerSqliteCheckpoint(f.db,f.path,true)!;
  try {
    worker!.dispatchEvent(new MessageEvent('message',{data:{type:'ready'}}));
    const send=(busy:number,log:number,checkpointed:number,error?:string)=>worker!.dispatchEvent(new MessageEvent('message',{
      data:{type:'checkpoint',result:{busy,log,checkpointed},walBytes:8000000,error},
    }));
    send(0,40,40);send(0,100,0);send(0,100,0);send(1,-1,-1,'SQLITE_BUSY');
    expect(records.map(record=>record.state)).toEqual(['complete','progress','stalled','busy']);
    expect(records.at(-1)!.pendingFrames).toBeNull();
    expect(records.at(-1)!.activeConnectionCount).toBe(1);
  } finally {stop();globalThis.Worker=RealWorker;removeLogSink(sink);f.close();}
});

test("a failed worker enables safe fallback for an originally disabled built-in checkpoint", () => {
  const f=fixture(),RealWorker=globalThis.Worker;
  globalThis.Worker=class {constructor(){throw Error('fixture startup failure');}} as any;
  f.db.exec('PRAGMA wal_autocheckpoint=0');
  let stop:(()=>void)|undefined;
  try {
    stop=registerSqliteCheckpoint(f.db,f.path,true);
    expect(f.db.query('PRAGMA wal_autocheckpoint').get()).toEqual({wal_autocheckpoint:1000});
    stop!();
    expect(f.db.query('PRAGMA wal_autocheckpoint').get()).toEqual({wal_autocheckpoint:0});
  } finally {stop?.();globalThis.Worker=RealWorker;f.close();}
});


test("late zero-policy writers joining a failed group receive safe fallback without spawning another worker", () => {
  const f=fixture(),late=new Database(f.path),RealWorker=globalThis.Worker;let attempts=0;
  globalThis.Worker=class {constructor(){attempts++;throw Error('fixture startup failure');}} as any;
  f.db.exec('PRAGMA wal_autocheckpoint=17');late.exec('PRAGMA wal_autocheckpoint=0');
  let stop:(()=>void)|undefined,stopLate:(()=>void)|undefined,repeat:(()=>void)|undefined;
  try {
    stop=registerSqliteCheckpoint(f.db,f.path,true);
    stopLate=registerSqliteCheckpoint(late,f.path,true);
    expect(late.query('PRAGMA wal_autocheckpoint').get()).toEqual({wal_autocheckpoint:1000});
    repeat=registerSqliteCheckpoint(late,f.path,true);
    expect(attempts).toBe(1);stopLate!();
    expect(late.query('PRAGMA wal_autocheckpoint').get()).toEqual({wal_autocheckpoint:1000});
    repeat!();
    expect(late.query('PRAGMA wal_autocheckpoint').get()).toEqual({wal_autocheckpoint:0});
    expect(f.db.query('PRAGMA wal_autocheckpoint').get()).toEqual({wal_autocheckpoint:17});
  } finally {repeat?.();stopLate?.();stop?.();globalThis.Worker=RealWorker;late.close();f.close();}
});
