import './src/test-guard.js';
import {expect,spyOn} from 'bun:test';
import {isolatedApplicationTest} from './src/isolated-application-test.js';
import {nativeGoalFixture} from './src/native-goal-default-fixture.js';
import {HostConversationRuntime} from '../../runtime/durable-engine/src/host-runtime.js';
import {processChat} from '../../runtime/src/channels/web/handlers/agent.js';
const applicationTest=isolatedApplicationTest(import.meta.url);

for(const fault of ['source-state','source-frontier','polling-cursor'] as const)applicationTest(`accepted SDK queue placement survives optional Root ${fault} ACK failure without resubmission`,async()=>{
  const events:{type:string;data:any}[]=[];
  const f=await nativeGoalFixture(false,false,undefined,channel=>{
    const broadcast=channel.broadcastEvent.bind(channel);
    channel.broadcastEvent=(type,data)=>{events.push({type,data});broadcast(type,data);};
  });
  try{
    const first=await f.send('Hold the first actual native request');await f.entered.promise;
    const frontier=f.root.query('SELECT consumed_through_source_seq FROM service_effect_s01_chats WHERE chat_jid=?').get('web:default');
    const cursor=f.root.query('SELECT cursor_ts FROM chat_cursors WHERE chat_jid=?').get('web:default');
    const point=fault==='source-state'?"UPDATE OF state ON service_effect_s01_sources WHEN NEW.chat_jid='web:default' AND OLD.state='pending'":fault==='source-frontier'?"UPDATE OF consumed_through_source_seq ON service_effect_s01_chats WHEN NEW.chat_jid='web:default'":"UPDATE OF cursor_ts ON chat_cursors WHEN NEW.chat_jid='web:default'";
    f.root.exec(`CREATE TEMP TRIGGER fail_native_source_ack BEFORE ${point} BEGIN SELECT RAISE(ABORT,'synthetic optional Root ACK failure'); END`);
    const queued=await f.send('Queued once despite a failed optional Root ACK','queue');
    expect(queued.queued).toBe('followup');expect(queued.submission_id).not.toBe(first.submission_id);
    const source=f.root.query("SELECT s.source_id,s.state,m.rowid,m.timestamp FROM service_effect_s01_sources s JOIN messages m ON m.id=s.source_id AND m.chat_jid=s.chat_jid WHERE m.content='Queued once despite a failed optional Root ACK'").get() as {source_id:string;state:string;rowid:number;timestamp:string};
    expect(source.state).toBe('pending');expect(f.calls()).toBe(1);expect(f.status(queued.submission_id)).toBe('queued');
    expect(f.root.query('SELECT consumed_through_source_seq FROM service_effect_s01_chats WHERE chat_jid=?').get('web:default')).toEqual(frontier);
    expect(f.root.query('SELECT cursor_ts FROM chat_cursors WHERE chat_jid=?').get('web:default')).toEqual(cursor);
    expect((await f.queue()).map(item=>item.row_id)).toEqual([queued.submission_id]);
    expect(events.filter(event=>event.type==='new_post'&&event.data.id===queued.thread_id)).toEqual([]);
    expect(events.some(event=>event.type==='agent_followup_queued'&&event.data.row_id===queued.submission_id)).toBe(true);
    const timeline=await (await f.channel.handleTimeline(50,undefined,'web:default')).json() as any;
    expect(timeline.posts.map((post:any)=>post.id)).toEqual([first.thread_id]);
    const accepted=f.root.query('SELECT * FROM submissions ORDER BY id').all(),entries=f.root.query('SELECT * FROM entries ORDER BY id').all();
    expect(accepted).toHaveLength(2);expect(f.root.query('SELECT count(*) n FROM messages WHERE is_bot_message=0').get()).toEqual({n:2});
    if(fault==='source-frontier'){
      const dispatch=f.channel.dispatchAcceptedInput!,resume=f.channel.resumeChat;let handoffs=0;
      f.channel.dispatchAcceptedInput=async(...args)=>{handoffs++;return dispatch.apply(f.channel,args);};
      f.channel.resumeChat=()=>{throw Error('Host worker must not requeue an accepted native input');};
      try{await processChat(f.channel,'web:default','default');expect(handoffs).toBe(1);}
      finally{f.channel.dispatchAcceptedInput=dispatch;f.channel.resumeChat=resume;}
      expect(f.calls()).toBe(1);expect(f.root.query('SELECT * FROM submissions ORDER BY id').all()).toEqual(accepted);expect(f.root.query('SELECT * FROM entries ORDER BY id').all()).toEqual(entries);
      expect(f.root.query('SELECT cursor_ts FROM chat_cursors WHERE chat_jid=?').get('web:default')).toEqual(cursor);
    }
    if(fault!=='source-frontier'){
      f.root.exec('DROP TRIGGER fail_native_source_ack');
      // Reconcile ONLY the exact retained source. SDK correlation lookup must
      // not submit another request or rewrite accepted bytes to repair a cursor.
      expect(await f.channel.dispatchAcceptedInput!('web:default',source.source_id,source.rowid,'followUp')).toEqual({submission_id:queued.submission_id,queued:true});
      expect(f.root.query('SELECT * FROM submissions ORDER BY id').all()).toEqual(accepted);expect(f.root.query('SELECT * FROM entries ORDER BY id').all()).toEqual(entries);expect(f.calls()).toBe(1);
    }
    f.held.release();await f.until(()=>f.status(queued.submission_id)==='done');await f.until(()=>(f.root.query('SELECT count(*) n FROM messages WHERE is_bot_message=1').get() as {n:number}).n===2);
    expect(f.calls()).toBe(2);expect(f.root.query('SELECT state FROM service_effect_s01_sources ORDER BY source_seq').all()).toEqual([{state:'consumed'},{state:fault==='source-frontier'?'pending':'consumed'}]);
    const final=f.root.query('SELECT * FROM submissions ORDER BY id').all(),finalEntries=f.root.query('SELECT * FROM entries ORDER BY id').all();
    if(fault==='source-frontier')f.root.exec('DROP TRIGGER fail_native_source_ack');
    await f.reopen();await f.until(()=>f.root.query("SELECT 1 FROM service_effect_s01_sources WHERE state='pending'").get()===null);
    expect(f.calls()).toBe(2);expect(f.root.query('SELECT * FROM submissions ORDER BY id').all()).toEqual(final);expect(f.root.query('SELECT * FROM entries ORDER BY id').all()).toEqual(finalEntries);
    expect(f.root.query('SELECT consumed_through_source_seq FROM service_effect_s01_chats WHERE chat_jid=?').get('web:default')).toEqual({consumed_through_source_seq:2});
    const repairedCursor=f.root.query('SELECT cursor_ts FROM chat_cursors WHERE chat_jid=?').get('web:default') as {cursor_ts:string};expect(repairedCursor.cursor_ts>=source.timestamp).toBe(true);
    for(const table of ['service_effect_s01_operations','service_effect_s02_commits','budget_request_reservations','budget_usage_events'])expect(f.root.query(`SELECT * FROM ${table}`).all()).toEqual([]);
  }finally{f.root.exec('DROP TRIGGER IF EXISTS fail_native_source_ack');await f.close();}
},30000);

