import './src/test-guard.js';
import {expect,test} from 'bun:test';
import {join} from 'node:path';
import {createHostController,type HostControllerOptions} from '../../runtime/durable-engine/src/host-controller.js';
import {HostCutoverController,initializeCutoverManifest} from '../../runtime/durable-engine/src/host-cutover.js';
import {AcceptedReplyThreadUnavailableError} from '../../runtime/durable-engine/src/host-message-thread.js';
import {defineDoc,type Harness} from '../../runtime/durable-engine/qualification/durable.js';
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

for(const mode of ['idle','host-changed','candidate-document','retired-document','terminal-records','pending','inflight','held-read','held-read-close','close-first','close-fault'] as const)test(`native rollback refuses unavailable historical proof and retains owner: ${mode}`,async()=>{
  const f=await nativeMessageFixture(),events:string[]=[],held=barrier(),entered=barrier(),providerEntered=barrier();
  let controller:Awaited<ReturnType<typeof createHostController>>|undefined,storage:Awaited<ReturnType<typeof f.options.openStorage>>|undefined,actualClose:(()=>Promise<void>)|undefined,holdRead=false,signal:AbortSignal|undefined;
  const lease=f.ownerLease();let released=false;
  try{
    await f.open();if(mode==='pending')f.base.host.modelHold=barrier();
    const primary=f.accept('native rollback source'),id=await f.runtime.submitMessage(primary);if(mode!=='pending')await f.runtime.waitForMessage(primary,id);await f.controller.close();
    if(mode==='terminal-records'){
      const offline=await f.options.openStorage();try{
        const tasks=await offline.scanTasks({status:'terminal'},1000,undefined,context),submissions=await offline.scanSubmissions({status:'done'},1000,undefined,context);expect(tasks.items.length).toBeGreaterThan(0);expect(submissions.items.length).toBeGreaterThan(0);
        await offline.commit([{type:'task',value:{...tasks.items[0]!,memos:undefined,state:{status:'terminal',outcome:{status:'completed',result:'historical-only-change'}}}},{type:'submission',value:{...submissions.items[0]!,requestId:'historical-only-terminal'}}],context);
      }finally{await offline.close(context);}
    }
    const get=f.bindings.get.bind(f.bindings);
    controller=await createHostController({acquireOwnership:async()=>{events.push('owner');return {assertCurrentOwner:lease.assertCurrentOwner,release(){released=true;events.push('release');lease.release();}};},async createStorage(owner){owner.assertCurrentOwner();events.push('storage');storage=await f.options.openStorage();const close=storage.close.bind(storage);actualClose=()=>close(context);storage.close=async ctx=>{events.push('close');if(mode==='close-fault')throw Error('must not close without proof');await close(ctx);};return storage;},runtime:{...f.options,bindings:{...f.bindings,async get(input){const value=await get(input);if(holdRead){entered.release();await held.promise;}return value;}}},recovery:{manifest:[{chatJid:f.chat,branchId:'main',conversationId:f.base.root.id}],work:f.work,bindings:f.bindings,async readAcceptedInput(){throw Error('Native recovery must stay in the SDK');}}},context);
    let providerCount=0;f.base.host.onModelEnter=actual=>{providerCount++;signal=actual;providerEntered.release();};
    if(mode==='inflight'){f.base.host.modelHold=barrier();await controller.runtime.submitMessage(f.accept('fresh admitted active request'));await providerEntered.promise;expect(signal?.aborted).toBe(false);}
    initializeCutoverManifest(f.root);const digest='a'.repeat(64),receipt={sourceDigest:digest,receiptHash:digest};
    const cutover=new HostCutoverController(f.root,{domain:'rollback-fixture',incarnation:'historical',ownerGeneration:f.owner().generation,sourceEngineId:'legacy',candidateStoreRef:'candidate'},{assertOwner:lease.assertCurrentOwner,assertCurrentWriter:lease.assertCurrentOwner,checkDrained(){return {sourceDigest:digest,pending:0,inflight:0};}});
    let manifest=cutover.preflight({requestKey:'rollback',sourceDigest:digest,importHash:digest});manifest=await cutover.begin(manifest.revision,{async copy(){return receipt;},async importCopied(){return receipt;}});manifest=await cutover.verify(manifest.revision,async()=>receipt);manifest=cutover.commitWriter(manifest.revision);const before=cutover.inspect();
    await expect(controller.checkpointCutover(cutover)).rejects.toThrow('Candidate progress proof unavailable');expect(cutover.inspect()).toEqual(before);
    if(mode==='host-changed')f.root.query('INSERT INTO router_state(key,value) VALUES (?,?)').run('changed-after-checkpoint','retained');
    if(mode==='candidate-document'||mode==='retired-document'){
      const h=Reflect.get(controller.runtime,'harness') as Harness,Doc=defineDoc({kind:'qualification.rollback-document',version:1,scope:'session',checkpointWhen:()=>false,initial:()=>({outcome:''})});
      const query={scope:{kind:'session' as const},at:'current' as const},documents=await storage!.scanDocuments(query,1000,undefined,context);
      await h.commit(async tx=>{(await tx.doc(Doc)).outcome='committed';},context);
      if(mode==='retired-document'){await h.commit(tx=>tx.retireDoc(Doc),context);expect(await storage!.scanDocuments(query,1000,undefined,context)).toEqual(documents);}
    }
    let flips=0;cutover.rollback=()=>{flips++;throw Error('Historical proof cannot be guessed');};
    let observer:Promise<unknown>|undefined,concurrent:Promise<void>|undefined;
    if(mode.startsWith('held-read')||mode==='close-first'){holdRead=true;observer=controller.runtime.waitForMessage(primary,id);void observer.catch(()=>{});await entered.promise;}
    if(mode==='close-first'){
      concurrent=controller.close();await expect(controller.rollback(cutover,manifest.revision)).rejects.toThrow('Controller already closing');await expect(observer!).rejects.toThrow();await concurrent;held.release();expect(events).toEqual(['owner','storage','close','release']);expect(flips).toBe(0);return;
    }
    const access:string[]=[];
    if(mode==='idle'){
      expect(()=>controller!.rollback(undefined as never,manifest.revision)).toThrow(TypeError);
      for(const field of ['prepareRollback','rollback'] as const)expect(()=>controller!.rollback({prepareRollback:cutover.prepareRollback,rollback:cutover.rollback,[field]:undefined} as never,manifest.revision)).toThrow(TypeError);
      const prepare=cutover.prepareRollback,rollback=cutover.rollback;Object.defineProperties(cutover,{prepareRollback:{configurable:true,get(){access.push('prepare');return prepare;}},rollback:{configurable:true,get(){access.push('rollback');return rollback;}}});
    }
    const attempt=controller.rollback(cutover,manifest.revision);
    if(mode==='idle'){expect(access).toEqual(['prepare','rollback']);Object.defineProperties(cutover,{prepareRollback:{value(){throw Error('late prepare');}},rollback:{value(){throw Error('late rollback');}}});}
    if(observer){if(mode==='held-read-close'){concurrent=controller.close();void concurrent.catch(()=>{});}await expect(observer).rejects.toThrow();await Promise.resolve();expect(events).toEqual(['owner','storage']);lease.assertCurrentOwner();expect(flips).toBe(0);held.release();}
    await expect(attempt).rejects.toThrow(mode==='pending'||mode==='inflight'?'Candidate not quiescent':'Candidate progress proof unavailable');expect(cutover.inspect()).toEqual(before);expect(flips).toBe(0);expect(events).toEqual(['owner','storage']);lease.assertCurrentOwner();expect(released).toBe(false);
    await expect(controller.rollback(cutover,manifest.revision)).rejects.toThrow('Controller already closing');expect(()=>controller!.runtime.readSessionModel(f.binding)).toThrow();
    if(mode==='pending')expect(providerCount).toBe(0);if(mode==='inflight')expect(signal?.aborted).toBe(false);if(concurrent)await expect(concurrent).rejects.toThrow('Candidate progress proof unavailable');
  }finally{
    held.release();f.base.host.modelHold?.release();
    if(controller){
      try{const closing=(Reflect.get(controller.runtime,'harness') as Harness).close(context);if(mode==='close-fault')await expect(closing).rejects.toThrow('must not close without proof');else await closing;}
      finally{await actualClose?.();if(!released){lease.release();released=true;}}
    }
    await f.close();
  }
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
