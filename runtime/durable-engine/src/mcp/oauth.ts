// OAuth lifecycle port of Kintsugi b8469c29; MIT — see UPSTREAM-LICENSE.
// Tokens and PKCE state use Piclaw's existing encrypted keychain, never config JSON files.
import {createHash} from 'node:crypto';
import {Type,type Static} from 'typebox';
import {Value} from 'typebox/value';
import {startMcpSignIn,completeMcpSignIn,createMcpAuthProvider,type McpOAuthState,type McpOAuthServerStore,type McpAuthorizationResponse} from '@earendil-works/pi-mcp/oauth';
import {getKeychainEntry,setKeychainEntry,listKeychainEntries} from '../../../src/secure/keychain.js';
import type {McpConnection} from './connections.ts';
const client=Type.Object({client_id:Type.String(),client_secret:Type.Optional(Type.String())},{additionalProperties:true});
const tokens=Type.Object({access_token:Type.String(),token_type:Type.String(),refresh_token:Type.Optional(Type.String()),expires_in:Type.Optional(Type.Number()),scope:Type.Optional(Type.String())},{additionalProperties:true});
const stateSchema=Type.Unsafe<McpOAuthState>(Type.Object({serverUrl:Type.String(),clientInformation:Type.Optional(client),tokens:Type.Optional(tokens),tokensExpireAt:Type.Optional(Type.Number()),codeVerifier:Type.Optional(Type.String()),oauthState:Type.Optional(Type.String()),discovery:Type.Optional(Type.Object({authorizationServerUrl:Type.String(),authorizationServerMetadata:Type.Optional(Type.Object({},{additionalProperties:true})),resourceMetadata:Type.Optional(Type.Object({},{additionalProperties:true})),resourceMetadataUrl:Type.Optional(Type.String())}))}));
const redirect=Type.Object({kind:Type.Literal('redirect'),authorizationUrl:Type.String(),redirectUrl:Type.String(),state:Type.String(),scope:Type.Optional(Type.String())});
const envelope=Type.Object({binding:Type.String(),state:Type.Optional(stateSchema),pending:Type.Optional(Type.Object({authorization:redirect,redirectUrl:Type.String(),browserHash:Type.String(),expires:Type.Number()}))});
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
// OAuth's public SDK store requires refresh exclusion. The application singleton owns this lock domain.
const locks=new Map<string,Promise<void>>();
async function locked<T>(key:string,action:()=>Promise<T>):Promise<T>{const previous=locks.get(key)??Promise.resolve();let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});const next=previous.then(()=>held);locks.set(key,next);await previous;try{return await action();}finally{release();if(locks.get(key)===next)locks.delete(key);}}
export class McpOAuthVault implements McpOAuthServerStore{
 readonly binding:string;readonly keychainName:string;
 constructor(readonly config:McpConnection,private readonly assertCurrent:()=>void){
  this.binding=digest(JSON.stringify([config.id,config.workspaceId,config.url,config.auth,config.oauth??{}]));
  this.keychainName=`mcp/oauth/${config.workspaceId}/${config.id}`;
 }
 private async read():Promise<Static<typeof envelope>>{
  this.assertCurrent();if(!listKeychainEntries().some(row=>row.name===this.keychainName))return{binding:this.binding};
  const entry=await getKeychainEntry(this.keychainName);this.assertCurrent();const value:unknown=JSON.parse(entry.secret);Value.Assert(envelope,value);return value.binding===this.binding?value:{binding:this.binding};
 }
 private async update(change:(value:Static<typeof envelope>)=>void){
  await locked(this.keychainName+':write',async()=>{const current=await this.read();change(current);Value.Assert(envelope,current);this.assertCurrent();await setKeychainEntry({name:this.keychainName,type:'secret',secret:JSON.stringify(current)},this.assertCurrent);});
 }
 async load(){return(await this.read()).state;}
 async save(value:McpOAuthState){Value.Assert(stateSchema,value);await this.update(current=>{current.state=value;});}
 withRefreshLock<T>(action:()=>Promise<T>){return locked(this.keychainName+':refresh',async()=>{this.assertCurrent();const value=await action();this.assertCurrent();return value;});}
 private requireApproved(){this.assertCurrent();if(!this.config.enabled||this.config.auth!=='oauth'||this.config.credentialUrl!==undefined&&this.config.credentialUrl!==this.config.url)throw Error('Approve this OAuth endpoint before signing in');}
 private async settings(){this.requireApproved();const secret=this.config.oauth?.clientSecretKeychain?await getKeychainEntry(this.config.oauth.clientSecretKeychain):undefined;this.assertCurrent();return{clientId:this.config.oauth?.clientId,clientSecret:secret?.secret,scope:this.config.oauth?.scope,clientRegistration:'dcr' as const};}
 async begin(redirectUrl:string,browserToken:string){
  return locked(this.keychainName+':flow',async()=>{const result=await startMcpSignIn({serverUrl:this.config.url,store:this,settings:await this.settings(),clientName:'Piclaw',redirectUrl});this.assertCurrent();await this.update(current=>{if(result.kind==='redirect')current.pending={authorization:result,redirectUrl,browserHash:digest(browserToken),expires:Date.now()+600000};else delete current.pending;});return result;});
 }
 async complete(response:McpAuthorizationResponse,browserToken:string,redirectUrl:string){
  await locked(this.keychainName+':flow',async()=>{const current=await this.read(),pending=current.pending;this.requireApproved();if(!pending||pending.expires<Date.now()||pending.redirectUrl!==redirectUrl||pending.browserHash!==digest(browserToken)||pending.authorization.state!==response.state)throw Error('MCP sign-in expired or belongs to another browser');
   // Consume before token exchange. A failed/uncertain exchange is never replayed by a callback retry.
   await this.update(value=>{delete value.pending;});await completeMcpSignIn({serverUrl:this.config.url,store:this,settings:await this.settings(),clientName:'Piclaw',redirectUrl,authorization:pending.authorization,response});this.assertCurrent();
  });
 }
 async authProvider(){const settings=await this.settings();return createMcpAuthProvider({serverUrl:this.config.url,store:this,settings:()=>{this.requireApproved();return settings;},clientName:'Piclaw',onChallenge:()=>{}});}
 async clear(){await locked(this.keychainName+':flow',()=>this.withRefreshLock(()=>this.update(value=>{delete value.state;delete value.pending;})));}
}
