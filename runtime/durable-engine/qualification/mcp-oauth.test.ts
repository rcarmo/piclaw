import {afterEach,beforeAll,afterAll,expect,test} from 'bun:test';
import {initDatabase,getDb,closeDatabase} from '../../src/db.js';
import {setKeyMaterialProviderForTests} from '../../src/secure/keychain.js';
import {McpOAuthVault} from '../src/mcp/oauth.ts';
import {connectMcpHttp} from '../src/mcp/client.ts';
import type {McpConnection} from '../src/mcp/connections.ts';
const cleanup:(()=>Promise<void>)[]=[];
beforeAll(()=>{initDatabase();setKeyMaterialProviderForTests({getKeyMaterial:()=>new TextEncoder().encode('SYNTHETIC_OWNED_TEST_KEY')});});
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
afterAll(()=>{setKeyMaterialProviderForTests(null);closeDatabase();});
async function fixture(){
 let issuer='',challenge='',exchanges=0,refreshes=0,owner=true,refreshGate=Promise.resolve();
 const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){const url=new URL(req.url);
  if(url.pathname.startsWith('/.well-known/oauth-protected-resource'))return Response.json({resource:issuer+'/mcp',authorization_servers:[issuer]});
  if(url.pathname.startsWith('/.well-known/'))return Response.json({issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',registration_endpoint:issuer+'/register',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256']});
  if(url.pathname==='/register')return Response.json({...await req.json(),client_id:'fixture-client'});
  if(url.pathname==='/token'){const body=new URLSearchParams(await req.text());if(body.get('grant_type')==='authorization_code'){expect(body.get('code')).toBe('fixture-code');expect(new Bun.CryptoHasher('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(challenge);exchanges++;return Response.json({access_token:'SYNTHETIC_ACCESS',token_type:'Bearer',refresh_token:'SYNTHETIC_REFRESH',expires_in:3600});}expect(body.get('refresh_token')).toBe('SYNTHETIC_REFRESH');refreshes++;await refreshGate;return Response.json({access_token:'SYNTHETIC_ROTATED',token_type:'Bearer',refresh_token:'SYNTHETIC_REFRESH_ROTATED',expires_in:3600});}
  if(url.pathname==='/mcp'){if(!['Bearer SYNTHETIC_ACCESS','Bearer SYNTHETIC_ROTATED'].includes(req.headers.get('authorization')??''))return new Response(null,{status:401,headers:{'www-authenticate':`Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource"`}});if(req.method==='GET')return new Response(null,{status:405});if(req.method==='DELETE')return new Response(null,{status:200});const rpc=await req.json() as {id?:number;method:string};if(rpc.id===undefined)return new Response(null,{status:202});return Response.json({jsonrpc:'2.0',id:rpc.id,result:rpc.method==='initialize'?{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'oauth',version:'1'}}:{tools:[]}});}
  return new Response(null,{status:404});
 }});issuer=server.url.origin;cleanup.push(async()=>{server.stop(true);});
 const config:McpConnection={id:crypto.randomUUID(),name:'oauth',workspaceId:'workspace',enabled:true,transport:'http',url:issuer+'/mcp',credentialUrl:issuer+'/mcp',auth:'oauth',allowHttp:true,timeoutSeconds:2,revision:1,accessEpoch:crypto.randomUUID()};
 const guard=()=>{if(!owner)throw Error('owner revoked');};
 return{config,guard,vault:new McpOAuthVault(config,guard),redirect:'http://localhost:3120/agent/settings/mcp/oauth/fixture/callback',setChallenge:(s:string)=>{challenge=s;},get exchanges(){return exchanges;},get refreshes(){return refreshes;},holdRefresh(gate:Promise<void>){refreshGate=gate;},revoke(){owner=false;}};
}
test('OAuth uses real SDK discovery/PKCE, encrypted state, browser binding, one-use callbacks and shared refresh exclusion',async()=>{
 const f=await fixture(),start=await f.vault.begin(f.redirect,'browser');expect(start.kind).toBe('redirect');if(start.kind!=='redirect')throw Error('Expected browser redirect');const authUrl=new URL(start.authorizationUrl);expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');f.setChallenge(authUrl.searchParams.get('code_challenge')!);
 await expect(f.vault.complete({code:'fixture-code',state:start.state},'other-browser',f.redirect)).rejects.toThrow();await expect(f.vault.complete({code:'fixture-code',state:'wrong'},'browser',f.redirect)).rejects.toThrow();
 await f.vault.complete({code:'fixture-code',state:start.state},'browser',f.redirect);expect(f.exchanges).toBe(1);await expect(f.vault.complete({code:'fixture-code',state:start.state},'browser',f.redirect)).rejects.toThrow();expect(f.exchanges).toBe(1);
 const reopen=new McpOAuthVault(f.config,f.guard),auth=await reopen.authProvider();expect(await auth.token()).toBe('SYNTHETIC_ACCESS');const c=await connectMcpHttp({...f.config,bearer:''},fetch,auth);await c.client.close();await auth.settled();
 const rows=getDb().query('SELECT ciphertext,nonce,salt FROM keychain_entries').all();expect(JSON.stringify(rows)).not.toContain('SYNTHETIC_ACCESS');expect(JSON.stringify(rows)).not.toContain('SYNTHETIC_REFRESH');
 const state=(await reopen.load())!;state.tokensExpireAt=1;await reopen.save(state);const a=await reopen.authProvider(),b=await new McpOAuthVault(f.config,f.guard).authProvider();expect(await Promise.all([a.token(),b.token()])).toEqual(['SYNTHETIC_ROTATED','SYNTHETIC_ROTATED']);expect(f.refreshes).toBe(1);await a.settled();await b.settled();
});
test('endpoint/workspace binding and owner revocation prevent token reuse',async()=>{
 const f=await fixture();await f.vault.save({serverUrl:f.config.url,tokens:{access_token:'SYNTHETIC_ACCESS',token_type:'Bearer'}});
 expect(await new McpOAuthVault({...f.config,url:'https://other.invalid/mcp'},f.guard).load()).toBeUndefined();expect(await new McpOAuthVault({...f.config,workspaceId:'other'},f.guard).load()).toBeUndefined();f.revoke();await expect(f.vault.load()).rejects.toThrow('owner');
});
test('sign-out joins a refresh before clearing, so rotated tokens cannot resurrect',async()=>{
 const f=await fixture(),gate=Promise.withResolvers<void>();f.holdRefresh(gate.promise);await f.vault.save({serverUrl:f.config.url,clientInformation:{client_id:'fixture-client'},tokensExpireAt:1,tokens:{access_token:'expired',token_type:'Bearer',refresh_token:'SYNTHETIC_REFRESH'}});
 const auth=await f.vault.authProvider(),request=auth.token();const deadline=Date.now()+1500;while(!f.refreshes&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));expect(f.refreshes).toBe(1);const clear=f.vault.clear();gate.resolve();await Promise.all([request,clear]);await auth.settled();expect((await f.vault.load())?.tokens).toBeUndefined();
});
