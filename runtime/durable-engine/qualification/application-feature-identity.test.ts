import {expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {Harness,MemoryStorage,createRegistry,defineEntry,defineExtension,defineTool,type ConversationId} from '@earendil-works/pi-durable';
import {createModels,fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {Type} from 'typebox';
import {createApplicationOptimizerMcp,type ApplicationFeatureBinding} from '../src/application-optimizer-mcp.ts';

test('application identity distinguishes routed Agents, task-owned children and unrouted SDK forks without granting MCP',async()=>{
 const database=new Database(':memory:');database.exec("CREATE TABLE chat_branches(chat_jid TEXT,branch_id TEXT,agent_name TEXT,archived_at TEXT);INSERT INTO chat_branches VALUES('web:default','root','default',NULL)");
 const registry=createRegistry(),models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);let childId:ConversationId|undefined;
 registry.install(defineExtension({name:'fixture.child',tools:[defineTool({name:'make_child',description:'SDK task ownership fixture',parameters:Type.Object({}),replay:'safe',async execute(_args,api){childId=(await api.commit(tx=>tx.createConversation({ownership:{kind:'task',taskId:api.taskId}}),context)).id;return{output:[{type:'text',text:'Created SDK child'}]};}})]}));
 const harness=await Harness.open(new MemoryStorage(),{registry,models},context),root=await harness.root(context),bindings:ApplicationFeatureBinding[]=[{chatJid:'web:default',branchId:'root',conversationId:root.id}];
 // This is a read-only catalogue fixture, not a model/provider execution substitute.
 const host:any={modelRegistry:{getAvailable:()=>[]},modelRuntime:{getModelsOfType:()=>[]}};
 const features=createApplicationOptimizerMcp({root:database,workspaceRoot:process.env.PICLAW_WORKSPACE!,registry,host,harness:()=>harness,bindings:async()=>bindings,assertOwner(){},captureSource:async()=>{throw Error('No MCP call is admitted by this fixture');},offlineMaintenance:true});
 try{
  await root.configure({model:{provider:'faux',modelId:'faux-1'}},context);faux.setResponses([fauxAssistantMessage([fauxToolCall('make_child',{})],{stopReason:'toolUse'}),fauxAssistantMessage('Done')]);expect((await(await root.submit({type:'input',content:'Create a synthetic owned child'},context)).wait(context)).status).toBe('done');expect(childId).toBeDefined();
  const mark=defineEntry<{value:string}>('fixture.identity-mark'),point=await harness.commit(tx=>tx.appendEntry(mark,childId!,{data:{value:'Fork point'}}),context),child=(await harness.conversation(childId!,context))!,fork=await child.fork(point.id,{ownership:{kind:'ownerless'}},context);
  expect(await features.identity(root.id)).toMatchObject({child:false,readOnly:false,agentId:'default'});expect(await features.identity(childId!)).toMatchObject({child:true,readOnly:true});expect(await features.identity(fork.id)).toMatchObject({child:true,readOnly:true});
  const agents=await features.agents();expect(agents.find(row=>row.durableId===childId)?.oneShotCallId).toStartWith('sdk:');expect(agents.find(row=>row.durableId===fork.id)).toMatchObject({readOnly:true});expect(agents.find(row=>row.durableId===fork.id)?.oneShotCallId).toBeUndefined();
  const publicPoint=await harness.commit(tx=>tx.appendEntry(mark,root.id,{data:{value:'Public fork point'}}),context),publicFork=await root.fork(publicPoint.id,{ownership:{kind:'ownerless'}},context);
  expect(await features.identity(publicFork.id)).toMatchObject({child:true,readOnly:true});
  database.run("INSERT INTO chat_branches VALUES('web:fork','routed-fork','fork',NULL)");bindings.push({chatJid:'web:fork',branchId:'routed-fork',conversationId:publicFork.id});
  expect(await features.identity(publicFork.id)).toMatchObject({child:false,readOnly:false,agentId:'fork'});expect((await features.agents()).find(row=>row.durableId===publicFork.id)?.oneShotCallId).toBeUndefined();
 }finally{await features.close();await harness.close(context);database.close();}
});
