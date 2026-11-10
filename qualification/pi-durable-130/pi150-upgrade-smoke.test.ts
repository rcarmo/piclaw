import './src/test-guard.js';
import {expect,test} from 'bun:test';
import {join} from 'node:path';
import {nativeGoalFixture} from './src/native-goal-default-fixture.js';
import {context} from './src/fixture.js';
import {Harness,createRegistry,LiveDoc} from '../../runtime/durable-engine/qualification/durable.js';
import {createModels} from '../../runtime/durable-engine/qualification/ai.js';
import {SqliteStorage} from '../../runtime/durable-engine/qualification/sqlite.js';
import {BunSqliteDatabase} from '../../runtime/durable-engine/src/bun-sqlite.js';

test('Pi1.5 default factory dispatch and immutable history survive reopen',async()=>{
 const f=await nativeGoalFixture();try{
 const accepted=await f.send('Reply with the synthetic native result');await f.entered.promise;f.held.release();await f.until(()=>f.status(accepted.submission_id)==='done');expect(f.calls()).toBe(1);
 const entries=f.root.query('SELECT * FROM entries ORDER BY id').all(),submissions=f.root.query('SELECT * FROM submissions ORDER BY id').all();await f.reopen();
 expect(f.calls()).toBe(1);expect(f.root.query('SELECT * FROM entries ORDER BY id').all()).toEqual(entries);expect(f.root.query('SELECT * FROM submissions ORDER BY id').all()).toEqual(submissions);expect(f.root.query('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{f.held.release();await f.close();}
},15000);

test('Pi1.5 migrates an isolated Pi1.4 live document and preserves history; old reader rejects the new format',async()=>{
 // Read-only public exports of the retained 1.4 graph. All writes target this
 // test's disposable file, never that graph or the application store.
 const anchor='file:///workspace/piclaw-worktrees/epic1817-terminal/runtime/durable-engine/package.json';
 const oldSDK=await import(import.meta.resolve('@earendil-works/pi-durable',anchor)),oldAI=await import(import.meta.resolve('@earendil-works/pi-ai',anchor)),oldSQL=await import(import.meta.resolve('@earendil-works/pi-durable/storage/sqlite',anchor)),oldContext=await import(import.meta.resolve('@earendil-works/chord/context',anchor));
 const denied=async():Promise<never>=>{throw Error('Upgrade inspection must not request credentials');},path=join(process.env.PICLAW_WORKSPACE!,'pi14-to-pi15.sqlite');
 let old=await oldSDK.Harness.open(await oldSQL.SqliteStorage.open(new BunSqliteDatabase(path)),{models:oldAI.createModels({authContext:{env:denied,fileExists:denied}}),registry:oldSDK.createRegistry()},oldContext.BACKGROUND_CONTEXT);
 let newer:Harness|undefined;
 try{
 const conversation=await old.root(oldContext.BACKGROUND_CONTEXT);const id=conversation.id;
 await conversation.commit(async(tx:any)=>{await tx.appendEntry(id,{kind:'pi.user',model:[{role:'user',content:'Preserve the accepted pre-upgrade history',timestamp:1}]});const live=await tx.doc(oldSDK.LiveDoc,id);live.compactionFailure={taskId:999,reason:'manual',error:'Historical synthetic failure'};},oldContext.BACKGROUND_CONTEXT);
 const before=(await conversation.context(oldContext.BACKGROUND_CONTEXT)).messages;await old.close(oldContext.BACKGROUND_CONTEXT);
 newer=await Harness.open(await SqliteStorage.open(new BunSqliteDatabase(path)),{models:createModels({authContext:{env:denied,fileExists:denied}}),registry:createRegistry()},context);
 expect((await newer.inspect(context)).scheduling).toBe('paused');const current=(await newer.conversation(id,context))!;
 const live=await newer.snapshot(LiveDoc,id,context);expect(live?.compactionFailure).toMatchObject({taskId:999,trigger:'manual',error:'Historical synthetic failure'});expect(live?.compactionFailure).not.toHaveProperty('reason');
 expect((await current.context(context)).messages).toEqual(before);
 await current.commit(async tx=>{const doc=await tx.doc(LiveDoc,id);doc.compactionFailure!.error='Read and written using the Pi1.5 schema';},context);
 await newer.close(context);newer=undefined;
 old=await oldSDK.Harness.open(await oldSQL.SqliteStorage.open(new BunSqliteDatabase(path)),{models:oldAI.createModels({authContext:{env:denied,fileExists:denied}}),registry:oldSDK.createRegistry()},oldContext.BACKGROUND_CONTEXT);
 await expect(old.snapshot(oldSDK.LiveDoc,id,oldContext.BACKGROUND_CONTEXT)).rejects.toThrow();
 }finally{await newer?.close(context);await old.close(oldContext.BACKGROUND_CONTEXT);}
},15000);

test('Pi1.5.0 SQLite history and live documents survive1.5.1 writes without replay',async()=>{
 const anchor='file:///workspace/piclaw-worktrees/local-pi-150-upgrade/runtime/durable-engine/package.json';
 const priorSDK=await import(import.meta.resolve('@earendil-works/pi-durable',anchor)),priorAI=await import(import.meta.resolve('@earendil-works/pi-ai',anchor)),priorSQL=await import(import.meta.resolve('@earendil-works/pi-durable/storage/sqlite',anchor)),priorContext=await import(import.meta.resolve('@earendil-works/chord/context',anchor));
 let credentialReads=0;const denied=async():Promise<never>=>{credentialReads++;throw Error('Patch compatibility must not access credentials');},path=join(process.env.PICLAW_WORKSPACE!,'pi150-to-pi151.sqlite');
 const options={models:priorAI.createModels({authContext:{env:denied,fileExists:denied}}),registry:priorSDK.createRegistry()};
 let previous=await priorSDK.Harness.open(await priorSQL.SqliteStorage.open(new BunSqliteDatabase(path)),options,priorContext.BACKGROUND_CONTEXT),current:Harness|undefined;
 try{
 const root=await previous.root(priorContext.BACKGROUND_CONTEXT),id=root.id;
 await root.commit(async(tx:any)=>{await tx.appendEntry(id,{kind:'pi.user',model:[{role:'user',content:'Preserve1.5.0 state through patch upgrade',timestamp:1}]});const live=await tx.doc(priorSDK.LiveDoc,id);live.compactionFailure={taskId:999,trigger:'manual',error:'Existing1.5.0 receipt'};},priorContext.BACKGROUND_CONTEXT);
 const before=(await root.context(priorContext.BACKGROUND_CONTEXT)).messages;await previous.close(priorContext.BACKGROUND_CONTEXT);
 current=await Harness.open(await SqliteStorage.open(new BunSqliteDatabase(path)),{models:createModels({authContext:{env:denied,fileExists:denied}}),registry:createRegistry()},context);
 expect((await current.inspect(context)).scheduling).toBe('paused');const loaded=(await current.conversation(id,context))!;expect((await loaded.context(context)).messages).toEqual(before);
 await loaded.commit(async tx=>{const live=await tx.doc(LiveDoc,id);live.compactionFailure!.error='Written under1.5.1';},context);await current.close(context);current=undefined;
 previous=await priorSDK.Harness.open(await priorSQL.SqliteStorage.open(new BunSqliteDatabase(path)),options,priorContext.BACKGROUND_CONTEXT);
 expect((await (await previous.conversation(id,priorContext.BACKGROUND_CONTEXT))!.context(priorContext.BACKGROUND_CONTEXT)).messages).toEqual(before);
 expect((await previous.snapshot(priorSDK.LiveDoc,id,priorContext.BACKGROUND_CONTEXT)).compactionFailure.error).toBe('Written under1.5.1');expect(credentialReads).toBe(0);
 }finally{await current?.close(context);await previous.close(priorContext.BACKGROUND_CONTEXT);}
},15000);

test('Pi1.5.1 SQLite history and live documents survive1.5.2 writes without replay',async()=>{
 const anchor='file:///workspace/piclaw-worktrees/local-pi-151-upgrade/runtime/durable-engine/package.json';
 const priorSDK=await import(import.meta.resolve('@earendil-works/pi-durable',anchor)),priorAI=await import(import.meta.resolve('@earendil-works/pi-ai',anchor)),priorSQL=await import(import.meta.resolve('@earendil-works/pi-durable/storage/sqlite',anchor)),priorContext=await import(import.meta.resolve('@earendil-works/chord/context',anchor));
 let credentialReads=0;const denied=async():Promise<never>=>{credentialReads++;throw Error('Patch compatibility must not access credentials');},path=join(process.env.PICLAW_WORKSPACE!,'pi150-to-pi151.sqlite');
 const options={models:priorAI.createModels({authContext:{env:denied,fileExists:denied}}),registry:priorSDK.createRegistry()};
 let previous=await priorSDK.Harness.open(await priorSQL.SqliteStorage.open(new BunSqliteDatabase(path)),options,priorContext.BACKGROUND_CONTEXT),current:Harness|undefined;
 try{
 const root=await previous.root(priorContext.BACKGROUND_CONTEXT),id=root.id;
 await root.commit(async(tx:any)=>{await tx.appendEntry(id,{kind:'pi.user',model:[{role:'user',content:'Preserve1.5.1 state through patch upgrade',timestamp:1}]});const live=await tx.doc(priorSDK.LiveDoc,id);live.compactionFailure={taskId:999,trigger:'manual',error:'Existing1.5.1 receipt'};},priorContext.BACKGROUND_CONTEXT);
 const before=(await root.context(priorContext.BACKGROUND_CONTEXT)).messages;await previous.close(priorContext.BACKGROUND_CONTEXT);
 current=await Harness.open(await SqliteStorage.open(new BunSqliteDatabase(path)),{models:createModels({authContext:{env:denied,fileExists:denied}}),registry:createRegistry()},context);
 expect((await current.inspect(context)).scheduling).toBe('paused');const loaded=(await current.conversation(id,context))!;expect((await loaded.context(context)).messages).toEqual(before);
 await loaded.commit(async tx=>{const live=await tx.doc(LiveDoc,id);live.compactionFailure!.error='Written under1.5.2';},context);await current.close(context);current=undefined;
 previous=await priorSDK.Harness.open(await priorSQL.SqliteStorage.open(new BunSqliteDatabase(path)),options,priorContext.BACKGROUND_CONTEXT);
 expect((await (await previous.conversation(id,priorContext.BACKGROUND_CONTEXT))!.context(priorContext.BACKGROUND_CONTEXT)).messages).toEqual(before);
 expect((await previous.snapshot(priorSDK.LiveDoc,id,priorContext.BACKGROUND_CONTEXT)).compactionFailure.error).toBe('Written under1.5.2');expect(credentialReads).toBe(0);
 }finally{await current?.close(context);await previous.close(priorContext.BACKGROUND_CONTEXT);}
},15000);
