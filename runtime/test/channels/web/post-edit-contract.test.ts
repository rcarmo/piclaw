import '../../helpers.js';
import { expect, test } from 'bun:test';
import { withTempWorkspaceEnv } from '../../helpers.js';
import { WebChannel } from '../../../src/channels/web.js';
import * as db from '../../../src/db.js';
import * as messages from '../../../src/db/messages.js';

const chat = 'web:post-edit-contract';
function fixture(branchless = false) {
  db.closeDatabase(); db.initDatabase();
  if (branchless) db.getDb().query('INSERT INTO chats(jid) VALUES (?)').run(chat);
  else db.storeChatMetadata(chat, '2026-01-01T00:00:00Z');
  const id = db.storeMessage({ id: 'original-message', chat_jid: chat, sender: 'agent', sender_name: 'Fixture',
    content: 'before', timestamp: '2026-01-01T00:00:00Z', is_bot_message: true, is_from_me: false,
    content_blocks: [{ type: 'text', text: 'old block' }], link_previews: [{ url: 'https://example.invalid/' }], is_terminal_agent_reply: true });
  const channel = new WebChannel({ queue: { enqueue() { throw Error('Edits cannot run model input'); } }, agentPool: {} } as any);
  const events: unknown[] = [];
  channel.interactionBroadcaster.broadcastInteractionUpdated = row => { expect(db.getDb().inTransaction).toBe(false); events.push(row); };
  return { channel, id, events };
}
const request = (body: unknown, target = chat) => new Request(`http://fixture/post/1?chat_jid=${encodeURIComponent(target)}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

for (const state of ['active', 'archived', 'branchless'] as const) test(`golden: content/thread edit preserves HTTP/display contract for ${state} history`, () =>
  withTempWorkspaceEnv('post-edit-golden-', {}, async () => {
    const f = fixture(state === 'branchless');
    if (state === 'archived') db.getDb().query('UPDATE chat_branches SET archived_at=? WHERE chat_jid=?').run('2026-01-02', chat);
    try {
      const response = await f.channel.handleUpdatePost(request({ content: 'after', thread_id: f.id }), f.id);
      expect(response.status).toBe(200); expect(await response.json()).toEqual({ status: 'ok', ok: true, id: f.id });
      const row = db.getMessageByRowId(chat, f.id)!;
      expect(row.data).toMatchObject({ content: 'after', thread_id: f.id, is_terminal_agent_reply: true });
      expect(row.data.content_blocks).toBeUndefined(); expect(row.data.link_previews).toBeUndefined();
      expect(f.events).toEqual([row]);
      expect(db.getDb().query('SELECT id FROM messages WHERE rowid=?').get(f.id)).toEqual({ id: 'original-message' });
      if (state === 'branchless') expect(db.getChatBranchByChatJid(chat)).toBeNull();
    } finally { db.closeDatabase(); }
  }));

test('golden: annotations set/clear and body chat precedence retain response shapes', () =>
  withTempWorkspaceEnv('post-annotation-golden-', {}, async () => {
    const f = fixture(), annotations = [{ id: 'highlight', ranges: [1, 4], colour: '#f80' }];
    try {
      const response = await f.channel.handleUpdatePostAnnotations(request({ annotations, chat_jid: chat }, 'web:wrong'), f.id);
      expect(response.status).toBe(200); expect(await response.json()).toEqual({ status: 'ok', ok: true, id: f.id, annotations });
      expect(messages.getMessageAnnotations(chat, f.id)).toEqual(annotations);
      const cleared = await f.channel.handleUpdatePostAnnotations(request({ annotations: [] }), f.id);
      expect(await cleared.json()).toEqual({ status: 'ok', ok: true, id: f.id, annotations: [] });
      expect(messages.getMessageAnnotations(chat, f.id)).toBeNull(); expect(f.events).toEqual([]);
      const missing = await f.channel.handleUpdatePost(request({ content: 'must not affect another chat', chat_jid: 'web:wrong' }), f.id);
      expect(missing.status).toBe(404); expect(db.getMessageByRowId(chat, f.id)!.data.content).toBe('before');
    } finally { db.closeDatabase(); }
  }));

test('golden: malformed edits retain validation errors without mutations', () =>
  withTempWorkspaceEnv('post-validation-golden-', {}, async () => {
    const f = fixture(), before = db.getDb().serialize();
    try {
      for (const body of [{}, { content: 3 }, { content: 'x'.repeat(102401) }, { content: 'new', thread_id: 0 }]) {
        expect((await f.channel.handleUpdatePost(request(body), f.id)).status).toBe(400);
      }
      for (const body of [{}, { annotations: 3 }, { annotations: Array(201).fill({}) }]) {
        expect((await f.channel.handleUpdatePostAnnotations(request(body), f.id)).status).toBe(400);
      }
      expect(db.getDb().serialize()).toEqual(before); expect(f.events).toEqual([]);
    } finally { db.closeDatabase(); }
  }));

for (const annotations of [false, true]) test(`row identity changed while JSON is pending cannot be adopted: annotations ${annotations}`, () =>
  withTempWorkspaceEnv('post-row-fence-', {}, async () => {
    const f = fixture(), req = request(annotations ? { annotations: [{ id: 'new' }] } : { content: 'wrong new row' });
    const json = req.json.bind(req);
    req.json = async () => { db.getDb().query('UPDATE messages SET id=? WHERE rowid=?').run('replacement-message', f.id); return json(); };
    try {
      const outcome = await (annotations ? f.channel.handleUpdatePostAnnotations(req, f.id) : f.channel.handleUpdatePost(req, f.id)).catch(error => error);
      expect(outcome).toBeInstanceOf(Error);
      expect(db.getMessageByRowId(chat, f.id)!.data.content).toBe('before');
      expect(messages.getMessageAnnotations(chat, f.id)).toBeNull(); expect(f.events).toEqual([]);
    } finally { db.closeDatabase(); }
  }));

test('post mutation context/factory and default-database write aliases are retired', async () => {
  const factory = await Bun.file(new URL('../../../src/channels/web/endpoints/channel-endpoint-context-factory.ts', import.meta.url)).text();
  expect(factory).not.toContain('postMutations');
  for (const key of ['updateMessagePost', 'setMessageThreadId', 'updateMessageAnnotations']) expect(messages).not.toHaveProperty(key);
});
