import { expect, test } from 'bun:test';
import { applyPlanEdits, applyPlanPatches, buildPlanSystemPrompt, buildPlanTurnMessage, normalizeStoredPlanMarkdown,
  normalizeUpdatePlanArgs, parsePlanMarkdown, structuredPlanDetails, updatePlanArgsToMarkdown } from '../../src/plan/markdown.js';

const original = '> reason\n\n- [ ] first\n- [-] second\n- [x] third';

test('structured update retains status, explanation and whitespace semantics', () => {
  const input = { explanation: ' reason\nnext ', plan: [{ step: ' done  now ', status: 'completed' }, { step: 'working', status: 'in_progress' }, { step: 'later', status: 'pending' }] };
  expect(normalizeUpdatePlanArgs(input)).toEqual({ explanation: 'reason\nnext', plan: [{ step: 'done now', status: 'completed' }, { step: 'working', status: 'in_progress' }, { step: 'later', status: 'pending' }] });
  expect(updatePlanArgsToMarkdown(input)).toBe('> reason\n> next\n\n- [x] done now\n- [-] working\n- [ ] later');
  expect(updatePlanArgsToMarkdown({ plan: [] })).toBe('');
});

for (const [input, error] of [
  [null, 'requires a plan array'], [{ plan: 'wrong' }, 'requires a plan array'],
  [{ plan: [null] }, 'non-empty step'], [{ plan: [{ step: ' ', status: 'pending' }] }, 'non-empty step'],
  [{ plan: [{ step: 'x', status: 'unknown' }] }, 'Invalid plan status'],
  [{ plan: [{ step: 'x', status: 'in_progress' }, { step: 'y', status: 'in_progress' }] }, 'at most one in_progress'],
] as const) test(`structured update refuses ${JSON.stringify(input)}`, () => {
  expect(() => normalizeUpdatePlanArgs(input)).toThrow(error);
});

test('Markdown normalises markers/CRLF without discarding surrounding authored text', () => {
  const markdown = '# header\r\n> reason\r\n\r\n  1. [X]  done now\r\n* [-] working\r\n+ [ ] later\r\nfooter';
  expect(normalizeStoredPlanMarkdown(markdown)).toBe('# header\n> reason\n\n  1. [x]  done now\n* [-] working\n+ [ ] later\nfooter');
  expect(parsePlanMarkdown(markdown)).toEqual({ explanation: 'reason', plan: [{ step: 'done now', status: 'completed' }, { step: 'working', status: 'in_progress' }, { step: 'later', status: 'pending' }], inProgressCount: 1 });
  expect(() => normalizeStoredPlanMarkdown('- [-] one\n- [-] two')).toThrow('at most one in-progress');
});

test('structured details preserve exact public identity and timestamp fields', () => {
  expect(structuredPlanDetails({ chat_jid: 'web:x:branch:y', markdown: original, updated_at: 'old' })).toEqual({
    chat_jid: 'web:x:branch:y', markdown: original, updated_at: 'old', explanation: 'reason',
    plan: [{ step: 'first', status: 'pending' }, { step: 'second', status: 'in_progress' }, { step: 'third', status: 'completed' }],
  });
});

test('exact edits use original ranges and commit one valid final result', () => {
  const edits = [{ oldText: '- [ ] first', newText: '- [-] first' }, { oldText: '- [-] second', newText: '- [x] second' }];
  expect(applyPlanEdits(original, edits)).toBe('> reason\n\n- [-] first\n- [x] second\n- [x] third');
  expect(edits[0].oldText).toBe('- [ ] first');
  expect(applyPlanEdits('ab', [{ oldText: 'a', newText: 'b' }, { oldText: 'b', newText: 'a' }])).toBe('ba');
});

for (const [operation, result] of [['delete', ''], ['insert_before', 'newold'], ['insert_after', 'oldnew']] as const) test(`exact edit supports ${operation}`, () => {
  expect(applyPlanEdits('old', [{ operation, anchorText: 'old', text: 'new' }])).toBe(result);
});

