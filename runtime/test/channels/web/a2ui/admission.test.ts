import '../../../helpers.ts';
import { expect, test } from 'bun:test';
import { getDb, getMessageByRowId, initDatabase } from '../../../../src/db.js';
import { admitWebMessage } from '../../../../src/channels/web/messaging/message-store.js';
import { handleA2uiAction } from '../../../../src/channels/web/a2ui/admission.js';
import { A2uiAgentRpc, defineA2uiAgentFunction } from '../../../../src/channels/web/a2ui/agent-rpc.js';
import { handleA2uiRpc } from '../../../../src/channels/web/a2ui/rpc.js';
import { a2uiActionEvaluationSite } from '../../../../src/channels/web/a2ui/rpc-json.js';
import { CLASSIC_A2UI_RENDERER_CAPABILITIES } from '../../../../src/channels/web/a2ui/capabilities.js';
import { publishAgentA2ui } from '../../../../src/channels/web/a2ui/publish.js';
import { projectA2uiAgentInput, readA2uiRendererDataModel, storeA2uiInputMetadata } from '../../../../src/channels/web/a2ui/input-metadata.js';
import { applyA2uiMessages, compileA2uiExpress } from '../../../../src/channels/web/a2ui/express.js';
import { buildA2uiAction, type A2uiActionRequest } from '../../../../src/channels/web/a2ui/action.js';
import type { A2uiSnapshot } from '../../../../src/channels/web/a2ui/surface.js';
import type { WebChannelLike } from '../../../../src/channels/web/core/web-channel-contracts.js';

const chat = 'web:a2ui-test';
const snapshot = applyA2uiMessages('form', compileA2uiExpress('$/value = ""; root = Column([TextField(label="Note",value=$/value), submit]); submit = Button(Text("Save"),action=Event("save", {note:$/value}))', 'form'))!;

async function fixture(options: { keep?: boolean; cancel?: boolean; template?: A2uiSnapshot; sync?: boolean; agent?: A2uiAgentRpc } = {}) {
  let surface = options.template ?? (options.cancel ? applyA2uiMessages("form", compileA2uiExpress('root = Button(Text("Cancel"), action=Event("cancel"))', "form"))! : snapshot);
  initDatabase();
  let dispatch = 0;
  let recipientId = 31;
  const updates: number[] = [];
  const admit: WebChannelLike['admitMessage'] = (chatJid, content, isBot, mediaIds, opts, authority, signal) =>
    admitWebMessage({} as any, { chatJid, agentId: 'default', agentName: 'Pi', content, isBot, mediaIds }, opts, authority, signal);
  const channel = {
    ...(options.agent ? {
      authGateway:{getPrincipal:(req:Request)=>({kind:'local',userId:'default',mode:'single-user',role:'admin',authentication:{method:'local',sessionId:req.headers.get('x-test-session') ?? 'test-login'}})},
      a2uiRpcScope:(chatJid:string)=>chatJid===chat ? {conversationId:recipientId,agent:options.agent,assertCurrent(){}} : undefined,
    } : {}),
    json: (body: unknown, status = 200) => Response.json(body, {status}),
    agentPool: {},
    broadcastEvent: () => {},
    interactionBroadcaster: { broadcastInteractionUpdated: (row: {id: number}) => updates.push(row.id) },
    getInputSourceAdmission: (chatJid: string): ReturnType<NonNullable<WebChannelLike['getInputSourceAdmission']>> => (stored, renderer) => {
      if (!options.sync || !renderer) return;
      const conversationId = recipientId;
      storeA2uiInputMetadata(stored.database, {chatJid,sourceId:stored.message.id,conversationId},
        readA2uiRendererDataModel(stored.database,chatJid,conversationId,renderer));
    },
    dispatchAcceptedInput: async () => ({ submission_id: ++dispatch, queued: false }),
    admitMessage: admit,
  } as unknown as WebChannelLike;
  const root = (await admit(chat, 'Form thread', false, [], {}))!;
  const source = options.sync ? await (async () => {
    const {progressive: _hostOnly,...createSurface}=surface;
    const sync = await publishAgentA2ui({root:getDb(),chatJid:chat,conversationId:31,thread:() => root.id,authorise:() => {}}, {
      fallback:'Synced form',keep_active:options.keep,messages:[{version:'1.0',createSurface:{...createSurface,sendDataModel:true,
        dataModel:{...surface.dataModel,onlyInModel:'Full model'}}}],
    });
    const post = getMessageByRowId(chat,sync.rowId)!;
    surface = (post.data!.content_blocks![0] as {surface:A2uiSnapshot}).surface;
    return post;
  })() : (await admit(chat, 'Form fallback', true, [], { threadId: root.id, contentBlocks: [{
    type: 'a2ui_surface', revision: 1, state: 'active', fallback_text: 'Form fallback', owner: 'agent', surface, ...(options.keep ? {submit_behavior:'keep_active'} : {}),
  }] }))!;
  const instance_path = options.template && !options.agent ? '/1' : undefined;
  const payload: A2uiActionRequest = { chat_jid: chat, post_id: source.id, thread_id: root.id, revision: 1, instance_path,
    request_id: crypto.randomUUID(), ...(options.sync ? {metadata:{a2uiRendererCapabilities:CLASSIC_A2UI_RENDERER_CAPABILITIES}} : {}),
    message: buildA2uiAction(surface, options.cancel ? 'root' : 'submit', new Map([['/value', 'hello']]), new Date().toISOString(), instance_path,[],undefined,
      options.agent ? ()=>({valid:true}) : undefined,options.agent ? ()=>()=>'Server-derived value' : undefined) };
  const send = (data = payload) => handleA2uiAction(channel, new Request('http://test/agent/a2ui-action', { method: 'POST', body: JSON.stringify(data) }));
  return { channel, payload, send, updates, dispatch: () => dispatch, routeTo(id: number) { recipientId = id; } };
}

