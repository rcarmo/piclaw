import './src/test-guard.js';
import {expect,spyOn} from 'bun:test';
import {nativeMessageFixture} from './src/native-message-fixture.js';
import {barrier,context,openFixture} from './src/fixture.js';
import type {Harness,ConversationView,EntryRecord} from '../../runtime/durable-engine/qualification/durable.js';
import {SqliteStorage} from '../../runtime/durable-engine/qualification/sqlite.js';
import {BunSqliteDatabase} from '../../runtime/durable-engine/src/bun-sqlite.js';
import {Watch,NativeWatch,type WatchCall,type WatchHandle} from '@earendil-works/chord/watch';
import {applyImmutable,type Op} from '@earendil-works/chord/delta';
import {mkdtemp,rm} from 'node:fs/promises';
import {Database} from 'bun:sqlite';
import {join} from 'node:path';
import {nativeGoalFixture} from './src/native-goal-default-fixture.js';
import {isolatedApplicationTest} from './src/isolated-application-test.js';
import {addLogSink,removeLogSink,type LogRecord} from '../../runtime/src/utils/logger.js';
const applicationTest=isolatedApplicationTest(import.meta.url);

applicationTest('actual native factory joins initial/reopened view handshakes before closing SDK and preserves accepted history',async()=>{
  const f=await nativeGoalFixture();let closed=false;
  const failures:LogRecord[]=[];
  const sink=(record:LogRecord)=>{if(record.module==='native.turn-view'&&(record.operation==='native.input_delivery_pending'||record.message==='Conversation watch failed'))failures.push(record);};
  try{
    const accepted=await f.send('One independently accepted native input');await f.entered.promise;f.held.release();
    await f.until(()=>f.root.query('SELECT 1 FROM messages WHERE is_bot_message=1').get()!==null);
    expect(f.status(accepted.submission_id)).toBe('done');expect(f.calls()).toBe(1);
    const history=()=>['entries','submissions','messages','service_effect_s01_sources'].map(table=>f.root.query(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const original=history();addLogSink(sink);
    await f.reopen();await f.close();closed=true;
    const database=new Database(join(process.env.PICLAW_STORE!,'messages.db'),{readonly:true,strict:true});
    try{expect(['entries','submissions','messages','service_effect_s01_sources'].map(table=>database.query(`SELECT * FROM ${table} ORDER BY rowid`).all())).toEqual(original);}finally{database.close();}
    expect(f.calls()).toBe(1);expect(failures).toEqual([]);
  }finally{if(!closed)await f.close();removeLogSink(sink);}
},30000);

applicationTest('native view setup racing close stops its allocated SDK watch before rejecting without publishing',async()=>{
  const f=await nativeMessageFixture(),entered=barrier(),held=barrier();let stopped=0,published=0;
  await f.open();const harness=Reflect.get(f.runtime,'harness') as Harness,conversation=harness.conversation.bind(harness);
  const intercept=spyOn(harness,'conversation').mockImplementation(async(id,context)=>{
    const handle=await conversation(id,context);return handle&&new Proxy(handle,{get(target,key){
      if(key==='watch')return async(context:any)=>{const watch=await target.watch(context);entered.release();await held.promise;return new Proxy(watch,{get(target,key){if(key==='stop')return async()=>{stopped++;await target.stop();};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});};
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});
  });
  try{
    const watching=f.runtime.watchSession(f.binding,()=>{published++;});void watching.catch(()=>{});await entered.promise;
    const closing=f.controller.close();held.release();await expect(watching).rejects.toThrow('Runtime closed');await closing;expect(stopped).toBe(1);expect(published).toBe(0);
  }finally{held.release();intercept.mockRestore();await f.close();}
},30000);

// Kernel observation on actual disposable SQLite. This does not submit input,
// enable scheduling or qualify arbitrary external effects/owner takeover.
for (const pending of [3, 125]) applicationTest(`public SQLite conversation watch folds ${pending} commits behind one slow listener`, async () => {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, 'watch-fold-'));
  const f = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new BunSqliteDatabase(join(dir, 'watch.sqlite'))));
  const held = barrier(), finished = barrier();
  let watch: WatchHandle<ConversationView> | undefined, listenerEntered = false;
  try {
    const conversation = await f.harness.createConversation({ ownership: { kind: 'ownerless' } }, context);
    const first = Promise.withResolvers<WatchCall<ConversationView>>(), next = Promise.withResolvers<WatchCall<ConversationView>>();
    const original: EntryRecord[] = await conversation.commit(async tx => {
      const entries: EntryRecord[] = [];
      for (let i = 0; i < 60; i++) entries.push(await tx.appendEntry(conversation.id, { kind: 'app.watch-fixture', data: i }));
      return entries;
    }, context);
    watch = await conversation.watch(context); const acquired = watch.value;
    let calls = 0, active = 0, peak = 0, returned = false, inline = false;
    watch.start(async call => {
      const ordinal = ++calls; active++; peak = Math.max(peak, active); inline ||= !returned;
      try {
        if (ordinal === 1) { listenerEntered = true; first.resolve(call); await held.promise; }
        else next.resolve(call);
      } finally { active--; if (ordinal === 1) finished.release(); }
    });
    returned = true;
    expect(calls).toBe(0); // Acquisition is watch.value, not an invented initial callback.
    expect(acquired.entries.map(entry => entry.id)).toEqual(original.slice(-50).map(entry => entry.id));
    const trigger = await conversation.commit(tx => tx.appendEntry(conversation.id, { kind: 'app.watch-fixture', data: 60 }), context);
    const before = await first.promise;
    if (before.kind !== 'value') throw before.error;
    expect(inline).toBe(false); expect(before.value.entries.map(entry => entry.id)).toEqual([...original.slice(-50), trigger].map(entry => entry.id));
    let expected = [...before.value.entries]; const all = [...original, trigger];
    for (let i = 0; i < pending; i++) {
      const entry = await conversation.commit(tx => tx.appendEntry(conversation.id, { kind: 'app.watch-fixture', data: 61 + i }), context);
      all.push(entry); expected.push(entry);
      if (expected.length > 100) expected = expected.slice(-50);
    }
    expect(calls).toBe(1); expect(peak).toBe(1); expect(watch.value).toEqual(before.value);
    held.release(); const folded = await next.promise;
    if (folded.kind !== 'value') throw folded.error;
    expect(calls).toBe(2); expect(peak).toBe(1);
    expect(folded.value.entries.map(entry => entry.id)).toEqual(expected.map(entry => entry.id));
    expect(folded.value.before).toBe(all[all.length - expected.length - 1]!.id);
    expect(applyImmutable(before.value, folded.ops)).toEqual(folded.value);
    // Negative oracle: ignoring this delta leaves a demonstrably stale view.
    expect(applyImmutable(before.value, [])).not.toEqual(folded.value);
    expect(acquired.entries).toHaveLength(50); expect(before.value.entries).toHaveLength(51); // Delivered snapshots stay immutable.
    expect((await conversation.entries({ order: 'ascending' }, 250, undefined, context)).items.map(entry => entry.id)).toEqual(all.map(entry => entry.id));
    expect(await f.harness.inspect(context)).toEqual({ scheduling: 'paused', tasks: [], submissions: [] });
    expect([f.host.modelCalls, f.host.effects, f.host.credentialLookups]).toEqual([0, 0, 0]); expect(f.reports).toEqual([]);
  } finally { held.release(); await watch?.stop(); if (listenerEntered) await finished.promise; await f.close(); await rm(dir, { recursive: true, force: true }); }
});

