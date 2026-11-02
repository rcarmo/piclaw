import { describe, expect, test } from "bun:test";

import { initDatabase, getDb, closeDatabase, createMedia } from '../../../../src/db.js';
import { withTempWorkspaceEnv } from '../../../helpers.js';
import {
  WebMessageProcessingStorageService,
  type WebMessageProcessingStorageChannel,
} from "../../../../src/channels/web/messaging/message-processing-storage-service.js";

describe("WebMessageProcessingStorageService", () => {
  test("delegates processChat and normalizes null thread roots to undefined", async () => {
    const calls: Array<{ chatJid: string; agentId: string; threadRootId?: number }> = [];
    const service = new WebMessageProcessingStorageService(
      {
        pendingLinkPreviews: new Set<number>(),
        broadcastEvent: () => {},
      } as unknown as WebMessageProcessingStorageChannel,
      {
        defaultAgentId: "default",
        getAssistantName: () => "Pi",
        processChat: async (_channel, chatJid, agentId, threadRootId) => {
          calls.push({
            chatJid,
            agentId,
            ...(threadRootId !== undefined ? { threadRootId } : {}),
          });
        },
      },
    );

    await service.processChat("web:default", "agent-a", null);
    await service.processChat("web:branch", "agent-b", 77);

    expect(calls).toEqual([
      { chatJid: "web:default", agentId: "agent-a" },
      { chatJid: "web:branch", agentId: "agent-b", threadRootId: 77 },
    ]);
  });

  test("admission resolves live identity getters and persists options through the real writer", () =>
    withTempWorkspaceEnv('storage-identity-', {}, async () => {
      initDatabase(); let assistant = 'Pi', user = 'Operator';
      const service = new WebMessageProcessingStorageService({ broadcastEvent() {} } as any, {
        defaultAgentId: 'chosen', getAssistantName: () => assistant, getUserName: () => user, processChat: async () => {},
      });
      try {
        const media = createMedia('identity.txt', 'text/plain', new TextEncoder().encode('identity attachment'));
        const bot = await service.admitMessage('web:identity', 'hello', true, [media], {
          contentBlocks: [{ type: 'text', text: 'identity' }], threadId: 42, isTerminalAgentReply: true, isSteeringMessage: true,
        });
        assistant = 'Pi Prime'; user = 'Operator Two';
        const next = await service.admitMessage('web:identity', 'follow-up', false, [], {});
        const later = await service.admitMessage('web:identity', 'later', true, [], {});
        expect(bot!.data.agent_id).toBe('chosen'); expect(bot!.data.thread_id).toBe(42);
        expect(bot!.data.content_blocks).toEqual([{ type: 'text', text: 'identity' }]); expect(bot!.data.media_ids).toContain(media);
        expect(next!.data.thread_id).toBe(next!.id);
        expect(getDb().query('SELECT sender_name FROM messages ORDER BY rowid').all()).toEqual([
          { sender_name: 'Pi' }, { sender_name: 'Operator Two' }, { sender_name: 'Pi Prime' },
        ]);
        expect(getDb().query('SELECT is_terminal_agent_reply,is_steering_message FROM messages WHERE rowid=?').get(bot!.id))
          .toEqual({ is_terminal_agent_reply: 1, is_steering_message: 1 });
        expect(later!.id).toBeGreaterThan(next!.id);
      } finally { closeDatabase(); }
    }));
});
