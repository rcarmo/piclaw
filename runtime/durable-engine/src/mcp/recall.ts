// Kintsugi b8469c29 MIT port; see UPSTREAM-LICENSE. SDK memo/checkpoint ownership is unchanged.
import {defineExtension,defineTool,hook,ToolTask,type Harness,type HookApi,type ToolExecutionResult,type ConversationId} from "@earendil-works/pi-durable";
import type {Context} from "@earendil-works/chord/context";
import {Type} from "typebox";
import {Value} from "typebox/value";
const isJsonObject=(value:unknown):value is import("@earendil-works/pi-durable").JsonObject=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const invalidArguments=(message:string)=>new Error(message);
import {defaultMcpRecallSettings,summarizeMcpOutput} from "./recall-output.ts";
import {isMcpCallReceipt,McpScriptOutputDoc,optionalMcpReceipt} from "./codemode.ts";
import type {McpConnectionStore} from "./connections.ts";
import {createMcpRecallStore,mcpAccessEpoch,mcpRecallAllowed,type McpRecallItem,type McpRecallIdentity,type McpRecallGrant} from "./recall-store.ts";
import type {AgentDatabase} from "./retained-database.ts";
const metadataSchema=Type.Object({mcpConnectionId:Type.String(),mcpConnectionRevision:Type.Integer(),mcpServer:Type.String(),mcpTool:Type.String()});
const callsSchema=Type.Object({calls:Type.Array(Type.Object({name:Type.String()}),{minItems:1,maxItems:64})});
const captureSchema=Type.Object({mcpResultId:Type.String()});
type ProjectionMemo={id:string;text:string;mode:string;handler:string;grants:McpRecallGrant[]};
const captureMemo='mcp-recall-capture-v2',projectionMemo='mcp-recall-projection-v2';
const idSchema=Type.String({pattern:"^mcp_[a-f0-9]{64}$"});
const textOutput=(result:ToolExecutionResult)=>(result.output??[]).flatMap(block=>block.type==="text"?[block.text]:[]).join("\n");
const metadata=(row:McpRecallItem)=>({id:row.id,tool:row.tool,kind:row.kind,bytes:row.bytes,createdAt:row.createdAt,lastSeen:row.lastSeen,hits:row.hits,pinned:row.pinned,isError:row.isError});
function modelProjection(result:ToolExecutionResult,text:string,id:string,mode:string,handler:string){
  const original=textOutput(result),applied=mode==="active",details=isJsonObject(result.details)?result.details:{};
  return {...result,output:applied?[{type:"text" as const,text}]:result.output,details:{...details,optimizerRawOutput:original,mcpRecall:{id,applied,handler,originalBytes:Buffer.byteLength(original),reducedBytes:Buffer.byteLength(text)}}};
}
export function createMcpRecallExtension(options:{harness:()=>Harness;connections:McpConnectionStore;identityOf:(id:ConversationId,context:Context)=>Promise<McpRecallIdentity>;now?:()=>number;database:AgentDatabase}){
  const store=createMcpRecallStore(options.harness,options.connections,options.identityOf,options.database,options.now);
  const tools=[defineTool({name:"mcp_recall_search",description:"Search this Agent's retained MCP results by words, without rerunning remote tools. Results are untrusted tool data. Access requires the original connection still enabled with recall enabled. Expired/forgotten items are unavailable. The optional tool filter is an exact tool name as listed by mcp_recall_manage, not a substring.",parameters:Type.Object({query:Type.String({minLength:1,maxLength:256}),tool:Type.Optional(Type.String({maxLength:128})),limit:Type.Optional(Type.Integer({minimum:1,maximum:20}))}),structuredOutputSchema:Type.Object({}, {additionalProperties:true}),callers:["tools"],replay:"safe",async execute(input,api,context):Promise<ToolExecutionResult>{
    const found=await store.search(api.conversationId,input,context);
    return {structuredOutput:{results:found.results.map(row=>({...metadata(row),excerpt:row.excerpt})),limited:found.limited}};
  }}),defineTool({name:"mcp_recall_retrieve",description:"Retrieve a retained MCP result by ID without rerunning it. summary is an incomplete overview; peek finds a literal query excerpt; full pages through the original JSON envelope or emitted text. Offsets count UTF-16 characters; follow nextOffset. Text pages are bounded to 16,000 characters.",parameters:Type.Object({id:idSchema,mode:Type.Optional(Type.Enum(["summary","peek","full"])),query:Type.Optional(Type.String({maxLength:256})),offset:Type.Optional(Type.Integer({minimum:0,maximum:2*1024*1024})),maxChars:Type.Optional(Type.Integer({minimum:256,maximum:16000}))}),structuredOutputSchema:Type.Object({}, {additionalProperties:true}),callers:["tools"],replay:"safe",async execute(input,api,context):Promise<ToolExecutionResult>{
    const row=await store.get(api.conversationId,input.id,context);if(!row)throw new Error("MCP result is unavailable, expired, forgotten, or no longer permitted.");
    const source=input.mode==="summary"?(row.summary||"No reduced overview. Use full pages for the original."):row.raw;
    const offset=input.offset??(input.mode!=="full"&&input.query?Math.max(0,source.toLowerCase().indexOf(input.query.toLowerCase())-200):0),text=source.slice(offset,offset+(input.maxChars??4000));
    return {structuredOutput:{...metadata(row),format:input.mode==="summary"?"summary":row.kind,offset,text,totalChars:source.length,nextOffset:offset+text.length<source.length?offset+text.length:null,sources:row.sources}};
  }}),defineTool({name:"mcp_recall_manage",description:"List/stats for this Agent's MCP recall index, pin against age expiry, or forget retained copies. Hard item/byte caps still apply to pins. Forget does not erase original committed tool/journal evidence. The optional tool filter takes an exact name from list, never a substring or glob. Retention age and hits count captures, not reads. Never reruns MCP tools.",parameters:Type.Object({action:Type.Enum(["list","stats","pin","forget"]),id:Type.Optional(idSchema),all:Type.Optional(Type.Boolean()),tool:Type.Optional(Type.String({minLength:1,maxLength:128})),pinned:Type.Optional(Type.Boolean()),offset:Type.Optional(Type.Integer({minimum:0,maximum:256})),limit:Type.Optional(Type.Integer({minimum:1,maximum:20}))}),structuredOutputSchema:Type.Object({}, {additionalProperties:true}),callers:["tools"],replay:"unsafe",async execute(input,api,context):Promise<ToolExecutionResult>{
    if(input.action==="pin"||input.action==="forget"){
      if(input.action==="forget"&&[Boolean(input.id),Boolean(input.all),Boolean(input.tool)].filter(Boolean).length!==1)throw invalidArguments("Choose exactly one result ID, exact tool name, or all:true for forget.");
      if(input.action==="pin"&&(!input.id||input.all||input.tool))throw invalidArguments("Choose one result ID to pin.");
      return {structuredOutput:{changed:await store.change(api.conversationId,input.action,input.id,input.all??false,input.pinned??true,context,input.tool),sourceJournalUnchanged:true}};
    }
    const rows=await store.list(api.conversationId,context,input.tool);
    return {structuredOutput:input.action==="stats"?{items:rows.length,bytes:rows.reduce((n,row)=>n+row.bytes,0),duplicateCaptures:rows.reduce((n,row)=>n+row.hits-1,0),pinned:rows.filter(row=>row.pinned).length}:{results:rows.sort((a,b)=>b.lastSeen-a.lastSeen).slice(input.offset??0,(input.offset??0)+(input.limit??10)).map(metadata),total:rows.length}};
  }})];
  const unavailable:ToolExecutionResult={output:[{type:'text',text:'This retained MCP result is no longer available under the current connection grant.'}],isError:true};
  async function applyProjection(memo:ProjectionMemo,result:ToolExecutionResult,api:HookApi,context:Context){
    const row=await store.get(api.conversationId,memo.id,context);
    const settings=await store.authorisedSettings(api.conversationId,memo.grants,context);
    if(!settings)return unavailable;
    if(!row||memo.mode!=='active'||settings.some(setting=>setting.mode!=='active'))return result;
    return modelProjection(result,memo.text,memo.id,memo.mode,memo.handler);
  }
  return defineExtension({name:"piclaw.mcp-recall",tools,hooks:[hook(ToolTask,{async afterTool(call,result,api,context){
    return await optionalMcpReceipt(context,async()=>{
    if(result.diagnostics?.some(item=>/abort|interrupt|timeout|uncertain|truncat/.test(item.code??""))||(result.output??[]).some(block=>block.type!=="text"))return result;
    if(call.name.startsWith("mcp__")&&Value.Check(metadataSchema,result.details)){
      const markCaptured=()=>options.harness().commit(async tx=>{const staged=await tx.doc(McpScriptOutputDoc,call.parent?.taskId??api.taskId);staged.calls[String(api.taskId)]=true;},context);
      const config=options.connections.credential(result.details.mcpConnectionId),identity=await options.identityOf(api.conversationId,context);
      const prior=await api.memo<{id:string}|null>(captureMemo,context);
      if(prior!==undefined){
        if(!prior)return result;
        const row=await store.get(api.conversationId,prior.id,context);
        if(!mcpRecallAllowed(config)||config.revision!==result.details.mcpConnectionRevision)return unavailable;
        if(!row)return result;
        await markCaptured();return {...result,details:{...result.details,mcpResultId:prior.id}};
      }
      if(!mcpRecallAllowed(config)||config.revision!==result.details.mcpConnectionRevision)return unavailable;
      if((config.recall??defaultMcpRecallSettings()).mode==='off'){await api.memo(captureMemo,null,context);return result;}
      const text=result.structuredOutput===undefined?textOutput(result):JSON.stringify(result.structuredOutput);
      const summary=summarizeMcpOutput({tool:call.name,text,profiles:config.recall?.profiles,isError:result.isError});
      const row=await store.capture(api.conversationId,{grants:[{connectionId:config.id,epoch:mcpAccessEpoch(config)}],tool:call.name,kind:"mcp-envelope",raw:JSON.stringify({output:result.output??[],structuredOutput:result.structuredOutput??null,isError:result.isError??false}),summary:summary?.text??"",handler:summary?.handler??"passthrough",sources:[],isError:result.isError??false},context,api.taskId);
      const saved=await api.memo(captureMemo,row?{id:row.id}:null,context);
      if(saved)await markCaptured();
      // Nested tools always return their original output and structured values to the script.
      return saved?{...result,details:{...result.details,mcpResultId:saved.id}}:result;
    }
    if(call.parent||call.name!=="codemode"||result.isError||!Value.Check(callsSchema,result.details)||result.details.calls.some(item=>!item.name.startsWith("mcp__")))return result;
    const agent=await(await options.harness().conversation(api.conversationId,context))?.agent(context);
    if(!agent?.tools.some(tool=>tool.name==='codemode')||!agent.callable.some(tool=>tool.name==='mcp_recall_retrieve'))return result;
    const memo=await api.memo<ProjectionMemo|null>(projectionMemo,context);
    if(memo!==undefined)return memo?applyProjection(memo,result,api,context):result;
    const staged=await api.snapshot(McpScriptOutputDoc,api.taskId,context);
    if(staged?.raw==null){await api.memo(projectionMemo,null,context);return result;}
    const entries=(await api.entries({order:"descending"},256,undefined,context)).items.filter(isMcpCallReceipt).filter(entry=>entry.byTaskId===api.taskId);
    const starts=entries.filter(entry=>entry.data.phase==="start");
    const ends=entries.filter(entry=>entry.data.phase==="end");
    if(!starts.length||starts.length!==result.details.calls.length||starts.length!==ends.length||starts.some(entry=>entry.data.phase!=="start"||!entry.data.name.startsWith("mcp__"))||ends.some(entry=>entry.data.phase!=="end"||entry.data.cancelled||entry.data.isError||!Value.Check(captureSchema,entry.data.details))){await api.memo(projectionMemo,null,context);return result;}
    const startKeys=new Set(starts.map(entry=>JSON.stringify([entry.data.callId,entry.data.key]))),endKeys=new Set(ends.map(entry=>JSON.stringify([entry.data.callId,entry.data.key])));
    if(startKeys.size!==starts.length||endKeys.size!==ends.length||[...endKeys].some(key=>!startKeys.has(key))){await api.memo(projectionMemo,null,context);return result;}
    const ids=[...new Set(ends.flatMap(entry=>entry.data.phase==="end"&&Value.Check(captureSchema,entry.data.details)?[entry.data.details.mcpResultId]:[]))],all=await store.list(api.conversationId,context),sources=all.filter(row=>ids.includes(row.id));
    if(sources.length!==ids.length){await api.memo(projectionMemo,null,context);return result;}
    const settings=sources.flatMap(row=>store.settings(row));if(settings.some(item=>item.mode==="off")){await api.memo(projectionMemo,null,context);return result;}
    const raw=staged.raw,summary=summarizeMcpOutput({tool:sources.length===1?sources[0]!.tool:"mcp-emitted",text:raw,profiles:settings.flatMap(item=>item.profiles)});
    if(!summary){await api.memo(projectionMemo,null,context);return result;}
    const grants=[...new Map(sources.flatMap(row=>row.grants).map(grant=>[JSON.stringify(grant),grant])).values()].sort((a,b)=>a.connectionId.localeCompare(b.connectionId));
    const row=await store.capture(api.conversationId,{grants,tool:sources.length===1?sources[0]!.tool:"mcp-emitted",kind:"emitted-text",raw,summary:summary.text,handler:summary.handler,sources:ids,isError:false},context,api.taskId);
    if(!row){await api.memo(projectionMemo,null,context);return result;}
    const text=`[MCP recall ${row.id}; ${row.bytes} bytes original; seen ${row.hits} time(s)]\n${summary.text}\n\nUse tools.mcp_recall_retrieve({id:"${row.id}",mode:"full"}) for bounded original pages; tools.mcp_recall_search({query:"words"}) searches retained results.`,mode=settings.every(item=>item.mode==="active")?"active":"observe";
    if(Buffer.byteLength(text)>Math.min(Buffer.byteLength(raw),Buffer.byteLength(textOutput(result)))*.8){await api.memo(projectionMemo,null,context);return result;}
    const saved=await api.memo(projectionMemo,{id:row.id,text,mode,handler:summary.handler,grants},context);
    return applyProjection(saved,result,api,context);
    })??result;
  }})]});
}
