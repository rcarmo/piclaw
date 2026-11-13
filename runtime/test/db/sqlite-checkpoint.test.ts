import { expect, test } from "bun:test";
import { Database, constants } from "bun:sqlite";
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
test("registration rejects a replaced descriptor even when both path lookups identify the replacement", async () => {
  const f = fixture(), movedPath = f.path + '.original';
  let replacement: Database | undefined, stop: (() => void | Promise<void>) | undefined;
  try {
    f.db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA wal_autocheckpoint=17');
    renameSync(f.path, movedPath);
    replacement = new Database(f.path);
    replacement.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
    const moved = new Int32Array(2);
    expect(f.db.fileControl('main', constants.SQLITE_FCNTL_HAS_MOVED, moved)).toBe(0);
    expect(moved[0]).toBe(1);
    // database_list retains the original filename, so pathname-only comparison
    // now compares the replacement to itself and misses the moved open handle.
    expect((f.db.query('PRAGMA database_list').all() as any[]).find(row => row.name === 'main')!.file).toBe(f.path);
    stop = registerSqliteCheckpoint(f.db, f.path, true);
    expect(stop).toBeUndefined();
    expect(f.db.query('PRAGMA wal_autocheckpoint').get()).toEqual({ wal_autocheckpoint: 17 });
    expect(replacement.query('PRAGMA wal_autocheckpoint').get()).toEqual({ wal_autocheckpoint: 1000 });
  } finally {
    await stop?.(); replacement?.close();
    rmSync(f.path, { force: true }); renameSync(movedPath, f.path); f.close();
  }
});

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
    await stop(); f.db.close();
    expect(second.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 0 });
    await Bun.sleep(1200);
    expect(second.query("SELECT length(value) n FROM fixture").get()).toEqual({ n: 5000000 });
  } finally { await stop(); await stopSecond(); second.close(); f.close(); }
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
  } finally { if (moved) renameSync(f.path + ".moved", f.path); await stopSecond(); await stop(); second.close(); f.close(); }
});
test("non-ZFS policy leaves built-in checkpoint unchanged", async () => {
  const f = fixture(); try { expect(registerSqliteCheckpoint(f.db, f.path, false)).toBeUndefined();
    expect(f.db.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 1000 });
  } finally { f.close(); }
});

test("non-WAL databases never start a checkpoint reader", async () => {
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
  } finally { await stop(); f.close(); }
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
    await stop(); await stop(); await repeat();
    expect(f.db.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 0 });
    lateRepeat();
    expect(f.db.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 37 });
    expect(peer.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 0 });
    expect(records.filter(r => r.operation === "sqlite_checkpoint.ready")).toHaveLength(1);
    await stopPeer();
    expect(peer.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 81 });
  } finally { await stop(); await repeat(); await stopPeer(); removeLogSink(sink); peer.close(); f.close(); }
});

test("mismatched paths, hardlink WAL names and non-FULL writers keep their original policy", async () => {
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
  } finally { await stop(); removeLogSink(sink); reader.close(); f.close(); }
});

test("structured checkpoint observations suppress duplicate heartbeats until the reporting bound", async () => {
  const f = fixture(), records: LogRecord[] = [], RealWorker = globalThis.Worker, realNow = Date.now;
  let worker: EventTarget, now = realNow();
  const sink = (record: LogRecord) => { if (record.path === f.path && record.operation === "sqlite_checkpoint.progress") records.push(record); };
  let stop: (() => void) | undefined;
  try {
    globalThis.Worker = class extends EventTarget {
      constructor() { super(); worker = this; }
      postMessage(data: any) { queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: { type: data.type === "close" ? "closed" : "ready" } }))); }
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
  } finally { await stop?.(); removeLogSink(sink); Date.now = realNow; globalThis.Worker = RealWorker; f.close(); }
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
    await stopLate?.(); late?.close(); await stopPeer(); await stop(); peer.close(); removeLogSink(sink); f.close();
  }
});

