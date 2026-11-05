import './src/test-guard.js';
import { expect } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isolatedApplicationTest } from './src/isolated-application-test.js';
import { nativeGoalFixture } from './src/native-goal-default-fixture.js';
import { openFixture, context } from './src/fixture.js';
import { Harness, configure, defineTask, defineExtension, InboxDoc, type ConversationId } from '../../runtime/durable-engine/qualification/durable.ts';
import { SqliteStorage } from '../../runtime/durable-engine/qualification/sqlite.ts';
import { BunSqliteDatabase } from '../../runtime/durable-engine/src/bun-sqlite.js';
import { NativeBackgroundContexts, storedBackgroundDocument, backgroundPolicyProvenance } from '../../runtime/durable-engine/src/host-background-context.js';
import { NativeBackgroundPolicyDoc } from '../../runtime/durable-engine/src/host-background-policy.js';
import { createNativeBackgroundPayload, readNativeBackgroundPayload, nativeBackgroundSourceId, nativeBackgroundIdentity, nativeBackgroundPolicyHash } from '../../runtime/src/agent-pool/background-operation-contract.js';
import { getDataDir } from '../../runtime/src/core/config.js';
import { createCurrentPiclawServiceWorkStore } from '../../runtime/src/service-effects/current-piclaw/service-work-store.js';
import { value, sealed, effect } from '../../runtime/durable-engine/src/host-effects.js';
const applicationTest = isolatedApplicationTest(import.meta.url);

for (const state of ['completed', 'task', 'submission', 'source'] as const) applicationTest(`retired A2A context ${state}: preserves data and never resumes unsupported work`, async () => {
  const f = await nativeGoalFixture();
  let harness: Harness | undefined;
  try {
    await f.backend.close();
    const fixture = await openFixture({ acquired: true }); await fixture.close();
    let executions = 0;
    const task = defineTask<null, { phase: 'deliver' }, null>({ name: 'qualification.retired-operation', version: 1,
      initial: () => ({ phase: 'deliver' }),
      phases: { async deliver(_task, runtime, ctx) { executions++; await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed', result: null } }), ctx); } },
      abort: (_task, runtime, ctx) => runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), ctx),
    });
    fixture.registry.install(defineExtension({ name: 'retired-operation-fixture', tasks: [task] }));
    const path = (f.root.query('PRAGMA database_list').all() as { name: string; file: string }[]).find(row => row.name === 'main')!.file;
    const storage = new BunSqliteDatabase(path, { root: f.root, assertOwner: () => f.owner.assertCurrentOwner(), fenceTransactions: true });
    harness = await Harness.open(await SqliteStorage.open(storage), { models: fixture.models, registry: fixture.registry }, context);
    expect((await harness.inspect(context)).scheduling).toBe('paused');
    const model = fixture.models.getModel('qualification', 'synthetic')!;
    const baseline = createNativeBackgroundPayload({ origin: { kind: 'dream', invocationId: 'historical-data', chatJid: 'web:default', mode: 'manual' },
      workId: 'old-private-work', parentWorkId: null, model: { provider: model.provider, modelId: model.id, api: model.api }, allowedTools: [], maxToolCalls: 0,
      acceptedAt: '2026-10-26T15:20:00.000Z', expiresAt: '2026-10-26T15:23:00.000Z', prompt: 'Old private input', instructions: 'Historical private instructions' });
    const origin = { kind: 'addon' as const, operationId: 'retired-a2a-operation', addonId: 'a2a', principalId: 'old-caller', target: 'old-agent', grantRevision: 'old-revision', inputSequence: 1 };
    // Historical data preparation only: no retired constructor/service or SDK table writes.
    const payload = readNativeBackgroundPayload({ ...baseline, policy: { ...baseline.policy, origin, sourceId: nativeBackgroundSourceId(origin) } });
    const identity = nativeBackgroundIdentity(payload.policy);
    const application = f.root.query(`SELECT id FROM documents WHERE kind='"app.application-conversations"' AND owner_id=1 AND retired_at IS NULL`).get() as { id: number };
    const domain = storedBackgroundDocument(f.root, application.id).domain;
    const conversationId = await harness.commit(async tx => {
      const mapping = await tx.doc(NativeBackgroundContexts, 1 as ConversationId);
      const conversation = await tx.createConversation({ ownership: { kind: 'ownerless' } });
      await configure(tx, conversation.id, { model: { provider: model.provider, modelId: model.id }, instructions: payload.instructions, tools: [], extensions: [] });
      const policy = await tx.doc(NativeBackgroundPolicyDoc, conversation.id, payload.policy.sourceId, null);
      policy.sourceId = payload.policy.sourceId; policy.policySha256 = nativeBackgroundPolicyHash(payload.policy);
      mapping.domain = domain; mapping.contexts.push({ contextKey: identity.contextKey, chatJid: identity.chatJid, branchId: identity.branchId, conversationId: conversation.id, sessionId: crypto.randomUUID() });
      return conversation.id;
    }, context);
    const dir = join(getDataDir(), 'durable-answers'); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, createHash('sha256').update(payload.policy.sourceId).digest('hex')), JSON.stringify(payload), { mode: 0o600 });
    if (state === 'task' || state === 'completed') {
      const id = await harness.commit(tx => tx.createTask(task, null, { ownership: { kind: 'conversation' }, conversationId }), context);
      if (state === 'completed') await harness.waitForTask(id, context);
    } else if (state === 'submission') {
      await harness.commit(async tx => {
        const inbox = await tx.doc(InboxDoc, conversationId);
        const submission = await tx.createSubmission({ type: 'input', conversationId, requestId: payload.policy.sourceId, status: 'queued' });
        inbox.items.push({ id: submission.id, mode: 'followUp', content: payload.prompt });
      }, context);
    }
    await harness.close(context); harness = undefined;
    if (state === 'source') {
      const work = value(createCurrentPiclawServiceWorkStore(f.root, { hitFault() { return false; }, recordTrace() {}, validateAcceptance() { return true; } }));
      const provenanceRef = backgroundPolicyProvenance(payload);
      f.root.transaction(() => work.acceptAndClaimSourceInTransaction(sealed({ effect: { ...effect('retired-accept'), provenanceRef }, chatJid: identity.chatJid,
        sourceId: identity.sourceId, kind: 'internal', payloadRef: identity.payloadRef, targetOperationId: null, parentSourceSeq: null, acceptedAt: payload.policy.acceptedAt, createWakeIntent: false }),
      sealed({ effect: { ...effect('retired-claim'), provenanceRef }, chatJid: identity.chatJid, expectedFrontier: 0, newOperationId: identity.operationId, claimedAt: payload.policy.acceptedAt }), f.root)).immediate();
    }
    const tables = ['entries', 'submissions', 'tasks', 'service_effect_s01_sources', 'service_effect_s01_operations'];
    const snapshot = () => tables.map(table => f.root.query(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const before = snapshot(), effects = executions;
    if (state === 'completed') await f.reopen();
    else await expect(f.reopen()).rejects.toThrow('A2A support was removed');
    expect(snapshot()).toEqual(before); expect(executions).toBe(effects); expect(f.calls()).toBe(0);
    expect(executions).toBe(state === 'completed' ? 1 : 0);
  } finally { await harness?.close(context); await f.close(); }
}, 30000);
