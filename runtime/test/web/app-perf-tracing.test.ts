import { afterEach, expect, test } from 'bun:test';

import {
  completeAppPerfTrace,
  completeAppPerfTraceIfReady,
  ensureAppPerfTrace,
  getActiveAppPerfTraceId,
  getAppPerfTracing,
  installAppPerfTracing,
  markAppPerfTrace,
  recordAppPerfRequest,
  startAppPerfTrace,
} from '../../web/src/ui/app-perf-tracing.js';

afterEach(() => {
  getAppPerfTracing().clear();
});

test('app perf tracing reuses active traces per type/chat and completes them with durations', () => {
  const traceId = startAppPerfTrace('thread-switch', 'web:branch', { sourceChatJid: 'web:main' });
  markAppPerfTrace(traceId, 'intent');

  const ensuredId = ensureAppPerfTrace('thread-switch', 'web:branch', { sourceChatJid: 'web:main' });
  expect(ensuredId).toBe(traceId);
  expect(getActiveAppPerfTraceId('thread-switch', 'web:branch')).toBe(traceId);

  completeAppPerfTrace(traceId, 'runtime-hydration-ready');

  const traces = getAppPerfTracing().getTraces();
  expect(traces).toHaveLength(1);
  expect(traces[0]?.status).toBe('completed');
  expect(traces[0]?.phases.map((phase) => phase.phase)).toEqual(['intent', 'runtime-hydration-ready']);
  expect(typeof traces[0]?.durationMs).toBe('number');
  expect(getActiveAppPerfTraceId('thread-switch', 'web:branch')).toBeNull();
});

test('app perf tracing installs a stable window global with stable public method names', () => {
  const runtimeWindow: Record<string, unknown> = {};
  const perf = installAppPerfTracing(runtimeWindow as any);

  expect(runtimeWindow['__PICLAW_PERF__']).toBe(perf);
  expect(typeof (runtimeWindow['__PICLAW_PERF__'] as any)?.getTraces).toBe('function');
  expect(typeof (runtimeWindow['__PICLAW_PERF__'] as any)?.getRequests).toBe('function');
  expect(typeof (runtimeWindow['__PICLAW_PERF__'] as any)?.printSummary).toBe('function');
});

test('app perf tracing only auto-completes once required phases are present', () => {
  const traceId = startAppPerfTrace('thread-switch', 'web:branch');
  markAppPerfTrace(traceId, 'runtime-hydration-ready');
  expect(completeAppPerfTraceIfReady(traceId, ['runtime-hydration-ready', 'timeline-first-paint'])).toBe(false);

  markAppPerfTrace(traceId, 'timeline-first-paint');
  expect(completeAppPerfTraceIfReady(traceId, ['runtime-hydration-ready', 'timeline-first-paint'])).toBe(true);

  const traces = getAppPerfTracing().getTraces();
  expect(traces[0]?.status).toBe('completed');
  expect(traces[0]?.phases.map((phase) => phase.phase)).toEqual([
    'runtime-hydration-ready',
    'timeline-first-paint',
    'settled',
  ]);
});

test('app perf tracing cancels the previous active trace when a new trace starts for the same type/chat', () => {
  const firstTraceId = startAppPerfTrace('thread-switch', 'web:branch');
  markAppPerfTrace(firstTraceId, 'intent');

  const secondTraceId = startAppPerfTrace('thread-switch', 'web:branch');

  const traces = getAppPerfTracing().getTraces();
  expect(traces).toHaveLength(2);
  expect(traces[0]?.id).toBe(firstTraceId);
  expect(traces[0]?.status).toBe('cancelled');
  expect(traces[0]?.phases.map((phase) => phase.phase)).toEqual(['intent', 'superseded']);
  expect(traces[1]?.id).toBe(secondTraceId);
  expect(traces[1]?.status).toBe('active');
  expect(getActiveAppPerfTraceId('thread-switch', 'web:branch')).toBe(secondTraceId);
});

test('app perf tracing stores bounded request samples', () => {
  const requestId = recordAppPerfRequest({
    method: 'GET',
    url: '/agent/models?chat_jid=web%3Abranch',
    startedAt: 10,
    durationMs: 42,
    status: 200,
    ok: true,
    requestId: 'req_backend_123',
    serverTiming: 'app;dur=21.5, agent_models;dur=9.7',
    detail: { chatJid: 'web:branch' },
  });

  const requests = getAppPerfTracing().getRequests();
  expect(requests).toHaveLength(1);
  expect(requests[0]?.id).toBe(requestId);
  expect(requests[0]?.requestId).toBe('req_backend_123');
  expect(requests[0]?.serverTiming).toBe('app;dur=21.5, agent_models;dur=9.7');
  expect(requests[0]?.detail).toEqual({ chatJid: 'web:branch' });
});
