import { expect, test } from 'bun:test';
import { buildSessionContext, type SessionEntry } from '@earendil-works/pi-coding-agent';
import { adoptedJsonl } from './adopted-session-fixture.js';
import { computePromptCacheWaste } from '../../src/agent-pool/cache-stats.js';
import { createSessionManagerPersistencePort } from '../../src/agent-pool/session-persistence.js';

const stamp = '2026-09-06T00:00:00.000Z';
const append = (rows: any[], entries: any[]) => {
  const copy = [...rows];
  let parentId = copy.at(-1).id;
  for (const entry of entries) {
    copy.push({ ...entry, parentId, timestamp: stamp });
    parentId = entry.id;
  }
  return JSON.stringify(copy[0]) + '\n' + copy.slice(1).map((entry) => JSON.stringify(entry)).join('\n') + '\n';
};

test('nullable compaction is forwarded; managers without context-edit support fail closed', async () => {
  const port = createSessionManagerPersistencePort({
    appendCompaction: (_summary, first) => { expect(first).toBeNull(); return 'compact'; },
  } as any);
  expect(await port.appendCompaction('summary', null, 0)).toBe('compact');
  expect(port.appendContextEdit).toBeUndefined();
});

test('0.87.1 canonical projection omits context-edited content on reopen', () => {
  const { rows } = adoptedJsonl('/tmp/adoption', '/tmp/parent.jsonl');
  const jsonl = append(rows, [{ type: 'context_edit', id: 'omit', targetId: 'user', replacement: null }]);
  const entries = jsonl.trim().split("\n").slice(1).map(line => JSON.parse(line));
  // The upgraded SDK applies the edit; 0.85.1 would ignore this same JSONL.
  // Rollback must restore the pre-upgrade snapshot instead of reopening it.
  expect(buildSessionContext(entries).messages.some((message) => message.role === 'user')).toBe(false);
});

test('usage entries do not add a prompt-cache request and edits reset the comparison', () => {
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 10_000, totalTokens: 10_000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const assistant = (id: string, input: number) => ({ type: 'message', id, parentId: null, timestamp: stamp,
    message: { role: 'assistant', provider: 'test', model: 'fixture', timestamp: 1, usage: { ...usage, input, cacheWrite: input ? 0 : 10_000 } } }) as SessionEntry;
  const entries = [assistant('first', 0), { type: 'usage', id: 'separate', kind: 'cache_warm', provider: 'test', model: 'fixture', usage } as unknown as SessionEntry,
    assistant('second', 10_000)];
  expect(computePromptCacheWaste(entries, {}).missCount).toBe(1);
  entries.splice(2, 0, { type: 'context_edit', targetId: 'first', replacement: null } as unknown as SessionEntry);
  expect(computePromptCacheWaste(entries, {}).missCount).toBe(0);
});
