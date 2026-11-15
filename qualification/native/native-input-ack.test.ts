import './src/test-guard.js';
import {expect,test,spyOn} from 'bun:test';
import {InboxDoc,type Harness} from '../../runtime/durable-engine/qualification/durable.js';
import {nativeMessageFixture} from './src/native-message-fixture.js';
import {TestOwner} from './src/ownership.js';
import {barrier,context} from './src/fixture.js';

for(const fault of ['source','owner','binding'] as const)test(`SDK acceptance cannot mask ${fault} revocation/conflict at a secondary ACK failure`,async()=>{
  const f=await nativeMessageFixture();f.base.host.modelHold=barrier();
  let revoked=false;
  const assert=TestOwner.prototype.assert;
  const ownerSpy=spyOn(TestOwner.prototype,'assert').mockImplementation(function(this:TestOwner){if(revoked)throw Error('fixture owner revoked');return assert.call(this);});
  const ackSpy=spyOn(f.bindings,'recordSubmission').mockImplementation(async(input,id)=>{
    if(fault==='source')f.root.query("UPDATE service_effect_s01_sources SET state='disposed' WHERE source_id=?").run(input.sourceId);
    if(fault==='binding')f.root.query('UPDATE piclaw_durable_bindings_v1 SET submission_id=? WHERE source_id=?').run(id+1000,input.sourceId);
    if(fault==='owner')revoked=true;
    throw Error('secondary ACK unavailable');
  });
  try{
    await f.open();const input=f.accept('accepted once; do not hide changed authority');
    await expect(f.runtime.submitMessage(input)).rejects.toThrow(fault==='owner'?'owner revoked':fault==='source'?'Native accepted message changed':'Submission binding conflict');
    expect(f.root.query('SELECT count(*) n FROM submissions').get()).toEqual({n:1});
    expect(f.root.query('SELECT count(*) n FROM messages WHERE is_bot_message=0').get()).toEqual({n:1});
    expect(f.root.query('SELECT * FROM service_effect_s01_operations').all()).toEqual([]);
    expect(f.root.query('SELECT * FROM service_effect_s02_commits').all()).toEqual([]);
  }finally{revoked=false;ownerSpy.mockRestore();ackSpy.mockRestore();await f.close();}
},12000);

for(const field of ['chatJid','branchId','conversationId','incarnation','sourceId','payloadRef','requestId','requestHash'] as const)test(`native queue rejects a foreign ${field} envelope without removing or adopting the SDK input`,async()=>{
  const f=await nativeMessageFixture(),entered=barrier();f.base.host.modelHold=barrier();f.base.host.onModelEnter=()=>entered.release();
  try{
    await f.open();const primary=f.accept('hold the actual run');await f.runtime.submitMessage(primary);await entered.promise;
    const queued=f.accept('same immutable queued input'),id=await f.runtime.submitMessage(queued,'followUp');
    const accepted=f.root.query('SELECT record FROM submissions WHERE id=?').get(id);
    const harness=Reflect.get(f.runtime,'harness') as Harness,conversation=(await harness.conversation(f.base.root.id,context))!;
    const change=async(value:string|number)=>conversation.commit(async tx=>{
      const inbox=await tx.doc(InboxDoc,f.base.root.id),item=inbox.items.find(item=>item.id===id)!;
      item.entry={kind:'host.accepted',data:{...queued,role:'primary',[field]:value}};
    },context);
    await change(field==='conversationId'?Number(f.base.root.id)+1000:'foreign');
    await expect(f.runtime.readMessageInbox(f.binding)).rejects.toThrow();
    await expect(f.runtime.removeQueuedMessage(f.binding,id)).rejects.toThrow();
    expect(f.root.query('SELECT record FROM submissions WHERE id=?').get(id)).toEqual(accepted);
    expect((await harness.submission(id,context))?.id).toBe(id);
    await change(queued[field]);
    expect((await f.runtime.readMessageInbox(f.binding)).map(item=>item.submissionId)).toEqual([id]);
    expect(await f.runtime.removeQueuedMessage(f.binding,id)).toBe(true);
    await f.runtime.abortMessages(f.binding);
  }finally{await f.close();}
},12000);
