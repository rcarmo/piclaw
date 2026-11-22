import '../../../helpers.ts';
import { expect, test } from 'bun:test';
import { getDb, getMessageByRowId, getTimeline, initDatabase, storeMessage } from '../../../../src/db.js';
import { WebChannel } from '../../../../src/channels/web.js';
import { runMessagesTool } from '../../../../src/extensions/messages-crud.js';

const chat = 'web:retired-fixture';
const legacy = [
  {type:'adaptive_card', card_id:'old', fallback_text:'private structured fallback', payload:{seed:'PRIVATE-OLD-SEED'}},
  {type:'adaptive_card_submission', data:{code:'PRIVATE-OLD-SUBMISSION'}},
];

test('old card route is absent and stored history is read as normal text without exposing old blocks', async () => {
  initDatabase();
  const post = storeMessage({id:'legacy',chat_jid:chat,content:'Visible original post text',is_from_me:true,is_bot_message:true,
    sender:'assistant',timestamp:new Date().toISOString(),content_blocks:legacy});
  const web = new WebChannel({ queue: {} as any, agentPool:{} as any });
  const response = await web.handleRequest(new Request('http://test/agent/card-action',{method:'POST',body:JSON.stringify({post_id:post,card_id:'old'})}));
  expect(response.status).toBe(404);
  const row = getMessageByRowId(chat,post);
  expect(row?.data.content).toBe('Visible original post text');
  expect(row?.data.content_blocks ?? []).toEqual([]);
  expect(JSON.stringify(getTimeline(chat,10))).not.toContain('PRIVATE-OLD');
  const message = runMessagesTool({ action:'get', row_ids:[post] }, chat);
  expect(JSON.stringify(message)).toContain('Visible original post text');
  expect(JSON.stringify(message)).not.toContain('PRIVATE-OLD');
  const persisted = getDb().query('SELECT content_blocks FROM messages WHERE chat_jid=? AND rowid=?').get(chat,post);
  expect(persisted).toEqual({content_blocks:JSON.stringify(legacy)});
});
