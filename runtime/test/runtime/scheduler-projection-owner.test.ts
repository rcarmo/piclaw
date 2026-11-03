import {expect,spyOn,test} from 'bun:test';
import {createTempWorkspace,setEnv} from '../helpers.js';
import {initDatabase,closeDatabase,getDb} from '../../src/db/connection.js';
import {createTask,getTaskById,getTaskRunLogs,updateTask} from '../../src/db/tasks.js';
import {createCurrentPiclawScheduledRunStore} from '../../src/service-effects/current-piclaw/scheduled-run-store.js';
import {pollScheduledRunsOnce,type SchedulerDeps} from '../../src/task-scheduler.js';

for(const mode of ['success','error','abandon'] as const)test(`S07 is the sole scheduler projection writer after ${mode}`,async()=>{
  await closeDatabase();
  const ws=createTempWorkspace('scheduler-projection-owner-'),restore=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data});
  let transactionSpy:ReturnType<typeof spyOn>|undefined;
  try{
    initDatabase();const db=getDb();db.exec('PRAGMA foreign_keys=ON');
    const built=createCurrentPiclawScheduledRunStore(db,{hitFault:()=>false,recordTrace(){}});if(!built.ok)throw Error(built.error._tag);
    const store=built.value,queued:Array<()=>Promise<void>>=[],sent:string[]=[];
    const id='task:projection:'+mode,now=new Date(Date.now()-1000).toISOString();
    createTask({id,chat_jid:'web:projection',prompt:'projection fixture',task_kind:'shell',command:mode==='error'?"printf 'captured-error'; exit 2":"printf 'captured-success'",cwd:'.',timeout_sec:10,schedule_type:'once',schedule_value:now,next_run:now,status:'active',notify_on_complete:false,created_at:now});
    let committed=false,lateTransactions=0;
    const transaction=db.transaction.bind(db);
    transactionSpy=spyOn(db,'transaction').mockImplementation((fn:any)=>{if(committed)lateTransactions++;return transaction(fn);});
    const complete=store.complete.bind(store),abandon=store.abandon.bind(store);
    store.complete=async request=>{const result=await complete(request);if(result.ok)committed=true;return result;};
    store.abandon=async request=>{const result=await abandon(request);if(result.ok)committed=true;return result;};
    const deps={queue:{enqueueTask(_id:string,run:()=>Promise<void>){queued.push(run);}},agentPool:{isDurableRuntime:()=>true},sendMessage:async(_chat:string,text:string)=>{sent.push(text);}} as unknown as SchedulerDeps;
    await pollScheduledRunsOnce(deps,store);expect(queued).toHaveLength(1);
    if(mode==='abandon')updateTask(id,{status:'paused'});
    await queued[0]!();const observedLateTransactions=lateTransactions;committed=false;
    expect(observedLateTransactions).toBe(0);
    const run=(await store.listRuns({taskId:id}));expect(run.ok).toBe(true);if(!run.ok)throw Error(run.error._tag);
    expect(run.value).toHaveLength(1);
    if(mode==='abandon'){
      expect(run.value[0]).toMatchObject({state:'abandoned',headDisposition:'paused'});
      expect(getTaskById(id)?.status).toBe('paused');expect(getTaskRunLogs(id)).toHaveLength(0);expect(sent).toEqual([]);
    }else{
      expect(run.value[0]).toMatchObject({state:'completed',status:mode,headDisposition:'advanced'});
      expect(getTaskById(id)?.status).toBe('completed');
      const logs=getTaskRunLogs(id);expect(logs).toHaveLength(1);expect(logs[0]?.status).toBe(mode);
      expect(mode==='success'?logs[0]?.result:logs[0]?.error).toContain(mode==='success'?'captured-success':'captured-error');
      expect(sent).toHaveLength(mode==='success'?1:0);
    }
    expect(db.query('PRAGMA busy_timeout').get()).toEqual({timeout:0});
  }finally{transactionSpy?.mockRestore();await closeDatabase();restore();ws.cleanup();}
},15000);
