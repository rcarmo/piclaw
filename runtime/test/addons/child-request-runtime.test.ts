import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { Type } from 'typebox';
import { DefaultResourceLoader, SettingsManager, type Extension, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { ChildRequestScopeV1 } from '../../src/addons/child-request-contracts.js';
import { bindAddonChildRequestTools, setAddonChildRequestsHost, shutdownAddonChildRequests, resetAddonChildRequestsForTests, type ChildRequestInvocation } from '../../src/addons/child-request-runtime.js';
import { installAddonRuntimeApi, initializeStartupAddonRuntime, shutdownAddonRuntimeContributionsForTests, resetAddonRuntimeContributionsForTests } from '../../src/addons/runtime-contributions.js';
import { withExternalAddonRegistrationContext } from '../../src/addons/external-routes.js';
import { withBudgetWorkContext } from '../../src/budget/context.js';
import { withChatContext } from '../../src/core/chat-context.js';
import { ensureBudgetWork, setBudgetWorkStatus } from '../../src/db/budget-limits.js';
import { closeDatabase, getDb, initDatabase } from '../../src/db/connection.js';
import { createTempWorkspace, setEnv } from '../helpers.js';

const cleanups: Array<() => void> = [];
afterEach(async () => { await shutdownAddonChildRequests(); resetAddonRuntimeContributionsForTests(); closeDatabase(); for (const cleanup of cleanups.splice(0)) cleanup(); });
function fixture() {
  const ws = createTempWorkspace('child-runtime-');
  const restore = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  cleanups.push(() => { restore(); ws.cleanup(); });
  mkdirSync(join(ws.workspace,'.piclaw')); writeFileSync(join(ws.workspace,'.piclaw/config.json'),JSON.stringify({domains:{access:{mode:'single-user'}}}),{mode:0o600});
  initDatabase(); ensureBudgetWork({ id:'runtime-work',chatJid:'web:test',executionKind:'interactive' });
  const packageDir=join(ws.workspace,'.pi/extensions/node_modules/@rcarmo/piclaw-addon-delegate'); mkdirSync(packageDir,{recursive:true});
  writeFileSync(join(packageDir,'package.json'),JSON.stringify({name:'@rcarmo/piclaw-addon-delegate',version:'1.0.0',pi:{extensions:['index.ts'],runtime:{entries:['runtime.ts'],load:'startup'}}}));
  const entry=join(packageDir,'index.ts');writeFileSync(entry,'export default()=>{}');
  return {ws,entry,api:installAddonRuntimeApi(),model:{provider:'fixture',id:'fixture'},signal:new AbortController()};
}
async function register(f:ReturnType<typeof fixture>,owner='delegate') {
  return withExternalAddonRegistrationContext({packageName:'@rcarmo/piclaw-addon-'+owner,entryPath:join(f.ws.workspace,owner+'.ts')},async()=>f.api.childRequests.register());
}
function tool(f:ReturnType<typeof fixture>,execute:ToolDefinition['execute']) {
  const definition:ToolDefinition={name:'delegate',label:'delegate',description:'synthetic',parameters:Type.Object({}),execute};
  const extension={path:f.entry,resolvedPath:realpathSync(f.entry),tools:new Map([['delegate',{definition,sourceInfo:{}}]])} as unknown as Extension;
  bindAddonChildRequestTools([extension],'web:test',f); return definition;
}
const run=(f:ReturnType<typeof fixture>,t:ToolDefinition)=>withBudgetWorkContext({workId:'runtime-work',chatJid:'web:test',kind:'interactive'},()=>withChatContext('web:test','web',()=>t.execute('tool-call',{},f.signal.signal,undefined,{} as never)));
const input=(f:ReturnType<typeof fixture>)=>({model:f.model,signal:f.signal.signal,deadlineAt:Date.now()+5000});
const gate=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return{promise,resolve}};
function scope(f:ReturnType<typeof fixture>,close:()=>Promise<void>=async()=>{}):ChildRequestScopeV1 {
  return {plan:{version:1,execution:'parent-provider-proxy',mcp:'none',model:f.model},stream(){throw Error('unused')},close};
}