applicationTest('public SQLite watch uses 50/100 window bounds and late attachment folds pre-start commits', async () => {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, 'watch-window-'));
  const f = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new BunSqliteDatabase(join(dir, 'watch.sqlite'))));
  let watch: WatchHandle<ConversationView> | undefined, late: typeof watch;
  try {
    const conversation = await f.harness.createConversation({ ownership: { kind: 'ownerless' } }, context);
    const entries: EntryRecord[] = [];
    const append = (count: number) => conversation.commit(async tx => {
      for (let i = 0; i < count; i++) entries.push(await tx.appendEntry(conversation.id, { kind: 'app.watch-fixture', data: entries.length }));
    }, context);
    await append(120); watch = await conversation.watch(context);
    const phases = [Promise.withResolvers<WatchCall<ConversationView>>(), Promise.withResolvers<WatchCall<ConversationView>>()];
    const frames: ConversationView[] = [watch.value]; let updates = 0;
    watch.start(async call => { phases[updates++]!.resolve(call); });
    expect(frames).toHaveLength(1);
    expect(frames[0]!.entries.map(entry => entry.id)).toEqual(entries.slice(-50).map(entry => entry.id));
    expect(frames[0]!.before).toBe(entries[69]!.id);
    await append(50); const grown = await phases[0]!.promise; if (grown.kind !== 'value') throw grown.error; frames.push(grown.value);
    expect(frames[1]!.entries.map(entry => entry.id)).toEqual(entries.slice(-100).map(entry => entry.id));
    await append(1); const trimmed = await phases[1]!.promise; if (trimmed.kind !== 'value') throw trimmed.error; frames.push(trimmed.value);
    // Exceeding max drops in one splice to min, not a sliding last-100 window.
    expect(frames[2]!.entries.map(entry => entry.id)).toEqual(entries.slice(-50).map(entry => entry.id));
    expect(frames[2]!.entries).not.toHaveLength(100);
    await watch.stop();
    late = await conversation.watch(context);
    const acquired = late.value; expect(acquired.entries).toHaveLength(50);
    await append(2); expect(late.value).toEqual(acquired);
    const first = Promise.withResolvers<WatchCall<ConversationView>>();
    late.start(async call => { first.resolve(call); });
    const delivered = await first.promise; if (delivered.kind !== 'value') throw delivered.error;
    expect(delivered.value.entries.map(entry => entry.id)).toEqual(entries.slice(-52).map(entry => entry.id));
    expect(applyImmutable(acquired, delivered.ops)).toEqual(delivered.value);
    expect(delivered.value.entries.at(-1)!.id).toBe(entries.at(-1)!.id);
    expect(acquired.entries).toHaveLength(50);
    expect([f.host.modelCalls, f.host.effects, f.host.credentialLookups]).toEqual([0, 0, 0]);
    expect(await f.harness.inspect(context)).toEqual({ scheduling: 'paused', tasks: [], submissions: [] }); expect(f.reports).toEqual([]);
  } finally { await late?.stop(); await watch?.stop(); await f.close(); await rm(dir, { recursive: true, force: true }); }
});

