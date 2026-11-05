import type { Database } from "bun:sqlite";
import { apply } from "@earendil-works/chord/delta";
import { configure,defineDoc,type ConversationId,type Extension,type ToolRegistration,type Tx } from "@earendil-works/pi-durable";
import { nativeBackgroundIdentity,nativeBackgroundPolicyHash,readNativeBackgroundPayload,type NativeBackgroundPayload } from "../../src/agent-pool/background-operation-contract.js";
import { bindNativeBackgroundPolicy,assertNativeBackgroundBindingData,assertNativeBackgroundAgentData } from "./host-background-policy.js";

export type NativeBackgroundContext = {contextKey:string;chatJid:string;branchId:string;conversationId:ConversationId;sessionId:string};
export const NativeBackgroundContexts=defineDoc({kind:'app.background-contexts',version:1,scope:'conversation',history:'latest',fork:'initial',checkpointWhen:()=>false,
  initial:()=>({version:1,domain:'',contexts:[] as NativeBackgroundContext[]})});
function exact(value:unknown,names:readonly string[]):asserts value is Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)||JSON.stringify(Object.keys(value).sort())!==JSON.stringify([...names].sort()))throw Error('Invalid native background context manifest');
}
export function validateNativeBackgroundContexts(root:Database,domain:string,value:unknown):readonly NativeBackgroundContext[]{
  if(typeof domain!=='string'||!domain||domain.trim()!==domain)throw Error('Background application domain unavailable');
  if(value===undefined)return[];exact(value,['version','domain','contexts']);
  if(value.version!==1||value.domain!==domain||!Array.isArray(value.contexts))throw Error('Invalid native background context domain');
  const seen=new Set<unknown>();
  for(const entry of value.contexts){
    exact(entry,['contextKey','chatJid','branchId','conversationId','sessionId']);
    if(typeof entry.contextKey!=='string'||!/^background-context:[a-f0-9]{64}$/.test(entry.contextKey)||typeof entry.chatJid!=='string'||
      !/^(operation:|dream:)/.test(entry.chatJid)||entry.branchId!=='background:'+entry.contextKey.slice('background-context:'.length)||
      typeof entry.sessionId!=='string'||!entry.sessionId||!Number.isSafeInteger(entry.conversationId)||(entry.conversationId as number)<=1)throw Error('Invalid private background context identity');
    for(const key of ['contextKey','chatJid','branchId','conversationId','sessionId']){const identity=key+':'+entry[key];if(seen.has(identity))throw Error('Duplicate private background context');seen.add(identity);}
    const row=root.query('SELECT record FROM conversations WHERE id=?').get(entry.conversationId as number) as {record:string}|null;
    const record=row&&JSON.parse(row.record);if(!record||record.owner||record.parent)throw Error('Private background context must be ownerless and unforked');
  }
  return value.contexts as NativeBackgroundContext[];
}
/** Read-only SDK document materialisation; no live grant, provider or schema IO. */
export function readNativeBackgroundContexts(root:Database,domain:string):readonly NativeBackgroundContext[]{
  const docs=root.query(`SELECT id,family,key_value FROM documents WHERE kind='"app.background-contexts"' AND scope_kind='conversation' AND owner_id=1 AND retired_at IS NULL`).all() as {id:number;family:number;key_value:string}[];
  if(!docs.length)return[];if(docs.length!==1||Number(docs[0]!.family)!==0||docs[0]!.key_value!==JSON.stringify(''))throw Error('Ambiguous background context manifest');
  let value:any;
  for(const row of root.query('SELECT kind,version,content FROM document_revisions WHERE document_id=? ORDER BY seq').all(docs[0]!.id) as {kind:string;version:number;content:string}[]){
    if(Number(row.version)!==1)throw Error('Unsupported background context version');
    if(row.kind==='base')value=JSON.parse(row.content);else if(row.kind==='delta'&&value)value=apply(value,JSON.parse(row.content));else throw Error('Invalid background context revisions');
  }
  return validateNativeBackgroundContexts(root,domain,value);
}
export function storedBackgroundDocument(root:Database,id:number):any {
  let value:any;
  for(const row of root.query('SELECT kind,version,content FROM document_revisions WHERE document_id=? ORDER BY seq').all(id) as {kind:string;version:number;content:string}[]){
    if(Number(row.version)!==1)throw Error('Unsupported background document version');
    if(row.kind==='base')value=JSON.parse(row.content);else if(row.kind==='delta'&&value)value=apply(value,JSON.parse(row.content));else throw Error('Invalid background document revisions');
  }
  if(!value)throw Error('Missing background document value');return value;
}
/** Synchronous effect fence over the same public document materialisation used
 * by read-only recovery. No await separates this proof from a host syscall. */
