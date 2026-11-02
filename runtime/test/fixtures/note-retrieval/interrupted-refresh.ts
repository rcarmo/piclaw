/** Disposable release-fixture helper; exercises the real bound writer and SIGKILL recovery. */
import { Database } from 'bun:sqlite';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import type { NoteBinding } from '../../../src/note-retrieval/access.js';
import { assertPathWithinTestFilesystemIsolation } from '../../../scripts/test-filesystem-isolation.js';

export async function interruptRefreshes(binding: NoteBinding, cwd: string): Promise<unknown[]> {
  assertPathWithinTestFilesystemIsolation(binding.workspace);
  assertPathWithinTestFilesystemIsolation(binding.database);
  const metrics:unknown[]=[];
  const snapshot=()=>{
    const db=new Database(binding.database,{readonly:true});
    try {
      const state=db.query('SELECT published,staging,namespace,writer_pid FROM note_retrieval_state WHERE id=1').get() as {published:number;staging:number|null;namespace:string;writer_pid:number|null};
      const generations=(db.query('SELECT DISTINCT generation FROM note_retrieval_sources ORDER BY generation').all() as {generation:number}[]).map(r=>r.generation);
      const chunks=db.query('SELECT chunk_id,revision,path FROM note_retrieval_chunks WHERE generation=? ORDER BY path,first_byte').all(state.published);
      const indexBytes=(db.query("SELECT sum(pgsize) bytes FROM dbstat WHERE name IN (SELECT name FROM sqlite_schema WHERE tbl_name LIKE 'note_retrieval_%')").get() as {bytes:number}).bytes;
      const pageSize=(db.query('PRAGMA page_size').get() as {page_size:number}).page_size;
      const freePages=(db.query('PRAGMA freelist_count').get() as {freelist_count:number}).freelist_count;
      return {state,generations,publishedDigest:createHash('sha256').update(JSON.stringify(chunks)).digest('hex'),indexBytes,
        databaseBytes:statSync(binding.database).size,walBytes:existsSync(binding.database+'-wal')?statSync(binding.database+'-wal').size:0,freeBytes:pageSize*freePages};
    } finally {db.close();}
  };
  const original=snapshot();metrics.push({phase:'before-interruptions',...original});
  const originalNote=readFileSync(join(binding.workspace,'notes/solar-folio.md'));
  let previousStage:number|null=null;
  for(let round=0;round<3;round++){
    const ready=join(binding.data,`release-crash-ready-${round}`);
    assertPathWithinTestFilesystemIsolation(ready);
    // Pause before the 33rd open: 32 completed opens have allowed sixteen
    // source read/reread pairs to commit one bounded staging batch, not publication.
    const script=`const fs=await import('node:fs/promises');const sync=await import('node:fs');let opened=0;const open=fs.default.open;
      fs.default.open=async(...args)=>{if(++opened===33){setInterval(()=>{},1000);sync.writeFileSync(${JSON.stringify(ready)},'ready');await new Promise(()=>{});}return open(...args);};
      const {runNoteIndexPhase}=await import('./src/note-retrieval/coordinator.ts');await runNoteIndexPhase();`;
    const child=spawn(process.execPath,['-e',script],{cwd,env:process.env,stdio:['ignore','ignore','pipe','pipe']});
    const exited=once(child,'exit');let errors='';child.stderr!.on('data',b=>errors+=b);
    (child.stdio[3] as any).end(JSON.stringify(binding));
    try {
      const deadline=performance.now()+25000;
      while(!existsSync(ready)){
        if(child.exitCode!==null||child.signalCode!==null)throw Error(`writer exited before staging barrier: ${errors.slice(-1000)}`);
        if(performance.now()>deadline)throw Error('staging barrier deadline exceeded');
        await Bun.sleep(25);
      }
      const active=snapshot();
      assert.equal(active.state.published,original.state.published);assert.equal(active.state.namespace,original.state.namespace);
      assert.equal(active.publishedDigest,original.publishedDigest);assert.equal(active.state.writer_pid,child.pid);
      assert.ok(active.state.staging!==null&&active.state.staging!==previousStage);
      assert.equal(active.generations.length,2);assert.deepEqual(active.generations,[active.state.published,active.state.staging].sort((a,b)=>a!-b!));
      previousStage=active.state.staging;
      metrics.push({phase:`staged-${round+1}`,...active});
      child.kill('SIGKILL');const [code,signal]=await exited;assert.equal(code,null);assert.equal(signal,'SIGKILL');
      const crashed=snapshot();assert.equal(crashed.publishedDigest,original.publishedDigest);assert.equal(crashed.state.staging,previousStage);
      assert.equal(crashed.state.writer_pid,child.pid);assert.deepEqual(crashed.generations,active.generations);
      metrics.push({phase:`crashed-${round+1}`,...crashed});
    } finally {
      if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}
      if(existsSync(ready))unlinkSync(ready);
    }
  }
  assert.deepEqual(readFileSync(join(binding.workspace,'notes/solar-folio.md')),originalNote);
  return metrics;
}
