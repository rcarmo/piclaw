import './src/test-guard.js';
import { expect, test } from 'bun:test';
import { AgentDoc, defineExtension, defineTool } from '../../runtime/durable-engine/qualification/durable.ts';
import { Type } from '../../runtime/durable-engine/qualification/ai.ts';
import { openFixture, context } from './src/fixture.js';
import { assertModelContextFits, prepareModelContextAdmission, projectModelContext } from '../../runtime/durable-engine/src/host-model-context.ts';

async function fixture() {
  const f = await openFixture({ acquired: true });
  const visible = defineTool({ name: 'visible', description: 'Small offered tool', parameters: Type.Object({}), execute: async () => ({}) });
  const hidden = defineTool({ name: 'nested_only', description: 'NESTED_ONLY'.repeat(15000), parameters: Type.Object({}), callers: ['tools'], execute: async () => ({}) });
  f.registry.install(defineExtension({ name: 'selected-context', tools: [visible, hidden] }));
  await f.root.configure({ extensions: null, tools: null, modelTools: [visible] }, context);
  let current = true;
  let defaults: { name: string }[] | undefined;
  const prepare = (measure = async () => {}) => prepareModelContextAdmission({ conversation: f.root, registry: f.registry,
    context, defaultExtensions: () => defaults, readAgentState: () => f.harness.snapshot(AgentDoc, f.root.id, context),
    async project(view, agent) { await measure(); return projectModelContext(view, { conversationId: f.root.id, agent, env: undefined, read: f.harness }, context); }, assertCurrent() { if (!current) throw Error('owner revoked'); } });
  return { ...f, prepare, revoke() { current = false; }, defaults(value: typeof defaults) { defaults = value; } };
}

test('selected admission measures offered schemas and retains SDK token and full-output allowances', async () => {
  const f = await fixture();
  try {
    const admission = await f.prepare();
    expect(admission.messages.flatMap(m => m.role === 'system' ? m.toolsAdded ?? [] : []).map(t => t.name)).toEqual(['visible']);
    const state = await f.harness.snapshot(AgentDoc, f.root.id, context);
    const target = { contextWindow: 25000, maxTokens: 1000 };
    expect(() => assertModelContextFits(admission.messages, target)).not.toThrow();
    await f.root.commit(async tx => {
      const current = await tx.doc(AgentDoc, f.root.id);
      await admission.assertCurrent(tx, current);
      expect(() => assertModelContextFits(admission.messages, target)).not.toThrow();
      expect(() => assertModelContextFits(admission.messages, { ...target, contextWindow: 100 })).toThrow('estimate exceeded');
    }, context);
    expect(f.host.modelCalls).toBe(0);
  } finally { await f.harness.close(context); }
});

for (const race of ['configuration', 'registry-install', 'registry-replace', 'defaults', 'history', 'owner'] as const) {
  test(`selected admission refuses ${race} change before configuration commit`, async () => {
    const f = await fixture();
    try {
      const admission = await f.prepare();
      if (race === 'configuration') await f.root.configure({ cwd: '/different-synthetic-directory' }, context);
      if (race === 'registry-install') f.registry.install(defineExtension({ name: 'new-extension' }));
      if (race === 'registry-replace') f.registry.install(defineExtension({ name: 'selected-context' }));
      if (race === 'defaults') f.defaults([{ name: 'changed-default' }]);
      if (race === 'history') await (await f.root.submit({ type: 'write', entry: { kind: 'test.note', data: null } }, context)).wait(context);
      if (race === 'owner') f.revoke();
      const before = await f.harness.snapshot(AgentDoc, f.root.id, context);
      await expect(f.root.commit(async tx => {
        const current = await tx.doc(AgentDoc, f.root.id);
        await admission.assertCurrent(tx, current);
        current.model = { provider: 'forbidden', modelId: 'must-not-commit' };
      }, context)).rejects.toThrow();
      expect(await f.harness.snapshot(AgentDoc, f.root.id, context)).toEqual(before);
      expect(f.host.modelCalls).toBe(0);
    } finally { await f.harness.close(context); }
  });
}

test('selected admission refuses scope changes during asynchronous prompt measurement', async () => {
  const f = await fixture();
  try {
    await expect(f.prepare(async () => {
      f.registry.install(defineExtension({ name: 'changed-during-render' })); return;
    })).rejects.toThrow('registry changed');
    expect(f.host.modelCalls).toBe(0);
  } finally { await f.harness.close(context); }
});

test('selected admission rolls back when registry changes inside the selection transaction', async () => {
  const f = await fixture();
  try {
    const admission = await f.prepare();
    const before = await f.harness.snapshot(AgentDoc, f.root.id, context);
    await expect(f.root.commit(async tx => {
      const current = await tx.doc(AgentDoc, f.root.id);
      await admission.assertCurrent(tx, current);
      current.model = { provider: 'forbidden', modelId: 'must-not-commit' };
      f.registry.install(defineExtension({ name: 'changed-before-commit' }));
      admission.assertScopeCurrent();
    }, context)).rejects.toThrow('registry changed');
    expect(await f.harness.snapshot(AgentDoc, f.root.id, context)).toEqual(before);
  } finally { await f.harness.close(context); }
});

