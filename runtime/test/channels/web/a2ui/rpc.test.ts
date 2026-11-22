import '../../../helpers.ts';
import { expect, test } from 'bun:test';
import { getDb, initDatabase, storeMessage } from '../../../../src/db.js';
import { publishAgentA2ui } from '../../../../src/channels/web/a2ui/publish.js';
import { A2uiAgentRpc, defineA2uiAgentFunction } from '../../../../src/channels/web/a2ui/agent-rpc.js';
import { handleA2uiRendererError, handleA2uiRendererReply, handleA2uiRpc } from '../../../../src/channels/web/a2ui/rpc.js';
import { RendererRpcBroker } from '../../../../src/channels/web/a2ui/renderer-rpc.js';
import { takeA2uiRendererErrors } from '../../../../src/channels/web/a2ui/renderer-errors.js';
import { CLASSIC_A2UI_CATALOG } from '../../../../src/channels/web/a2ui/surface.js';
import type { WebChannelLike } from '../../../../src/channels/web/core/web-channel-contracts.js';

const catalogue = 'urn:piclaw:test:rpc:1';

async function fixture() {
  initDatabase();
  const root = getDb(), chatJid = `web:rpc:${crypto.randomUUID()}`;
  const thread = storeMessage({id:'thread',chat_jid:chatJid,sender:'user',content:'Exercise RPC',timestamp:new Date().toISOString(),is_from_me:false});
  const publish = {root,chatJid,conversationId:11,thread:() => thread,authorise:() => {}};
  const post = await publishAgentA2ui(publish,{express:'$/title = "A title"; root=Text($/title)', fallback:'RPC fixture'});
  let conversationId = 11, calls = 0, hold: Promise<void> | undefined;
  const normalize = {catalogue, name:'normalizeLabel', parseArgs: (args: Record<string, unknown>) =>
    Object.keys(args).length === 1 && typeof args.label === 'string' ? {label:args.label} : undefined,
  async run({label}: {label:string}) { calls++; await hold; return label.trim().toUpperCase(); }};
  const agent = new A2uiAgentRpc([defineA2uiAgentFunction(normalize), defineA2uiAgentFunction({...normalize,name:'captureOnly',allowedCallers:'agentOnly'}),
    defineA2uiAgentFunction({...normalize,name:'gestureOnly',requiresUserActivation:true}), defineA2uiAgentFunction({...normalize,name:'noop',run:() => undefined}),
    defineA2uiAgentFunction({...normalize,name:'fail',run:() => { throw Error('Internal fixture diagnostic'); }})]);
  const renderer=new RendererRpcBroker();
  const channel = {authGateway:{getPrincipal:(req:Request) => ({kind:'local',userId:'default',mode:'single-user',role:'admin',
    authentication:{method:'local',sessionId:req.headers.get('x-test-session') || 'session-one',expiresAt:null}})},
  a2uiRpcScope: (chat: string) => chat === chatJid ? {conversationId, agent, renderer, assertCurrent() {}} : undefined} as unknown as WebChannelLike;
  const make = (name = 'normalizeLabel', functionCallId: string = crypto.randomUUID(), args: Record<string, unknown> = {label:'  piccolo  '}) => ({
    chat_jid:chatJid,post_id:post.rowId,thread_id:thread,revision:post.revision,
    metadata:{a2uiRendererCapabilities:{'1.0':{supportedCatalogIds:[CLASSIC_A2UI_CATALOG,catalogue]}}},
    message:{version:'1.0',callAgentFunction:{surfaceId:post.surfaceId,functionCallId,callFunction:{'@call':name,catalogId:catalogue,args}}},
  });
  const send = (body: unknown, session = 'session-one') => handleA2uiRpc(channel, new Request('http://fixture/agent/a2ui-rpc', {method:'POST',
    headers:{'x-test-session':session},body:JSON.stringify(body)}));
  const report = (body: unknown, session = 'session-one') => handleA2uiRendererError(channel,new Request('http://fixture/agent/a2ui-error',{method:'POST',
    headers:{'x-test-session':session},body:JSON.stringify(body)}));
  const reply=(body:unknown) => handleA2uiRendererReply(channel,new Request('http://fixture/agent/a2ui-renderer-reply',{method:'POST',body:JSON.stringify(body)}));
  return {root,publish,post,make,send,report,reply,renderer,calls:() => calls, swapConversation(id: number) { conversationId=id; }, pause(promise: Promise<void>) { hold=promise; }};
}

