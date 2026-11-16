import './src/test-guard.js';
import { expect, test } from 'bun:test';
import { AgentDoc, SystemEntry, defineExtension, defineTool, type Agent, type PromptInput, type ToolRegistration } from '../../runtime/durable-engine/qualification/durable.ts';
import { Type, estimateContextTokens, type Message } from '../../runtime/durable-engine/qualification/ai.ts';
import { withAbortSignal } from '../../runtime/durable-engine/qualification/context.ts';
import { assertModelContextFits, projectModelContext } from '../../runtime/durable-engine/src/host-model-context.ts';
import { context, openFixture } from './src/fixture.ts';

// The host adapter is the subject, never the oracle. Every parity oracle below
// is a request recorded at the fixture provider by real public-SDK generation.
// No private SDK planner imports, fabricated ContextViews, or stored projections.
type Fixture = Awaited<ReturnType<typeof openFixture>>;
const tag = (key: string, text: string) => `<${key}>\n${text}\n</${key}>`;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const untimed = (messages: readonly Message[]) => messages.map(({ timestamp, ...message }) => message);
const systems = (messages: readonly Message[]) => messages.filter(message => message.role === 'system');
const request = (f: Fixture, index: number): Message[] => JSON.parse(f.host.transcripts[index]!);
function sections(messages: readonly Message[]) {
  const result = new Map<string, string>();
  for (const message of systems(messages)) for (const [key, value] of Object.entries(message.sections ?? {})) {
    if (value === null) result.delete(key); else result.set(key, value);
  }
  return [...result];
}
function tools(messages: readonly Message[]) {
  const result = new Map<string, unknown>();
  for (const message of systems(messages)) {
    for (const tool of message.toolsRemoved ?? []) result.delete(tool.name);
    for (const tool of message.toolsAdded ?? []) result.set(tool.name, tool);
  }
  return [...result.values()];
}
const declaration = (tool: Agent['tools'][number]) => copy({ name: tool.name, description: tool.description,
  parameters: tool.parameters, ...(tool.constrainedSampling === undefined ? {} : { constrainedSampling: tool.constrainedSampling }) });

async function run(f: Fixture, id: string, content = `PARITY_INPUT_${id}`) {
  const index = f.host.transcripts.length;
  const submission = await f.root.submit({ type: 'input', requestId: id, content }, context);
  expect((await submission.wait(context)).status).toBe('done');
  await f.settlement(submission);
  expect(f.host.transcripts.length).toBe(index + 1);
  return request(f, index);
}
async function snapshot(f: Fixture) {
  return copy({ doc: await f.harness.snapshot(AgentDoc, f.root.id, context),
    rows: (await f.root.entries({ order: 'ascending' }, 1000, undefined, context)).items,
    view: await f.root.context(context),
    calls: f.host.modelCalls, transcripts: f.host.transcripts, effects: f.host.effects,
    admissions: f.host.admissions, credentials: f.host.credentialLookups, reports: f.reports });
}
async function project(f: Fixture, agent?: Agent, ctx = context) {
  const before = await snapshot(f);
  const view = await f.root.context(context);
  const viewBefore = copy(view);
  const resolved = agent ?? await f.root.agent(context);
  const agentBefore = copy(resolved);
  const input: Omit<PromptInput, 'shown'> = { conversationId: f.root.id, agent: resolved, env: undefined, read: f.harness };
  try { return await projectModelContext(view, input, ctx); }
  finally {
    // Run these even on render rejection/cancellation. Both durable state and
    // the exact supplied objects must remain untouched; no provider entry.
    expect(copy(view)).toEqual(viewBefore);
    expect(copy(resolved)).toEqual(agentBefore);
    expect(await snapshot(f)).toEqual(before);
  }
}
function compare(projected: readonly Message[], actual: readonly Message[], content: string) {
  const extra = actual.filter(message => message.role === 'user' && message.content === content);
  expect(extra).toHaveLength(1);
  // Only this exact newly submitted user row is allowed, not a loose slack
  // budget or a slice that could hide missing historical/system contributions.
  expect(untimed(systems(projected))).toEqual(untimed(systems(actual)));
  expect(untimed(actual.filter(message => message !== extra[0]))).toEqual(untimed(projected));
  // Object-key order is positional prompt semantics (toEqual alone ignores it).
  expect(systems(projected).map(message => Object.keys(message.sections ?? {})))
    .toEqual(systems(actual).map(message => Object.keys(message.sections ?? {})));
  expect(sections(projected)).toEqual(sections(actual));
  expect(tools(projected)).toEqual(tools(actual));
  const estimate = estimateContextTokens;
  expect(estimate(actual).tokens).toBe(estimate([...projected, extra[0]!]).tokens);
  expect(estimate(actual).tokens - estimate(projected).tokens).toBe(estimate(extra).tokens);
  expect(estimate(actual).lastUsageIndex).toBe(estimate(projected).lastUsageIndex);
}
async function differential(f: Fixture, id: string) {
  const projected = await project(f);
  const content = `PARITY_INPUT_${id}`;
  const actual = await run(f, id, content);
  compare(projected, actual, content);
  expect(f.host.credentialLookups).toBe(0);
  expect(f.reports).toEqual([]);
  return { projected, actual };
}

