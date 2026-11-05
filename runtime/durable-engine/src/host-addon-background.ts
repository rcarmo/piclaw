import { operationGrantKey } from "../../src/addons/operation-contracts.js";
import type Database from "bun:sqlite";
import { createHash } from "node:crypto";
import { readAddonOperation,readAddonOperationInputSequence,readAddonOperationInputEpoch,ADDON_OPERATION_RESUME_TEXT } from "../../src/db/addon-operations.js";
import { authorizeAddonOperation } from "../../src/addons/operation-host.js";
import type { NativeBackgroundInputHistory } from './host-background-context.js';
import { OPERATION_SYSTEM_PROMPT } from "../../src/agent-pool/operation-session-profile.js";
import {
  createNativeBackgroundPayload,readNativeBackgroundPayload,assertNativeBackgroundDeadline,assertNativeBackgroundRetry,
  nativeBackgroundSourceId,nativeBackgroundContextKey,type NativeBackgroundOrigin,type NativeBackgroundPayload,
} from "../../src/agent-pool/background-operation-contract.js";

export function addonBackgroundOrigin(root:Database,id:string):Extract<NativeBackgroundOrigin,{kind:'addon'}>{
  const record=readAddonOperation(id,root),sequence=readAddonOperationInputSequence(id,root);
  if(!record||sequence===null)throw Error('Native add-on input identity unavailable');
  return Object.freeze({kind:'addon',operationId:record.id,addonId:record.addonId,principalId:record.principalId,target:record.target,
    grantRevision:record.grant.revision,inputSequence:sequence});
}
/** Passive ownership correlation, independent of live grants/expiry. A revoked
 * operation still needs its original receipt and unresolved holds inspected. */
export function assertAddonBackgroundRecoveryOwner(root:Database,raw:NativeBackgroundPayload):void{
  const payload=readNativeBackgroundPayload(raw),policy=payload.policy,origin=policy.origin;
  if(origin.kind!=='addon')throw Error('Expected native add-on recovery origin');
  const record=readAddonOperation(origin.operationId,root);
  if(!record||JSON.stringify(addonBackgroundOrigin(root,record.id))!==JSON.stringify(origin)||record.chatJid!=='operation:'+origin.operationId||record.workId!==policy.workId||(record.grant.parentWorkId??null)!==policy.parentWorkId||record.grant.maxToolCalls!==policy.maxToolCalls||JSON.stringify([...record.grant.allowedTools].sort())!==JSON.stringify(policy.allowedTools)||Date.parse(policy.expiresAt)-Date.parse(policy.acceptedAt)!==record.grant.timeoutMs)throw Error('Native add-on recovery owner changed');
}

/** Uses the SAME host grant decision as the existing operation owner. Parsing a
 * persisted snapshot alone never grants spending/tools, including after reopen. */
export function assertAddonBackgroundCurrent(root:Database,raw:NativeBackgroundPayload):void{
  const payload=readNativeBackgroundPayload(raw),policy=payload.policy,origin=policy.origin;
  if(origin.kind!=='addon')throw Error('Expected admitted add-on origin');
  const record=readAddonOperation(origin.operationId,root);
  if(!record||record.status!=='working'||JSON.stringify(addonBackgroundOrigin(root,record.id))!==JSON.stringify(origin))throw Error('Native add-on operation authority changed');
  const admission=authorizeAddonOperation({addonId:origin.addonId,principalId:origin.principalId},origin.target,'request');
  if(admission.decision!=='allow'||operationGrantKey(admission.grant)!==operationGrantKey(record.grant))throw Error('Native add-on grant changed');
  if(policy.workId!==record.workId||policy.parentWorkId!==(record.grant.parentWorkId??null)||policy.maxToolCalls!==record.grant.maxToolCalls||
    JSON.stringify(policy.allowedTools)!==JSON.stringify([...record.grant.allowedTools].sort())||
    Date.parse(policy.expiresAt)-Date.parse(policy.acceptedAt)!==record.grant.timeoutMs||payload.instructions!==OPERATION_SYSTEM_PROMPT)
    throw Error('Native add-on policy no longer matches its owner');
  assertNativeBackgroundDeadline(policy,Date.now());
}
export function prepareAddonBackgroundPayload(root:Database,id:string,model:NativeBackgroundPayload['policy']['model'],
  existing:NativeBackgroundPayload|undefined,toolAvailable:(name:string)=>boolean,history?:NativeBackgroundInputHistory):NativeBackgroundPayload{
  const origin=addonBackgroundOrigin(root,id),record=readAddonOperation(id,root)!;
  for(const name of record.grant.allowedTools)if(!toolAvailable(name))throw Error(`Native operation tool unavailable: ${name}`);
  const prior=existing&&readNativeBackgroundPayload(existing);
  if(prior&&prior.policy.sourceId!==nativeBackgroundSourceId(origin))throw Error('Native add-on input epoch changed');
  const epoch=readAddonOperationInputEpoch(id,root);if(!epoch||epoch.sequence!==origin.inputSequence)throw Error('Native add-on input epoch unavailable');
  const previous=history?.previous.map(readNativeBackgroundPayload)??[],base=previous.at(-1);
  for(const old of previous)if(old.policy.origin.kind!=='addon'||nativeBackgroundContextKey(old.policy.origin)!==nativeBackgroundContextKey(origin)||old.policy.origin.inputSequence>=origin.inputSequence)throw Error('Native add-on context history changed');
  let prompt=prior?.prompt??record.text;
  if(!prior){
    if(epoch.kind==='continuation'){
      if(!base||!history?.acceptedSources.length)throw Error('Native continuation requires committed private history');
    }else if(epoch.kind==='resume'&&base){
      const previousSource=nativeBackgroundSourceId({...origin,inputSequence:epoch.previousSequence!});
      if(history!.acceptedSources.includes(previousSource))prompt=ADDON_OPERATION_RESUME_TEXT;
      else{
        const staged=previous.find(payload=>payload.policy.sourceId===previousSource);
        if(staged&&staged.prompt!==record.text)throw Error('Unsubmitted add-on input bytes changed');
      }
    }else if(createHash('sha256').update(JSON.stringify([record.target,record.text])).digest('hex')!==record.inputHash)throw Error('Original add-on input payload unavailable');
  }
  const acceptedAt=prior?.policy.acceptedAt??record.updatedAt; // Persisted working transition owns the original timeout.
  const payload=createNativeBackgroundPayload({origin,workId:record.workId,parentWorkId:record.grant.parentWorkId??null,model:prior?.policy.model??model,
    allowedTools:record.grant.allowedTools,maxToolCalls:record.grant.maxToolCalls,acceptedAt,
    expiresAt:prior?.policy.expiresAt??new Date(Date.parse(acceptedAt)+record.grant.timeoutMs).toISOString(),
    prompt,instructions:OPERATION_SYSTEM_PROMPT});
  if(prior)assertNativeBackgroundRetry(prior.policy,payload.policy);
  assertAddonBackgroundCurrent(root,payload);return payload;
}
