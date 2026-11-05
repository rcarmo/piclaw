import '../../helpers.js';
import { expect, test } from 'bun:test';
import { handleAgentMessage } from '../../../src/channels/web/handlers/agent.js';

for (const command of ['/compact', '/new-session']) for (const tokens of [null, 0, 42]) {
  test(`${command} reports authoritative context ${tokens} without taking SDK lifecycle ownership`, async () => {
    const entered = Promise.withResolvers<void>(), held = Promise.withResolvers<any>();
    const events: Array<{ type: string; data: any }> = [], writes: any[] = [];
    let status: Record<string, unknown> = { sdk_observation: true, type: 'thinking', turn_id: 'sdk-original' };
    const channel: any = {
      agentPool: {
        getSessionGenerationForChat: () => 'stable-session',
        getAvailableModels: async () => ({ models: [] }),
        applyControlCommand: async () => { entered.resolve(); return held.promise; },
        getContextUsageForChat: async () => { throw Error('Authoritative context cannot fall back to an estimate'); },
      },
      admitMessage: async () => ({ id: 17, timestamp: '2026-01-01', data: { thread_id: null } }),
      sendMessage: async () => {},
      getAgentStatus: () => status,
      updateAgentStatus: (_chat: string, value: any) => { writes.push(value); status = value; },
      broadcastEvent: (type: string, data: any) => events.push({ type, data }),
      json: (body: unknown, code = 200) => Response.json(body, { status: code }),
    };
    const pending = handleAgentMessage(channel, new Request('https://fixture/agent/default/message', {
      method: 'POST', body: JSON.stringify({ content: command }),
    }), '/agent/default/message', 'web:test', 'default');
    await entered.promise;
    expect(writes).toEqual([]);
    // A real SDK watch may advance independently while command publication waits.
    status = { sdk_observation: true, type: 'tool_call', turn_id: 'sdk-successor' };
    held.resolve({ status: 'success', message: 'Context updated.', contextUsage: {
      tokens, contextWindow: 10000, percent: tokens === null ? null : tokens / 100,
      sessionGeneration: 'stable-session', tokensAreAuthoritative: true,
    } });
    const response = await pending, body = await response.json();
    expect(response.status).toBe(201);
    expect(status).toMatchObject({ type: 'tool_call', turn_id: 'sdk-successor' }); expect(writes).toEqual([]);
    expect(events.filter(event => event.type === 'agent_status').map(event => event.data)).toEqual([
      expect.objectContaining({ type: 'context_usage', context_usage: expect.objectContaining({
        tokens, contextWindow: 10000, percent: tokens === null ? null : tokens / 100,
        sessionGeneration: 'stable-session', contextUpdate: 'replace',
      }) }),
    ]);
    expect(body.command.contextUsage).toMatchObject({ tokens, contextUpdate: 'replace' });
    expect(JSON.stringify(body)).not.toContain('tokensAreAuthoritative');
    expect(JSON.stringify(events)).not.toContain('tokensAreAuthoritative');
  });
}