for (const change of ['unchanged', 'changed', 'removed', 're-added', 'reordered'] as const) {
  test(`native differential sections: ${change}, including raw tags and trailing instructions`, async () => {
    const f = await openFixture({ acquired: true });
    try {
      let value: string | undefined = 'ALPHA_INITIAL';
      const shown: Record<string, string>[] = [];
      const a = defineExtension({ name: 'parity-a', sections: [{ key: 'alpha', render(input) {
        shown.push({ ...input.shown }); return value;
      } }] });
      const b = defineExtension({ name: 'parity-b', sections: [{ key: 'beta', tag: false, render: () => 'RAW_BETA' }] });
      f.registry.install(a); f.registry.install(b);
      await f.root.configure({ extensions: [a, b], tools: [], modelTools: [], instructions: 'TRAILING_INSTRUCTIONS' }, context);
      const seed = await run(f, 'section-seed');
      expect(sections(seed)).toEqual([['alpha', tag('alpha', 'ALPHA_INITIAL')], ['beta', 'RAW_BETA'],
        ['instructions', tag('instructions', 'TRAILING_INSTRUCTIONS')]]);
      if (change === 'changed') value = 'ALPHA_REPLACEMENT';
      if (change === 'removed' || change === 're-added') value = undefined;
      if (change === 're-added') {
        const removed = await run(f, 'section-remove');
        expect(sections(removed).some(([key]) => key === 'alpha')).toBe(false);
        value = 'ALPHA_RE_ADDED';
      }
      if (change === 'reordered') await f.root.configure({ extensions: [b, a] }, context);
      const shownBefore = Object.fromEntries(sections(await f.root.context(context).then(view => view.messages)));
      const renderedBefore = shown.length;
      const { actual } = await differential(f, `section-${change}`);
      expect(shown.slice(renderedBefore)).toEqual([shownBefore, shownBefore]);
      const expected = change === 'reordered' ? ['beta', 'alpha', 'instructions']
        : change === 'removed' ? ['beta', 'instructions'] : ['alpha', 'beta', 'instructions'];
      expect(sections(actual).map(([key]) => key)).toEqual(expected);
      if (value !== undefined) expect(Object.fromEntries(sections(actual)).alpha).toBe(tag('alpha', value));
    } finally { await f.close(); }
  });
}

