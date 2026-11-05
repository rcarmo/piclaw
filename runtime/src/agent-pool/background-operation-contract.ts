import { createHash } from "node:crypto";
import { hashCanonicalRequest } from "../service-effects/contracts/common.js";

export type NativeBackgroundOrigin =
  | Readonly<{ kind:"dream"; invocationId:string; chatJid:string; mode:"manual"|"auto" }>
  | Readonly<{ kind:"addon"; operationId:string; addonId:string; principalId:string; target:string; grantRevision:string; inputSequence:number }>;
export type NativeBackgroundPolicy = Readonly<{
  version:1; sourceId:string; origin:NativeBackgroundOrigin;
  workId:string; parentWorkId:string|null;
  model:Readonly<{provider:string;modelId:string;api:string}>;
  allowedTools:readonly string[]; maxToolCalls:number|null;
  acceptedAt:string; expiresAt:string; promptSha256:string; instructionsSha256:string;
}>;
export type NativeBackgroundPayload = Readonly<{version:1;policy:NativeBackgroundPolicy;prompt:string;instructions:string}>;
export type NativeBackgroundPolicyInput = Omit<NativeBackgroundPolicy,"version"|"sourceId"|"promptSha256"|"instructionsSha256"> & {prompt:string;instructions:string};
const invalid=()=>new Error("Invalid native background operation policy");
const sha=(text:string)=>createHash("sha256").update(text).digest("hex");
function fields(value:unknown,keys:readonly string[]):asserts value is Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw invalid();
  const own=Reflect.ownKeys(value);
  if(own.length!==keys.length||keys.some(key=>!Object.hasOwn(value,key))||own.some(key=>typeof key!=="string"||!keys.includes(key)||!("value" in Object.getOwnPropertyDescriptor(value,key)!)))throw invalid();
}
function text(value:unknown,max=1024):asserts value is string{
  if(typeof value!=="string"||!value||value.length>max||value.trim()!==value||/[\r\n\0]/.test(value))throw invalid();
}
function hash(value:unknown):asserts value is string{if(typeof value!=="string"||value.length!==64||/[^a-f0-9]/.test(value))throw invalid();}
function instant(value:unknown):asserts value is string{
  if(typeof value!=="string"||value.length!==24||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)throw invalid();
}
function origin(value:unknown):NativeBackgroundOrigin{
  if(!value||typeof value!=="object")throw invalid();
  const kind=Object.getOwnPropertyDescriptor(value,"kind");if(!kind||!("value" in kind))throw invalid();
  if(kind.value==="dream"){
    fields(value,["kind","invocationId","chatJid","mode"]);text(value.invocationId,128);text(value.chatJid,512);
    if(value.mode!=="manual"&&value.mode!=="auto")throw invalid();
    return Object.freeze({kind:"dream",invocationId:value.invocationId,chatJid:value.chatJid,mode:value.mode});
  }
  fields(value,["kind","operationId","addonId","principalId","target","grantRevision","inputSequence"]);
  if(value.kind!=="addon"||!Number.isSafeInteger(value.inputSequence)||(value.inputSequence as number)<1)throw invalid();
  for(const key of ["operationId","addonId","principalId","target","grantRevision"])text(value[key],128);
  return Object.freeze({kind:"addon",operationId:value.operationId as string,addonId:value.addonId as string,
    principalId:value.principalId as string,target:value.target as string,grantRevision:value.grantRevision as string,inputSequence:value.inputSequence as number});
}
/** Stable caller identity excludes mutable execution choices. A changed grant,
 * model, prompt or deadline must conflict with the same source, never allocate
 * another operation as a disguised retry. This function grants no authority. */
