import './src/test-guard.js';
import {expect,spyOn} from 'bun:test';
import {isolatedApplicationTest} from './src/isolated-application-test.js';
import {nativeGoalFixture} from './src/native-goal-default-fixture.js';
import {Harness,InboxDoc,type ConversationId} from '../../runtime/durable-engine/qualification/durable.js';
import {context} from './src/fixture.js';
const applicationTest=isolatedApplicationTest(import.meta.url);

for(const variant of ['plain','thread','screen','both','tampered'] as const)applicationTest(`SDK queued steering preserves immutable ${variant} metadata`,async()=>{
  const open=Harness.open,opened:Awaited<ReturnType<typeof Harness.open>>[]=[];
  const capture=spyOn(Harness,'open').mockImplementation(async(...args)=>{const h=await open.apply(Harness,args);opened.push(h);return h;});
  const f=await nativeGoalFixture();
  try{
    const first=await f.send('Primary input');await f.entered.promise;
    const threadId=['thread','both','tampered'].includes(variant)?first.row_id:null;
    const screenHint=['screen','both','tampered'].includes(variant)?'desktop':undefined;
    const response=await f.channel.handleAgentMessage(new Request('https://fixture/agent/default/message',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({content:'STEERING_METADATA_OK',mode:'queue',thread_id:threadId,screen_hint:screenHint})}),'/agent/default/message');
    expect(response.status).toBe(201);const queued=await response.json() as any;
    const stored=f.root.query('SELECT rowid,id,thread_id,screen_hint FROM messages WHERE rowid=?').get(queued.row_id) as {rowid:number;id:string;thread_id:number|null;screen_hint:string|null};
    expect(stored.thread_id).toBe(threadId??queued.row_id);expect(stored.screen_hint).toBe(screenHint??null);
    const source=f.root.query('SELECT source_id,source_hash,state FROM service_effect_s01_sources WHERE source_id=?').get(stored.id);
    const submission=f.root.query('SELECT * FROM submissions WHERE id=?').get(queued.submission_id);
    const request=()=>new Request('https://fixture/agent/queue-steer',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_jid:'web:default',row_id:queued.submission_id})});
    if(variant==='tampered'){
      const binding=f.root.query('SELECT conversation_id FROM piclaw_durable_bindings_v1 WHERE submission_id=?').get(queued.submission_id) as {conversation_id:number};
      const h=opened.at(-1)!,conversation=(await h.conversation(binding.conversation_id as ConversationId,context))!;
      const original=structuredClone(await h.snapshot(InboxDoc,conversation.id,context));
      await conversation.commit(async tx=>{f.owner.assertCurrentOwner();const inbox=await tx.doc(InboxDoc,conversation.id);const item=inbox.items.find(item=>item.id===queued.submission_id)!;(item.entry!.data as any).sourceId='forged-source';},context);
      const tampered=await h.snapshot(InboxDoc,conversation.id,context);
      const denied=await f.channel.handleAgentQueueSteer(request());expect(denied.status).toBeGreaterThanOrEqual(400);
      expect(await h.snapshot(InboxDoc,conversation.id,context)).toEqual(tampered);
      expect(f.root.query('SELECT * FROM submissions WHERE id=?').get(queued.submission_id)).toEqual(submission);
      await conversation.commit(async tx=>{f.owner.assertCurrentOwner();const inbox=await tx.doc(InboxDoc,conversation.id);inbox.items=structuredClone(original.items);},context);
    }else{
      expect((await f.channel.handleAgentQueueSteer(request())).status).toBe(201);
      expect(f.root.query('SELECT * FROM submissions WHERE id=?').get(queued.submission_id)).toEqual(submission);
    }
    expect(f.root.query('SELECT rowid,id,thread_id,screen_hint FROM messages WHERE rowid=?').get(queued.row_id)).toEqual(stored);
    expect(f.root.query('SELECT source_id,source_hash,state FROM service_effect_s01_sources WHERE source_id=?').get(stored.id)).toEqual(source);
    expect(f.calls()).toBe(1);f.held.release();await f.until(()=>f.status(queued.submission_id)==='done');expect(f.calls()).toBe(2);
    expect(f.root.query('SELECT * FROM service_effect_s01_operations').all()).toEqual([]);
    expect(f.root.query('SELECT * FROM service_effect_s02_commits').all()).toEqual([]);
    const sdk=f.root.query('SELECT * FROM submissions ORDER BY id').all();await f.reopen();expect(f.calls()).toBe(2);expect(f.root.query('SELECT * FROM submissions ORDER BY id').all()).toEqual(sdk);
  }finally{await f.close();capture.mockRestore();}
},20000);
