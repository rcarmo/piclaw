import { isolatedApplicationTest } from './src/isolated-application-test.js';
import './src/test-guard.js';
import { expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { initDatabase, getDb, closeDatabase } from '../../runtime/src/db/connection.js';
import { getDeferredQueuedFollowups, setDeferredQueuedFollowups, storeChatMetadata } from '../../runtime/src/db.js';
import { acquireRuntimeLock } from '../../runtime/src/runtime/single-instance.js';
import { BunSqliteDatabase } from '../../runtime/durable-engine/src/bun-sqlite.js';
import { SqliteStorage } from '../../runtime/durable-engine/qualification/sqlite.ts';
import { applicationOwnership, createApplicationBootstrapBundle } from '../../runtime/durable-engine/src/application-bootstrap.js';
import { installTerminalSettlementCompositionSchema } from '../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js';
import { admitWebMessage } from '../../runtime/src/channels/web/messaging/message-store.js';
import { QueuedFollowupLifecycleService } from '../../runtime/src/channels/web/runtime/queued-followup-lifecycle-service.js';
import { InMemoryEffectPayloadResolver } from '../../runtime/src/service-effects/testing/in-memory-payload-resolver.js';
import { openFixture, context, barrier } from './src/fixture.js';
const applicationTest = isolatedApplicationTest(import.meta.url);

for (const variant of ['plain', 'thread', 'screen', 'both', 'tampered'] as const) applicationTest(`native queued steering preserves immutable ${variant} metadata`, async () => {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, 'threaded-steering-'));
  const lock = acquireRuntimeLock({ lockPath: join(dir, 'owner.lock'), strictOwnership: true, disabled: false });
  const oldMemory = process.env.PICLAW_DB_IN_MEMORY; process.env.PICLAW_DB_IN_MEMORY = '0'; initDatabase();
  const root = getDb(); root.exec('PRAGMA foreign_keys=ON');
  const path = (root.query('PRAGMA database_list').all() as any[]).find(row => row.name === 'main')!.file;
  const base = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new BunSqliteDatabase(path, { root, assertOwner: () => lock.assertCurrentOwner() })));
  const chat = `web:threaded-steering:${crypto.randomUUID()}`;
  storeChatMetadata(chat, new Date().toISOString());
  const branchId = (root.query('SELECT branch_id FROM chat_branches WHERE chat_jid=?').get(chat) as any).branch_id;
  const conversation = await base.harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: { provider: 'qualification', modelId: 'synthetic' } } }, context);
  await base.close(); installTerminalSettlementCompositionSchema(root);
  const resolver = new InMemoryEffectPayloadResolver();
  const bundle = await createApplicationBootstrapBundle({ root, path, ownership: applicationOwnership(lock),
    manifest: [{ chatJid: chat, branchId, conversationId: conversation.id }], sessions: new Map([[chat, 'real-session']]), offlineInitialize: true,
    answers: { put(ref, text) { resolver.putText(ref, text); }, resolver },
    runtime: { incarnation: `threaded-${variant}`, sessionId: 'runtime', lane: 'main', generation: 1, now: () => new Date().toISOString(),
      harnessOptions: { models: base.models, registry: base.registry } },
  }, context);
  const hold = barrier(), entered = barrier(); base.host.modelHold = hold; base.host.onModelEnter = () => entered.release();
  const projection = { pendingLinkPreviews: new Set<string>(), broadcastEvent() {} };
  let settling: Promise<unknown> | undefined;
  try {
    const ports = bundle.bind({ queue: {} as any, agentPool: {} as any }); bundle.bindInputProjection(projection);
    const stored = await admitWebMessage(projection, { chatJid: chat, content: 'Primary input', isBot: false, mediaIds: [], agentId: 'default', agentName: 'Fixture' },
      { acceptSource: ports.getInputSourceAdmission!(chat) }, () => lock.assertCurrentOwner(), new AbortController().signal);
    expect(stored).not.toBeNull();
    const primary = root.query('SELECT rowid,id FROM messages WHERE chat_jid=? AND content=?').get(chat, 'Primary input') as any;
    settling = bundle.dispatchAcceptedInput(chat, primary.id, primary.rowid)!(); await entered.promise;
    for (let n = 0; n < 1000; n++) {
      if (root.query("SELECT 1 FROM service_effect_s01_operations WHERE chat_jid=? AND phase='executing' AND harness_operation_id IS NOT NULL").get(chat)) break;
      await Bun.sleep(2);
    }
    const threadId = variant === 'screen' || variant === 'plain' ? null : primary.rowid;
    const screenHint = variant === 'thread' || variant === 'plain' ? undefined : 'desktop';
    const followups = new QueuedFollowupLifecycleService();
    const rowId = await followups.admitQueuedFollowupItem(
      [chat, 0, 'STEERING_METADATA_OK', threadId, new Date().toISOString(), { screenHint, mediaIds: [], source: 'web.compose' }],
      () => lock.assertCurrentOwner(), new AbortController().signal, ports.getQueuedInputSourceAdmission!(chat)!);
    expect(rowId).toBeNumber();
    const queuedBefore = getDeferredQueuedFollowups(chat).find(item => item.rowId === rowId)!;
    expect(queuedBefore.threadId).toBe(threadId);
    expect(queuedBefore.screenHint).toBe(screenHint);
    const sourceId = queuedBefore.source_id!;
    const sourceBefore = root.query('SELECT source_id,source_hash,state FROM service_effect_s01_sources WHERE chat_jid=? AND source_id=?').get(chat, sourceId) as any;
    expect(sourceBefore.state).toBe('pending');
    if (variant === 'tampered') {
      const items = getDeferredQueuedFollowups(chat); items[0]!.screenHint = 'mobile'; setDeferredQueuedFollowups(chat, items);
      const queueBefore = getDeferredQueuedFollowups(chat);
      await expect(ports.getAcceptedQueuedSteering!(chat)!.accept(rowId!)).rejects.toThrow('materialization failed');
      expect(getDeferredQueuedFollowups(chat)).toEqual(queueBefore);
      expect(root.query('SELECT source_id,source_hash,state FROM service_effect_s01_sources WHERE chat_jid=? AND source_id=?').get(chat, sourceId)).toEqual(sourceBefore);
      expect(root.query('SELECT 1 FROM messages WHERE id=?').get(sourceId)).toBeNull();
    } else {
      const accepted = await ports.getAcceptedQueuedSteering!(chat)!.accept(rowId!);
      expect(getDeferredQueuedFollowups(chat)).toEqual([]);
      const materialized = root.query('SELECT id,thread_id,screen_hint FROM messages WHERE id=?').get(sourceId) as any;
      expect(materialized.id).toBe(sourceBefore.source_id);
      expect(materialized.screen_hint).toBe(screenHint ?? null);
      expect(materialized.thread_id).toBe(threadId ?? accepted.interaction.id);
      expect(accepted.interaction.data.thread_id).toBe(materialized.thread_id);
      expect(root.query('SELECT source_hash FROM service_effect_s01_sources WHERE chat_jid=? AND source_id=?').get(chat, sourceId)).toEqual({ source_hash: sourceBefore.source_hash });
      await accepted.dispatch();
    }
    base.host.finalContent = [{ type: 'text', text: 'WHOLE_OPERATION_DONE' }]; hold.release();
    expect(await settling).toBe('settled');
    expect(root.query('SELECT content FROM messages WHERE chat_jid=? AND is_bot_message=1').all(chat)).toEqual([{ content: 'WHOLE_OPERATION_DONE' }]);
    expect(base.host.modelCalls).toBe(variant === 'tampered' ? 1 : 2);
    if (variant !== 'tampered') {
      expect(base.host.transcripts[1]).toContain('STEERING_METADATA_OK');
      expect((root.query('SELECT state FROM service_effect_s01_sources WHERE chat_jid=? AND source_id=?').get(chat, sourceId) as any).state).toBe('consumed');
      expect(root.query('SELECT 1 FROM piclaw_durable_intent_bindings_v1 WHERE chat_jid=? AND source_id=? AND submission_id IS NOT NULL').get(chat, sourceId)).not.toBeNull();
    }
    expect(base.host.credentialLookups).toBe(0); expect(base.host.effects).toBe(0);
  } finally { hold.release(); await settling?.catch(() => {}); await bundle.close(); closeDatabase(); lock.release(); process.env.PICLAW_DB_IN_MEMORY = oldMemory; await rm(dir, { recursive: true, force: true }); }
}, 20000);
