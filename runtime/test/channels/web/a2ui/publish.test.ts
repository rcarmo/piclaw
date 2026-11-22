import '../../../helpers.ts';
import { expect, test } from 'bun:test';
import { getDb, getMessageByRowId, initDatabase, storeMessage } from '../../../../src/db.js';
import { publishAgentA2ui } from '../../../../src/channels/web/a2ui/publish.js';
import { sanitizeModelPostedContentBlocks, sanitizePublicInboundContentBlocks } from '../../../../src/channels/web/messaging/content-block-safety.js';

test('publishes and edits only an agent-owned surface in its accepted chat/thread', async () => {
  initDatabase();
  const chatJid = 'web:express-publish';
  const threadId = storeMessage({id:'accepted', chat_jid:chatJid, sender:'user', content:'Please make a form', timestamp:new Date().toISOString(), is_from_me:false});
  const options = { root: getDb(), chatJid, authorise: () => {}, thread: () => threadId };
  const { rowId, surfaceId, revision } = await publishAgentA2ui(options, { express:'$/name = "Initial"; root = Text($/name)', fallback:'Name form' });
  const read = () => getMessageByRowId(chatJid, rowId)!;
  expect(read().data?.thread_id).toBe(threadId);
  expect(read().data?.content).toBe('Name form');
  expect(read().data?.content_blocks?.[0]).toMatchObject({ owner:'agent', revision:1, surface:{surfaceId, dataModel:{name:'Initial'}} });
  const patch = { express:'$/name = "Updated"', post_id:rowId, revision };
  await expect(publishAgentA2ui({...options, chatJid:'web:other'}, patch)).rejects.toThrow();
  await expect(publishAgentA2ui({...options, thread:() => threadId + 1}, patch)).rejects.toThrow();
  expect((await publishAgentA2ui(options, patch)).revision).toBe(2);
  expect(read().data?.content_blocks?.[0]).toMatchObject({ revision:2, surface:{dataModel:{name:'Updated'}} });
  await expect(publishAgentA2ui(options, patch)).rejects.toThrow();
  expect((await publishAgentA2ui(options, {...patch, revision:2, express:`deleteSurface("${surfaceId}")`})).deleted).toBe(true);
  expect(read().data?.content_blocks).toEqual([{type:"a2ui_surface_removed",revision:3}]);
  expect(read().data?.content).toBe('Name form');
});

test('publishes v1.0 messages under the same thread and revision checks as Express', async () => {
  initDatabase();
  const chatJid = 'web:wire-publish';
  const threadId = storeMessage({id:'wire-thread', chat_jid:chatJid, sender:'user', content:'Make a list', timestamp:new Date().toISOString(), is_from_me:false});
  const options = { root: getDb(), chatJid, authorise: () => {}, thread: () => threadId };
  const messages = [{version:'1.0', createSurface:{surfaceId:'draft',catalogId:'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
    dataModel:{rows:[{},{}]}, components:[{id:'root',component:'List',children:{componentId:'row',path:'/rows'}},
      {id:'row',component:'Text',text:{'@call':'@index',args:{offset:1}}}],
  }}];
  await expect(publishAgentA2ui(options, {express:'root=Text("Other")', messages, fallback:'Both'})).rejects.toThrow(/one/);
  await expect(publishAgentA2ui(options, {messages:[...messages, {version:'1.0',updateDataModel:{surfaceId:'another',value:{}}}], fallback:'Mixed'})).rejects.toThrow();
  await expect(publishAgentA2ui(options, {messages:[...messages, {version:'1.0',callRendererFunction:{surfaceId:'draft'}}], fallback:'RPC'})).rejects.toThrow();
  const created = await publishAgentA2ui(options, {messages, fallback:'Numbered rows'});
  expect(created.surfaceId).not.toBe('draft');
  expect(messages[0]!.createSurface.surfaceId).toBe('draft');
  expect(getMessageByRowId(chatJid,created.rowId)?.data?.content_blocks?.[0]).toMatchObject({owner:'agent', surface:{surfaceId:created.surfaceId}});
  const update = {post_id:created.rowId, revision:1, messages:[{version:'1.0', updateDataModel:{surfaceId:created.surfaceId, path:'/rows', value:[{}]}}]};
  await expect(publishAgentA2ui({...options, thread: () => threadId + 1}, update)).rejects.toThrow();
  expect((await publishAgentA2ui(options, update)).revision).toBe(2);
  await expect(publishAgentA2ui(options, update)).rejects.toThrow();
});

