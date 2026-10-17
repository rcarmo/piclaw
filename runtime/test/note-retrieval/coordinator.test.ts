import {afterEach,beforeEach,expect,setDefaultTimeout,test} from 'bun:test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdirSync,writeFileSync,readFileSync,existsSync,unlinkSync,renameSync,symlinkSync,linkSync,utimesSync,statSync,lstatSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Database} from 'bun:sqlite';
import {createTempWorkspace,setEnv} from '../helpers.js';
import {markNoteIndexDirty,runNoteIndexPhase} from '../../src/note-retrieval/coordinator.js';
import {withExecutionIdentity} from '../../src/core/execution-context.js';
let ws:ReturnType<typeof createTempWorkspace>,restore:()=>void;
const workspaceEnvKeys=['PICLAW_WORKSPACE','PICLAW_STORE','PICLAW_DATA','PICLAW_DB_IN_MEMORY'] as const;
let previousWorkspaceEnv:Record<string,string|undefined>;
setDefaultTimeout(30_000);
beforeEach(()=>{previousWorkspaceEnv=Object.fromEntries(workspaceEnvKeys.map(key=>[key,process.env[key]]));ws=createTempWorkspace('note-index-376-');restore=setEnv({PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX:'1'});Object.assign(process.env,{PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data,PICLAW_DB_IN_MEMORY:'0'});mkdirSync(join(ws.workspace,'notes'),{recursive:true});writeFileSync(join(ws.store,'messages.db'),Buffer.alloc(0));});
afterEach(()=>{restore();for(const key of workspaceEnvKeys){const value=previousWorkspaceEnv[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}ws.cleanup();});
const put=(name:string,content:string)=>{writeFileSync(join(ws.workspace,'notes',name),content);};
const binding=()=>{const paths=[ws.workspace,ws.store,ws.data,join(ws.store,'messages.db')].map(realpathSync),identities=paths.map(p=>{const s=lstatSync(p);return `${s.dev}:${s.ino}`;});return {version:1,mode:'single-user',workspace:paths[0],store:paths[1],data:paths[2],database:paths[3],databaseIdentity:identities[3],identities};};
const database=()=>new Database(join(ws.store,'messages.db'));
async function run(bound:unknown=binding(),rebuild=false,aborted=false,measureDeletes=false){
 const instrumentation=measureDeletes?`const {Database}=await import('bun:sqlite');const query=Database.prototype.query;let deletes=0;Database.prototype.query=function(sql,...args){if(/^DELETE FROM note_retrieval_(fts|chunks|sources) WHERE generation=\\? AND path=\\?$/.test(sql))deletes++;return query.call(this,sql,...args)};process.on('exit',()=>console.log('PATH_DELETES='+deletes));`:'';
 const p=spawn(process.execPath,['-e',`${instrumentation}const {runNoteIndexPhase}=await import('./src/note-retrieval/coordinator.ts');const controller=new AbortController();if(${aborted})controller.abort();try{await runNoteIndexPhase({rebuild:${rebuild},signal:controller.signal})}catch(e){console.error(e.name+':'+e.message);process.exitCode=1}`],{cwd:resolve(import.meta.dir,'../..'),env:process.env,stdio:['ignore','pipe','pipe','pipe']});
 let errors='',output='';p.stdout!.on('data',b=>output+=b);p.stderr!.on('data',b=>errors+=b);(p.stdio[3] as any).end(JSON.stringify(bound));const [code]=await once(p,'exit');return {code,pathDeletes:Number(/PATH_DELETES=(\d+)/.exec(output)?.[1]??NaN),errors:errors.split('\n').filter(line=>!line.startsWith('{"ts"')).join('\n')};
}
const snapshot=()=>{const db=database();try{return db.query('SELECT * FROM note_retrieval_state').get() as any;}finally{db.close();}};
const chunks=()=>{const db=database();try{return db.query('SELECT chunk_id,path,revision,first_byte,after_last_byte,line_start,line_end,content FROM note_retrieval_chunks WHERE generation=(SELECT published FROM note_retrieval_state)').all() as any[];}finally{db.close();}};
const sql=(statement:string,...values:any[])=>{const db=database();try{return db.query(statement).get(...values) as any;}finally{db.close();}};
async function childEval(code:string){const p=spawn(process.execPath,['-e',code],{cwd:resolve(import.meta.dir,'../..'),env:process.env});const [exit]=await once(p,'exit');return exit;}
async function combined(args:string[],bound?:unknown){const p=spawn(process.execPath,['src/workspace-index-process.ts',...args],{cwd:resolve(import.meta.dir,'../..'),env:process.env,stdio:bound===undefined?'ignore':['ignore','ignore','pipe','pipe']});let errors='';if(p.stderr)p.stderr.on('data',b=>errors+=b);if(bound!==undefined)(p.stdio[3] as any).end(JSON.stringify(bound));const [code]=await once(p,'exit');return {code,errors};}
test('worker requires inherited binding before opening note schema',async()=>{
 const r=await run({...binding(),store:join(ws.workspace,'other')});expect(r.code).toBe(1);expect(r.errors).toContain('NoteIndexDenied');
 expect(sql("SELECT name FROM sqlite_master WHERE name='note_retrieval_state'")).toBeNull();
 await expect(runNoteIndexPhase()).rejects.toThrow('Note index access denied');
});
test('database path replacement is denied against both captured binding and an already-open parent instance',async()=>{
 const captured=binding(),dbPath=join(ws.store,'messages.db'),oldPath=join(ws.store,'old-messages.db');renameSync(dbPath,oldPath);writeFileSync(dbPath,Buffer.alloc(0));
 const mismatched=await run(captured);expect(mismatched.code).toBe(1);expect(mismatched.errors).toContain('NoteIndexDenied');expect(sql("SELECT name FROM sqlite_master WHERE name='note_retrieval_state'")).toBeNull();
 unlinkSync(dbPath);renameSync(oldPath,dbPath);expect((await run()).code).toBe(0);
 const child=`const fs=await import('node:fs');const {initDatabase}=await import('./src/db/connection.ts');const {markNoteIndexDirty}=await import('./src/note-retrieval/coordinator.ts');initDatabase();fs.renameSync(${JSON.stringify(dbPath)},${JSON.stringify(oldPath)});fs.writeFileSync(${JSON.stringify(dbPath)},Buffer.alloc(0));try{markNoteIndexDirty(['notes/a.md']);process.exitCode=2}catch(e){process.exitCode=e.name==='NoteIndexDenied'?0:3}finally{fs.unlinkSync(${JSON.stringify(dbPath)});fs.renameSync(${JSON.stringify(oldPath)},${JSON.stringify(dbPath)})}`;
 expect(await childEval(child)).toBe(0);
});
test('combined worker runs note and legacy phases only with explicit fd binding marker',async()=>{
 put('a.md','alpha combined');
 expect((await combined(['--scope','notes','--expected-mode','single-user'])).code).toBe(0);
 expect(sql("SELECT name FROM sqlite_master WHERE name='note_retrieval_state'")).toBeNull();
 expect(sql("SELECT count(*) n FROM workspace_files")).toEqual({n:1});
 expect((await combined(['--scope','notes','--note-binding-fd','3','--expected-mode','single-user'],binding())).code).toBe(0);
 expect(snapshot().state).toBe('ready');expect(chunks()).toHaveLength(1);
 expect((await combined(['--scope','notes','--note-binding-fd','3','--expected-mode','single-user'])).code).toBe(1);
 expect((await combined(['--scope','skills','--note-binding-fd','3','--expected-mode','single-user'],binding())).code).toBe(0);
 expect(snapshot().sequence).toBe(1);
});
test('versioned atomic snapshots preserve unchanged IDs, detect same-metadata edits, move/delete and rebuild',async()=>{
 put('a.md','# One\r\nalpha\r\n');put('b.md','## Other\nunchanged');
 let r=await run();expect(r.errors).toBe('');expect(r.code).toBe(0);expect(snapshot().state).toBe('ready');
 const initial=chunks();expect(initial).toHaveLength(2);const first=snapshot();
 expect((await run()).code).toBe(0);expect(chunks().map(c=>c.chunk_id)).toEqual(initial.map(c=>c.chunk_id));expect(snapshot().namespace).toBe(first.namespace);
 const file=join(ws.workspace,'notes','a.md'),stat=statSync(file);put('a.md','# One\r\nbravo\r\n');utimesSync(file,stat.atime,stat.mtime);
 expect((await run()).code).toBe(0);expect(chunks().find(c=>c.path==='notes/a.md').chunk_id).not.toBe(initial[0].chunk_id);expect(chunks().find(c=>c.path==='notes/b.md').chunk_id).toBe(initial[1].chunk_id);
 renameSync(file,join(ws.workspace,'notes','renamed.md'));unlinkSync(join(ws.workspace,'notes','b.md'));
 expect((await run()).code).toBe(0);expect(chunks()).toHaveLength(1);expect(chunks()[0].path).toBe('notes/renamed.md');
 const old=chunks()[0].chunk_id;expect((await run(binding(),true)).code).toBe(0);expect(chunks()[0].chunk_id).not.toBe(old);
 expect(snapshot().staging).toBeNull();expect(sql('SELECT count(DISTINCT generation) n FROM note_retrieval_sources')).toEqual({n:1});
});
test('new paths skip staged deletes; incremental replacements still delete all three representations',async()=>{
 put('a.md','alpha');put('b.md','beta');
 const fresh=await run(binding(),false,false,true);expect(fresh.code,fresh.errors).toBe(0);expect(fresh.pathDeletes).toBe(0);
 const initial=chunks();put('a.md','replacement');put('new.md','new source');
 expect(await childEval(`const {initDatabase}=await import('./src/db/connection.ts');const {markNoteIndexDirty}=await import('./src/note-retrieval/coordinator.ts');initDatabase();markNoteIndexDirty(['notes/a.md','notes/new.md'])`)).toBe(0);
 const changed=await run(binding(),false,false,true);expect(changed.code,changed.errors).toBe(0);expect(changed.pathDeletes).toBe(3);
 expect(chunks()).toHaveLength(3);expect(chunks().find(c=>c.path==='notes/b.md')).toEqual(initial.find(c=>c.path==='notes/b.md'));
 expect(sql("SELECT count(*) n FROM note_retrieval_fts WHERE path='notes/a.md'")).toEqual({n:1});
 expect(sql("SELECT count(*) n FROM note_retrieval_fts WHERE note_retrieval_fts MATCH 'alpha'")).toEqual({n:0});
});
test('independent WAL reader keeps one published generation across dirty refresh and commit',async()=>{
 put('a.md','# Entry\nold source');expect((await run()).code).toBe(0);
 const original=chunks()[0],published=snapshot().published;
 const dbPath=join(ws.store,'messages.db'),ready=join(ws.data,'reader-ready.json'),go=join(ws.data,'reader-go'),done=join(ws.data,'reader-done.json');
 const select="SELECT s.published,s.state,c.chunk_id,c.revision,c.content FROM note_retrieval_state s JOIN note_retrieval_chunks c ON c.generation=s.published WHERE c.path='notes/a.md'";
 const reader=spawn(process.execPath,['-e',`const {Database}=await import('bun:sqlite');const fs=await import('node:fs');const db=new Database(${JSON.stringify(dbPath)},{readonly:true});const select=${JSON.stringify(select)};db.exec('BEGIN');const before=db.query(select).get();fs.writeFileSync(${JSON.stringify(ready)},JSON.stringify(before));for(let i=0;i<500&&!fs.existsSync(${JSON.stringify(go)});i++)await Bun.sleep(20);if(!fs.existsSync(${JSON.stringify(go)}))throw Error('reader barrier timed out');const during=db.query(select).get();db.exec('COMMIT');const after=db.query(select).get();fs.writeFileSync(${JSON.stringify(done)},JSON.stringify({during,after}));db.close();`],{cwd:resolve(import.meta.dir,'../..'),env:process.env,stdio:['ignore','ignore','pipe']});
 let errors='';reader.stderr!.on('data',b=>errors+=b);const readerExited=once(reader,'exit');
 const waitFor=async(path:string)=>{for(let i=0;i<500&&!existsSync(path);i++){if(reader.exitCode!==null)throw Error(`reader exited ${reader.exitCode}: ${errors}`);await Bun.sleep(20);}expect(existsSync(path)).toBe(true);return JSON.parse(readFileSync(path,'utf8'));};
 try{
  const before=await waitFor(ready);expect(before).toMatchObject({published,chunk_id:original.chunk_id,content:original.content,state:'ready'});
  put('a.md','# Entry\nnew source');
  expect(await childEval(`const {markNoteIndexDirty}=await import('./src/note-retrieval/coordinator.ts');const {initDatabase}=await import('./src/db/connection.ts');initDatabase();markNoteIndexDirty(['notes/a.md'])`)).toBe(0);
  expect(snapshot().state).toBe('stale');
  expect((await run()).code).toBe(0);
  const current=chunks()[0];expect(current.chunk_id).not.toBe(original.chunk_id);expect(snapshot().published).toBeGreaterThan(published);
  expect(sql('SELECT count(*) n FROM note_retrieval_chunks WHERE chunk_id=?',original.chunk_id)).toEqual({n:0});
  writeFileSync(go,'go');const observed=await waitFor(done);const [code]=await readerExited;expect(code).toBe(0);expect(errors).toBe('');
  expect(observed.during).toEqual(before);
  expect(observed.after).toMatchObject({published:snapshot().published,chunk_id:current.chunk_id,revision:current.revision,content:current.content,state:'ready'});
 }finally{if(reader.exitCode===null){reader.kill();await readerExited;}}
});
test('excluded private roots, symlinks, hardlinks, invalid UTF8 and oversized files cannot publish',async()=>{
 put('good.md','good');mkdirSync(join(ws.workspace,'notes','users'));mkdirSync(join(ws.workspace,'notes','family'));put('users/private.md','private');put('family/shared.md','shared');
 put('bad.md','valid initially');expect((await run()).code).toBe(0);
 writeFileSync(join(ws.workspace,'notes','bad.md'),Buffer.from([255]));put('large.md','x'.repeat(512*1024+1));symlinkSync(join(ws.workspace,'notes','good.md'),join(ws.workspace,'notes','link.md'));put('hard.md','hard');linkSync(join(ws.workspace,'notes','hard.md'),join(ws.workspace,'notes','hard2.md'));
 expect((await run()).code).toBe(0);expect(snapshot().state).toBe('limited');expect(chunks().map(c=>c.path)).toEqual(['notes/good.md']);
 expect(sql('SELECT count(*) n FROM note_retrieval_fts')).toEqual({n:1});
});
test('dirty generation and overdue status are independent of legacy index ready status',async()=>{
 put('a.md','alpha');expect((await run()).code).toBe(0);const old=snapshot();
 expect(await childEval(`const {markNoteIndexDirty}=await import('./src/note-retrieval/coordinator.ts');const {initDatabase}=await import('./src/db/connection.ts');initDatabase();markNoteIndexDirty(['notes/new.md'])`)).toBe(0);expect(snapshot().dirty).toBe(old.dirty+1);expect(snapshot().state).toBe('stale');
 expect((await run()).code).toBe(0);{const db=database();db.query('UPDATE note_retrieval_state SET last_complete=?').run(Date.now()+60000);db.close();}expect(await childEval(`const {noteIndexStatus}=await import('./src/note-retrieval/coordinator.ts');const {initDatabase}=await import('./src/db/connection.ts');initDatabase();process.exit(noteIndexStatus().state==='stale'?0:1)`)).toBe(0);
});
test('dirty incremental refresh preserves unaffected IDs and defers unknown external additions to a full reconciliation',async()=>{
 put('a.md','alpha');put('b.md','beta');expect((await run()).code).toBe(0);const before=chunks();
 put('a.md','ALPHA');put('external.md','new external note');
 expect(await childEval(`const {markNoteIndexDirty}=await import('./src/note-retrieval/coordinator.ts');const {initDatabase}=await import('./src/db/connection.ts');initDatabase();markNoteIndexDirty(['notes/a.md'])`)).toBe(0);
 expect((await run()).code).toBe(0);const incremental=chunks();expect(incremental.find(c=>c.path==='notes/a.md').chunk_id).not.toBe(before.find(c=>c.path==='notes/a.md').chunk_id);expect(incremental.find(c=>c.path==='notes/b.md').chunk_id).toBe(before.find(c=>c.path==='notes/b.md').chunk_id);expect(incremental.some(c=>c.path==='notes/external.md')).toBe(false);
 {const db=database();db.query('UPDATE note_retrieval_state SET last_complete=?').run(Date.now()-300001);db.close();}
 expect((await run()).code).toBe(0);expect(chunks().some(c=>c.path==='notes/external.md')).toBe(true);
});
test('live writer cannot be reclaimed; crash-left staging is reclaimed before successor',async()=>{
 put('a.md','alpha');expect((await run()).code).toBe(0);const published=snapshot().published;
 {const db=database();db.query('UPDATE note_retrieval_state SET staging=999,writer_pid=?').run(process.pid);db.close();}
 expect((await run()).code).toBe(1);expect(snapshot().published).toBe(published);
 {const db=database();db.query('UPDATE note_retrieval_state SET writer_pid=2147483647').run();db.query("INSERT INTO note_retrieval_sources VALUES(999,'notes/abandoned.md','rev',1,1,0)").run();db.close();}
 expect((await run()).code).toBe(0);expect(sql('SELECT count(*) n FROM note_retrieval_sources WHERE generation=999')).toEqual({n:0});
});
test('a competing process refuses a live writer and reclaims its staging after SIGKILL',async()=>{
 put('a.md','original');expect((await run()).code).toBe(0);
 const first=snapshot(),original=chunks()[0],ready=join(ws.data,'writer-ready');
 const writer=spawn(process.execPath,['-e',`const {Database}=await import('bun:sqlite');const fs=await import('node:fs');const db=new Database(${JSON.stringify(join(ws.store,'messages.db'))});db.transaction(()=>{db.query("UPDATE note_retrieval_state SET staging=999,writer_pid=?,state='indexing' WHERE id=1").run(process.pid);db.query('INSERT INTO note_retrieval_sources VALUES(?,?,?,?,?,?)').run(999,'notes/abandoned.md','rev',1,1,0)}).immediate();db.close();fs.writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000);`],{cwd:resolve(import.meta.dir,'../..'),env:process.env,stdio:['ignore','ignore','pipe']});
 let errors='';writer.stderr!.on('data',b=>errors+=b);const writerExited=once(writer,'exit');
 try{
  for(let i=0;i<500&&!existsSync(ready);i++){if(writer.exitCode!==null)throw Error(`writer exited ${writer.exitCode}: ${errors}`);await Bun.sleep(20);}
  expect(existsSync(ready)).toBe(true);
  const active=snapshot();expect(active).toMatchObject({published:first.published,staging:999,writer_pid:writer.pid,state:'indexing'});
  expect(chunks()).toEqual([original]);
  const contender=await run();expect(contender.code).toBe(1);expect(contender.errors).toContain('writer_busy');
  expect(snapshot()).toMatchObject({published:first.published,staging:999,writer_pid:writer.pid});
  writer.kill('SIGKILL');const [exit,signal]=await writerExited;expect(exit).toBeNull();expect(signal).toBe('SIGKILL');
  put('a.md','replacement');expect((await run()).code).toBe(0);
  expect(snapshot()).toMatchObject({staging:null,writer_pid:null,state:'ready'});
  expect(snapshot().published).toBeGreaterThan(first.published);
  expect(sql('SELECT count(*) n FROM note_retrieval_sources WHERE generation=999')).toEqual({n:0});
  expect(chunks()[0].chunk_id).not.toBe(original.chunk_id);
 }finally{if(writer.exitCode===null&&writer.signalCode===null){writer.kill('SIGKILL');await writerExited;}}
});
test('SQL fault rolls back staging, retains publication and never deletes source/other tables',async()=>{
 put('a.md','alpha');expect((await run()).code).toBe(0);const previous=chunks();
 {const db=database();db.exec("CREATE TABLE fixture_other(value TEXT); INSERT INTO fixture_other VALUES('keep'); CREATE TRIGGER note_fault BEFORE INSERT ON note_retrieval_chunks BEGIN SELECT RAISE(ABORT,'fixture fault'); END;");db.close();}put('a.md','bravo');
 expect((await run()).code).toBe(1);expect(chunks()).toEqual(previous);expect(snapshot().staging).toBeNull();expect(sql('SELECT value FROM fixture_other')).toEqual({value:'keep'});expect(readFileSync(join(ws.workspace,'notes','a.md'),'utf8')).toBe('bravo');
});
test('independent process sees the old publication after a faulted refresh, then the committed successor',async()=>{
 put('a.md','original');expect((await run()).code).toBe(0);
 const first=snapshot(),original=chunks()[0];
 {const db=database();db.exec("CREATE TRIGGER faulted_chunk BEFORE INSERT ON note_retrieval_chunks BEGIN SELECT RAISE(ABORT,'fixture fault'); END;");db.close();}
 put('a.md','replacement');expect((await run()).code).toBe(1);
 const read=`const {Database}=await import('bun:sqlite');const db=new Database(${JSON.stringify(join(ws.store,'messages.db'))},{readonly:true});const state=db.query('SELECT published,staging,state FROM note_retrieval_state').get();const rows=db.query('SELECT chunk_id,revision,content FROM note_retrieval_chunks WHERE generation=?').all(state.published);console.log(JSON.stringify({state,rows}));db.close()`;
 const reopen=async()=>{const p=spawn(process.execPath,['-e',read],{cwd:resolve(import.meta.dir,'../..'),env:process.env,stdio:['ignore','pipe','pipe']});let output='',errors='';p.stdout!.on('data',b=>output+=b);p.stderr!.on('data',b=>errors+=b);const [code]=await once(p,'exit');expect(code).toBe(0);expect(errors).toBe('');return JSON.parse(output);};
 expect(await reopen()).toEqual({state:{published:first.published,staging:null,state:'stale'},rows:[{chunk_id:original.chunk_id,revision:original.revision,content:original.content}]});
 {const db=database();db.exec('DROP TRIGGER faulted_chunk');db.close();}
 expect((await run()).code).toBe(0);const next=chunks()[0];expect(next.chunk_id).not.toBe(original.chunk_id);
 expect(await reopen()).toEqual({state:{published:snapshot().published,staging:null,state:'ready'},rows:[{chunk_id:next.chunk_id,revision:next.revision,content:next.content}]});
});
test('cancelled refresh cleans its only staging slot and preserves publication',async()=>{
 put('a.md','alpha');expect((await run()).code).toBe(0);const publication=snapshot().published,previous=chunks();put('a.md','bravo');
 expect((await run(binding(),false,true)).code).toBe(1);expect(snapshot().published).toBe(publication);expect(snapshot().staging).toBeNull();expect(chunks()).toEqual(previous);
});
test('failed abandoned-stage cleanup blocks a successor and leaves the publication intact',async()=>{
 put('a.md','alpha');expect((await run()).code).toBe(0);const publication=snapshot().published;
 {const db=database();db.query('UPDATE note_retrieval_state SET staging=999,writer_pid=2147483647').run();db.query("INSERT INTO note_retrieval_sources VALUES(999,'notes/abandoned.md','rev',1,1,0)").run();db.exec("CREATE TRIGGER cleanup_fault BEFORE DELETE ON note_retrieval_sources WHEN old.generation=999 BEGIN SELECT RAISE(ABORT,'cleanup fault'); END;");db.close();}
 expect((await run()).code).toBe(1);expect(snapshot().published).toBe(publication);expect(snapshot().staging).toBe(999);expect(sql('SELECT count(*) n FROM note_retrieval_sources WHERE generation=999')).toEqual({n:1});
});
test('stale/malformed family identity denies before selectors are inspected',()=>{
 const identity:any=Object.freeze({mode:'family-shared',provenance:Object.freeze({})});let touched=false;
 withExecutionIdentity(identity,()=>expect(()=>markNoteIndexDirty(new Proxy([],{get(){touched=true;throw Error('selector accessed');}}))).toThrow('Note index access denied'));
 expect(touched).toBe(false);
});
