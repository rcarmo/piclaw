// Connection/access semantics ported from Kintsugi b8469c29; MIT — see UPSTREAM-LICENSE.
// Piclaw stores only metadata and existing keychain references here, never bearer/client-secret values.
import type {Database} from 'bun:sqlite';
import {createHash} from 'node:crypto';
import {Type,type Static} from 'typebox';
import {Value} from 'typebox/value';
import {McpRecallSettingsSchema,defaultMcpRecallSettings} from '#token-optimizer/core';
import {admitSqliteWrite} from '../../../src/db/sqlite-async-admission.js';
import {canonicalMcpAccess,mcpAccess,mcpAccessOverlaps,mcpAccessSchema,mcpIdentitySchema} from './policy.ts';
import {mcpEndpoint} from './client.ts';
import {mcpEnvironmentValueIssue} from './environment.ts';
const reference=Type.String({minLength:1,maxLength:512,pattern:'^[^\\r\\n]+$'});
const fields={id:mcpIdentitySchema,name:Type.String({pattern:'^[A-Za-z0-9_]{1,128}$'}),workspaceId:mcpIdentitySchema,agentIds:Type.Array(mcpIdentitySchema,{maxItems:100}),access:Type.Optional(mcpAccessSchema),enabled:Type.Boolean(),transport:Type.Union([Type.Literal('http'),Type.Literal('stdio')]),url:Type.String({maxLength:2048}),credentialUrl:Type.Optional(Type.String({maxLength:2048})),credentialCommand:Type.Optional(Type.String({pattern:'^(?:[a-f0-9]{64})?$'})),auth:Type.Union([Type.Literal('none'),Type.Literal('bearer'),Type.Literal('oauth')]),bearerTokenKeychain:Type.Optional(reference),oauth:Type.Optional(Type.Object({clientId:Type.Optional(Type.String({maxLength:2048})),clientSecretKeychain:Type.Optional(reference),scope:Type.Optional(Type.String({maxLength:2048}))},{additionalProperties:false})),command:Type.Optional(Type.Array(Type.String({minLength:1,maxLength:4096}),{minItems:1,maxItems:128})),workdir:Type.Optional(Type.String({maxLength:4096})),env:Type.Optional(Type.Record(Type.String(),Type.String())),allowHttp:Type.Boolean(),timeoutSeconds:Type.Integer({minimum:1,maximum:300}),recall:Type.Optional(McpRecallSettingsSchema)};
export const McpConnectionInputSchema=Type.Object(fields,{additionalProperties:false});
export const McpConnectionSchema=Type.Object({...fields,revision:Type.Integer({minimum:1}),accessEpoch:Type.String({minLength:1,maxLength:128})},{additionalProperties:false});
export type McpConnection=Static<typeof McpConnectionSchema>;
export type McpConnectionInput=Static<typeof McpConnectionInputSchema>;
export type PublicMcpConnection=Omit<McpConnection,'bearerTokenKeychain'|'oauth'|'env'> & {hasSavedCredentials:boolean;needsCredentialApproval:boolean;environmentNames:string[];oauth?:{clientId?:string;scope?:string}};
export class McpConnectionValidationError extends Error{}
export const mcpCommandCredentialTarget=(value:Pick<McpConnectionInput,'workspaceId'|'command'|'workdir'>)=>createHash('sha256').update(JSON.stringify([value.workspaceId,value.command??[],value.workdir??null])).digest('hex');
const commandReferences=(value:Pick<McpConnectionInput,'env'>)=>Object.values(value.env??{}).filter(entry=>entry.startsWith('keychain:'));
const accessIdentity=(value:McpConnectionInput)=>JSON.stringify([value.workspaceId,canonicalMcpAccess(mcpAccess(value)),value.url,value.credentialUrl??value.url,value.credentialCommand,value.bearerTokenKeychain,value.transport,value.auth,value.command,value.workdir,value.env,value.oauth]);
/** Existing application SQLite connection; admission and caller ownership remain Core-owned. */
export class McpConnectionStore{
 private readonly listeners=new Set<()=>Promise<void>>();
 constructor(private readonly database:Database,private readonly assertOwner:()=>void,private readonly credentialEpoch?:(row:McpConnection)=>string){
  assertOwner();database.exec('CREATE TABLE IF NOT EXISTS mcp_connections_v1(id TEXT PRIMARY KEY, config TEXT NOT NULL);');
 }
 private stored(id:string):McpConnection|undefined{
  this.assertOwner();const row=this.database.query<{config:string},[string]>('SELECT config FROM mcp_connections_v1 WHERE id=?').get(id);if(!row)return;const value:unknown=JSON.parse(row.config);Value.Assert(McpConnectionSchema,value);return value;
 }
 credential(id:string):McpConnection|undefined{const row=this.stored(id);return row&&this.credentialEpoch?{...row,accessEpoch:createHash('sha256').update(JSON.stringify([row.accessEpoch,this.credentialEpoch(row)])).digest('hex')}:row;}
 private rows(){this.assertOwner();return this.database.query<{config:string},[]>('SELECT config FROM mcp_connections_v1 ORDER BY id').all().map(row=>{const value:unknown=JSON.parse(row.config);Value.Assert(McpConnectionSchema,value);return value;});}
 list():PublicMcpConnection[]{return this.rows().map(row=>this.credential(row.id)!).map(({bearerTokenKeychain,oauth,env,...row})=>({...row,hasSavedCredentials:Boolean(bearerTokenKeychain||oauth?.clientSecretKeychain||commandReferences({env}).length),needsCredentialApproval:row.transport==='http'?(row.credentialUrl??row.url)!==row.url:commandReferences({env}).length>0&&row.credentialCommand!==mcpCommandCredentialTarget(row),environmentNames:Object.keys(env??{}),...(oauth?{oauth:{clientId:oauth.clientId,scope:oauth.scope}}:{})}));}
 watch(listener:()=>Promise<void>){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
 async save(input:McpConnectionInput,options:{expectedRevision?:number;approveCredentialReuse?:boolean;authorise?:()=>void;signal?:AbortSignal}={}){
  const supplied=structuredClone(input);Value.Assert(McpConnectionInputSchema,supplied);
  const check=()=>{this.assertOwner();options.authorise?.();};
  const stored=await admitSqliteWrite(this.database,()=>{
   check();const previous=this.stored(supplied.id);
   if(options.expectedRevision!==undefined&&options.expectedRevision!==(previous?.revision??0))throw new McpConnectionValidationError('The connection changed; reload before saving.');
   if(!previous&&this.rows().length>=100)throw new McpConnectionValidationError('At most 100 MCP connections can be configured.');
   const candidate:McpConnection={...supplied,revision:(previous?.revision??0)+1,accessEpoch:previous?.accessEpoch??crypto.randomUUID(),recall:supplied.recall??previous?.recall??defaultMcpRecallSettings()};
   if(candidate.access){candidate.access=canonicalMcpAccess(candidate.access);if(candidate.access.kind==='workspaces'&&new Set(candidate.access.grants.map(g=>g.workspaceId)).size!==candidate.access.grants.length)throw new McpConnectionValidationError('Choose each workspace only once.');}
   if(candidate.transport==='stdio'){
    const access=mcpAccess(candidate);if(access.kind!=='workspaces'||access.grants.length!==1||access.grants[0]!.workspaceId!==candidate.workspaceId)throw new McpConnectionValidationError('Stdio needs one execution workspace.');
    if(!candidate.command?.length||candidate.command.some(arg=>arg.includes('\0'))||candidate.workdir&&!candidate.workdir.startsWith('/'))throw new McpConnectionValidationError('Use command arguments and an absolute workspace directory.');
    for(const[key,value]of Object.entries(candidate.env??{})){const issue=mcpEnvironmentValueIssue(key,value);if(issue)throw new McpConnectionValidationError(issue);}
    const target=mcpCommandCredentialTarget(candidate),refs=commandReferences(candidate),previousRefs=previous?.transport==='stdio'?commandReferences(previous):[];
    if(refs.length){candidate.credentialCommand=previous&&refs.some(ref=>previousRefs.includes(ref))?previous.credentialCommand??'':previous?target:supplied.credentialCommand??target;if(options.approveCredentialReuse)candidate.credentialCommand=target;if(candidate.credentialCommand!==target)candidate.enabled=false;}
    else delete candidate.credentialCommand;
    candidate.url='';candidate.auth='bearer';delete candidate.bearerTokenKeychain;delete candidate.credentialUrl;delete candidate.oauth;
   }else{
    candidate.url=mcpEndpoint(candidate.url,candidate.allowHttp);delete candidate.command;delete candidate.workdir;delete candidate.env;delete candidate.credentialCommand;
    if(candidate.auth==='none'){delete candidate.bearerTokenKeychain;delete candidate.oauth;}
    else if(candidate.auth==='oauth')delete candidate.bearerTokenKeychain;else delete candidate.oauth;
    const sameCredentials=previous&&candidate.auth===previous.auth&&candidate.bearerTokenKeychain===previous.bearerTokenKeychain&&JSON.stringify(candidate.oauth)===JSON.stringify(previous.oauth);
    candidate.credentialUrl=previous?(sameCredentials?(previous.credentialUrl??previous.url):candidate.url):(supplied.credentialUrl??candidate.url);
    if(candidate.auth==='none'||options.approveCredentialReuse)candidate.credentialUrl=candidate.url;
    if(candidate.credentialUrl!==candidate.url||candidate.auth==='bearer'&&!candidate.bearerTokenKeychain)candidate.enabled=false;
    // OAuth tokens are endpoint-bound; a URL change always needs an explicit new sign-in.
    if(previous&&candidate.auth==='oauth'&&previous.url!==candidate.url)candidate.enabled=false;
   }
   if(previous&&accessIdentity(previous)!==accessIdentity(candidate))candidate.accessEpoch=crypto.randomUUID();
   if(this.rows().some(row=>row.id!==candidate.id&&row.name===candidate.name&&mcpAccessOverlaps(row,candidate)))throw new McpConnectionValidationError('That server name already grants access to one of these workspaces.');
   Value.Assert(McpConnectionSchema,candidate);
   this.database.query('INSERT INTO mcp_connections_v1(id,config) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET config=excluded.config').run(candidate.id,JSON.stringify(candidate));check();return candidate;
  },check,options.signal,undefined,check);
  await Promise.all([...this.listeners].map(listener=>listener()));return stored;
 }
 async remove(id:string,options:{expectedRevision?:number;authorise?:()=>void;signal?:AbortSignal}={}){
  const check=()=>{this.assertOwner();options.authorise?.();};
  await admitSqliteWrite(this.database,()=>{check();const previous=this.credential(id);if(options.expectedRevision!==undefined&&options.expectedRevision!==(previous?.revision??0))throw new McpConnectionValidationError('The connection changed; reload before removing.');this.database.query('DELETE FROM mcp_connections_v1 WHERE id=?').run(id);check();},check,options.signal,undefined,check);
  // Existing keychain entries are shared references and are never deleted here.
  await Promise.all([...this.listeners].map(listener=>listener()));
 }
}