test('append/prepend retain stable ordering and text aliases', () => {
  expect(applyPlanEdits('x', [{ operation: 'append', text: 'a' }, { operation: 'append', newText: 'b' }])).toBe('xab');
  expect(applyPlanEdits('x', [{ operation: 'prepend', text: 'a' }, { operation: 'prepend', text: 'b' }])).toBe('abx');
  expect(applyPlanEdits('x', [{ oldText: 'x', newText: '' }])).toBe('');
});

for (const [markdown, edits, error] of [
  ['x x', [{ oldText: 'x', newText: 'y' }], 'exactly once'], ['x', [{ oldText: 'missing', newText: 'y' }], 'exactly once'],
  ['abcd', [{ oldText: 'abc', newText: 'x' }, { oldText: 'bc', newText: 'y' }], 'must not overlap'],
  ['x', [], 'at least one edit'], ['x', [{ operation: 'append', text: '' }], 'must not be empty'],
  ['x', [{ operation: 'unknown' }], 'Each plan edit needs operation'],
  [original, [{ oldText: '- [ ] first', newText: '- [-] first' }], 'at most one in-progress'],
] as const) test(`invalid exact edit fails atomically: ${JSON.stringify(edits)}`, () => {
  expect(() => applyPlanEdits(markdown, edits)).toThrow(error);
});

test('patch add/update/remove are sequential with exact index and unique matches', () => {
  const patches = [{ operation: 'add', step: 'new', after: 'first' }, { operation: 'update', match: 'second', status: 'completed' }, { operation: 'update', match: 'new', status: 'in_progress' }, { operation: 'remove', index: 4 }];
  expect(applyPlanPatches(original, patches)).toBe('> reason\n\n- [ ] first\n- [-] new\n- [x] second');
  expect(patches[0].step).toBe('new');
});

test('patch insertion positions, before/after and defaults retain current behaviour', () => {
  expect(applyPlanPatches('- [ ] one', [{ operation: 'add', step: 'last' }, { operation: 'add', step: 'zero', position: 'start' }, { operation: 'add', step: 'middle', before: 'last' }])).toBe('- [ ] zero\n- [ ] one\n- [ ] middle\n- [ ] last');
  expect(applyPlanPatches('- [-] old', [{ operation: 'add', step: 'new', status: 'in_progress' }, { operation: 'update', match: 'old', status: 'pending' }])).toBe('- [ ] old\n- [-] new');
});

for (const [markdown, patches, error] of [
  [original, [], 'at least one patch'], [original, [{ operation: 'add', step: ' ' }], 'requires step'],
  [original, [{ operation: 'remove', index: 0 }], 'out of range'], [original, [{ operation: 'remove', match: 'missing' }], 'exactly one item'],
  ['- [ ] repeat\n- [ ] repeat', [{ operation: 'remove', match: 'repeat' }], 'exactly one item'],
  [original, [{ operation: 'update', index: 1, step: '' }], 'must not be empty'],
  [original, [{ operation: 'update', index: 1, status: 'wrong' }], 'Invalid plan status'],
  [original, [{ operation: 'add', step: 'new', status: 'in_progress' }], 'at most one in_progress'],
  [original, [{ operation: 'add', step: 'new', position: 'wrong' }], 'position must be start or end'],
] as const) test(`invalid structured patch fails atomically: ${JSON.stringify(patches)}`, () => {
  expect(() => applyPlanPatches(markdown, patches)).toThrow(error);
});

test('mutable checklist stays out of the stable system guidance and in hidden turn context', () => {
  const first = { chat_jid: 'web:x:branch:y', markdown: '- [ ] first', updated_at: 'one' };
  const second = { ...first, markdown: '- [x] first\n- [ ] second', updated_at: 'two' };
  expect(buildPlanSystemPrompt(first)).toBe(buildPlanSystemPrompt(second));
  expect(buildPlanSystemPrompt(second)).not.toContain('- [ ] second');
  expect(buildPlanTurnMessage(second)).toEqual({ customType: 'plan_sidebar_context', display: false, content: [{ type: 'text', text: 'Current Plan Sidebar checklist for web:x:branch:y:\n\n- [x] first\n- [ ] second' }] });
  expect(buildPlanSystemPrompt({ ...first, markdown: '' })).toBe('');
  expect(buildPlanTurnMessage({ ...first, markdown: '' })).toBeUndefined();
});
