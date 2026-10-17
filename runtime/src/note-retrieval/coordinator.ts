import { randomUUID } from 'node:crypto';
import { workspaceIndexPolicySnapshot } from '../core/workspace-index-policy.js';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { getDb, initDatabase } from '../db/connection.js';
import { admitNoteIndexStore, captureNoteIndexBinding, receiveNoteIndexBinding, NoteIndexDenied } from './access.js';
import { ensureNoteSchema, NOTE_INDEX_FORMAT } from './schema.js';
import { CHUNKER_VERSION, chunkMarkdown, NoteChunkerExclusionError } from './chunker.js';
import { admittedNotePath, NOTE_LIMITS, NoteScanLimited, NoteSourceExcluded, readNote, walkNotes } from './files.js';

interface State { namespace:string|null; binding:string|null; format:string|null; published:number|null; staging:number|null; sequence:number; dirty:number; coverage:number; state:string; last_complete:number|null; reason:string|null; exclusions:number; writer_pid:number|null }
const tableExists=()=>Boolean(getDb().query("SELECT 1 FROM sqlite_master WHERE name='note_retrieval_state'").get());
const state=()=>getDb().query('SELECT * FROM note_retrieval_state WHERE id=1').get() as State;
const bindingKey=(binding:ReturnType<typeof captureNoteIndexBinding>)=>JSON.stringify(binding);
export function noteIndexStatus(): {state:string;lastComplete:number|null;generation:number|null;scopeDirty:number;coverage:number} {
  const {validate}=admitNoteIndexStore();validate();
  if(!tableExists())return {state:'never_indexed',lastComplete:null,generation:null,scopeDirty:0,coverage:0};
  const row=state();let bound=false;try{bound=row.binding===bindingKey(captureNoteIndexBinding())&&row.format===NOTE_INDEX_FORMAT;}catch{validate();}
  validate();const overdue=!row.last_complete||Date.now()<row.last_complete||Date.now()-row.last_complete>=NOTE_LIMITS.reconcileMs;
  return {state:!bound?'never_indexed':row.state==='ready'&&overdue?'stale':row.state,lastComplete:row.last_complete,generation:bound?row.published:null,scopeDirty:row.dirty,coverage:row.coverage};
}
/** Metadata invalidation only; never reads or writes note content. */
export function markNoteIndexDirty(paths?: string[]): void {
  const {validate}=admitNoteIndexStore();validate();if(!tableExists())return;
  const accepted=paths?.filter(admittedNotePath);if(paths&&!accepted?.length)return;
  const db=getDb();db.transaction(()=>{validate();db.query("UPDATE note_retrieval_state SET dirty=dirty+1,coverage=coverage+1,state='stale' WHERE id=1").run();
    const revision=state().dirty;
    for(const name of accepted||['*']) db.query('INSERT INTO note_retrieval_dirty VALUES(?,?,?) ON CONFLICT(path) DO UPDATE SET revision=excluded.revision,reason=excluded.reason').run(name,revision,'refresh_pending');
    validate();
  }).immediate();
}

