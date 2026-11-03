import '../setup-filesystem-isolation.js';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { initDatabase, getDb, closeDatabase } from '../../src/db/connection.js';
import { processTaskCommand } from '../../src/ipc.js';
import { AgentBranchManager } from '../../src/agent-pool/branch-manager.js';
import { WorkspaceFileService } from '../../src/channels/web/workspace/file-service.js';
import { fetchLinkPreview } from '../../src/channels/web/media/link-previews.js';
import { getTaskById } from '../../src/db.js';

initDatabase(); const db = getDb();
const file = (db.query('PRAGMA database_list').all() as {name:string;file:string}[]).find(row=>row.name==='main')!.file;
const blocker = new Database(file), policy = db.query('PRAGMA busy_timeout').get(); let cases = 0;
const nativeFetch = globalThis.fetch;
try {
  const deps = {sendMessage:async()=>{},sendNudge:async()=>{}} as any;
  blocker.exec('BEGIN IMMEDIATE'); let scheduled = false;
  const task = processTaskCommand({type:'schedule_task',chatJid:'web:default',prompt:'fixture',schedule_type:'once',schedule_value:'2099-01-01T00:00:00.000Z'},deps).then(()=>{scheduled=true;});
  await Bun.sleep(20); assert(!scheduled); assert.equal((db.query('SELECT count(*) n FROM host_scheduled_task_definitions').get() as {n:number}).n,0);
  blocker.exec('ROLLBACK'); await task;
  const id = (db.query('SELECT task_id FROM host_scheduled_task_definitions LIMIT 1').get() as {task_id:string}).task_id;
  assert.equal(getTaskById(id)?.prompt,'fixture'); cases++;

  blocker.exec('BEGIN IMMEDIATE'); const paused = processTaskCommand({type:'pause_task',taskId:id},deps);
  await Bun.sleep(20); assert.equal(getTaskById(id)?.status,'active'); blocker.exec('ROLLBACK'); await paused;
  assert.equal(getTaskById(id)?.status,'paused'); cases++;

  let warmups = 0;
  const branches = new AgentBranchManager({pool:new Map(),isActive:()=>false});
  blocker.exec('BEGIN IMMEDIATE'); const creation = branches.createRootChatSession('wal-fixture');
  await Bun.sleep(20); assert.equal(warmups,0); assert.equal(db.query("SELECT 1 FROM chat_branches WHERE chat_jid='web:wal-fixture'").get(),null);
  blocker.exec('ROLLBACK'); await creation; assert.equal(warmups,0); cases++;

  const relative = 'wal-attachment.txt'; writeFileSync(join(process.env.PICLAW_WORKSPACE!,relative),'fixture attachment');
  const files = new WorkspaceFileService(); blocker.exec('BEGIN IMMEDIATE'); let attached = false;
  const attaching = files.attachFile(relative).then(result=>{attached=true;return result;});
  await Bun.sleep(20); assert(!attached); blocker.exec('ROLLBACK'); assert.equal((await attaching).status,200); cases++;

  let fetches = 0;
  const image = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
  globalThis.fetch = (async input=>{
    fetches++; assert.equal(db.inTransaction,false,'network must remain outside SQL');
    return String(input).includes('image') ? new Response(image,{headers:{'content-type':'image/png'}})
      : new Response('<title>Fixture</title><meta property="og:image" content="https://8.8.8.8/image.png">',{headers:{'content-type':'text/html'}});
  }) as typeof fetch;
  blocker.exec('BEGIN IMMEDIATE'); let previewed = false;
  const preview = fetchLinkPreview('https://8.8.8.8/page').then(value=>{previewed=true;return value;});
  await Bun.sleep(20); assert(!previewed); assert.equal(fetches,1); blocker.exec('ROLLBACK');
  assert((await preview)?.image?.startsWith('/media/')); assert.equal(fetches,2); cases++;

  const count = (db.query('SELECT count(*) n FROM media').get() as {n:number}).n;
  db.exec("CREATE TRIGGER cache_fault BEFORE INSERT ON link_preview_image_cache BEGIN SELECT RAISE(ABORT,'cache fault'); END");
  const fallback = await fetchLinkPreview('https://8.8.8.8/new-page');
  // Use a different source URL to force insertion rather than the cache-hit path.
  globalThis.fetch = (async input => String(input).includes('other-image') ? new Response(image,{headers:{'content-type':'image/png'}})
    : new Response('<title>Other</title><meta property="og:image" content="https://8.8.8.8/other-image.png">',{headers:{'content-type':'text/html'}})) as typeof fetch;
  const faulted = await fetchLinkPreview('https://8.8.8.8/other-page');
  assert.equal(faulted?.image,'https://8.8.8.8/other-image.png');
  assert.equal((db.query('SELECT count(*) n FROM media').get() as {n:number}).n,count); assert(fallback); cases++;
  const { WebChannel } = await import('../../src/channels/web.js');
  const web = new WebChannel({queue:{enqueue:()=>{}},agentPool:{isStreaming:()=>false,runAgent:async()=>({status:'success',result:'unused'}),getContextUsageForChat:async()=>null}} as any) as any;
  const broadcasts: unknown[] = []; web.broadcastEvent = (...args:unknown[]) => broadcasts.push(args);
  blocker.exec('BEGIN IMMEDIATE'); let posted = false;
  const posting = web.handleRequest(new Request('http://test/post',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({content:'WAL public post'})})).then((response:Response)=>{posted=true;return response;});
  await Bun.sleep(20); assert(!posted); assert.equal(broadcasts.length,0); blocker.exec('ROLLBACK');
  assert.equal((await posting).status,201); assert.equal(broadcasts.length,1); cases++;

  blocker.exec('BEGIN IMMEDIATE'); const abort = new AbortController();
  const cancelled = web.handleRequest(new Request('http://test/post',{method:'POST',signal:abort.signal,headers:{'content-type':'application/json'},body:JSON.stringify({content:'cancelled WAL post'})})).catch((error:unknown)=>error);
  await Bun.sleep(20); abort.abort(Error('cancelled')); const rejected = await cancelled; blocker.exec('ROLLBACK');
  assert(!(rejected instanceof Response) || rejected.status !== 201);
  assert.equal(db.query("SELECT 1 FROM messages WHERE content='cancelled WAL post'").get(),null); assert.equal(broadcasts.length,1); cases++;
  const {admitRegisteredMessagesTool,setMessagesPostFn} = await import('../../src/extensions/messages-crud.js');
  blocker.exec('BEGIN IMMEDIATE'); let added = false;
  const adding = admitRegisteredMessagesTool({action:'add',content:'WAL tool add'},'web:default',()=>{}).then(value=>{added=true;return value;});
  await Bun.sleep(20); assert(!added); blocker.exec('ROLLBACK'); assert.equal((await adding).details.inserted,1); cases++;
  const toolAbort = new AbortController(); blocker.exec('BEGIN IMMEDIATE');
  const toolCancel = assert.rejects(admitRegisteredMessagesTool({action:'add',content:'cancelled WAL tool'},'web:default',()=>{},toolAbort.signal),/cancelled/);
  await Bun.sleep(20); toolAbort.abort(Error('cancelled')); await toolCancel; blocker.exec('ROLLBACK');
  assert.equal(db.query("SELECT 1 FROM messages WHERE content='cancelled WAL tool'").get(),null); cases++;

  let publications = 0;
  setMessagesPostFn(async(chat,content,isBot,mediaIds,blocks,authorise,signal)=>{
    const interaction = await web.admitMessage(chat,content,isBot,mediaIds,{contentBlocks:blocks},authorise,signal);
    assert.equal(db.inTransaction,false); if(interaction)publications++; return interaction?.id??null;
  });
  try {
    blocker.exec('BEGIN IMMEDIATE');
    const toolPost = admitRegisteredMessagesTool({action:'post',content:'WAL tool post'},'web:default',()=>{});
    await Bun.sleep(20); assert.equal(publications,0); blocker.exec('ROLLBACK');
    assert.equal((await toolPost).details.posted,1); assert.equal(publications,1); cases++;
    db.exec("CREATE TRIGGER tool_post_fault BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT,'tool post fault'); END");
    await assert.rejects(admitRegisteredMessagesTool({action:'post',content:'rolled-back WAL post'},'web:default',()=>{}),/tool post fault/);
    assert.equal(publications,1); assert.equal(db.query("SELECT 1 FROM messages WHERE content='rolled-back WAL post'").get(),null); cases++;
  } finally {setMessagesPostFn(undefined);}
  assert.equal(db.inTransaction,false); assert.deepEqual(db.query('PRAGMA busy_timeout').get(),policy);
  console.log(JSON.stringify({kind:'background-write-admission',cases,realWal:true}));
} finally { globalThis.fetch = nativeFetch; if(blocker.inTransaction)blocker.exec('ROLLBACK');blocker.close();closeDatabase(); }
