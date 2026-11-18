// Existing encrypted keychain references resolve only inside this outbound connection boundary.
import {getKeychainEntry,resolveKeychainEnv} from '../../../src/secure/keychain.js';
import {getDb} from '../../../src/db.js';
import {createHash} from 'node:crypto';
import {mcpCommandCredentialTarget,type McpConnection} from './connections.ts';
import type {McpAuthority} from './authority.ts';
import {connectMcpHttp} from './client.ts';
import {connectMcpStdio} from './stdio.ts';
import {McpOAuthVault} from './oauth.ts';
import type {ConnectedMcp} from './runtime.ts';
export function mcpCredentialRevision(config:McpConnection):string{
 const database=getDb(),references=[...(config.bearerTokenKeychain?[config.bearerTokenKeychain]:[]),...(config.oauth?.clientSecretKeychain?[config.oauth.clientSecretKeychain]:[]),...Object.values(config.env??{}).filter(value=>value.startsWith('keychain:')).map(value=>value.slice(9).replace(/:(?:secret|username)$/, ''))];
 return createHash('sha256').update(JSON.stringify(references.map(name=>[name,database.query('SELECT type,ciphertext,nonce,salt,kdf,kdf_iterations FROM keychain_entries WHERE name=?').get(name)]))).digest('hex');
}
export async function connectMcpConnection(config:McpConnection,assertCurrent:()=>void,authority:McpAuthority,signal:AbortSignal,workspace:{id:string;root:string}):Promise<ConnectedMcp>{
 assertCurrent();signal.throwIfAborted();
 if(config.transport==='stdio'&&(config.workspaceId!==workspace.id||!workspace.root.startsWith('/')))throw Error('MCP stdio execution workspace changed');
 const database=getDb(),references=[...(config.bearerTokenKeychain?[config.bearerTokenKeychain]:[]),...(config.oauth?.clientSecretKeychain?[config.oauth.clientSecretKeychain]:[]),...Object.values(config.env??{}).filter(value=>value.startsWith('keychain:')).map(value=>value.slice(9).replace(/:(?:secret|username)$/,''))];
 const revision=(name:string)=>{const row=database.query('SELECT type,ciphertext,nonce,salt,kdf,kdf_iterations FROM keychain_entries WHERE name=?').get(name);return createHash('sha256').update(JSON.stringify(row)).digest('hex');};
 const revisions=references.map(name=>[name,revision(name)] as const),owner=assertCurrent;
 assertCurrent=()=>{owner();if(getDb()!==database||revisions.some(([name,version])=>revision(name)!==version))throw Error('MCP credential changed; reconnect to use the current reference');};
 if(config.transport==='stdio'){
  if(config.workspaceId!==workspace.id||!workspace.root.startsWith('/'))throw Error('MCP stdio execution workspace changed');
  if(Object.values(config.env??{}).some(value=>value.startsWith('keychain:'))&&config.credentialCommand!==mcpCommandCredentialTarget(config))throw Error('Approve credentials for this command before connecting');
  const env=await resolveKeychainEnv(config.env??{});assertCurrent();signal.throwIfAborted();
  const connection=await connectMcpStdio({command:config.command!,workdir:config.workdir??workspace.root,timeoutSeconds:config.timeoutSeconds,env},assertCurrent,signal,authority);return{...connection,assertCurrent};
 }
 if((config.credentialUrl??config.url)!==config.url)throw Error('Approve credentials for this endpoint before connecting');
 const vault=config.auth==='oauth'?new McpOAuthVault(config,assertCurrent):undefined;
 const auth=vault?await vault.authProvider():undefined;
 let bearer='';
 if(!auth&&config.auth!=='none'){if(!config.bearerTokenKeychain)throw Error('MCP bearer keychain reference is missing');bearer=(await getKeychainEntry(config.bearerTokenKeychain)).secret;}
 assertCurrent();signal.throwIfAborted();
 try{
  const connection=await connectMcpHttp({...config,bearer},fetch,auth,signal,authority);let closing:Promise<void>|undefined;
  return{...connection,assertCurrent,close:()=>closing??=(async()=>{const clientResults=await Promise.allSettled([connection.client.close()]);const authResults=await Promise.allSettled([auth?.settled()]);const errors=[...clientResults,...authResults].filter((r):r is PromiseRejectedResult=>r.status==='rejected');if(errors.length)throw new AggregateError(errors.map(r=>r.reason),'MCP HTTP cleanup uncertain');})()};
 }catch(error){try{await auth?.settled();}catch(cleanup){throw new AggregateError([error,cleanup],'MCP HTTP startup cleanup uncertain');}throw error;}
}