/** Sole content writer: requires and consumes the coordinator-owned inherited pipe. */
export async function runNoteIndexPhase(options: { rebuild?: boolean; signal?: AbortSignal } = {}): Promise<void> {
  const admission=receiveNoteIndexBinding(); // Before database open or option access.
  initDatabase();const db=getDb();admission.bindDatabase(db);admission.validate();
  ensureNoteSchema(db);
  const started=performance.now(),signal=options.signal,policy=workspaceIndexPolicySnapshot();
  const check=()=>{admission.validate();policy.validate();if(signal?.aborted)throw new Error('cancelled');if(performance.now()-started>=NOTE_LIMITS.elapsedMs)throw new NoteScanLimited();};
  const purge=(generation:number)=>{db.query('DELETE FROM note_retrieval_fts WHERE generation=?').run(generation);db.query('DELETE FROM note_retrieval_chunks WHERE generation=?').run(generation);db.query('DELETE FROM note_retrieval_sources WHERE generation=?').run(generation);};
  const deleteStagedPath=(generation:number,path:string)=>{db.query('DELETE FROM note_retrieval_fts WHERE generation=? AND path=?').run(generation,path);db.query('DELETE FROM note_retrieval_chunks WHERE generation=? AND path=?').run(generation,path);db.query('DELETE FROM note_retrieval_sources WHERE generation=? AND path=?').run(generation,path);};
  let captured!:State;let namespace='';let generation=0;let claimed=false;let dirtyPaths:string[]=[];let incremental=false;const binding=bindingKey(admission.binding);
  try {
    db.transaction(()=>{
      check();const row=state();
      if(row.writer_pid){let live=true;try{process.kill(row.writer_pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')live=false;}
        if(live)throw new Error('writer_busy');}
      // A crashed process owns no kernel resources now; reclaim the one slot first.
      if(row.staging!==null)purge(row.staging);
      const compatible=row.binding===binding&&row.format===NOTE_INDEX_FORMAT;
      namespace=compatible&&!options.rebuild&&row.namespace?row.namespace:randomUUID();
      generation=row.sequence+1;
      dirtyPaths=(db.query('SELECT path FROM note_retrieval_dirty ORDER BY path').all() as Array<{path:string}>).map(row=>row.path);
      incremental=compatible&&!options.rebuild&&row.published!==null&&Boolean(row.last_complete)&&Date.now()>=row.last_complete!&&Date.now()-row.last_complete!<NOTE_LIMITS.reconcileMs&&dirtyPaths.length>0&&!dirtyPaths.includes('*');
      if(incremental&&row.published!==null){
        db.query('INSERT INTO note_retrieval_sources SELECT ?,path,revision,bytes,validated_at,dirty FROM note_retrieval_sources WHERE generation=?').run(generation,row.published);
        db.query('INSERT INTO note_retrieval_chunks(generation,path,chunk_id,revision,chunker,first_byte,after_last_byte,line_start,line_end,heading,kind,content) SELECT ?,path,chunk_id,revision,chunker,first_byte,after_last_byte,line_start,line_end,heading,kind,content FROM note_retrieval_chunks WHERE generation=?').run(generation,row.published);
        db.query('INSERT INTO note_retrieval_fts(content,heading,path,generation,chunk_id) SELECT content,heading,path,?,chunk_id FROM note_retrieval_fts WHERE generation=?').run(generation,row.published);
      }
      db.query("UPDATE note_retrieval_state SET staging=?,sequence=?,writer_pid=?,state='indexing',coverage=coverage+1,reason=NULL WHERE id=1").run(generation,generation,process.pid);
      captured=state();claimed=true;check();
    }).immediate();
    let sourceBytes=Number((db.query('SELECT coalesce(sum(bytes),0) value FROM note_retrieval_sources WHERE generation=?').get(generation) as {value:number}).value);
    let sourceCount=Number((db.query('SELECT count(*) value FROM note_retrieval_sources WHERE generation=?').get(generation) as {value:number}).value);
    const aggregate=db.query('SELECT count(*) chunks,coalesce(sum(length(cast(content as blob))),0) bytes FROM note_retrieval_chunks WHERE generation=?').get(generation) as {chunks:number;bytes:number};
    let chunkCount=Number(aggregate.chunks),contentBytes=Number(aggregate.bytes),exclusions=0,unavailable=0;
    const seen=new Set<string>();
    const excludedPaths: string[] = [];
    const processSource=async(relative:string)=>{
      check();
      seen.add(relative);
      const previousSource=db.query('SELECT bytes FROM note_retrieval_sources WHERE generation=? AND path=?').get(generation,relative) as {bytes:number}|null;
      const previousChunks=db.query('SELECT count(*) chunks,coalesce(sum(length(cast(content as blob))),0) bytes FROM note_retrieval_chunks WHERE generation=? AND path=?').get(generation,relative) as {chunks:number;bytes:number};
      if(previousSource){sourceCount--;sourceBytes-=previousSource.bytes;chunkCount-=Number(previousChunks.chunks);contentBytes-=Number(previousChunks.bytes);}
      try { lstatSync(join(admission.binding.workspace,relative)); }
      catch(error){
        if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
        db.transaction(()=>{check();if(state().dirty!==captured.dirty)throw new Error('superseded',{cause:error});deleteStagedPath(generation,relative);check();}).immediate();return;
      }
      let addedSource=0,addedChunks=0,addedContent=0;
      try {
        const source=await readNote(admission.binding.workspace,relative,check);check();
        sourceCount++;sourceBytes+=source.bytes.length;addedSource=source.bytes.length;if(sourceCount>NOTE_LIMITS.files||sourceBytes>NOTE_LIMITS.sourceBytes)throw new NoteScanLimited();
        const parsed=chunkMarkdown(source.bytes,namespace,relative);
        addedChunks=parsed.chunks.length;addedContent=parsed.chunks.reduce((sum,chunk)=>sum+Buffer.byteLength(chunk.text),0);
        chunkCount+=addedChunks;contentBytes+=addedContent;
        if(chunkCount>NOTE_LIMITS.chunks||contentBytes>NOTE_LIMITS.contentBytes)throw new NoteScanLimited();
        // Re-read immediately before staging; metadata alone never proves equality.
        const again=await readNote(admission.binding.workspace,relative,check);check();
        if(again.revision!==source.revision)throw new Error('source_unavailable');
        db.transaction(()=>{
          check();again.verify();if(state().dirty!==captured.dirty)throw new Error('superseded');
          // This writer exclusively owns the generation; source/chunks/FTS stage atomically.
          // A path absent from the existing lookup has nothing to replace (notably a full build).
          if(previousSource)deleteStagedPath(generation,relative);
          db.query('INSERT INTO note_retrieval_sources VALUES(?,?,?,?,?,?)').run(generation,relative,parsed.sourceRevision,source.bytes.length,Date.now(),captured.dirty);
          // Bun's SQLite string binding can strip an initial BOM. Bind raw UTF-8
          // and CAST to TEXT so stored content still matches the hashed byte range.
          for(const c of parsed.chunks){check();db.query('INSERT INTO note_retrieval_chunks(generation,path,chunk_id,revision,chunker,first_byte,after_last_byte,line_start,line_end,heading,kind,content) VALUES(?,?,?,?,?,?,?,?,?,?,?,CAST(? AS TEXT))').run(generation,relative,c.chunkId,parsed.sourceRevision,CHUNKER_VERSION,c.firstByte,c.afterLastByte,c.lineStart,c.lineEnd,JSON.stringify(c.headingPath),c.kind,Buffer.from(c.text,'utf8'));
            db.query('INSERT INTO note_retrieval_fts(content,heading,path,generation,chunk_id) VALUES(CAST(? AS TEXT),?,?,?,?)').run(Buffer.from(c.text,'utf8'),JSON.stringify(c.headingPath),relative,generation,c.chunkId);}
          check();again.verify();
        }).immediate();
      } catch(error){
        if(addedSource)sourceCount--;sourceBytes-=addedSource;chunkCount-=addedChunks;contentBytes-=addedContent;
        check();if(error instanceof NoteScanLimited||error instanceof NoteIndexDenied||(error as Error).message==='superseded')throw error;
        const excluded=error instanceof NoteSourceExcluded||error instanceof NoteChunkerExclusionError;
        if(excluded){exclusions++;excludedPaths.push(relative);}else unavailable++;
        // Authoritative exclusion removes this source only, even if the scan later stops.
        db.transaction(()=>{check();const current=state();
          if(current.dirty!==captured.dirty)throw new Error('superseded',{cause:error});
          if(excluded)deleteStagedPath(generation,relative);
          db.query('INSERT INTO note_retrieval_dirty VALUES(?,?,?) ON CONFLICT(path) DO UPDATE SET revision=excluded.revision,reason=excluded.reason').run(relative,current.dirty,excluded?'excluded_sources':'source_unavailable');
          db.query('UPDATE note_retrieval_state SET coverage=coverage+1 WHERE id=1').run();check();
        }).immediate();
      }
    };
    if(incremental){for(const relative of dirtyPaths){check();await processSource(relative);}}
    else await walkNotes(admission.binding.workspace,check,processSource);
    check();
    // An unavailable source is not evidence for deletion; retain the prior publication.
    if(unavailable)throw new Error('source_unavailable');
    db.transaction(()=>{
      check();const current=state();if(current.dirty!==captured.dirty||current.staging!==generation||current.writer_pid!==process.pid)throw new Error('superseded');
      if(!incremental){
        const staged=db.query('SELECT path FROM note_retrieval_sources WHERE generation=?').all(generation) as Array<{path:string}>;
        for(const row of staged)if(!seen.has(row.path))deleteStagedPath(generation,row.path);
      }
      if(current.published!==null)purge(current.published);
      db.query('DELETE FROM note_retrieval_dirty WHERE revision<=?').run(captured.dirty);
      for(const name of excludedPaths)db.query('INSERT INTO note_retrieval_dirty VALUES(?,?,?)').run(name,captured.dirty,'excluded_sources');
      db.query('UPDATE note_retrieval_state SET namespace=?,binding=?,format=?,published=?,staging=NULL,writer_pid=NULL,state=?,last_complete=?,coverage=coverage+1,reason=?,exclusions=? WHERE id=1').run(namespace,binding,NOTE_INDEX_FORMAT,generation,exclusions?'limited':'ready',incremental?captured.last_complete:Date.now(),exclusions?'excluded_sources':null,exclusions);
      check();
    }).immediate();
  } catch(error){
    // Revoked authority must not write even a failure marker into a replacement store.
    admission.validate();
    if(claimed)db.transaction(()=>{admission.validate();const current=state();if(current.writer_pid!==process.pid||current.staging!==generation)return;purge(generation);db.query('UPDATE note_retrieval_state SET staging=NULL,writer_pid=NULL,state=?,reason=?,coverage=coverage+1 WHERE id=1').run(error instanceof NoteScanLimited?'limited':'stale',error instanceof NoteScanLimited?'limit_exceeded':(error as Error).message==='cancelled'?'cancelled':'refresh_pending');admission.validate();}).immediate();
    throw error;
  }
}
