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

test('generic content-block APIs cannot install host or agent surface authority', () => {
  const blocks = [{type:'a2ui_surface', owner:'agent'}, {type:'a2ui_surface', owner:'login'}, {type:'a2ui_surface_removed'}, {type:'text', text:'OK'}];
  expect(sanitizeModelPostedContentBlocks(blocks)).toEqual([blocks[3]]);
  expect(sanitizePublicInboundContentBlocks(blocks)).toEqual([blocks[3]]);
});