test('selected model admission accepts a compacted context with retained entries ordered after its new head', async () => {
  const f = await fixture();
  try {
    for (let n = 0; n < 3; n++) {
      const input = await f.root.submit({ type: 'input', requestId: `compact-history-${n}`, content: `Decision ${n}: ` + 'detail '.repeat(6000) }, context);
      expect((await input.wait(context)).status).toBe('done');
    }
    const task = await f.root.compact(undefined, context);
    await f.harness.waitForTask(task, context);
    const view = await f.root.context(context);
    const frontier = await f.root.commit(async tx => (await tx.scanEntries({ conversationId: f.root.id, order: 'descending' }, 1)).items[0]?.id, context);
    expect(view.entries.at(-1)?.id).not.toBe(frontier);
    const admission = await f.prepare();
    await f.root.commit(async tx => {
      const current = await tx.doc(AgentDoc, f.root.id);
      await admission.assertCurrent(tx, current);
      current.model = { provider: 'qualification', modelId: 'post-compaction' };
    }, context);
    const state = await f.harness.snapshot(AgentDoc, f.root.id, context);
    expect(state).toBeDefined();
    expect(state!.model?.modelId).toBe('post-compaction');
    expect(f.host.credentialLookups).toBe(0);
  } finally { await f.harness.close(context); }
});

test('forked conversation admission validates inherited context without requiring a local transcript tail', async () => {
  const f = await fixture();
  try {
    const inherited = await f.root.commit(tx => tx.appendEntry(f.root.id, { kind: 'app.parent-message', data: {}, model: [{ role: 'user', content: 'Inherited context', timestamp: 0 }] }), context);
    const fork = await f.root.fork(inherited.id, { ownership: { kind: 'ownerless' } }, context);
    const admission = await prepareModelContextAdmission({ conversation: fork, registry: f.registry, context,
      defaultExtensions: () => undefined, readAgentState: () => f.harness.snapshot(AgentDoc, fork.id, context),
      assertCurrent() {}, project: (view, agent) => projectModelContext(view, { conversationId: fork.id, agent, env: undefined, read: f.harness }, context) });
    expect(admission.messages.some(message => message.role === 'user' && message.content === 'Inherited context')).toBe(true);
    await fork.commit(async tx => { const state = await tx.doc(AgentDoc, fork.id); await admission.assertCurrent(tx, state); }, context);
    expect(f.host.modelCalls).toBe(0);
  } finally { await f.harness.close(context); }
});

// Projection probes use public ContextView shape; durable generation evidence is
// separately exercised in model-context-duplicate.test.ts.
async function projection(messages: any[], sections: any[], tools: any[] = [], extra: any = {}) {
  return projectModelContext({ messages, entries: [], contributions: [], ...extra }, {
    conversationId: 1 as any, agent: { sections, tools } as any, env: undefined, read: {} as any,
  }, context);
}
const sys = (sections: any) => ({ role: 'system' as const, content: '', sections, timestamp: 1 });
const section = (key: string, value: string | undefined) => ({ key, tag: false, render: () => value });

test('projection preserves ordered shown replay and applies changes/removals/reorder once', async () => {
  const old = sys({ a: 'A', b: 'B' });
  const sections = [section('b', 'B2'), section('a', 'A')];
  let renders = 0;
  sections[0]!.render = ((input: any) => { renders++; expect(Object.keys(input.shown)).toEqual(['a', 'b']); return 'B2'; }) as any;
  const projected = await projection([old], sections);
  expect(renders).toBe(1);
  expect(projected).toHaveLength(3);
  expect((projected[1] as any).sections).toEqual({ a: null, b: null });
  expect((projected[2] as any).sections).toEqual({ b: 'B2', a: 'A' });
  expect(await projection([old], [section('a', 'A'), section('b', 'B')])).toEqual([old]);
  expect((await projection([old], [section('a', 'A')])).at(-1)).toMatchObject({ sections: { b: null } });
});

test('schema reorder and constrainedSampling changes remain provider-visible exactly once', async () => {
  const a = { name: 'a', description: 'A', parameters: {}, constrainedSampling: true };
  const b = { name: 'b', description: 'B', parameters: {} };
  const old = { ...sys({}), toolsAdded: [a, b] };
  expect(await projection([old], [], [a, b])).toEqual([old]);
  expect((await projection([old], [], [b, a])).at(-1)).toMatchObject({ toolsRemoved: [{ name: 'a' }, { name: 'b' }], toolsAdded: [b, a] });
  const changed = { ...a, constrainedSampling: false };
  expect((await projection([old], [], [changed, b])).at(-1)).toMatchObject({ toolsAdded: [changed, b] });
});

test('new oversized section on empty history is refused in SDK token units', async () => {
  const messages = await projection([], [section('new', 'x'.repeat(600000))]);
  expect(messages).toHaveLength(1);
  expect(() => assertModelContextFits(messages, { contextWindow: 100000, maxTokens: 1000 })).toThrow('compact first');
});

test('pending head replaces only uniquely attributed native systems, preserving custom systems', async () => {
  const native = sys({ old: 'old' }), custom = sys({ custom: 'host' });
  const row = { id: 1, kind: 'pi.system', model: [native] };
  const head = { id: 2, kind: 'pi.compaction' };
  const extra = { head, entries: [row, { id: 3, kind: 'host.custom' }], contributions: [[native], [custom]] };
  const result = await projection([custom, native], [section('new', 'new')], [], extra);
  expect(result[0]).toBe(custom);
  expect(result).not.toContain(native);
  expect(result).toHaveLength(2);
  for (const [messages, contributions] of [
    [[custom, native, native], [[native], [custom]]],
    [[custom, native], [[native], [custom, native]]],
    [[custom], [[native], [custom]]],
    [[custom, native], [[{ role: 'user', content: 'not system', timestamp: 0 }], [custom]]],
  ] as any) await expect(projection(messages, [], [], { ...extra, contributions })).rejects.toThrow('provenance unavailable');
});
