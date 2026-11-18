import { expect, test } from 'bun:test';
import { createToolCallSummaryResolver, readToolCallSummary, toolCallSummary, collectToolCallSummaries } from '../../src/tool-call-summary.js';
import { formatToolTitle } from '../../src/channels/web/agent/agent-utils.js';

test('the registered tool owns wording, with no tool-name knowledge in Core', () => {
  const tool = { name: 'previously_unknown_addon', ...toolCallSummary((args: any) => `inspect widget ${args.widget}`) };
  const resolve = createToolCallSummaryResolver([tool]);
  expect(resolve(tool.name, { widget: 7 })).toBe('inspect widget 7');
  expect(formatToolTitle(tool.name, { command: 'private' }, resolve(tool.name, { widget: 7 }))).toBe('previously_unknown_addon: inspect widget 7');
  expect(resolve('unregistered', {})).toBeUndefined();
});

test('summary providers are scoped to resolved tool objects, not a global name registry', () => {
  const first = createToolCallSummaryResolver([{ name: 'same_name', ...toolCallSummary(() => 'owner one') }]);
  const second = createToolCallSummaryResolver([{ name: 'same_name', ...toolCallSummary(() => 'owner two') }]);
  expect(first('same_name', {})).toBe('owner one');
  expect(second('same_name', {})).toBe('owner two');
  expect(first('same_name', {})).toBe('owner one');
});

test('capture the provider callback and never invoke execute or metadata accessors', () => {
  let executions = 0, accessors = 0;
  const tool = { name: 'addon', ...toolCallSummary(() => 'original wording'), execute() { executions++; } };
  const resolve = createToolCallSummaryResolver([tool]);
  tool.callSummary = () => 'replacement';
  expect(resolve('addon', {})).toBe('original wording');
  const accessor = { name: 'accessor', get callSummary() { accessors++; return () => 'unsafe'; } };
  expect(readToolCallSummary(accessor)).toBeUndefined();
  expect(createToolCallSummaryResolver([accessor])('accessor', {})).toBeNull();
  expect(executions).toBe(0); expect(accessors).toBe(0);
});

test('arguments are decoded JSON and deeply readonly copies', () => {
  const original = { nested: { value: 'original' } };
  const resolve = createToolCallSummaryResolver([{ name: 'addon', ...toolCallSummary((args: any) => {
    expect(Object.isFrozen(args)).toBe(true); expect(Object.isFrozen(args.nested)).toBe(true);
    expect(args).not.toBe(original);
    return args.nested.value;
  }) }]);
  expect(resolve('addon', original)).toBe('original');
  expect(resolve('addon', JSON.stringify(original))).toBe('original');
  const mutation = createToolCallSummaryResolver([{ name: 'addon', ...toolCallSummary((args: any) => { args.nested.value = 'changed'; return 'bad'; }) }]);
  expect(mutation('addon', original)).toBeNull();
  expect(original.nested.value).toBe('original');
});

test('provider errors and invalid output fail to a safe title without argument previews', () => {
  const secret = 'PRIVATEVALUE123';
  for (const result of [null, undefined, '', ' \n ', 7, {}, ['text']]) {
    const resolve = createToolCallSummaryResolver([{ name: 'addon', ...toolCallSummary(() => result as any) }]);
    const summary = resolve('addon', { command: secret });
    expect(summary).toBeNull();
    expect(formatToolTitle('addon', { command: secret }, summary)).toBe('addon');
  }
  const resolve = createToolCallSummaryResolver([{ name: 'addon', ...toolCallSummary(() => { throw Error(secret); }) }]);
  expect(resolve('addon', { command: secret })).toBeNull();
});

test('async providers are rejected before invocation', () => {
  let called = 0;
  const tool = { name: 'addon', callSummary: async () => { called++; return 'not supported'; } };
  expect(createToolCallSummaryResolver([tool])('addon', {})).toBeNull();
  expect(called).toBe(0);
});

test('normalise controls and ANSI into bounded plain text', () => {
  const resolve = createToolCallSummaryResolver([{ name: 'addon', ...toolCallSummary(() => `\u001b[31mhello\u001b[0m\n\u202eworld ${'x'.repeat(200)}`) }]);
  const summary = resolve('addon', {})!;
  expect(summary.startsWith('hello world ')).toBe(true);
  expect(summary).not.toMatch(/[\n\u001b\u202e]/);
  expect(summary.length).toBe(121);
  expect(summary).toEndWith('…');
});

test('missing metadata keeps the generic compatibility fallback', () => {
  const resolve = createToolCallSummaryResolver([{ name: 'old_addon' }]);
  expect(resolve('old_addon', {})).toBeUndefined();
  expect(formatToolTitle('old_addon', { path: 'report.txt' }, resolve('old_addon', {}))).toBe('old_addon: report.txt');
});

