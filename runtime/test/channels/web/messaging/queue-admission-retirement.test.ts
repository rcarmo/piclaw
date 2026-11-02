import '../../../helpers.js';
import { expect, test } from 'bun:test';
import { withTempWorkspaceEnv } from '../../../helpers.js';
import { WebChannel } from '../../../../src/channels/web.js';
import { QueuedFollowupLifecycleService } from '../../../../src/channels/web/runtime/queued-followup-lifecycle-service.js';
import { closeDatabase, getDb, initDatabase, getDeferredQueuedFollowups, setDeferredQueuedFollowups, storeChatMetadata, storeMessage } from '../../../../src/db.js';

const chat = 'web:queue-admission-contract';
function fixture(active = true) {
  initDatabase(); const events: string[] = []; let jobs = 0;
  const channel = new WebChannel({ queue: { enqueue() { jobs++; } },
    agentPool: { isActive: () => active, isStreaming: () => active, getContextUsageForChat: async () => null } } as any);
  channel.broadcastEvent = event => { events.push(event); };
  return { channel, events, jobs: () => jobs };
}
const request = (mode = 'auto', content = 'ordinary input') => new Request('http://fixture/agent/default/message', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, mode }),
});

for (const active of [false, true]) for (const mode of ['auto', 'queue']) test(`golden: active ${active} mode ${mode} has one queue-or-timeline acceptance`, () =>
  withTempWorkspaceEnv('queue-route-golden-', {}, async () => {
    const f = fixture(active);
    try {
      const response = await f.channel.handleAgentMessage(request(mode), '/agent/default/message');
      expect(response.status).toBe(201);
      expect(getDeferredQueuedFollowups('web:default')).toHaveLength(active ? 1 : 0);
      expect(getDb().query('SELECT count(*) n FROM messages').get()).toEqual({ n: active ? 0 : 1 });
      expect(f.jobs()).toBe(active ? 0 : 1);
      expect(f.events).toEqual([active ? 'agent_followup_queued' : 'new_post']);
    } finally { closeDatabase(); }
  }));

test('golden: the queue admission port is captured before JSON can replace it', () =>
  withTempWorkspaceEnv('queue-port-capture-', {}, async () => {
    const f = fixture(), req = request(); const json = req.json.bind(req);
    let replacements = 0;
    req.json = async () => { f.channel.admitQueuedFollowupItem = async () => { replacements++; throw Error('replacement'); }; return json(); };
    try {
      expect((await f.channel.handleAgentMessage(req, '/agent/default/message')).status).toBe(201);
      expect(replacements).toBe(0); expect(f.channel.getQueuedFollowupCount('web:default')).toBe(1);
      expect(getDb().query('SELECT count(*) n FROM messages').get()).toEqual({ n: 0 });
    } finally { closeDatabase(); }
  }));

test('missing queued admission rejects without invoking the synchronous enqueue fallback', () =>
  withTempWorkspaceEnv('queue-no-fallback-', {}, async () => {
    const f = fixture(); let raw = 0;
    Object.defineProperty(f.channel, 'admitQueuedFollowupItem', { value: undefined });
    f.channel.enqueueQueuedFollowupItem = () => { raw++; return -123; };
    try {
      expect((await f.channel.handleAgentMessage(request(), '/agent/default/message')).status).toBe(503);
      expect(raw).toBe(0); expect(getDeferredQueuedFollowups('web:default')).toEqual([]);
      expect(f.events).toEqual([]); expect(f.jobs()).toBe(0);
    } finally { closeDatabase(); }
  }));

test('destructive queue pop/prepend/raw-remove APIs are absent from channel and owner', () => {
  for (const method of ['consumeQueuedFollowupItem', 'prependQueuedFollowupItem', 'removeQueuedFollowupItem']) {
    expect(WebChannel.prototype).not.toHaveProperty(method);
    expect(QueuedFollowupLifecycleService.prototype).not.toHaveProperty(method);
  }
});

test('golden: historical positive/negative queue rows and accepted input survive reads and refused removal unchanged', () =>
  withTempWorkspaceEnv('queue-history-readers-', {}, async () => {
    const f = fixture(); storeChatMetadata(chat, '2026-01-01T00:00:00Z');
    const historical = storeMessage({ id: 'historical-queue-row', chat_jid: chat, sender: 'agent', sender_name: 'Fixture',
      content: '\u2063', timestamp: '2026-01-01T00:00:00Z', is_bot_message: true, is_from_me: true });
    const items = [{ rowId: historical, queuedContent: 'historical visible payload', queuedAt: '2026-01-01T00:00:00Z', materializeRetries: 9 },
      { rowId: -7, queuedContent: 'accepted payload', queuedAt: '2026-01-01T00:00:01Z', source_accepted: true as const, source_id: 'accepted-original' }];
    setDeferredQueuedFollowups(chat, items); const before = getDb().serialize();
    try {
      expect(f.channel.getQueuedFollowupItems(chat).map(item => item.rowId)).toEqual([historical, -7]);
      expect(f.channel.queuedFollowupLifecycle.listQueuedStateItems(chat).map(item => item.content)).toEqual(items.map(item => item.queuedContent));
      await expect(f.channel.queuedFollowupLifecycle.removeQueuedFollowupForAction(chat, -7)).rejects.toThrow('host cancellation');
      expect(getDb().serialize()).toEqual(before);
      expect(getDeferredQueuedFollowups(chat)[1]!.source_id).toBe('accepted-original');
    } finally { closeDatabase(); }
  }));
