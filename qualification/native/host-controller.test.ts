import './src/test-guard.js';
import {expect,test} from 'bun:test';
import {join} from 'node:path';
import {createHostController,type HostControllerOptions} from '../../runtime/durable-engine/src/host-controller.js';
import {AcceptedReplyThreadUnavailableError} from '../../runtime/durable-engine/src/host-message-thread.js';
import {type Harness} from '../../runtime/durable-engine/qualification/durable.js';
import {nativeMessageFixture} from './src/native-message-fixture.js';
import {historicalIntentFixture} from './src/historical-intent-fixture.js';
import {TestOwner} from './src/ownership.js';
import {barrier,context} from './src/fixture.js';
import {at,effect,sealed,value} from './src/host-handoff.js';
import {backgroundPolicyFixture,backgroundPolicyReopenFixture,backgroundPolicyOwnerFixture} from './background-policy-fixture.ts';

test('background policy SDK: paused disk reopen preserves quota and same-input replay',backgroundPolicyReopenFixture);
test('background policy SDK: document owner matches its public registration',backgroundPolicyOwnerFixture);
for(const mode of ['allowed','limit','ceiling','forged-call','revoked','expired','configuration','parallel','reused-call-id','api-change','long-call'] as const)test(`background policy SDK: ${mode}`,()=>backgroundPolicyFixture(mode));

for(const mode of ['known','unknown','background','missing','bootstrap-close-failure','shutdown-close-failure','operator-abort'] as const)test(`owner-first native controller: ${mode}`,async()=>{
  const f=await nativeMessageFixture(),events:string[]=[],entered=barrier();
  let controller:Awaited<ReturnType<typeof createHostController>>|undefined,storage:Awaited<ReturnType<typeof f.options.openStorage>>|undefined,actualClose:(()=>Promise<void>)|undefined;
  const lease=f.ownerLease();let uncertain=false;
  try{
    await f.open();
    if(mode==='operator-abort')f.base.host.modelHold=barrier();
    const primary=f.accept('actual accepted native work'),id=await f.runtime.submitMessage(primary);
    if(mode!=='operator-abort')await f.runtime.waitForMessage(primary,id);
    if(mode==='unknown'||mode==='bootstrap-close-failure'){
      f.base.host.modelHold=barrier();
      await (await (Reflect.get(f.runtime,'harness') as Harness).conversation(f.base.root.id,context))!.submit({type:'input',requestId:'unknown-public-input',content:'no accepted Root source'},context);
    }
    if(mode==='background'){
      const task={definition:{name:'qualification-independent-background',version:1,initial:(_input:null)=>({phase:'held' as const}),phases:{held:async()=>{throw Error('Unknown background must not execute');}},abort:async()=>{throw Error('Unknown background must not abort');}}};
      await (Reflect.get(f.runtime,'harness') as Harness).commit(tx=>tx.createTask(task,null,{ownership:{kind:'conversation'},conversationId:f.base.root.id,background:true}),context);
    }
    await f.controller.close();
    let providers=0;f.base.host.onModelEnter=()=>{providers++;entered.release();};
    const options:HostControllerOptions={acquireOwnership:async()=>{lease.assertCurrentOwner();events.push('owner');return {assertCurrentOwner:lease.assertCurrentOwner,release(){events.push('release');lease.release();}};},
      async createStorage(owner){owner.assertCurrentOwner();expect(events).toEqual(['owner']);events.push('storage');expect(()=>TestOwner.acquire(join(f.identity.workspace.store,'messages.db'))).toThrow('owner busy');storage=await f.options.openStorage();const close=storage.close.bind(storage);actualClose=()=>close(context);storage.close=async ctx=>{if(mode.endsWith('close-failure')){uncertain=true;events.push('close-failed');throw Error('storage cleanup uncertain');}await close(ctx);events.push('close');};return storage;},
      runtime:{...f.options,existingConversationIds:[mode==='missing'?999999 as typeof f.base.root.id:f.base.root.id]},recovery:{manifest:[{chatJid:f.chat,branchId:'main',conversationId:f.base.root.id}],work:f.work,bindings:f.bindings,async readAcceptedInput(){throw Error('Native input must not be reconstructed');}}};
    const opening=createHostController(options,context);Object.assign(options.runtime,{existingConversationIds:[]});options.recovery.readAcceptedInput=async()=>{throw Error('late replacement');};
    if(['unknown','background','missing','bootstrap-close-failure'].includes(mode)){
      await expect(opening).rejects.toThrow(mode==='bootstrap-close-failure'?'storage cleanup uncertain':mode==='missing'?'Missing manifest conversation':'Unknown recovered candidate authority');
    }else{
      controller=await opening;expect((await controller.runtime.inspectAuthority()).inspection.scheduling).toBe('paused');expect(providers).toBe(0);
      if(mode==='operator-abort'){
        await controller.runtime.abortMessages(f.binding);expect(await controller.runtime.waitForMessage(primary,id)).toMatchObject({status:'unanswered',reason:'aborted'});expect(providers).toBe(0);
        expect(await controller.runtime.submitMessage(primary)).toBe(id);expect(providers).toBe(0);
      }else if(mode==='known'){await controller.reconcileRecovered();expect((await controller.runtime.readMessageResult(primary))?.answer?.text).toBe('synthetic answer');expect(providers).toBe(0);}
      const closing=controller.close();expect(controller.close()).toBe(closing);
      if(mode==='shutdown-close-failure'){await expect(closing).rejects.toThrow('storage cleanup uncertain');expect(controller.close()).toBe(closing);}else await closing;
    }
    expect(providers).toBe(0);
    if(uncertain){expect(events).toEqual(['owner','storage','close-failed']);lease.assertCurrentOwner();expect(()=>TestOwner.acquire(join(f.identity.workspace.store,'messages.db'))).toThrow('owner busy');await actualClose!();lease.release();}
    else{expect(events).toEqual(['owner','storage','close','release']);const other=TestOwner.acquire(join(f.identity.workspace.store,'messages.db'));other.releaseAfterClose();other.closeConnection();}
    expect(f.root.query('SELECT * FROM service_effect_s01_operations').all()).toEqual([]);expect(f.root.query('SELECT * FROM service_effect_s02_commits').all()).toEqual([]);
  }finally{f.base.host.modelHold?.release();if(!uncertain)await controller?.close();else{await actualClose?.();lease.release();}await f.close();}
},15000);

