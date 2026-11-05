import './src/test-guard.js';
import {expect,test} from 'bun:test';
import {readdir,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {TestOwner} from './src/ownership.js';
import {nativeMessageFixture} from './src/native-message-fixture.js';
import {prepareNativeMessageRecovery,type NativeRecoveryCheckpoint,type RecoveryBoundary} from './src/native-message-recovery-fixture.js';

async function crash(boundary:RecoveryBoundary){
  const child=Bun.spawn([process.execPath,'src/accepted-steer-recovery-child.ts',boundary],{cwd:import.meta.dir,env:{...process.env},stdout:'pipe',stderr:'pipe'});
  const stderr=new Response(child.stderr).text();
  try{
    const reader=child.stdout.getReader();let pending='';
    const checkpoint=await Promise.race([(async()=>{while(true){const next=await reader.read();if(next.done)throw Error('Child exited before checkpoint: '+await stderr);pending+=new TextDecoder().decode(next.value);let end:number;while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);let event:any;try{event=JSON.parse(line);}catch{continue;}if(event.event==='native-message-checkpoint')return event as NativeRecoveryCheckpoint;}}})(),Bun.sleep(10000).then(()=>{throw Error('Child checkpoint timeout');})]);
    reader.releaseLock();expect(child.exitCode).toBeNull();
    const path=join(checkpoint.identity.workspace.store,'messages.db');
    expect(()=>TestOwner.acquire(path)).toThrow('owner busy');
    child.kill('SIGKILL');await child.exited;expect(child.signalCode).toBe('SIGKILL');
    expect(()=>process.kill(checkpoint.pid,0)).toThrow();return checkpoint;
  }finally{child.kill('SIGKILL');await child.exited;await stderr;}
}

