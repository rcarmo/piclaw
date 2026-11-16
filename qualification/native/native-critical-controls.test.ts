import './src/test-guard.js';
import {test, expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtempSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {context} from './src/fixture.ts';
import {hostSourceContractFixture} from './src/host-source-contract-fixture.ts';
import {createHostCommandPolicy} from '../../runtime/durable-engine/src/host-command-policy.ts';
import {barrier} from './src/fixture.ts';
import {resolveSettings} from '../../runtime/durable-engine/node_modules/@earendil-works/pi-durable/dist/harness/agent.js';

async function fixture(body: (f:any,binding:any)=>Promise<void>, guard: boolean | (<T>(run: () => Promise<T>) => Promise<T>) = true) {
 const dir=mkdtempSync(join(tmpdir(),'native-critical-')); const f=await hostSourceContractFixture(dir,'committed-ack-lost', false, {withIdleModelGuard:typeof guard === 'function' ? guard : guard ? async run=>run() : undefined});
 try {await f.open(); const binding={incarnation:f.incarnation,chatJid:f.chatJid,branchId:'main',conversationId:f.base.root.id};
  // This fixture owns an isolated DB, not production shared host work.

  await body(f,binding);
 } finally {await f.close();rmSync(dir,{recursive:true,force:true});}
}

test('native bash appends bounded command/output once without model generation or host input replay', async()=>fixture(async(f,b)=>{
 const before=f.snapshot(); const harness=(f.runtime as any).harness;
 const c=await harness.inspect(context); const result=await f.runtime.runSessionBash(b,'printf NATIVE_CONTEXT_BASH');
 expect(result).toEqual({output:'NATIVE_CONTEXT_BASH',exitCode:0,cancelled:false});
 const after=await harness.inspect(context);expect(after.tasks.length).toBe(c.tasks.length);expect(after.submissions.length).toBe(c.submissions.length);
 const conversation=await harness.conversation(b.conversationId,context);const entries=(await conversation.entries({},100,undefined,context)).items;const saved=entries.filter((e:any)=>e.kind==='host.bash');expect(saved.length).toBe(1);const entry=saved[0];expect(entry.data.output).toBe('NATIVE_CONTEXT_BASH');
 expect(entry.model[0].role).toBe('user');expect(entry.model[0].content).toContain('NATIVE_CONTEXT_BASH');
 expect(f.providerEntries).toBe(0);expect(f.snapshot()).toEqual(before);
 await f.runtime.reloadSession(b); expect(f.snapshot()).toEqual(before);expect(f.providerEntries).toBe(0);
}));

test('native bash cancellation is chat-bound, joins cleanup, and records no successful exit', async()=>fixture(async(f,b)=>{
 const running=f.runtime.runSessionBash(b,'printf START; sleep 10; printf SHOULD_NOT_RUN');
 for(let i=0;i<100&&!(f.runtime as any).commandBash.has(b.chatJid);i++)await Bun.sleep(5);
 await expect(f.runtime.abortSessionBash({...b,chatJid:'foreign'})).rejects.toThrow('conflict');
 expect(await f.runtime.abortSessionBash(b,true)).toBe(true);
 const result=await running;expect(result.cancelled).toBe(true);expect(result.output).not.toContain('SHOULD_NOT_RUN');
 expect(await f.runtime.abortSessionBash(b)).toBe(false);expect(f.providerEntries).toBe(0);
}));

test('native bash rejects stale ownership before spawn', async()=>fixture(async(f,b)=>{
 const path=join(tmpdir(),'native-critical-no-spawn-'+crypto.randomUUID());
 await expect(f.runtime.runSessionBash({...b,incarnation:'stale'},'touch '+path)).rejects.toThrow('binding conflict');expect(existsSync(path)).toBe(false);
 await expect(f.runtime.runSessionBash(b,'   ')).rejects.toThrow('Usage');

}));

test('native policy getters drive current SDK settings and retry persists without replay',async()=>{
 const priorAutoOverride=process.env.PICLAW_AUTO_COMPACTION_ENABLED;delete process.env.PICLAW_AUTO_COMPACTION_ENABLED;
 const db=new Database(':memory:');db.exec('CREATE TABLE router_state(key TEXT PRIMARY KEY,value TEXT)');let owner=true;
 const policy=createHostCommandPolicy(db,()=>{if(!owner)throw Error('owner lost');});
 try {
  expect(resolveSettings(policy.settings).retry.enabled).toBe(false);
  await policy.set('autoRetry',true);expect(resolveSettings(policy.settings).retry.enabled).toBe(true);
  const reopened=createHostCommandPolicy(db,()=>{});expect(reopened.read().autoRetry).toBe(true);
  await policy.set('autoRetry',false);expect(resolveSettings(policy.settings).retry.enabled).toBe(false);
  await policy.set('autoCompact',false);expect(resolveSettings(policy.settings).compaction.enabled).toBe(false);
  await policy.set('autoCompact',true);expect(resolveSettings(policy.settings).compaction.enabled).toBe(true);
  owner=false;await expect(policy.set('autoRetry',true)).rejects.toThrow('owner lost');expect(()=>policy.read()).toThrow('owner lost');
  db.query('UPDATE router_state SET value=? WHERE key=?').run('invalid','native.auto-retry.v1');expect(()=>reopened.read()).toThrow('unreadable');
 }finally{db.close();if(priorAutoOverride===undefined)delete process.env.PICLAW_AUTO_COMPACTION_ENABLED;else process.env.PICLAW_AUTO_COMPACTION_ENABLED=priorAutoOverride;}
});

test('native bash without shared guard fails closed',async()=>fixture(async(f,b)=>{await expect(f.runtime.runSessionBash(b,'printf NO')).rejects.toThrow('not idle');},false));


test('overlapping bash cannot replace the active cancellation or cleanup handle',async()=>fixture(async(f,b)=>{
 const running=f.runtime.runSessionBash(b,'printf START; sleep 10; printf MUST_NOT_RUN');
 await expect(f.runtime.runSessionBash(b,'printf SECOND_MUST_NOT_RUN')).rejects.toThrow('already running');
 await expect(f.runtime.reloadSession(b)).rejects.toThrow('not idle');
 expect(await f.runtime.abortSessionBash(b,true)).toBe(true);
 expect((await running).cancelled).toBe(true);
 expect((f.runtime as any).commandBash.size).toBe(0);expect((f.runtime as any).commandBashWaits.size).toBe(0);
 expect((await f.runtime.runSessionBash(b,'printf RECOVERED')).output).toBe('RECOVERED');
}));

test('bash cancellation while waiting for the shared guard prevents spawn',async()=>{
 const entered=barrier(), release=barrier();let holds=0;
 await fixture(async(f,b)=>{
  const running=f.runtime.runSessionBash(b,'printf PENDING_MUST_NOT_RUN');
  await entered.promise;
  const cancelling=f.runtime.abortSessionBash(b,true);
  release.release();expect(await cancelling).toBe(true);
  const result=await running;expect(result.cancelled).toBe(true);expect(result.output).not.toContain('PENDING_MUST_NOT_RUN');
  expect((await f.runtime.runSessionBash(b,'printf NEXT')).output).toBe('NEXT');
 },async run=>{if(holds++===0){entered.release();await release.promise;}return run();});
});

test('bash output is bounded, reload adds no generation, and released ownership rejects reuse',async()=>fixture(async(f,b)=>{
 const result=await f.runtime.runSessionBash(b,"head -c 50000 /dev/zero | tr '\\0' X");
 expect(result.output.length).toBe(20000);
 const conversation=await (f.runtime as any).harness.conversation(b.conversationId,context);
 const entries=(await conversation.entries({},100,undefined,context)).items;
 expect(entries.filter((e:any)=>e.kind==='host.bash')[0].data.truncated).toBe(true);
 await f.runtime.reloadSession(b);expect(f.providerEntries).toBe(0);
 await f.runtime.close();await expect(f.runtime.reloadSession(b)).rejects.toThrow();
}));
