import './src/test-guard.js';
import {expect,spyOn} from 'bun:test';
import {isolatedApplicationTest} from './src/isolated-application-test.js';
import {nativeGoalFixture} from './src/native-goal-default-fixture.js';
import {HostConversationRuntime,type AcceptedInput} from '../../runtime/durable-engine/src/host-runtime.js';
const applicationTest=isolatedApplicationTest(import.meta.url);

for(const terminal of [false,true])for(const kind of ['goal','ordinary'] as const)applicationTest(`native SDK Goal usage: ${terminal?'terminal':'active'}/${kind} steering retains accepted-source boundaries and exact terminal proof without host settlement`,async()=>{
  const program=(attempt:number)=>attempt<=(terminal?3:1)?[{type:'toolCall',id:`goal-round-${attempt}`,name:attempt===2?'goal_complete':'get_goal',arguments:attempt===2?{summary:'Verified native Goal terminal',evidence:['Actual native SDK tool and input ownership']}:{}}]:[{type:'text',text:'Final native Goal reply'}];
  const inputs=new Map<Parameters<HostConversationRuntime['waitForMessage']>[1],{runtime:HostConversationRuntime;input:AcceptedInput}>();
  const wait=HostConversationRuntime.prototype.waitForMessage;
  const observe=spyOn(HostConversationRuntime.prototype,'waitForMessage').mockImplementation(function(this:HostConversationRuntime,...args:Parameters<typeof wait>){inputs.set(args[1],{runtime:this,input:args[0]});return wait.apply(this,args);});
  let publicationInterrupted=false;
  const f=await nativeGoalFixture(false,false,program,channel=>{
    if(!terminal){const broadcast=channel.broadcastEvent.bind(channel);channel.broadcastEvent=(event,data:any)=>{if(event==='new_post'&&data?.data?.type==='agent_response'){publicationInterrupted=true;throw Error('Hold next Goal wake after committed active-prefix observation');}broadcast(event,data);};}
  });
  try{
    await f.command('/goal Native source-prefix accounting');await f.entered.promise;
    const primary=f.root.query('SELECT rowid,content FROM messages WHERE is_bot_message=0 ORDER BY rowid LIMIT 1').get() as {rowid:number;content:string};
    const initial=f.state(),steerText=kind==='goal'?primary.content:'Explicit ordinary human steering input';
    const steering=await f.send(steerText,'steer');expect(steering.queued).toBe('steer');
    const accepted=f.root.query('SELECT rowid,id,content FROM messages WHERE is_bot_message=0 ORDER BY rowid').all();expect(accepted).toHaveLength(2);
    const [primaryId,source]=[...inputs].find(([,item])=>Number(item.input.payloadRef.slice(12))===primary.rowid)!;
    expect(source).toBeDefined();f.held.release();
    // Join the actual SDK receipt under the unchanged 30s scenario deadline;
    // the short UI publication poll starts only after model work is terminal.
    expect((await source.runtime.waitForMessage(source.input,primaryId)).status).toBe('done');
    await f.until(()=>f.root.query('SELECT 1 FROM messages WHERE is_bot_message=1 AND content=?').get('Final native Goal reply')!==null);
    expect(f.calls()).toBe(terminal?4:2);expect(f.state()).toMatchObject({goal_id:initial.goal_id,status:terminal?'complete':'active',lifecycle_generation:terminal?2:1,tokens_used:kind==='goal'?(terminal?8:4):2});if(!terminal)expect(publicationInterrupted).toBe(true);
    const {runtime,input}=source;
    const result=await runtime.readMessageResult(input);expect(result?.answer?.text).toBe('Final native Goal reply');expect(result?.inputs).toHaveLength(2);
    const steeredSource=result!.inputs[1]!;
    try{
      f.root.query('UPDATE messages SET content=? WHERE id=? AND chat_jid=?').run(steerText+' tampered',steeredSource.sourceId,steeredSource.chatJid);
      // Passive attribution belongs to immutable accepted SDK bytes, not a
      // later edited display row. Changed text cannot acquire new admission.
      expect((await runtime.readSettledInputUsage(input))?.inputs.map(row=>row.text)).toEqual([primary.content,steerText]);
      await expect(runtime.submitMessage(steeredSource,'steer')).rejects.toThrow('Host payload hash conflict');
    }finally{f.root.query('UPDATE messages SET content=? WHERE id=? AND chat_jid=?').run(steerText,steeredSource.sourceId,steeredSource.chatJid);}
    const receipts=await runtime.readSettledUsage(input);expect(receipts?.map(row=>row.tokens)).toEqual(terminal?[2,2,2,2]:[2,2]);
    expect(await runtime.readSettledToolNames(input)).toEqual(terminal?['get_goal','goal_complete','get_goal']:['get_goal']);
    const batch=await runtime.readSettledInputUsage(input);expect(batch?.inputs.map(row=>row.text)).toEqual([primary.content,steerText]);expect(batch!.inputs[0]!.entryId).toBeLessThan(batch!.inputs[1]!.entryId);
    expect(receipts![0]!.entryId).toBeLessThan(batch!.inputs[1]!.entryId);expect(receipts![1]!.entryId).toBeGreaterThan(batch!.inputs[1]!.entryId);
    const proof={goalId:initial.goal_id,generation:2,status:'complete' as const};
    expect(await runtime.hasSettledGoalTerminalResult(input,proof)).toBe(terminal);expect(await runtime.hasSettledGoalTerminalResult(input,{...proof,goalId:'foreign'})).toBe(false);
    expect(f.root.query('SELECT * FROM service_effect_s01_operations').all()).toEqual([]);expect(f.root.query('SELECT * FROM service_effect_s02_commits').all()).toEqual([]);
    expect(f.root.query('SELECT rowid,id,content FROM messages WHERE is_bot_message=0 ORDER BY rowid').all().slice(0,2)).toEqual(accepted);
    const state=f.state(),sdk=f.root.query('SELECT * FROM submissions ORDER BY id').all(),calls=f.calls();
    expect(await runtime.submitMessage(input)).toBe(result!.status.id);expect(f.calls()).toBe(calls);expect(f.state()).toEqual(state);expect(f.root.query('SELECT * FROM submissions ORDER BY id').all()).toEqual(sdk);
  }finally{observe.mockRestore();await f.close();}
},30000);

