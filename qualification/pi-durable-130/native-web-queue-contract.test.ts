import {historicalExpenseRows} from '../../runtime/test/fixtures/historical-expense.js';
import './src/test-guard.js';
import {expect} from 'bun:test';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {isolatedApplicationTest} from './src/isolated-application-test.js';
import {nativeGoalFixture} from './src/native-goal-default-fixture.js';
import {createMedia} from '../../runtime/src/db/media.js';
const applicationTest=isolatedApplicationTest(import.meta.url);
const historical=JSON.stringify([{rowId:-7,queuedContent:'Retained old host backlog',queuedAt:'2020-01-01T00:00:00.000Z',threadId:null}]);

for(const command of ['queue','steer'] as const)for(const busy of [false,true])applicationTest(`native /${command} uses SDK placement with stale activity and preserved host backlog: busy=${busy}`,async()=>{
  const file=join(process.env.PICLAW_WORKSPACE!,'native-queue-proof.txt');writeFileSync(file,'Native queue source');
  const f=await nativeGoalFixture(false,false,attempt=>busy&&command==='steer'&&attempt===1?[{type:'toolCall',id:'native-queue-read',name:'read',arguments:{path:file}}]:[{type:'text',text:'Native queue command completed'}]);
  try{
    f.root.query("INSERT INTO chat_cursors(chat_jid,cursor_ts,queued_followups_json) VALUES ('web:default','',?)").run(historical);
    if(busy){await f.send('Keep actual SDK execution busy');await f.entered.promise;}
    f.pool.isActive=()=>!busy;f.pool.isStreaming=()=>!busy;
    (f.channel as any).getQueuedFollowupCount=()=>{throw Error('Legacy backlog cannot choose native placement');};
    f.channel.resumeChat=()=>{throw Error('Native command cannot wake a host worker');};
    const accepted=await f.send(`/${command} Command payload body`);
    expect(accepted.created).toBe(true);expect(accepted.row_id).toBeGreaterThan(0);expect(accepted.submission_id).toBeGreaterThan(0);expect(accepted.queued).toBe(busy?(command==='steer'?'steer':'followup'):undefined);
    const row=f.root.query('SELECT id,content FROM messages WHERE rowid=?').get(accepted.row_id) as {id:string;content:string};expect(row.content).toBe('Command payload body');
    expect((await f.queue()).map(item=>item.row_id)).toEqual(busy?[accepted.submission_id]:[]);
    if(busy){const timeline=await (await f.channel.handleTimeline(50,undefined,'web:default')).json() as any;expect(timeline.posts.some((post:any)=>post.id===accepted.row_id)).toBe(false);}
    else await f.entered.promise;
    f.held.release();await f.until(()=>f.status(accepted.submission_id)==='done');expect(f.calls()).toBe(busy?2:1);
    const entry=f.root.query("SELECT record FROM entries WHERE json_extract(record,'$.kind')='host.accepted' AND json_extract(record,'$.data.sourceId')=?").all(row.id);expect(entry).toHaveLength(1);
    expect(f.root.query("SELECT queued_followups_json FROM chat_cursors WHERE chat_jid='web:default'").get()).toEqual({queued_followups_json:historical});
    const sdk=f.root.query('SELECT * FROM submissions ORDER BY id').all(),entries=f.root.query('SELECT * FROM entries ORDER BY id').all();await f.reopen();expect(f.calls()).toBe(busy?2:1);expect(f.root.query('SELECT * FROM submissions ORDER BY id').all()).toEqual(sdk);expect(f.root.query('SELECT * FROM entries ORDER BY id').all()).toEqual(entries);
    for(const table of ['service_effect_s01_operations','service_effect_s02_commits','budget_work','budget_request_reservations','budget_usage_events'])expect(table.startsWith('budget_') ? historicalExpenseRows(f.root,[table])[0] : f.root.query(`SELECT * FROM ${table}`).all()).toEqual([]);
  }finally{await f.close();}
},5000);

