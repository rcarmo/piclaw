import {expect,test} from 'bun:test';
import {parseMcpServerEdit,projectMcpServerEdit,patchMcpProjectOverride,assertMcpServerCredentialBinding} from '../../src/secure/mcp-server-edits.js';
test('server edit parser accepts bounded transport/reference/exposure/timeout fields and owns its snapshot',()=>{
 const draft={name:'demo.tools',action:'update',patch:{command:'bun',args:['server.ts'],env:{API_KEY:'${SYNTHETIC_API_KEY}',DISPLAY:'plain'},headers:{Authorization:'Bearer ${SYNTHETIC_API_KEY}'},auth:'bearer',bearerTokenKeychain:'synthetic/api-key',bearerTokenEnv:'SYNTHETIC_API_KEY',requestTimeoutMs:12000,idleTimeout:5,directTools:['read_*'],includeTools:['read_*'],excludeTools:['delete_*'],approveTools:true,toolPrefix:'server',disabled:false,exposeResources:true}};
 const parsed=parseMcpServerEdit(draft);expect(parsed).toEqual(draft);draft.patch.args.push('late');draft.patch.env.API_KEY='literal-secret';expect((parsed as any).patch.args).toEqual(['server.ts']);expect((parsed as any).patch.env.API_KEY).toBe('${SYNTHETIC_API_KEY}');
});
test('explicit null means remove a local field, not a guessed effective credential tombstone',()=>{
 expect(parseMcpServerEdit({name:'demo',action:'update',patch:{bearerTokenKeychain:null,url:null,disabled:true}})).toEqual({name:'demo',action:'update',patch:{bearerTokenKeychain:null,url:null,disabled:true}});expect(parseMcpServerEdit({name:'demo',action:'remove_override'})).toEqual({name:'demo',action:'remove_override'});
});
for(const patch of [{bearerToken:'LITERAL_SENTINEL'},{oauth:{clientSecret:'LITERAL_SENTINEL'}},{headers:{Authorization:'LITERAL_SENTINEL'}},{env:{API_KEY:'LITERAL_SENTINEL'}},{env:{KEY:'!never-run'}},{headers:{Cookie:'literal-cookie'}},{url:'https://user:LITERAL_SENTINEL@host.test/mcp'},{url:'https://host.test/mcp?api_key=LITERAL_SENTINEL'},{url:'file:///secret'},{requestTimeoutMs:Infinity},{idleTimeout:-1},{directTools:[7]},{command:'bun\nexfiltrate'},{headers:JSON.parse('{"__proto__":"attack"}')}])test(`unsafe edit rejects fixed field errors without reflecting values: ${Object.keys(patch)[0]}`,()=>{
 let error:unknown;try{parseMcpServerEdit({name:'demo',action:'update',patch});}catch(cause){error=cause;}expect(error).toBeInstanceOf(Error);expect(String(error)).not.toContain('LITERAL_SENTINEL');expect(String(error)).not.toContain('exfiltrate');expect(String(error)).not.toContain('/secret');
});
for(const value of [{name:'__proto__',action:'update',patch:{disabled:true}},{name:'demo',action:'update',patch:{}},{name:'demo',action:'remove_override',patch:{disabled:true}},{name:'demo',action:'update',patch:{disabled:'true'}},{name:'demo',action:'update',patch:{env:Array(2)}},{name:'demo',action:'update',patch:{args:Array(129).fill('x')}},{name:'demo',action:'update',patch:{auth:'anything'}},{name:'demo',action:'update',patch:{lifecycle:'anything'}},{name:'demo',action:'update',patch:{httpTransport:'anything'}},{name:'demo',action:'update',patch:{bearerTokenEnv:'bad-name'}}])test('malformed edit envelopes and nested bounds fail closed',()=>{
 expect(()=>parseMcpServerEdit(value)).toThrow('Invalid MCP server edit field');
});
test('safe editable projection withholds literal args/maps/auth and hostile advanced fields without mutating the source',()=>{
 const raw={url:'https://safe.test/mcp',args:['--token','PRIVATE_LITERAL'],env:{INNOCENT:'PRIVATE_LITERAL'},headers:{'X-Custom':'PRIVATE_LITERAL'},bearerToken:'PRIVATE_LITERAL',oauth:{clientSecret:'PRIVATE_LITERAL'},['PRIVATE_LITERAL']:true,disabled:false,directTools:['read_*'],requestTimeoutMs:12000};const before=JSON.stringify(raw),projection=projectMcpServerEdit('demo',raw);
 expect(projection.patch).toEqual({url:'https://safe.test/mcp',disabled:false,directTools:['read_*'],requestTimeoutMs:12000});expect(projection.withheldFields).toEqual(['advanced','args','env','headers']);expect(JSON.stringify(projection)).not.toContain('PRIVATE_LITERAL');expect(JSON.stringify(raw)).toBe(before);
});
test('safe projection retains references and rejects literal URL credentials with fixed labels',()=>{
 const projection=projectMcpServerEdit('demo',{url:'https://user:PRIVATE_LITERAL@host.test/mcp',env:{TOKEN:'${SYNTHETIC_TOKEN}'},headers:{Authorization:'Bearer ${SYNTHETIC_TOKEN}'},bearerTokenKeychain:'synthetic/key',bearerTokenEnv:'SYNTHETIC_TOKEN'});
 expect(projection.patch).toEqual({env:{TOKEN:'${SYNTHETIC_TOKEN}'},headers:{Authorization:'Bearer ${SYNTHETIC_TOKEN}'},bearerTokenKeychain:'synthetic/key',bearerTokenEnv:'SYNTHETIC_TOKEN'});expect(projection.withheldFields).toEqual(['url']);expect(JSON.stringify(projection)).not.toContain('PRIVATE_LITERAL');
});
test('one local-field patch preserves unrelated raw/private/advanced settings and server definitions',()=>{
 const raw={imports:['vscode'],settings:{futurePolicy:{secret:'PRIVATE_LITERAL'}},metadata:{keep:true},mcpServers:{demo:{command:'never-run',args:['PRIVATE_LITERAL'],advanced:{keep:true},bearerToken:'PRIVATE_LITERAL',disabled:false},other:{futureSemantic:'PRIVATE_LITERAL'}}};const before=JSON.stringify(raw);
 const next=patchMcpProjectOverride(raw,{name:'demo',action:'update',patch:{disabled:true,requestTimeoutMs:5000}}) as any;
 expect(next).toEqual({...raw,mcpServers:{...raw.mcpServers,demo:{...raw.mcpServers.demo,disabled:true,requestTimeoutMs:5000}}});expect(JSON.stringify(raw)).toBe(before);next.mcpServers.demo.advanced.keep=false;expect(raw.mcpServers.demo.advanced.keep).toBe(true);
});
test('remove local override preserves other aliases/imports and null deletion remains local only',()=>{
 const raw={'mcp-servers':{demo:{command:'never-run',bearerTokenKeychain:'synthetic/key'},other:{disabled:true}},imports:['vscode']};
 expect(patchMcpProjectOverride(raw,{name:'demo',action:'remove_override'})).toEqual({'mcp-servers':{other:{disabled:true}},imports:['vscode']});expect(patchMcpProjectOverride(raw,{name:'demo',action:'update',patch:{bearerTokenKeychain:null}})).toEqual({'mcp-servers':{demo:{command:'never-run'},other:{disabled:true}},imports:['vscode']});expect(raw['mcp-servers'].demo.bearerTokenKeychain).toBe('synthetic/key');
});
test('exact effective endpoint or transport changes cannot silently inherit credentials',()=>{
 const original={url:'https://original.test/mcp',bearerTokenKeychain:'synthetic/key',bearerTokenEnv:'SYNTHETIC'};expect(()=>assertMcpServerCredentialBinding(original,{...original,url:'https://replacement.test/mcp'})).toThrow('inherited_credentials');expect(()=>assertMcpServerCredentialBinding(original,{command:'never-run',bearerTokenKeychain:'synthetic/key'})).toThrow('inherited_credentials');expect(()=>assertMcpServerCredentialBinding(original,{...original,disabled:true})).not.toThrow();expect(()=>assertMcpServerCredentialBinding(original,{url:'https://replacement.test/mcp',auth:false})).not.toThrow();
});
test('repointing cannot hide a retained credential inside a modified header object',()=>{
 expect(()=>assertMcpServerCredentialBinding({url:'https://old.test',headers:{Authorization:'Bearer ${TOKEN}',Accept:'old'}},{url:'https://new.test',headers:{Authorization:'Bearer ${TOKEN}',Accept:'new'}})).toThrow('inherited_credentials');
});
for(const patch of [{command:'new-program'},{args:['new-script.ts','${TOKEN}']},{cwd:'/new/program-root'}])test('stdio program changes retain neither environment nor argument credential authority',()=>{
 const original={command:'bun',args:['old-script.ts','${TOKEN}'],cwd:'/original',env:{API_KEY:'${TOKEN}'}};
 expect(()=>assertMcpServerCredentialBinding(original,{...original,...patch})).toThrow('inherited_credentials');
});
test('unchanged stdio identity permits non-destination policy edits but credential clears must be effective',()=>{
 const original={command:'bun',args:['server.ts'],cwd:'/original',env:{API_KEY:'${TOKEN}'}};expect(()=>assertMcpServerCredentialBinding(original,{...original,requestTimeoutMs:4500})).not.toThrow();expect(()=>assertMcpServerCredentialBinding(original,{command:'new-program'})).not.toThrow();
});
test('literal credential arguments cannot follow a different executable or script',()=>{
 const original={command:'bun',args:['old.ts','--credential','PRIVATE_LITERAL']};expect(()=>assertMcpServerCredentialBinding(original,{command:'bun',args:['new.ts','--credential','PRIVATE_LITERAL']})).toThrow('inherited_credentials');
});
for (const [original,projected] of [
 [{command:'old',args:['${SYNTHETIC_TOKEN}']},{command:'new',args:['--key=${SYNTHETIC_TOKEN}']}],
 [{command:'old',env:{API_KEY:'${SYNTHETIC_TOKEN}'}},{command:'new',env:{AUTH_TOKEN:'${SYNTHETIC_TOKEN}'}}],
 [{command:'old',env:{API_KEY:'${SYNTHETIC_TOKEN}'}},{command:'new',args:['--key={env:SYNTHETIC_TOKEN}']}],
 [{url:'https://old.test',headers:{Authorization:'Bearer ${SYNTHETIC_TOKEN}'}},{url:'https://new.test',headers:{'X-Token':'$env:SYNTHETIC_TOKEN'}}],
])test('credential reference identity cannot be renamed, reformatted or moved on a destination change',()=>{
 expect(()=>assertMcpServerCredentialBinding(original,projected)).toThrow('inherited_credentials');
});
for(const [original,projected] of [
 [{command:'old',args:['PRIVATE_TEST_SENTINEL']},{command:'new',args:['--key=PRIVATE_TEST_SENTINEL']}],
 [{command:'old',env:{LABEL:'PRIVATE_TEST_SENTINEL'}},{command:'new',env:{OTHER:'PRIVATE_TEST_SENTINEL'}}],
 [{command:'old',env:{LABEL:'PRIVATE_TEST_SENTINEL'}},{command:'new',args:['--key=PRIVATE_TEST_SENTINEL']}],
])test('opaque credential payload must be cleared before a destination change regardless of formatting',()=>{
 expect(()=>assertMcpServerCredentialBinding(original,projected)).toThrow('inherited_credentials');
});
for(const original of [{command:'old',args:['${TOKEN}']},{command:'old',env:{LABEL:'${TOKEN}'}},{url:'https://old.test/mcp?value=${TOKEN}'}])test('retained credential reference cannot move into an innocuously named URL query',()=>{
 expect(()=>assertMcpServerCredentialBinding(original,{url:'https://replacement.test/mcp?value=${TOKEN}'})).toThrow('inherited_credentials');
});

test('create drafts cannot overwrite a local disabled server, and update still permits intentional edits',()=>{
 const draft={name:'parallel-search',action:'create',patch:{url:'https://search.parallel.ai/mcp',auth:false}};
 expect(parseMcpServerEdit(draft)).toEqual(draft);
 const document={mcpServers:{'parallel-search':{url:'https://explicit.test/mcp',disabled:true}}};
 expect(()=>patchMcpProjectOverride(document,draft)).toThrow('name');
 expect(patchMcpProjectOverride({},draft)).toEqual({mcpServers:{'parallel-search':draft.patch}});
 expect(patchMcpProjectOverride(document,{...draft,action:'update'})).toMatchObject({mcpServers:{'parallel-search':{url:draft.patch.url,disabled:true}}});
});
