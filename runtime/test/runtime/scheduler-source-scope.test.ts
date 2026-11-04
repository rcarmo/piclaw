import {expect,spyOn,test} from 'bun:test';
import {createTempWorkspace,setEnv} from '../helpers.js';
import {initDatabase,closeDatabase,getDb} from '../../src/db/connection.js';
import {createTask,getTaskRunLogs} from '../../src/db/tasks.js';
import {createCurrentPiclawScheduledRunStore} from '../../src/service-effects/current-piclaw/scheduled-run-store.js';
import {pollScheduledRunsOnce,type SchedulerDeps} from '../../src/task-scheduler.js';
import {hashCanonicalRequest} from '../../src/service-effects/contracts/common.js';

async function fixture(options:{error?:boolean;bindFault?:boolean}={}){
  await closeDatabase();const ws=createTempWorkspace('scheduler-source-scope-'),restore=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data});
  try{
    process.env.PICLAW_DB_IN_MEMORY='0';initDatabase();const db=getDb();db.exec('PRAGMA foreign_keys=ON');const path=(db.query('PRAGMA database_list').all() as {name:string;file:string}[]).find(r=>r.name==='main')!.file;
    expect(path).toContain(ws.store);expect(db.query('PRAGMA journal_mode').get()).toEqual({journal_mode:'wal'});
    const built=createCurrentPiclawScheduledRunStore(db,{hitFault:(point,method)=>options.bindFault===true&&point==='before_effect'&&method==='bindAcceptedSource',recordTrace(){}});if(!built.ok)throw Error(built.error._tag);const store=built.value;
    const due=new Date(Date.now()-1000).toISOString(),id='task:source-scope',chat='web:source-scope';createTask({id,chat_jid:chat,prompt:'fixture',schedule_type:'once',schedule_value:due,next_run:due,status:'active',notify_on_complete:false,created_at:due});
    const queued:Array<()=>Promise<void>>=[],sent:string[]=[];let calls=0;
    const deps={queue:{enqueueTask(_id:string,run:()=>Promise<void>){queued.push(run);}},agentPool:{isDurableRuntime:()=>true,dispatchScheduledAgent:async()=>{calls++;expect(db.query('SELECT state FROM service_effect_s07_occurrences').get()).toEqual({state:'source_bound'});return options.error?{status:'error',result:null,error:'synthetic execution error'}:{status:'success',result:'same native outcome'};}},sendMessage:async(_chat:string,text:string)=>{sent.push(text);}} as unknown as SchedulerDeps;
    const rows=(table:string)=>db.query(`SELECT * FROM ${table} ORDER BY rowid`).all();
    const source=()=>['service_effect_s01_chats','service_effect_s01_sources','service_effect_s01_operations','service_effect_s01_operation_sources'].map(rows);
    const immutable=()=>['service_effect_s07_occurrences','service_effect_s07_leases','service_effect_s07_source_bindings','service_effect_s07_run_logs','service_effect_s07_next_decisions','service_effect_s07_decisions','task_run_logs'].map(rows);
    return{db,store,id,chat,queued,sent,source,immutable,calls:()=>calls,poll:()=>pollScheduledRunsOnce(deps,store),async close(){await closeDatabase();restore();ws.cleanup();}};
  }catch(error){await closeDatabase();restore();ws.cleanup();throw error;}
}

function observeSourceScopes(db:ReturnType<typeof getDb>){
  const transaction=db.transaction.bind(db),query=db.query.bind(db);let depth=0;const allocation:number[]=[],settlement:number[]=[];
  const tx=spyOn(db,'transaction').mockImplementation((fn:any)=>transaction(function(this:any,...args:any[]){depth++;try{return fn.apply(this,args);}finally{depth--;}}));
  const sql=spyOn(db,'query').mockImplementation((text:any)=>{
    if(typeof text==='string'&&text.startsWith('INSERT OR IGNORE INTO service_effect_s01_chats'))allocation.push(depth);
    if(typeof text==='string'&&text.startsWith('UPDATE service_effect_s01_chats SET active_operation_id=NULL'))settlement.push(depth);
    return query(text);
  });
  return{allocation,settlement,restore(){sql.mockRestore();tx.mockRestore();}};
}

