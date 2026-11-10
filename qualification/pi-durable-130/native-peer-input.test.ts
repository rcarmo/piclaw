import {historicalExpenseRows} from '../../runtime/test/fixtures/historical-expense.js';
import './src/test-guard.js';
import {expect} from 'bun:test';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {isolatedApplicationTest} from './src/isolated-application-test.js';
import {nativeGoalFixture} from './src/native-goal-default-fixture.js';
import {createDirectChatToolRelayHandler} from '../../runtime/src/extensions/chat-tool-runtime.js';
const applicationTest=isolatedApplicationTest(import.meta.url);

for(const ingress of ['peer-http','chat-tool','runtime-message'] as const)for(const busy of [false,true])applicationTest(`actual ${ingress} input preserves SDK receipt and metadata with stale activity: busy=${busy}`,async()=>{
  const proof=join(process.env.PICLAW_WORKSPACE!,'native-peer-proof.txt');writeFileSync(proof,'Native relay tool source proof');
  const contexts:any[]=[];
  const f=await nativeGoalFixture(false,false,(attempt,transcript)=>{contexts.push(structuredClone(transcript));return busy&&attempt===1?[{type:'toolCall',id:'native-relay-read',name:'read',arguments:{path:proof}}]:[{type:'text',text:'Relay handled by the actual SDK'}];});
  try{
    const source=await f.pool.createRootChatSession('native-relay-source');
    const target='web:default';
    let primary:any;
    if(busy){primary=await f.send('Keep the primary SDK turn open');await f.entered.promise;}
    // Deliberately contradict the real SDK state. These flags cannot choose placement.
    f.pool.isStreaming=()=>!busy;f.pool.isActive=()=>!busy;
    (f.channel as any).getQueuedFollowupCount=()=>{throw Error('Host queue cannot choose relay placement');};
    f.channel.resumeChat=()=>{throw Error('SDK relay must not wake a host worker');};
    let receipt:any;
    if(ingress==='peer-http'){
      const response=await f.channel.handleAgentPeerMessage(new Request('https://fixture/agent/peer-message',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source_chat_jid:source.chat_jid,target_chat_jid:target,content:'Relay payload body',mode:'steer'})}));
      expect(response.status).toBe(201);receipt=await response.json();expect(receipt.relayed).toBe(true);
    }else if(ingress==='chat-tool'){
      const relay=createDirectChatToolRelayHandler(f.pool,{handleAgentMessage:f.channel.handleAgentMessage.bind(f.channel)},{getAgentDisplayName:()=> 'Fixture'});
      receipt=await relay({source_chat_jid:source.chat_jid,target_chat_jid:target,content:'Relay payload body',mode:'steer'});expect(receipt.relayed).toBe(true);
    }else receipt=await f.channel.enqueueAgentMessage({chatJid:target,content:'Relay payload body',mode:'steer',contentBlocks:[{type:'relay_fixture',source_chat_jid:source.chat_jid}],threadId:busy?primary.thread_id:null});
    expect(receipt.created).toBe(true);expect(Number.isSafeInteger(receipt.row_id)&&receipt.row_id>0).toBe(true);expect(Number.isSafeInteger(receipt.submission_id)&&receipt.submission_id>0).toBe(true);
    expect(receipt.user_message).toBeUndefined();expect(receipt.queued).toBe(busy?'steer':undefined);
    if(ingress==='runtime-message'&&busy){expect(receipt.thread_id).toBe(primary.thread_id);expect(receipt.row_id).not.toBe(receipt.thread_id);}
    const row=f.root.query('SELECT rowid,id,chat_jid,content,content_blocks FROM messages WHERE rowid=?').get(receipt.row_id) as {rowid:number;id:string;chat_jid:string;content:string;content_blocks:string};
    expect(row.chat_jid).toBe(target);expect(row.content).toContain('Relay payload body');
    const blocks=JSON.parse(row.content_blocks);
    expect(blocks[0]).toMatchObject({type:ingress==='runtime-message'?'relay_fixture':'peer_message',source_chat_jid:source.chat_jid,...(ingress!=='runtime-message'?{target_chat_jid:target,body:'Relay payload body'}:{})});
    if(ingress==='chat-tool')expect(blocks[0]).toMatchObject({relay:'chat_tool',reply_to:{chat_jid:source.chat_jid},source_session_tree:{chat_jid:source.chat_jid},target_session_tree:{chat_jid:target}});
    if(busy){expect((await f.queue()).map(item=>item.row_id)).toEqual([receipt.submission_id]);const timeline=await (await f.channel.handleTimeline(50,undefined,target)).json() as any;expect(timeline.posts.some((post:any)=>post.id===receipt.row_id)).toBe(false);}
    else{await f.entered.promise;expect(f.status(receipt.submission_id)).not.toBe('queued');}
    f.held.release();await f.until(()=>f.status(receipt.submission_id)==='done');await f.until(()=>f.root.query('SELECT 1 FROM messages WHERE is_bot_message=1 AND content=?').get('Relay handled by the actual SDK')!==null);
    expect(f.calls()).toBe(busy?2:1);expect(JSON.stringify(contexts)).toContain('Relay payload body');
    const entries=f.root.query("SELECT record FROM entries WHERE json_extract(record,'$.kind')='host.accepted'").all() as {record:string}[];
    expect(entries.filter(entry=>JSON.parse(entry.record).data.sourceId===row.id)).toHaveLength(1);
    const inputs=f.root.query("SELECT * FROM submissions WHERE json_extract(record,'$.type')='input' ORDER BY id").all();expect(inputs).toHaveLength(busy?2:1);
    const sdk=f.root.query('SELECT * FROM submissions ORDER BY id').all(),history=f.root.query('SELECT * FROM entries ORDER BY id').all(),sources=f.root.query('SELECT * FROM service_effect_s01_sources ORDER BY source_seq').all();
    await f.reopen();expect(f.calls()).toBe(busy?2:1);expect(f.root.query('SELECT * FROM submissions ORDER BY id').all()).toEqual(sdk);expect(f.root.query('SELECT * FROM entries ORDER BY id').all()).toEqual(history);expect(f.root.query('SELECT * FROM service_effect_s01_sources ORDER BY source_seq').all()).toEqual(sources);
    for(const table of ['service_effect_s01_operations','service_effect_s02_commits','budget_work','budget_request_reservations','budget_usage_events'])expect(table.startsWith('budget_') ? historicalExpenseRows(f.root,[table])[0] : f.root.query(`SELECT * FROM ${table}`).all()).toEqual([]);
  }finally{await f.close();}
},5000);
