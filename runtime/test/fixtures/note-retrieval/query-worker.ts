/** Disposable independent-process fixture for memory_query. */
import { mkdirSync, writeFileSync, unlinkSync, symlinkSync, utimesSync, statSync } from 'node:fs';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { assertPathWithinTestFilesystemIsolation, getActiveTestFilesystemIsolationRoot } from '../../../scripts/test-filesystem-isolation.js';
if (!getActiveTestFilesystemIsolationRoot()) throw Error('Isolated test launcher required');
const workspace=process.env.PICLAW_WORKSPACE!,store=process.env.PICLAW_STORE!, scenario=process.argv[2];
for (const p of [workspace,store,process.env.PICLAW_DATA!]) assertPathWithinTestFilesystemIsolation(p);
process.env.PICLAW_DB_IN_MEMORY='0';process.env.PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX='1';
mkdirSync(join(workspace,'notes'),{recursive:true});mkdirSync(join(workspace,'.piclaw'),{recursive:true});
const config=join(workspace,'.piclaw/config.json');
const mode=(value:string)=>writeFileSync(config,JSON.stringify({domains:{access:{mode:value}}}));mode('single-user');
const path=join(workspace,'notes/a.md'),other=join(workspace,'notes/b.md');
const parentScenarios=['rank-context','parent-stale','parent-corrupt','parent-row-change','parent-added-during-read'];
const original=parentScenarios.includes(scenario!)?'\uFEFF# Guide\r\n\r\n## Birch Annex\r\n### Returns\r\nAfter-hours items go through slot C.\r\n\r\n## Cedar Annex\r\n### Returns\r\nAfter-hours items go through slot G.\r\n':scenario==='late-match'?'# Lantern\n'+'filler '.repeat(90)+'cobalt sunrise\n':'\uFEFF# Lantern\r\nRegistry answer: cobalt sunrise.\r\n';
writeFileSync(path,original);writeFileSync(other,'# Lantern\nThe registry contains cobalt, but the answer is elsewhere.\n');
if(scenario==='candidate-budget'||scenario==='file-read-budget') for(let i=0;i<22;i++)writeFileSync(join(workspace,`notes/entry-${i}.md`),`# Entry ${i}\ncobalt candidate ${i}\n`);
if(scenario==='parent-added-during-read')writeFileSync(other,'# Other\nUnrelated bloom entry.\n'+'padding '.repeat(1000));
if(scenario==='anchors'){
 writeFileSync(path,'# Units\nThe unit “Amber Kite” has code AK-12.\n');
 writeFileSync(other,'# Units\nThe unit Amber-Kite has code AK-12B.\n');
}
const {initDatabase,getDb,closeDatabase}=await import('../../../src/db/connection.js');initDatabase();const db=getDb();
const {captureNoteIndexBinding}=await import('../../../src/note-retrieval/access.js');
const worker=spawn(process.execPath,['-e',"const {runNoteIndexPhase}=await import('./src/note-retrieval/coordinator.ts');await runNoteIndexPhase();"],{
 cwd:join(import.meta.dir,'../../..'),env:process.env,stdio:['ignore','ignore','pipe','pipe']});