test("failed checkpoint construction restores built-in policy without an allocated SQLite worker", async () => {
  const f = fixture(), RealWorker = globalThis.Worker;
  try {
    f.db.exec("PRAGMA wal_autocheckpoint=43");
    globalThis.Worker = class { constructor() { throw Error("startup failure"); } } as any;
    const stop = registerSqliteCheckpoint(f.db, f.path, true)!;
    expect(f.db.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 43 });
    await stop(); await stop();
  } finally { globalThis.Worker = RealWorker; f.close(); }
});

test("failed checkpoint close delivery retains the uncertain worker and refuses a replacement", async () => {
  const f = fixture(), RealWorker = globalThis.Worker;
  let worker: EventTarget | undefined, failing = true, reused: Database | undefined, moved = false;
  const reusedPath = f.path + '.reused';
  try {
    globalThis.Worker = class extends EventTarget {
      constructor() { super(); worker = this; }
      postMessage(data: any) {
        if (failing) throw Error("post failure");
        if (data.type === "close") this.dispatchEvent(new MessageEvent("message", { data: { type: "closed" } }));
      }
      terminate() {}
    } as any;
    const stop = registerSqliteCheckpoint(f.db, f.path, true)!;
    await expect(Promise.resolve(stop())).rejects.toThrow("post failure");
    expect(() => registerSqliteCheckpoint(f.db, f.path, true)).toThrow("closing");
    // Deterministically exercise the hosted inode-reuse rejection: the same
    // identity at a new path cannot join an unresolved old checkpoint lifetime.
    const identity = statSync(f.path); f.db.close(); renameSync(f.path, reusedPath); moved = true;
    reused = new Database(reusedPath); expect(statSync(reusedPath).ino).toBe(identity.ino);
    expect(registerSqliteCheckpoint(reused, reusedPath, true)).toBeUndefined();
    // This fake owns no actual SQLite reader. Its positive late acknowledgement
    // must release the registry identity before another fixture reuses the inode.
    worker!.dispatchEvent(new MessageEvent("message", { data: { type: "closed" } }));
    await expect(Promise.resolve(stop())).rejects.toThrow("post failure");
    failing = false;
    const replacement = registerSqliteCheckpoint(reused, reusedPath, true)!;
    expect(replacement).toBeFunction(); await replacement();
  } finally {
    worker?.dispatchEvent(new MessageEvent("message", { data: { type: "closed" } }));
    reused?.close(); if (moved) renameSync(reusedPath, f.path);
    globalThis.Worker = RealWorker; f.close();
  }
});

test("a ready-time closed peer triggers sticky fallback and a late ready cannot disable writers", async () => {
  const f = fixture(), peer = new Database(f.path), RealWorker = globalThis.Worker;
  let worker: EventTarget;
  globalThis.Worker = class extends EventTarget {
    constructor() { super(); worker = this; }
    postMessage(data: any) { if (data.type === "close") this.dispatchEvent(new MessageEvent("message", { data: { type: "closed" } })); }
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
  } finally { await stopPeer(); await stop(); globalThis.Worker = RealWorker; peer.close(); f.close(); }
});


test("frame-counter resets do not fabricate stalls and unavailable counters are not zero pending work", async () => {
  const f=fixture(), RealWorker=globalThis.Worker, records:LogRecord[]=[];
  let worker:EventTarget;
  const sink=(record:LogRecord)=>{if(record.path===f.path&&record.operation==='sqlite_checkpoint.progress')records.push(record);};
  addLogSink(sink);
  globalThis.Worker=class extends EventTarget {constructor(){super();worker=this;}postMessage(data:any){if(data.type==='close')this.dispatchEvent(new MessageEvent('message',{data:{type:'closed'}}))}terminate(){}} as any;
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
  } finally {await stop();globalThis.Worker=RealWorker;removeLogSink(sink);f.close();}
});

