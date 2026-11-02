import '../../../helpers.js';
import { expect, test } from 'bun:test';
import { initDatabase, getDb, closeDatabase, createMedia } from '../../../../src/db.js';
import { withTempWorkspaceEnv } from '../../../helpers.js';
import { WebChannel } from '../../../../src/channels/web.js';
import { IDENTITY_CONFIG } from '../../../../src/core/config-identity.js';

test('WebChannel admission resolves live identity and persists options through the real writer', () =>
  withTempWorkspaceEnv('storage-identity-', {}, async () => {
    initDatabase(); const identity = { ...IDENTITY_CONFIG };
    const channel = new WebChannel({ queue: { enqueue() {} }, agentPool: {} } as any);
    Object.assign(IDENTITY_CONFIG, { assistantName: 'Pi', userName: 'Operator' });
    try {
      const media = createMedia('identity.txt', 'text/plain', new TextEncoder().encode('identity attachment'));
      const bot = await channel.admitMessage('web:identity', 'hello', true, [media], {
        contentBlocks: [{ type: 'text', text: 'identity' }], threadId: 42, isTerminalAgentReply: true, isSteeringMessage: true,
      });
      Object.assign(IDENTITY_CONFIG, { assistantName: 'Pi Prime', userName: 'Operator Two' });
      const next = await channel.admitMessage('web:identity', 'follow-up', false, [], {});
      const later = await channel.admitMessage('web:identity', 'later', true, [], {});
      expect(bot!.data.agent_id).toBe('default'); expect(bot!.data.thread_id).toBe(42);
      expect(bot!.data.content_blocks).toEqual([{ type: 'text', text: 'identity' }]); expect(bot!.data.media_ids).toContain(media);
      expect(next!.data.thread_id).toBe(next!.id);
      expect(getDb().query('SELECT sender_name FROM messages ORDER BY rowid').all()).toEqual([
        { sender_name: 'Pi' }, { sender_name: 'Operator Two' }, { sender_name: 'Pi Prime' },
      ]);
      expect(getDb().query('SELECT is_terminal_agent_reply,is_steering_message FROM messages WHERE rowid=?').get(bot!.id))
        .toEqual({ is_terminal_agent_reply: 1, is_steering_message: 1 });
      expect(later!.id).toBeGreaterThan(next!.id);
    } finally { Object.assign(IDENTITY_CONFIG, identity); closeDatabase(); }
  }));
