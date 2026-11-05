import './src/test-guard.js';
import {expect,test,spyOn} from 'bun:test';
import {historicalIntentFixture} from './src/historical-intent-fixture.js';
import {reconstituteAcceptedWork} from '../../runtime/durable-engine/src/host-recovery.js';
import {HostConversationRuntime} from '../../runtime/durable-engine/src/host-runtime.js';
import {createHostController} from '../../runtime/durable-engine/src/host-controller.js';
import {context} from './src/fixture.js';
import {at,effect,sealed,value} from './src/host-handoff.js';
import type {AcceptedSourceSnapshot} from '../../runtime/src/service-effects/contracts/service-work-store.js';

for(const accepted of [false,true])test(`historical source discovery is passive and intent reconciliation never submits input: SDK accepted=${accepted}`,async()=>{
  const h=await historicalIntentFixture(accepted),{f}=h;
  let controller:Awaited<ReturnType<typeof createHostController>>|undefined;
  const noSubmit=spyOn(HostConversationRuntime.prototype,'submitIntent').mockRejectedValue(Error('Host recovery may not submit an intent'));
  try{
    const options={incarnation:f.domain,binding:h.recovery.manifest[0]!,runningBinding:{sessionId:f.domain},assertOwner:f.options.owner.assert,work:h.recovery.work,bindings:h.bindings,readAcceptedInput:h.recovery.readAcceptedInput};
    const contractWork={listOpenOperations:options.work.listOpenOperations.bind(options.work),getOperation:options.work.getOperation.bind(options.work),getSourceBySeq:options.work.getSourceBySeq.bind(options.work),getQueuedInputIntent:options.work.getQueuedInputIntent.bind(options.work)};
    const sdk=f.sdkSnapshot(),calls=f.base.host.modelCalls;
    const recovered=await reconstituteAcceptedWork(options);expect(recovered.map(row=>row.role)).toEqual(['primary','intent']);expect(recovered[0]!.input).toEqual(h.primary);expect(recovered[0]!.binding?.submissionId).toBe(h.primaryId);expect(recovered[1]!.input).toEqual(h.intent);expect(recovered[1]!.binding?.submissionId).toBeNull();
    expect(f.sdkSnapshot()).toEqual(sdk);expect(f.base.host.modelCalls).toBe(calls);
    const reader=options.readAcceptedInput;
    await expect(reconstituteAcceptedWork({...options,async readAcceptedInput(source){return {...await reader(source),content:'swapped primary bytes'};}})).rejects.toThrow('Unverified recovered authority');
    await expect(reconstituteAcceptedWork({...options,runningBinding:{sessionId:'other'}})).rejects.toThrow('Unverified recovered authority');
    await expect(reconstituteAcceptedWork({...options,async readAcceptedInput(source){const loaded=await reader(source);return {...loaded,claimed:{...loaded.claimed,source:{...loaded.claimed.source,provenanceRef:'invented-provenance'}}};}})).rejects.toThrow('Unverified recovered authority');
    const intent=recovered[1]!;
    await expect(reconstituteAcceptedWork({...options,work:{...contractWork,getSourceBySeq(chat,seq){return seq===h.intent.sourceSeq?null:options.work.getSourceBySeq(chat,seq);}}})).rejects.toThrow('Unverified recovered authority');
    const intentRow=f.root.query('SELECT * FROM service_effect_s01_intents WHERE operation_id=? AND intent_id=?').get(h.primary.operationId,h.intent.requestId) as Record<string,string>;
    const bindings=()=>['piclaw_durable_bindings_v1','piclaw_durable_intent_bindings_v1'].map(table=>f.root.query(`SELECT * FROM ${table} ORDER BY rowid`).all()),before=bindings();
    const restore=()=>{f.root.query('DELETE FROM service_effect_s01_intents WHERE operation_id=?').run(h.primary.operationId);f.root.query('INSERT INTO service_effect_s01_intents(operation_id,intent_id,intent_hash,kind,payload_ref,created_at) VALUES (?,?,?,?,?,?)').run(intentRow.operation_id!,intentRow.intent_id!,intentRow.intent_hash!,intentRow.kind!,intentRow.payload_ref!,intentRow.created_at!);};
    for(const sql of ['DELETE FROM service_effect_s01_intents WHERE operation_id=?',"UPDATE service_effect_s01_intents SET kind='prompt' WHERE operation_id=?","UPDATE service_effect_s01_intents SET intent_id='other' WHERE operation_id=?","UPDATE service_effect_s01_intents SET payload_ref='other' WHERE operation_id=?","UPDATE service_effect_s01_intents SET intent_hash='"+'a'.repeat(64)+"' WHERE operation_id=?","UPDATE service_effect_s01_intents SET created_at='replaced' WHERE operation_id=?"]){
      f.root.query(sql).run(h.primary.operationId);expect(options.work.getQueuedInputIntent(h.primary.operationId,intent.work.claimed.source)).toBeNull();
      await expect(reconstituteAcceptedWork(options)).rejects.toThrow('Unverified recovered authority');expect(bindings()).toEqual(before);expect(f.sdkSnapshot()).toEqual(sdk);restore();
      await expect(reconstituteAcceptedWork({...options,work:{...contractWork,async getOperation(id){const result=await options.work.getOperation(id);f.root.query(sql).run(h.primary.operationId);return result;}}})).rejects.toThrow('Unverified recovered authority');expect(bindings()).toEqual(before);restore();
    }
    const pending=reconstituteAcceptedWork(options);options.readAcceptedInput=async()=>{throw Error('replaced callback after await');};expect(await pending).toHaveLength(2);options.readAcceptedInput=reader;
    controller=await createHostController({acquireOwnership:async()=>({assertCurrentOwner:f.options.owner.assert,release(){}}),createStorage:f.options.openStorage,runtime:{...f.options,work:h.recovery.work,bindings:h.bindings},recovery:h.recovery},context);
    expect((await controller.runtime.inspectAuthority()).inspection.scheduling).toBe('paused');
    const first=controller.reconcileRecovered();expect(controller.reconcileRecovered()).toBe(first);await first;
    expect(noSubmit).not.toHaveBeenCalled();expect(f.sdkSnapshot()).toEqual(sdk);expect(f.base.host.modelCalls).toBe(calls);
    expect((await h.bindings.intents!.get(h.intent))?.submissionId).toBe(h.intentId??null);
    await controller.reconcileRecovered();expect(f.sdkSnapshot()).toEqual(sdk);expect(f.base.host.modelCalls).toBe(calls);
    // Historical cancellation is source-control proof only. It must not be
    // interpreted as another user/model input or relax exact identity checks.
    const operation=value(await f.work.getOperation(h.primary.operationId))!,cancelId='historical-cancel';
    f.root.transaction(()=>options.work.acceptAndCancelSourceInTransaction(sealed({effect:effect(cancelId),chatJid:f.chat,sourceId:cancelId,kind:'cancellation',payloadRef:cancelId,targetOperationId:h.primary.operationId,parentSourceSeq:h.primary.sourceSeq,acceptedAt:at,createWakeIntent:false}),operation.version,'operator_abort',f.root)).immediate();
    const cancelled=await reconstituteAcceptedWork(options);expect(cancelled.map(row=>row.role)).toEqual(['primary','intent']);
    const cancellation=value(await f.work.getOperation(h.primary.operationId))!.cancellation!;
    for(const bad of [null,{kind:'message'},{targetOperationId:'other'},{state:'consumed'}] as readonly (Partial<AcceptedSourceSnapshot>|null)[])await expect(reconstituteAcceptedWork({...options,work:{...contractWork,getSourceBySeq(chat,seq){const source=options.work.getSourceBySeq(chat,seq);return seq!==cancellation.sourceSeq?source:bad===null?null:{...source!,...bad};}}})).rejects.toThrow('Unverified recovered authority');
    expect(f.sdkSnapshot()).toEqual(sdk);expect(noSubmit).not.toHaveBeenCalled();
  }finally{noSubmit.mockRestore();await controller?.close();await f.close();}
},15000);
