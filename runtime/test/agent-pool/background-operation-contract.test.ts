import { expect, test } from 'bun:test';
import {
  createNativeBackgroundPayload, readNativeBackgroundPayload, readNativeBackgroundPolicy,
  nativeBackgroundSourceId, nativeBackgroundIdentity, nativeBackgroundContextKey, nativeBackgroundPolicyHash,
  assertNativeBackgroundRetry, assertNativeBackgroundDeadline, assertNativeBackgroundModel, type NativeBackgroundPolicyInput,
} from '../../src/agent-pool/background-operation-contract.js';
const input = (): NativeBackgroundPolicyInput => ({
  origin: { kind: 'dream', invocationId: 'invocation:fixture', chatJid: 'web:fixture', mode: 'manual' },
  workId: 'dream-work:fixture', parentWorkId: null, model: { provider: 'qualification', modelId: 'synthetic', api: 'openai-completions' },
  allowedTools: ['write', 'read'], maxToolCalls: 3, acceptedAt: '2026-10-26T15:20:00.000Z', expiresAt: '2026-10-26T15:23:00.000Z',
  prompt: 'PRIVATE_PROMPT π', instructions: 'PRIVATE_INSTRUCTIONS',
});
test('Dream policy freezes canonical private content hashes and original invocation identity', () => {
  const request = input(), payload = createNativeBackgroundPayload(request), policy = payload.policy;
  expect(policy.allowedTools).toEqual(['read', 'write']);
  for (const value of [policy, policy.origin, policy.model, policy.allowedTools]) expect(Object.isFrozen(value)).toBe(true);
  (request as any).allowedTools = ['bash']; (request.origin as any).mode = 'auto'; (request.model as any).modelId = 'changed';
  expect(policy.allowedTools).toEqual(['read', 'write']); expect(policy.model.modelId).toBe('synthetic');
  expect(policy.origin).toMatchObject({ kind: 'dream', mode: 'manual' });
  expect(JSON.stringify(policy)).not.toContain('PRIVATE_PROMPT'); expect(JSON.stringify(policy)).not.toContain('PRIVATE_INSTRUCTIONS');
  expect(readNativeBackgroundPayload(JSON.parse(JSON.stringify(payload)))).toEqual(payload);
  expect(nativeBackgroundIdentity(policy)).toMatchObject({ sourceId: policy.sourceId, payloadRef: policy.sourceId, requestId: policy.sourceId, operationId: 'operation:' + policy.sourceId });
  expect(nativeBackgroundIdentity(policy).chatJid).toStartWith('dream:');
  expect(nativeBackgroundPolicyHash(createNativeBackgroundPayload({ ...input(), allowedTools: ['read', 'write'] }).policy)).toBe(nativeBackgroundPolicyHash(policy));
});
test('Dream retry cannot renew or widen immutable choices under the same source ID', () => {
  const request = input(), policy = createNativeBackgroundPayload(request).policy;
  const changes: Partial<NativeBackgroundPolicyInput>[] = [
    { prompt: 'another input' }, { instructions: 'another system prompt' }, { expiresAt: '2026-10-26T15:24:00.000Z' },
    { acceptedAt: '2026-10-26T15:21:00.000Z' }, { maxToolCalls: 4 }, { allowedTools: ['bash'] }, { parentWorkId: 'different-parent' }, { workId: 'different-work' },
    { model: { ...request.model, api: 'another-api' } }, { origin: { kind: 'dream', invocationId: 'invocation:fixture', chatJid: 'web:fixture', mode: 'auto' } },
  ];
  for (const change of changes) {
    const candidate = createNativeBackgroundPayload({ ...input(), ...change }).policy;
    expect(candidate.sourceId).toBe(policy.sourceId); expect(() => assertNativeBackgroundRetry(policy, candidate)).toThrow('retry identity conflict');
  }
  expect(() => assertNativeBackgroundRetry(policy, readNativeBackgroundPolicy(JSON.parse(JSON.stringify(policy))))).not.toThrow();
});
test('separate Dream invocations and chats never reuse their private input/context identity', () => {
  const request = input(), first = createNativeBackgroundPayload(request).policy;
  for (const origin of [
    { kind: 'dream' as const, invocationId: 'another-invocation', chatJid: 'web:fixture', mode: 'manual' as const },
    { kind: 'dream' as const, invocationId: 'invocation:fixture', chatJid: 'web:other', mode: 'manual' as const },
  ]) {
    const next = createNativeBackgroundPayload({ ...request, origin }).policy;
    expect(next.sourceId).not.toBe(first.sourceId); expect(nativeBackgroundContextKey(next.origin)).not.toBe(nativeBackgroundContextKey(first.origin));
    expect(nativeBackgroundIdentity(next).chatJid).not.toBe(nativeBackgroundIdentity(first).chatJid);
    expect(nativeBackgroundIdentity(next).branchId).not.toBe(nativeBackgroundIdentity(first).branchId);
  }
});
test('retired add-on policy remains decodable as historical data but cannot create fresh executable payloads', () => {
  const request = input(), origin = { kind: 'addon' as const, operationId: 'old-task', addonId: 'a2a', principalId: 'old-caller', target: 'old-agent', grantRevision: 'old-revision', inputSequence: 1 };
  expect(() => createNativeBackgroundPayload({ ...request, origin })).toThrow('Only native Dream');
  const baseline = createNativeBackgroundPayload(request);
  const historical = { ...baseline, policy: { ...baseline.policy, origin, sourceId: nativeBackgroundSourceId(origin) } };
  const encoded = JSON.stringify(historical);
  expect(readNativeBackgroundPayload(JSON.parse(encoded))).toEqual(historical);
  expect(JSON.stringify(historical)).toBe(encoded);
});
test('background decoding refuses changed content, schema or binding instead of adopting it', () => {
  const payload = createNativeBackgroundPayload(input());
  for (const changed of [{ ...payload, prompt: 'modified' }, { ...payload, instructions: 'modified' }, { ...payload, version: 2 }, { ...payload, extra: 'untrusted' },
    { ...payload, policy: { ...payload.policy, sourceId: 'background:' + '0'.repeat(64) } }, { ...payload, policy: { ...payload.policy, allowedTools: ['write', 'read'] } },
    { ...payload, policy: { ...payload.policy, promptSha256: 'bad' } }]) expect(() => readNativeBackgroundPayload(changed)).toThrow('Invalid native background');
});
test('malformed Dream policy fields fail before construction; explicit unbounded tool policy is retained', () => {
  const request = input();
  expect(createNativeBackgroundPayload({ ...request, maxToolCalls: null }).policy.maxToolCalls).toBeNull();
  for (const change of [{ maxToolCalls: -1 }, { maxToolCalls: 101 }, { maxToolCalls: 1.5 }, { allowedTools: ['read', 'read'] }, { allowedTools: ['read\n'] }, { allowedTools: ['tool/alias'] },
    { parentWorkId: request.workId }, { parentWorkId: '' }, { expiresAt: request.acceptedAt }, { expiresAt: 'not-a-time' }, { acceptedAt: '2026-10-26' },
    { model: { ...request.model, provider: 'other/provider' } }, { model: { ...request.model, modelId: 'not canonical' } },
    { origin: { ...request.origin, invocationId: '' } }, { extra: 'untrusted' }]) expect(() => createNativeBackgroundPayload({ ...request, ...change } as NativeBackgroundPolicyInput)).toThrow('Invalid native background');
});
test('policy getters and sparse or aliased tool arrays are never evaluated', () => {
  let reads = 0; const getter = { ...input() }; Object.defineProperty(getter, 'origin', { enumerable: true, get() { reads++; throw Error('must not evaluate'); } });
  expect(() => createNativeBackgroundPayload(getter)).toThrow('Invalid native background');
  const origin = { ...input().origin }; Object.defineProperty(origin, 'kind', { enumerable: true, get() { reads++; throw Error('must not evaluate'); } });
  expect(() => createNativeBackgroundPayload({ ...input(), origin } as NativeBackgroundPolicyInput)).toThrow('Invalid native background');
  const tools = ['read']; Object.defineProperty(tools, '0', { get() { reads++; throw Error('must not evaluate'); } });
  expect(() => createNativeBackgroundPayload({ ...input(), allowedTools: tools })).toThrow('Invalid native background');
  expect(() => createNativeBackgroundPayload({ ...input(), allowedTools: new Array(2) })).toThrow('Invalid native background'); expect(reads).toBe(0);
});
test('physical provider/model/API identity remains exact without fallback', () => {
  const policy = createNativeBackgroundPayload(input()).policy, physical = { provider: policy.model.provider, id: policy.model.modelId, api: policy.model.api };
  expect(() => assertNativeBackgroundModel(policy, physical)).not.toThrow();
  for (const changed of [{ ...physical, provider: 'other' }, { ...physical, id: 'other' }, { ...physical, api: 'other' }]) expect(() => assertNativeBackgroundModel(policy, changed)).toThrow('physical model changed');
});
test('absolute Dream deadline is inclusive and never renewed by retry', () => {
  const policy = createNativeBackgroundPayload(input()).policy, start = Date.parse(policy.acceptedAt), end = Date.parse(policy.expiresAt);
  expect(() => assertNativeBackgroundDeadline(policy, start)).not.toThrow(); expect(() => assertNativeBackgroundDeadline(policy, end - 1)).not.toThrow();
  for (const now of [start - 1, end, end + 1, NaN, Infinity]) expect(() => assertNativeBackgroundDeadline(policy, now)).toThrow('deadline unavailable or expired');
  const restored = readNativeBackgroundPolicy(JSON.parse(JSON.stringify(policy))); expect(() => assertNativeBackgroundDeadline(restored, end)).toThrow('expired');
  for (const [now, name] of [[end, 'TimeoutError'], [start - 1, 'Error'], [NaN, 'Error']] as const) {
    let error: unknown; try { assertNativeBackgroundDeadline(restored, now); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error); expect((error as Error).name).toBe(name);
  }
});