export function assertStoredBackgroundExecution(root:Database,conversationId:number,payload:NativeBackgroundPayload):void{
  const agents=root.query(`SELECT id,family,key_value FROM documents WHERE kind='"pi.agent"' AND scope_kind='conversation' AND owner_id=? AND retired_at IS NULL`).all(conversationId) as {id:number;family:number;key_value:string}[];
  const policies=root.query(`SELECT id,family,key_value FROM documents WHERE kind='"app.background-policy"' AND scope_kind='conversation' AND owner_id=? AND key_value=? AND retired_at IS NULL`).all(conversationId,JSON.stringify(payload.policy.sourceId)) as {id:number;family:number;key_value:string}[];
  if(agents.length!==1||Number(agents[0]!.family)!==0||agents[0]!.key_value!==JSON.stringify('')||policies.length!==1||Number(policies[0]!.family)!==1)throw Error('Exact background execution documents required');
  const agent=storedBackgroundDocument(root,agents[0]!.id);
  assertNativeBackgroundAgentData(agent,payload.policy);assertNativeBackgroundBindingData(storedBackgroundDocument(root,policies[0]!.id),payload.policy);
  if(!Array.isArray(agent.extensions)||JSON.stringify([...agent.extensions].sort())!==JSON.stringify(['app.host-background-policy','app.host-builtins']))throw Error('Background execution extensions changed');
}
function listBackgroundBindings(root:Database,contexts:readonly NativeBackgroundContext[]){
  const result:{context:NativeBackgroundContext;state:any;sourceId:string}[]=[],present=new Set<number>(),seen=new Set<string>();
  const docs=root.query(`SELECT id,owner_id,family,key_value FROM documents WHERE kind='"app.background-policy"' AND scope_kind='conversation' AND retired_at IS NULL`).all() as {id:number;owner_id:number;family:number;key_value:string}[];
  for(const doc of docs){
    const context=contexts.find(entry=>entry.conversationId===Number(doc.owner_id));if(!context||Number(doc.family)!==1)throw Error('Unowned background policy document');
    const state=storedBackgroundDocument(root,doc.id);
    if(typeof state.sourceId!=='string'||!/^background:[a-f0-9]{64}$/.test(state.sourceId)||doc.key_value!==JSON.stringify(state.sourceId)||seen.has(state.sourceId))throw Error('Background policy reference mismatch');
    result.push({context,state,sourceId:state.sourceId});seen.add(state.sourceId);present.add(Number(doc.owner_id));
  }
  if(contexts.some(entry=>!present.has(entry.conversationId)))throw Error('Background context policy missing');return result;
}
function decodeBackgroundPayload(binding:ReturnType<typeof listBackgroundBindings>[number],encoded:string):NativeBackgroundPayload{
  let decoded:unknown;try{decoded=JSON.parse(encoded);}catch{throw Error('Invalid native background payload encoding');}
  const payload=readNativeBackgroundPayload(decoded),identity=nativeBackgroundIdentity(payload.policy);
  if(identity.sourceId!==binding.sourceId||identity.contextKey!==binding.context.contextKey||identity.chatJid!==binding.context.chatJid||identity.branchId!==binding.context.branchId)throw Error('Background payload owner mismatch');
  assertNativeBackgroundBindingData(binding.state,payload.policy);return payload;
}
export function readNativeBackgroundPayloads(root:Database,contexts:readonly NativeBackgroundContext[],read:(ref:string)=>string|undefined):Map<string,NativeBackgroundPayload>{
  const result=new Map<string,NativeBackgroundPayload>();
  for(const binding of listBackgroundBindings(root,contexts)){
    const encoded=read(binding.sourceId);if(typeof encoded!=='string')throw Error('Background immutable payload missing');
    result.set(binding.sourceId,decodeBackgroundPayload(binding,encoded));
  }
  return result;
}
/** Offline recovery references also cover staged contexts before S01 admission. */
export function backgroundRecoveryBindings(root:Database){
  if(!root.query(`SELECT 1 FROM sqlite_schema WHERE type='table' AND name='documents'`).get()||!root.query(`SELECT 1 FROM documents WHERE kind IN ('"app.background-policy"','"app.background-contexts"') AND retired_at IS NULL`).get())return[];
  const app=root.query(`SELECT id FROM documents WHERE kind='"app.application-conversations"' AND scope_kind='conversation' AND owner_id=1 AND retired_at IS NULL`).all() as {id:number}[];
  if(app.length!==1)throw Error('Background recovery domain unavailable');
  const domain=storedBackgroundDocument(root,app[0]!.id).domain;
  return listBackgroundBindings(root,readNativeBackgroundContexts(root,domain));
}
export function verifyBackgroundRecoveryPayload(root:Database,sourceId:string,encoded:string):void{
  const binding=backgroundRecoveryBindings(root).find(entry=>entry.sourceId===sourceId);if(!binding)throw Error('Unbound background recovery payload');decodeBackgroundPayload(binding,encoded);
}

