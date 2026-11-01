import './src/test-guard.js';
import { expect, test } from 'bun:test';
import { AgentDoc, SystemEntry, defineExtension, defineTool, type PromptInput } from '../../runtime/durable-engine/qualification/durable.ts';
import { Type, estimateContextTokens, type Message } from '../../runtime/durable-engine/qualification/ai.ts';
import { context, openFixture } from './src/fixture.ts';
// Existing private HOST probe, exercised offline only. All native SDK access below
// is through public exports; do not import pi-durable's internal prompt planner.
import { assertModelContextFits, projectModelContext } from '../../runtime/durable-engine/src/host-model-context.ts';

type Fixture = Awaited<ReturnType<typeof openFixture>>;
const reserve = 8192, maxTokens = 100, slack = 64;
const sectionKey = 'qualification_context';
const sectionText = 'UNCHANGED_SECTION '.repeat(800);
const instructions = 'UNCHANGED_INSTRUCTIONS '.repeat(700);
const tagged = (key: string, text: string) => `<${key}>\n${text}\n</${key}>`;
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const request = (f: Fixture, index: number): Message[] => JSON.parse(f.host.transcripts[index]!);
const systems = (messages: readonly Message[]) => messages.filter(m => m.role === 'system');
const schemas = (messages: readonly Message[]) => systems(messages).flatMap(m => m.toolsAdded ?? []);
const sectionValues = (messages: readonly Message[], key: string) => systems(messages)
  .flatMap(m => m.sections?.[key] === undefined ? [] : [m.sections[key]]);
const schema = (tool: { name: string; description: string; parameters: unknown }) => ({
  name: tool.name, description: tool.description, parameters: tool.parameters,
});

async function run(f: Fixture, id: string, text = 'continue') {
  const submission = await f.root.submit({ type: 'input', requestId: id, content: text }, context);
  expect((await submission.wait(context)).status).toBe('done');
  await f.settlement(submission);
}
async function measure(f: Fixture) {
  const agent = await f.root.agent(context);
  const input: Omit<PromptInput, 'shown'> = { conversationId: f.root.id, agent, env: undefined, read: f.harness };
  return projectModelContext(await f.root.context(context), input, context);
}
async function clean(f: Fixture) {
  expect(f.host.credentialLookups).toBe(0);
  expect(f.reports).toEqual([]);
}
function budget(messages: readonly Message[]) {
  // Same public SDK token units as the host, not JSON bytes and not a claim
  // about a live provider's tokenizer. Only 64 tokens of extra input allowance.
  return { contextWindow: estimateContextTokens(messages).tokens + reserve + maxTokens + slack, maxTokens };
}
function evidence(label: string, messages: readonly Message[], projected: readonly Message[] | number, extra = {}) {
  console.info('MODEL_CONTEXT_DUPLICATE_EVIDENCE', JSON.stringify({ label,
    estimate: estimateContextTokens(messages), projectedEstimate: typeof projected === "number" ? projected : estimateContextTokens(projected),
    sectionKeys: systems(messages).flatMap(m => Object.keys(m.sections ?? {})),
    schemaNames: schemas(messages).map(t => t.name), target: budget(messages), ...extra }));
}

// Native generation retains the original positional section; admission must agree.
test('regression: unchanged dynamic section already in native context must not consume a second allowance', async () => {
  const f = await openFixture({ acquired: true }); // fresh disposable MemoryStorage, no live files
  try {
    const shown: Readonly<Record<string, string>>[] = [];
    const extension = defineExtension({ name: 'duplicate-section', sections: [{ key: sectionKey,
      render(input) { shown.push({ ...input.shown }); return sectionText; } }] });
    f.registry.install(extension);
    await f.root.configure({ extensions: [extension], tools: [], modelTools: [] }, context);
    await run(f, 'section-first');
    const before = await f.root.context(context);
    const measuredBytes = await measure(f);
    expect(shown.at(-1)?.[sectionKey]).toBe(tagged(sectionKey, sectionText));
    const rows = (await f.root.entries({ order: 'ascending' }, 100, undefined, context)).items;
    await run(f, 'section-second');
    const first = request(f, 0), second = request(f, 1);
    expect(sectionValues(first, sectionKey)).toEqual([tagged(sectionKey, sectionText)]);
    expect(sectionValues(second, sectionKey)).toEqual(sectionValues(first, sectionKey));
    expect(schemas(second)).toEqual([]);
    expect<readonly Message[]>(second.slice(0, before.messages.length)).toEqual(before.messages);
    const after = (await f.root.entries({ order: 'ascending' }, 100, undefined, context)).items;
    expect(after.filter(SystemEntry.is)).toEqual(rows.filter(SystemEntry.is));
    expect(estimateContextTokens(second).lastUsageIndex).toBeNull(); // unmeasured text path, independently of schemas
    const doc = await f.harness.snapshot(AgentDoc, f.root.id, context);
    expect(() => assertModelContextFits(second, budget(second))).not.toThrow();
    evidence('unchanged-section/no-new-pi.system', second, measuredBytes,
      { renderedSectionBytes: bytes([sectionKey, tagged(sectionKey, sectionText)]) });
    await clean(f);
    expect(() => assertModelContextFits(measuredBytes, budget(second))).not.toThrow();
  } finally { await f.close(); }
});

