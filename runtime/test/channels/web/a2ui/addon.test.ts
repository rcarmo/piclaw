import '../../../helpers.ts';
import { expect, test } from 'bun:test';
import { getMessageByRowId, initDatabase, storeMessage } from '../../../../src/db.js';
import { publishAddonA2ui, setAddonA2uiPostAdmission } from '../../../../src/channels/web/a2ui/addon.js';
import { handleA2uiAction } from '../../../../src/channels/web/a2ui/admission.js';
import { buildA2uiAction } from '../../../../src/channels/web/a2ui/action.js';
import { isA2uiSurfaceBlock } from '../../../../src/channels/web/a2ui/surface.js';
import type { WebChannelLike } from '../../../../src/channels/web/core/web-channel-contracts.js';

test('bound add-on callbacks cannot be selected by forged event context and are consumed once per source', async () => {
  initDatabase();
  setAddonA2uiPostAdmission(async (chatJid, content, block) => storeMessage({ id: crypto.randomUUID(), sender: 'assistant', chat_jid: chatJid,
    content, content_blocks: [block], is_bot_message:true, is_from_me:true, timestamp:new Date().toISOString() }));
  try {
    const express = 'root = Button(Text("Launch"),action=Event("launch"))';
    const effects: string[] = [];
    const publish = (chatJid: string) => publishAddonA2ui({ chatJid, express, fallback:'Launch experiment', actions:{ launch: async (context) => {
      expect(context.chatJid).toBe(chatJid);
      effects.push(chatJid);
      await context.sendMessage('Launched');
    } } });
    const a = await publish('web:a'), b = await publish('web:b');
    expect(a).not.toBe(b);
    const read = (chat: string, id: number) => getMessageByRowId(chat,id)?.data?.content_blocks?.find(isA2uiSurfaceBlock);
    const sent: unknown[] = [];
    const channel = { json: (body: unknown, status = 200) => Response.json(body, {status}),
      sendMessage: async (...args: unknown[]) => sent.push(args), interactionBroadcaster: { broadcastInteractionUpdated() {} } } as unknown as WebChannelLike;
    const send = (chatJid: string, rowId: number, action = 'launch') => {
      const block = read(chatJid, rowId)!;
      const message = buildA2uiAction(block.surface, 'root', new Map(), new Date().toISOString());
      message.action.name = action;
      return handleA2uiAction(channel,new Request('http://test/agent/a2ui-action',{method:'POST',body: JSON.stringify({ chat_jid:chatJid,
        post_id:rowId,thread_id:rowId,revision:1,request_id:crypto.randomUUID(),message })}));
    };
    expect((await send('web:a', a, 'another-addon')).status).toBe(400);
    const result = await Promise.all([send('web:a',a),send('web:a',a),send('web:b',b)]);
    expect(result.map(r=>r.status).sort()).toEqual([200,200,409]);
    expect(effects.sort()).toEqual(['web:a','web:b']);
    expect(sent).toContainEqual(['web:a','Launched',{threadId:a}]);
    expect(sent).toContainEqual(['web:b','Launched',{threadId:b}]);
    expect(read('web:a',a)).toMatchObject({ state:'completed', revision:2 });
  } finally { setAddonA2uiPostAdmission(undefined); }
});
