/** Offline current-tool evidence probe; all corpus inputs are frozen synthetic fixtures. */
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { assertPathWithinTestFilesystemIsolation, getActiveTestFilesystemIsolationRoot } from '../../../scripts/test-filesystem-isolation.js';
if (!getActiveTestFilesystemIsolationRoot()) throw Error('Isolated test launcher required');
const workspace=process.env.PICLAW_WORKSPACE!,store=process.env.PICLAW_STORE!;
const direction=process.argv[2]??'forward';
if(!['forward','reverse'].includes(direction))throw Error('Unknown evaluation direction');
for (const p of [workspace,store,process.env.PICLAW_DATA!]) assertPathWithinTestFilesystemIsolation(p);
process.env.PICLAW_DB_IN_MEMORY='0';process.env.PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX='1';
const frozen=join(import.meta.dir,'independent-v3');
const manifest=JSON.parse(readFileSync(join(frozen,'manifest.json'),'utf8'));
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
for (const [file,expected] of Object.entries({ 'evaluation.json':manifest.files['evaluation.json'], 'policy.json':manifest.files['policy.json'], ...manifest.files.notes } as Record<string,string>)) {
 const actual=hash(readFileSync(join(frozen,file)));
 if(actual!==expected)throw Error(`Frozen corpus changed: ${file}`);
}
mkdirSync(join(workspace,'.piclaw'),{recursive:true});
mkdirSync(join(workspace,'notes'),{recursive:true});
writeFileSync(join(workspace,'.piclaw/config.json'),JSON.stringify({domains:{access:{mode:'single-user'}}}));
const names=readdirSync(join(frozen,'notes')).sort();
for(const name of direction==='reverse'?[...names].reverse():names){
 writeFileSync(join(workspace,'notes',name),readFileSync(join(frozen,'notes',name)));
}
const {initDatabase,closeDatabase}=await import('../../../src/db/connection.js');initDatabase();
const {captureNoteIndexBinding}=await import('../../../src/note-retrieval/access.js');
const worker=spawn(process.execPath,['-e',"const {runNoteIndexPhase}=await import('./src/note-retrieval/coordinator.ts');await runNoteIndexPhase();"],{
 cwd:join(import.meta.dir,'../../..'),env:process.env,stdio:['ignore','ignore','pipe','pipe']});
const done=once(worker,'exit');let errors='';worker.stderr!.on('data',b=>errors+=b);(worker.stdio[3] as any).end(JSON.stringify(captureNoteIndexBinding()));
const [exit]=await done;if(exit!==0)throw Error(errors);
// A fresh independent SQLite connection verifies the completed publication,
// rather than reusing any writer-side in-memory row state.
const reader=new Database(join(store,'messages.db'),{readonly:true});
const publication=reader.query('SELECT published,namespace FROM note_retrieval_state WHERE id=1').get() as {published:number;namespace:string};
if(!publication.published||!publication.namespace)throw Error('Missing committed publication');
reader.close();
const {createMemorySearchExtension}=await import('../../../src/extensions/memory-search.js');
const {createFakeExtensionApi}=await import('../../extensions/fake-extension-api.js');
const {withChatContext}=await import('../../../src/core/chat-context.js');
const fake=createFakeExtensionApi({activeTools:['memory_query','memory_get']});createMemorySearchExtension('web:coverage')(fake.api);
const ctx:any={cwd:workspace,sessionManager:{getSessionId:()=> 'coverage-session'}};
await fake.handlers.find(h=>h.event==='session_start')!.handler({},ctx);
const queryTool=fake.tools.get('memory_query'),getTool=fake.tools.get('memory_get');
const policy=JSON.parse(readFileSync(join(frozen,'policy.json'),'utf8'));
const data=JSON.parse(readFileSync(join(frozen,'evaluation.json'),'utf8')) as { queries: Array<{id:string;query:string;relevant:Array<{path:string;lineStart:number;lineEnd:number;quote:string}>,conflictingPaths?:string[]}> };
const ids=new Set<string>();
for(const item of data.queries){
 if(ids.has(item.id))throw Error(`Duplicate query: ${item.id}`);ids.add(item.id);
 for(const ref of item.relevant){
  if(!Object.hasOwn(manifest.files.notes,ref.path))throw Error(`Unlisted source: ${ref.path}`);
  const text=readFileSync(join(frozen,ref.path),'utf8').split(/\r?\n/).slice(ref.lineStart-1,ref.lineEnd).join('\n');
  if(text!==ref.quote)throw Error(`Label mismatch: ${item.id}`);
 }
}
const summary:any[]=[];
for(const variant of policy.variants as string[]){
 for(const item of data.queries){
   const started=performance.now();
   const query=item.query;
   const response=await withChatContext('web:coverage','web',()=>queryTool.execute('q',{query,limit:5,...(variant==='candidate'?{mode:'candidate'}:{})},undefined,undefined,ctx));
   const result=JSON.parse(response.content[0].text);
   const hits=result.hits??[];
   const covers=item.relevant.map(ref=>hits.some((hit:any)=>hit.path===ref.path && hit.snippet.includes(ref.quote)));
   const chunks: Array<{path:string;text:string}> = [];
   for(const hit of hits){
     const full=await withChatContext('web:coverage','web',()=>getTool.execute('g',{chunk_id:hit.chunk_id,source_revision:hit.source_revision},undefined,undefined,ctx));
     const got=JSON.parse(full.content[0].text);
     if(got.status!=='ok'||got.path!==hit.path||!got.text.includes(hit.snippet))throw Error(`Broken reference: ${item.id}`);
     chunks.push({path:got.path,text:got.text});
   }
   const chunkCoverage=item.relevant.length>0 && item.relevant.every(ref=>chunks.some(chunk=>chunk.path===ref.path && chunk.text.includes(ref.quote)));
   summary.push({variant,id:item.id,query,answerable:item.relevant.length>0,snippetCoverage:item.relevant.length>0&&covers.every(Boolean),chunkCoverage,
     hits:hits.length,status:result.status,reasons:result.reasons??[],conflictingHits:hits.filter((hit:any)=>(item.conflictingPaths??[]).includes(hit.path)).length,
     bytes:Buffer.byteLength(JSON.stringify(response)),elapsedMs:Math.round(performance.now()-started)});
 }
}
console.log('INDEPENDENT_REPORT='+JSON.stringify({direction,policy,summary}));closeDatabase();
