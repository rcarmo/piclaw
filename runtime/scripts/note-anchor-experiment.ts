/** Run with bun run test:local -- bun runtime/scripts/note-anchor-experiment.ts. */
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getActiveTestFilesystemIsolationRoot } from './test-filesystem-isolation.js';
import { anchorFingerprint, verifyAnchorFreeze } from '../test/fixtures/note-retrieval/anchor-fingerprint.js';
const root=getActiveTestFilesystemIsolationRoot();
if(!root)throw Error('Requires isolated local test launcher');
const args=process.argv.slice(2);
if(args.some(arg=>!['--held-out','--small','--original'].includes(arg)))throw Error('Only --held-out, --small and --original');
const split=args.includes('--held-out')?'held-out':'development',dataset=args.includes('--original')?'original':'hard';
const fixture=join(import.meta.dir,'../test/fixtures/note-retrieval');
const fingerprint=anchorFingerprint(join(import.meta.dir,'../..'));
if(split==='held-out')verifyAnchorFreeze(fingerprint,JSON.parse(readFileSync(join(fixture,'anchor-freeze.json'),'utf8')).fingerprint);
const reports:any[]=[];
for(const scale of args.includes('--small')?[0]:[0,500])for(const direction of ['forward','reverse']){
  const workspace=mkdtempSync(join(root,'anchor-experiment-'));
  for(const mode of ['build','reopen']){
    const child=Bun.spawn([process.execPath,join(fixture,'anchor-worker.ts'),mode,split,String(scale),direction,dataset],{
      env:{...process.env,PICLAW_WORKSPACE:workspace,PICLAW_STORE:join(workspace,'.piclaw/store'),PICLAW_DATA:join(workspace,'.piclaw/data'),PICLAW_DB_IN_MEMORY:'0',PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX:'1'},stdout:'pipe',stderr:'pipe'});
    const timer=setTimeout(()=>child.kill(),120_000);
    try{
      const[out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
      if(code!==0)throw Error(`Anchor worker failed ${code}: ${err.slice(-4000)}`);
      const line=out.split('\n').find(line=>line.startsWith('ANCHOR_REPORT='));
      if(!line)throw Error('Missing report');reports.push(JSON.parse(line.slice('ANCHOR_REPORT='.length)));
    }finally{clearTimeout(timer);}
  }
}
for(const scale of [...new Set(reports.map(r=>r.scale))]){
  const runs=reports.filter(r=>r.scale===scale),payload=(r:any)=>JSON.stringify(r.results.map((q:any)=>[q.variant,q.id,q.payload]));
  if(runs.some(r=>payload(r)!==payload(runs[0])||r.results.some((q:any)=>!q.stable)))throw Error('Payload changed across repeat/reopen/reversed rebuild');
}
console.log(JSON.stringify({schema:2,dataset,split,fingerprint,stable:true,limitations:[
  'Exact evidence coverage, not LLM answer accuracy or probability.',
  'Small synthetic independent fixture authorship; not real-world calibration.',
  'Lexical anchors/proximity cannot reliably reject all-keyword negated or missing facts.',
  'No production search/tool/index changes; existing budgets remain unapproved.'
],reports},null,2));