// Instructions are already a native section; they must not be charged separately.
test('regression: instructions are a native positional section, not an additional configuration prompt', async () => {
  const f = await openFixture({ acquired: true });
  try {
    await f.root.configure({ instructions, tools: [], modelTools: [] }, context);
    await run(f, 'instructions-first');
    const before = await f.root.context(context);
    const measuredBytes = await measure(f);
    const agent = await f.root.agent(context);
    expect(agent.sections.map(s => s.key)).toEqual(['instructions']);
    await run(f, 'instructions-second');
    const second = request(f, 1);
    expect(sectionValues(second, 'instructions')).toEqual([tagged('instructions', instructions)]);
    expect(systems(second)).toEqual(systems(request(f, 0)));
    expect(schemas(second)).toEqual([]);
    const doc = await f.harness.snapshot(AgentDoc, f.root.id, context);
    expect(doc).toBeDefined();
    expect(doc!.instructions).toBe(instructions);
    // The original native transcript and candidate projection share the budget.
    expect(() => assertModelContextFits(second, budget(second))).not.toThrow();
    evidence('instructions/already-in-section', second, measuredBytes, { isolatedPromptSectionBytes: 0,
      instructionsBytes: Buffer.byteLength(instructions) });
    await clean(f);
    expect(() => assertModelContextFits(measuredBytes, budget(second))).not.toThrow();
  } finally { await f.close(); }
});

test('regression: measured native prefix already includes the unchanged selected tool schemas', async () => {
  const f = await openFixture({ acquired: true });
  try {
    const tool = defineTool({ name: 'measured_schema', description: 'MEASURED_SCHEMA '.repeat(1200),
      parameters: Type.Object({ value: Type.String({ description: 'Native schema parameter' }) }),
      execute: async () => ({}) });
    const extension = defineExtension({ name: 'duplicate-schema', tools: [tool] });
    f.registry.install(extension);
    await f.root.configure({ extensions: [extension], tools: [tool], modelTools: [tool] }, context);
    // Fixture-provider usage, not fabricated historical entries: record a
    // coherent nonzero measurement of the exact first generation request.
    f.host.onModelEnter = () => { f.host.tokens = estimateContextTokens(request(f, 0)).tokens; };
    await run(f, 'schema-first');
    f.host.onModelEnter = undefined;
    const before = await f.root.context(context);
    const first = request(f, 0);
    const offered = JSON.parse(JSON.stringify((await f.root.agent(context)).tools.map(schema)));
    expect(schemas(first)).toEqual(offered);
    expect(offered.map((t: { name: string }) => t.name)).toEqual(['measured_schema']);
    expect(f.host.tokens).toBeGreaterThan(5000);
    expect(estimateContextTokens(before.messages).usageTokens).toBe(f.host.tokens);
    await run(f, 'schema-second');
    const second = request(f, 1);
    expect(systems(second)).toEqual(systems(first));
    expect(schemas(second)).toEqual(offered); // one catalogue, no repeated declaration
    const estimate = estimateContextTokens(second);
    expect(estimate.lastUsageIndex).not.toBeNull();
    expect(second.findIndex(m => m.role === 'system' && !!m.toolsAdded?.length)).toBeLessThan(estimate.lastUsageIndex!);
    expect(estimate.usageTokens).toBe(f.host.tokens);
    expect(await measure(f)).toEqual((await f.root.context(context)).messages);
    const doc = await f.harness.snapshot(AgentDoc, f.root.id, context);
    expect(() => assertModelContextFits(second, budget(second))).not.toThrow();
    const measuredBytes = await measure(f);
    evidence('schemas/inside-measured-prefix', second, 0, { schemaBytes: bytes(offered),
      firstRequestTokens: estimateContextTokens(first).tokens });
    await clean(f);
    expect(() => assertModelContextFits(measuredBytes, budget(second))).not.toThrow();
  } finally { await f.close(); }
});

