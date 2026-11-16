import { spyOn } from 'bun:test';
import check from 'node:assert/strict';
import type { SubmissionId } from '../../../runtime/durable-engine/qualification/durable.js';
import type { AcceptedInput } from '../../../runtime/durable-engine/src/host-runtime.js';
import type { NativeMessageFixtureIdentity } from './native-message-fixture.js';
import { nativeMessageFixture } from './native-message-fixture.js';
import { barrier } from './fixture.js';

export type RecoveryBoundary='before-submit'|'committed-ack-lost';
export interface NativeRecoveryCheckpoint {
  identity:NativeMessageFixtureIdentity;generation:number;pid:number;primary:AcceptedInput;primaryId:SubmissionId;
  queued:AcceptedInput;queuedId?:SubmissionId;snapshot:unknown;providerEntries:number;
}
export async function prepareNativeMessageRecovery(boundary:RecoveryBoundary){
  const f=await nativeMessageFixture(),entered=barrier(),held=barrier();let providerEntries=0,failSource='';
  f.base.host.modelHold=held;f.base.host.onModelEnter=()=>{providerEntries++;entered.release();};
  const record=f.bindings.recordSubmission.bind(f.bindings);
  const ack=spyOn(f.bindings,'recordSubmission').mockImplementation(async(input,id)=>{if(input.sourceId===failSource)throw Error('SDK accepted; binding ACK lost');await record(input,id);});
  await f.open();
  const primary=f.accept('held primary; never replay'),primaryId=await f.runtime.submitMessage(primary);await entered.promise;
  const queued=f.accept('original accepted steering input');let queuedId:SubmissionId|undefined;
  if(boundary==='before-submit')await f.bindings.getOrBind(queued);
  else{
    failSource=queued.sourceId;
    queuedId=await f.runtime.submitMessage(queued,'steer');
    check.equal((await f.runtime.messageSubmissionStatus(queued))!.id,queuedId);
    check.equal((await f.bindings.get(queued))!.submissionId,null);
  }
  const checkpoint:NativeRecoveryCheckpoint={identity:f.identity,generation:f.owner().generation,pid:process.pid,primary,primaryId,queued,queuedId,snapshot:f.sdkSnapshot(),providerEntries};
  return {f,checkpoint,held,restore(){ack.mockRestore();}};
}