for(const action of ['steer','remove'] as const)applicationTest(`native queue ${action} respects explicit branch identity and SDK placement rather than host removal`,async()=>{
  const events:{type:string;data:any}[]=[];
  const f=await nativeGoalFixture(false,false,undefined,channel=>{const broadcast=channel.broadcastEvent.bind(channel);channel.broadcastEvent=(type,data)=>{events.push({type,data});broadcast(type,data);};});
  try{
    const branch=await f.pool.createRootChatSession('other-native-queue');await f.channel.prepareInputSourceAdmission!(branch.chat_jid);
    const first=await f.send('Hold actual default SDK generation');await f.entered.promise;
    const media=createMedia('control.txt','text/plain',new TextEncoder().encode('Queued control attachment'),null,null);
    const queuedResponse=await f.channel.handleAgentMessage(new Request('https://fixture/agent/default/message',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({content:'Queued control payload',mode:'queue',media_ids:[media],content_blocks:[{type:'text',text:'Queued structured correction'}],link_previews:[{url:'https://fixture.invalid',title:'Queued preview'}],screen_hint:'tablet'})}),'/agent/default/message');expect(queuedResponse.status).toBe(201);
    const queued=await queuedResponse.json() as any,before=f.root.query('SELECT record FROM submissions WHERE id=?').get(queued.submission_id);
    const sibling=await f.send('Untouched SDK sibling','queue'),stored=f.root.query('SELECT * FROM messages WHERE rowid=?').get(queued.row_id);
    f.channel.resumeChat=()=>{throw Error('Native control cannot wake a host worker');};
    const request=(chat:string)=>new Request(`https://fixture/agent/queue-${action}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_jid:chat,row_id:queued.submission_id})});
    const invoke=(chat:string)=>action==='steer'?f.channel.handleAgentQueueSteer(request(chat)):f.channel.handleAgentQueueRemove(request(chat));
    const foreign=await invoke(branch.chat_jid);expect(foreign.status).toBe(200);expect(await foreign.json()).toMatchObject({removed:false,count:0});
    expect(f.root.query('SELECT record FROM submissions WHERE id=?').get(queued.submission_id)).toEqual(before);expect((await f.queue()).map(item=>item.row_id)).toEqual([queued.submission_id,sibling.submission_id]);
    const collision=JSON.stringify([{rowId:queued.submission_id,queuedContent:'Old ambiguous queue identity',queuedAt:'2020-01-01T00:00:00.000Z',threadId:null}]);
    f.root.query("UPDATE chat_cursors SET queued_followups_json=? WHERE chat_jid='web:default'").run(collision);
    expect((await invoke('web:default')).status).toBe(409);expect(f.root.query('SELECT record FROM submissions WHERE id=?').get(queued.submission_id)).toEqual(before);
    expect(f.root.query("SELECT queued_followups_json FROM chat_cursors WHERE chat_jid='web:default'").get()).toEqual({queued_followups_json:collision});
    f.root.query("UPDATE chat_cursors SET queued_followups_json=? WHERE chat_jid='web:default'").run(historical);
    const oldRequest=new Request(`https://fixture/agent/queue-${action}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_jid:'web:default',row_id:-7})});
    expect((await(action==='steer'?f.channel.handleAgentQueueSteer(oldRequest):f.channel.handleAgentQueueRemove(oldRequest))).status).toBe(409);
    expect(f.root.query("SELECT queued_followups_json FROM chat_cursors WHERE chat_jid='web:default'").get()).toEqual({queued_followups_json:historical});
    const own=await invoke('web:default');expect(own.status).toBe(action==='steer'?201:200);expect(await own.json()).toMatchObject({removed:action==='remove'});
    if(action==='steer'){
      expect(f.root.query('SELECT record FROM submissions WHERE id=?').get(queued.submission_id)).toEqual(before);expect((await f.queue()).map(item=>item.row_id)).toEqual([queued.submission_id,sibling.submission_id]);
      expect(events.filter(event=>['agent_followup_removed','agent_followup_consumed'].includes(event.type)&&event.data.row_id===queued.submission_id)).toEqual([]);
    }else{expect(f.status(queued.submission_id)).toBe('unanswered');expect((await f.queue()).map(item=>item.row_id)).toEqual([sibling.submission_id]);expect(events.some(event=>event.type==='agent_followup_removed'&&event.data.row_id===queued.submission_id)).toBe(true);}
    expect(f.root.query('SELECT * FROM messages WHERE rowid=?').get(queued.row_id)).toEqual(stored);
    expect(f.root.query('SELECT media_id FROM message_media WHERE message_rowid=?').all(queued.row_id)).toEqual([{media_id:media}]);
    expect(f.calls()).toBe(1);const sources=f.root.query('SELECT * FROM service_effect_s01_sources ORDER BY source_seq').all();expect(sources).toHaveLength(3);
    f.held.release();await f.until(()=>f.status(first.submission_id)==='done');if(action==='steer')await f.until(()=>f.status(queued.submission_id)==='done');await f.until(()=>f.status(sibling.submission_id)==='done');
    const calls=f.calls(),sdk=f.root.query('SELECT * FROM submissions ORDER BY id').all();await f.reopen();expect(f.calls()).toBe(calls);expect(f.root.query('SELECT * FROM submissions ORDER BY id').all()).toEqual(sdk);expect(f.root.query('SELECT * FROM service_effect_s01_sources ORDER BY source_seq').all()).toEqual(sources);
    for(const table of ['service_effect_s01_operations','service_effect_s02_commits'])expect(table.startsWith('budget_') ? historicalExpenseRows(f.root,[table])[0] : f.root.query(`SELECT * FROM ${table}`).all()).toEqual([]);
  }finally{await f.close();}
},5000);

