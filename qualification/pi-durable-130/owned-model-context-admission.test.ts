import './src/test-guard.js';
import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createProvider, createAssistantMessageEventStream, Type, type AssistantMessage } from '../../runtime/durable-engine/qualification/ai.ts';
import { Harness, defineExtension, defineTool } from '../../runtime/durable-engine/qualification/durable.ts';
import { SqliteStorage } from '../../runtime/durable-engine/qualification/sqlite.ts';
import { OwnedSqlite } from './src/ownership.ts';
import { acceptedSteerFixture } from './src/accepted-steer-recovery-fixture.ts';
import { barrier, context } from './src/fixture.ts';
import { createHostModelTools } from '../../runtime/durable-engine/src/host-model-controls.ts';
import { at, effect, sealed, value } from './src/host-handoff.ts';
import { hashCanonicalRequest } from '../../runtime/src/service-effects/contracts/common.ts';
import { storeChatMetadata } from '../../runtime/src/db.ts';
import type { AcceptedInput } from '../../runtime/durable-engine/src/host-runtime.ts';

for(const extended of [false,true]) test('real owned model tool uses current selected schemas and switches only the next request'+(extended?' [extended max and disabled minimal]':''), async () => {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, 'owned-context-'));
  const f = await acceptedSteerFixture(dir, 'committed-ack-lost');
  const release = barrier(), entered = barrier();
  const requests: string[] = [];
  let preparations = 0;
  const original = f.base.models.getModel('qualification', 'synthetic')!;
  const descriptor=extended?{...original,reasoning:true,thinkingLevelMap:{off:'off',minimal:null,low:null,medium:'medium',high:'high',xhigh:'xhigh',max:'max'}}:original;
  const models = [descriptor, { ...descriptor, id: 'alternate', name: 'Alternate' }];
  const tools = createHostModelTools({ assertCurrent() { f.owner.assert(); }, available: () => models,
    assertModel(choice) { if (!models.some(m => m.provider === choice.provider && m.id === choice.modelId)) throw Error('unapproved'); },
    async captureSourceGuard(call) { const captured = await f.runtime!.captureToolSource(call.conversationId, call.taskId, call.toolCallId); return () => f.runtime!.assertCapturedSourceCurrent(captured.inputs); },
    async prepareContext(call, model, level) { preparations++; return f.runtime!.prepareToolModelContext(call, model, level); },
  });
  const extension = defineExtension({ name: 'owned-model-controls', tools });
  f.base.registry.install(extension);
  const hidden = defineTool({ name: 'excluded-context', description: 'x'.repeat(original.contextWindow + 10000), parameters: Type.Object({}), callers: ['tools'], execute: async () => ({}) });
  f.base.registry.install(defineExtension({ name: 'excluded-context-tools', tools: [hidden] }));
  try {
    const raw = await Harness.open(await SqliteStorage.open(new OwnedSqlite(f.owner)), { models: f.base.models, registry: f.base.registry }, context);
    try { await (await raw.conversation(f.base.root.id, context))!.configure({ extensions: [extension], tools, modelTools: [tools.find(t => t.name === 'set_model')!] }, context); }
    finally { await raw.close(context); }
    const stream = (model: typeof original, input: {messages:readonly import('../../runtime/durable-engine/qualification/ai.ts').Message[]}, options?: { signal?: AbortSignal; reasoning?: unknown }) => {
      requests.push(model.id); const ordinal = requests.length;
      const choosing=ordinal===1||(extended&&ordinal===2);
      if(extended&&ordinal>1){
        const result=input.messages.findLast(message=>message.role==='toolResult');
        const block=result?.role==='toolResult'?result.content.find(block=>block.type==='text'):undefined;
        const choice=JSON.parse(block?.type==='text'?block.text:'{}');
        if(ordinal===2){expect(choice.error).toContain('Unsupported');expect(choice.thinking_levels).not.toContain('minimal');}
        else {expect(choice.thinking_level).toBe('max');expect(options?.reasoning).toBe('max');}
      }
      const output = createAssistantMessageEventStream();
      const content: AssistantMessage['content'] = choosing
        ? [{ type: 'toolCall', id: ordinal===1?'choose-next-model':'choose-next-model-2', name: 'set_model', arguments: { model: 'qualification/alternate', ...(extended?{thinking_level:ordinal===1?'minimal':'max'}:{}) } }]
        : [{ type: 'text', text: 'OWNED_MODEL_DONE' }];
      const message: AssistantMessage = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
        timestamp: Date.now(), stopReason: choosing ? 'toolUse' : 'stop', content,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      void (async () => { if (ordinal === 1) { entered.release(); await release.promise; } options?.signal?.throwIfAborted();
        output.push({ type: 'done', reason: choosing ? 'toolUse' : 'stop', message }); output.end(message); })();
      return output;
    };
    f.base.models.setProvider(createProvider({ id: original.provider, models, auth: { apiKey: { name: 'synthetic', resolve: async () => ({ auth: {}, source: 'fixture' }) } }, api: { stream, streamSimple: stream } }));
    storeChatMetadata(f.chatJid, at);
    const source = value(await f.ports.work.acceptSource(sealed({ effect: effect(`${f.incarnation}:A`), chatJid: f.chatJid,
      sourceId: `${f.incarnation}:A`, kind: 'message' as const, payloadRef: `${f.incarnation}:A`, targetOperationId: null,
      parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
    f.db.query('INSERT INTO messages(id,chat_jid,content,timestamp) VALUES (?,?,?,?)').run(source.sourceId, f.chatJid, 'primary A', at);
    const claimed = value(await f.ports.work.claimNext(sealed({ effect: effect(`${f.incarnation}:claim`), chatJid: f.chatJid,
      expectedFrontier: 0, newOperationId: f.incarnation, claimedAt: at })))!;
    await f.open(); f.permit = true;
    const primary: AcceptedInput = { incarnation: f.incarnation, conversationId: f.base.root.id, chatJid: f.chatJid,
      branchId: 'main', operationId: f.incarnation, sourceId: source.sourceId, sourceSeq: source.sourceSeq,
      payloadRef: source.payloadRef, requestId: f.primaryRequestId,
      requestHash: hashCanonicalRequest({ type: 'input', requestId: f.primaryRequestId, content: 'primary A' }) };
    const primaryId = await f.runtime!.submit(primary);
    const operation = value(await f.ports.work.getOperation(claimed.operation.operationId))!;
    value(await f.ports.work.bindHarness(sealed({ effect: effect(`${f.incarnation}:running`, f.incarnation, source.sourceSeq), expectedVersion: operation.version, sessionId: f.incarnation, harnessOperationId: String(primaryId) })));
    await entered.promise; release.release();
    await f.runtime!.wait(primary, primaryId);
    for (let i = 0; i < 300; i++) { if (!(await f.runtime!.inspectAuthority()).inspection.tasks.length) break; await Bun.sleep(5); }
    expect((await f.runtime!.inspectAuthority()).inspection.tasks).toHaveLength(0);
    expect(preparations).toBe(extended?2:1);
    const binding = { incarnation: f.incarnation, chatJid: f.chatJid, branchId: 'main', conversationId: f.base.root.id };
    expect(await f.runtime!.readSessionModel(binding)).toBe('qualification/alternate');
    expect(requests).toEqual(extended?['synthetic','synthetic','alternate']:['synthetic', 'alternate']);
    if(extended) expect(await f.runtime!.readSessionThinkingLevel(binding)).toBe('max');
  } finally { release.release(); await f.close(); await rm(dir, { recursive: true, force: true }); }
}, 10000);
