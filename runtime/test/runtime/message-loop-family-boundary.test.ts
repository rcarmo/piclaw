import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempWorkspace, setEnv } from '../helpers.js';
import { withExecutionIdentity, type ExecutionIdentity } from '../../src/core/execution-context.js';

function setup() {
  const workspace = createTempWorkspace('message-loop-boundary-');
  const restore = setEnv({ PICLAW_WORKSPACE: workspace.workspace, PICLAW_STORE: workspace.store, PICLAW_DATA: workspace.data });
  mkdirSync(join(workspace.workspace, '.piclaw'));
  const path = join(workspace.workspace, '.piclaw', 'config.json');
  const configure = (mode: 'single-user' | 'family-shared') => writeFileSync(path, JSON.stringify({ domains: { access: { mode } } }));
  return { path, configure, cleanup: () => { restore(); workspace.cleanup(); } };
}

const familyIdentity: ExecutionIdentity = {
  mode: 'family-shared', username: 'alice', displayName: 'Alice', role: 'member', rootChatJid: 'web:alice',
  provenance: { actorUserId: 'alice', ownerUserId: 'alice', chatJid: 'web:alice', kind: 'interactive', authenticationSessionId: 'login-a' },
};

function processingDeps(calls: string[]) {
  return {
    state: { lastAgentTimestamp: {}, wasCommandProcessed: () => { calls.push('state'); return false; }, markCommandProcessed: () => calls.push('state'), saveTimestamps: () => calls.push('state') },
    assistantName: 'Pi', triggerPattern: /@Pi/i,
    agentPool: { applyControlCommand: async () => calls.push('control'), applySlashCommand: async () => { calls.push('slash'); return {}; }, runAgent: async () => { calls.push('agent'); return { status: 'success' }; } },
  } as any;
}

function loopDeps(calls: string[]) {
  return {
    queue: { enqueue: () => calls.push('enqueue') },
    state: { chatJids: new Set(['wa:test']), lastTimestamp: '', saveTimestamps: () => calls.push('state') },
    assistantName: 'Pi', pollIntervalMs: 1,
    processMessages: async () => { calls.push('process'); return true; },
  } as any;
}

test('message processing and polling deny family mode before state or callbacks', async () => {
  const fixture = setup();
  try {
    fixture.configure('family-shared'); const calls: string[] = [];
    const loop = await import('../../src/runtime/message-loop.js');
    await expect(loop.processMessages('wa:test', processingDeps(calls))).rejects.toThrow('Owner-bound non-web message processing is not available');
    await expect(loop.runMessageLoop(loopDeps(calls))).rejects.toThrow('Owner-bound non-web message processing is not available');
    expect(calls).toEqual([]);
  } finally { fixture.cleanup(); }
});

test('retained family execution context cannot fall through after config changes to single-user', async () => {
  const fixture = setup();
  try {
    fixture.configure('single-user'); const calls: string[] = [];
    const loop = await import('../../src/runtime/message-loop.js');
    await expect(withExecutionIdentity(familyIdentity, () => loop.processMessages('wa:test', processingDeps(calls)))).rejects.toThrow('Owner-bound non-web message processing is not available');
    await expect(withExecutionIdentity(familyIdentity, () => loop.runMessageLoop(loopDeps(calls)))).rejects.toThrow('Owner-bound non-web message processing is not available');
    expect(calls).toEqual([]);
  } finally { fixture.cleanup(); }
});

test('running single-user poll loop stops before another poll after mode changes', async () => {
  const fixture = setup();
  try {
    fixture.configure('single-user'); const calls: string[] = [];
    const loop = await import('../../src/runtime/message-loop.js');
    const running = loop.runMessageLoop(loopDeps(calls));
    fixture.configure('family-shared');
    await expect(running).rejects.toThrow('Owner-bound non-web message processing is not available');
    expect(calls).toEqual([]);
  } finally { fixture.cleanup(); }
});
