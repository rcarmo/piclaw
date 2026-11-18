/** Disposable process fixture for memory_get. Never accepts a workspace argument. */
import { mkdirSync, writeFileSync, renameSync, unlinkSync, symlinkSync, linkSync, utimesSync, statSync } from 'node:fs';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { assertPathWithinTestFilesystemIsolation, getActiveTestFilesystemIsolationRoot } from '../../../scripts/test-filesystem-isolation.js';

if (!getActiveTestFilesystemIsolationRoot()) throw Error('Isolated test launcher required');
const workspace = process.env.PICLAW_WORKSPACE!, store = process.env.PICLAW_STORE!;
const scenario=process.argv[2];
for (const p of [workspace, store, process.env.PICLAW_DATA!]) assertPathWithinTestFilesystemIsolation(p);
process.env.PICLAW_DB_IN_MEMORY = '0'; process.env.PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX = '1';
mkdirSync(join(workspace,'notes'),{recursive:true}); mkdirSync(join(workspace,'.piclaw'),{recursive:true});
const config = join(workspace,'.piclaw/config.json');
const configure = (mode: string) => writeFileSync(config, JSON.stringify({domains:{access:{mode}}}));
configure('single-user');
const original = scenario === 'oversized-output' ? '# Entry\n' + '\t'.repeat(15_000) + '\n' : '\uFEFF# Entry\r\nCafé 😀\r\n';
const path = join(workspace,'notes/a.md'); writeFileSync(path, original);
const { initDatabase, getDb, closeDatabase } = await import('../../../src/db/connection.js');
initDatabase(); const db = getDb();
const { captureNoteIndexBinding } = await import('../../../src/note-retrieval/access.js');
const binding = captureNoteIndexBinding();
const worker = spawn(process.execPath,['-e',"const {runNoteIndexPhase}=await import('./src/note-retrieval/coordinator.ts');await runNoteIndexPhase();"],{
 cwd:join(import.meta.dir,'../../..'),env:process.env,stdio:['ignore','ignore','pipe','pipe'] });