test('wire publication retains incomplete definitions through independent revisions', async () => {
  initDatabase();
  const chatJid = 'web:progressive-publish';
  const threadId = storeMessage({id:'progress-thread', chat_jid:chatJid, sender:'user', content:'Show a progressive form', timestamp:new Date().toISOString(), is_from_me:false});
  const options = { root: getDb(), chatJid, authorise: () => {}, thread: () => threadId };
  const draft = await publishAgentA2ui(options, {fallback:'Preparing form',messages:[{version:'1.0',createSurface:{
    surfaceId:'draft',catalogId:'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',dataModel:{message:'Fresh'},
  }}]});
  const read = () => getMessageByRowId(chatJid,draft.rowId)?.data?.content_blocks?.[0];
  const update = (revision: number, components: Record<string,unknown>[]) => publishAgentA2ui(options,{post_id:draft.rowId,revision,
    messages:[{version:'1.0',updateComponents:{surfaceId:draft.surfaceId,components}}]});
  expect(read()).toMatchObject({revision:1,surface:{components:[],dataModel:{message:'Fresh'}}});
  await update(1,[{id:'title',component:'Text',text:{'@path':'/message'}}]);
  await expect(update(2,[{id:'cycle',component:'Card',child:'cycle'}])).rejects.toThrow();
  expect(read()).toMatchObject({revision:2,surface:{components:[{id:'title'}]}});
  await update(2,[{id:'root',component:'Column',children:['title','late']}]);
  expect(read()).toMatchObject({revision:3});
  await update(3,[{id:'late',component:'Text',text:'Ready'}]);
  expect(read()).toMatchObject({revision:4,surface:{components:expect.arrayContaining([{id:'late',component:'Text',text:'Ready'}])}});
  await expect(update(3,[{id:'late',component:'Text',text:'Stale'}])).rejects.toThrow();
  // Removing a reference does not destroy its definition; a later revision can reuse it.
  await update(4,[{id:'root',component:'Column',children:['late']}]);
  await update(5,[{id:'root',component:'Column',children:['title','late']}]);
  expect(read()).toMatchObject({revision:6,surface:{components:expect.arrayContaining([{id:'title',component:'Text',text:{'@path':'/message'}}])}});
  const deleted = await publishAgentA2ui(options,{post_id:draft.rowId,revision:6,
    messages:[{version:'1.0',deleteSurface:{surfaceId:draft.surfaceId}}]});
  expect(deleted.deleted).toBe(true);
  expect(read()).toEqual({type:'a2ui_surface_removed',revision:7});
  await expect(update(7,[{id:'late',component:'Text',text:'Cannot revive'}])).rejects.toThrow();
});

test('resolves only explicit known catalogues on a surface with no default', async () => {
  initDatabase();
  const chatJid = 'web:catalogue-publish';
  const threadId = storeMessage({id:'catalogue-thread', chat_jid:chatJid, sender:'user', content:'Show catalogue text', timestamp:new Date().toISOString(), is_from_me:false});
  const options = { root:getDb(), chatJid, authorise:() => {}, thread:() => threadId };
  const basic = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';
  const component = {id:'root',component:'Text',text:{'@call':'formatString',catalogId:basic,args:{value:'Known catalogue'}}};
  const create = (components: unknown[]) => ({fallback:'Catalogue text',messages:[{version:'1.0',createSurface:{surfaceId:'draft',components}}]});
  await expect(publishAgentA2ui(options,create([component]))).rejects.toThrow();
  await expect(publishAgentA2ui(options,create([{...component,'@catalogId':'https://example.test/unknown'}]))).rejects.toThrow();
  await expect(publishAgentA2ui(options,create([{...component,'@catalogId':basic,text:{'@call':'formatString',args:component.text.args}}]))).rejects.toThrow();
  const {rowId,surfaceId} = await publishAgentA2ui(options,create([{...component,'@catalogId':basic}]));
  const patch = (components: unknown[]) => publishAgentA2ui(options,{post_id:rowId,revision:1,
    messages:[{version:'1.0',updateComponents:{surfaceId,components}}]});
  await expect(patch([component])).rejects.toThrow();
  await patch([{...component,'@catalogId':basic,text:'Updated text'}]);
  const block = getMessageByRowId(chatJid,rowId)?.data?.content_blocks?.[0];
  expect(block).toMatchObject({revision:2,surface:{components:[{...component,'@catalogId':basic,text:'Updated text'}]}});
  expect(block).not.toHaveProperty('surface.catalogId');
});

test('generic content-block APIs cannot install host or agent surface authority', () => {
  const blocks = [{type:'a2ui_surface', owner:'agent'}, {type:'a2ui_surface', owner:'login'}, {type:'a2ui_surface_removed'}, {type:'text', text:'OK'}];
  expect(sanitizeModelPostedContentBlocks(blocks)).toEqual([blocks[3]]);
  expect(sanitizePublicInboundContentBlocks(blocks)).toEqual([blocks[3]]);
});