test('summaries are display facts for model and nested calls, without changing entries', () => {
  const entries = [
    { kind: 'pi.assistant', model: [{ role: 'assistant', content: [{ type: 'toolCall', id: 'one', name: 'addon', arguments: { id: 1 } }] }] },
    { kind: 'pi.tool-result', model: [{ role: 'toolResult', toolCallId: 'one', details: { calls: [{ name: 'addon', args: '{"id":2}' }] } }] },
  ];
  const before = JSON.stringify(entries);
  const resolve = createToolCallSummaryResolver([{ name: 'addon', ...toolCallSummary((args: any) => `item ${args.id}`) }]);
  expect(collectToolCallSummaries(entries, resolve)).toEqual({ one: { text: 'item 1', nested: ['item 2'] } });
  expect(JSON.stringify(entries)).toBe(before);
});

test('the existing title tracker reuses a pure summary until arguments or the provider change', async () => {
  const { createToolTitleTracker } = await import('../../src/channels/web/agent/agent-utils.js');
  let calls = 0;
  const resolver = createToolCallSummaryResolver([{ name: 'addon', ...toolCallSummary((args: any) => { calls++; return `item ${args.id}`; }) }]);
  const tracker = createToolTitleTracker();
  expect(tracker.remember('one', 'addon', { id: 1 }, resolver)).toBe('addon: item 1');
  expect(tracker.remember('one', 'addon', { id: 1 }, resolver)).toBe('addon: item 1');
  expect(calls).toBe(1);
  expect(tracker.remember('one', 'addon', { id: 2 }, resolver)).toBe('addon: item 2');
  expect(calls).toBe(2);
  tracker.clear(); tracker.remember('one', 'addon', { id: 2 }, resolver); expect(calls).toBe(3);
});

test('historical and nested projections consume tool-supplied facts with no add-on lookup table', async () => {
  const { projectTurnActivity } = await import('../../src/channels/web/agent/turn-activity.js');
  const entries = [
    { id: 1, kind: 'pi.assistant', model: [{ role: 'assistant', content: [{ type: 'toolCall', id: 'one', name: 'brand_new_tool', arguments: { id: 1 } }] }] },
    { id: 2, kind: 'pi.tool-result', model: [{ role: 'toolResult', toolCallId: 'one', content: [], details: { calls: [{ name: 'brand_new_tool', args: '{"id":2}' }] } }] },
  ];
  const resolver = createToolCallSummaryResolver([{ name: 'brand_new_tool', ...toolCallSummary((args: any) => `owner-defined item ${args.id}`) }]);
  const toolSummaries = collectToolCallSummaries(entries, resolver);
  const before = JSON.stringify(entries);
  const projected = projectTurnActivity({ entries, tasks: {}, truncated: false, toolSummaries }, null);
  expect(projected.steps[0].tool?.title).toBe('brand_new_tool: owner-defined item 1');
  expect(projected.steps[0].tool?.nested?.[0].title).toBe('brand_new_tool: owner-defined item 2');
  expect(JSON.stringify(entries)).toBe(before);
});

test('the generic Core presentation has no first-party add-on routing dictionary', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const generic = readFileSync(new URL('../../src/tool-call-summary.ts', import.meta.url), 'utf8')
    + readFileSync(new URL('../../src/channels/web/agent/agent-utils.ts', import.meta.url), 'utf8');
  expect(generic).not.toMatch(/proxmox|portainer|image_process|remote_peer|m365_/);
  expect(existsSync(new URL('../../src/channels/web/agent/addon-tool-titles.ts', import.meta.url))).toBe(false);
});

test('ambiguous providers stay disabled even after a later metadata-free duplicate', () => {
  const resolver = createToolCallSummaryResolver([
    { name: 'same', ...toolCallSummary(() => 'one') },
    { name: 'same', ...toolCallSummary(() => 'two') },
    { name: 'same' },
  ]);
  expect(resolver('same', { command: 'private' })).toBeNull();
});

test('a malformed synchronous provider returning a rejected promise is contained', async () => {
  const resolver = createToolCallSummaryResolver([{ name: 'addon', ...toolCallSummary(() => Promise.reject(Error('private')) as any) }]);
  expect(resolver('addon', {})).toBeNull();
  await Promise.resolve();
});

test('no hidden receiver or execution context is supplied to a provider', () => {
  const resolver = createToolCallSummaryResolver([{ name: 'addon', ...toolCallSummary(function(this: undefined, _args: unknown) {
    expect(this).toBeUndefined(); return 'argument-only caption';
  }) }]);
  expect(resolver('addon', {})).toBe('argument-only caption');
});
