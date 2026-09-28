import {test,expect} from 'bun:test';
import {join} from 'node:path';
import {createTempWorkspace} from '../helpers.js';
for(const variant of ['current','candidate','expanded','anchored','anchored-two','ranked','head'] as const)test(`frozen hard corpus: ${variant} memory_query snippet and query→get evidence`,async()=>{
 const ws=createTempWorkspace('note-current-evidence-');
 const child=Bun.spawn([process.execPath,join(import.meta.dir,'../fixtures/note-retrieval/current-tool-worker.ts'),variant],{
  env:{...process.env,PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data,PICLAW_DB_IN_MEMORY:'0',PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX:'1'},stdout:'pipe',stderr:'pipe'});
 const timer=setTimeout(()=>child.kill(),60_000);
 try {
  const [out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
  if(code!==0)throw Error(`${code}: ${err.slice(-4000)} ${out.slice(-2000)}`);
  const line=out.split('\n').find(s=>s.startsWith('CURRENT_TOOL_REPORT='));expect(line).toBeDefined();
  const cases=JSON.parse(line!.slice('CURRENT_TOOL_REPORT='.length));expect(cases).toHaveLength(24);
  expect(cases.every((c:any)=>c.status==='ok' && c.reasons.length===0)).toBe(true);
  console.log(`CURRENT_TOOL_EVIDENCE_${variant.toUpperCase()}=`+JSON.stringify(cases));
 }finally {clearTimeout(timer);ws.cleanup();}
},70_000);
