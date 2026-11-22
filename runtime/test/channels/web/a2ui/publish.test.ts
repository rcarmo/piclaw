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

test('generic content-block APIs cannot install host or agent surface authority', () => {
  const blocks = [{type:'a2ui_surface', owner:'agent'}, {type:'a2ui_surface', owner:'login'}, {type:'a2ui_surface_removed'}, {type:'text', text:'OK'}];
  expect(sanitizeModelPostedContentBlocks(blocks)).toEqual([blocks[3]]);
  expect(sanitizePublicInboundContentBlocks(blocks)).toEqual([blocks[3]]);
});
