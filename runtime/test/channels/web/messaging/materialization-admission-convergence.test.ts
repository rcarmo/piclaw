import { expect, test } from 'bun:test';
import { materializeDeferredFollowups } from '../../../../src/channels/web/runtime/process-chat-control-runtime.js';

function fixture() {
  const first = { rowId: -1, queuedContent: 'first', queuedAt: '2026-11-02T00:00:00Z' };
  const second = { rowId: -2, queuedContent: 'second', queuedAt: '2026-11-02T00:00:01Z' };
  const rows = [first], events: string[] = [], resumed: number[] = [];
  let written = 0;
  const channel: any = {
    agentPool: {}, peekQueuedFollowupItem: () => rows[0] ?? null,
    storeMessage() { throw Error('synchronous materialization must be retired'); },
    async admitMessage(_chat: string, text: string, bot: boolean, media: number[], options: any, authorise: (phase: string) => void) {
      expect(bot).toBe(false); expect(media).toEqual([]); expect(options.consumeDeferredFollowupRowId).toBe(rows[0]?.rowId);
      authorise('before'); rows.shift(); written++; authorise('after');
      return { id: 42, timestamp: '2026-11-02T00:00:02Z', data: { content: text, thread_id: 42 } };
    },
    broadcastEvent: (type: string, data: any) => events.push(`${type}:${data.content ?? ''}`),
    resumeChat: (_chat: string, row: number) => resumed.push(row),
  };
  return { channel, first, second, rows, events, resumed, written: () => written };
}

test('deferred materialization uses admitted storage without a synchronous alternative', async () => {
  const f = fixture();
  expect(await materializeDeferredFollowups({ channel: f.channel, chatJid: 'web:materialize', agentId: 'default' }))
    .toEqual({ status: 'resumed', rowId: 42 });
  expect(f.written()).toBe(1); expect(f.resumed).toEqual([42]);
  expect(f.events).toEqual(['agent_followup_consumed:first', 'new_post:']);
});

test('a replaced head during writer wait is not materialized from an obsolete payload', async () => {
  const f = fixture(), admit = f.channel.admitMessage.bind(f.channel);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  f.channel.admitMessage = async (...args: any[]) => {
    calls++;
    if (calls === 1) { await held; args[5]('before'); throw Error('obsolete head entered'); }
    return admit(...args);
  };
  const pending = materializeDeferredFollowups({ channel: f.channel, chatJid: 'web:materialize', agentId: 'default' });
  const observed = pending.then(value => ({ value }), error => ({ error }));
  await Bun.sleep(0); f.rows.splice(0, 1, f.second); release();
  expect(await observed).toEqual({ value: { status: 'resumed', rowId: 42 } });
  expect(calls).toBe(2); expect(f.written()).toBe(1);
  expect(f.events).toEqual(['agent_followup_consumed:second', 'new_post:']);
});

test('an unrelated admission error is not swallowed when the queue head independently changes', async () => {
  const f = fixture(), admit = f.channel.admitMessage.bind(f.channel), fault = Error('real source/SQL failure');
  let release!: () => void, calls = 0;
  const held = new Promise<void>(resolve => { release = resolve; });
  f.channel.expireQueuedInput = async () => false;
  f.channel.admitMessage = async (...args: any[]) => {
    if (++calls === 1) { await held; throw fault; }
    return admit(...args);
  };
  const pending = materializeDeferredFollowups({ channel: f.channel, chatJid: 'web:materialize', agentId: 'default' });
  const observed = pending.then(value => ({ value }), error => ({ error }));
  await Bun.sleep(0); f.rows.splice(0, 1, f.second); release();
  expect(await observed).toEqual({ error: fault });
  expect(calls).toBe(1); expect(f.written()).toBe(0); expect(f.events).toEqual([]); expect(f.resumed).toEqual([]);
});

test('a failed secondary expiry check cannot replace the original admission failure', async () => {
  const f = fixture(), primary = Error('original admission failure'), secondary = Error('expiry check unavailable');
  let checks = 0;
  f.channel.expireQueuedInput = async () => { if (++checks === 2) throw secondary; return false; };
  f.channel.admitMessage = async () => { throw primary; };
  const observed = await materializeDeferredFollowups({ channel: f.channel, chatJid: 'web:materialize', agentId: 'default' })
    .then(() => null, error => error);
  expect(observed).toBe(primary); expect(checks).toBe(2); expect(f.events).toEqual([]); expect(f.written()).toBe(0);
});

for (const accepted of [false, true]) test(`missing committed row cannot spend a retry counter or discard queued input; accepted ${accepted}`, async () => {
  const f = fixture();
  f.rows[0] = { ...f.first, materializeRetries: 100, ...(accepted ? { source_accepted: true, source_id: 'original-accepted' } : {}) } as any;
  const before = structuredClone(f.rows);
  f.channel.admitMessage = async () => null;
  f.channel.consumeQueuedFollowupItem = () => f.rows.shift();
  f.channel.replaceQueuedFollowupItem = (_chat: string, item: any) => { f.rows[0] = item; return true; };
  await expect(materializeDeferredFollowups({ channel: f.channel, chatJid: 'web:materialize', agentId: 'default' })).rejects.toThrow('committed row');
  expect(f.rows).toEqual(before); expect(f.events).toEqual([]); expect(f.resumed).toEqual([]);
});
