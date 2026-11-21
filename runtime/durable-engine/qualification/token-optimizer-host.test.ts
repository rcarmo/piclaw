import {afterEach,expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';import{mkdtempSync,rmSync}from'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {createRegistry,defineExtension,defineTool,Harness,MemoryStorage,AgentDoc,defineEntry,type ConversationId} from '@earendil-works/pi-durable';
import {SqliteStorage} from '@earendil-works/pi-durable/storage/sqlite';
import {createModels,fauxProvider,fauxAssistantMessage,fauxToolCall,contentText} from '@earendil-works/pi-ai';
import {Type} from 'typebox';
import {BunSqliteDatabase} from '../src/bun-sqlite.ts';
import {TokenOptimizerConfiguration} from '../src/token-optimizer-config.ts';
import {createNativeTokenOptimizer,type CoreOptimizerAgent} from '../src/token-optimizer.ts';
import {applicationRetainedDatabase} from '../src/mcp/retained-database.ts';
const cleanup:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(output='PASS synthetic test',persistent=true){const dir=mkdtempSync(join(tmpdir(),'optimizer-host-')),file=join(dir,'state.sqlite'),db=new Database(persistent?file:':memory:',{create:true});db.exec('PRAGMA journal_mode=WAL;PRAGMA secure_delete=ON;PRAGMA busy_timeout=0;CREATE TABLE router_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);');cleanup.push(async()=>{db.close();rmSync(dir,{recursive:true,force:true});});const config=new TokenOptimizerConfiguration(db,()=>{},"workspace");const models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);const registry=createRegistry();let harness:Harness,calls=0;const agents:CoreOptimizerAgent[]=[];
 const native=createNativeTokenOptimizer({workspaceId:'workspace',workspaceRoot:dir,environmentRevision:'owned-fixture-v1',harness:()=>harness,models,registry,configuration:config,agents:async()=>agents,plan:async()=>null,readSavedOutput:async()=>({status:'unavailable'}),database:applicationRetainedDatabase(db,()=>{})});
 registry.install(defineExtension({name:'fixture.tools',tools:[defineTool({name:'bash',description:'Synthetic',parameters:Type.Object({command:Type.String()}),structuredOutputSchema:Type.Object({output:Type.String(),exitCode:Type.Integer()}),replay:'unsafe',async execute(){calls++;return{output:[{type:'text' as const,text:output}],structuredOutput:{output,exitCode:0},details:{exitCode:0,fullOutputPath:'/owned/fixture.log'}};}}),...['session_status','exit_process','goal_complete','plan'].map(name=>defineTool({name,description:'Protected '+name,parameters:Type.Object({}),replay:'safe',async execute(){return{output:[{type:'text' as const,text:'metadata'}]};}}))]}));registry.install(native.optimizer.extension);
 harness=await Harness.open(persistent?await SqliteStorage.open(new BunSqliteDatabase(file)):new MemoryStorage(),{registry,models},context);cleanup.push(async()=>{try{await native.close();}finally{await harness.close(context);}});const root=await harness.root(context);await root.configure({model:{provider:'faux',modelId:'faux-1'}},context);agents.push({agentId:'root_agent',durableId:root.id,label:'Root'});await native.attach();return{db,file,config,faux,registry,native,root,agents,calls:()=>calls,get harness(){return harness;},async reopen(){await native.detach();await harness.close(context);harness=await Harness.open(await SqliteStorage.open(new BunSqliteDatabase(file)),{registry,models},context);await native.attach();return(await harness.conversation(root.id,context))!;}};
}
test('native host uses SDK sessions, stays model-free while Off and keeps protected controls',async()=>{const f=await fixture(),host=f.native.host(f.root.id);expect(host.repositoryRoot).toBeTruthy();expect(host.scope.host).toBe('piclaw.native');expect(f.config.policy().mode).toBe('off');const catalogue=await f.native.domain.catalogue(host);for(const name of ['session_status','exit_process','goal_complete','plan'])expect(catalogue.tools.find(tool=>tool.name===name)?.protected).toBe(true);f.faux.setResponses([fauxAssistantMessage([fauxToolCall('bash',{command:'synthetic test'})],{stopReason:'toolUse'}),fauxAssistantMessage('Done')]);expect((await(await f.root.submit({type:'input',content:'Synthetic'},context)).wait(context)).status).toBe('done');expect(f.calls()).toBe(1);expect(f.faux.state.callCount).toBe(2);});
test('tool-mask ownership cannot overwrite an external explicit restriction',async()=>{const f=await fixture(),host=f.native.host(f.root.id);const config=f.config.snapshot();config.policy.enabled=true;await f.config.configure(config);await f.native.domain.setTools(host,[]);await f.harness.commit(async tx=>{(await tx.doc(AgentDoc,f.root.id)).tools=['bash','plan'];},context);await expect(f.native.domain.setTools(host,['bash'])).rejects.toThrow('outside the optimizer');expect((await f.harness.snapshot(AgentDoc,f.root.id,context))?.tools).toEqual(['bash','plan']);});
test('SQLite reopen retains the same optimizer logical session, not a new learning vote',async()=>{
 const f=await fixture(),before=f.native.host(f.root.id),child=await f.harness.commit(tx=>tx.createConversation({ownership:{kind:'ownerless'}}),context);
 f.agents.push({agentId:'persistent_child',durableId:child.id,parentId:'root_agent',rootId:'root_agent'});
 expect((await f.native.domain.session(child.id))?.parent).toBe(before.id);
 const config=f.config.snapshot();config.policy.enabled=true;await f.config.configure(config);await f.reopen();
 expect(f.native.host(f.root.id).id).toBe(before.id);expect(f.native.host(f.root.id).classificationGroup).toBe(before.classificationGroup);
 expect(await f.harness.conversation(child.id,context)).toBeDefined();expect((await f.native.domain.session(child.id))?.parent).toBe(before.id);
});
test('detach stops configuration producers and joins an already running policy callback',async()=>{
 const f=await fixture();let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(resolve=>{enter=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});const update=f.native.optimizer.updatePolicy.bind(f.native.optimizer);let calls=0;
 f.native.optimizer.updatePolicy=async(...args:Parameters<typeof update>)=>{calls++;enter();await held;return update(...args);};
 const config=f.config.snapshot();config.policy.enabled=true;const configuring=f.config.configure(config);await entered;let detached=false;const detaching=f.native.detach().then(()=>{detached=true;});
 try{await Promise.resolve();expect(detached).toBe(false);}finally{release();}
 await Promise.all([configuring,detaching]);expect(detached).toBe(true);expect(calls).toBe(1);const after=f.config.snapshot();after.policy.enabled=false;await f.config.configure(after);expect(calls).toBe(1);await f.native.detach();
});
// Catalogue attribution is a public SDK behaviour probe. Keep its 5s deadline;
// the separate reopen test and default-factory cases retain real SQLite files.
test('read-only and one-shot children get no learning session while a delegated child inherits root scope',async()=>{const f=await fixture(undefined,false);const ids=await f.harness.commit(async tx=>{const a=await tx.createConversation({ownership:{kind:'ownerless'}}),b=await tx.createConversation({ownership:{kind:'ownerless'}}),c=await tx.createConversation({ownership:{kind:'ownerless'}});return[a.id,b.id,c.id];},context);f.agents.push({agentId:'child',durableId:ids[0]!,parentId:'root_agent',rootId:'root_agent'},{agentId:'reader',durableId:ids[1]!,parentId:'root_agent',rootId:'root_agent',readOnly:true},{agentId:'oneshot',durableId:ids[2]!,parentId:'root_agent',rootId:'root_agent',oneShotCallId:'one'});const child=await f.native.domain.session(ids[0]!);expect(child?.parent).toBe(f.native.host(f.root.id).id);expect(child?.scope).toEqual(f.native.host(f.root.id).scope);expect(await f.native.domain.session(ids[1]!)).toBeNull();expect(await f.native.domain.session(ids[2]!)).toBeNull();expect((await f.native.optimizerSessions()).length).toBe(1);});

