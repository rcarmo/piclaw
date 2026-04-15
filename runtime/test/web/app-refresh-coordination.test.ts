import { afterEach, expect, test } from 'bun:test';

import { getAppPerfTracing, startAppPerfTrace } from '../../web/src/ui/app-perf-tracing.js';
import {
  isAppChatActivationRecent,
  noteAppChatActivation,
  resetAppRefreshCoordination,
  runCoalescedAppRefresh,
} from '../../web/src/ui/app-refresh-coordination.js';

afterEach(() => {
  resetAppRefreshCoordination();
  getAppPerfTracing().clear();
});

test('noteAppChatActivation marks a chat as recently activated', () => {
  noteAppChatActivation({ chatJid: 'web:branch', nowMs: 100 });

  expect(isAppChatActivationRecent('web:branch', 500, 400)).toBe(true);
  expect(isAppChatActivationRecent('web:branch', 200, 400)).toBe(false);
});

test('runCoalescedAppRefresh reuses the in-flight refresh for the same kind/chat', async () => {
  let release!: () => void;
  let callCount = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const first = runCoalescedAppRefresh({
    kind: 'queue-state',
    chatJid: 'web:branch',
    run: async () => {
      callCount += 1;
      await gate;
      return { ok: true };
    },
  });

  const second = runCoalescedAppRefresh({
    kind: 'queue-state',
    chatJid: 'web:branch',
    run: async () => {
      callCount += 1;
      return { ok: false };
    },
  });

  release();

  expect(await first).toEqual({ ok: true });
  expect(await second).toEqual({ ok: true });
  expect(callCount).toBe(1);
});

test('runCoalescedAppRefresh suppresses immediate duplicate refreshes during a thread switch trace', async () => {
  const traceId = startAppPerfTrace('thread-switch', 'web:branch');
  expect(traceId).toBeTruthy();

  let callCount = 0;
  const first = await runCoalescedAppRefresh({
    kind: 'model-state',
    chatJid: 'web:branch',
    cooldownMs: 20,
    run: async () => {
      callCount += 1;
      return { run: callCount };
    },
  });

  const second = await runCoalescedAppRefresh({
    kind: 'model-state',
    chatJid: 'web:branch',
    cooldownMs: 20,
    run: async () => {
      callCount += 1;
      return { run: callCount };
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 25));

  const third = await runCoalescedAppRefresh({
    kind: 'model-state',
    chatJid: 'web:branch',
    cooldownMs: 20,
    run: async () => {
      callCount += 1;
      return { run: callCount };
    },
  });

  expect(first).toEqual({ run: 1 });
  expect(second).toEqual({ run: 1 });
  expect(third).toEqual({ run: 2 });
  expect(callCount).toBe(2);
});

test('runCoalescedAppRefresh suppresses immediate duplicate refreshes after chat activation even before trace phases settle', async () => {
  noteAppChatActivation({ chatJid: 'web:branch', nowMs: 100 });

  let callCount = 0;
  const first = await runCoalescedAppRefresh({
    kind: 'active-chat-agents',
    chatJid: 'web:branch',
    cooldownMs: 250,
    activationWindowMs: 1_500,
    run: async () => {
      callCount += 1;
      return { run: callCount };
    },
    nowMs: 110,
  });

  const second = await runCoalescedAppRefresh({
    kind: 'active-chat-agents',
    chatJid: 'web:branch',
    cooldownMs: 250,
    activationWindowMs: 1_500,
    run: async () => {
      callCount += 1;
      return { run: callCount };
    },
    nowMs: 150,
  });

  expect(first).toEqual({ run: 1 });
  expect(second).toEqual({ run: 1 });
  expect(callCount).toBe(1);
});