for(const mode of ['committed-answer','unavailable-thread','unrelated-error','cancelled'] as const)test(`historical retained SDK evidence: ${mode} never needs another provider call`,async()=>{
  const h=await historicalIntentFixture(mode==='cancelled'?true:'completed'),{f}=h;let controller:Awaited<ReturnType<typeof createHostController>>|undefined;
  try{
    if(mode==='cancelled'){
      await h.bindings.intents!.recordSubmission(h.intent,h.intentId!);
      const op=value(await h.recovery.work.getOperation(h.primary.operationId))!,id='historical-user-cancel';
      f.root.transaction(()=>h.recovery.work.acceptAndCancelSourceInTransaction(sealed({effect:effect(id),chatJid:f.chat,sourceId:id,kind:'cancellation',payloadRef:id,targetOperationId:h.primary.operationId,parentSourceSeq:h.primary.sourceSeq,acceptedAt:at,createWakeIntent:false}),op.version,'operator_abort',f.root)).immediate();
    }
    let calls=0;f.base.host.onModelEnter=()=>{calls++;};
    controller=await createHostController({acquireOwnership:async()=>({assertCurrentOwner:f.options.owner.assert,release(){}}),createStorage:f.options.openStorage,runtime:{...f.options,work:h.recovery.work,bindings:h.bindings,terminal:h.terminal,putAnswer:h.putAnswer,cancelOperationSource:mode==='cancelled'?async(input,expectedVersion)=>{f.options.owner.assert();const op=value(await h.recovery.work.getOperation(input.operationId));if(!op||op.version!==expectedVersion||!op.cancellation)throw Error('Historical cancellation proof changed');}:undefined,replyThreadFor(){if(mode==='unavailable-thread')throw new AcceptedReplyThreadUnavailableError();if(mode==='unrelated-error')throw Error('settlement failed');return null;}},recovery:h.recovery},context);
    expect((await controller.runtime.inspectAuthority()).inspection.scheduling).toBe('paused');
    if(mode==='unrelated-error')await expect(controller.reconcileRecovered()).rejects.toThrow('settlement failed');
    else{
      await controller.reconcileRecovered();const snapshot=['messages','service_effect_s01_sources','service_effect_s01_operations','service_effect_s02_commits'].map(table=>f.root.query(`SELECT * FROM ${table} ORDER BY rowid`).all());
      await controller.reconcileRecovered();expect(['messages','service_effect_s01_sources','service_effect_s01_operations','service_effect_s02_commits'].map(table=>f.root.query(`SELECT * FROM ${table} ORDER BY rowid`).all())).toEqual(snapshot);
      expect((await controller.runtime.reconcile(h.primary)).operation.terminal?.disposition??null).toBe(mode==='committed-answer'?'completed':mode==='cancelled'?'cancelled':null);
      if(mode==='unavailable-thread'||mode==='cancelled')expect(f.root.query('SELECT * FROM messages WHERE is_bot_message=1').all()).toEqual([]);
    }
    expect(calls).toBe(0);const final=await controller.runtime.inspectAuthority();expect(final.inspection.scheduling).toBe(mode==='cancelled'?'running':'paused');if(mode==='cancelled')expect(final.inspection.tasks).toHaveLength(0);
  }finally{await controller?.close();await f.close();}
},15000);

test('native controller has no cutover/rollback API and ordinary close detaches a held reader before releasing confirmed storage', async () => {
  const f=await nativeMessageFixture(),held=barrier(),entered=barrier(),events:string[]=[];
  const lease=f.ownerLease(),get=f.bindings.get.bind(f.bindings);let holding=false;
  let controller:Awaited<ReturnType<typeof createHostController>>|undefined;
  try {
    await f.open();const source=f.accept('native source'),id=await f.runtime.submitMessage(source);
    await f.runtime.waitForMessage(source,id);await f.controller.close();
    controller=await createHostController({acquireOwnership:async()=>({assertCurrentOwner:lease.assertCurrentOwner,release(){events.push('release');lease.release();}}),
      async createStorage(owner){owner.assertCurrentOwner();const storage=await f.options.openStorage(),close=storage.close.bind(storage);storage.close=async ctx=>{await close(ctx);events.push('close');};return storage;},
      runtime:{...f.options,bindings:{...f.bindings,async get(input){const result=await get(input);if(holding){entered.release();await held.promise;}return result;}}},
      recovery:{manifest:[{chatJid:f.chat,branchId:'main',conversationId:f.base.root.id}],work:f.work,bindings:f.bindings,async readAcceptedInput(){throw Error('Native recovery stays in the SDK');}}},context);
    expect(controller).not.toHaveProperty('rollback');expect(controller).not.toHaveProperty('checkpointCutover');
    holding=true;const observation=controller.runtime.waitForMessage(source,id);void observation.catch(()=>{});await entered.promise;
    const closing=controller.close();expect(controller.close()).toBe(closing);
    await expect(observation).rejects.toThrow();await closing;
    expect(events).toEqual(['close','release']);
  } finally {held.release();await controller?.close();await f.close();}
},15000);
