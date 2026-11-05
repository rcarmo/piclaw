import { createHash } from "node:crypto";
import { AgentDoc, defineDocFamily, InboxDoc, LiveDoc, type ConversationId, type TaskId, type ToolTaskInput, type ConversationRecord, type Tx } from "@earendil-works/pi-durable";
import {
  assertNativeBackgroundDeadline,nativeBackgroundPolicyHash,readNativeBackgroundPolicy,
  type NativeBackgroundPolicy,
} from "../../src/agent-pool/background-operation-contract.js";

type Claim={taskId:number;callId:string;toolName:string};
/** Correlation and a bounded quota only. Immutable SDK input and the live
 * domain lease prove authority; this document never authorises execution or replay.
 * Each accepted input has a family member; `initial` prevents a fork from
 * inheriting its parent's background grant. */
export const NativeBackgroundPolicyDoc=defineDocFamily({kind:"app.background-policy",version:1,family:true,scope:"conversation",history:"latest",fork:"initial",
  checkpointWhen:()=>false,initial:(_seed:null)=>({sourceId:null as string|null,policySha256:null as string|null,calls:[] as Claim[]})});
function current(assertCurrent:()=>void){
  const result:unknown=assertCurrent();
  if(result!==undefined){void Promise.resolve(result).catch(()=>{});throw Error("Background host authority must be synchronous");}
}
function bound(doc:Readonly<{sourceId:string|null;policySha256:string|null;calls:readonly Claim[]}>,policy:NativeBackgroundPolicy){
  if(doc.sourceId!==policy.sourceId||doc.policySha256!==nativeBackgroundPolicyHash(policy)||!Array.isArray(doc.calls)||doc.calls.length>100||
    policy.maxToolCalls!==null&&doc.calls.length>policy.maxToolCalls||policy.maxToolCalls===null&&doc.calls.length!==0)throw Error("Native background policy binding conflict");
  const tasks=new Set<number>();
  for(const claim of doc.calls){
    if(!Number.isSafeInteger(claim.taskId)||claim.taskId<1||typeof claim.callId!=="string"||!claim.callId||claim.callId.length>2048||typeof claim.toolName!=="string"||
      !policy.allowedTools.includes(claim.toolName)||tasks.has(claim.taskId))throw Error("Invalid native background tool quota");
    tasks.add(claim.taskId);
  }
}
export { bound as assertNativeBackgroundBindingData };

export function assertNativeBackgroundAgentData(agent:Readonly<{model?:{provider:string;modelId:string};instructions?:unknown;tools?:unknown}>,policy:NativeBackgroundPolicy){
  if(agent.model?.provider!==policy.model.provider||agent.model.modelId!==policy.model.modelId||typeof agent.instructions!=="string"||
    createHash("sha256").update(agent.instructions).digest("hex")!==policy.instructionsSha256||!Array.isArray(agent.tools)||
    agent.tools.some(name=>typeof name!=="string")||JSON.stringify([...agent.tools].sort())!==JSON.stringify(policy.allowedTools))throw Error("Native background agent configuration changed");
}
async function assertAgentPolicy(tx:Tx,id:ConversationId,policy:NativeBackgroundPolicy){
  assertNativeBackgroundAgentData(await tx.doc(AgentDoc,id),policy);
}
/** Call only in the host-owned public allocation transaction, after current
 * grant/model checks. Existing same-policy binding is replay, never quota reset. */
export async function bindNativeBackgroundPolicy(tx:Tx,id:ConversationId,input:NativeBackgroundPolicy,assertCurrent:()=>void,created?:ConversationRecord){
  current(assertCurrent);const policy=readNativeBackgroundPolicy(input);await assertAgentPolicy(tx,id,policy);
  const doc=await tx.doc(NativeBackgroundPolicyDoc,id,policy.sourceId,null);current(assertCurrent);
  if(doc.sourceId!==null||doc.policySha256!==null){bound(doc,policy);return;}
  if(created){
    // Only the exact record returned by this transaction's createConversation.
    // Public Tx forbids table reads after its first table write. The host
    // allocation path creates/configures/binds this record without task writes.
    if(created.id!==id||created.parent||created.owner||doc.calls.length)throw Error('Fresh private background conversation required');
  }else{
    const conversation=await tx.conversation(id),entries=await tx.scanEntries({conversationId:id},1);
    const tasks=await tx.scanTasks({conversationId:id},1),inbox=await tx.doc(InboxDoc,id),live=await tx.doc(LiveDoc,id);
    current(assertCurrent);
    if(!conversation||conversation.parent||conversation.owner||entries.items.length||tasks.items.length||inbox.items.length||live.run||doc.calls.length)throw Error("Fresh private background conversation required");
  }
  doc.sourceId=policy.sourceId;doc.policySha256=nativeBackgroundPolicyHash(policy);current(assertCurrent);
}
/** A fresh host effect guard and exact accepted source remain mandatory. This
 * read must not be installed as a general bootstrap/read-only recovery gate:
 * revoked/expired work still needs passive inspection and SDK cleanup. */