for (const change of ['unchanged', 'changed', 'removed', 're-added'] as const) {
  test(`native differential instructions: ${change}`, async () => {
    const f = await openFixture({ acquired: true });
    try {
      await f.root.configure({ extensions: [], tools: [], modelTools: [], instructions: 'INITIAL_INSTRUCTIONS' }, context);
      await run(f, 'instructions-seed');
      if (change === 'changed') await f.root.configure({ instructions: 'REPLACEMENT_INSTRUCTIONS' }, context);
      if (change === 'removed' || change === 're-added') await f.root.configure({ instructions: null }, context);
      if (change === 're-added') {
        expect(sections(await run(f, 'instructions-remove'))).toEqual([]);
        await f.root.configure({ instructions: 'RE_ADDED_INSTRUCTIONS' }, context);
      }
      const { actual } = await differential(f, `instructions-${change}`);
      expect(sections(actual)).toEqual(change === 'removed' ? [] : [['instructions', tag('instructions',
        change === 'changed' ? 'REPLACEMENT_INSTRUCTIONS' : change === 're-added' ? 'RE_ADDED_INSTRUCTIONS' : 'INITIAL_INSTRUCTIONS')]]);
    } finally { await f.close(); }
  });
}

for (const change of ['unchanged', 'description', 'parameters', 'constrainedSampling', 'removed', 're-added', 'reordered', 'added'] as const) {
  test(`native differential selected schemas: ${change}`, async () => {
    const f = await openFixture({ acquired: true });
    try {
      const a = defineTool({ name: 'parity_a', description: 'A_SCHEMA', parameters: Type.Object({ value: Type.String() }),
        constrainedSampling: { type: 'json_schema', strict: 'prefer' }, execute: async () => ({}) });
      const b = defineTool({ name: 'parity_b', description: 'B_SCHEMA', parameters: Type.Object({}), execute: async () => ({}) });
      const c = defineTool({ name: 'parity_c', description: 'C_SCHEMA', parameters: Type.Object({}), execute: async () => ({}) });
      const hidden = defineTool({ name: 'parity_nested_only', description: 'NOT_OFFERED_SCHEMA '.repeat(1000),
        callers: ['tools'], parameters: Type.Object({}), execute: async () => ({}) });
      const extension = defineExtension({ name: 'parity-schemas', tools: [a, b, c, hidden] });
      f.registry.install(extension);
      await f.root.configure({ extensions: [extension], tools: [a, b, c, hidden], modelTools: [a, b] }, context);
      expect(tools(await run(f, 'schema-seed'))).toEqual([declaration(a), declaration(b)]);
      let replacement: ToolRegistration = a;
      if (change === 'description') replacement = defineTool({ ...a, description: 'REPLACED_A_SCHEMA' });
      if (change === 'parameters') replacement = defineTool({ name: a.name, description: a.description,
        constrainedSampling: a.constrainedSampling, parameters: Type.Object({ count: Type.Integer({ minimum: 7 }) }),
        execute: async () => ({}) });
      if (change === 'constrainedSampling') replacement = defineTool({ ...a, constrainedSampling: false });
      if (replacement !== a) f.registry.install(defineExtension({ name: extension.name, tools: [replacement, b, c, hidden] }));
      if (change === 'removed' || change === 're-added') await f.root.configure({ modelTools: [b] }, context);
      if (change === 're-added') {
        expect(tools(await run(f, 'schema-remove'))).toEqual([declaration(b)]);
        await f.root.configure({ modelTools: [a, b] }, context);
      }
      if (change === 'reordered') await f.root.configure({ modelTools: [b, a] }, context);
      if (change === 'added') await f.root.configure({ modelTools: [a, b, c] }, context);
      const resolved = await f.root.agent(context);
      expect(resolved.callable.some(tool => tool.name === hidden.name)).toBe(true);
      expect(resolved.tools.some(tool => tool.name === hidden.name)).toBe(false);
      const { actual } = await differential(f, `schemas-${change}`);
      expect(tools(actual)).toEqual(resolved.tools.map(declaration));
      expect(JSON.stringify(systems(actual))).not.toContain(hidden.description);
    } finally { await f.close(); }
  });
}