// Passing boundary control, not an assertion that every repeated-looking value
// is duplicate overhead. Actual manual compaction can leave old pi.system rows
// after a new head, with NO post-head baseline yet. The next generation MUST
// rebuild that baseline and omit the retained system rows, even if unchanged.
test('pending compaction head invalidates old usage and native generation replaces retained system rows once', async () => {
  const f = await openFixture({ acquired: true });
  try {
    await run(f, 'head-old');
    const tool = defineTool({ name: 'head_schema', description: 'Retained schema', parameters: Type.Object({}), execute: async () => ({}) });
    const extension = defineExtension({ name: 'head-boundary', tools: [tool],
      sections: [{ key: sectionKey, render: () => sectionText }] });
    f.registry.install(extension);
    await f.root.configure({ extensions: [extension], tools: [tool], modelTools: [tool], instructions }, context);
    f.host.tokens = 30000;
    // This retained user exceeds the fixture's default keepRecentTokens=20000,
    // selecting it as the cut, with its subsequent pi.system row still retained.
    await run(f, 'head-retained', 'RETAINED_USER '.repeat(6000));
    await run(f, 'head-tail');
    const old = await f.root.context(context);
    expect(estimateContextTokens(old.messages).lastUsageIndex).not.toBeNull();
    await Bun.sleep(2); // head timestamp must be strictly newer than retained usage
    f.host.finalContent = [{ type: 'text', text: 'Native compaction checkpoint' }];
    const task = await f.root.compact(undefined, context);
    const result = await f.harness.waitForTask(task, context);
    expect(result.state.outcome.status).toBe('completed');
    if (result.state.outcome.status !== 'completed') throw Error('Compaction did not complete');
    const placed = await f.harness.submission(result.state.outcome.result.submissionId!, context);
    expect(placed).toBeDefined();
    expect((await placed!.wait(context)).status).toBe('done');
    const pending = await f.root.context(context);
    expect(pending.head?.kind).toBe('pi.compaction');
    const retained = pending.entries.filter(SystemEntry.is);
    expect(retained.length).toBeGreaterThan(0);
    expect(retained.every(row => row.id < pending.head!.id)).toBe(true);
    expect(estimateContextTokens(pending.messages).lastUsageIndex).toBeNull();
    const measuredBytes = await measure(f);
    const nextIndex = f.host.transcripts.length;
    await run(f, 'head-follow');
    const next = request(f, nextIndex);
    expect(measuredBytes.map(({timestamp, ...message}) => message)).toEqual(next.slice(0, measuredBytes.length).map(({timestamp, ...message}) => message));
    expect(() => assertModelContextFits(measuredBytes, budget(next))).not.toThrow();
    expect(sectionValues(next, sectionKey)).toEqual([tagged(sectionKey, sectionText)]);
    expect(sectionValues(next, 'instructions')).toEqual([tagged('instructions', instructions)]);
    expect(schemas(next)).toEqual(JSON.parse(JSON.stringify([schema(tool)])));
    const after = await f.root.context(context);
    const baselines = after.entries.filter(row => SystemEntry.is(row) && row.id > pending.head!.id);
    expect(baselines).toHaveLength(1);
    expect(baselines[0]!.edits).toEqual(retained.map(row => ({ target: row.id, action: 'omit' })));
    for (const row of retained) {
      const index = after.entries.findIndex(entry => entry.id === row.id);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(after.contributions[index]).toEqual([]);
    }
    // Raw active entries remain; only their model contributions are omitted.
    // They are not deleted or rewritten in durable history.
    const history = (await f.root.entries({ order: 'ascending' }, 100, undefined, context)).items;
    expect(history.filter(row => retained.some(oldRow => oldRow.id === row.id))).toEqual(retained);
    evidence('pending-head/rebaseline-is-real-not-a-duplicate', pending.messages, measuredBytes,
      { retainedSystemIds: retained.map(row => row.id), baselineId: baselines[0]!.id,
        nextRequestSectionKeys: systems(next).flatMap(m => Object.keys(m.sections ?? {})),
        nextRequestSchemaNames: schemas(next).map(t => t.name) });
    await clean(f);
  } finally { await f.close(); }
});
