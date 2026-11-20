// Public SDK receipt/projection hooks ported from Kintsugi b8469c29; MIT — see mcp/UPSTREAM-LICENSE.
// This decorates the existing sandbox/API; it adds no script worker, executor or effect replay.
import {createCodemodeTool} from '@earendil-works/pi-durable/codemode';
import type {ToolExecutionApi,JsonObject,NestedToolExecutionResult} from '@earendil-works/pi-durable';
import {CodemodeSandbox,type CodemodeResult} from '@earendil-works/pi-codemode';
import type {Context} from '@earendil-works/chord/context';
import type {JsonValue} from '@earendil-works/chord/json';
import {optimizerCallEntry,OptimizerCallReceiptDoc,McpScriptOutputDoc,type OptimizerCallStart,type OptimizerCallEnd} from './optimizer-output-source.ts';
const object=(value:unknown):value is JsonObject=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function outputText(value:NestedToolExecutionResult['structuredOutput']){if(value===undefined)return;return typeof value==='string'?value:JSON.stringify(value);}
/** Caller delegates are still the SDK's own executeTool/agent/commit ports, including cancellation and call-key recovery. */
export function recordingOptimizerCalls(api:ToolExecutionApi):ToolExecutionApi{
 return new Proxy(api,{get(target,key){if(key==='executeTool')return async(name:string,args:JsonObject,context:Context,options?:{readonly key?:string;readonly progress?:boolean;readonly wait?:boolean})=>{
  const nested=options?.key;if(nested===undefined)throw Error('SDK code mode must supply its nested call key');
  const record=async(data:OptimizerCallStart|OptimizerCallEnd,ctx=context)=>api.commit(async tx=>{const receipts=await tx.doc(OptimizerCallReceiptDoc,api.taskId),id=`${nested}:${data.phase}`;if(receipts[id])return;await tx.appendEntry(optimizerCallEntry,api.conversationId,{data:{callId:api.callId,key:nested,...data}});receipts[id]=true;},ctx);
  const json=JSON.stringify(args),start:OptimizerCallStart={phase:'start',name,issuedAt:Date.now()};if(json.length<=65536)start.arguments=JSON.parse(json) as JsonValue;
  const finish=async(result:NestedToolExecutionResult,ctx:Context)=>{
   const end:OptimizerCallEnd={phase:'end',isError:result.isError,cancelled:result.diagnostics.some(d=>d.code==='aborted')};const text=outputText(result.structuredOutput);if(text!==undefined)end.output=text;if(result.durationMs!==undefined)end.durationMs=result.durationMs;const errors=result.diagnostics.filter(d=>d.severity==='error').map(d=>d.message).join('\n');if(errors)end.error=errors;if(object(result.details))end.details=result.details;
   await record(end,ctx);return result;
  };
  await record(start);
  if(options?.wait===false){
   const call=await api.executeTool(name,args,context,{...options,wait:false});
   return{taskId:call.taskId,async result(ctx:Context){return finish(await call.result(ctx),ctx);}};
  }
  return finish(await api.executeTool(name,args,context,{...options,wait:true}),context);
 };const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
}
export function createOptimizerCodemodeTool(sandbox:CodemodeSandbox){
 const definition=createCodemodeTool({sandbox,models:false});
 return{...definition,async execute(args:Parameters<typeof definition.execute>[0],api:ToolExecutionApi,context:Context){
  const observed=new Proxy(sandbox,{get(target,key){if(key==='start')return(code:string,options:Parameters<CodemodeSandbox['start']>[1])=>{
   const run=target.start(code,options);const result=run.result.then(async(value:CodemodeResult)=>{
    if(value.ok&&value.calls.length&&value.calls.every(call=>call.name.startsWith('mcp__'))&&value.output.every(item=>item.type==='text')){
     const pieces=value.output.flatMap(item=>item.type==='text'?[item.console?`<console_output>\n${item.text}\n</console_output>`:item.text]:[]);if(value.value!==undefined)pieces.push(typeof value.value==='string'?value.value:JSON.stringify(value.value));const raw=pieces.join('\n');
     if(Buffer.byteLength(raw)<=1024*1024)await api.commit(async tx=>{const staged=await tx.doc(McpScriptOutputDoc,api.taskId);if(Object.keys(staged.calls).length===value.calls.length)staged.raw=raw;},context);
    }return value;
   });return{result,get finished(){return run.finished;},deliver:run.deliver.bind(run)};
  };const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  return createCodemodeTool({sandbox:observed,models:false}).execute(args,recordingOptimizerCalls(api),context);
 }};
}