test('a stored agent surface submits once to its own source thread even on concurrent retries', async () => {
  const f = await fixture();
  const responses = await Promise.all([f.send(), f.send()]);
  expect(responses.map(r => r.status).sort()).toEqual([200, 201]);
  expect(f.dispatch()).toBe(1);
  const source = getMessageByRowId(chat, f.payload.post_id)!;
  expect(source.data!.content_blocks![0]).toMatchObject({ state: 'completed', revision: 2 });
  const accepted = getDb().query('SELECT content, thread_id FROM messages WHERE chat_jid = ? AND content LIKE ?').all(chat, 'Submitted%');
  expect(accepted).toHaveLength(1);
  expect(accepted[0]).toMatchObject({ content: expect.stringContaining('hello'), thread_id: f.payload.thread_id });
  expect(f.updates).toEqual([f.payload.post_id]);
  expect((await f.send({ ...f.payload, request_id: crypto.randomUUID() })).status).toBe(409);
});

test('a synced submission preserves the full updated model only in the owning agent input', async () => {
  const f = await fixture({sync:true});
  f.routeTo(32);
  expect((await f.send()).status).toBe(400);
  expect(f.dispatch()).toBe(0);
  expect(getMessageByRowId(chat,f.payload.post_id)?.data?.content_blocks?.[0]).toMatchObject({state:'active',revision:1});
  f.routeTo(31);
  const replies = await Promise.all([f.send(), f.send()]);
  expect(replies.map(response => response.status).sort()).toEqual([200,201]);
  expect(f.dispatch()).toBe(1);
  const stored = getMessageByRowId(chat,f.payload.post_id)!;
  const block = stored.data?.content_blocks?.[0];
  expect(block).toMatchObject({state:'completed',revision:2,surface:{dataModel:{value:'hello',onlyInModel:'Full model'}}});
  const {row_id: rowId} = (block as {last_submission:{row_id:number}}).last_submission;
  const source = getDb().query('SELECT id,content,content_blocks FROM messages WHERE rowid=?').get(rowId) as
    {id:string;content:string;content_blocks:string | null};
  expect(source.content).toBe('Submitted save\nnote: "hello"');
  expect(source.content_blocks).toBeNull();
  const recipient = {chatJid:chat,sourceId:source.id,conversationId:31};
  const metadata = {a2uiRendererDataModel:{version:'1.0',surfaces:{[f.payload.message.action.surfaceId]:{value:'hello',onlyInModel:'Full model'}}}};
  expect(projectA2uiAgentInput(getDb(),recipient,source.content)).toContain(JSON.stringify(metadata));
  expect(projectA2uiAgentInput(getDb(),{...recipient,conversationId:32},source.content)).toBe(source.content);
  expect(readA2uiRendererDataModel(getDb(),chat,31).surfaces).toEqual({});
});

