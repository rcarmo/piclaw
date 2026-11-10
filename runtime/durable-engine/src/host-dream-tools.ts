import { defineTool,type ConversationId,type TaskId } from '@earendil-works/pi-durable';
import type { JsonValue } from "@earendil-works/chord/json";
import { MessagesSchema,admitRegisteredMessagesTool } from '../../src/extensions/messages-crud.js';
import { WorkspaceSearchSchema } from '../../src/extensions/workspace-search.js';
import { searchWorkspace } from '../../src/workspace-search.js';
import { withWorkspaceIndexAuthority } from '../../src/core/workspace-index-access.js';

/** Private Dream registrations. The caller must capture the real accepted
 * Dream source; neither a tool name nor a model-supplied chat grants authority. */
export function createHostDreamTools(options:{
  assertOwner():void;
  capture(call:{conversationId:ConversationId;taskId:TaskId;toolCallId:string}):Promise<{chatJid:string;assertCurrent():void}>;
}){
  const owner=options.assertOwner.bind(options),capture=options.capture.bind(options);
  return [
    defineTool({name:'messages',description:'Search, retrieve, grep, extract, diff, add, post, move, or delete messages via shared store.',parameters:MessagesSchema,replay:'unsafe',callers:['model'],
      async execute(args,api,context){
        try{
        owner();context.abortSignal?.throwIfAborted();
        const source=await capture({conversationId:api.conversationId,taskId:api.taskId,toolCallId:api.callId});
        const assert=()=>{owner();context.abortSignal?.throwIfAborted();source.assertCurrent();};
        const result=await admitRegisteredMessagesTool(args,source.chatJid,assert,context.abortSignal);assert();
        return{output:result.content,details:result.details as JsonValue,isError:result.isError};
        }catch{throw Error("Native Dream tool failed");}
      }}),
    defineTool({name:'search_workspace',description:'Search indexed workspace content (configured FTS roots; notes + skills by default).',parameters:WorkspaceSearchSchema,replay:'unsafe',callers:['model'],
      async execute(args,api,context){
        try{
        owner();context.abortSignal?.throwIfAborted();
        const source=await capture({conversationId:api.conversationId,taskId:api.taskId,toolCallId:api.callId});
        const assert=()=>{owner();context.abortSignal?.throwIfAborted();source.assertCurrent();};
        // An invocation owns any stale-index refresh. Do not launch an escaped
        // background writer that could outlive Dream's descriptor lease.
        const result=await withWorkspaceIndexAuthority(assert,()=>searchWorkspace(args,{refreshStaleInline:true}));assert();
        const text=result.error??(!result.rows.length?'No matching workspace files found.':`Found ${result.rows.length} file${result.rows.length===1?'':'s'} (limit ${result.limit}, offset ${result.offset}).\n${result.rows.map(row=>`• ${row.path} — ${row.snippet}`).join('\n')}`);
        return{output:[{type:'text' as const,text}],details:{count:result.rows.length,results:result.rows} as JsonValue};
        }catch{throw Error("Native Dream tool failed");}
      }}),
  ];
}
