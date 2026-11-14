import './src/test-guard.js';
import { expect, test } from 'bun:test';
import { createRegistry, defineExtension, Harness, MemoryStorage } from '../../runtime/durable-engine/qualification/durable.js';
import { BACKGROUND_CONTEXT as context } from '../../runtime/durable-engine/qualification/context.js';
import { createModels, createProvider } from '../../runtime/durable-engine/qualification/ai.js';
import { AssistantMessageEventStream } from '../../runtime/durable-engine/qualification/event-stream.js';
import { createPlanTool } from '../../runtime/durable-engine/src/plan-tool.js';
import { PlanDoc } from '../../runtime/durable-engine/src/plan-document.js';

// Actual SDK registration, generation, tool tasks and document commits. The
// product source port is synthetic here; default-application adoption/UI/prompt
// integration requires its own tests and is NOT established by this component.
test('direct native Plan tool: actions, aliases, adoption, scope, rollback and no legacy registration', async () => {
  const chat = 'web:native-plan', changes: any[] = [];
  let next: any, legacyReads = 0, current = true, native = true, notificationFails = false;
  const legacy = { chat_jid: chat, markdown: '- [ ] legacy', updated_at: 'old-timestamp' };
  const tool = createPlanTool({
    runtime: () => ({ withSourceWriteGuard: async (check, body) => { check(); return body(); }, async captureToolSource() { return { operation: { chatJid: chat }, native: native ? { assertCurrent() { if (!current) throw Error('revoked'); } } : undefined } as any; } }),
    assertOwner() {},
    readLegacy(jid) { expect(jid).toBe(chat); legacyReads++; return legacy; },
    changed(plan, action) { if (notificationFails) throw Error('private-notification-failure'); changes.push({ plan, action }); },
  });
  expect(tool.name).toBe('plan'); expect(tool.replay).toBe('unsafe');
  expect(tool.callers).toEqual(['model', 'tools']);
  const model: any = { id: 'plan', name: 'Plan fixture', provider: 'native-plan-test', api: 'openai-completions', baseUrl: 'https://invalid.invalid',
    input: ['text'], reasoning: false, contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  let sequence = 0;
  const stream = () => {
    const args = next; next = undefined;
    const output = new AssistantMessageEventStream();
    const message: any = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, timestamp: 1,
      content: args ? [{ type: 'toolCall', id: `plan-${++sequence}`, name: 'plan', arguments: args }] : [{ type: 'text', text: 'done' }],
      stopReason: args ? 'toolUse' : 'stop', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    output.push({ type: 'done', reason: message.stopReason, message }); output.end(message); return output;
  };
  const forbidden = async (): Promise<never> => { throw Error('Ambient credentials forbidden'); };
  const models = createModels({ authContext: { env: forbidden, fileExists: forbidden } });
  models.setProvider(createProvider({ id: model.provider, models: [model], auth: { apiKey: { name: 'Fixture', resolve: async () => ({ auth: {}, source: 'fixture' }) } }, api: { stream, streamSimple: stream } }));
  const extension = defineExtension({ name: 'test.direct-plan', tools: [tool] });
  const registry = createRegistry(); registry.install(extension);
  const harness = await Harness.open(new MemoryStorage(), { models, registry, settings: { retry: { enabled: false }, compaction: { enabled: false } } }, context);
  try {
    const conversation = await harness.root(context, { agent: { model: { provider: model.provider, modelId: model.id }, extensions: [extension] } });
    let request = 0;
    const run = async (args: any) => {
      next = args;
      await (await conversation.submit({ type: 'input', requestId: `request-${++request}`, content: 'exercise Plan' }, context)).wait(context);
      const entries = await conversation.entries({ order: 'ascending' }, 100, undefined, context);
      return entries.items.flatMap(entry => entry.model ?? []).filter(message => message.role === 'toolResult').at(-1)!;
    };
    const read = await run({ action: 'get' });
    expect(read).toMatchObject({ isError: false, content: [{ type: 'text', text: `Plan for ${chat}:\n\n- [ ] legacy` }], details: legacy });
    expect(await harness.snapshot(PlanDoc, chat, context)).toBeUndefined(); expect(changes).toHaveLength(0);
    expect((await run({ action: 'set', markdown: '- [ ] one\n- [ ] two' })).isError).toBe(false);
    expect((await harness.snapshot(PlanDoc, chat, context))?.markdown).toBe('- [ ] one\n- [ ] two');
    const adoptedReads = legacyReads; legacy.markdown = 'stale source';
    expect((await run({ plan: [{ step: 'first', status: 'completed' }, { step: 'second', status: 'in_progress' }] })).isError).toBe(false);
    expect((await run({ action: 'edit', oldText: '- [-] second', newText: '- [ ] second' })).isError).toBe(false);
    expect((await run({ patches: [{ operation: 'add', step: 'third' }] })).isError).toBe(false);
    expect((await harness.snapshot(PlanDoc, chat, context))?.markdown).toBe('- [x] first\n- [ ] second\n- [ ] third');
    expect(legacyReads).toBe(adoptedReads); expect(changes.map(event => event.action)).toEqual(['write', 'update', 'edit', 'patch']);
    const before = await harness.snapshot(PlanDoc, chat, context);
    for (const args of [
      { action: 'write', chat_jid: 'web:foreign', markdown: 'foreign' },
      { action: 'update', plan: [{ step: 'one', status: 'in_progress' }, { step: 'two', status: 'in_progress' }] },
      { action: 'patch', patches: [{ operation: 'remove', match: 'missing' }] },
    ]) expect((await run(args)).isError).toBe(true);
    expect(await harness.snapshot(PlanDoc, chat, context)).toEqual(before);
    expect(await harness.snapshot(PlanDoc, 'web:foreign', context)).toBeUndefined();
    expect(changes).toHaveLength(4);
    native = false;
    expect((await run({ action: 'write', markdown: 'unowned' })).isError).toBe(true);
    native = true; current = false;
    expect((await run({ action: 'write', markdown: 'revoked' })).isError).toBe(true);
    expect(await harness.snapshot(PlanDoc, chat, context)).toEqual(before);
    current = true; notificationFails = true;
    expect((await run({ action: 'write', markdown: '- [x] stored despite notification error' })).isError).toBe(false);
    expect((await harness.snapshot(PlanDoc, chat, context))?.markdown).toBe('- [x] stored despite notification error');
  } finally { await harness.close(context); }
});