for(const boundary of ['before-source','after-source','structured-payload','stream-ended'] as const)applicationTest(`native steering races an actually starting SDK turn at ${boundary} without a host lane decision`,async()=>{
  const file=join(process.env.PICLAW_WORKSPACE!,'native-starting-proof.txt');writeFileSync(file,'Native starting source');
  // The ended-stream boundary needs a completed SDK turn, not an unrelated
  // tool round trip. The other starting races retain the real source-bound read.
  const f=await nativeGoalFixture(false,false,attempt=>boundary!=='stream-ended'&&attempt===1?[{type:'toolCall',id:'native-starting-read',name:'read',arguments:{path:file}}]:[{type:'text',text:'Starting SDK turn completed'}]);
  let release!:()=>void,entered!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{entered=resolve;});
  const admit=f.channel.admitMessage!;
  try{
    const metadata={content_blocks:[{type:'text',text:'Structured starting correction'}],link_previews:[{url:'https://fixture.invalid',title:'Starting fixture'}],screen_hint:'tablet'};
    const media=boundary==='structured-payload'?createMedia('starting.txt','text/plain',new TextEncoder().encode('Starting attachment'),null,null):undefined;
    f.channel.admitMessage=async(...args)=>{
      const correction=args[1]==='Starting correction'||args[1]==='';
      if(correction&&boundary==='before-source'){entered();await held;}
      const stored=await admit.apply(f.channel,args);
      if(correction&&boundary!=='before-source'){entered();await held;}
      return stored;
    };
    const payload=boundary==='structured-payload'?{content:'',mode:'steer',persist_steer:true,media_ids:[media],...metadata}:{content:'Starting correction',mode:'steer',persist_steer:true};
    const pending=f.channel.handleAgentMessage(new Request('https://fixture/agent/default/message',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}),'/agent/default/message');
    await Promise.race([ready,pending.then(async response=>{throw Error(`Source boundary not reached: HTTP ${response.status} ${await response.clone().text()}`);})]);const primary=await f.send('Start the independent SDK turn');await f.entered.promise;
    f.pool.isActive=()=>false;f.pool.isStreaming=()=>false;(f.channel as any).getQueuedFollowupCount=()=>{throw Error('Host queue cannot decide starting steering');};
    if(boundary==='stream-ended'){f.held.release();await f.until(()=>f.status(primary.submission_id)==='done');}
    release();const response=await pending;expect(response.status).toBe(201);const accepted=await response.json() as any;expect(accepted.queued).toBe(boundary==='stream-ended'?undefined:'steer');expect(accepted.created).toBe(true);
    expect((await f.queue()).map(item=>item.row_id)).toEqual(boundary==='stream-ended'?[]:[accepted.submission_id]);if(boundary!=='stream-ended')expect(f.calls()).toBe(1);
    const rows=f.root.query('SELECT rowid,* FROM messages WHERE is_bot_message=0 ORDER BY rowid').all() as any[];expect(rows).toHaveLength(2);
    if(boundary==='structured-payload'){
      const row=rows.find(row=>row.rowid===accepted.row_id);expect(JSON.parse(row.content_blocks)).toEqual(metadata.content_blocks);expect(JSON.parse(row.link_previews)).toEqual(metadata.link_previews);expect(row.screen_hint).toBe('tablet');
      expect(f.root.query('SELECT media_id FROM message_media WHERE message_rowid=?').all(accepted.row_id)).toEqual([{media_id:media}]);
    }
    f.held.release();await f.until(()=>f.status(accepted.submission_id)==='done');expect(f.status(primary.submission_id)).toBe('done');expect(f.calls()).toBe(2);
    expect(f.root.query('SELECT * FROM service_effect_s01_operations').all()).toEqual([]);expect(f.root.query('SELECT * FROM service_effect_s02_commits').all()).toEqual([]);
    const sdk=f.root.query('SELECT * FROM submissions ORDER BY id').all(),entries=f.root.query('SELECT * FROM entries ORDER BY id').all();await f.reopen();expect(f.calls()).toBe(2);expect(f.root.query('SELECT * FROM submissions ORDER BY id').all()).toEqual(sdk);expect(f.root.query('SELECT * FROM entries ORDER BY id').all()).toEqual(entries);
  }finally{release();await f.close();}
},5000);