test('repeated buttons are admitted from a real instance and cannot share a retry identity', async () => {
  const template = applyA2uiMessages('repeated', compileA2uiExpress(`
    $/rows = [{label:"same"},{label:"same"}];
    root = List(_template($/rows, submit));
    submit = Button(Text("Save"),action=Event("save",{label:$label},userMessage="Saved selected row"));
  `, 'repeated'))!;
  const f = await fixture({template});
  for (const instance_path of [undefined, '/2', '/01', '/0/0']) {
    expect((await f.send({...f.payload, instance_path})).status).toBe(400);
  }
  const { message } = f.payload;
  expect((await f.send({...f.payload, message:{...message,action:{...message.action,userMessage:'Unexpected'}}})).status).toBe(400);
  expect((await f.send()).status).toBe(201);
  expect((await f.send()).status).toBe(200);
  expect((await f.send({...f.payload, instance_path:'/0'})).status).toBe(409);
  expect(getDb().query('SELECT content FROM messages WHERE chat_jid=? AND thread_id=? AND content LIKE ?')
    .get(chat, f.payload.thread_id, 'Submitted save%')).toEqual({content:'Submitted save\nSaved selected row\nlabel: "same"'});
  expect(f.dispatch()).toBe(1);
});

test('draft sync validates component occurrences and deduplicates an action that removes its own row', async () => {
  const surfaceId = 'shrink-template';
  const template = applyA2uiMessages(surfaceId, compileA2uiExpress(`
    $/rows = ["First","Second"];
    root = Column([selection, List(_template($/rows, submit))]);
    selection = ChoicePicker(label="Rows",variant="multipleSelection",value=$/rows,
      options=[{label:"First",value:"First"},{label:"Second",value:"Second"}]);
    submit = Button(Text("Save row"),action=Event("updateRows"));
  `, surfaceId))!;
  const f = await fixture({template,sync:true,keep:true});
  const draft = { surface_id:f.payload.message.action.surfaceId, revision:f.payload.revision,
    edits:[{component_id:'selection',value:['First']}] };
  for (const edit of [{component_id:'selection',instance_path:'/1',value:['First']},
    {component_id:'submit',instance_path:'/1',value:['First']}, {component_id:'selection',value:['Unlisted']},
    {component_id:'selection',value:['First'],path:'/rows'}]) {
    expect((await f.send({...f.payload,a2ui_drafts:[{...draft,edits:[edit]}]})).status).toBe(400);
  }
  expect(f.dispatch()).toBe(0);
  const request = {...f.payload,a2ui_drafts:[draft]};
  expect((await f.send(request)).status).toBe(201);
  expect(getMessageByRowId(chat,f.payload.post_id)?.data?.content_blocks?.[0])
    .toMatchObject({revision:2,surface:{dataModel:{rows:['First']}}});
  expect((await f.send(request)).status).toBe(200);
  expect((await f.send({...request,message:{...request.message,action:{...request.message.action,timestamp:'2026-11-22'}}})).status).toBe(400);
  expect((await f.send({...request,a2ui_drafts:[{...draft,edits:[{component_id:'selection',value:['Second']}]}]})).ok).toBe(false);
  expect(f.dispatch()).toBe(1);
});