test('native differential pending compaction omits native rows only, retaining a real custom host system contribution', async () => {
  const f = await openFixture({ acquired: true });
  try {
    await f.root.configure({ tools: [], modelTools: [] }, context);
    await run(f, 'compaction-old');
    const tool = defineTool({ name: 'compaction_schema', description: 'RETAINED_SCHEMA', parameters: Type.Object({}), execute: async () => ({}) });
    const extension = defineExtension({ name: 'parity-compaction', tools: [tool],
      sections: [{ key: 'retained_section', render: () => 'RETAINED_SECTION' }] });
    f.registry.install(extension);
    await f.root.configure({ extensions: [extension], tools: [tool], modelTools: [tool], instructions: 'RETAINED_INSTRUCTIONS' }, context);
    f.host.tokens = 30000;
    // Exceeds native keepRecentTokens=20000: its subsequent native system row
    // and custom host row really survive the cut, before the new head id.
    await run(f, 'compaction-retained', 'RETAINED_USER '.repeat(6000));
    const customMessage: Message = { role: 'system', content: 'CUSTOM_HOST_SYSTEM_MUST_SURVIVE',
      sections: { host_owned: 'HOST_OWNED_SECTION' }, timestamp: Date.now() };
    const custom = await f.root.commit(tx => tx.appendEntry(f.root.id,
      { kind: 'host.parity-system', data: { owner: 'qualification' }, model: [customMessage] }), context);
    await run(f, 'compaction-tail');
    expect(estimateContextTokens((await f.root.context(context)).messages).lastUsageIndex).not.toBeNull();
    await Bun.sleep(2);
    f.host.finalContent = [{ type: 'text', text: 'Native parity checkpoint' }];
    const task = await f.root.compact(undefined, context);
    const result = await f.harness.waitForTask(task, context);
    expect(result.state.outcome.status).toBe('completed');
    if (result.state.outcome.status !== 'completed') throw Error('Compaction did not complete');
    const placed = await f.harness.submission(result.state.outcome.result.submissionId!, context);
    expect((await placed!.wait(context)).status).toBe('done');
    const pending = await f.root.context(context);
    expect(pending.head?.kind).toBe('pi.compaction');
    const retained = pending.entries.filter(SystemEntry.is);
    expect(retained.length).toBeGreaterThan(0);
    expect(retained.every(row => row.id < pending.head!.id)).toBe(true);
    expect(pending.entries.find(row => row.id === custom.id)).toEqual(custom);
    expect(pending.messages.some(message => message.role === 'system' && message.content === customMessage.content)).toBe(true);
    expect(estimateContextTokens(pending.messages).lastUsageIndex).toBeNull();
    const projected = await project(f);
    const content = 'PARITY_INPUT_compaction-next';
    const actual = await run(f, 'compaction-next', content);
    const after = await f.root.context(context);
    const baselines = after.entries.filter(row => SystemEntry.is(row) && row.id > pending.head!.id);
    expect(baselines).toHaveLength(1);
    expect(baselines[0]!.edits).toEqual(retained.map(row => ({ target: row.id, action: 'omit' })));
    for (const row of retained) {
      const index = after.entries.findIndex(entry => entry.id === row.id);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(after.contributions[index]).toEqual([]);
    }
    const customIndex = after.entries.findIndex(entry => entry.id === custom.id);
    expect(customIndex).toBeGreaterThanOrEqual(0);
    expect(after.contributions[customIndex]).toEqual([customMessage]);
    const history = (await f.root.entries({ order: 'ascending' }, 1000, undefined, context)).items;
    expect(history.filter(row => retained.some(old => old.id === row.id))).toEqual(retained);
    expect(history.find(row => row.id === custom.id)).toEqual(custom);
    for (const messages of [projected, actual]) {
      expect(systems(messages).filter(message => message.content === customMessage.content)).toEqual([customMessage]);
      expect(sections(messages)).toEqual([['host_owned', 'HOST_OWNED_SECTION'],
        ['retained_section', tag('retained_section', 'RETAINED_SECTION')],
        ['instructions', tag('instructions', 'RETAINED_INSTRUCTIONS')]]);
      expect(tools(messages)).toEqual([declaration(tool)]);
    }
    compare(projected, actual, content);
    expect(f.reports).toEqual([]);
    expect(f.host.credentialLookups).toBe(0);
  } finally { await f.close(); }
});

