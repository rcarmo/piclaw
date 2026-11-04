import { expect,test } from 'bun:test';
import { createTempWorkspace } from '../helpers.js';
test('idle scheduler reads skip writer admission while S07 mutations yield to real lock holders',async()=>{
 const entry=new URL('../fixtures/scheduler-contention-disk.ts',import.meta.url).pathname;
 const launcher=new URL('../../scripts/local-test-priority.ts',import.meta.url).pathname;
 const workspace=createTempWorkspace('scheduler-contention-child-');
 const child=Bun.spawn([process.execPath,'--no-env-file',launcher,'--','--env','PICLAW_DB_IN_MEMORY=0','--env',`PICLAW_WORKSPACE=${workspace.workspace}`,'--env',`PICLAW_STORE=${workspace.store}`,'--env',`PICLAW_DATA=${workspace.data}`,'--',process.execPath,'--no-env-file',entry],{stdin:'ignore',stdout:'pipe',stderr:'pipe'});
 const timer=setTimeout(()=>child.kill('SIGKILL'),15000);
 try{const [exit,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);expect(exit,stderr).toBe(0);expect(JSON.parse(stdout.trim().split('\n').at(-1)!)).toMatchObject({idlePollWhileLocked:true,storeAfterRelease:true,noCallbackReplay:true,rollbackExact:true,noProviderWork:true,busyTimeoutRestored:true});}
 finally{clearTimeout(timer);if(child.exitCode===null)child.kill('SIGKILL');await child.exited;workspace.cleanup();}
},20000);
