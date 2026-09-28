import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { createTempWorkspace } from '../helpers.js';
for(const scenario of ['roundtrip','admission','stale','candidate-stale','mixed','deleted','links','dirty','overdue','late-match','candidate-budget','candidate-mode-budget','output-bound','corrupt','ghost','unavailable','cancelled','transaction',
  'revoke-grant','replace-session','change-generation','change-coverage','scope-dirty','row-change','cancel-during-read','mode-change']){
  test(`memory_query: ${scenario}`,async()=>{
    const ws=createTempWorkspace('memory-query-');
    const child=Bun.spawn([process.execPath,join(import.meta.dir,'../fixtures/note-retrieval/query-worker.ts'),scenario],{
      env:{...process.env,PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data,PICLAW_DB_IN_MEMORY:'0',PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX:'1'},stdout:'pipe',stderr:'pipe'});
    const timer=setTimeout(()=>child.kill(),25000);
    try{const[out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
      if(code!==0)throw Error(`${scenario}: ${err.slice(-5000)} ${out.slice(-2000)}`);
      expect(out).toContain('MEMORY_QUERY_OK='+scenario);
    }finally{clearTimeout(timer);ws.cleanup();}
  },30000);
}
