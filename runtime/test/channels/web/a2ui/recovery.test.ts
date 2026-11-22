import '../../../helpers.ts';
import { expect, test } from 'bun:test';
import { initDatabase, getDb, getMessageByRowId, storeMessage } from '../../../../src/db.js';
import { admitWebMessage } from '../../../../src/channels/web/messaging/message-store.js';
import { buildRecoverySurface } from '../../../../src/channels/web/a2ui/recovery.js';
import { handleA2uiAction } from '../../../../src/channels/web/a2ui/admission.js';
import { buildA2uiAction } from '../../../../src/channels/web/a2ui/action.js';
import type { WebChannelLike } from '../../../../src/channels/web/core/web-channel-contracts.js';

for (const id of ['continue', 'retry'] as const) test(`recovery ${id} admits one new input on the exact failed thread`, async () => {
  initDatabase();
  const chat = `web:recovery-${id}`;
  const store = (params: Partial<Parameters<typeof storeMessage>[0]>) => storeMessage({ id:crypto.randomUUID(), chat_jid:chat,
    content:'fixture', timestamp:new Date().toISOString(), sender:'fixture', is_from_me:false, ...params });
  const thread = store({ is_bot_message:false });
  const block = buildRecoverySurface();
  const post = store({ thread_id:thread, is_bot_message:true, is_terminal_agent_reply:true, content_blocks:[block] });
  const dispatch: number[] = [];
  const channel = { json: (data: unknown, status=200)=>Response.json(data,{status}), agentPool:{}, interactionBroadcaster:{broadcastInteractionUpdated(){}},
    broadcastEvent() {}, getInputSourceAdmission:()=>()=>{}, dispatchAcceptedInput:async(_chat:string,_msg:string,row:number)=>{ dispatch.push(row);return {submission_id:row, queued:false}; },
    admitMessage: (chatJid:string,content:string,isBot:boolean,mediaIds:number[],options:any,authorise:any,signal:any) =>
      admitWebMessage({} as any, {chatJid,content,isBot,mediaIds,agentId:'default',agentName:'Pi'}, options, authorise, signal),
  } as unknown as WebChannelLike;
  const send = (threadId: number, requestId = crypto.randomUUID()) => handleA2uiAction(channel,new Request('http://test/agent/a2ui-action',{method:'POST',body:JSON.stringify({
    chat_jid:chat, post_id:post, thread_id:threadId, revision:1, request_id:requestId, message:buildA2uiAction(block.surface,id,new Map(),new Date().toISOString()),
  })}));
  expect((await send(post)).status).toBe(409);
  expect((await send(thread)).status).toBe(201);
  expect((await send(thread)).status).toBe(409);
  expect(dispatch).toHaveLength(1);
  const accepted = getDb().query('SELECT content, thread_id FROM messages WHERE rowid = ?').get(dispatch[0]) as {content:string;thread_id:number};
  expect(accepted.thread_id).toBe(thread);
  expect(accepted.content).toContain(id === 'continue' ? 'Continue the previous answer' : 'Retry the previous request cleanly');
  expect(accepted.content).toContain('do not rerun side-effecting tools');
  expect(getMessageByRowId(chat,post)?.data?.content_blocks?.[0]).toMatchObject({state:'completed',revision:2});
});
