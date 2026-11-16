import './src/test-guard.js';
import {expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Harness} from '../../runtime/durable-engine/qualification/durable.ts';
import {SqliteStorage} from '../../runtime/durable-engine/qualification/sqlite.ts';
import {createHostCommandPolicy} from '../../runtime/durable-engine/src/host-command-policy.js';
import {withTaskModelRequestScope,taskModelRequestScope} from '../../runtime/durable-engine/src/task-model-boundary-shim.ts';
import {saveCompactionSettings} from '../../runtime/src/channels/web/handlers/compaction-settings.js';
import {isolatedApplicationTest} from './src/isolated-application-test.js';
import {TestOwner,OwnedSqlite} from './src/ownership.js';
import {openFixture,context,barrier} from './src/fixture.js';
const applicationTest=isolatedApplicationTest(import.meta.url);

for(const threshold of ['background','blocking'] as const) applicationTest(`native settings change actual ${threshold} compaction admission without replacing accepted maintenance`,async()=>{
  // This fixture owns its environment; the API separately rejects a conflicting
  // valid deprecated override rather than reporting an ineffective save.
  delete process.env.PICLAW_AUTO_COMPACTION_ENABLED;
  const dir=await mkdtemp(join(process.env.PICLAW_WORKSPACE!,'native-compaction-settings-'));
  const owner=TestOwner.acquire(join(dir,'native.db'));
  const root=new Database(':memory:'); root.exec('CREATE TABLE router_state(key TEXT PRIMARY KEY,value TEXT)');
  const policy=createHostCommandPolicy(root,()=>owner.assert());
  const openStorage=()=>SqliteStorage.open(new OwnedSqlite(owner));
  const f=await openFixture(owner,()=>{},openStorage); await f.close();
  let harness:Harness|undefined;
  const entered=barrier(),release=barrier();
  try{
    harness=await Harness.open(await openStorage(),{models:f.models,registry:withTaskModelRequestScope(f.registry),settings:policy.settings},context);
    const seed=async()=>{
      const conversation=await harness!.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'qualification',modelId:'synthetic'},tools:[]}},context);
      await conversation.commit(async tx=>{
        for(let n=0;n<4;n++)await tx.appendEntry(conversation.id,{kind:'pi.user',model:[{role:'user',content:'facts '.repeat(threshold==='background'?12000:19000),timestamp:n}]});
      },context);
      return conversation;
    };
    const off=await seed();
    expect((await saveCompactionSettings({autoCompactionEnabled:false})).autoCompactionEnabled).toBe(false);
    const first=await off.submit({type:'input',requestId:'automatic-disabled',content:'Continue with automatic compaction disabled'},context);
    expect((await first.wait(context)).status).toBe('done');
    expect((await off.entries({},100,undefined,context)).items.filter(e=>e.kind==='pi.compaction')).toEqual([]);
    expect((await harness.inspect(context)).tasks.filter(t=>t.record.kind==='pi.compaction')).toEqual([]);
    expect(f.host.modelCalls).toBe(1);

    const on=await seed(); let summaryRequests=0;
    f.host.onModelEnter=signal=>{
      const scope=taskModelRequestScope(signal);
      if(scope?.taskKind==='pi.compaction'){summaryRequests++;f.host.modelHold=release;entered.release();}
    };
    expect((await saveCompactionSettings({autoCompactionEnabled:true})).autoCompactionEnabled).toBe(true);
    const second=await on.submit({type:'input',requestId:'automatic-enabled',content:'Continue with native automatic compaction'},context);
    await entered.promise;
    const task=(await harness.inspect(context)).tasks.find(t=>t.record.kind==='pi.compaction')!;
    expect(task).toBeDefined();expect(task.record.conversationId).toBe(on.id);
    expect(task.record.input).toEqual({reason:'threshold'});
    expect(task.record.background).toBe(threshold==='background');
    expect(summaryRequests).toBe(1);
    // A policy edit affects future decisions. It cannot cancel or replace an
    // accepted summary, change its request identity, or rewrite either input.
    expect((await saveCompactionSettings({autoCompactionEnabled:false})).autoCompactionEnabled).toBe(false);
    expect((await harness.inspect(context)).tasks.find(t=>t.record.id===task.record.id)?.record).toEqual(task.record);
    release.release(); f.host.modelHold=undefined;
    expect((await second.wait(context)).status).toBe('done');
    const outcome=await harness.waitForTask(task.record.id,context);
    expect(outcome.state.status).toBe('terminal');
    expect(outcome.state.outcome.status).toBe('completed');
    expect((await on.entries({},100,undefined,context)).items.filter(e=>e.kind==='pi.compaction')).toHaveLength(1);
    expect(summaryRequests).toBe(1);expect(f.host.credentialLookups).toBe(0);
    expect((await first.status(context)).id).toBe(first.id);
    expect((await second.status(context)).id).toBe(second.id);
    process.env.PICLAW_AUTO_COMPACTION_ENABLED='1';
    await expect(policy.set('autoCompact',false)).rejects.toThrow('overridden by PICLAW_AUTO_COMPACTION_ENABLED');
    expect(policy.read().autoCompact).toBe(true);
  }finally{
    release.release(); await harness?.close(context); root.close();owner.releaseAfterClose();owner.closeConnection();
    await rm(dir,{recursive:true,force:true});
  }
},20000);