/** Called by the application's sole SDK writer, under its admission guard.
 * No source/model dispatch occurs here. A staged empty context grants nothing. */
export async function publishNativeBackgroundContext(tx:Tx,domain:string,raw:NativeBackgroundPayload,tools:readonly ToolRegistration[],extensions:readonly Extension[],assertCurrent:()=>void){
  const payload=readNativeBackgroundPayload(raw),identity=nativeBackgroundIdentity(payload.policy);assertCurrent();
  const mapping=await tx.doc(NativeBackgroundContexts,1 as ConversationId);
  if(mapping.domain&&mapping.domain!==domain)throw Error('Background context domain changed');
  const prior=mapping.contexts.find(entry=>entry.contextKey===identity.contextKey);
  if(prior){
    if(prior.chatJid!==identity.chatJid||prior.branchId!==identity.branchId)throw Error('Background retry context conflict');
    throw Error('Existing Dream context cannot accept another invocation');
  }
  if(mapping.contexts.some(entry=>entry.chatJid===identity.chatJid||entry.branchId===identity.branchId))throw Error('Background context owner conflict');
  const conversation=await tx.createConversation({ownership:{kind:'ownerless'}});assertCurrent();
  await configure(tx,conversation.id,{model:{provider:payload.policy.model.provider,modelId:payload.policy.model.modelId},tools,extensions,instructions:payload.instructions});
  await bindNativeBackgroundPolicy(tx,conversation.id,payload.policy,assertCurrent,conversation);assertCurrent();
  const entry={contextKey:identity.contextKey,chatJid:identity.chatJid,branchId:identity.branchId,conversationId:conversation.id,sessionId:crypto.randomUUID()};
  mapping.domain=domain;mapping.contexts.push(entry);assertCurrent();return Object.freeze(entry);
}
export function backgroundPolicyProvenance(payload:NativeBackgroundPayload){return 'application:background:'+nativeBackgroundPolicyHash(payload.policy);}
