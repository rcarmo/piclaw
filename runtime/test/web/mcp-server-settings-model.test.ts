import {expect,test} from 'bun:test';
import {createMcpServerSettingsController,patchFromForm,type McpServerSettingsState} from '../../web/src/ui/mcp-server-settings-model.js';
const body=(preview:any=null)=>({ok:true,revision:'opaque',servers:[{name:'demo',patch:{disabled:false},withheldFields:['args'],enabled:true,localOverride:true,source:'project'}],preview,applyAvailable:true,phase:'ready'});
test('server controller sends explicit patch preview then revision-only acknowledged Apply',async()=>{
 const requests:any[]=[],states:McpServerSettingsState[]=[];const controller=createMcpServerSettingsController(value=>states.push(value),async(url,options)=>{requests.push({url,options});return Response.json(body(String(url).endsWith('/preview')?{name:'demo',action:'update',applicable:true}:null));});
 await controller.refresh();controller.edit({name:'demo',action:'update',patch:{disabled:true}});await controller.preview();await controller.apply(false);expect(requests).toHaveLength(2);await controller.apply(true);expect(requests).toHaveLength(3);expect(JSON.parse(requests[1].options.body)).toEqual({name:'demo',action:'update',patch:{disabled:true}});expect(JSON.parse(requests[2].options.body)).toEqual({revision:'opaque',acknowledgeInterruptions:true});expect(states.at(-1)?.applied).toBe(true);controller.dispose();
});
test('selection invalidates stale preview and ambiguous Apply never claims success',async()=>{
 let finish!:(value:Response)=>void;const states:McpServerSettingsState[]=[],controller=createMcpServerSettingsController(value=>states.push(value),async()=>new Promise(resolve=>{finish=resolve;}));controller.edit({name:'demo',action:'update',patch:{disabled:true}});const pending=controller.preview();controller.edit({name:'other',action:'update',patch:{disabled:true}});finish(Response.json(body({name:'demo',action:'update',applicable:true})));await pending;expect(states.at(-1)?.previewed).toBe(false);expect(states.at(-1)?.draft.name).toBe('other');controller.dispose();
 const failed:McpServerSettingsState[]=[],ambiguous=createMcpServerSettingsController(value=>failed.push(value),async(url)=>String(url).endsWith('/apply')?new Response('PRIVATE_SENTINEL',{status:503}):Response.json(body({name:'demo',action:'update',applicable:true})));ambiguous.edit({name:'demo',action:'update',patch:{disabled:true}});await ambiguous.preview();await ambiguous.apply(true);expect(failed.at(-1)?.applied).toBe(false);expect(failed.at(-1)?.payload).toBeNull();expect(failed.at(-1)?.error).not.toContain('PRIVATE_SENTINEL');ambiguous.dispose();
});
test('form patch omits blank fields, parses bounded types, and preserves local null semantics',()=>{
 expect(patchFromForm({command:'bun',args:'["server.ts"]',disabled:'true',url:'',bearerTokenKeychain:'null'})).toEqual({command:'bun',args:['server.ts'],disabled:true,bearerTokenKeychain:null});expect(()=>patchFromForm({env:'not JSON'})).toThrow();
});
test('an ok response with blocked runtime is never an applied confirmation',async()=>{
 const states:McpServerSettingsState[]=[],controller=createMcpServerSettingsController(value=>states.push(value),async url=>Response.json(String(url).endsWith('/apply')?{...body(),phase:'blocked',applyAvailable:false}:body({name:'demo',action:'update',applicable:true})));controller.edit({name:'demo',action:'update',patch:{disabled:true}});await controller.preview();await controller.apply(true);expect(states.at(-1)?.applied).toBe(false);expect(states.at(-1)?.payload).toBeNull();controller.dispose();
});

test('Parallel preset is an explicit fresh draft and never replaces saved or disabled choices', async () => {
 const {createParallelSearchDraft}=await import('../../web/src/ui/mcp-server-settings-model.js');
 expect(createParallelSearchDraft([{name:'parallel-search'}])).toBeNull();
 const first=createParallelSearchDraft([{name:'other'}])!;
 expect(first).toMatchObject({name:'parallel-search',action:'create',patch:{url:'https://search.parallel.ai/mcp',auth:false,httpTransport:'streamable-http',directTools:false,includeTools:['web_search','web_fetch']}});
 expect(first.patch).not.toHaveProperty('bearerTokenEnv');
 (first.patch.headers as Record<string,string>)['User-Agent']='changed';
 expect(createParallelSearchDraft([])!.patch.headers).toEqual({'User-Agent':'PiClaw (+https://github.com/rcarmo/piclaw)'});
 const requests:any[]=[],controller=createMcpServerSettingsController(()=>{},async(url,options)=>{requests.push({url,options});return Response.json(body({name:'parallel-search',action:'create',applicable:true}));});
 controller.edit(createParallelSearchDraft([])!);controller.edit({...createParallelSearchDraft([])!,action:'update'});expect(requests).toHaveLength(0);
 await controller.preview();expect(JSON.parse(requests[0].options.body)).toEqual(createParallelSearchDraft([]));
 expect(requests[0].url).toEndWith('/preview');controller.dispose();
});


test('new-server intent survives renaming and field edits until an existing row is selected',async()=>{
 const {createParallelSearchDraft}=await import('../../web/src/ui/mcp-server-settings-model.js');
 const requests:any[]=[],controller=createMcpServerSettingsController(()=>{},async(_url,options)=>{const draft=JSON.parse(options!.body as string);requests.push(draft);return Response.json(body({name:draft.name,action:draft.action,applicable:true}));});
 controller.edit(createParallelSearchDraft([])!);
 controller.edit({name:'saved',action:'update',patch:{url:'https://search.parallel.ai/mcp'}});await controller.preview();expect(requests.at(-1).action).toBe('create');
 controller.edit({name:'parallel-search',action:'update',patch:{requestTimeoutMs:5000}});await controller.preview();expect(requests.at(-1).action).toBe('create');
 controller.edit({name:'saved',action:'update',patch:{disabled:true}},{selectExisting:true});await controller.preview();expect(requests.at(-1).action).toBe('update');controller.dispose();
});