for (const phase of ['before-render', 'during-render'] as const) {
  test(`projection render abort ${phase} is read-only and never enters provider`, async () => {
    const f = await openFixture({ acquired: true });
    try {
      const controller = new AbortController();
      let abort = false, renders = 0;
      const extension = defineExtension({ name: 'parity-abort', sections: [{ key: 'abort_section', async render() {
        renders++;
        await Promise.resolve();
        if (abort) controller.abort(new Error('PARITY_RENDER_ABORT'));
        return 'ABORT_SECTION';
      } }] });
      f.registry.install(extension);
      await f.root.configure({ extensions: [extension], tools: [], modelTools: [] }, context);
      await run(f, 'abort-seed');
      const before = renders;
      if (phase === 'before-render') controller.abort(new Error('PARITY_RENDER_ABORT'));
      else abort = true;
      await expect(project(f, undefined, withAbortSignal(controller.signal, context))).rejects.toThrow('PARITY_RENDER_ABORT');
      expect(renders - before).toBe(phase === 'before-render' ? 0 : 1);
      abort = false;
      await differential(f, `recovered-${phase}`);
    } finally { await f.close(); }
  });
}

test('render failure refuses ephemeral admission without writes; native generation reports and retains shown text', async () => {
  const f = await openFixture({ acquired: true });
  try {
    let fail = false;
    const extension = defineExtension({ name: 'parity-failure', sections: [{ key: 'fallible', render() {
      if (fail) throw Error('PARITY_RENDER_FAILURE');
      return 'LAST_GOOD_SECTION';
    } }] });
    f.registry.install(extension);
    await f.root.configure({ extensions: [extension], tools: [], modelTools: [] }, context);
    const seed = await run(f, 'failure-seed');
    fail = true;
    await expect(project(f)).rejects.toThrow('PARITY_RENDER_FAILURE');
    const actual = await run(f, 'failure-native');
    expect(untimed(systems(actual))).toEqual(untimed(systems(seed)));
    expect(sections(actual)).toEqual([['fallible', tag('fallible', 'LAST_GOOD_SECTION')]]);
    expect(f.reports).toHaveLength(1); // SDK reports render errors, projection fails closed instead.
    expect(f.host.credentialLookups).toBe(0);
  } finally { await f.close(); }
});

for (const addition of ['section', 'schema'] as const) {
  test(`native differential genuinely new oversize ${addition} is not mistaken for duplicate overhead`, async () => {
    const f = await openFixture({ acquired: true });
    try {
      await f.root.configure({ extensions: [], tools: [], modelTools: [] }, context);
      await run(f, 'oversize-seed');
      const target = { contextWindow: 100000, maxTokens: 100 };
      expect(() => assertModelContextFits((request(f, 0)), target)).not.toThrow();
      const huge = 'GENUINELY_NEW_OVERHEAD '.repeat(30000);
      const tool = defineTool({ name: 'new_oversize_schema', description: huge, parameters: Type.Object({}), execute: async () => ({}) });
      const extension = defineExtension({ name: 'parity-oversize', tools: addition === 'schema' ? [tool] : [],
        sections: addition === 'section' ? [{ key: 'new_oversize_section', render: () => huge }] : [] });
      f.registry.install(extension);
      await f.root.configure({ extensions: [extension], tools: addition === 'schema' ? [tool] : [],
        modelTools: addition === 'schema' ? [tool] : [] }, context);
      const projected = await project(f);
      const content = `PARITY_INPUT_oversize-${addition}`;
      const actual = await run(f, `oversize-${addition}`, content);
      expect(estimateContextTokens(projected).tokens).toBeGreaterThan(target.contextWindow);
      expect(() => assertModelContextFits(projected, target)).toThrow('Candidate context estimate exceeded');
      expect(() => assertModelContextFits(actual, target)).toThrow('Candidate context estimate exceeded');
      expect(f.reports).toEqual([]);
      expect(f.host.credentialLookups).toBe(0);
      // Keep full ordering parity strict, even if the payload/budget assertions
      // above pass. Native relocation of a first-ever system row matters too.
      compare(projected, actual, content);
    } finally { await f.close(); }
  });
}

