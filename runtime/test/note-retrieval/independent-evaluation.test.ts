import { test, expect } from 'bun:test';
import { join } from 'node:path';
import { createTempWorkspace } from '../helpers.js';

async function run(direction:'forward'|'reverse') {
  const ws=createTempWorkspace(`note-independent-${direction}-`);
  const child=Bun.spawn([process.execPath,join(import.meta.dir,'../fixtures/note-retrieval/independent-worker.ts'),direction],{
    env:{...process.env,PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data,PICLAW_DB_IN_MEMORY:'0',PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX:'1'},
    stdout:'pipe',stderr:'pipe',
  });
  const timer=setTimeout(()=>child.kill(),60_000);
  try {
    const [out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
    if(code!==0)throw Error(`${code}: ${err.slice(-4000)} ${out.slice(-2000)}`);
    const line=out.split('\n').find(s=>s.startsWith('INDEPENDENT_REPORT='));expect(line).toBeDefined();
    return JSON.parse(line!.slice('INDEPENDENT_REPORT='.length));
  } finally {clearTimeout(timer);ws.cleanup();}
}

test('frozen independent evaluation: fresh rebuild order and reference stability', async () => {
  const forward=await run('forward'),repeat=await run('forward'),reverse=await run('reverse');
  for(const report of [forward,repeat,reverse]) {
    expect(report.summary).toHaveLength(44);
    expect(report.summary.every((row:any)=>row.status==='ok'&&row.reasons.length===0)).toBe(true);
  }
  const payload=(report:any)=>JSON.stringify(report.summary.map(({elapsedMs,...row}:any)=>row));
  expect(payload(forward)).toEqual(payload(repeat));
  expect(payload(forward)).toEqual(payload(reverse));
  console.log('INDEPENDENT_EVALUATION='+JSON.stringify(forward));
},210_000);
