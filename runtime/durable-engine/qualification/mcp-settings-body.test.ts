import {expect,test} from 'bun:test';
import {createHash} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {createMcpSettingsHandler,readSettingsBody} from '../src/mcp/settings.ts';
import {closeDatabase,getDb,initDatabase} from '../../src/db/connection.js';
import {storeChatMetadata} from '../../src/db.js';
import {ensureChatBranch} from '../../src/db/chat-branches.js';
import {admitAddonLocalRequest} from '../../src/addons/local-context.js';
import type {AuthenticatedPrincipal} from '../../src/core/access-types.js';
const request=(body:BodyInit|null,signal?:AbortSignal)=>new Request('https://fixture/agent/settings/mcp',{method:'POST',body,signal});
test('MCP settings require an object with strictly decoded UTF-8',async()=>{
 expect(await readSettingsBody(request(JSON.stringify({action:'save'})))).toEqual({action:'save'});
 for(const body of [null,'null','[]','"scalar"','{not json}',new Uint8Array([0x7b,0x22,0x61,0x22,0x3a,0x22,0xff,0x22,0x7d])])await expect(readSettingsBody(request(body))).rejects.toMatchObject({status:400});
});
test('MCP body bound counts bytes across chunks and cancels overflow',async()=>{
 let cancelled=false;const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(40000));controller.enqueue(new Uint8Array(30000));},cancel(){cancelled=true;}});
 await expect(readSettingsBody(request(body))).rejects.toMatchObject({status:413});expect(cancelled).toBe(true);
});
test('MCP body abort interrupts a stalled read and never waits on an uncooperative stream cancellation',async()=>{
 const abort=new AbortController();let cancelled=false;const body=new ReadableStream<Uint8Array>({cancel(){cancelled=true;return new Promise(()=>{});}});
 const pending=readSettingsBody(request(body,abort.signal));abort.abort();await expect(pending).rejects.toMatchObject({status:400});expect(cancelled).toBe(true);
});
test('MCP settings retain the existing five-second stalled-body deadline',async()=>{
 let cancelled=false;const body=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});const start=performance.now();
 await expect(readSettingsBody(request(body))).rejects.toMatchObject({status:408});expect(performance.now()-start).toBeGreaterThanOrEqual(4900);expect(cancelled).toBe(true);
},10000);

test('guarded MCP Settings lists stable branch IDs and only changes labels on rename or alias reuse',async()=>{
 const previous=process.env.PICLAW_DB_IN_MEMORY;process.env.PICLAW_DB_IN_MEMORY='1';await closeDatabase();initDatabase();
 try{
  const database=getDb();storeChatMetadata('web:private-agent',new Date().toISOString());const first=ensureChatBranch({chat_jid:'web:private-agent',agent_name:'private-agent'});
  const workspaceId=createHash('sha256').update(realpathSync(process.env.PICLAW_WORKSPACE!)).digest('hex');
  // Read-only service catalogue fixture; request admission and SQLite are real.
  const {McpConnectionStore}=await import('../src/mcp/connections.ts');
  const store=new McpConnectionStore(database,()=>{}),service:any={workspaceId,connections:store,mcp:{status:()=>undefined}};
  const handler=createMcpSettingsHandler(service,database,()=>{}),principal:AuthenticatedPrincipal={kind:'local',userId:'default',username:'local',displayName:'Fixture',role:'admin',mode:'single-user',homeChatJid:'web:private-agent',authentication:{method:'none',sessionId:null,expiresAt:null}};
  const snapshot=async()=>{const req=new Request('http://fixture/agent/settings/mcp');admitAddonLocalRequest(req,principal,()=>true);const response=await handler(req,'/agent/settings/mcp');expect(response.status).toBe(200);return await response.json() as {agents:Array<{id:string;label:string}>};};
  expect((await snapshot()).agents).toEqual([{id:first.branch_id,label:'private-agent'}]);
  database.query('UPDATE chat_branches SET agent_name=? WHERE branch_id=?').run('renamed',first.branch_id);
  storeChatMetadata('web:other-agent',new Date().toISOString());const second=ensureChatBranch({chat_jid:'web:other-agent',agent_name:'private-agent'});
  expect(second.branch_id).not.toBe(first.branch_id);expect((await snapshot()).agents).toEqual([{id:second.branch_id,label:'private-agent'},{id:first.branch_id,label:'renamed'}]);
  database.query('UPDATE chat_branches SET archived_at=? WHERE branch_id=?').run(new Date().toISOString(),first.branch_id);
  expect((await snapshot()).agents).toEqual([{id:second.branch_id,label:'private-agent'}]);
  const post=async(body:unknown,auth=true)=>{const req=request(JSON.stringify(body));if(auth)admitAddonLocalRequest(req,principal,()=>true);return handler(req,'/agent/settings/mcp');};
  expect((await post({},false)).status).toBe(403);expect((await post({action:'save'})).status).toBe(400);
  const seed={id:'stdio',name:'stdio',workspaceId,agentIds:[],enabled:true,transport:'stdio' as const,url:'',auth:'none' as const,allowHttp:false,timeoutSeconds:2,command:['fixture'],workdir:'/workspace/fixture',env:{MCP_TOKEN:'keychain:fixture/reference'}};
  const old=await store.save(seed);
  const stale=await post({action:'save',connection:{id:'stdio'},expectedRevision:old.revision-1,clear:['environment']});expect(stale.status).toBe(409);expect(await stale.json()).toMatchObject({code:'revision_conflict'});
  expect(store.credential('stdio')?.env).toEqual(seed.env);
  const bad=await post({action:'save',connection:{id:'stdio',command:'secret_fixture'},expectedRevision:old.revision});expect(bad.status).toBe(400);expect(await bad.text()).not.toContain('secret_fixture');
  expect((await post({action:'save',connection:{id:'stdio'},expectedRevision:old.revision,clear:['workdir']})).status).toBe(200);
  expect(store.credential('stdio')).toMatchObject({enabled:false,env:seed.env});expect(store.credential('stdio')?.workdir).toBeUndefined();
  expect((await post({action:'save',connection:{id:'stdio'},expectedRevision:old.revision+1,clear:['environment']})).status).toBe(200);expect(store.credential('stdio')?.env).toBeUndefined();
  const oauth=await store.save({...seed,id:'oauth',name:'oauth',transport:'http',url:'https://fixture.invalid/old',auth:'oauth',oauth:{scope:'old-scope',clientSecretKeychain:'fixture/saved'}});
  expect((await post({action:'save',connection:{id:'oauth',url:'https://fixture.invalid/new'},expectedRevision:oauth.revision,clear:['oauthScope']})).status).toBe(200);
  expect(store.credential('oauth')).toMatchObject({credentialUrl:oauth.url,enabled:false,oauth:{clientSecretKeychain:'fixture/saved'}});expect(store.credential('oauth')?.oauth?.scope).toBeUndefined();
  expect((await post({action:'sign_out',id:'oauth',expectedRevision:oauth.revision})).status).toBe(409);
 }finally{await closeDatabase();if(previous===undefined)delete process.env.PICLAW_DB_IN_MEMORY;else process.env.PICLAW_DB_IN_MEMORY=previous;}
});
