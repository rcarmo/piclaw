import './src/test-guard.js';
import {expect,spyOn} from 'bun:test';
import {HostConversationRuntime} from '../../runtime/durable-engine/src/host-runtime.js';
import {isolatedApplicationTest} from './src/isolated-application-test.js';
import {nativeGoalFixture as fixture} from './src/native-goal-default-fixture.js';
const applicationTest=isolatedApplicationTest(import.meta.url);

for(const transition of ['stop','pause','replace','clear'] as const)applicationTest(`native SDK Goal queue: ${transition} revokes an accepted continuation without retiring its history or replaying unrelated work`,async()=>{
  const f=await fixture(transition==='replace');
  try{
    const primary=await f.send('Unrelated ordinary primary');await f.entered.promise;
    expect(await f.command('/goal Original queued objective')).toMatchObject({status:'success'});
    await f.until(async()=> (await f.queue()).length===1);
    const queued=(await f.queue())[0]!,original=f.state();
    const userRows=f.root.query('SELECT rowid,id,content FROM messages WHERE is_bot_message=0 ORDER BY rowid').all();
    expect(userRows).toHaveLength(2);expect(queued.content).toContain('<piclaw_goal_input>');expect(f.calls()).toBe(1);
    if(transition==='stop')await f.stop();else await f.command(transition==='replace'?'/goal Fresh replacement objective':'/goal '+transition);
    if(transition==='replace')expect(f.state().goal_id).not.toBe(original.goal_id);
    else if(transition==='clear')expect(f.state()).toBeNull();
    else expect(f.state()).toMatchObject({status:transition==='stop'?'stopped':'paused',lifecycle_generation:2});
    f.held.release();await f.until(()=>f.status(queued.row_id)==='unanswered');
    expect(f.status(primary.submission_id)).toBe('done');
    if(transition==='replace'){await f.until(()=>f.state()?.status==='complete');expect(f.state()).toMatchObject({objective:'Fresh replacement objective',status:'complete'});expect(f.calls()).toBe(3);}
    else expect(f.calls()).toBe(1); // Revoked Goal never entered a provider.
    expect(f.root.query('SELECT rowid,id,content FROM messages WHERE is_bot_message=0 ORDER BY rowid').all().slice(0,2)).toEqual(userRows);
    expect(f.root.query("SELECT state FROM service_effect_s01_sources WHERE source_id IN (SELECT id FROM messages WHERE is_bot_message=0 ORDER BY rowid LIMIT 2)").all()).toEqual([{state:'consumed'},{state:'consumed'}]);
    expect(f.root.query('SELECT * FROM service_effect_s01_operations').all()).toEqual([]);expect(f.root.query('SELECT * FROM service_effect_s02_commits').all()).toEqual([]);
    expect(f.root.query("SELECT * FROM service_effect_s01_decisions WHERE method='withdrawUnclaimedSource.v1'").all()).toEqual([]);
  }finally{await f.close();}
},30000);

applicationTest('native SDK Goal queue: explicit removal preserves the unrelated primary and Goal source history',async()=>{
  const f=await fixture();
  try{
    const primary=await f.send('Unrelated ordinary primary');await f.entered.promise;
    await f.command('/goal Remove queued continuation');await f.until(async()=> (await f.queue()).length===1);
    const queued=(await f.queue())[0]!,before=f.root.query('SELECT rowid,id,content FROM messages WHERE is_bot_message=0 ORDER BY rowid').all();
    await f.stop();
    const response=await f.channel.handleAgentQueueRemove(new Request('https://fixture/agent/queue-remove',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_jid:'web:default',row_id:queued.row_id})}));
    expect(response.status).toBe(200);expect(await response.json()).toMatchObject({removed:true});expect(f.calls()).toBe(1);
    expect(f.status(queued.row_id)).toBe('unanswered');expect(f.root.query('SELECT rowid,id,content FROM messages WHERE is_bot_message=0 ORDER BY rowid').all()).toEqual(before);
    f.held.release();await f.until(()=>f.status(primary.submission_id)==='done');expect(f.calls()).toBe(1);
    const next=await f.send('Goal stopped? Explain as ordinary human input');await f.until(()=>f.status(next.submission_id)==='done');expect(f.calls()).toBe(2);
    expect(f.state()).toMatchObject({status:'stopped'});expect(f.root.query('SELECT * FROM service_effect_s01_operations').all()).toEqual([]);
  }finally{await f.close();}
},30000);

applicationTest('native SDK Goal queue: revocation during credential await denies the provider without revoking ordinary successor input',async()=>{
  const f=await fixture(false,true);
  try{
    const primary=await f.send('Unrelated ordinary primary');await f.entered.promise;
    await f.command('/goal Revoke at the actual post-auth boundary');await f.until(async()=> (await f.queue()).length===1);
    const queued=(await f.queue())[0]!;
    f.held.release();await f.authEntered.promise;expect(f.status(primary.submission_id)).toBe('done');
    // The completed ordinary turn may already have admitted its legitimate
    // Goal continuation. Stopping must create no additional input after this.
    const before=f.root.query('SELECT rowid,id,content FROM messages WHERE is_bot_message=0 ORDER BY rowid').all();
    await f.stop();f.authReleased.release();await f.until(()=>['done','unanswered'].includes(f.status(queued.row_id)??''));
    expect(f.status(queued.row_id)).toBe('unanswered');expect(f.calls()).toBe(1);
    expect(f.root.query('SELECT rowid,id,content FROM messages WHERE is_bot_message=0 ORDER BY rowid').all()).toEqual(before);
    const next=await f.send('Ordinary successor after stopping the Goal');await f.until(()=>f.status(next.submission_id)==='done');expect(f.calls()).toBe(2);
    expect(f.state()).toMatchObject({status:'stopped'});expect(f.root.query('SELECT * FROM service_effect_s01_operations').all()).toEqual([]);
  }finally{await f.close();}
},30000);

applicationTest('native SDK Goal queue: revocation between the prompt hook and source capture cannot renew stale Goal authority',async()=>{
  const f=await fixture();let goalReads=0,stopped=false;
  const original=HostConversationRuntime.prototype.readCapturedInputText;
  const read=spyOn(HostConversationRuntime.prototype,'readCapturedInputText').mockImplementation(async function(this:HostConversationRuntime,...args:Parameters<typeof original>){
    const texts=await original.apply(this,args);
    if(texts.some(text=>text.includes('<piclaw_goal_input>'))&&++goalReads===2){await f.stop();stopped=true;}
    return texts;
  });
  try{
    const primary=await f.send('Unrelated ordinary primary');await f.entered.promise;
    await f.command('/goal Revoke before a new source grant is captured');await f.until(async()=> (await f.queue()).length===1);
    const queued=(await f.queue())[0]!;f.held.release();await f.until(()=>['done','unanswered'].includes(f.status(queued.row_id)??''));
    expect(stopped).toBe(true);expect(f.status(primary.submission_id)).toBe('done');expect(f.status(queued.row_id)).toBe('unanswered');expect(f.calls()).toBe(1);
    const next=await f.send('Ordinary successor keeps its own authority');await f.until(()=>f.status(next.submission_id)==='done');expect(f.calls()).toBe(2);
    expect(f.state()).toMatchObject({status:'stopped'});
  }finally{read.mockRestore();await f.close();}
},30000);
