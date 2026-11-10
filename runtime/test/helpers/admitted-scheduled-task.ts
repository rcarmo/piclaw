import { AgentQueue } from '../../src/queue.js';
import { getDb, getTaskRunLogs } from '../../src/db.js';
import { createCurrentPiclawScheduledRunStore } from '../../src/service-effects/current-piclaw/scheduled-run-store.js';
import { pollScheduledRunsOnce,type SchedulerDeps } from '../../src/task-scheduler.js';
import type { ScheduledTask } from '../../src/types.js';

/** Join the durable result in fixtures; AgentQueue does not own native agent completion. */
export async function waitForAdmittedScheduledTask(id:string){
  const deadline=Date.now()+1000;
  while(Date.now()<deadline){const log=getTaskRunLogs(id)[0];if(log){await Bun.sleep(0);return log;}await Bun.sleep(1);}
  throw Error('Admitted scheduled task did not settle');
}

/** Exercise a real S07 claim/settlement around a caller-supplied native port. */
export async function runAdmittedScheduledTask(task:ScheduledTask,deps:SchedulerDeps){
  const database=getDb();
  database.exec('PRAGMA foreign_keys=ON');
  const built=createCurrentPiclawScheduledRunStore(database,{hitFault:()=>false,recordTrace:()=>{}});
  if(!built.ok)throw Error(built.error._tag);
  const queue=new AgentQueue();
  try {
    await pollScheduledRunsOnce({...deps,queue},built.value);
    await queue.shutdown();
    return await waitForAdmittedScheduledTask(task.id);
  }finally{await queue.shutdown();}
}