for(const revoked of ['source','closing'] as const)applicationTest(`${revoked} revocation during optional Root ACK proof does not become a queued success or a false placed SSE post`,async()=>{
  const events:{type:string;data:any}[]=[];
  const f=await nativeGoalFixture(false,false,undefined,channel=>{const broadcast=channel.broadcastEvent.bind(channel);channel.broadcastEvent=(type,data)=>{events.push({type,data});broadcast(type,data);};});
  const status=HostConversationRuntime.prototype.messageSubmissionStatus;
  const revoke=spyOn(HostConversationRuntime.prototype,'messageSubmissionStatus').mockImplementation(async function(this:HostConversationRuntime,input){
    const result=await status.call(this,input);
    if(result?.status==='queued'){
      if(revoked==='source')f.root.query("UPDATE service_effect_s01_sources SET state='disposed' WHERE source_id=?").run(input.sourceId);
      else f.backend.stop();
    }
    return result;
  });
  try{
    await f.send('Hold real source');await f.entered.promise;
    f.root.exec("CREATE TEMP TRIGGER fail_native_source_ack BEFORE UPDATE OF consumed_through_source_seq ON service_effect_s01_chats BEGIN SELECT RAISE(ABORT,'synthetic optional Root ACK failure'); END");
    const {handleAgentMessage}=await import('../../runtime/src/channels/web/handlers/agent.js');
    const response=await handleAgentMessage(f.channel,new Request('https://fixture/agent/default/message',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({content:'Revoked queued source',mode:'queue'})}),'/agent/default/message','web:default','default');
    expect(response.status).toBe(503);const receipt=await response.json() as any;expect(receipt.accepted).toBe(true);
    expect(events.filter(event=>event.type==='new_post'&&event.data.id===receipt.thread_id)).toEqual([]);
    // A public SDK watch can already have truthfully reported the accepted
    // queued input before revocation. The failed HTTP handoff adds no placement
    // or handler acknowledgement (which would carry thread_id).
    for(const event of events.filter(event=>event.type==='agent_followup_queued'))expect(event.data).not.toHaveProperty('thread_id');
    expect(f.root.query('SELECT count(*) n FROM submissions').get()).toEqual({n:2});expect(f.calls()).toBe(1);
  }finally{revoke.mockRestore();f.root.exec('DROP TRIGGER IF EXISTS fail_native_source_ack');await f.close();}
},30000);