test("a failed worker enables safe fallback for an originally disabled built-in checkpoint", async () => {
  const f=fixture(),RealWorker=globalThis.Worker;
  globalThis.Worker=class {constructor(){throw Error('fixture startup failure');}} as any;
  f.db.exec('PRAGMA wal_autocheckpoint=0');
  let stop:(()=>void)|undefined;
  try {
    stop=registerSqliteCheckpoint(f.db,f.path,true);
    expect(f.db.query('PRAGMA wal_autocheckpoint').get()).toEqual({wal_autocheckpoint:1000});
    await stop!();
    expect(f.db.query('PRAGMA wal_autocheckpoint').get()).toEqual({wal_autocheckpoint:0});
  } finally {await stop?.();globalThis.Worker=RealWorker;f.close();}
});


test("late zero-policy writers joining a failed group receive safe fallback without spawning another worker", async () => {
  const f=fixture(),late=new Database(f.path),RealWorker=globalThis.Worker;let attempts=0;
  globalThis.Worker=class {constructor(){attempts++;throw Error('fixture startup failure');}} as any;
  f.db.exec('PRAGMA wal_autocheckpoint=17');late.exec('PRAGMA wal_autocheckpoint=0');
  let stop:(()=>void)|undefined,stopLate:(()=>void)|undefined,repeat:(()=>void)|undefined;
  try {
    stop=registerSqliteCheckpoint(f.db,f.path,true);
    stopLate=registerSqliteCheckpoint(late,f.path,true);
    expect(late.query('PRAGMA wal_autocheckpoint').get()).toEqual({wal_autocheckpoint:1000});
    repeat=registerSqliteCheckpoint(late,f.path,true);
    expect(attempts).toBe(1);await stopLate!();
    expect(late.query('PRAGMA wal_autocheckpoint').get()).toEqual({wal_autocheckpoint:1000});
    await repeat!();
    expect(late.query('PRAGMA wal_autocheckpoint').get()).toEqual({wal_autocheckpoint:0});
    expect(f.db.query('PRAGMA wal_autocheckpoint').get()).toEqual({wal_autocheckpoint:17});
  } finally {await repeat?.();await stopLate?.();await stop?.();globalThis.Worker=RealWorker;late.close();f.close();}
});

test('last checkpoint release waits for confirmed SQLite closure and excludes a replacement worker', async () => {
  const f = fixture(), RealWorker = globalThis.Worker; let peer: Database | undefined, confirm!: () => void, created = 0;
  class ClosingWorker extends EventTarget {
    constructor(..._args: unknown[]) { super(); created++; }
    postMessage(data: any) {
      if (data.type === 'close') this.beginClose();
      else { peer = new Database(data.path); queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: { type: 'ready' } }))); }
    }
    beginClose() {
      peer!.exec('BEGIN IMMEDIATE');
      confirm = () => { peer!.exec('ROLLBACK'); peer!.close(); peer = undefined; this.dispatchEvent(new MessageEvent('message', { data: { type: 'closed' } })); this.dispatchEvent(new Event('close')); };
    }
    terminate() { expect(peer).toBeUndefined(); }
  }
  globalThis.Worker = ClosingWorker as any;
  const stop = registerSqliteCheckpoint(f.db, f.path, true)!;
  try {
    await waitFor(() => (f.db.query('PRAGMA wal_autocheckpoint').get() as any).wal_autocheckpoint === 0, 3000);
    let released = false; const closing = Promise.resolve(stop()).then(() => { released = true; });
    await Bun.sleep(15); expect(released).toBe(false);
    expect(() => registerSqliteCheckpoint(f.db, f.path, true)).toThrow('closing'); expect(created).toBe(1);
    confirm(); await closing; expect(released).toBe(true);
    f.db.exec('BEGIN IMMEDIATE; ROLLBACK'); expect(f.db.query('PRAGMA synchronous').get()).toEqual({ synchronous: 2 });
  } finally { if (peer) confirm(); globalThis.Worker = RealWorker; f.close(); }
});
