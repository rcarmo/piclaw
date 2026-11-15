import './src/test-guard.js';
import { expect } from 'bun:test';
import { isolatedApplicationTest } from './src/isolated-application-test.js';
import { nativeGoalFixture } from './src/native-goal-default-fixture.js';
const applicationTest = isolatedApplicationTest(import.meta.url);

applicationTest('native Goal finalization uses the current SDK Plan, not a legacy global or missing addon', async () => {
  const key = '__piclaw_planSidebarApi', prior = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { configurable: true, value: { getPlan() { throw Error('Legacy Plan must not supply native finalization'); } } });
  let finalization = false;
  const program = (attempt: number, transcript: any) => {
    if (attempt === 1) return [{ type: 'toolCall', id: 'finish-plan', name: 'plan', arguments: { action: 'update', plan: [{ step: 'Core completion audit', status: 'completed' }] } }];
    if (attempt === 3) {
      const texts = transcript.messages.flatMap((message: any) => typeof message.content === 'string' ? [message.content] : (message.content ?? []).filter((part: any) => part.type === 'text').map((part: any) => part.text));
      finalization = texts.some((text: string) => text.includes('Completed plan snapshot:\n1. [completed] Core completion audit'));
      expect(finalization).toBe(true);
      return [{ type: 'toolCall', id: 'verify-goal', name: 'goal_complete', arguments: { summary: 'Core Plan and native finalization agree', evidence: ['The SDK document supplied the completed-plan snapshot in the actual request'] } }];
    }
    return [{ type: 'text', text: attempt === 2 ? 'Candidate achieved.' : 'Goal complete.' }];
  };
  const f = await nativeGoalFixture(false, false, program);
  try {
    await f.command('/goal Complete the Core Plan audit'); await f.entered.promise; f.held.release();
    await f.until(() => f.state()?.status === 'complete');
    await f.until(() => f.root.query("SELECT 1 FROM messages WHERE is_terminal_agent_reply=1 AND content='Goal complete.'").get() !== null);
    expect(finalization).toBe(true); expect(f.calls()).toBe(4);
    expect(f.state()).toMatchObject({ status: 'complete', completion_summary: 'Core Plan and native finalization agree', tokens_used: 8 });
    expect(f.root.query("SELECT * FROM extension_kv WHERE extension_id='plan-sidebar'").all()).toEqual([]);
    expect(f.root.query('SELECT * FROM service_effect_s01_operations').all()).toEqual([]);
    expect(f.root.query('SELECT * FROM service_effect_s02_commits').all()).toEqual([]);
  } finally { await f.close(); if (prior) Object.defineProperty(globalThis, key, prior); else Reflect.deleteProperty(globalThis, key); }
}, 30000);