applicationTest('stopping a SQLite watch drops queued callbacks without claiming to join the entered listener', async () => {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, 'watch-stop-'));
  const f = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new BunSqliteDatabase(join(dir, 'watch.sqlite'))));
  const entered = barrier(), held = barrier(), finished = barrier();
  let watch: WatchHandle<ConversationView> | undefined, listenerEntered = false;
  try {
    const conversation = await f.harness.createConversation({ ownership: { kind: 'ownerless' } }, context);
    watch = await conversation.watch(context); let calls = 0, completed = false;
    watch.start(async call => {
      listenerEntered = true; calls++; entered.release();
      try { if (call.kind !== 'value') throw call.error; await held.promise; completed = true; }
      finally { finished.release(); }
    });
    expect(watch.value.entries).toEqual([]); expect(calls).toBe(0);
    await conversation.commit(tx => tx.appendEntry(conversation.id, { kind: 'app.watch-fixture', data: 'entered' }), context);
    await entered.promise;
    await conversation.commit(tx => tx.appendEntry(conversation.id, { kind: 'app.watch-fixture', data: 'queued' }), context);
    expect(await watch.stop()).toEqual({ kind: 'stopped' }); expect(await watch.closed).toEqual({ kind: 'stopped' });
    expect(await watch.stop()).toEqual({ kind: 'stopped' }); expect(completed).toBe(false);
    await conversation.commit(tx => tx.appendEntry(conversation.id, { kind: 'app.watch-fixture', data: 'after-stop' }), context);
    held.release(); await finished.promise;
    expect(calls).toBe(1); expect(completed).toBe(true);
    expect((await conversation.entries({}, 10, undefined, context)).items).toHaveLength(3);
    expect(await f.harness.inspect(context)).toEqual({ scheduling: 'paused', tasks: [], submissions: [] });
    expect([f.host.modelCalls, f.host.effects, f.host.credentialLookups]).toEqual([0, 0, 0]); expect(f.reports).toEqual([]);
  } finally { held.release(); await watch?.stop(); if (listenerEntered) await finished.promise; await f.close(); await rm(dir, { recursive: true, force: true }); }
});

