import './src/test-guard.js';
import {expect,test} from 'bun:test';
import {join} from 'node:path';
import {nativeGoalFixture} from './src/native-goal-default-fixture.js';
import {context} from './src/fixture.js';
import {Harness,createRegistry,LiveDoc,type ConversationId,type DocumentId,type TaskId,type CompactionResult} from '../../runtime/durable-engine/qualification/durable.js';
import {createModels} from '../../runtime/durable-engine/qualification/ai.js';
import {SqliteStorage} from '../../runtime/durable-engine/qualification/sqlite.js';
import {commitWrites} from '../../runtime/durable-engine/qualification/testing.js';
import {BunSqliteDatabase} from '../../runtime/durable-engine/src/bun-sqlite.js';

test('Pi1.5 default factory dispatch and immutable history survive reopen',async()=>{
 const f=await nativeGoalFixture();try{
 const accepted=await f.send('Reply with the synthetic native result');await f.entered.promise;f.held.release();await f.until(()=>f.status(accepted.submission_id)==='done');expect(f.calls()).toBe(1);
 const entries=f.root.query('SELECT * FROM entries ORDER BY id').all(),submissions=f.root.query('SELECT * FROM submissions ORDER BY id').all();await f.reopen();
 expect(f.calls()).toBe(1);expect(f.root.query('SELECT * FROM entries ORDER BY id').all()).toEqual(entries);expect(f.root.query('SELECT * FROM submissions ORDER BY id').all()).toEqual(submissions);expect(f.root.query('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{f.held.release();await f.close();}
},15000);


// Fixed public document formats: Pi 1.4 stored version 1 (reason), Pi 1.5.0
// stored version 2 (trigger). Seed through Storage, without a second installed
// SDK graph or machine-local package anchors. Cross-binary upgrade/downgrade
// receipts remain with the separately qualified local Pi upgrade.
for(const version of [1,2,99]) test(`SDK historical live-document version ${version}: history and forward-version refusal`,async()=>{
 const denied=async():Promise<never>=>{throw Error('Upgrade inspection must not request credentials');};
 const path=join(process.env.PICLAW_WORKSPACE!,`live-document-${version}.sqlite`);
 const storage=await SqliteStorage.open(new BunSqliteDatabase(path));
 const id=await storage.mintId<ConversationId>(),document=await storage.mintId<DocumentId>();
 const taskId=999 as TaskId<CompactionResult>;
 const failure={taskId,[version===1?'reason':'trigger']:'manual',error:'Historical synthetic failure'};
 await commitWrites(storage,[{type:'conversation',value:{id}},{type:'document.create',record:{id:document,kind:LiveDoc.definition.kind,scope:{kind:'conversation',conversationId:id},history:'latest',fork:'initial'},content:{kind:'base',version,value:{compactionFailure:failure}}}],context);
 const options={models:createModels({authContext:{env:denied,fileExists:denied}}),registry:createRegistry()};
 let harness=await Harness.open(storage,options,context);
 try{
  expect((await harness.inspect(context)).scheduling).toBe('paused');
  if(version===99){await expect(harness.snapshot(LiveDoc,id,context)).rejects.toThrow('has newer version 99');return;}
  const conversation=(await harness.conversation(id,context))!;
  await conversation.commit(async tx=>{await tx.appendEntry(id,{kind:'pi.user',model:[{role:'user',content:'Preserve accepted pre-upgrade history',timestamp:1}]});},context);
  const before=(await conversation.context(context)).messages;
  const live=await harness.snapshot(LiveDoc,id,context);
  expect(live?.compactionFailure).toEqual({taskId,trigger:'manual',error:'Historical synthetic failure'});
  expect(live?.compactionFailure).not.toHaveProperty('reason');
  await conversation.commit(async tx=>{const current=await tx.doc(LiveDoc,id);current.compactionFailure!.error='Written using current SDK schema';},context);
  await harness.close(context);
  harness=await Harness.open(await SqliteStorage.open(new BunSqliteDatabase(path)),options,context);
  expect((await (await harness.conversation(id,context))!.context(context)).messages).toEqual(before);
  expect((await harness.snapshot(LiveDoc,id,context))?.compactionFailure?.error).toBe('Written using current SDK schema');
 }finally{await harness.close(context);}
},15000);
