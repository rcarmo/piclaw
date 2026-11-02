import { afterEach, expect, test } from 'bun:test';
import { WebChannel } from '../../../../src/channels/web.js';
import { QueuedFollowupLifecycleService } from '../../../../src/channels/web/runtime/queued-followup-lifecycle-service.js';
import * as writes from '../../../../src/channels/web/message-write-service.js';
import { createTempWorkspace, setEnv } from '../../../helpers.js';

let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); cleanup = undefined; });

test('only the persisted queue owns follow-ups; obsolete placeholder producer/consumer APIs are absent', () => {
  for (const name of ['queueFollowupPlaceholder', 'replaceQueuedFollowupPlaceholder', 'consumeQueuedFollowupPlaceholder']) {
    expect(name in WebChannel.prototype).toBe(false);
  }
  const lifecycle = new QueuedFollowupLifecycleService();
  expect('placeholderStore' in lifecycle).toBe(false);
  expect('enqueuePlaceholder' in lifecycle).toBe(false);
});

test('outgoing writes have no parallel context factory or placeholder/helper modules', async () => {
  expect('createMessageWriteContext' in writes).toBe(false);
  for (const name of ['messaging/message-write-flows.ts', 'runtime/followup-placeholders.ts']) {
    expect(await Bun.file(new URL(`../../../../src/channels/web/${name}`, import.meta.url)).exists()).toBe(false);
  }
});

test('historical persisted positive rows stay visible without source adoption; removal leaves unrelated history intact', async () => {
  const workspace = createTempWorkspace('piclaw-placeholder-retirement-');
  const restore = setEnv({ PICLAW_WORKSPACE: workspace.workspace, PICLAW_STORE: workspace.store, PICLAW_DATA: workspace.data });
  cleanup = () => { restore(); workspace.cleanup(); };
  const db = await import('../../../../src/db.js');
  db.initDatabase();
  db.storeChatMetadata('web:history', '2024-01-01T00:00:00.000Z', 'Historical');
  const row = (id: string) => db.storeMessage({ id, chat_jid: 'web:history', sender: 'web-agent', sender_name: 'Pi',
    content: '\u2063', timestamp: '2024-01-01T00:00:00.000Z', is_from_me: false, is_bot_message: true, thread_id: 77 });
  const selected = row('historical-positive'), unrelated = row('historical-unqueued');
  const queued = [{ rowId: selected, queuedContent: 'historical input', queuedAt: '2024-01-01T00:00:00.000Z' },
    { rowId: -12, queuedContent: 'persisted sibling', queuedAt: '2024-01-01T00:00:01.000Z' }];
  db.setDeferredQueuedFollowups('web:history', queued);
  const stored = db.getDeferredQueuedFollowups('web:history');
  const before = db.getTimeline('web:history', 10);
  const lifecycle = new QueuedFollowupLifecycleService();
  expect(lifecycle.getQueuedFollowupCount('web:history')).toBe(2);
  expect(lifecycle.getQueuedFollowupItems('web:history').map(item => item.rowId)).toEqual([selected, -12]);
  expect(lifecycle.listQueuedStateItems('web:history')[0]).toEqual({ row_id: selected, content: 'historical input',
    timestamp: '2024-01-01T00:00:00.000Z', thread_id: 77 });
  expect(db.getDeferredQueuedFollowups('web:history')).toEqual(stored);
  expect(db.getTimeline('web:history', 10)).toEqual(before);
  expect(new QueuedFollowupLifecycleService().getQueuedFollowupItems('web:history')).toEqual(lifecycle.getQueuedFollowupItems('web:history'));
  const result = await lifecycle.removeQueuedFollowupForAction('web:history', selected);
  expect(result.source).toBe('deferred');
  expect(result.removed?.source_id).toBeUndefined();
  expect(db.getMessageByRowId('web:history', selected)).toBeUndefined();
  expect(db.getMessageByRowId('web:history', unrelated)).toEqual(before.find(item => item.id === unrelated));
  expect(db.getDeferredQueuedFollowups('web:history')).toEqual([stored[1]]);
});