test('async checks require an accepted result for the exact resolved arguments and login', async () => {
  const [catalogue]=CLASSIC_A2UI_RENDERER_CAPABILITIES['1.0'].supportedCatalogIds;
  const surfaceId='async-check';
  const template=applyA2uiMessages(surfaceId,[{version:'1.0',createSurface:{surfaceId,catalogId:catalogue,dataModel:{value:''},components:[
    {id:'root',component:'Column',children:['field','submit']},
    {id:'field',component:'TextField',label:'Value',value:{'@path':'/value'}},
    {id:'submit',component:'Button',child:'label',action:{event:{name:'save',context:{value:{'@path':'/value'},summary:{'@call':'deriveValue'}},userMessage:{'@call':'deriveValue'}}},
      '@checks':[{condition:{'@call':'checkValue',args:{input:{'@path':'/value'}}},message:'Not verified'}]},
    {id:'label',component:'Text',text:'Save'},
  ]}}],undefined,true)!;
  let calls=0;
  const agent=new A2uiAgentRpc([defineA2uiAgentFunction({catalogue,name:'checkValue',parseArgs:args=>typeof args.input==='string' ? args.input : undefined,
    run(input){calls++;return {valid:input==='hello'};},
  }),defineA2uiAgentFunction({catalogue,name:'deriveValue',parseArgs:()=>null,run:()=> 'Server-derived value'})]);
  const f=await fixture({sync:true,template,agent});
  const {instance_path:_,...payload}=f.payload;
  const rpc=async (functionCallId:string,input:string,session='test-login',field?:string) => handleA2uiRpc(f.channel,new Request('http://test/agent/a2ui-rpc',{method:'POST',
    headers:{'x-test-session':session},body:JSON.stringify({chat_jid:chat,post_id:payload.post_id,thread_id:payload.thread_id,revision:payload.revision,metadata:payload.metadata,
      evaluation_site:field ? a2uiActionEvaluationSite('submit',undefined,field) : undefined,
      message:{version:'1.0',callAgentFunction:{surfaceId:payload.message.action.surfaceId,functionCallId,callFunction:{'@call':field ? 'deriveValue' : 'checkValue',catalogId:catalogue,args:field ? {} : {input}}}},
    }),
  }));
  expect((await f.send(payload)).status).toBe(400);
  expect((await rpc('summary','','test-login','context:summary')).status).toBe(200);
  expect((await rpc('description','','test-login','userMessage')).status).toBe(200);
  const derived={rpc_derived_receipts:{'context:summary':['summary'],userMessage:['description']}};
  expect((await rpc('wrong-input','different')).status).toBe(200);
  expect((await f.send({...payload,...derived,rpc_receipts:['wrong-input']})).status).toBe(400);
  expect((await rpc('other-login','hello','other-login')).status).toBe(200);
  expect((await f.send({...payload,...derived,rpc_receipts:['other-login']})).status).toBe(400);
  expect((await rpc('verified','hello')).status).toBe(200);
  expect((await f.send({...payload,rpc_receipts:['verified'],rpc_derived_receipts:{'context:summary':['description'],userMessage:['summary']}})).status).toBe(400);
  const request={...payload,...derived,rpc_receipts:['verified']};
  expect((await f.send(request)).status).toBe(201);
  expect((await f.send(request)).status).toBe(200);
  expect(f.dispatch()).toBe(1);
  expect(calls).toBe(3);
});

test('wrong chat/thread/action and mutated replay cannot be admitted', async () => {
  const f = await fixture();
  const p = f.payload;
  expect((await f.send({ ...p, chat_jid: 'web:other' })).status).toBe(404);
  expect((await f.send({ ...p, thread_id: p.post_id })).status).toBe(409);
  expect((await f.send({ ...p, message: { ...p.message, action: { ...p.message.action, name: 'login-step2' } } })).status).toBe(400);
  expect(f.dispatch()).toBe(0);
  expect((await f.send()).status).toBe(201);
  expect((await f.send({ ...p, message: { ...p.message, action: { ...p.message.action, context: { note: 'changed' } } } })).status).toBe(409);
  expect(f.dispatch()).toBe(1);
});


test('explicit cancel consumes the revision without admitting or dispatching an input', async () => {
  const f = await fixture({cancel:true});
  expect((await f.send()).status).toBe(200);
  expect(f.dispatch()).toBe(0);
  const block = getMessageByRowId(chat, f.payload.post_id)?.data?.content_blocks?.[0];
  expect(block).toMatchObject({ state:'cancelled', revision:2 });
  expect((await f.send()).status).toBe(200);
  expect((await f.send({...f.payload, request_id:crypto.randomUUID()})).status).toBe(409);
});

test('keep-active requires a new revision and still admits each action at most once', async () => {
  const f = await fixture({keep:true});
  expect((await f.send()).status).toBe(201);
  expect((await f.send()).status).toBe(200);
  expect((await f.send({...f.payload, request_id:crypto.randomUUID()})).status).toBe(409);
  expect((await f.send({...f.payload, revision:2, request_id:crypto.randomUUID()})).status).toBe(201);
  expect(f.dispatch()).toBe(2);
  expect(getMessageByRowId(chat, f.payload.post_id)?.data?.content_blocks?.[0]).toMatchObject({state:'active',revision:3});
});