const done = once(worker,'exit'); let errors='';worker.stderr!.on('data', b => errors+=b);(worker.stdio[3] as any).end(JSON.stringify(binding));
const [exit] = await done; assert.equal(exit,0,errors);
const row = db.query('SELECT * FROM note_retrieval_chunks').get() as any;
const params = {chunk_id:row.chunk_id,source_revision:row.revision};
const { createMemorySearchExtension } = await import('../../../src/extensions/memory-search.js');
const { createFakeExtensionApi } = await import('../../extensions/fake-extension-api.js');
const { withChatContext } = await import('../../../src/core/chat-context.js');
const { withExecutionIdentity } = await import('../../../src/core/execution-context.js');
const { setBackgroundWorkspaceIndexRefreshRequesterForTests } = await import('../../../src/workspace-search.js');
let refreshes=0;setBackgroundWorkspaceIndexRefreshRequesterForTests(()=>{refreshes++;});
let sessionId='fixture-session';
const fake=createFakeExtensionApi({activeTools:['memory_get']});createMemorySearchExtension('web:test')(fake.api);
const ctx:any={cwd:workspace,sessionManager:{getSessionId:()=>sessionId},signal:undefined};
const tool=fake.tools.get('memory_get');
const start=fake.handlers.find(h=>h.event==='session_start')!.handler;
const stop=fake.handlers.find(h=>h.event==='session_shutdown')!.handler;
const run=(request:any=params,context=ctx,signal?:AbortSignal)=>withChatContext('web:test','web',()=>tool.execute('fixture',request,signal,undefined,context));
const status=(r:any)=>JSON.parse(r.content[0].text).status;
const only=(r:any,s:string)=>{assert.deepEqual(JSON.parse(r.content[0].text),{status:s});assert.deepEqual(r.details,{status:s});};
await start({},ctx);
try {
 if(scenario==='roundtrip'){
  const r=await run(),content=JSON.parse(r.content[0].text);assert.equal(content.status,'ok');assert.equal(content.text,original);assert.equal(content.source_revision,row.revision);assert.equal(content.chunk_id,row.chunk_id);assert.equal(content.line_start,1);assert.equal(content.line_end,2);assert.equal(content.path,'notes/a.md');assert.equal(refreshes,0);
  assert.ok(Buffer.byteLength(JSON.stringify(r))<=32768);assert.deepEqual(fake.api.getActiveTools(),['memory_get']);
  only(await run({...params,chunk_id:'nr1:'+'a'.repeat(64)}),'not_found');
  only(await run({...params,source_revision:'b'.repeat(64)}),'not_found');
  only(await run({...params,path:'notes/a.md'}),'invalid_request');
  only(await run({chunk_id:'../secret',source_revision:row.revision}),'invalid_request');
 } else if(scenario==='admission'){
  let touched=false;const selector=new Proxy({}, {get(){touched=true;throw Error('selector touched');},ownKeys(){touched=true;throw Error('selector touched');}});
  const family:any=Object.freeze({mode:'family-shared',provenance:Object.freeze({})});
  only(await withExecutionIdentity(family,()=>run(selector)),'access_denied');assert.equal(touched,false);
  fake.setActiveTools([]);only(await run(selector),'access_denied');assert.equal(touched,false);fake.setActiveTools(['memory_get']);
  only(await tool.execute('fixture',selector,undefined,undefined,ctx),'access_denied');assert.equal(touched,false);
  only(await withChatContext('web:test','web',()=>tool.execute('fixture',selector,undefined,undefined,undefined)),'access_denied');assert.equal(touched,false);
  sessionId='replacement';only(await run(selector),'access_denied');sessionId='fixture-session';
  await stop();only(await run(selector),'access_denied');assert.equal(touched,false);
 } else if(scenario==='same-metadata'){
  const stat=statSync(path);writeFileSync(path,original.replace('Café','Noël'));utimesSync(path,stat.atime,stat.mtime);
  assert.equal(statSync(path).size,stat.size);only(await run(),'source_stale');assert.equal(refreshes,1);
  assert.ok(db.query("SELECT path FROM note_retrieval_dirty WHERE path='notes/a.md'").get());
 } else if(scenario==='links'){
  unlinkSync(path);writeFileSync(join(workspace,'other.md'),original);symlinkSync(join(workspace,'other.md'),path);only(await run(),'source_stale');
  unlinkSync(path);linkSync(join(workspace,'other.md'),path);only(await run(),'source_stale');
 } else if(scenario==='deleted'){
  unlinkSync(path);only(await run(),'source_stale');assert.equal(refreshes,1);
 } else if(scenario==='corrupt'){
  db.query("UPDATE note_retrieval_chunks SET content='fabricated'").run();only(await run(),'index_unavailable');
  db.query('UPDATE note_retrieval_chunks SET content=?,line_start=8').run(row.content);only(await run(),'index_unavailable');
  db.query("UPDATE note_retrieval_chunks SET line_start=1,path='notes/users/private.md'").run();only(await run(),'index_unavailable');
 } else if(scenario==='unavailable'){
  db.query("UPDATE note_retrieval_state SET format='other'").run();only(await run(),'index_unavailable');
  db.query("UPDATE note_retrieval_state SET format='nr1',published=NULL").run();only(await run(),'index_unavailable');
  db.exec('DROP TABLE note_retrieval_state');only(await run(),'index_unavailable');
 } else if(scenario==='cancelled'){
  const c=new AbortController();c.abort();only(await run(params,ctx,c.signal),'cancelled');
 } else if(scenario==='transaction'){
  db.exec('BEGIN');try{only(await run(),'index_unavailable');}finally{db.exec('ROLLBACK');}
 } else if(scenario==='oversized-output'){
  // Large escaped source text plus bounded metadata exceeds the full response ceiling.
  db.query('UPDATE note_retrieval_chunks SET heading=?').run(JSON.stringify(['x'.repeat(16300)]));
  const r=await run();only(r,'limit_exceeded');assert.ok(Buffer.byteLength(JSON.stringify(r))<=32768);
 } else if(['revoke-grant','replace-session','change-namespace','change-generation','change-coverage','dirty-during-read','replace-database','mode-change','cancel-during-read'].includes(scenario!)){
  const open=fs.open;const c=new AbortController();let hooked=false,closed=false;
  fs.open=(async(...args:any[])=>{const handle=await (open as any)(...args);if(!hooked){hooked=true;
   const close=handle.close.bind(handle);handle.close=async()=>{closed=true;return close();};
   if(scenario==='revoke-grant')fake.setActiveTools([]);
   if(scenario==='replace-session')sessionId='other';
   if(scenario==='change-namespace')db.query("UPDATE note_retrieval_state SET namespace='other'").run();
   if(scenario==='change-generation')db.query('UPDATE note_retrieval_state SET published=published+1').run();
   if(scenario==='change-coverage')db.query('UPDATE note_retrieval_state SET coverage=coverage+1').run();
   if(scenario==='dirty-during-read')db.query("INSERT INTO note_retrieval_dirty VALUES('notes/a.md',1,'refresh_pending')").run();
   if(scenario==='replace-database'){renameSync(join(store,'messages.db'),join(store,'original.db'));writeFileSync(join(store,'messages.db'),'');}
   if(scenario==='mode-change')configure('family-shared');
   if(scenario==='cancel-during-read')c.abort();
  }return handle;}) as typeof fs.open;
  try{const r=await run(params,ctx,c.signal);only(r,scenario==='cancel-during-read'?'cancelled':scenario==='dirty-during-read'?'source_stale':['change-namespace','change-generation','change-coverage'].includes(scenario!)?'index_unavailable':'access_denied');assert.equal(hooked,true);assert.equal(closed,true);}finally{fs.open=open;}
 } else throw Error('Unknown scenario');
 console.log('MEMORY_GET_OK='+scenario);
} finally {closeDatabase();}
