import {expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {Harness,MemoryStorage,createRegistry,defineEntry,defineExtension,defineTool,type ConversationId} from '@earendil-works/pi-durable';
import {createModels,fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {Type} from 'typebox';
import {createApplicationOptimizerMcp,type ApplicationFeatureBinding} from '../src/application-optimizer-mcp.ts';
import {mcpAgentAllowed} from '../src/mcp/policy.ts';

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
  expect(await features.identity(root.id)).toMatchObject({child:false,readOnly:false,agentId:'root'});expect(await features.identity(childId!)).toMatchObject({child:true,readOnly:true});expect(await features.identity(fork.id)).toMatchObject({child:true,readOnly:true});
  const agents=await features.agents();expect(agents.find(row=>row.durableId===childId)?.oneShotCallId).toStartWith('sdk:');expect(agents.find(row=>row.durableId===fork.id)).toMatchObject({readOnly:true});expect(agents.find(row=>row.durableId===fork.id)?.oneShotCallId).toBeUndefined();
  const publicPoint=await harness.commit(tx=>tx.appendEntry(mark,root.id,{data:{value:'Public fork point'}}),context),publicFork=await root.fork(publicPoint.id,{ownership:{kind:'ownerless'}},context);
  expect(await features.identity(publicFork.id)).toMatchObject({child:true,readOnly:true});
  database.run("INSERT INTO chat_branches VALUES('web:fork','routed-fork','fork',NULL)");bindings.push({chatJid:'web:fork',branchId:'routed-fork',conversationId:publicFork.id});
  expect(await features.identity(publicFork.id)).toMatchObject({child:false,readOnly:false,agentId:'routed-fork'});expect((await features.agents()).find(row=>row.durableId===publicFork.id)?.oneShotCallId).toBeUndefined();
 }finally{await features.close();await harness.close(context);database.close();}
});

test('selected MCP grants survive rename but never transfer through alias reuse or branch replacement',async()=>{
 const database=new Database(':memory:');database.exec("CREATE TABLE chat_branches(chat_jid TEXT,branch_id TEXT,agent_name TEXT,archived_at TEXT);INSERT INTO chat_branches VALUES('web:original','original-branch','private-agent',NULL)");
 const registry=createRegistry(),harness=await Harness.open(new MemoryStorage(),{registry,models:createModels()},context),root=await harness.root(context);
 const other=await harness.commit(tx=>tx.createConversation({ownership:{kind:'ownerless'}}),context),bindings:ApplicationFeatureBinding[]=[{chatJid:'web:original',branchId:'original-branch',conversationId:root.id}];
 const host:any={modelRegistry:{getAvailable:()=>[]},modelRuntime:{getModelsOfType:()=>[]}};
 const features=createApplicationOptimizerMcp({root:database,workspaceRoot:process.env.PICLAW_WORKSPACE!,registry,host,harness:()=>harness,bindings:async()=>bindings,assertOwner(){},captureSource:async()=>{throw Error('No MCP call is admitted by this identity fixture');},offlineMaintenance:true});
 try{
  const original=(await features.identity(root.id))!,grant={workspaceId:features.workspaceId,agentIds:[original.agentId],enabled:true};
  database.run("UPDATE chat_branches SET agent_name='renamed' WHERE branch_id='original-branch'");database.run("INSERT INTO chat_branches VALUES('web:other','other-branch','private-agent',NULL)");bindings.push({chatJid:'web:other',branchId:'other-branch',conversationId:other.id});
  const renamed=(await features.identity(root.id))!,alias=(await features.identity(other.id))!;
  expect({originalStillGranted:mcpAgentAllowed(grant,features.workspaceId,renamed.agentId),aliasDenied:!mcpAgentAllowed(grant,features.workspaceId,alias.agentId)}).toEqual({originalStillGranted:true,aliasDenied:true});
  expect(renamed.agentId).toBe('original-branch');expect(alias.agentId).toBe('other-branch');
  database.run("UPDATE chat_branches SET archived_at='archived' WHERE branch_id='original-branch'");expect(await features.identity(root.id)).toBeUndefined();
  database.run("DELETE FROM chat_branches WHERE branch_id='original-branch'");database.run("INSERT INTO chat_branches VALUES('web:original','replacement-branch','renamed',NULL)");bindings[0]={...bindings[0]!,branchId:'replacement-branch'};
  expect(mcpAgentAllowed(grant,features.workspaceId,(await features.identity(root.id))!.agentId)).toBe(false);
  expect(mcpAgentAllowed({...grant,agentIds:['renamed']},features.workspaceId,(await features.identity(root.id))!.agentId)).toBe(false);
 }finally{await features.close();await harness.close(context);database.close();}
});
