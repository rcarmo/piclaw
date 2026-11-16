import { test, expect } from 'bun:test';
import { createHostCodexOutput } from '../../runtime/durable-engine/src/host-codex-output.ts';
test('output isolated by operation and flushed on shutdown/dispose', async () => {
  const seen: string[] = [];
  const service = createHostCodexOutput<string>({ async observe(op, event) { seen.push(`${op.id}:${event}`); }, async flush(s) { seen.push(`flush:${s}`); } });
  const op = (id: string, sessionId: string) => ({ id, sessionId, provider: 'openai-codex', model: 'gpt-5', api: 'openai-codex-responses', signal: new AbortController().signal, assertCurrent() {} });
  const a = service.open(op('a', 's1')), b = service.open(op('b', 's2'));
  await Promise.all([a.observe('web'), b.observe('image')]);
  await service.shutdown('s1'); expect(() => a.observe('late')).toThrow();
  await service.dispose(); expect(() => b.observe('late')).toThrow();
  expect(seen).toEqual(['a:web', 'b:image', 'flush:s1', 'flush:s2']);
});
test('dispose awaits pending output and retains failures', async () => {
  let release!: () => void;
  const wait = new Promise<void>(r => { release = r; });
  let flushed = false;
  const service = createHostCodexOutput({ async observe() { await wait; }, async flush() { flushed = true; } });
  const stream = service.open({ id: 'x', sessionId: 's', provider: 'openai-codex', api: 'openai-codex-responses', model: 'm', signal: new AbortController().signal, assertCurrent() {} });
  const capture = stream.observe({ type: 'response.output_item.done' });
  const disposing = service.dispose(); await Promise.resolve(); expect(flushed).toBe(false);
  release(); await capture; await disposing; expect(flushed).toBe(true);
});
