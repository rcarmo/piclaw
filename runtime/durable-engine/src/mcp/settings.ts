import {createHash,randomBytes} from 'node:crypto';
import {withAddonLocalRequest,addonLocalContextApi} from '../../../src/addons/local-context.js';
import {McpOAuthVault} from './oauth.ts';
import {McpConnectionConflictError,McpConnectionValidationError,type McpConnection,type McpConnectionInput} from './connections.ts';
import {defaultMcpRecallSettings} from './recall-output.ts';
import {admitSqliteWrite} from '../../../src/db/sqlite-async-admission.js';
import {mcpEnvironmentNameIssue} from './environment.ts';
import type {createApplicationMcp} from './application.ts';
import type {Database} from 'bun:sqlite';
const base='/agent/settings/mcp';
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const json=(value:unknown,status=200,headers:Record<string,string>={})=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie',...headers}});
export class McpSettingsBodyError extends Error{constructor(readonly status:number,message:string){super(message);}}
class McpSettingsAccessError extends Error{}
const clearable=new Set(['workdir','environment','oauthScope']);
/** Preserve the retired Settings reader's 5s deadline, cancellation and 64 KiB bound. */
export async function readSettingsBody(request:Request){
 if(!request.body)throw new McpSettingsBodyError(400,'Settings body required');const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0,fail!:(error:Error)=>void;
 const interrupted=new Promise<never>((_resolve,reject)=>{fail=reject;}),abort=()=>fail(new McpSettingsBodyError(400,'MCP settings request cancelled'));
 const timer=setTimeout(()=>fail(new McpSettingsBodyError(408,'MCP settings body timed out')),5000);request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted)abort();
 try{
  for(;;){const part=await Promise.race([reader.read().catch(()=>{throw new McpSettingsBodyError(400,'Could not read MCP settings body');}),interrupted]);if(part.done)break;size+=part.value.length;if(size>65536)throw new McpSettingsBodyError(413,'Settings body exceeds 64 KiB');chunks.push(part.value);}
  let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw new McpSettingsBodyError(400,'Invalid MCP settings JSON');}if(!object(value))throw new McpSettingsBodyError(400,'Settings object required');return value;
 }finally{clearTimeout(timer);request.signal.removeEventListener('abort',abort);void reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{}}
}
/** Authenticated Core settings only. This does not expose an inbound MCP/control server. */
export function createMcpSettingsHandler(service:ReturnType<typeof createApplicationMcp>,database:Database,assertOwner:()=>void){
 return async(request:Request,pathname:string):Promise<Response>=>withAddonLocalRequest(request,async principal=>{
  const check=()=>{request.signal.throwIfAborted();const current=addonLocalContextApi.getRequestContext(request);if(!principal||principal.kind!=='operator'||principal.workspaceId!==service.workspaceId||!current||current.ownerId!==principal.ownerId)throw new McpSettingsAccessError();assertOwner();};
  const guardConfig=(config:McpConnection)=>()=>{
   check();const current=service.connections.credential(config.id);
   if(current?.revision!==config.revision||current.accessEpoch!==config.accessEpoch)throw new McpConnectionConflictError('The connection changed; reload before signing in or out.');
  };
  try{
   check();await principal!.listTargets();check();
   const snapshot=()=>({ok:true,workspaceId:service.workspaceId,connections:service.connections.list().map(row=>({...row,status:service.mcp.status(row.id)})),agents:database.query<{id:string;label:string},[]>('SELECT branch_id AS id,agent_name AS label FROM chat_branches WHERE archived_at IS NULL ORDER BY agent_name,branch_id').all(),migration:service.migration,defaults:{recall:defaultMcpRecallSettings()}});
   const url=new URL(request.url),cookieName=(id:string)=>'mcp_oauth_'+createHash('sha256').update(id).digest('hex').slice(0,20);
   const callback=(id:string)=>{const target=new URL(base+'/oauth/callback',url.origin);target.searchParams.set('id',id);return target.href;};
   const cookie=(id:string,value:string,expire=false)=>`${cookieName(id)}=${value}; Path=${base}/oauth/callback; HttpOnly; SameSite=Lax; Max-Age=${expire?0:600}${url.protocol==='https:'?'; Secure':''}`;
   if(pathname===base+'/oauth/callback'&&request.method==='GET'){
    const id=url.searchParams.get('id')??'',config=service.connections.credential(id);if(!config||config.auth!=='oauth')return json({error:'MCP sign-in is unavailable'},400);
    const token=(request.headers.get('cookie')??'').split(';').map(part=>part.trim()).find(part=>part.startsWith(cookieName(id)+'='))?.slice(cookieName(id).length+1)??'';
    if(url.searchParams.has('error'))return json({error:'MCP sign-in was not completed'},400,{'Set-Cookie':cookie(id,'',true)});
    await new McpOAuthVault(config,guardConfig(config)).complete({code:url.searchParams.get('code')??'',state:url.searchParams.get('state')??''},token,callback(id));check();service.mcp.reconnect(id);
    return json({ok:true,message:'MCP sign-in completed. Return to Settings.'},200,{'Set-Cookie':cookie(id,'',true)});
   }
   if(pathname!==base)return json({error:'Not found'},404);if(url.search)return json({error:'MCP settings do not accept query parameters'},400);
   if(request.method==='GET')return json(snapshot());if(request.method!=='POST')return json({error:'Method not allowed'},405);
   const input=await readSettingsBody(request);check();const id=typeof input.id==='string'?input.id:'',previous=service.connections.credential(id);
   if(input.action==='save'){
    if(!object(input.connection)||typeof input.connection.id!=='string'||!Number.isInteger(input.expectedRevision))throw new McpSettingsBodyError(400,'Connection and expected revision required.');
    const clear=input.clear??[],removeEnvironment=input.removeEnvironment??[];
    if(!Array.isArray(clear)||clear.length>clearable.size||clear.some(key=>typeof key!=='string'||!clearable.has(key)))throw new McpSettingsBodyError(400,'Choose valid connection fields to clear.');
    if(!Array.isArray(removeEnvironment)||removeEnvironment.length>128||removeEnvironment.some(key=>typeof key!=='string'||mcpEnvironmentNameIssue(key)))throw new McpSettingsBodyError(400,'Use valid environment names to remove saved entries.');
    const prior=service.connections.credential(input.connection.id),value={...prior,...input.connection};delete value.revision;delete value.accessEpoch;
    if(prior?.env&&input.connection.env===undefined)value.env=prior.env;
    if(prior?.bearerTokenKeychain&&input.connection.bearerTokenKeychain===undefined)value.bearerTokenKeychain=prior.bearerTokenKeychain;
    if(prior?.oauth&&object(input.connection.oauth))value.oauth={...prior.oauth,...input.connection.oauth};
    if(clear.includes('workdir'))delete value.workdir;
    if(clear.includes('environment'))delete value.env;
    else if(removeEnvironment.length&&object(value.env)){value.env={...value.env};for(const key of removeEnvironment)delete value.env[key];}
    if(clear.includes('oauthScope')&&object(value.oauth)){value.oauth={...value.oauth};delete value.oauth.scope;}
    await service.connections.save(value as McpConnectionInput,{expectedRevision:input.expectedRevision as number,approveCredentialReuse:input.approveCredentialReuse===true,authorise:check,signal:request.signal});check();return json(snapshot());
   }
   if(typeof input.action!=='string'||!['remove','reconnect','sign_in','sign_out','forget_recall'].includes(input.action))throw new McpSettingsBodyError(400,'Unsupported MCP settings action.');
   if(!previous)throw new McpConnectionConflictError('Connection no longer exists. Reload Settings.');
   if(input.action==='remove'){if(!Number.isInteger(input.expectedRevision))throw new McpSettingsBodyError(400,'Expected revision required.');await service.connections.remove(id,{expectedRevision:input.expectedRevision as number,authorise:check,signal:request.signal});}
   else if(input.action==='reconnect')service.mcp.reconnect(id);
   else if(input.action==='sign_in'){
    const token=randomBytes(32).toString('base64url'),result=await new McpOAuthVault(previous,guardConfig(previous)).begin(callback(id),token);check();
    return json({ok:true,...(result.kind==='redirect'?{authorizationUrl:result.authorizationUrl}:{message:'Already signed in'})},200,{'Set-Cookie':cookie(id,token)});
   }else if(input.action==='sign_out'){
    if(!Number.isInteger(input.expectedRevision))throw new McpSettingsBodyError(400,'Expected revision required.');
    if(input.expectedRevision!==previous.revision)throw new McpConnectionConflictError('The connection changed; reload before signing out.');
    await new McpOAuthVault(previous,guardConfig(previous)).clear();check();const{revision,accessEpoch,...value}=previous;await service.connections.save({...value,enabled:false},{expectedRevision:revision,authorise:check,signal:request.signal});
   }else if(input.action==='forget_recall'){
    await admitSqliteWrite(database,()=>{check();if(database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mcp_recall'").get())database.query('DELETE FROM mcp_recall WHERE CASE WHEN json_valid(owner) THEN json_extract(owner,\'$[0]\') END=? AND EXISTS (SELECT 1 FROM json_each(mcp_recall.grants) WHERE json_extract(value,\'$.connectionId\')=?)').run(service.workspaceId,id);check();},check,request.signal,undefined,check);
   }check();return json(snapshot());
  }catch(error){
   if(error instanceof McpSettingsAccessError)return json({error:'Authenticated MCP configuration owner required.',code:'forbidden'},403);
   if(error instanceof McpSettingsBodyError)return json({error:error.message,code:'invalid_request'},error.status);
   if(error instanceof McpConnectionConflictError)return json({error:error.message,code:'revision_conflict'},409);
   if(error instanceof McpConnectionValidationError)return json({error:error.message,code:'invalid_connection'},400);
   return json({error:'MCP settings operation failed. Check the connection and current credentials.',code:'operation_failed'},500);
  }
 });
}