// Public Chord primitives are separate from Conversation's entry-window bound.
// This qualifies their real queue behaviour, not a fabricated SDK observer.
for (const operations of [3, 9999, 10000]) applicationTest(`public JSON watch folds ${operations} ops plus a tail at the 10000-op bound`, async () => {
  const errors: unknown[] = []; let detached = 0, calls = 0;
  const watch = new Watch<Record<string, number>>({}, () => { detached++; }, error => { errors.push(error); });
  const first = Promise.withResolvers<WatchCall<Record<string, number>>>(), next = Promise.withResolvers<WatchCall<Record<string, number>>>();
  const held = barrier(), finished = barrier();
  watch.advance({ kind: 'value', value: {}, ops: [['r', {}]], retired: false }, context);
  watch.start(async call => { calls++; if (calls === 1) { first.resolve(call); await held.promise; finished.release(); } else next.resolve(call); });
  try {
    const before = await first.promise; if (before.kind !== 'value') throw before.error;
    const bulk = Object.fromEntries(Array.from({ length: operations }, (_, i) => ['k' + i, i]));
    const ops = Object.entries(bulk).map(([key, value]): Op => ['s', [key], value]);
    const latest = { ...bulk, tail: operations };
    watch.advance({ kind: 'value', value: bulk, ops, retired: false }, context);
    watch.advance({ kind: 'value', value: latest, ops: [['s', ['tail'], operations]], retired: false }, context);
    expect(calls).toBe(1); held.release();
    const folded = await next.promise; if (folded.kind !== 'value') throw folded.error;
    expect(folded.value).toEqual(latest); expect(applyImmutable(before.value, folded.ops)).toEqual(latest);
    expect(applyImmutable(before.value, [])).not.toEqual(latest);
    if (operations === 10000) expect(folded.ops).toEqual([['r', latest]]);
    else { expect(folded.ops).toHaveLength(operations + 1); expect(folded.ops[0]![0]).not.toBe('r'); }
    expect(calls).toBe(2); expect(before.value).toEqual({}); expect(errors).toEqual([]);
  } finally { held.release(); await watch.stop(); await finished.promise; }
  expect(detached).toBe(1);
});

for (const pending of [3, 100, 101]) applicationTest(`public NativeWatch delivers ${pending} pending values at its separate 100-value bound`, async () => {
  const errors: unknown[] = [], values: number[] = []; let calls = 0, detached = 0;
  const watch = new NativeWatch(0, () => { detached++; }, error => { errors.push(error); });
  const first = barrier(), held = barrier(), finished = barrier(), latest = Promise.withResolvers<number>();
  watch.advance(0, context);
  watch.start(async call => {
    if (call.kind !== 'value') throw call.error;
    calls++; values.push(call.value);
    if (calls === 1) { first.release(); await held.promise; finished.release(); }
    else if (call.value === pending) latest.resolve(call.value);
  });
  try {
    await first.promise;
    for (let i = 1; i <= pending; i++) watch.advance(i, context);
    expect(calls).toBe(1); expect(watch.value).toBe(0); held.release();
    expect(await latest.promise).toBe(pending);
    const expected = pending <= 100 ? [0, ...Array.from({ length: pending }, (_, i) => i + 1)] : [0, pending];
    expect(values).toEqual(expected); expect(calls).toBe(expected.length); expect(watch.value).toBe(pending);
    expect(await watch.stop()).toEqual({ kind: 'stopped' }); watch.advance(pending + 1, context);
    expect(await watch.closed).toEqual({ kind: 'stopped' }); expect(calls).toBe(expected.length); expect(errors).toEqual([]);
  } finally { held.release(); await watch.stop(); await finished.promise; }
  expect(detached).toBe(1);
});