test('an empty optimiser restore preserves a newly configured external SDK filter',async()=>{
 const f=await fixture(),host=f.native.host(f.root.id);await f.harness.commit(async tx=>{(await tx.doc(AgentDoc,f.root.id)).tools=['bash'];},context);
 await f.native.domain.setTools(host,[]);expect((await f.harness.snapshot(AgentDoc,f.root.id,context))?.tools).toEqual(['bash']);
});
test('native offload never replaces a result with an inaccessible retrieval reference',async()=>{
 const original='FULL_ORIGINAL_OWNED_LOG '.repeat(1000),f=await fixture(original);const enabled=f.config.snapshot();Object.assign(enabled.policy,{enabled:true,offloadOutputs:true,reduceOutputs:false});await f.config.configure(enabled);const active=f.config.snapshot();active.policy.mode='active';await f.config.configure(active);
 await f.harness.commit(async tx=>{(await tx.doc(AgentDoc,f.root.id)).tools=['bash'];},context);
 f.faux.setResponses([fauxAssistantMessage([fauxToolCall('bash',{command:'synthetic log'})],{stopReason:'toolUse'}),request=>{expect(request.messages.filter(message=>message.role==='toolResult').map(message=>contentText(message.content)).at(-1)).toBe(original);return fauxAssistantMessage('Done');}]);
 expect((await(await f.root.submit({type:'input',content:'Read the permitted complete log'},context)).wait(context)).status).toBe('done');expect(f.calls()).toBe(1);expect((await f.harness.snapshot(AgentDoc,f.root.id,context))?.tools).toEqual(['bash']);
});
