import './src/test-guard.js';
import { expect, test } from 'bun:test';
import { createSession, MemoryStorage } from '../../runtime/durable-engine/qualification/durable.js';
import { BACKGROUND_CONTEXT as context, withAbortSignal } from '../../runtime/durable-engine/qualification/context.js';
import { PlanDoc } from '../../runtime/durable-engine/src/plan-document.js';
import { handleNativePlanRequest, planEtag } from '../../runtime/durable-engine/src/plan-http.js';
import { DEFAULT_PLAN } from '../../runtime/src/plan/markdown.js';
import { barrier } from './src/fixture.js';
const chat = 'web:http';
const legacy = { chat_jid: chat, markdown: '> authored\n\n- [-] preserved', updated_at: 'original time' };
const request = (body?: unknown, tag = planEtag(legacy), options: RequestInit = {}) => new Request('https://fixture/agent/plan',
  body === undefined ? options : { method: 'POST', headers: { 'If-Match': tag }, body: JSON.stringify(body), ...options });

test('native HTTP: readonly exact adoption; stale/invalid writes roll back, legacy bytes remain untouched', async () => {
  const session = createSession(new MemoryStorage()); let notifications = 0;
  const call = (req: Request) => handleNativePlanRequest(session, req, chat, context, () => {}, () => legacy, () => notifications++);
  try {
    const get = await call(request()); expect(get.status).toBe(200); expect(get.headers.get('etag')).toBe(planEtag(legacy));
    expect(get.headers.get('cache-control')).toContain('no-store'); expect((await get.json() as any).plan).toMatchObject(legacy);
    expect(await session.snapshot(PlanDoc, chat, context)).toBeUndefined();
    expect((await call(request({ markdown: 'stale' }, '"old"'))).status).toBe(409);
    expect(await session.snapshot(PlanDoc, chat, context)).toBeUndefined();
    for (const body of [null, [], { chat_jid: 'web:other', markdown: 'denied' }, {}, { markdown: '- [-] A\n- [-] B' }]) {
      expect((await call(request(body))).status).toBe(400);
    }
    expect((await call(request({ markdown: 'x'.repeat(65536) }))).status).toBe(413);
    expect((await call(request({ markdown: 'x'.repeat(131073) }))).status).toBe(413);
    expect(notifications).toBe(0); expect(await session.snapshot(PlanDoc, chat, context)).toBeUndefined();
    const written = await call(request({ markdown: '- [x] native' })); expect(written.status).toBe(200);
    expect((await session.snapshot(PlanDoc, chat, context))?.markdown).toBe('- [x] native'); expect(notifications).toBe(1);
    expect(legacy.markdown).toBe('> authored\n\n- [-] preserved'); expect(legacy.updated_at).toBe('original time');
  } finally { await session.close(context); }
});

test('SDK serializes concurrent HTTP preconditions; reset and postcommit notification failure retain successful state', async () => {
  const session = createSession(new MemoryStorage());
  const call = (req: Request) => handleNativePlanRequest(session, req, chat, context, () => {}, () => legacy, () => { throw Error('notification unavailable'); });
  try {
    const replies = await Promise.all([call(request({ markdown: '- [x] first' })), call(request({ markdown: '- [x] second' }))]);
    expect(replies.map(reply => reply.status).sort()).toEqual([200, 409]);
    const current = await session.snapshot(PlanDoc, chat, context); expect(current?.markdown).toBe('- [x] first');
    const reset = await call(request({ action: 'reset' }, planEtag(current!))); expect(reset.status).toBe(200);
    expect((await session.snapshot(PlanDoc, chat, context))?.markdown).toBe(DEFAULT_PLAN);
    const read = await handleNativePlanRequest(session, request(), chat, context, () => {}, () => { throw Error('legacy must not be consulted'); }, () => {});
    expect(read.status).toBe(200); expect((await read.json() as any).plan.markdown).toBe(DEFAULT_PLAN);
    expect(await session.snapshot(PlanDoc, chat + ':branch:one', context)).toBeUndefined();
  } finally { await session.close(context); }
});

test('native HTTP: cancellation during body wait and revoked owner before SDK mutation have no effect', async () => {
  const session = createSession(new MemoryStorage()), abort = new AbortController(); let active = true, notices = 0;
  const check = () => { if (!active) throw Error('revoked'); };
  try {
    const entered = barrier();
    const body = new ReadableStream({ pull() { entered.release(); }, cancel() {} });
    const req = new Request('https://fixture/agent/plan', { method: 'POST', headers: { 'If-Match': planEtag(legacy) }, body } as RequestInit);
    const pending = handleNativePlanRequest(session, req, chat, withAbortSignal(abort.signal, context), check, () => legacy, () => notices++);
    await entered.promise; abort.abort(); await expect(pending).rejects.toThrow();
    active = false;
    await expect(handleNativePlanRequest(session, request({ markdown: 'denied' }), chat, context, check, () => legacy, () => notices++)).rejects.toThrow('revoked');
    expect(await session.snapshot(PlanDoc, chat, context)).toBeUndefined(); expect(notices).toBe(0);
  } finally { await session.close(context); }
});
