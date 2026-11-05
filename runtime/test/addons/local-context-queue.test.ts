import { expect, test } from 'bun:test';
import { getDb, storeChatMetadata, closeDatabase, initDatabase } from '../../src/db.js';
import { ensureChatBranch } from '../../src/db/chat-branches.js';
import { withChatContext } from '../../src/core/chat-context.js';
import { addonLocalContextApi as api, withAddonLocalPrompt, withVerifiedAddonMessage } from '../../src/addons/local-context.js';
import { bindAddonLocalDispatchRequest, getAddonLocalDispatchBlock, withAddonLocalDispatch } from '../../src/addons/local-dispatch.js';
import { admitWebMessage } from '../../src/channels/web/messaging/message-store.js';
import { withTempWorkspaceEnv } from '../helpers.js';
import type { NewMessage } from '../../src/types.js';

test('accepted public follow-up cannot inherit the prior verified add-on scope', async () => {
  await withTempWorkspaceEnv('local-context-followup-', {}, async () => {
    await closeDatabase(); initDatabase();
    const chat = 'web:queue-target';
    storeChatMetadata(chat, new Date().toISOString());
    const target = ensureChatBranch({ chat_jid: chat, agent_name: 'queue-target' });
    const reference = { addonId: 'code-review', intentId: 'queue-1' } as const;
    let marker: unknown;
    await withAddonLocalDispatch({ chatJid: chat, incarnation: target.branch_id }, 'Read addon dispatch', reference, async () => {
      const request = new Request('http://internal/');
      bindAddonLocalDispatchRequest(request, chat, 'Read addon dispatch');
      marker = getAddonLocalDispatchBlock(request, chat, 'Read addon dispatch');
    });
    const accept = async (content: string, blocks?: unknown[]): Promise<NewMessage> => {
      const row = await admitWebMessage({ broadcastEvent() {} }, { chatJid: chat, content, isBot: false, mediaIds: [], agentId: 'default', agentName: 'Fixture' }, { contentBlocks: blocks });
      expect(row).not.toBeNull();
      return { id: (getDb().query('SELECT id FROM messages WHERE rowid=?').get(row!.id) as { id: string }).id,
        chat_jid: chat, sender: 'local', content, content_blocks: blocks, timestamp: row!.timestamp };
    };
    try {
      const first = await accept('Read addon dispatch', [marker]);
      let second: NewMessage | undefined;
      await withChatContext(chat, 'web', () => withVerifiedAddonMessage(chat, first, async () => {
        expect(api.getToolContext()).toBeNull();
        await withAddonLocalPrompt(chat, true, async () => {
          expect(api.getToolContext()).toMatchObject({ actorId: target.branch_id, chatJid: chat, chatIncarnation: target.branch_id, reference });
          second = await accept('ordinary public next message');
          expect(api.getToolContext()?.reference).toEqual(reference);
        });
        await withAddonLocalPrompt(chat, true, async () => expect(api.getToolContext()).toBeNull());
      }));
      expect(second!.content_blocks).toBeUndefined();
      await withChatContext(chat, 'web', () => withVerifiedAddonMessage(chat, second!, async () => {
        expect(api.getToolContext()).toBeNull();
        await withAddonLocalPrompt(chat, true, async () => expect(api.getToolContext()).toBeNull());
      }));
      await withChatContext(chat, 'web', () => withVerifiedAddonMessage(chat, first, async () => {
        await withAddonLocalPrompt(chat, true, async () => expect(api.getToolContext()?.reference).toEqual(reference));
        await withAddonLocalPrompt(chat, true, async () => expect(api.getToolContext()).toBeNull());
      }));
    } finally { await closeDatabase(); }
  });
});
