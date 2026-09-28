/** Offline current-tool evidence probe; all corpus inputs are frozen synthetic fixtures. */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { assertPathWithinTestFilesystemIsolation, getActiveTestFilesystemIsolationRoot } from '../../../scripts/test-filesystem-isolation.js';
if (!getActiveTestFilesystemIsolationRoot()) throw Error('Isolated test launcher required');
const workspace=process.env.PICLAW_WORKSPACE!,store=process.env.PICLAW_STORE!;
for (const p of [workspace,store,process.env.PICLAW_DATA!]) assertPathWithinTestFilesystemIsolation(p);
process.env.PICLAW_DB_IN_MEMORY='0';process.env.PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX='1';
const frozen=join(import.meta.dir,'hard-v2');
const manifest=JSON.parse(readFileSync(join(frozen,'manifest.json'),'utf8'));
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
for (const [file,expected] of Object.entries({ 'development.json':manifest.files['development.json'], 'held-out.json':manifest.files['held-out.json'], ...manifest.files.notes } as Record<string,string>)) {
 const actual=hash(readFileSync(join(frozen,file)));
 if(actual!==expected)throw Error(`Frozen corpus changed: ${file}`);
}
mkdirSync(join(workspace,'.piclaw'),{recursive:true});
writeFileSync(join(workspace,'.piclaw/config.json'),JSON.stringify({domains:{access:{mode:'single-user'}}}));
cpSync(join(frozen,'notes'),join(workspace,'notes'),{recursive:true});
const {initDatabase,closeDatabase}=await import('../../../src/db/connection.js');initDatabase();
const {captureNoteIndexBinding}=await import('../../../src/note-retrieval/access.js');
const worker=spawn(process.execPath,['-e',"const {runNoteIndexPhase}=await import('./src/note-retrieval/coordinator.ts');await runNoteIndexPhase();"],{
 cwd:join(import.meta.dir,'../../..'),env:process.env,stdio:['ignore','ignore','pipe','pipe']});
const done=once(worker,'exit');let errors='';worker.stderr!.on('data',b=>errors+=b);(worker.stdio[3] as any).end(JSON.stringify(captureNoteIndexBinding()));
const [exit]=await done;if(exit!==0)throw Error(errors);
const {createMemorySearchExtension}=await import('../../../src/extensions/memory-search.js');
const {createFakeExtensionApi}=await import('../../extensions/fake-extension-api.js');
const {withChatContext}=await import('../../../src/core/chat-context.js');
const {expandNoteQuery}=await import('./query-rewrite.js');
const fake=createFakeExtensionApi({activeTools:['memory_query','memory_get']});createMemorySearchExtension('web:coverage')(fake.api);
const ctx:any={cwd:workspace,sessionManager:{getSessionId:()=> 'coverage-session'}};
await fake.handlers.find(h=>h.event==='session_start')!.handler({},ctx);
const queryTool=fake.tools.get('memory_query'),getTool=fake.tools.get('memory_get');
const summary:any[]=[];
for(const split of ['development','held-out']){
 const data=JSON.parse(readFileSync(join(frozen,`${split}.json`),'utf8')) as { queries: Array<{id:string;query:string;relevant:Array<{path:string;quote:string}>,conflictingPaths?:string[]}> };
 for(const item of data.queries){
   const started=performance.now();
   const variant=process.argv[2];
   const query=variant==='current'||variant==='candidate'?item.query:expandNoteQuery(item.query,variant as 'expanded'|'anchored'|'anchored-two'|'ranked'|'head')??item.query;
   const response=await withChatContext('web:coverage','web',()=>queryTool.execute('q',{query,limit:5,...(variant==='candidate'?{mode:'candidate'}:{})},undefined,undefined,ctx));
   const result=JSON.parse(response.content[0].text);
   const candidates=result.hits??[];
   const units=[...new Set([...item.query.replace(/[“”]/g,'"').matchAll(/"([^"\n]+)"|([\p{L}\p{N}_]+(?:[-./][\p{L}\p{N}_]+)*)/gu)].map(m=>(m[1]??m[2]!).toLocaleLowerCase('und')))]
     .filter(unit=>!new Set('a an and or the is are at of for to in on what when where how which with does do should'.split(' ')).has(unit));
   const scored=candidates.map((hit:any)=>{
     const haystack=`${hit.path}\n${hit.heading_path.join(' / ')}\n${hit.snippet}`.toLocaleLowerCase('und');
     const count=units.filter(unit=>haystack.includes(unit)).length;
     return {hit,count,coverage:units.length?count/units.length:0};
   });
   const hits=variant==='ranked' ? scored.filter((entry:any)=>entry.coverage>=.6)
     .sort((a:any,b:any)=>b.coverage-a.coverage||b.count-a.count||a.hit.rank-b.hit.rank||a.hit.path.localeCompare(b.hit.path))
     .map((entry:any)=>entry.hit):candidates;
   const covers=item.relevant.map(ref=>hits.some((hit:any)=>hit.path===ref.path && hit.snippet.includes(ref.quote)));
   const chunks: Array<{path:string;text:string}> = [];
   for(const hit of hits){
     const full=await withChatContext('web:coverage','web',()=>getTool.execute('g',{chunk_id:hit.chunk_id,source_revision:hit.source_revision},undefined,undefined,ctx));
     const got=JSON.parse(full.content[0].text);
     if(got.status!=='ok'||got.path!==hit.path||!got.text.includes(hit.snippet))throw Error(`Broken reference: ${item.id}`);
     chunks.push({path:got.path,text:got.text});
   }
   const chunkCoverage=item.relevant.length>0 && item.relevant.every(ref=>chunks.some(chunk=>chunk.path===ref.path && chunk.text.includes(ref.quote)));
   summary.push({split,id:item.id,query,answerable:item.relevant.length>0,snippetCoverage:item.relevant.length>0&&covers.every(Boolean),chunkCoverage,
     hits:hits.length,status:result.status,reasons:result.reasons??[],conflictingHits:hits.filter((hit:any)=>(item.conflictingPaths??[]).includes(hit.path)).length,
     bytes:Buffer.byteLength(JSON.stringify(response)),elapsedMs:Math.round(performance.now()-started)});
 }
}
console.log('CURRENT_TOOL_REPORT='+JSON.stringify(summary));closeDatabase();