test('a registered agent function returns v1.0 output and exact retries execute once', async () => {
  const f = await fixture();
  const request = f.make();
  const result = {version:'1.0',agentFunctionResponse:{functionCallId:request.message.callAgentFunction.functionCallId,value:'PICCOLO'}};
  const both = await Promise.all([f.send(request), f.send(request)]);
  expect(both.map(response => response.status)).toEqual([200,200]);
  for (const response of both) {
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual(result);
  }
  expect(f.calls()).toBe(1);
  expect((await f.send(f.make('normalizeLabel',request.message.callAgentFunction.functionCallId,{label:'Changed'}))).status).toBe(409);
  expect(f.calls()).toBe(1);
  expect(await (await f.send(f.make('noop','void-call'))).json()).toEqual({version:'1.0',agentFunctionResponse:{functionCallId:'void-call',value:null}});
});

test('unregistered, malformed and disallowed function calls cannot execute', async () => {
  const f = await fixture();
  for (const [name,code] of [['absent','UNKNOWN_FUNCTION'],['captureOnly','INVALID_FUNCTION_CALL'],['gestureOnly','INVALID_FUNCTION_CALL']] as const) {
    expect(await (await f.send(f.make(name,name))).json()).toMatchObject({version:'1.0',agentFunctionResponse:{functionCallId:name,error:{code}}});
  }
  const request = f.make();
  expect(await (await f.send({...request,metadata:undefined})).json()).toMatchObject({agentFunctionResponse:{error:{code:'INVALID_FUNCTION_CALL'}}});
  expect(await (await f.send(f.make('normalizeLabel','invalid-args',{}))).json())
    .toMatchObject({agentFunctionResponse:{functionCallId:'invalid-args',error:{code:'INVALID_FUNCTION_CALL'}}});
  const failure = await (await f.send(f.make('fail','safe-error'))).json();
  expect(failure).toMatchObject({agentFunctionResponse:{functionCallId:'safe-error',error:{code:'EXECUTION_ERROR'}}});
  expect(JSON.stringify(failure)).not.toContain('Internal fixture diagnostic');
  expect((await f.send({...request,message:{...request.message,action:{}}})).status).toBe(400);
  expect((await f.send({...request,thread_id:f.post.rowId})).status).toBe(409);
  f.swapConversation(12);
  expect((await f.send(request)).status).toBe(409);
  expect(f.calls()).toBe(0);
});

test('reverse replies project owned, opted-in drafts instead of accepting models from the browser', async () => {
  const f=await fixture();
  const surface=await publishAgentA2ui(f.publish,{fallback:'Synced',messages:[{version:'1.0',createSurface:{surfaceId:'draft',catalogId:CLASSIC_A2UI_CATALOG,
    sendDataModel:true,dataModel:{title:'Committed'},components:[{id:'root',component:'TextField',label:'Title',value:{'@path':'/title'}}],
  }}]});
  const scope={chatJid:f.publish.chatJid,conversationId:11,sessionId:'session-one'};
  const peer=f.renderer.register(scope,()=>{},()=>{},()=>{});
  const functionCallId='reverse-model';
  const pending=f.renderer.invoke(f.renderer.bind(peer.lease,scope)!,scope.chatJid,11,{message:{version:'1.0',callRendererFunction:{functionCallId,
    callFunction:{'@call':'inspect',catalogId:catalogue},
  }}},()=>{});
  try {
    const message={version:'1.0',rendererFunctionResponse:{functionCallId,value:null}};
    const body={chat_jid:scope.chatJid,renderer_peer:peer.lease,message};
    expect((await f.reply({...body,metadata:{a2uiRendererDataModel:{version:'1.0',surfaces:{other:{}}}}})).status).toBe(400);
    const patch={surface_id:surface.surfaceId,revision:surface.revision};
    expect((await f.reply({...body,a2ui_drafts:[{...patch,edits:[{component_id:'missing',value:'Private'}]}]})).status).toBe(400);
    expect((await f.reply({...body,a2ui_drafts:[{...patch,edits:[{component_id:'root',value:'Private'}]}]})).status).toBe(204);
    expect(await pending).toEqual({message,metadata:{a2uiRendererDataModel:{version:'1.0',surfaces:{[surface.surfaceId]:{title:'Private'}}}}});
    expect((await f.reply(body)).status).toBe(409);
  } finally {peer.disconnect();}
});

