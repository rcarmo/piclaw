import '../../helpers.js';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { initDatabase, closeDatabase, getDb } from '../../../src/db.js';
import { admitWebMessage } from '../../../src/channels/web/messaging/message-store.js';
import { handlePost } from '../../../src/channels/web/handlers/posts.js';

beforeEach(() => initDatabase());
afterEach(async () => { await closeDatabase(); });

// HTTP/storage seam only. SDK placement and source identity use real native suites.
function fixture(uncertain = false) {
  const dispatches: unknown[][] = [], events: string[] = [];
  const channel: any = {
    agentPool: {}, json: (body: unknown, status = 200) => Response.json(body, { status }),
    getInputSourceAdmission: () => () => {},
    admitMessage: (chat: string, content: string, isBot: boolean, media: number[], options: any, authorise: any, signal: AbortSignal) =>
      admitWebMessage(channel, { chatJid: chat, content, isBot, mediaIds: media, agentId: 'default', agentName: 'Fixture' }, options, authorise, signal),
    dispatchAcceptedInput: async (...args: unknown[]) => {
      dispatches.push(args); if (uncertain) throw Error('SDK acknowledgement unavailable');
      return { submission_id: 17, queued: false };
    },
    broadcastEvent: (type: string) => events.push(type),
    resumeChat() { throw Error('Post must never wake a host worker'); },
  };
  const post = (body: unknown, reply = false) => handlePost(channel, new Request('https://fixture/post' + (reply ? '/reply' : ''), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), reply, 'web:default');
  return { channel, dispatches, events, post };
}

for (const reply of [false, true]) test(`post forwards its exact persisted identity to the SDK; reply=${reply}`, async () => {
  const f = fixture();
  const parent = reply ? await f.channel.admitMessage('web:default', 'Parent', false, [], {}) : undefined;
  const response = await f.post({ content: 'hello', ...(reply ? { thread_id: parent.id } : {}) }, reply);
  expect(response.status).toBe(201);
  const body = await response.json();
  const stored = getDb().query("SELECT rowid,id FROM messages WHERE content='hello'").get() as { rowid: number; id: string };
  expect(f.dispatches).toEqual([['web:default', stored.id, stored.rowid, 'followUp']]);
  expect(body).toMatchObject({ id: stored.rowid, created: true, submission_id: 17, thread_id: parent?.id ?? stored.rowid, data: { content: 'hello' } });
  expect(f.events).toEqual(['new_post']);
});

test('post keeps its saved-source uncertainty receipt and never resubmits or publishes an unproven input', async () => {
  const f = fixture(true), response = await f.post({ content: 'saved once' });
  expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ accepted: true });
  expect(f.dispatches).toHaveLength(1); expect(f.events).toEqual([]);
  expect(getDb().query("SELECT count(*) n FROM messages WHERE content='saved once'").get()).toEqual({ n: 1 });
});