test('runtime advertises unchanged V1 but registration requires startup owner and execution denies absent host',async()=>{
 const f=fixture();expect(f.api.childRequests.version).toBe(1);expect(()=>f.api.childRequests.register()).toThrow('unavailable');const r=await register(f);
 const t=tool(f,async()=>{expect(()=>r.createScope(input(f))).toThrow('unavailable');return{content:[],details:{}}});await run(f,t);
});
test('exact installed tool call captures work/addon/database and closes scopes before returning',async()=>{
 const f=fixture(),r=await register(f);let captured:ChildRequestInvocation|undefined,closed=0;
 setAddonChildRequestsHost({createScope(_request,authority){captured=authority;return scope(f,async()=>{closed++})}});
 const t=tool(f,async()=>{const s=r.createScope(input(f));expect(s.plan.model).toEqual(f.model);return{content:[],details:{}}});await run(f,t);
 expect(captured?.addonId).toBe('delegate');expect(captured?.toolCallId).toBe('tool-call');expect(captured?.work.workId).toBe('runtime-work');expect(captured?.database).toBe(getDb());expect(closed).toBe(1);expect(()=>captured!.authorise()).toThrow('unavailable');
});
test('registration cannot act outside its matching invocation or under foreign add-on ownership',async()=>{
 const f=fixture(),r=await register(f),foreign=await register(f,'other');let calls=0;setAddonChildRequestsHost({createScope(){calls++;return scope(f)}});
 expect(()=>r.createScope(input(f))).toThrow('unavailable');const t=tool(f,async()=>{expect(()=>foreign.createScope(input(f))).toThrow('unavailable');return{content:[],details:{}}});await run(f,t);expect(calls).toBe(0);
});
test('tool completion waits raw close and late inherited callbacks lose admission',async()=>{
 const f=fixture(),r=await register(f),tail=gate(),entered=gate();let late:()=>void=()=>{};setAddonChildRequestsHost({createScope(){return scope(f,async()=>{entered.resolve();await tail.promise})}});
 const t=tool(f,async()=>{r.createScope(input(f));late=()=>r.createScope(input(f));return{content:[],details:{}}});let returned=false;const result=run(f,t).then(()=>{returned=true});await entered.promise;expect(returned).toBe(false);expect(late).toThrow('unavailable');tail.resolve();await result;expect(returned).toBe(true);
});
test('scope closure and host generation are retained across shutdown, with no timeout-as-release',async()=>{
 const f=fixture(),r=await register(f),tail=gate(),inside=gate(),release=gate();let s:ChildRequestScopeV1|undefined;setAddonChildRequestsHost({createScope(){return scope(f,()=>tail.promise)}});
 const t=tool(f,async()=>{s=r.createScope(input(f));inside.resolve();await release.promise;return{content:[],details:{}}});const result=run(f,t);await inside.promise;let shutdown=false;const stop=shutdownAddonChildRequests().then(()=>{shutdown=true});await Bun.sleep(0);expect(shutdown).toBe(false);expect(()=>s!.stream({messages:[]},{},{requestId:'late'})).toThrow('unavailable');tail.resolve();release.resolve();await Promise.all([result,stop]);expect(shutdown).toBe(true);
});
for(const mode of ['cancel','deadline','require-mcp','work','access','reopen','target-path']as const)test(`runtime scope creation denies ${mode} before host work`,async()=>{
 const f=fixture(),r=await register(f);let calls=0;setAddonChildRequestsHost({createScope(){calls++;return scope(f)}});
 const t=tool(f,async()=>{let request=input(f);if(mode==='cancel')f.signal.abort();if(mode==='deadline')request={...request,deadlineAt:Date.now()+400000};if(mode==='require-mcp')request={...request,requireMcp:true} as typeof request;
 if(mode==='work')setBudgetWorkStatus('runtime-work','cancelled');if(mode==='access')writeFileSync(join(f.ws.workspace,'.piclaw/config.json'),JSON.stringify({domains:{access:{mode:'family-shared'}}}));if(mode==='reopen'){closeDatabase();initDatabase();}if(mode==='target-path')process.env.PICLAW_DATA=join(f.ws.base,'other-data');expect(()=>r.createScope(request)).toThrow();return{content:[],details:{}}});await run(f,t);expect(calls).toBe(0);
});
test('failed closure is sticky and prevents reset or successful tool delivery',async()=>{
 const f=fixture(),r=await register(f);setAddonChildRequestsHost({createScope(){return scope(f,async()=>{throw Error('synthetic raw tail failure')})}});const t=tool(f,async()=>{r.createScope(input(f));return{content:[],details:{}}});await expect(run(f,t)).rejects.toThrow('settlement_failed');expect(()=>resetAddonRuntimeContributionsForTests()).toThrow('settlement_failed');await expect(shutdownAddonChildRequests()).rejects.toThrow('settlement_failed');resetAddonChildRequestsForTests(true);
});
test('shutdown permanently revokes host installation and registrations within an existing invocation',async()=>{
 const f=fixture(),r=await register(f);let calls=0;const host={createScope(){calls++;return scope(f)}};setAddonChildRequestsHost(host);
 const t=tool(f,async()=>{await shutdownAddonChildRequests();expect(()=>setAddonChildRequestsHost(host)).toThrow('unavailable');expect(()=>r.createScope(input(f))).toThrow('unavailable');return{content:[],details:{}}});await run(f,t);expect(calls).toBe(0);
});
test('changed work context cannot reuse the original invocation authority',async()=>{
 const f=fixture(),r=await register(f);let calls=0;setAddonChildRequestsHost({createScope(){calls++;return scope(f)}});
 const t=tool(f,async()=>{withBudgetWorkContext({workId:'other-work',chatJid:'web:test',kind:'interactive'},()=>expect(()=>r.createScope(input(f))).toThrow('unavailable'));return{content:[],details:{}}});await run(f,t);expect(calls).toBe(0);
});
test('explicit scope close stops further streams even while raw close is pending',async()=>{
 const f=fixture(),r=await register(f),tail=gate();let streams=0;setAddonChildRequestsHost({createScope(){return{...scope(f,()=>tail.promise),stream(){streams++;throw Error('unexpected host stream')}}}});
 const t=tool(f,async()=>{const s=r.createScope(input(f));const closing=s.close();try{expect(()=>s.stream({messages:[]},{},{requestId:'closed'})).toThrow('unavailable')}finally{tail.resolve()}await closing;return{content:[],details:{}}});await run(f,t);expect(streams).toBe(0);
});
test('resource rebinding revokes old tool definitions and admits only the fresh generation',async()=>{
 const f=fixture(),r=await register(f);let calls=0;setAddonChildRequestsHost({createScope(){calls++;return scope(f)}});
 const old=tool(f,async()=>{expect(()=>r.createScope(input(f))).toThrow('unavailable');return{content:[],details:{}}});
 const fresh=tool(f,async()=>{r.createScope(input(f));return{content:[],details:{}}});await run(f,old);await run(f,fresh);expect(calls).toBe(1);
});
test('actual startup import and public resource loader bind the installed addon tool across reload',async()=>{
 const f=fixture();let calls=0,closed=0;setAddonChildRequestsHost({createScope(){calls++;return scope(f,async()=>{closed++})}});
 writeFileSync(join(f.entry,'../runtime.ts'),'globalThis.__test_child_registration=globalThis.__piclaw_runtime.childRequests.register(); export {};');
 writeFileSync(f.entry,`export default function(pi){pi.registerTool({name:'delegate',label:'delegate',description:'synthetic',parameters:{type:'object',properties:{}},async execute(_id,_params,signal){globalThis.__test_child_registration.createScope({model:{provider:'fixture',id:'fixture'},signal,deadlineAt:Date.now()+5000});return{content:[],details:{}}}});}`);
 try{
 await initializeStartupAddonRuntime({agentMessageEnqueuer:async()=>({status:'ok',chat_jid:'web:test',thread_id:null,created:false}),messagingHandlers:{listAdvertisableAgents:()=>[],resolveLocalTarget:()=>({status:'not_found'}),deliverPeerMessage:async()=>({status:'ok',chat_jid:'web:test',thread_id:null,created:false})}});
 const loader=new DefaultResourceLoader({cwd:f.ws.workspace,agentDir:join(f.ws.workspace,'agent'),settingsManager:SettingsManager.inMemory(),additionalExtensionPaths:[f.entry],noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true});
 await loader.reload();expect(loader.getExtensions().errors).toEqual([]);bindAddonChildRequestTools(loader.getExtensions().extensions,'web:test',loader);
 const loaded=loader.getExtensions().extensions.find(e=>e.resolvedPath===realpathSync(f.entry))!.tools.get('delegate')!.definition;await run(f,loaded);
 await loader.reload();bindAddonChildRequestTools(loader.getExtensions().extensions,'web:test',loader);await expect(run(f,loaded)).rejects.toThrow('unavailable');
 const fresh=loader.getExtensions().extensions.find(e=>e.resolvedPath===realpathSync(f.entry))!.tools.get('delegate')!.definition;await run(f,fresh);expect(calls).toBe(2);expect(closed).toBe(2);
 }finally{delete (globalThis as Record<string,unknown>).__test_child_registration}
});
test('invalid scope authority fields and per-invocation scope cap reject before host work',async()=>{
 const f=fixture(),r=await register(f);let calls=0;setAddonChildRequestsHost({createScope(){calls++;return scope(f)}});
 const t=tool(f,async()=>{for(const request of [{...input(f),accountRef:'spoof'},{...input(f),model:{...f.model,apiKey:'spoof'}},{...input(f),signal:{}},{...input(f),requireMcp:'false'}])expect(()=>r.createScope(request as never)).toThrow('unavailable');for(let n=0;n<16;n++)r.createScope(input(f));expect(()=>r.createScope(input(f))).toThrow('unavailable');return{content:[],details:{}}});await run(f,t);expect(calls).toBe(16);
});
test('preexisting callbacks use captured invocation authority independent of ambient chat/work',async()=>{
 const f=fixture(),r=await register(f),entered=gate(),release=gate();let captured:ChildRequestInvocation|undefined,held:ChildRequestScopeV1|undefined,streams=0;
 setAddonChildRequestsHost({createScope(_request,authority){captured=authority;return{...scope(f),stream(){authority.authorise();streams++;throw Error('synthetic host reached')}}}});
 const t=tool(f,async()=>{held=r.createScope(input(f));entered.resolve();await release.promise;return{content:[],details:{}}});const result=run(f,t);await entered.promise;
 try{await withBudgetWorkContext({workId:'foreign-work',chatJid:'web:other',kind:'delegate'},()=>withChatContext('web:other','web',async()=>{expect(()=>r.createScope(input(f))).toThrow('unavailable');expect(()=>captured!.authorise()).not.toThrow();expect(()=>held!.stream({messages:[]},{},{requestId:'owned'})).toThrow('synthetic host reached')}));expect(streams).toBe(1)}finally{release.resolve();await result}
 expect(()=>captured!.authorise()).toThrow('unavailable');
});
test('legacy shutdown handlers start independently while raw scope close is held',async()=>{
 const f=fixture(),r=await register(f),tail=gate(),inside=gate(),release=gate();let cleaned=false;setAddonChildRequestsHost({createScope(){return scope(f,()=>tail.promise)}});
 f.api.lifecycle.onShutdown(()=>{cleaned=true;tail.resolve()});const t=tool(f,async()=>{r.createScope(input(f));inside.resolve();await release.promise;return{content:[],details:{}}});const result=run(f,t);await inside.promise;
 try{await shutdownAddonRuntimeContributionsForTests();expect(cleaned).toBe(true)}finally{tail.resolve();release.resolve();await result}
});
test('exceptional tool exit still awaits scope close and preserves the original error after successful settlement',async()=>{
 const f=fixture(),r=await register(f);let closed=0;setAddonChildRequestsHost({createScope(){return scope(f,async()=>{closed++})}});
 const t=tool(f,async()=>{r.createScope(input(f));throw Error('synthetic tool fault')});await expect(run(f,t)).rejects.toThrow('synthetic tool fault');expect(closed).toBe(1);
});
for(const mode of ['shutdown','abort','mismatched-plan','reload'] as const)test(`reentrant host ${mode} denies delivery and retains raw close ownership`,async()=>{
 const f=fixture(),r=await register(f),tail=gate(),entered=gate();let stopping:Promise<void>|undefined,shutdownDone=false,closed=0,t:ToolDefinition;
 setAddonChildRequestsHost({createScope(){if(mode==='shutdown')stopping=shutdownAddonChildRequests().then(()=>{shutdownDone=true});if(mode==='abort')f.signal.abort();if(mode==='reload')bindAddonChildRequestTools([],'web:test',f);return{...scope(f,async()=>{closed++;entered.resolve();await tail.promise}),...(mode==='mismatched-plan'?{plan:{version:1,execution:'parent-provider-proxy',mcp:'none',model:{provider:'foreign',id:'foreign'}}}: {})} as ChildRequestScopeV1}});
 t=tool(f,async()=>{expect(()=>r.createScope(input(f))).toThrow('unavailable');return{content:[],details:{}}});let delivered=false;const result=run(f,t).then(()=>{delivered=true});await entered.promise;
 try{expect(delivered).toBe(false);expect(shutdownDone).toBe(false);expect(closed).toBe(1)}finally{tail.resolve();await result;await stopping}expect(closed).toBe(1);if(mode==='shutdown')expect(shutdownDone).toBe(true);
});