for(const {mode,boundary} of [
  {mode:'clean-close',boundary:'before-submit'},
  {mode:'clean-close',boundary:'committed-ack-lost'},
  {mode:'SIGKILL',boundary:'before-submit'},
  {mode:'SIGKILL',boundary:'committed-ack-lost'},
  {mode:'SIGKILL-ack-repair',boundary:'committed-ack-lost'},
] as const)test(`native accepted steering recovery: ${boundary}/${mode}`,async()=>{
  const prepared=mode==='clean-close'?await prepareNativeMessageRecovery(boundary):undefined;
  const checkpoint=prepared?.checkpoint??await crash(boundary);
  const f=prepared?.f??await nativeMessageFixture(checkpoint.identity);
  let entries=0;f.base.host.onModelEnter=()=>{entries++;};
  try{
    if(prepared)await f.reopen();else await f.open();
    expect(f.owner().generation).toBe(checkpoint.generation+1);
    expect(f.owner().pid).toBe(process.pid);
    expect(f.sdkSnapshot()).toEqual(checkpoint.snapshot);
    expect(entries).toBe(0);expect(checkpoint.providerEntries).toBe(1);
    expect((await f.runtime.inspectAuthority()).inspection.scheduling).toBe('paused');
    expect(f.root.query('PRAGMA foreign_keys').get()).toEqual({foreign_keys:1});
    expect(f.root.query('PRAGMA integrity_check').all()).toEqual([{integrity_check:'ok'}]);
    expect(f.root.query('PRAGMA foreign_key_check').all()).toEqual([]);
    const path=join(f.identity.workspace.store,'messages.db');
    const inode=(await stat(path)).ino;expect(inode).toBeGreaterThan(0);
    const files:string[]=[];const walk=async(dir:string)=>{for(const entry of await readdir(dir,{withFileTypes:true})){const p=join(dir,entry.name);if(entry.isDirectory())await walk(p);else files.push(p);}};await walk(f.identity.workspace.base);
    expect(files.filter(p=>![path,path+'-wal',path+'-shm'].includes(p))).toEqual([]);
    await f.controller.reconcileRecovered();expect(entries).toBe(0);expect(f.sdkSnapshot()).toEqual(checkpoint.snapshot);
    const binding=await f.bindings.get(checkpoint.queued);expect(binding?.submissionId).toBeNull();
    const queued=await f.runtime.messageSubmissionStatus(checkpoint.queued);
    if(boundary==='before-submit')expect(queued).toBeUndefined();
    else{expect(queued?.id).toBe(checkpoint.queuedId);expect(queued?.status).toBe('queued');}
    const before=f.sdkSnapshot();
    await expect(f.runtime.submitMessage({...checkpoint.queued,requestHash:'f'.repeat(64)},'steer')).rejects.toThrow();
    expect(f.sdkSnapshot()).toEqual(before);expect(entries).toBe(0);
    if(mode==='SIGKILL-ack-repair'&&checkpoint.queuedId!==undefined){
      expect(await f.runtime.submitMessage(checkpoint.queued,'steer')).toBe(checkpoint.queuedId);
      expect((await f.bindings.get(checkpoint.queued))?.submissionId).toBe(checkpoint.queuedId);
      expect(f.sdkSnapshot()).toEqual(before);expect(entries).toBe(0);
    }
    // Explicit cleanup of the interrupted accepted scope is SDK abort, not
    // resumption of a cancelled provider turn or repair through a host FIFO.
    await f.runtime.abortMessages(f.binding);
    expect(await f.runtime.waitForMessage(checkpoint.primary,checkpoint.primaryId)).toMatchObject({status:'unanswered',reason:'aborted'});
    const lostWithdrawal=checkpoint.queuedId!==undefined&&mode!=='SIGKILL-ack-repair';
    if(checkpoint.queuedId!==undefined){
      expect(await f.runtime.readSubmissionStatus(checkpoint.queued.conversationId,checkpoint.queuedId)).toMatchObject({status:'unanswered',reason:'aborted'});
      if(lostWithdrawal)await expect(f.runtime.waitForMessage(checkpoint.queued,checkpoint.queuedId)).rejects.toThrow('Submission binding conflict');
      else expect(await f.runtime.waitForMessage(checkpoint.queued,checkpoint.queuedId)).toMatchObject({status:'unanswered',reason:'aborted'});
    }
    expect(entries).toBe(0);
    const cancelled=f.sdkSnapshot();
    expect(await f.runtime.submitMessage(checkpoint.primary)).toBe(checkpoint.primaryId);
    if(checkpoint.queuedId!==undefined){
      // Withdrawal has removed public inbox content. Without the earlier ACK,
      // a request ID alone is not authority to repair or resubmit that input.
      if(lostWithdrawal)await expect(f.runtime.submitMessage(checkpoint.queued,'steer')).rejects.toThrow('Submission binding conflict');
      else expect(await f.runtime.submitMessage(checkpoint.queued,'steer')).toBe(checkpoint.queuedId);
    }
    expect(f.sdkSnapshot()).toEqual(cancelled);expect(entries).toBe(0);
    f.base.host.modelHold=undefined;
    const successor=f.accept('fresh independently accepted successor'),successorId=await f.runtime.submitMessage(successor);
    expect((await f.runtime.waitForMessage(successor,successorId)).status).toBe('done');expect(entries).toBe(1);
    expect((await f.runtime.readMessageResult(successor))?.answer?.text).toBe('synthetic answer');
    expect(await f.runtime.submitMessage(successor)).toBe(successorId);expect(entries).toBe(1);
    expect(f.root.query('SELECT * FROM service_effect_s01_operations').all()).toEqual([]);
    expect(f.root.query('SELECT * FROM service_effect_s02_commits').all()).toEqual([]);
    expect(f.root.query('SELECT source_id,payload_ref FROM service_effect_s01_sources WHERE source_seq=? AND chat_jid=?').get(checkpoint.queued.sourceSeq,f.chat)).toEqual({source_id:checkpoint.queued.sourceId,payload_ref:checkpoint.queued.payloadRef});
    expect(f.base.host.effects).toBe(0);expect(f.base.host.credentialLookups).toBe(0);
  }finally{prepared?.restore();prepared?.held.release();await f.close();}
},20000);
