import { expect, test } from 'bun:test';
import { readOfflineSessionSource, SESSION_IMPORT_LIMITS } from '../../src/session-import/source.js';
const timestamp = '2026-01-01T00:00:00.000Z';
const header = { type: 'session', version: 3, id: 'source-session', timestamp, cwd: '/offline/original' };
const entry = (id: string, parentId: string | null, message: unknown) => ({ type: 'message', id, parentId, timestamp, message });
const user = (content = 'SOURCE_PRIVATE_HISTORY') => ({ role: 'user', content, timestamp: 1 });
const assistant = (content: unknown[] = [{ type: 'text', text: 'SOURCE_ANSWER' }], stopReason = 'stop') => ({ role: 'assistant', api: 'openai-completions', provider: 'offline', model: 'recorded', timestamp: 2, content, stopReason,
  usage: { input: 10, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 11, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
const encode = (records: unknown[], first: unknown = header) => [first, ...records].map(record => JSON.stringify(record)).join('\n') + '\n';
const linear = () => [entry('u', null, user()), entry('a', 'u', assistant())];

test('pure reader detaches a complete v3 history without host baseline or current runtime state', () => {
  const input = encode(linear()), parsed = readOfflineSessionSource(input);
  expect(parsed.sourceSessionId).toBe('source-session'); expect(parsed.leaves).toEqual(['a']);
  expect(parsed.selectedLeaves).toEqual(['a']); expect(parsed.selectedEntries.map(record => record.original)).toEqual(linear());
  expect(parsed.selectedEntries[0]!.message).toEqual(user()); expect(encode(linear())).toBe(input);
});

test('multiple leaves require explicit selection and share only their actual source ancestors', () => {
  const input = encode([...linear(), entry('other', 'u', assistant([{ type: 'text', text: 'SECOND_BRANCH' }]))]);
  expect(() => readOfflineSessionSource(input)).toThrow('multiple leaves require explicit selection');
  const selected = readOfflineSessionSource(input, ['other']);
  expect(selected.entries).toHaveLength(3); expect(selected.selectedEntries.map(entry => entry.id)).toEqual(['u', 'other']);
  expect(readOfflineSessionSource(input, ['a', 'other']).selectedEntries).toHaveLength(3);
});

for (const leaves of [[], ['missing'], ['u'], ['a', 'a']]) test(`invalid leaf selection fails before import: ${JSON.stringify(leaves)}`, () => {
  expect(() => readOfflineSessionSource(encode(linear()), leaves)).toThrow('invalid leaf selection');
});

for (const records of [
  [entry('u', null, user()), entry('u', 'u', assistant())],
  [entry('a', 'future', assistant()), entry('future', null, user())],
  [entry('a', 'a', assistant())],
]) test('duplicate/forward/self parents fail rather than inventing lineage', () => { expect(() => readOfflineSessionSource(encode(records))).toThrow(); });

test('historical tool calls/results remain data, with exact source correlation and inline raster bytes', () => {
  const call = entry('call', 'u', assistant([{ type: 'toolCall', id: 'tool', name: 'write', arguments: { path: 'would-never-write', content: 'SOURCE_ONLY' } }], 'toolUse'));
  const result = entry('result', 'call', { role: 'toolResult', toolCallId: 'tool', toolName: 'write', timestamp: 3, isError: false, content: [{ type: 'text', text: 'RECORDED_RESULT' }, { type: 'image', mimeType: 'image/png', data: 'recorded-image-bytes' }] });
  const parsed = readOfflineSessionSource(encode([entry('u', null, user()), call, result, entry('a', 'result', assistant())]));
  expect(parsed.selectedEntries.map(record => record.original)).toEqual([entry('u', null, user()), call, result, entry('a', 'result', assistant())]);
});

for (const mode of ['unfinished', 'orphan', 'wrong-name']) test(`unsupported tool correlation refuses selected history: ${mode}`, () => {
  const records = [entry('u', null, user())];
  if (mode !== 'orphan') records.push(entry('call', 'u', assistant([{ type: 'toolCall', id: 'tool', name: 'read', arguments: {} }], 'toolUse')));
  if (mode !== 'unfinished') records.push(entry('result', mode === 'orphan' ? 'u' : 'call', { role: 'toolResult', timestamp: 3, toolCallId: 'tool', toolName: 'write', isError: false, content: [] }));
  expect(() => readOfflineSessionSource(encode(records))).toThrow();
});

test('model/thinking/compaction/label/name markers are retained as inert source records', () => {
  const records = [entry('u', null, user()),
    { type: 'model_change', id: 'm', parentId: 'u', timestamp, provider: 'offline', modelId: 'old-model' },
    { type: 'thinking_level_change', id: 't', parentId: 'm', timestamp, thinkingLevel: 'high' },
    { type: 'compaction', id: 'c', parentId: 't', timestamp, summary: 'OLD_SUMMARY', firstKeptEntryId: 'u', tokensBefore: 100 },
    { type: 'label', id: 'l', parentId: 'c', timestamp, targetId: 'u', label: 'Original label' },
    { type: 'session_info', id: 'i', parentId: 'l', timestamp, name: 'Original name' },
    entry('a', 'i', assistant())];
  const parsed = readOfflineSessionSource(encode(records));
  expect(parsed.selectedEntries.map(entry => entry.original)).toEqual(records);
  expect(parsed.entries.filter(entry => entry.message)).toHaveLength(2);
});

for (const first of [{ ...header, version: 2 }, { ...header, parentSession: 'foreign-session.jsonl' }, { ...header, configuration: { model: 'DO_NOT_MIGRATE' } }]) test('unsupported versions, external lineage and config-bearing headers fail closed', () => {
  expect(() => readOfflineSessionSource(encode(linear(), first))).toThrow();
});

test('custom extension/account state is refused, not copied or silently discarded', () => {
  const input = encode([{ type: 'custom', id: 'custom', parentId: null, timestamp, customType: 'account-state', data: { credential: 'PRIVATE_SOURCE' } }]);
  expect(() => readOfflineSessionSource(input)).toThrow('unsupported session entry type');
});

test('malformed JSONL and resource bounds reject the whole source', () => {
  expect(() => readOfflineSessionSource('not-json\n')).toThrow();
  expect(() => readOfflineSessionSource(encode([entry('u', null, user('x'.repeat(SESSION_IMPORT_LIMITS.bytes)))]))).toThrow('source exceeds byte bound');
  expect(() => readOfflineSessionSource(encode(Array.from({ length: SESSION_IMPORT_LIMITS.entries + 1 }, (_, i) => entry(String(i), i ? String(i - 1) : null, user()))))).toThrow('entry bound exceeded');
});
