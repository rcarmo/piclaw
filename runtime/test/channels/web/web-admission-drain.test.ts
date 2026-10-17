import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createTempWorkspace, setEnv } from '../../helpers.js';
import { initDatabase, closeDatabase } from '../../../src/db/connection.js';

let workspace: ReturnType<typeof createTempWorkspace>, restore: () => void;
beforeEach(() => {
  workspace = createTempWorkspace('web-internal-seal-');
  restore = setEnv({ PICLAW_WORKSPACE: workspace.workspace, PICLAW_STORE: workspace.store, PICLAW_DATA: workspace.data, PICLAW_DB_IN_MEMORY: '1' });
  initDatabase();
});
afterEach(() => { closeDatabase(); restore(); workspace.cleanup(); });
import { WebChannel } from '../../../src/channels/web.js';

function channel() {
  return new WebChannel({ queue: { enqueue() {} } as any, agentPool: { isStreaming: () => false } as any });
}

for (const path of ['direct-relay', 'addon-enqueue', 'internal-control'] as const) test(`installed WebChannel permanent seal joins ${path}`, async () => {
  const web = channel();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let calls = 0, joined = false;
  (web as any).agentMessageEntryService = { handleAgentMessage: async (req: Request) => {
    entered.resolve(); await release.promise; await req.text(); calls++;
    return Response.json({ status: 'ok', thread_id: null });
  } };
  const invoke = () => path === 'internal-control'
    ? web.runInternalDispatch(async () => { entered.resolve(); await release.promise; calls++; })
    : path === 'addon-enqueue'
      ? web.enqueueAgentMessage({ chatJid: 'web:default', content: 'accepted' })
      : web.handleAgentMessage(new Request('http://internal/agent/default/message', { method: 'POST', body: 'accepted' }), '/agent/default/message');
  const pending = invoke();
  await entered.promise;
  const drain = web.sealAdmissions();
  expect(web.sealAdmissions()).toBe(drain);
  void drain.then(() => { joined = true; });
  const denied = new Request('http://internal/agent/default/message', { method: 'POST', body: 'not read' });
  expect((await web.handleAgentMessage(denied, '/agent/default/message')).status).toBe(503);
  expect(denied.bodyUsed).toBe(false);
  await expect(web.enqueueAgentMessage({ chatJid: 'web:default', content: 'denied' })).rejects.toThrow('sealed');
  await expect(web.runInternalDispatch(() => { calls++; })).rejects.toThrow('sealed');
  expect(joined).toBe(false); expect(calls).toBe(0);
  release.resolve(); await pending; await drain;
  expect(calls).toBe(1); expect(joined).toBe(true);
  await expect(web.runInternalDispatch(() => {})).rejects.toThrow('sealed');
  await web.stop();
});

test('accepted HTTP tail can finish nested direct dispatch after seal, but detached stale context cannot reenter', async () => {
  const web = channel();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const detached = Promise.withResolvers<void>();
  let late!: Promise<unknown>, calls = 0;
  (web as any).agentMessageEntryService = { handleAgentMessage: async () => { calls++; return Response.json({ ok: true }); } };
  web.requestRouter.handle = async () => {
    late = (async () => { await detached.promise; return web.runInternalDispatch(() => { calls++; }); })();
    entered.resolve(); await release.promise;
    return web.handleAgentMessage(new Request('http://internal/agent/default/message'), '/agent/default/message');
  };
  const pending = web.handleRequest(new Request('http://localhost/post'));
  await entered.promise;
  const drain = web.sealAdmissions();
  release.resolve(); expect((await pending).status).toBe(200); await drain;
  detached.resolve(); await expect(late).rejects.toThrow('sealed');
  expect(calls).toBe(1); await web.stop();
});

test('seal joins nested work entered after the first drain snapshot even when its parent returns', async () => {
  const web = channel();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const childRelease = Promise.withResolvers<void>();
  let child!: Promise<void>, joined = false;
  const parent = web.runInternalDispatch(async () => {
    entered.resolve(); await release.promise;
    child = web.runInternalDispatch(() => childRelease.promise);
  });
  await entered.promise;
  const drain = web.sealAdmissions();
  void drain.then(() => { joined = true; });
  release.resolve(); await parent;
  await Promise.resolve(); expect(joined).toBe(false);
  childRelease.resolve(); await child; await drain;
  expect(joined).toBe(true); await web.stop();
});

test('internal callback rejection releases the real seal join without reopening admission', async () => {
  const web = channel(), release = Promise.withResolvers<void>();
  const failure = new Error('control failed');
  const pending = web.runInternalDispatch(async () => { await release.promise; throw failure; });
  const rejected = pending.catch(error => error);
  const drain = web.sealAdmissions();
  release.resolve(); expect(await rejected).toBe(failure); await drain;
  await expect(web.runInternalDispatch(() => {})).rejects.toThrow('sealed');
  await web.stop();
});

test('constructed WebChannel direct requests share the server stop join without starting a listener', async () => {
  const web = new WebChannel({ queue: { enqueue() {} } as any, agentPool: { isStreaming: () => false } as any });
  const entered = Promise.withResolvers<void>();
  const body = Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>();
  let writes = 0;
  web.requestRouter.handle = async req => {
    entered.resolve();
    await req.text();
    writes++;
    return Response.json({ accepted: true });
  };
  const request = new Request('http://localhost/post', { method: 'POST', body: new ReadableStream({ start(controller) { body.resolve(controller); } }) });
  const pending = web.handleRequest(request);
  await entered.promise;
  const stopping = web.stop();
  expect(web.stop()).toBe(stopping);
  let joined = false;
  void stopping.then(() => { joined = true; });
  const denied = new Request('http://localhost/post', { method: 'POST', body: 'never read' });
  expect((await web.handleRequest(denied)).status).toBe(503);
  expect(denied.bodyUsed).toBe(false);
  expect(joined).toBe(false);
  const controller = await body.promise;
  controller.enqueue(new TextEncoder().encode('already entered')); controller.close();
  expect((await pending).status).toBe(200);
  await stopping;
  expect(writes).toBe(1);
  expect((await web.handleRequest(new Request('http://localhost/post'))).status).toBe(503);
  expect(writes).toBe(1);
});