const done=once(worker,'exit');let errors='';worker.stderr!.on('data',b=>errors+=b);(worker.stdio[3] as any).end(JSON.stringify(captureNoteIndexBinding()));
const [exit]=await done;assert.equal(exit,0,errors);
const row=db.query("SELECT * FROM note_retrieval_chunks WHERE path='notes/a.md'").get() as any;
const {createMemorySearchExtension}=await import('../../../src/extensions/memory-search.js');
const {createFakeExtensionApi}=await import('../../extensions/fake-extension-api.js');
const {withChatContext}=await import('../../../src/core/chat-context.js');
const {withExecutionIdentity}=await import('../../../src/core/execution-context.js');
const {setBackgroundWorkspaceIndexRefreshRequesterForTests}=await import('../../../src/workspace-search.js');
let refreshes=0;setBackgroundWorkspaceIndexRefreshRequesterForTests(()=>{refreshes++;});
let sessionId='query-session';const fake=createFakeExtensionApi({activeTools:['memory_query']});createMemorySearchExtension('web:test')(fake.api);
const ctx:any={cwd:workspace,sessionManager:{getSessionId:()=>sessionId},signal:undefined};
const tool=fake.tools.get('memory_query'),start=fake.handlers.find(h=>h.event==='session_start')!.handler,stop=fake.handlers.find(h=>h.event==='session_shutdown')!.handler;
const run=(params:any={query:'cobalt'},context=ctx,signal?:AbortSignal)=>withChatContext('web:test','web',()=>tool.execute('query',params,signal,undefined,context));
const body=(r:any)=>JSON.parse(r.content[0].text);
const only=(r:any,status:string)=>{assert.deepEqual(body(r),{status});assert.deepEqual(r.details,{status});};
await start({},ctx);
try {
 if(scenario==='roundtrip'){
  const r=await run({query:'sunrise'}),b=body(r);assert.equal(b.status,'ok');assert.equal(b.completeness,'complete');assert.deepEqual(b.reasons,[]);
  assert.equal(b.hits.length,1);assert.equal(b.hits[0].chunk_id,row.chunk_id);assert.equal(b.hits[0].source_revision,row.revision);
  assert.equal(b.hits[0].path,'notes/a.md');assert.deepEqual(b.hits[0].heading_path,['Lantern']);assert.match(b.hits[0].snippet,/answer: cobalt sunrise/);
  fake.setActiveTools(['memory_query','memory_get']);
  const full=body(await withChatContext('web:test','web',()=>fake.tools.get('memory_get').execute('get',{
    chunk_id:b.hits[0].chunk_id,source_revision:b.hits[0].source_revision},undefined,undefined,ctx)));
  assert.equal(full.status,'ok');assert.equal(full.text,original);fake.setActiveTools(['memory_query']);
  assert.deepEqual(fake.api.getActiveTools(),['memory_query']);assert.equal(refreshes,0);
  const no=body(await run({query:'absentunique'}));assert.equal(no.status,'ok');assert.equal(no.hits.length,0);
  const page=body(await run({query:'cobalt',limit:1,offset:1}));assert.equal(page.hits.length,1);
  only(await run({query:'  '}),'invalid_request');only(await run({query:'cobalt',path:'notes/a.md'}),'invalid_request');
  only(await run({query:'cobalt',limit:6}),'invalid_request');only(await run({query:'"broken'}),'invalid_request');
  only(await run({query:'漢'.repeat(400)}),'invalid_request');
 }else if(scenario==='policy'){
  const {saveWorkspaceIndexPolicy}=await import('../../../src/core/workspace-index-policy.js');
  const open={roots:['notes'],ignorePatterns:[]};
  fake.setActiveTools(['memory_query','memory_get']);
  const get=()=>withChatContext('web:test','web',()=>fake.tools.get('memory_get').execute('g',{chunk_id:row.chunk_id,source_revision:row.revision},undefined,undefined,ctx));
  assert.equal(body(await get()).status,'ok');
  saveWorkspaceIndexPolicy({roots:['notes'],ignorePatterns:['notes/a.md']});
  only(await get(),'not_found');assert.ok(body(await run()).hits.every((h:any)=>h.path!=='notes/a.md'));
  saveWorkspaceIndexPolicy(open);
  // Policy changes after a source open invalidate the whole in-flight answer.
  const originalOpen=fs.open;let opened=0,closed=0;
  fs.open=(async(...args:any[])=>{const handle=await (originalOpen as any)(...args);if(String(args[0])===path){opened++;const close=handle.close.bind(handle);handle.close=async()=>{closed++;return close();};saveWorkspaceIndexPolicy({roots:['notes'],ignorePatterns:['notes/a.md']});}return handle;}) as typeof fs.open;
  try{only(await get(),'index_unavailable');}finally{fs.open=originalOpen;}
  assert.equal(opened,1);assert.equal(closed,1);
  saveWorkspaceIndexPolicy(open);opened=0;closed=0;
  fs.open=(async(...args:any[])=>{const handle=await (originalOpen as any)(...args);if(String(args[0])===path){opened++;const close=handle.close.bind(handle);handle.close=async()=>{closed++;return close();};saveWorkspaceIndexPolicy({roots:[],ignorePatterns:[]});}return handle;}) as typeof fs.open;
  try{only(await run({query:'sunrise'}),'index_unavailable');}finally{fs.open=originalOpen;}
  assert.equal(opened,1);assert.equal(closed,1);
  saveWorkspaceIndexPolicy({roots:['notes'],ignorePatterns:['notes/a.md']});
  const refresh=spawn(process.execPath,['-e',"const {runNoteIndexPhase}=await import('./src/note-retrieval/coordinator.ts');await runNoteIndexPhase();"],{cwd:join(import.meta.dir,'../../..'),env:process.env,stdio:['ignore','ignore','pipe','pipe']});
  const end=once(refresh,'exit');let err='';refresh.stderr!.on('data',b=>err+=b);(refresh.stdio[3] as any).end(JSON.stringify(captureNoteIndexBinding()));assert.equal((await end)[0],0,err);
  assert.equal(db.query("SELECT count(*) n FROM note_retrieval_chunks WHERE path='notes/a.md'").get().n,0);
  only(await get(),'not_found');
 }else if(scenario==='rank-context'){
  const r=body(await run({query:'Birch Annex Returns after-hours storage slot',limit:1}));
  assert.equal(r.status,'ok');assert.equal(r.hits.length,1);
  const hit=r.hits[0];assert.match(hit.snippet,/slot C/);assert.ok(!hit.snippet.includes('slot G'));
  assert.equal(hit.context.length,2);assert.equal(hit.context[1].text,'## Birch Annex\r\n');
  assert.ok(hit.signals.heading_terms>=3);assert.equal(hit.context[1].after_last_byte,hit.first_byte);
  assert.notEqual(hit.context[1].chunk_id,hit.chunk_id);
  fake.setActiveTools(['memory_query','memory_get']);
  for(const ref of [...hit.context,hit]){
    const got=body(await withChatContext('web:test','web',()=>fake.tools.get('memory_get').execute('g',{chunk_id:ref.chunk_id,source_revision:ref.source_revision},undefined,undefined,ctx)));
    assert.equal(got.status,'ok');assert.equal(got.path,ref.path);
    if(ref.text)assert.equal(got.text,ref.text);else assert.ok(got.text.includes(ref.snippet));
  }
 }else if(scenario==='parent-stale'){
  writeFileSync(path,original.replace('Birch','Larch'));
  const r=body(await run({query:'"Birch Annex" Returns'}));assert.equal(r.status,'partial');assert.equal(r.hits.length,0);assert.ok(r.reasons.includes('source_stale'));
 }else if(scenario==='parent-corrupt'){
  db.query("UPDATE note_retrieval_chunks SET content='fabricated' WHERE heading=?").run(JSON.stringify(['Guide','Birch Annex']));
  only(await run({query:'content : "slot C"'}),'index_unavailable');
 }else if(scenario==='parent-added-during-read'){
  const open=fs.open;let inserted=false;const opened:string[]=[];
  fs.open=(async(...args:any[])=>{
   const handle=await(open as any)(...args);opened.push(String(args[0]));
   // Second source await occurs after the first source's parent lookup.
   if(String(args[0])===other){
    inserted=true;
    db.query(`INSERT INTO note_retrieval_chunks(generation,path,chunk_id,revision,chunker,first_byte,after_last_byte,line_start,line_end,heading,kind,content)
      SELECT generation,path,?,revision,chunker,first_byte,after_last_byte,line_start,line_end,heading,kind,content FROM note_retrieval_chunks WHERE path='notes/a.md' AND heading=?`)
      .run('nr1:'+'f'.repeat(64),JSON.stringify(['Guide','Birch Annex']));
   }
   return handle;
  }) as typeof fs.open;
  try{only(await run({query:'content : "slot C" OR bloom'}),'index_unavailable');assert.equal(inserted,true);assert.deepEqual(opened,[path,other]);}finally{fs.open=open;}
 }else if(scenario==='anchors'){
  const a=body(await run({query:'"Amber Kite" unknown catalogue',limit:5}));assert.equal(a.status,'ok');assert.equal(a.hits.length,1);assert.equal(a.hits[0].path,'notes/a.md');
  const b=body(await run({query:'AK-12 extra words'}));assert.equal(b.hits.length,1);assert.equal(b.hits[0].path,'notes/a.md');
  const explicit=body(await run({query:'"Amber Kite" AND unknown'}));assert.equal(explicit.hits.length,0);
 }else if(scenario==='admission'){

  let touched=false;const selector=new Proxy({}, {get(){touched=true;throw Error('accessed');},ownKeys(){touched=true;throw Error('accessed');}});
  const family:any=Object.freeze({mode:'family-shared',provenance:Object.freeze({})});
  only(await withExecutionIdentity(family,()=>run(selector)),'access_denied');fake.setActiveTools([]);only(await run(selector),'access_denied');fake.setActiveTools(['memory_query']);
  only(await tool.execute('query',selector,undefined,undefined,ctx),'access_denied');sessionId='other';only(await run(selector),'access_denied');
  sessionId='query-session';await stop();only(await run(selector),'access_denied');assert.equal(touched,false);
 }else if(scenario==='stale'){
  const stat=statSync(path);writeFileSync(path,original.replace('cobalt','violet'));utimesSync(path,stat.atime,stat.mtime);
  const r=body(await run({query:'sunrise'}));assert.equal(r.status,'partial');assert.deepEqual(r.reasons,['source_stale']);assert.equal(r.hits.length,0);
  assert.ok(db.query("SELECT path FROM note_retrieval_dirty WHERE path='notes/a.md'").get());assert.equal(refreshes,1);
 }else if(scenario==='mixed'){
  writeFileSync(path,original.replace('sunrise','moonset'));
  const r=body(await run({query:'cobalt'}));assert.equal(r.status,'partial');assert.ok(r.reasons.includes('source_stale'));
  assert.equal(r.hits.length,1);assert.equal(r.hits[0].path,'notes/b.md');assert.equal(refreshes,1);
 }else if(scenario==='deleted'){
  unlinkSync(path);const r=body(await run({query:'sunrise'}));assert.equal(r.status,'partial');assert.ok(r.reasons.includes('source_stale'));assert.equal(r.hits.length,0);
 }else if(scenario==='links'){
  unlinkSync(path);symlinkSync(other,path);const r=body(await run({query:'sunrise'}));assert.equal(r.status,'partial');assert.ok(r.reasons.includes('source_stale'));assert.equal(r.hits.length,0);
 }else if(scenario==='dirty'){
  const {markNoteIndexDirty}=await import('../../../src/note-retrieval/coordinator.js');await markNoteIndexDirty(['notes/unrelated.md']);
  const r=body(await run({query:'sunrise'}));assert.equal(r.status,'partial');assert.ok(r.reasons.includes('refresh_pending'));assert.equal(r.hits.length,1);
 }else if(scenario==='overdue'){
  db.query('UPDATE note_retrieval_state SET last_complete=?').run(Date.now()-301000);
  const r=body(await run({query:'absentunique'}));assert.equal(r.status,'partial');assert.deepEqual(r.reasons,['refresh_pending']);assert.equal(r.hits.length,0);assert.equal(refreshes,1);
 }else if(scenario==='late-match'){
  const r=body(await run({query:'sunrise'}));assert.equal(r.status,'ok');assert.equal(r.hits.length,1);assert.match(r.hits[0].snippet,/cobalt sunrise/);
 }else if(scenario==='file-read-budget'){
  const open=fs.open;let opens=0;
  fs.open=(async(...args:any[])=>{opens++;return(open as any)(...args);}) as typeof fs.open;
  try{const r=body(await run({query:'cobalt'}));assert.equal(r.status,'partial');assert.ok(r.reasons.includes('validation_budget'));assert.equal(opens,16);assert.ok(r.hits.length<=5);}finally{fs.open=open;}
 }else if(scenario==='candidate-budget'){
  const r=body(await run({query:'cobalt'}));assert.equal(r.status,'partial');assert.ok(r.reasons.includes('validation_budget'));
  assert.equal(r.hits.length,5);assert.equal(refreshes,0);
 }else if(scenario==='output-bound'){
  db.query('UPDATE note_retrieval_chunks SET heading=?').run(JSON.stringify(['x'.repeat(12000)]));
  const r=await run({query:'cobalt'}),b=body(r);assert.equal(b.status,'partial');assert.ok(b.reasons.includes('validation_budget'));
  assert.ok(Buffer.byteLength(JSON.stringify(r))<=16*1024);
 }else if(scenario==='corrupt'){
  db.query("UPDATE note_retrieval_chunks SET content='fabricated' WHERE path='notes/a.md'").run();only(await run({query:'sunrise'}),'index_unavailable');
 }else if(scenario==='ghost'){
  db.query('INSERT INTO note_retrieval_fts(content,heading,path,generation,chunk_id) VALUES(?,?,?,?,?)').run('ghostneedle','[]','notes/a.md',1,'nr1:'+'e'.repeat(64));
  only(await run({query:'ghostneedle'}),'index_unavailable');
 }else if(scenario==='unavailable'){
  db.query("UPDATE note_retrieval_state SET format='other'").run();only(await run(),'index_unavailable');
 }else if(scenario==='cancelled'){
  const c=new AbortController();c.abort();only(await run({query:'cobalt'},ctx,c.signal),'cancelled');
 }else if(scenario==='transaction'){
  db.exec('BEGIN');try{only(await run(),'index_unavailable');}finally{db.exec('ROLLBACK');}
 }else if(['revoke-grant','replace-session','change-generation','change-coverage','scope-dirty','row-change','parent-row-change','publish-prune','cancel-during-read','mode-change'].includes(scenario!)){
  const open=fs.open,c=new AbortController();let hooked=false,closed=false;
  fs.open=(async(...args:any[])=>{const handle=await (open as any)(...args);if(!hooked){hooked=true;
    const close=handle.close.bind(handle);handle.close=async()=>{closed=true;return close();};
    if(scenario==='revoke-grant')fake.setActiveTools([]);
    if(scenario==='replace-session')sessionId='other';
    if(scenario==='change-generation')db.query('UPDATE note_retrieval_state SET published=published+1').run();
    if(scenario==='parent-row-change')db.query("UPDATE note_retrieval_chunks SET content='corrupt parent' WHERE heading=?").run(JSON.stringify(['Guide','Birch Annex']));
    if(scenario==='publish-prune')db.transaction(()=>{db.exec('DELETE FROM note_retrieval_chunks; DELETE FROM note_retrieval_fts; UPDATE note_retrieval_state SET published=published+1,coverage=coverage+1');})();
    if(scenario==='change-coverage')db.query('UPDATE note_retrieval_state SET coverage=coverage+1').run();
    if(scenario==='scope-dirty')db.query("INSERT INTO note_retrieval_dirty VALUES('notes/unrelated.md',1,'refresh_pending')").run();
    if(scenario==='row-change')db.query("UPDATE note_retrieval_chunks SET heading='[\"Altered\"]' WHERE path='notes/a.md'").run();
    if(scenario==='cancel-during-read')c.abort();
    if(scenario==='mode-change')mode('family-shared');
  }return handle;}) as typeof fs.open;
  try{const r=await run({query:scenario==='parent-row-change'?'content : "slot C"':'sunrise'},ctx,c.signal);if(['revoke-grant','replace-session','mode-change'].includes(scenario!))only(r,'access_denied');
    else if(scenario==='cancel-during-read')only(r,'cancelled');
    else if(scenario==='row-change'||scenario==='parent-row-change')only(r,'index_unavailable');
    else {const b=body(r);assert.equal(b.status,'partial');assert.deepEqual(b.reasons,['refresh_pending']);assert.equal(b.hits.length,0);}
    assert.equal(hooked,true);assert.equal(closed,true);
  }finally{fs.open=open;}
 }else throw Error('Unknown scenario');
 console.log('MEMORY_QUERY_OK='+scenario);
}finally{closeDatabase();}
