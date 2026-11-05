import {createCurrentPiclawServiceWorkStore} from '../../../runtime/src/service-effects/current-piclaw/service-work-store.js';
import {createCurrentPiclawTerminalSettlementStore} from '../../../runtime/src/service-effects/current-piclaw/terminal-settlement-store.js';
import {InMemoryEffectPayloadResolver} from '../../../runtime/src/service-effects/testing/in-memory-payload-resolver.js';
import {nativeMessageFixture} from './native-message-fixture.js';
import {barrier,context} from './fixture.js';
import {at,effect,sealed,value} from './host-handoff.js';
import {hashCanonicalRequest,type CanonicalJsonValue} from '../../../runtime/src/service-effects/contracts/common.js';
import {createHostDurableBindings} from '../../../runtime/durable-engine/src/host-bindings.js';
import type {AcceptedInput} from '../../../runtime/durable-engine/src/host-runtime.js';
import {storeMessageInDatabase} from '../../../runtime/src/db/messages.js';

/** Fixed historical ServiceWork/SDK facts for compatibility-authority tests.
 * No host queue/coordinator, worker, resubmission policy or fabricated SDK rows.
 * New ordinary input tests use nativeMessageFixture.accept/submitMessage. */
export async function historicalIntentFixture(accepted:boolean|'completed'){
  const f=await nativeMessageFixture();
  try{
  const work=value(createCurrentPiclawServiceWorkStore(f.root,{hitFault(){return false;},recordTrace(){},validateAcceptance(){f.options.owner.assert();return true;}})),operationId='historical-operation';
  const bindings=createHostDurableBindings(f.root,{domain:f.domain,incarnation:f.domain,manifest:[{chatJid:f.chat,branchId:'main',conversationId:f.base.root.id}],assertOwner:f.options.owner.assert,
    async resolveContent(ref){const row=ref.startsWith('message-row:')?f.root.query('SELECT content FROM messages WHERE rowid=? AND chat_jid=?').get(Number(ref.slice(12)),f.chat):f.root.query('SELECT content FROM messages WHERE id=? AND chat_jid=?').get(ref.replace(/^queued-source:/,''),f.chat);if(!row)throw Error('Historical payload unavailable');return (row as {content:string}).content;}});
  const accept=async(id:string,text:string,queued=false)=>{
    const row=storeMessageInDatabase(f.root,{id,chat_jid:f.chat,sender:'user',sender_name:'Historical fixture',content:text,timestamp:at,is_from_me:false,is_bot_message:false});
    return value(await work.acceptSource(sealed({effect:effect('history:'+id),chatJid:f.chat,sourceId:id,kind:'message',payloadRef:queued?'queued-source:'+id:'message-row:'+row,targetOperationId:null,parentSourceSeq:null,acceptedAt:at,createWakeIntent:false})));
  };
  const source=await accept('historical-primary','historical primary');
  const claim=value(await work.claimNext(sealed({effect:effect('history:claim'),chatJid:f.chat,expectedFrontier:0,newOperationId:operationId,claimedAt:at})))!;
  const primary:AcceptedInput={incarnation:f.domain,conversationId:f.base.root.id,chatJid:f.chat,branchId:'main',operationId,sourceSeq:source.sourceSeq,sourceId:source.sourceId,payloadRef:source.payloadRef,requestId:'historical-primary',requestHash:hashCanonicalRequest({type:'input',requestId:'historical-primary',content:'historical primary'})};
  await bindings.getOrBind(primary);
  const submission=await f.base.root.submit({type:'input',requestId:primary.requestId,content:'historical primary',entry:{kind:'host.accepted',data:{...primary,role:'primary'}}},context);await submission.wait(context);await bindings.recordSubmission(primary,submission.id);
  const operation=value(await work.bindHarness(sealed({effect:effect('history:bind',operationId,source.sourceSeq),expectedVersion:claim.operation.version,sessionId:f.domain,harnessOperationId:String(submission.id)})));
  const attached=await accept('historical-intent','historical continuation',true),hash=(f.root.query('SELECT source_hash FROM service_effect_s01_sources WHERE chat_jid=? AND source_seq=?').get(f.chat,attached.sourceSeq) as {source_hash:string}).source_hash;
  const request={effect:{...effect('history:attach',operationId,attached.sourceSeq),sourceSeq:attached.sourceSeq},chatJid:f.chat,expectedVersion:operation.version,expectedHarness:operation.harness!,sourceId:attached.sourceId,sourceHash:hash,payloadRef:attached.payloadRef,createdAt:at};
  request.effect.requestHash=hashCanonicalRequest({method:'attachQueuedSource.v1',...request} as unknown as CanonicalJsonValue);
  f.root.transaction(()=>work.attachQueuedSourceInTransaction(request,f.root)).immediate();
  const intent:AcceptedInput={...primary,sourceSeq:attached.sourceSeq,sourceId:attached.sourceId,payloadRef:attached.payloadRef,requestId:'queued-steer:'+attached.sourceId,requestHash:hashCanonicalRequest({type:'input',requestId:'queued-steer:'+attached.sourceId,content:'historical continuation'})};
  await bindings.intents!.getOrBind(intent);
  let intentId:typeof submission.id|undefined;
  if(accepted){
    const entered=barrier();if(accepted!=='completed')f.base.host.modelHold=barrier();f.base.host.onModelEnter=()=>entered.release();
    intentId=(await f.base.root.submit({type:'input',requestId:intent.requestId,content:'historical continuation',entry:{kind:'host.accepted',data:{...intent,role:'intent'}}},context)).id;
    await entered.promise;
    if(accepted==='completed'){await (await f.base.harness.submission(intentId,context))!.wait(context);await bindings.intents!.recordSubmission(intent,intentId);}
  }
  await f.base.close();
  const manifest=[{chatJid:f.chat,branchId:'main',conversationId:f.base.root.id}];
  const recovery={manifest,work,bindings,async readAcceptedInput(source:ReturnType<typeof work.getSourceBySeq>&{}){
    const operation=value(await work.getOperation(operationId))!;
    return {claimed:{source,operation},branchId:'main',requestId:source.sourceSeq===primary.sourceSeq?primary.requestId:intent.requestId,content:source.sourceSeq===primary.sourceSeq?'historical primary':'historical continuation'};
  }};
  const payloads=new InMemoryEffectPayloadResolver(),terminal=value(createCurrentPiclawTerminalSettlementStore(f.root,payloads,{hitFault(){return false;},recordTrace(){},validateOwnership(){f.options.owner.assert();return f.root.inTransaction;}}));
  return {f,bindings,primary,primaryId:submission.id,intent,intentId,recovery,terminal,putAnswer:(ref:string,text:string)=>{payloads.putText(ref,text);}};
  }catch(error){await f.close();throw error;}
}
