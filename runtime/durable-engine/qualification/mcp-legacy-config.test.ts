import {expect,test} from 'bun:test';
import {fenceLegacyMcpCredentials} from '../src/mcp/legacy-config.ts';
import {planLegacyMcpMigration} from '../src/mcp/migration.ts';
const workspace={id:'fixture',root:'/workspace'},original={url:'https://original.invalid/mcp',bearerTokenKeychain:'existing/token',bearerTokenEnv:'EXISTING_TOKEN',directTools:false};
function plan(effective:Record<string,unknown>,layers:Record<string,unknown>[]){return planLegacyMcpMigration(fenceLegacyMcpCredentials(effective,layers),workspace);}
test('current single-source Memento references and same-endpoint partial overrides remain eligible',()=>{
 for(const layer of [{},{disabled:true}]){const result=plan({memento:{...original,...layer}},[{memento:original},{memento:layer}]);expect(result.connections[0]?.enabled).toBe(layer.disabled!==true);expect(result.diagnostics).toEqual([]);}
});
test('a merged URL never grants inherited or explicitly repeated credentials to its new destination',()=>{
 for(const higher of [{url:'https://other.invalid/mcp'},{url:'https://other.invalid/mcp',bearerTokenKeychain:'existing/token',bearerTokenEnv:'EXISTING_TOKEN'}]){
  const result=plan({memento:{...original,...higher}},[{memento:original},{memento:higher}]);expect(result.connections[0]?.enabled).toBe(false);expect(result.diagnostics[0]?.fields).toContain('legacyCredentialApprovalRequired');expect(result.connections[0]?.bearerTokenKeychain).toBe('existing/token');
 }
});
test('unproved imported/package references and malformed shadow definitions require review, never a fallback',()=>{
 for(const layers of [[],[{memento:null}]]){const result=plan({memento:original},layers);expect(result.connections[0]?.enabled).toBe(false);expect(result.diagnostics).toHaveLength(1);}
});
test('changed stdio programs, arguments and work directories cannot inherit old keychain env refs',()=>{
 const before={command:'safe',args:['server'],cwd:'/workspace/owned',env:{API_KEY:'keychain:existing/token'}};
 for(const change of [{command:'different'},{args:['changed']},{cwd:'/workspace/other'}]){const result=plan({stdio:{...before,...change}},[{stdio:before},{stdio:change}]);expect(result.connections[0]?.enabled).toBe(false);expect(result.connections[0]?.env).toEqual(before.env);}
});
test('a new explicit credential bound to a new endpoint is distinct from inherited reuse',()=>{
 const after={...original,url:'https://other.invalid/mcp',bearerTokenKeychain:'new/token'};
 const result=plan({memento:after},[{memento:original},{memento:after}]);expect(result.connections[0]?.enabled).toBe(true);expect(result.diagnostics).toEqual([]);
});
test('unproved migration credentials stay pinned until an explicit reuse approval',async()=>{
 const{Database}=await import('bun:sqlite'),{McpConnectionStore}=await import('../src/mcp/connections.ts');
 const examples=[{server:original,higher:{url:'https://other.invalid/mcp'}},{server:{command:'original',env:{API_KEY:'keychain:existing/token'}},higher:{command:'changed'}}];
 for(const example of examples){const database=new Database(':memory:');try{
  const result=plan({fixture:{...example.server,...example.higher}},[{fixture:example.server},{fixture:example.higher}]),store=new McpConnectionStore(database,()=>{}),input=result.connections[0]!;const first=await store.save(input);expect(first.enabled).toBe(false);expect(store.list()[0]?.needsCredentialApproval).toBe(true);
  const toggled=await store.save({...input,enabled:true},{expectedRevision:first.revision});expect(toggled.enabled).toBe(false);
  const approved=await store.save({...input,enabled:true},{expectedRevision:toggled.revision,approveCredentialReuse:true});expect(approved.enabled).toBe(true);expect(store.list()[0]?.needsCredentialApproval).toBe(false);
 }finally{database.close();}}
});