applicationTest('native SDK Goal continuation survives committed publication uncertainty and actual factory reopen without replaying the completed input',async()=>{
  let holdPublication=true;
  const program=(attempt:number)=>attempt===1?[{type:'toolCall',id:'read-initial-goal',name:'get_goal',arguments:{}}]:attempt===3?[{type:'toolCall',id:'complete-next-goal',name:'goal_complete',arguments:{summary:'Native continuation completed',evidence:['Accepted continuation persisted before actual factory reopen']}}]:[{type:'text',text:attempt===2?'First native Goal step':'Goal continuation complete'}];
  const seen=new Map<Parameters<HostConversationRuntime['waitForMessage']>[1],{runtime:HostConversationRuntime;input:AcceptedInput}>(),wait=HostConversationRuntime.prototype.waitForMessage;
  const observe=spyOn(HostConversationRuntime.prototype,'waitForMessage').mockImplementation(function(this:HostConversationRuntime,...args:Parameters<typeof wait>){seen.set(args[1],{runtime:this,input:args[0]});return wait.apply(this,args);});
  const f=await nativeGoalFixture(false,false,program,channel=>{const broadcast=channel.broadcastEvent.bind(channel);channel.broadcastEvent=(event,data:any)=>{if(holdPublication&&event==='new_post'&&data?.data?.type==='agent_response')throw Error('Committed publication awaiting delivery after reopen');broadcast(event,data);};});
  try{
    await f.command('/goal Persist this exact native continuation');await f.entered.promise;
    const [id,source]=[...seen][0]!;f.held.release();expect((await source.runtime.waitForMessage(source.input,id)).status).toBe('done');
    await f.until(()=>f.root.query("SELECT 1 FROM messages WHERE is_bot_message=1 AND content='First native Goal step'").get()!==null);
    expect(f.calls()).toBe(2);expect(f.state()).toMatchObject({status:'active',tokens_used:4});
    const accepted=f.root.query('SELECT rowid,id,content FROM messages WHERE is_bot_message=0 ORDER BY rowid').all() as {rowid:number;id:string;content:string}[];
    expect(accepted).toHaveLength(2);expect(accepted[1]!.id).toStartWith('goal-continuation:sdk-run:');
    expect(f.root.query('SELECT count(*) n FROM submissions').get()).toEqual({n:1});
    const original=f.root.query('SELECT * FROM submissions WHERE id=?').get(id);
    holdPublication=false;await f.reopen();
    await f.until(()=>f.state()?.status==='complete');expect(f.calls()).toBe(4);expect(f.state()).toMatchObject({status:'complete',tokens_used:8});
    expect(f.root.query('SELECT rowid,id,content FROM messages WHERE is_bot_message=0 ORDER BY rowid').all()).toEqual(accepted);
    expect(f.root.query('SELECT * FROM submissions WHERE id=?').get(id)).toEqual(original);expect(f.root.query('SELECT count(*) n FROM submissions').get()).toEqual({n:2});
    expect(f.root.query('SELECT content FROM messages WHERE is_bot_message=1 ORDER BY rowid').all()).toEqual([{content:'First native Goal step'},{content:'Goal continuation complete'}]);
    expect(f.root.query('SELECT state FROM service_effect_s01_sources ORDER BY source_seq').all()).toEqual([{state:'consumed'},{state:'consumed'}]);
    expect(f.root.query('SELECT * FROM service_effect_s01_operations').all()).toEqual([]);expect(f.root.query('SELECT * FROM service_effect_s02_commits').all()).toEqual([]);
  }finally{observe.mockRestore();await f.close();}
},30000);