for(const mode of ['success','error','bind-failure'] as const)test(`one existing admitted source scope owns allocation and ${mode} settlement`,async()=>{
  const f=await fixture({error:mode==='error',bindFault:mode==='bind-failure'});let observed:ReturnType<typeof observeSourceScopes>|undefined;
  try{
    await f.poll();expect(f.queued).toHaveLength(1);observed=observeSourceScopes(f.db);await f.queued[0]!();
    expect(f.db.query('SELECT next_source_seq,consumed_through_source_seq,active_operation_id FROM service_effect_s01_chats').get()).toEqual({next_source_seq:2,consumed_through_source_seq:mode==='success'?1:0,active_operation_id:null});
    expect(f.db.query('SELECT state,disposition_reason FROM service_effect_s01_sources').get()).toEqual({state:mode==='success'?'consumed':'disposed',disposition_reason:mode==='success'?null:'scheduled_task_failed'});
    expect(f.db.query('SELECT phase,version,terminal_disposition,terminal_error_code FROM service_effect_s01_operations').get()).toEqual({phase:'terminal',version:2,terminal_disposition:mode==='success'?'completed':'failed',terminal_error_code:mode==='success'?null:'scheduled_task_failed'});
    expect(f.calls()).toBe(mode==='bind-failure'?0:1);expect(getTaskRunLogs(f.id)).toHaveLength(mode==='bind-failure'?0:1);expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(observed.allocation).toEqual([1]);expect(observed.settlement).toEqual([1]);
  }finally{observed?.restore();await f.close();}
},15000);

test('allocation abort after source insertion rolls back chat sequence, source and operation atomically',async()=>{
  const f=await fixture();let observed:ReturnType<typeof observeSourceScopes>|undefined;
  try{
    await f.poll();const before=f.source();f.db.exec("CREATE TRIGGER fail_source_operation BEFORE INSERT ON service_effect_s01_operations BEGIN SELECT RAISE(ABORT,'synthetic allocation failure');END");observed=observeSourceScopes(f.db);
    await f.queued[0]!();expect(f.source()).toEqual(before);expect(f.calls()).toBe(0);expect(getTaskRunLogs(f.id)).toHaveLength(0);expect(f.db.query('SELECT state FROM service_effect_s07_occurrences').get()).toEqual({state:'abandoned'});expect(observed.allocation).toEqual([1]);
  }finally{observed?.restore();f.db.exec('DROP TRIGGER IF EXISTS fail_source_operation');await f.close();}
},15000);

