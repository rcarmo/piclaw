import '../../../helpers.ts';
import { expect, test } from 'bun:test';
import { getDb, getMessageByRowId, initDatabase } from '../../../../src/db.js';
import { admitWebMessage } from '../../../../src/channels/web/messaging/message-store.js';
import { handleA2uiAction } from '../../../../src/channels/web/a2ui/admission.js';
import { publishAgentA2ui } from '../../../../src/channels/web/a2ui/publish.js';
import { projectA2uiAgentInput, readA2uiRendererDataModel, storeA2uiInputMetadata } from '../../../../src/channels/web/a2ui/input-metadata.js';
import { applyA2uiMessages, compileA2uiExpress } from '../../../../src/channels/web/a2ui/express.js';
import { buildA2uiAction, type A2uiActionRequest } from '../../../../src/channels/web/a2ui/action.js';
import type { A2uiSnapshot } from '../../../../src/channels/web/a2ui/surface.js';
import type { WebChannelLike } from '../../../../src/channels/web/core/web-channel-contracts.js';

const chat = 'web:a2ui-test';
const snapshot = applyA2uiMessages('form', compileA2uiExpress('$/value = ""; root = Column([TextField(label="Note",value=$/value), submit]); submit = Button(Text("Save"),action=Event("save", {note:$/value}))', 'form'))!;

async function fixture(options: { keep?: boolean; cancel?: boolean; template?: A2uiSnapshot; sync?: boolean } = {}) {
  let surface = options.template ?? (options.cancel ? applyA2uiMessages("form", compileA2uiExpress('root = Button(Text("Cancel"), action=Event("cancel"))', "form"))! : snapshot);
  initDatabase();
  let dispatch = 0;
  const updates: number[] = [];
  const admit: WebChannelLike['admitMessage'] = (chatJid, content, isBot, mediaIds, opts, authority, signal) =>
    admitWebMessage({} as any, { chatJid, agentId: 'default', agentName: 'Pi', content, isBot, mediaIds }, opts, authority, signal);
  const channel = {
    json: (body: unknown, status = 200) => Response.json(body, {status}),
    agentPool: {},
    broadcastEvent: () => {},
    interactionBroadcaster: { broadcastInteractionUpdated: (row: {id: number}) => updates.push(row.id) },
    getInputSourceAdmission: (chatJid: string): ReturnType<NonNullable<WebChannelLike['getInputSourceAdmission']>> => (stored, renderer) => {
      if (!options.sync || !renderer) return;
      const conversationId = 31;
      storeA2uiInputMetadata(stored.database, {chatJid,sourceId:stored.message.id,conversationId},
        readA2uiRendererDataModel(stored.database,chatJid,conversationId,renderer.editedSurface));
    },
    dispatchAcceptedInput: async () => ({ submission_id: ++dispatch, queued: false }),
    admitMessage: admit,
  } as unknown as WebChannelLike;
  const root = (await admit(chat, 'Form thread', false, [], {}))!;
  const source = options.sync ? await (async () => {
    const sync = await publishAgentA2ui({root:getDb(),chatJid:chat,conversationId:31,thread:() => root.id,authorise:() => {}}, {
      fallback:'Synced form',keep_active:options.keep,messages:[{version:'1.0',createSurface:{...surface,sendDataModel:true,
        dataModel:{...surface.dataModel,onlyInModel:'Full model'}}}],
    });
    const post = getMessageByRowId(chat,sync.rowId)!;
    surface = (post.data!.content_blocks![0] as {surface:A2uiSnapshot}).surface;
    return post;
  })() : (await admit(chat, 'Form fallback', true, [], { threadId: root.id, contentBlocks: [{
    type: 'a2ui_surface', revision: 1, state: 'active', fallback_text: 'Form fallback', owner: 'agent', surface, ...(options.keep ? {submit_behavior:'keep_active'} : {}),
  }] }))!;
  const instance_path = options.template ? '/1' : undefined;
  const payload: A2uiActionRequest = { chat_jid: chat, post_id: source.id, thread_id: root.id, revision: 1, instance_path,
    request_id: crypto.randomUUID(), message: buildA2uiAction(surface, options.cancel ? 'root' : 'submit', new Map([['/value', 'hello']]), new Date().toISOString(), instance_path) };
  const send = (data = payload) => handleA2uiAction(channel, new Request('http://test/agent/a2ui-action', { method: 'POST', body: JSON.stringify(data) }));
  return { channel, payload, send, updates, dispatch: () => dispatch };
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
