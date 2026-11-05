import {expect,test} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';

const source=resolve(import.meta.dir,'../../../src');
const launcher=resolve(import.meta.dir,'../../../scripts/local-test-priority.ts');
const modes=['placed','queued','held-admission','async-reject','sync-throw','undefined-receipt','null-receipt','callable-receipt','legacy-status','legacy-object','zero-id','negative-id','fractional-id','unsafe-id','missing-queued','string-queued','missing-dispatcher','object-dispatcher','empty-inbox'] as const;
// These are host-port/import-boundary cases. Actual SDK acceptance, queue/cursor
// ACK faults and no-replay history are exercised in native-source-cursor-ack.
for(const mode of modes)test(`native worker hands off admission without legacy lifecycle ownership: ${mode}`,async()=>{
  const root=mkdtempSync(resolve(tmpdir(),'native-worker-boundary-'));
  const script=String.raw`
    import{plugin}from'bun';import assert from'node:assert/strict';
    const source=${JSON.stringify(source)},mode=${JSON.stringify(mode)},attempts=[];
    plugin({name:'legacy-lifecycle-fence',setup(build){build.onLoad({filter:/\/channels\/web\/runtime\/process-chat-(preflight|streaming|finalization)-runtime\.(ts|js)$/},args=>{
      if(!args.path.startsWith(source+'/'))return;attempts.push(args.path);throw Error('Legacy lifecycle module evaluated');
    });}});
    const{initDatabase,storeChatMetadata,storeMessage,getDb,getChatCursor,getMessageRowIdById}=await import(source+'/db.js');
    const{processChat}=await import(source+'/channels/web/handlers/agent.ts');
    initDatabase();const database=getDb(),chat='web:native-worker',messageId='native-worker-source',timestamp='2026-01-01T00:00:01.000Z';
    storeChatMetadata(chat,timestamp,'Fixture');
    if(mode!=='empty-inbox')storeMessage({id:messageId,chat_jid:chat,sender:'user',sender_name:'Fixture',content:'Accepted source bytes',timestamp,is_from_me:false,is_bot_message:false});
    const oldQueue=JSON.stringify([{rowId:-7,queuedContent:'Retained old host queue bytes',queuedAt:timestamp,threadId:null}]);
    database.query('INSERT INTO chat_cursors(chat_jid,cursor_ts,queued_followups_json) VALUES(?,?,?)').run(chat,'',oldQueue);
    const snapshot=()=>JSON.stringify([database.query('SELECT * FROM messages ORDER BY rowid').all(),database.query('SELECT * FROM chat_cursors ORDER BY chat_jid').all()]);
    const before=snapshot();let calls=0,argsSeen,release;
    const held=new Promise(resolve=>{release=resolve;});
    const dispatcher=(...args)=>{
      calls++;argsSeen=args;if(mode==='sync-throw')throw Error('Synthetic dispatch rejection');
      if(mode==='async-reject')return Promise.reject(Error('Synthetic dispatch rejection'));
      if(mode==='undefined-receipt')return Promise.resolve(undefined);
      if(mode==='null-receipt')return Promise.resolve(null);
      if(mode==='callable-receipt')return Promise.resolve(()=>{throw Error('Retired coordinator must not be called');});
      if(mode==='legacy-status')return Promise.resolve('settled');
      if(mode==='legacy-object')return Promise.resolve({status:'pending'});
      const receipt={submission_id:mode==='zero-id'?0:mode==='negative-id'?-1:mode==='fractional-id'?1.5:mode==='unsafe-id'?Number.MAX_SAFE_INTEGER+1:17,queued:mode==='queued'};
      if(mode==='missing-queued')delete receipt.queued;
      if(mode==='string-queued')receipt.queued='followup';
      return mode==='held-admission'?held.then(()=>receipt):Promise.resolve(receipt);
    };
    Object.defineProperty(dispatcher,'waitForPending',{get(){throw Error('Retired pending owner must not be read');}});
    const channel={agentPool:{isDurableRuntime:()=>true},dispatchAcceptedInput:mode==='missing-dispatcher'?undefined:mode==='object-dispatcher'?{}:dispatcher};
    for(const key of ['resumeChat','updateAgentStatus','broadcastEvent','queue','getQueuedFollowupCount','getQueuedInputMaterialization'])Object.defineProperty(channel,key,{get(){throw Error('Worker must not access host lifecycle '+key);}});
    let failure='',finished=false;
    const pending=processChat(channel,chat,'default').then(()=>{finished=true;},error=>{finished=true;failure=String(error);});
    if(mode==='held-admission'){assert.equal(calls,1);assert.equal(finished,false);release();}
    await pending;
    const valid=['placed','queued','held-admission','empty-inbox'].includes(mode);
    if(valid)assert.equal(failure,'');
    else if(mode==='async-reject'||mode==='sync-throw')assert.match(failure,/Synthetic dispatch rejection/);
    else if(mode==='missing-dispatcher'||mode==='object-dispatcher')assert.match(failure,/Native SDK dispatcher required/);
    else assert.match(failure,/Native SDK admission receipt required/);
    assert.equal(calls,['missing-dispatcher','object-dispatcher','empty-inbox'].includes(mode)?0:1);
    if(calls)assert.deepEqual(argsSeen,[chat,messageId,getMessageRowIdById(chat,messageId),'followUp']);
    assert.equal(snapshot(),before);assert.equal(getChatCursor(chat),'');assert.deepEqual(attempts,[]);
    console.log(JSON.stringify({mode,calls,failure,attempts,unchanged:true}));
  `;
  try{
    const child=Bun.spawn([process.execPath,launcher,'--cwd',root,'--',process.execPath,'--eval',script],{cwd:root,env:{...process.env,HOME:root,PICLAW_WORKSPACE:resolve(root,'workspace'),PICLAW_STORE:resolve(root,'store'),PICLAW_DATA:resolve(root,'data'),PI_CODING_AGENT_DIR:resolve(root,'agent'),PICLAW_DB_IN_MEMORY:'1'},stdout:'pipe',stderr:'pipe'});
    const[out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
    expect({code,err:code?err:''}).toEqual({code:0,err:''});
    const result=JSON.parse(out.trim().split('\n').at(-1)!);expect(result.mode).toBe(mode);expect(result.attempts).toEqual([]);expect(result.unchanged).toBe(true);
  }finally{rmSync(root,{recursive:true,force:true});}
},30000);
