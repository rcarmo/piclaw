// Ported from rcarmo/kintsugi b8469c29; MIT — see UPSTREAM-LICENSE.
import {McpOAuthAuthorizationRequiredError} from "@earendil-works/pi-mcp/oauth";
import { McpClient, StreamableHttpTransport, McpHttpError, McpSessionExpiredError, McpConnectionClosedError, McpTimeoutError, normalizeMcpInputSchema, toLlmContent, type Tool as McpTool, type McpFetch, type AuthProvider } from "@earendil-works/pi-mcp";
import { defineExtension, defineTool, type JsonObject, type ConversationId } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { createHash } from 'node:crypto';
import { Value } from "typebox/value";
import type { Context } from "@earendil-works/chord/context";
import type {McpAuthority} from './authority.ts';
export type McpHttpConnection = {id:string;name:string;url:string;bearer:string;auth?:'none'|'bearer'|'oauth';allowHttp:boolean;timeoutSeconds:number};
export function mcpEndpoint(value:string,allowHttp=false):string {
  const url = new URL(value);
  if (!["https:","http:"].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error("Use an HTTP(S) MCP endpoint without credentials, query or fragment.");
  if (url.protocol === "http:" && !allowHttp) throw new Error("Allow HTTP for this trusted-network connection, or use HTTPS.");
  return url.href;
}
/** An authenticated Streamable HTTP session. Bearer-token sessions do not require OAuth discovery. */
export async function connectMcpHttp(config:McpHttpConnection,fetcher:McpFetch = fetch,authProvider?:AuthProvider,signal?:AbortSignal,authority?:Pick<McpAuthority,'assertSend'|'cleanup'>) {
  const endpoint = mcpEndpoint(config.url,config.allowHttp);
  if (!authProvider && config.auth!=='none' && (!config.bearer || /[\r\n]/.test(config.bearer))) throw new Error("Enter a bearer token without line breaks.");
  const client = new McpClient({name:"piclaw",version:"1",requestTimeoutMs:config.timeoutSeconds*1000});
  const transport = new StreamableHttpTransport({url:endpoint,headers:authProvider||config.auth==='none'?undefined:{Authorization:`Bearer ${config.bearer}`},authProvider,fetch:async (input,init) => {
    const target = new URL(input instanceof Request ? input.url : String(input));
    if (target.href !== endpoint) throw new Error("MCP request left the configured endpoint.");
    const httpMethod=init?.method??(input instanceof Request?input.method:'GET');
    const rpc=typeof init?.body==='string'?JSON.parse(init.body) as {method?:string}:undefined;
    authority?.assertSend(rpc?.method,httpMethod);
    return fetcher(input,{...init,redirect:"error"});
  }});
  let closing:Promise<void>|undefined;
  const close=()=>closing??=Promise.resolve().then(()=>authority?authority.cleanup(()=>client.close()):client.close());
  const abort=()=>{void close().catch(()=>{});};
  signal?.addEventListener("abort",abort,{once:true});
  try {signal?.throwIfAborted();await client.connect(transport);const tools=client.serverCapabilities?.tools?await client.listTools({signal}):[];signal?.throwIfAborted();return{client,tools};}
  catch (error) {try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'MCP HTTP startup cleanup uncertain');}throw error;}
  finally {signal?.removeEventListener("abort",abort);}
}
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Transport exceptions are external input; expose only known status classes, never raw bodies.
export function mcpFailure(error:unknown):string {
  // External errors are deliberately not echoed: HTTP bodies may contain credentials or server diagnostics.
  if (error instanceof Error && error.name === "McpOAuthAuthorizationRequiredError") return "Sign in to this MCP server in Settings.";
  if (error instanceof Error && "status" in error) {
    if (error.status === 401) return "Authentication failed. Replace the server token.";
    if (error.status === 403) return "This credential is not allowed to perform that operation.";
    if (error.status === 404) return "The MCP endpoint or session is no longer available. Reconnect.";
  }
  return "MCP request failed. Check the endpoint, certificate and server availability.";
}
/** Connection retries never repeat a tool invocation. External transport errors are classified here. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Network/SDK exceptions are external input.
export function retryableMcpFailure(error:unknown):boolean {
  if(error instanceof McpSessionExpiredError)return true;
  if(error instanceof McpHttpError)return [408,425,429].includes(error.status)||error.status>=500;
  if(error instanceof McpConnectionClosedError||error instanceof McpTimeoutError||error instanceof DOMException&&error.name==="TimeoutError")return true;
  const code=Type.Object({code:Type.String()});
  return Value.Check(code,error)&&["ECONNREFUSED","ECONNRESET","EAI_AGAIN","ENOTFOUND","ENETUNREACH","EHOSTUNREACH","ETIMEDOUT","UND_ERR_CONNECT_TIMEOUT","UND_ERR_SOCKET"].includes(error.code);
}
export function lostMcpSession(error:Error):boolean {
  return error instanceof McpOAuthAuthorizationRequiredError||error instanceof McpSessionExpiredError||error instanceof McpConnectionClosedError||error instanceof McpHttpError&&[401,403].includes(error.status);
}
type McpToolOwner=Pick<McpHttpConnection,'id'|'name'>&{revision?:number;url?:string;workspaceId?:string;transport?:'http'|'stdio';command?:string[];workdir?:string};
/** A versioned alias must never resolve an old ambiguous checkpoint to a new tool. */
export function mcpToolAlias(config:McpToolOwner,method:'tool'|'resource',remote:string) {
  // Old aliases always have another double underscore after the MCP prefix.
  const label=`${config.name}_${remote}`.replace(/[^A-Za-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,25).replace(/_$/,'')||'tool';
  const destination=config.transport==='stdio'?['stdio',config.workspaceId,config.command,config.workdir]:['http',config.url];
  const digest=createHash('sha256').update(JSON.stringify([config.id,config.name,destination,method,remote])).digest('hex').slice(0,24);
  return `mcp__v2_${label}_${digest}_v2`;
}
/** Register actual MCP tools behind code mode. Every call rechecks source authority and credential revision. */
export function mcpToolsExtension(config:McpToolOwner,tools:readonly McpTool[],clientFor:(conversationId:ConversationId,context:Context) => Promise<McpClient>,onFailure?:(error:Error)=>void,authority?:Pick<McpAuthority,'invoke'>) {
  const details=(tool:string)=>({mcpConnectionId:config.id,mcpConnectionRevision:config.revision??0,mcpServer:config.name,mcpTool:tool});
  const registered = tools.map(tool => defineTool({
    name:mcpToolAlias(config,'tool',tool.name),description:tool.description ?? tool.name,parameters:Type.Unsafe<JsonObject>(normalizeMcpInputSchema(tool.inputSchema)),structuredOutputSchema:tool.outputSchema??Type.String(),
    callers:["tools"],replay:"unsafe",
    async execute(args,api,context) {
      const client = await clientFor(api.conversationId,context);
      await api.details(details(tool.name),context);
      try {
        const result = await client.callTool(tool.name,args,{signal:context.abortSignal,onProgress:progress => api.output(`${progress.message ?? "MCP request in progress"}\n`)});
        const output=toLlmContent(result);
        // The SDK bounds schema-less output before giving it to scripts. Declare
        // its existing text contract explicitly so the full value stays intact;
        // model-facing text/images keep the SDK's normal output limits.
        let structuredOutput;
        if (result.isError !== true) {
          if (tool.outputSchema === undefined) structuredOutput = output.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n');
          else if (result.structuredContent !== undefined) {
            const value = result.structuredContent;
            structuredOutput = typeof value === 'string' ? value : JSON.parse(JSON.stringify(value));
          }
        }
        return {output,structuredOutput,isError:result.isError === true,details:details(tool.name)};
      } catch (error) {context.abortSignal?.throwIfAborted();if(error instanceof Error)onFailure?.(error);throw new Error(mcpFailure(error));}
    },
  }));
  // Servers may publish additional contracts as resources or URI templates.
  const resources = [defineTool({name:mcpToolAlias(config,'resource','resources_list'),description:`List ${config.name} resources and URI templates.`,parameters:Type.Object({}),structuredOutputSchema:Type.Object({resources:Type.Array(Type.Unknown()),templates:Type.Array(Type.Unknown())}),callers:["tools"],replay:"unsafe",async execute(_args,api,context) {
    const client = await clientFor(api.conversationId,context);
    try {const resources = client.serverCapabilities?.resources ? await client.listResources({signal:context.abortSignal}) : [],templates = client.serverCapabilities?.resources ? await client.listResourceTemplates({signal:context.abortSignal}) : [];
      return {structuredOutput:JSON.parse(JSON.stringify({resources,templates})),details:details("resources_list")};
    } catch (error) {context.abortSignal?.throwIfAborted();if(error instanceof Error)onFailure?.(error);throw new Error(mcpFailure(error));}
  }}),defineTool({name:mcpToolAlias(config,'resource','resource_read'),description:`Read a discovered ${config.name} resource URI, including memory://catalog and advertised workflow templates.`,parameters:Type.Object({uri:Type.String({minLength:1,maxLength:2048})}),structuredOutputSchema:Type.Object({contents:Type.Array(Type.Unknown())}),callers:["tools"],replay:"unsafe",async execute(args,api,context) {
    const client = await clientFor(api.conversationId,context);
    try {return {structuredOutput:JSON.parse(JSON.stringify(await client.readResource(args.uri,{signal:context.abortSignal}))),details:details("resource_read")};}
    catch (error) {context.abortSignal?.throwIfAborted();if(error instanceof Error)onFailure?.(error);throw new Error(mcpFailure(error));}
  }})];
  const exposed=[...registered,...resources].map(tool=>({...tool,deferred:true as const,execute(args:never,api:Parameters<typeof tool.execute>[1],context:Context){return authority?authority.invoke(api,context,()=>tool.execute(args,api,context)):tool.execute(args,api,context);}}));
  if(new Set(exposed.map(tool=>tool.name)).size!==exposed.length)throw Error('MCP catalogue contains duplicate tool identities');
  return defineExtension({name:`piclaw.mcp.${config.id}`,tools:exposed});
}