test('private renderer diagnostics are correlated, scrubbed and delivered once with committed input', async () => {
  const f=await fixture();
  const {metadata:_offer,message,...source}=f.make('fail','diagnostic');
  const {functionCallId,surfaceId}=message.callAgentFunction;
  const packet={...source,surface_id:surfaceId,message:{version:'1.0',error:{code:'EXPRESSION_ERROR',functionCallId,message:'Untrusted diagnostic text'}}};
  expect((await f.report(packet)).status).toBe(409);
  expect((await f.send({...source,message,metadata:_offer})).status).toBe(200);
  expect((await f.report(packet,'session-two')).status).toBe(409);
  expect((await f.report({...packet,revision:2})).status).toBe(409);
  expect((await f.report({...packet,message:{version:'1.0',error:{...packet.message.error,surfaceId}}})).status).toBe(400);
  const accepted=await f.report(packet);
  expect(accepted.status).toBe(204);
  expect(accepted.headers.get('cache-control')).toContain('no-store');
  expect((await f.report(packet)).status).toBe(204);
  const take=(conversation:number)=>takeA2uiRendererErrors(f.root,source.chat_jid,conversation);
  expect(f.root.transaction(()=>take(12))()).toEqual([]);
  expect(f.root.transaction(()=>takeA2uiRendererErrors(f.root,source.chat_jid,11,0))()).toEqual([]);
  const expected=[{version:'1.0',error:{code:'EXPRESSION_ERROR',functionCallId,message:'The agent function did not complete.'}}];
  expect(()=>f.root.transaction(()=>{expect(take(11)).toEqual(expected);throw Error('rollback');})()).toThrow('rollback');
  expect(f.root.transaction(()=>take(11))()).toEqual(expected);
  expect((await f.report(packet)).status).toBe(204);
  expect(f.root.transaction(()=>take(11))()).toEqual([]);
});

test('a surface-scoped expression diagnostic keeps its local meaning after scrubbing', async () => {
  const f=await fixture();
  const {metadata:_metadata,message,...source}=f.make();
  const {surfaceId}=message.callAgentFunction;
  const sent=await f.report({...source,surface_id:surfaceId,message:{version:'1.0',error:{
    code:'EXPRESSION_ERROR',surfaceId,message:'Raw input and model details',
  }}});
  expect(sent.status).toBe(204);
  expect(f.root.transaction(()=>takeA2uiRendererErrors(f.root,source.chat_jid,11))()).toEqual([
    {version:'1.0',error:{code:'EXPRESSION_ERROR',surfaceId,message:'The renderer could not evaluate the function.'}},
  ]);
});

test('a revision change suppresses the result of an asynchronous function', async () => {
  const f = await fixture();
  const pause = Promise.withResolvers<void>(); f.pause(pause.promise);
  const request=f.make();
  const pending=f.send(request);
  try {
    for(let steps=0;steps<100&&f.calls()===0;steps++) await Bun.sleep(3);
    expect(f.calls()).toBe(1);
    await publishAgentA2ui(f.publish,{post_id:f.post.rowId,revision:1,express:'$/title="Changed"'});
  } finally { pause.resolve(); }
  const response = await pending;
  expect(response.status).toBe(409);
  expect(await response.json()).not.toHaveProperty('agentFunctionResponse.value');
  expect((await f.send(request)).status).toBe(409);
  expect(f.calls()).toBe(1);
});
