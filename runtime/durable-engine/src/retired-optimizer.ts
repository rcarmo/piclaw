import { createHash } from 'node:crypto';
import { AgentDoc, InboxDoc, LiveDoc, defineDoc, defineDocFamily, type AgentState, type ConversationId, type Harness, type HarnessInspection, type SubmissionId, type SubmissionRecord } from '@earendil-works/pi-durable';
import type { Context } from '@earendil-works/chord/context';
import { isDeepStrictEqual } from 'node:util';

// These are persisted v1 codecs, not a registered extension. No new optimiser
// tasks, observations, notices or policy can originate from this module.
const taskKinds = new Set([
  'token-economizer.inference', 'token-economizer.fold', 'token-economizer.checkpoint',
  'token-economizer.guard-judge', 'token-economizer.auto-publication', 'token-economizer.fit',
]);
const redirectPrefix = 'token-economizer-';
type LegacyScope = {host:string;repository:string;environment:string};
type LegacyHost = {id:string;conversationId:ConversationId;scope:LegacyScope};
type LegacyDecision = {id:string;runId:string;action:string;mode:string;status:string;submissionId:SubmissionId|null};
const Sessions = defineDoc({kind:'piclaw.token-optimizer.sessions',version:1,scope:'session',initial:():{sessions:Record<string,{host:LegacyHost}>}=>({sessions:{}}),checkpointWhen:()=>false});
const Runs = defineDocFamily<{inputs:SubmissionId[];decisions:LegacyDecision[]},null>({kind:'token-economizer.run',version:1,scope:'session',family:true,initial:()=>({inputs:[],decisions:[]}),checkpointWhen:()=>false});
const redirectKind = 'token-economizer.redirect';
const keyFor = (host:LegacyHost) => JSON.stringify([JSON.stringify([host.scope.host,host.scope.repository,host.scope.environment]),host.id]);
type Filter = NonNullable<AgentState['tools']>|null;
const Mask = defineDoc<{initialized:boolean;baseline:Filter;rendered:Filter;owned:string[]}>({kind:'piclaw.token-optimizer.mask',version:1,scope:'conversation',history:'latest',fork:'current',initial:()=>({initialized:false,baseline:null,rendered:null,owned:[]}),checkpointWhen:()=>false});

/** An already placed legacy redirect belongs to its exact ordinary SDK run.
 * It cannot be detached by the public SDK. Never cancel the whole run for it. */
export async function ownsHistoricalOptimizerSubmission(harness:Harness, inspected:SubmissionRecord, context:Context, check:()=>void) {
  if(inspected.type!=='input'||!inspected.requestId?.startsWith(redirectPrefix))return false;
  check();
  const record=await harness.commit(tx=>tx.submissionByRequest(inspected.conversationId,inspected.requestId!),context);check();
  if(!record||record.type!=='input'||record.id!==inspected.id)return false;
  const entry=record.entry!==undefined
    ? await harness.commit(tx=>tx.entry(record.entry!),context)
    : (await harness.snapshot(InboxDoc,record.conversationId,context))?.items.find(item=>item.id===record.id)?.entry;
  check();
  if(entry?.kind!==redirectKind)return false;
  const payload=entry.data;
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||typeof payload.decisionId!=='string'||typeof payload.runId!=='string')return false;
  const {decisionId,runId}=payload;
  if(record.requestId!==redirectPrefix+createHash('sha256').update(decisionId).digest('hex'))return false;
  const saved=await harness.snapshot(Sessions,context);check();
  for(const {host} of Object.values(saved?.sessions??{})) {
    if(host?.conversationId!==record.conversationId||host.scope?.host!=='piclaw.native')continue;
    const run=await harness.snapshot(Runs,keyFor(host),context);check();
    const found=run?.decisions.find(decision=>decision.id===decisionId&&decision.runId===runId&&decision.submissionId===record.id&&decision.action==='redirect'&&decision.mode==='active'&&['queued','consumed'].includes(decision.status));
    if(!found)continue;
    if(record.status==='placed') {
      const live=(await harness.snapshot(LiveDoc,record.conversationId,context))?.run;check();
      const identity=live&&(live.first!==undefined||live.inputs.length)?JSON.stringify([live.first??null,live.inputs[0]??null]):null;
      if(!live||identity!==found.runId||!run!.inputs.length||!run!.inputs.every(id=>live.inputs.includes(id)))return false;
    }
    return true;
  }
  return false;
}

/** Retire only the withdrawn SDK task kinds on the reserved maintenance owner.
 * Missing executable definitions make abort settle an orphan, without resume
 * or running user or optimiser work. The original record remains readable. */
export async function retireOptimizerWork(harness:Harness,inspection:HarnessInspection,context:Context,check:()=>void) {
  if(inspection.scheduling!=='paused')throw Error('Retired optimiser work requires paused recovery');
  const owners=new Set(inspection.tasks.map(row=>row.record.owner));
  const candidates=inspection.tasks.filter(row=>taskKinds.has(row.record.kind));
  // Validate all candidates before the SDK can mark any abort. Its cascade
  // also follows tasks reached through task-owned conversations.
  if(candidates.length)await harness.commit(async tx=>{
    for(const {record,state} of candidates){
      check();
      if(record.version!==1||record.conversationId!==1||!record.background||record.owner!==undefined||owners.has(record.id)
        || !(state.kind==='blocked'&&state.reason==='missing_task'||state.kind==='completing')
        || (await tx.scanConversations({ownerTaskId:record.id},1)).items.length)throw Error('Unsupported retired optimiser task ownership');
    }
    check();
  },context);
  let retired=false;
  for(const {record} of candidates) {
    check();
    const current=await harness.getTask(record.id,context);check();
    if(!current||current.kind!==record.kind||current.version!==record.version||current.conversationId!==record.conversationId||current.background!==record.background||current.owner!==record.owner)throw Error('Retired optimiser task identity changed');
    await harness.abortTask(record.id,context);check();
    if((await harness.getTask(record.id,context))?.state.status!=='terminal')throw Error('Retired optimiser task did not settle while paused');
    check();retired=true;
  }
  for(const record of inspection.submissions) {
    if(record.status!=='queued'||!await ownsHistoricalOptimizerSubmission(harness,record,context,check))continue;
    check();const result=await harness.abortSubmission(record.id,context,record.conversationId);check();
    if(result!=='aborted'&&result!=='settled')throw Error('Retired optimiser redirect changed while paused');
    retired=true;
  }
  return retired;
}

/** Restore only filters still equal to the optimiser's rendering. No changes
 * to accepted SDK work or to restrictions another owner wrote afterwards. */
export async function restoreIdleOptimizerMasks(harness:Harness,ids:readonly ConversationId[],inspection:HarnessInspection,context:Context,check:()=>void) {
  const busy=new Set(inspection.submissions.map(row=>row.conversationId));
  for(const id of ids) {
    if(busy.has(id))continue;
    check();const saved=await harness.snapshot(Mask,id,context);check();
    if(!saved?.initialized||!Array.isArray(saved.owned)||!saved.owned.length)continue;
    await harness.commit(async tx=>{
      check();
      if((await tx.doc(LiveDoc,id)).run)return;
      const agent=await tx.doc(AgentDoc,id);
      if(!isDeepStrictEqual(agent.tools??null,saved.rendered))return;
      if(saved.baseline===null)delete agent.tools;else agent.tools=structuredClone(saved.baseline);
      check();
    },context);
    check();
  }
}
