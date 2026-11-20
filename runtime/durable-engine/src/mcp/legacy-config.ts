// Read-only, one-shot migration parser. No adapter client, session, command, secret resolution or fallback.
import {readFileSync} from 'node:fs';
import stripJsonComments from 'strip-json-comments';
import {getConfigDiscoveryPaths,loadMcpConfig} from 'pi-mcp-adapter/config';
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function references(row:Record<string,unknown>){
 const refs=new Set<string>();if(typeof row.bearerTokenKeychain==='string')refs.add(row.bearerTokenKeychain);
 if(object(row.env))for(const value of Object.values(row.env))if(typeof value==='string'&&value.startsWith('keychain:'))refs.add(value.slice(9));
 return refs;
}
const destination=(row:Record<string,unknown>)=>typeof row.url==='string'?JSON.stringify(['http',row.url]):typeof row.command==='string'?JSON.stringify(['stdio',row.command,row.args??[],row.cwd??null]):null;
/** The old loader merges fields. That merge must not approve carrying a credential
 * reference to a different endpoint/program, including an explicit repeated ref.
 * Unknown imported/package provenance remains visible but disabled for review. */
export function fenceLegacyMcpCredentials(effective:Record<string,unknown>,layers:readonly Record<string,unknown>[]){
 const states=new Map<string,Record<string,unknown>>(),bindings=new Map<string,Map<string,Set<string|null>>>(),invalid=new Set<string>();
 for(const layer of layers)for(const[name,raw]of Object.entries(layer)){
  if(!object(raw)){invalid.add(name);continue;}
  const previous=states.get(name)??{},next={...previous,...raw};
  // Match the loader's transport replacement, but never borrow its credentials.
  if(typeof raw.url==='string')for(const key of ['command','args','env','cwd','socket'])delete next[key];
  if(typeof raw.command==='string')for(const key of ['url','socket'])delete next[key];
  states.set(name,next);const known=bindings.get(name)??new Map<string,Set<string|null>>();bindings.set(name,known);
  for(const reference of references(next)){const destinations=known.get(reference)??new Set<string|null>();destinations.add(destination(next));known.set(reference,destinations);}
 }
 return Object.fromEntries(Object.entries(effective).map(([name,raw])=>{
  if(!object(raw))return[name,raw];const target=destination(raw),known=bindings.get(name);
  const unsafe=invalid.has(name)||[...references(raw)].some(reference=>{const anchors=known?.get(reference);return target===null||anchors?.size!==1||!anchors.has(target);});
  return[name,unsafe?{...structuredClone(raw),legacyCredentialApprovalRequired:true}:structuredClone(raw)];
 }));
}
export function readLegacyMcpServers(workspaceRoot:string):Record<string,unknown>{
 const layers:Record<string,unknown>[]=[];
 for(const source of getConfigDiscoveryPaths(undefined,workspaceRoot))if(source.exists){
  try{
   const bytes=readFileSync(source.path);if(bytes.byteLength>1024*1024)throw Error('Legacy config exceeds 1 MiB');
   const value:unknown=JSON.parse(stripJsonComments(new TextDecoder('utf-8',{fatal:true}).decode(bytes),{trailingCommas:true}));
   if(!object(value))throw Error('Object required');const servers=value.mcpServers??value['mcp-servers']??{};if(!object(servers))throw Error('Server map required');layers.push(servers);
  }catch{throw Error('Legacy MCP configuration could not be read safely; original sources are unchanged');}
 }
 const config=loadMcpConfig(undefined,workspaceRoot);
 return fenceLegacyMcpCredentials(config.mcpServers as Record<string,unknown>,layers);
}