test('candidate-model-dependent render projects the candidate without configuring it, then matches actual candidate generation', async () => {
  const f = await openFixture({ acquired: true });
  try {
    const provider = f.models.getProvider('qualification')!;
    const original = f.models.getModel('qualification', 'synthetic')!;
    const alternate = { ...original, id: 'parity-candidate', name: 'Parity candidate' };
    const requestedModels: string[] = [];
    f.models.setProvider({ ...provider, getModels: () => [original, alternate], getAllModels: () => [original, alternate],
      stream(model, transcript, options) { requestedModels.push(model.id); return provider.stream(model, transcript, options); },
      streamSimple(model, transcript, options) { requestedModels.push(model.id); return provider.streamSimple(model, transcript, options); } });
    const rendered: string[] = [];
    const extension = defineExtension({ name: 'parity-model-render', sections: [{ key: 'model_dependent', render(input) {
      const model = `${input.agent.model?.provider}/${input.agent.model?.modelId}`;
      rendered.push(model);
      return `RENDERED_FOR_${model}`;
    } }] });
    f.registry.install(extension);
    await f.root.configure({ extensions: [extension], tools: [], modelTools: [] }, context);
    await run(f, 'candidate-seed');
    const candidate = { provider: 'qualification', modelId: alternate.id };
    const agent = await f.root.agent(context);
    const projected = await project(f, { ...agent, model: candidate });
    expect((await f.root.agent(context)).model).toEqual(agent.model);
    expect(sections(projected)).toEqual([['model_dependent', tag('model_dependent', 'RENDERED_FOR_qualification/parity-candidate')]]);
    await f.root.configure({ model: candidate }, context);
    const content = 'PARITY_INPUT_candidate-next';
    const actual = await run(f, 'candidate-next', content);
    expect(requestedModels).toEqual(['synthetic', 'parity-candidate']);
    expect(rendered).toEqual(['qualification/synthetic', 'qualification/parity-candidate', 'qualification/parity-candidate']);
    compare(projected, actual, content);
    expect(f.reports).toEqual([]);
    expect(f.host.credentialLookups).toBe(0);
  } finally { await f.close(); }
});

for (const edit of ['omit', 'replace-user', 'replace-system'] as const) {
  test(`native differential edited initial baseline retains its original slot: ${edit}`, async () => {
    const f = await openFixture({ acquired: true });
    try {
      await f.root.configure({ extensions: [], tools: [], modelTools: [], instructions: 'EDITED_BASELINE_INSTRUCTIONS' }, context);
      await run(f, 'edited-baseline-seed');
      const before = await f.root.context(context);
      const baseline = before.entries.find(SystemEntry.is)!;
      expect(baseline).toBeDefined();
      const messages: Message[] = edit === 'replace-user'
        ? [{ role: 'user', content: 'BASELINE_REPLACEMENT_USER', timestamp: Date.now() }]
        : [{ role: 'system', content: 'BASELINE_REPLACEMENT_SYSTEM', timestamp: Date.now() }];
      await f.root.commit(tx => tx.appendEntry(f.root.id, { kind: 'host.parity-baseline-edit', data: {},
        edits: edit === 'omit' ? [{ target: baseline.id, action: 'omit' }] : [{ target: baseline.id, action: 'replace', messages }] }), context);
      const { actual } = await differential(f, `edited-baseline-${edit}`);
      expect(sections(actual)).toEqual([['instructions', tag('instructions', 'EDITED_BASELINE_INSTRUCTIONS')]]);
      expect((await f.root.entries({ order: 'ascending' }, 100, undefined, context)).items.some(entry => entry.id === baseline.id)).toBe(true);
    } finally { await f.close(); }
  });
}