for(const point of ['operation','source','frontier'] as const)test(`source settlement ${point} failure rolls back only source bookkeeping; canonical receipt repairs once`,async()=>{
  const f=await fixture();let observed:ReturnType<typeof observeSourceScopes>|undefined;
  try{
    await f.poll();
    const trigger=point==='operation'?"BEFORE UPDATE ON service_effect_s01_operations WHEN NEW.phase='terminal'":point==='source'?"BEFORE UPDATE ON service_effect_s01_sources WHEN NEW.state='consumed'":"BEFORE UPDATE OF consumed_through_source_seq ON service_effect_s01_chats WHEN NEW.consumed_through_source_seq>OLD.consumed_through_source_seq";
    f.db.exec(`CREATE TRIGGER fail_source_settlement ${trigger} BEGIN SELECT RAISE(ABORT,'synthetic settlement failure');END`);observed=observeSourceScopes(f.db);
    await f.queued[0]!();expect(f.calls()).toBe(1);expect(f.db.query('SELECT state FROM service_effect_s07_occurrences').get()).toEqual({state:'completed'});expect(getTaskRunLogs(f.id)).toHaveLength(1);expect(getTaskRunLogs(f.id)[0]?.result).toBe('same native outcome');
    const operation=f.db.query('SELECT operation_id FROM service_effect_s01_operations').get() as {operation_id:string};
    expect(f.db.query('SELECT active_operation_id,consumed_through_source_seq,next_source_seq FROM service_effect_s01_chats').get()).toEqual({active_operation_id:operation.operation_id,consumed_through_source_seq:0,next_source_seq:2});
    expect(f.db.query('SELECT phase,version,terminal_disposition FROM service_effect_s01_operations').get()).toEqual({phase:'claimed',version:1,terminal_disposition:null});expect(f.db.query('SELECT state,disposition_reason FROM service_effect_s01_sources').get()).toEqual({state:'claimed',disposition_reason:null});
    expect(observed.allocation).toEqual([1]);expect(observed.settlement).toEqual([1]);const immutable=f.immutable();
    f.db.exec('DROP TRIGGER fail_source_settlement');observed.settlement.length=0;await f.poll();expect(observed.settlement).toEqual([1]);expect(f.immutable()).toEqual(immutable);expect(f.calls()).toBe(1);expect(f.queued).toHaveLength(1);
    expect(f.db.query('SELECT phase,version FROM service_effect_s01_operations').get()).toEqual({phase:'terminal',version:2});expect(f.db.query('SELECT state FROM service_effect_s01_sources').get()).toEqual({state:'consumed'});const repaired=f.source();observed.settlement.length=0;await f.poll();expect(observed.settlement).toEqual([]);expect(f.source()).toEqual(repaired);expect(f.immutable()).toEqual(immutable);expect(f.calls()).toBe(1);
  }finally{observed?.restore();f.db.exec('DROP TRIGGER IF EXISTS fail_source_settlement');await f.close();}
},15000);

test('existing source identity and hash are reused without sequence or operation allocation',async()=>{
  const f=await fixture();let observed:ReturnType<typeof observeSourceScopes>|undefined;
  try{
    await f.poll();const run=f.db.query('SELECT run_id FROM service_effect_s07_occurrences').get() as {run_id:string},operation='operation:existing',now=new Date().toISOString();
    const revision=f.db.query('SELECT snapshot_json FROM service_effect_s07_task_revisions WHERE task_id=?').get(f.id) as {snapshot_json:string},payloadRef=JSON.parse(revision.snapshot_json).payloadRef as string;
    const hash=hashCanonicalRequest({chatJid:f.chat,sourceId:run.run_id,kind:'scheduled_agent',payloadRef});
    f.db.transaction(()=>{
      f.db.query('INSERT INTO service_effect_s01_chats(chat_jid,next_source_seq,consumed_through_source_seq,active_operation_id) VALUES(?,2,0,?)').run(f.chat,operation);
      f.db.query("INSERT INTO service_effect_s01_sources(chat_jid,source_seq,source_id,source_hash,kind,state,payload_ref,accepted_at,provenance_ref,create_wake_intent) VALUES(?,1,?,?,'scheduled_agent','claimed',?,?,'fixture:existing',0)").run(f.chat,run.run_id,hash,payloadRef,now);
      f.db.query("INSERT INTO service_effect_s01_operations(operation_id,chat_jid,version,phase,primary_source_seq) VALUES(?,?,1,'claimed',1)").run(operation,f.chat);
      f.db.query('INSERT INTO service_effect_s01_operation_sources(chat_jid,operation_id,source_seq) VALUES(?,?,1)').run(f.chat,operation);
    }).immediate();observed=observeSourceScopes(f.db);
    await f.queued[0]!();expect(observed.allocation).toEqual([]);expect(observed.settlement).toEqual([1]);expect(f.calls()).toBe(1);
    expect(f.db.query('SELECT source_seq,source_id,source_hash FROM service_effect_s01_sources').get()).toEqual({source_seq:1,source_id:run.run_id,source_hash:hash});expect(f.db.query('SELECT operation_id FROM service_effect_s01_operations').get()).toEqual({operation_id:operation});expect(f.db.query('SELECT next_source_seq,consumed_through_source_seq FROM service_effect_s01_chats').get()).toEqual({next_source_seq:2,consumed_through_source_seq:1});
  }finally{observed?.restore();await f.close();}
},15000);