export function nativeBackgroundSourceId(value:NativeBackgroundOrigin):string{
  const who=origin(value);
  const identity=who.kind==="dream"?{kind:who.kind,invocationId:who.invocationId,chatJid:who.chatJid}:
    {kind:who.kind,operationId:who.operationId,addonId:who.addonId,principalId:who.principalId,inputSequence:who.inputSequence};
  return "background:"+hashCanonicalRequest(identity);
}
export function nativeBackgroundContextKey(value:NativeBackgroundOrigin):string{
  const who=origin(value);
  return 'background-context:'+hashCanonicalRequest(who.kind==='dream'?{kind:who.kind,invocationId:who.invocationId,chatJid:who.chatJid}:
    {kind:who.kind,operationId:who.operationId,addonId:who.addonId,principalId:who.principalId});
}
export function nativeBackgroundIdentity(value:NativeBackgroundPolicy){
  const policy=readNativeBackgroundPolicy(value),contextKey=nativeBackgroundContextKey(policy.origin),suffix=contextKey.slice("background-context:".length);
  return Object.freeze({contextKey,sourceId:policy.sourceId,requestId:policy.sourceId,payloadRef:policy.sourceId,operationId:"operation:"+policy.sourceId,
    chatJid:policy.origin.kind==="addon"?"operation:"+policy.origin.operationId:
      `dream:${suffix}`,
    branchId:"background:"+suffix});
}
function policyFields(value:Record<string,unknown>,who:NativeBackgroundOrigin):NativeBackgroundPolicy{
  text(value.workId);if(value.parentWorkId!==null)text(value.parentWorkId);
  if(value.parentWorkId===value.workId)throw invalid();
  fields(value.model,["provider","modelId","api"]);
  text(value.model.provider,128);text(value.model.modelId,512);text(value.model.api,128);
  if(/[\s/]/.test(value.model.provider)||/\s/.test(value.model.modelId)||/\s/.test(value.model.api))throw invalid();
  instant(value.acceptedAt);instant(value.expiresAt);
  if(Date.parse(value.expiresAt)<=Date.parse(value.acceptedAt))throw invalid();
  if(value.maxToolCalls!==null&&(!Number.isSafeInteger(value.maxToolCalls)||(value.maxToolCalls as number)<0||(value.maxToolCalls as number)>100))throw invalid();
  if(who.kind==="addon"&&value.maxToolCalls===null)throw invalid();
  if(!Array.isArray(value.allowedTools)||Object.getPrototypeOf(value.allowedTools)!==Array.prototype||value.allowedTools.length>64||Reflect.ownKeys(value.allowedTools).length!==value.allowedTools.length+1)throw invalid();
  const tools:string[]=[];
  for(let i=0;i<value.allowedTools.length;i++){
    const property=Object.getOwnPropertyDescriptor(value.allowedTools,String(i));if(!property||!("value" in property))throw invalid();
    text(property.value,128);if(/[^A-Za-z0-9_.:-]/.test(property.value))throw invalid();tools.push(property.value);
  }
  if(new Set(tools).size!==tools.length)throw invalid();tools.sort();
  hash(value.promptSha256);hash(value.instructionsSha256);
  return Object.freeze({version:1,sourceId:nativeBackgroundSourceId(who),origin:who,workId:value.workId as string,parentWorkId:value.parentWorkId as string|null,
    model:Object.freeze({provider:value.model.provider,modelId:value.model.modelId,api:value.model.api}),allowedTools:Object.freeze(tools),
    maxToolCalls:value.maxToolCalls as number|null,acceptedAt:value.acceptedAt,expiresAt:value.expiresAt,promptSha256:value.promptSha256,instructionsSha256:value.instructionsSha256});
}
export function readNativeBackgroundPolicy(value:unknown):NativeBackgroundPolicy{
  fields(value,["version","sourceId","origin","workId","parentWorkId","model","allowedTools","maxToolCalls","acceptedAt","expiresAt","promptSha256","instructionsSha256"]);
  if(value.version!==1)throw invalid();const result=policyFields(value,origin(value.origin));
  if(value.sourceId!==result.sourceId||JSON.stringify(value.allowedTools)!==JSON.stringify(result.allowedTools))throw invalid();
  return result;
}
export function createNativeBackgroundPayload(input:NativeBackgroundPolicyInput):NativeBackgroundPayload{
  fields(input,["origin","workId","parentWorkId","model","allowedTools","maxToolCalls","acceptedAt","expiresAt","prompt","instructions"]);
  if(typeof input.prompt!=="string"||!input.prompt.trim()||input.prompt.length>100_000||typeof input.instructions!=="string")throw invalid();
  const who=origin(input.origin);if(who.kind!=='dream')throw Error('Only native Dream background payloads can be created');
  const policy=policyFields({...input,promptSha256:sha(input.prompt),instructionsSha256:sha(input.instructions)},who);
  return Object.freeze({version:1,policy,prompt:input.prompt,instructions:input.instructions});
}
export function readNativeBackgroundPayload(value:unknown):NativeBackgroundPayload{
  fields(value,["version","policy","prompt","instructions"]);if(value.version!==1||typeof value.prompt!=="string"||!value.prompt.trim()||value.prompt.length>100_000||typeof value.instructions!=="string")throw invalid();
  const policy=readNativeBackgroundPolicy(value.policy);
  if(sha(value.prompt)!==policy.promptSha256||sha(value.instructions)!==policy.instructionsSha256)throw invalid();
  return Object.freeze({version:1,policy,prompt:value.prompt,instructions:value.instructions});
}
export const nativeBackgroundPolicyHash=(policy:NativeBackgroundPolicy)=>hashCanonicalRequest(readNativeBackgroundPolicy(policy));
/** A persisted snapshot is evidence, not execution permission. The host must
 * additionally revalidate its current grant, model approval and actual effect
 * source. No policy is silently renewed or widened during ACK/restart repair. */
export function assertNativeBackgroundRetry(stored:NativeBackgroundPolicy,candidate:NativeBackgroundPolicy):void{
  if(nativeBackgroundPolicyHash(stored)!==nativeBackgroundPolicyHash(candidate))throw Error("Native background retry identity conflict");
}
export function assertNativeBackgroundModel(policy:NativeBackgroundPolicy,physical:{provider:string;id:string;api:string}):void{
  const snapshot=readNativeBackgroundPolicy(policy);
  if(physical.provider!==snapshot.model.provider||physical.id!==snapshot.model.modelId||physical.api!==snapshot.model.api)throw Error("Native background physical model changed");
}
export function assertNativeBackgroundDeadline(policy:NativeBackgroundPolicy,now:number):void{
  const snapshot=readNativeBackgroundPolicy(policy);
  if(!Number.isSafeInteger(now)||now<Date.parse(snapshot.acceptedAt))throw Error("Native background deadline unavailable or expired");
  if(now>=Date.parse(snapshot.expiresAt)){const error=Error('Native background deadline unavailable or expired');error.name='TimeoutError';throw error;}
}