export async function assertNativeBackgroundExecution(tx:Tx,id:ConversationId,input:NativeBackgroundPolicy,now:number,assertCurrent:()=>void){
  current(assertCurrent);const policy=readNativeBackgroundPolicy(input);
  assertNativeBackgroundDeadline(policy,now);await assertAgentPolicy(tx,id,policy);
  bound(await tx.doc(NativeBackgroundPolicyDoc,id,policy.sourceId,null),policy);current(assertCurrent);
}
/** Before-intent quota claim, using actual public SDK task/assistant/live-slot
 * evidence. Re-entry of one SDK task never spends another call. This receipt is
 * NOT an effect receipt and must never be used to resend an uncertain tool. */
export async function claimNativeBackgroundTool(tx:Tx,id:ConversationId,input:NativeBackgroundPolicy,
  call:{taskId:TaskId;callId:string;toolName:string},now:number,assertCurrent:()=>void){
  const policy=readNativeBackgroundPolicy(input);await assertNativeBackgroundExecution(tx,id,policy,now,assertCurrent);
  if(typeof call.callId!=="string"||!call.callId||call.callId.length>2048)throw Error("Invalid native background call identity");
  if(!policy.allowedTools.includes(call.toolName))throw Error("Native background tool ceiling denied");
  const task=await tx.task(call.taskId),live=await tx.doc(LiveDoc,id);current(assertCurrent);
  if(!task||task.kind!=="pi.tool"||task.conversationId!==id||task.abortRequested||task.state.status==="terminal"||task.owner===undefined||!live.run)
    throw Error("Exact pending background tool task required");
  const source=task.input as ToolTaskInput;
  if(source.kind==="model"){
    const slot=live.tools?.find(slot=>slot.taskId===call.taskId&&slot.callId===call.callId&&slot.name===call.toolName&&slot.status==="pending");
    const assistant=await tx.entry(source.assistant);current(assertCurrent);
    const recorded=assistant?.model?.flatMap(message=>message.role==="assistant"?message.content.filter(part=>part.type==="toolCall"):[]).find(part=>part.id===call.callId);
    if(!slot||source.callId!==call.callId||task.owner!==live.run.taskId||assistant?.byTaskId!==task.owner||assistant.conversationId!==id||recorded?.name!==call.toolName)
      throw Error("Exact pending background model call required");
  }else if(source.kind==="nested"){
    const slot=live.nestedTools?.find(slot=>slot.taskId===call.taskId&&slot.callId===call.callId&&slot.name===call.toolName&&slot.status==="pending");
    const parent=await tx.task(source.parent);current(assertCurrent);
    if(!slot||source.call.id!==call.callId||source.call.name!==call.toolName||task.owner!==source.parent||!parent||parent.kind!=="pi.tool"||
      parent.conversationId!==id||parent.abortRequested||parent.state.status==="terminal"||
      ![...(live.tools??[]),...(live.nestedTools??[])].some(slot=>slot.taskId===source.parent&&slot.callId===source.parentCallId&&slot.status==="running"))
      throw Error("Exact pending background nested call required");
  }else throw Error("Unsupported background tool task");
  const doc=await tx.doc(NativeBackgroundPolicyDoc,id,policy.sourceId,null);current(assertCurrent);bound(doc,policy);
  const prior=doc.calls.find(claim=>claim.taskId===call.taskId);
  if(prior){if(prior.taskId!==call.taskId||prior.callId!==call.callId||prior.toolName!==call.toolName)throw Error("Native background tool claim conflict");return;}
  if(policy.maxToolCalls===null)return; // Explicitly uncapped host policy; no unbounded quota ledger.
  if(doc.calls.length>=policy.maxToolCalls)throw Error("Native background tool call limit reached");
  doc.calls.push({taskId:call.taskId,callId:call.callId,toolName:call.toolName});current(assertCurrent);
}
