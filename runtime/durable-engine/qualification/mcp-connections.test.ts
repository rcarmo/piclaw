import {afterEach,expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {McpConnectionStore,type McpConnectionInput} from '../src/mcp/connections.ts';
const closes:(()=>void)[]=[];afterEach(()=>{for(const close of closes.splice(0).reverse())close();});
function fixture(){const dir=mkdtempSync(join(tmpdir(),'mcp-metadata-')),file=join(dir,'state.sqlite');let owner=true;const db=new Database(file,{create:true});db.exec('PRAGMA journal_mode=WAL;PRAGMA busy_timeout=0;PRAGMA secure_delete=ON;');const store=new McpConnectionStore(db,()=>{if(!owner)throw Error('owner revoked');});closes.push(()=>{db.close();rmSync(dir,{recursive:true,force:true});});return{db,file,store,revoke(){owner=false;}};}
const config:McpConnectionInput={id:'fixture',name:'fixture',workspaceId:'workspace',enabled:true,transport:'http',url:'https://fixture.invalid/mcp',auth:'bearer',bearerTokenKeychain:'mcp/fixture/token',allowHttp:false,timeoutSeconds:30};
test('MCP metadata persistence keeps keychain references and redacts public credential fields',async()=>{const f=fixture();let notified=0;f.store.watch(async()=>{notified++;});const row=await f.store.save(config,{expectedRevision:0});expect(row.revision).toBe(1);expect(row.bearerTokenKeychain).toBe(config.bearerTokenKeychain);const reopened=new McpConnectionStore(f.db,()=>{});expect(reopened.credential(config.id)).toEqual(row);expect(f.store.list()[0]).toMatchObject({name:'fixture',hasSavedCredentials:true,needsCredentialApproval:false});expect(JSON.stringify(f.store.list())).not.toContain('mcp/fixture/token');expect(notified).toBe(1);});
test('existing scoped rows keep their credentials, enabled state and revision without a read-time rewrite',async()=>{
 const f=fixture(),saved=await f.store.save({...config,enabled:false});
 const prior={...saved,agentIds:['former_agent'],access:{kind:'workspaces',grants:[{workspaceId:'workspace',agentIds:['former_agent']}]}};
 const raw=JSON.stringify(prior);
 f.db.query('UPDATE mcp_connections_v1 SET config=? WHERE id=?').run(raw,saved.id);
 expect(f.store.credential(saved.id)).toEqual(saved);
 expect(f.store.list()[0]).toMatchObject({enabled:false,revision:saved.revision,hasSavedCredentials:true});
 for(const field of ['workspaceId','agentIds','access','accessEpoch','bearerTokenKeychain'])expect(f.store.list()[0]).not.toHaveProperty(field);
 expect(f.db.query('SELECT config FROM mcp_connections_v1 WHERE id=?').get(saved.id)).toEqual({config:raw});
 const {revision,accessEpoch,...input}=saved;
 const updated=await f.store.save({...input,timeoutSeconds:15},{expectedRevision:revision});
 expect(updated).toMatchObject({enabled:false,accessEpoch,bearerTokenKeychain:config.bearerTokenKeychain,timeoutSeconds:15});
 expect(f.db.query('SELECT config FROM mcp_connections_v1 WHERE id=?').get(saved.id)).toEqual({config:JSON.stringify(updated)});
});
test('raw bearer values and unknown fields cannot enter metadata',async()=>{const f=fixture();await expect(f.store.save({...config,bearer:'DO_NOT_STORE'} as never)).rejects.toThrow();expect(f.store.list()).toEqual([]);expect(JSON.stringify(f.db.query('SELECT * FROM mcp_connections_v1').all())).not.toContain('DO_NOT_STORE');});
test('endpoint changes never silently send saved credentials to a new endpoint',async()=>{const f=fixture(),first=await f.store.save(config);const changed=await f.store.save({...config,url:'https://other.invalid/mcp'},{expectedRevision:first.revision});expect(changed.enabled).toBe(false);expect(changed.credentialUrl).toBe(config.url);expect(f.store.list()[0]?.needsCredentialApproval).toBe(true);expect(changed.accessEpoch).not.toBe(first.accessEpoch);const approved=await f.store.save({...config,url:changed.url},{expectedRevision:changed.revision,approveCredentialReuse:true});expect(approved.enabled).toBe(true);expect(approved.credentialUrl).toBe(changed.url);expect(approved.accessEpoch).not.toBe(changed.accessEpoch);});
test('a newly selected credential reference binds explicitly to the new endpoint',async()=>{const f=fixture();await f.store.save(config);const row=await f.store.save({...config,url:'https://other.invalid/mcp',bearerTokenKeychain:'mcp/other/token'});expect(row.enabled).toBe(true);expect(row.credentialUrl).toBe(row.url);});
test('OAuth endpoint changes disable the connection and force a new sign-in',async()=>{const f=fixture();const first=await f.store.save({...config,auth:'oauth',bearerTokenKeychain:undefined,oauth:{clientId:'client',clientSecretKeychain:'mcp/client/secret'}});const next=await f.store.save({...config,auth:'oauth',url:'https://other.invalid/mcp',oauth:{clientId:'client',clientSecretKeychain:'mcp/client/secret'}},{approveCredentialReuse:true});expect(next.enabled).toBe(false);expect(next.bearerTokenKeychain).toBeUndefined();expect(next.accessEpoch).not.toBe(first.accessEpoch);expect(JSON.stringify(f.store.list())).not.toContain('mcp/client/secret');});
test('stale configuration writes and removals cannot overwrite another owner decision',async()=>{const f=fixture(),first=await f.store.save(config,{expectedRevision:0});await f.store.save({...config,enabled:false},{expectedRevision:first.revision});await expect(f.store.save(config,{expectedRevision:first.revision})).rejects.toThrow('changed');await expect(f.store.remove(config.id,{expectedRevision:first.revision})).rejects.toThrow('changed');expect(f.store.credential(config.id)?.enabled).toBe(false);});
test('destination changes revoke recall access while retention-only edits keep its epoch',async()=>{const f=fixture(),first=await f.store.save(config);const retained=await f.store.save({...config,recall:{...first.recall!,maxItems:10}});expect(retained.accessEpoch).toBe(first.accessEpoch);const limited=await f.store.save({...config,url:'https://fixture.invalid/new'});expect(limited.accessEpoch).not.toBe(first.accessEpoch);});
test('stdio settings retain the execution anchor and require keychain references for sensitive environment',async()=>{const f=fixture(),stdio={...config,transport:'stdio' as const,url:'',command:['bun','server.ts'],workdir:'/workspace'};const saved=await f.store.save({...stdio,env:{API_KEY:'keychain:mcp/stdio/token',PATH:'/usr/bin'}});expect(saved.bearerTokenKeychain).toBeUndefined();expect(saved.url).toBe('');expect(f.store.list()[0]?.environmentNames).toEqual(['API_KEY','PATH']);await expect(f.store.save({...stdio,env:{API_KEY:'DO_NOT_STORE'}})).rejects.toThrow('keychain');expect(saved.workspaceId).toBe(config.workspaceId);});
test('server names must be unique for new entries across the instance',async()=>{const f=fixture();await f.store.save(config);await expect(f.store.save({...config,id:'second'})).rejects.toThrow('name');await expect(f.store.save({...config,id:'second',workspaceId:'other'})).rejects.toThrow('name');});
test('deleting connection metadata never deletes shared keychain entries or history',async()=>{const f=fixture();f.db.exec("CREATE TABLE keychain_entries(name TEXT);INSERT INTO keychain_entries VALUES('mcp/fixture/token');CREATE TABLE documents(id INTEGER);INSERT INTO documents VALUES(1);");await f.store.save(config);await f.store.remove(config.id,{expectedRevision:1});expect(f.store.list()).toEqual([]);expect(f.db.query('SELECT count(*) AS n FROM keychain_entries').get()).toEqual({n:1});expect(f.db.query('SELECT count(*) AS n FROM documents').get()).toEqual({n:1});});
test('stdio metadata rejects loader injection, malformed names and empty references before storing values',async()=>{
 const f=fixture(),stdio={...config,transport:'stdio' as const,url:'',command:['bun','server.ts'],workdir:'/workspace'};
 const environments:Record<string,string>[]=[{LD_PRELOAD:'/DO_NOT_STORE.so'},{NODE_OPTIONS:'--require DO_NOT_STORE'},{BASH_ENV:'/DO_NOT_STORE'},{'INVALID=NAME':'DO_NOT_STORE'},{API_KEY:'keychain:'}];
 for(const env of environments)await expect(f.store.save({...stdio,env})).rejects.toThrow();
 expect(f.store.list()).toEqual([]);expect(JSON.stringify(f.db.query('SELECT * FROM mcp_connections_v1').all())).not.toContain('DO_NOT_STORE');
});
test('owner revocation and aborted admission write nothing',async()=>{const f=fixture();const controller=new AbortController();controller.abort();await expect(f.store.save(config,{signal:controller.signal})).rejects.toThrow();expect(f.store.list()).toEqual([]);f.revoke();await expect(f.store.save(config)).rejects.toThrow('owner');expect(()=>f.store.list()).toThrow('owner');});

test('anonymous HTTP is explicit, clears connection credential bindings and still revokes endpoint epochs',async()=>{
 const f=fixture();await f.store.save(config);
 const first=await f.store.save({...config,auth:'none'});expect(first.bearerTokenKeychain).toBeUndefined();expect(first.oauth).toBeUndefined();expect(f.store.list()[0]?.hasSavedCredentials).toBe(false);
 const changed=await f.store.save({...config,url:'https://public.invalid/mcp',auth:'none'},{expectedRevision:first.revision});expect(changed.enabled).toBe(true);expect(changed.accessEpoch).not.toBe(first.accessEpoch);expect(f.store.list()[0]?.needsCredentialApproval).toBe(false);
});
test('stdio command, arguments and directory edits cannot silently reuse saved keychain env refs',async()=>{
 for(const change of [{command:['different','server']},{command:['bun','changed.ts']},{workdir:'/workspace/other'}]){
  const f=fixture(),input={...config,transport:'stdio' as const,url:'',command:['bun','server.ts'],workdir:'/workspace',env:{API_KEY:'keychain:stdio/token'}};const first=await f.store.save(input);
  expect(f.store.list()[0]?.hasSavedCredentials).toBe(true);expect(f.store.list()[0]?.needsCredentialApproval).toBe(false);
  const changed=await f.store.save({...input,...change},{expectedRevision:first.revision});expect(changed.enabled).toBe(false);expect(f.store.list()[0]?.needsCredentialApproval).toBe(true);
  const toggled=await f.store.save({...input,...change,enabled:true},{expectedRevision:changed.revision});expect(toggled.enabled).toBe(false);
  const approved=await f.store.save({...input,...change,enabled:true},{expectedRevision:toggled.revision,approveCredentialReuse:true});expect(approved.enabled).toBe(true);expect(f.store.list()[0]?.needsCredentialApproval).toBe(false);expect(approved.accessEpoch).not.toBe(toggled.accessEpoch);
 }
});
