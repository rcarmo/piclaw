import { expect, test } from 'bun:test';
import { handleAgentMessage } from '../../../src/channels/web/handlers/agent.js';
import { AgentStatusStore } from '../../../src/channels/web/agent/agent-status-store.js';
import { handleAgentStatusRequest, handleAgentUiSnapshotRequest } from '../../../src/channels/web/agent/agent-status.js';

function gate<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>(resolve => { release = resolve; });
  return { promise, release };
}

for (const terminal of ['success', 'error', 'cancelled'] as const) {
  test(`manual compaction status owns startup, held operation and terminal handoff: ${terminal}`, async () => {
    // Exercise production command handler, status store and both HTTP status
    // shapes. Only the model/control operation is held; no provider or live DB.
    const started = gate<void>();
    const result = gate<any>();
    const publish = gate<void>();
    const publishing = gate<void>();
    const store = new AgentStatusStore();
    let physicallyCompacting = false;
    let abortCalls = 0;
    const channel = {
      agentPool: {
        isStreaming: () => false, isActive: () => physicallyCompacting,
        applyControlCommand: async (_chat: string, command: any) => {
          if (command.type === 'abort') {
            abortCalls++;
            expect(physicallyCompacting).toBe(true);
            physicallyCompacting = false;
            result.release({ status: 'error', message: 'Compaction cancelled.' });
            return { status: 'success', message: 'Compaction aborted.' };
          }
          expect(command.type).toBe('compact');
          started.release();
          return result.promise;
        },
      },
      json: (body: unknown, status = 200) => Response.json(body, { status }),
      getQueuedFollowupCount: () => 0, broadcastEvent() {},
      getAgentStatus: (chat: string) => store.get(chat),
      updateAgentStatus: (chat: string, payload: any) => store.update(chat, payload),
      admitUserMessage: async () => ({ id: 456, timestamp: '2026-10-15T12:00:00.000Z', data: { thread_id: null }, content: '/compact' }),
      sendMessage: async () => { publishing.release(); await publish.promise; },
    } as any;
    const context = {
      defaultChatJid: 'web:default', json: channel.json,
      getAgentStatus: channel.getAgentStatus, getExtensionWorkingState: () => null,
      recoverStaleInflightRun: () => { throw Error('Active command must not trigger stale-run recovery'); },
      getBuffer: () => undefined, getContextUsageForChat: async () => null,
      getTokenUsageForChat: () => null, getAvailableModels: async () => ({}),
      getProviderReadyCompletedForInstance: () => false,
      getAddonApiHealthSnapshot: () => ({}), getMcpStartupDiagnostics: () => [],
    } as any;
    const request = (content: string) => new Request('https://fixture.invalid/agent/default/message', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }),
    });
    const poll = async () => {
      const plain = await handleAgentStatusRequest(new Request('https://fixture.invalid/agent/status'), context).json();
      const envelope = await (await handleAgentUiSnapshotRequest(new Request('https://fixture.invalid/agent/status?ui=1'), context,
        { getSystemMetrics: async () => ({}), getAgentName: () => 'Fixture' })).json();
      expect(envelope.status).toEqual(plain);
      return plain;
    };
    const command = handleAgentMessage(channel, request('/compact'), '/agent/default/message', 'web:default', 'default');
    try {
      await started.promise;
      // Startup gap: the command intent is authoritative even before the SDK
      // reports isCompacting, rather than exposing an inactive pool as idle.
      const initial = await poll();
      expect(initial).toMatchObject({ status: 'active', data: { type: 'intent', intent_key: 'compaction' } });
      const turnId = initial.data.turn_id;
      physicallyCompacting = true;
      for (let i = 0; i < 3; i++) {
        expect(await poll()).toMatchObject({ status: 'active', data: { turn_id: turnId, intent_key: 'compaction' } });
      }
      if (terminal === 'cancelled') {
        const stopped = await handleAgentMessage(channel, request('/abort'), '/agent/default/message', 'web:default', 'default');
        expect((await stopped.json()).ui_only).toBe(true);
        expect(abortCalls).toBe(1);
      } else {
        physicallyCompacting = false;
        result.release({ status: terminal, message: terminal === 'success' ? 'Compaction complete.' : 'Compaction failed.' });
      }
      await publishing.promise;
      // Result publication can itself await I/O. Keep ownership until the
      // actual command terminal event is emitted, not pool.isActive=false.
      expect(await poll()).toMatchObject({ status: 'active', data: { turn_id: turnId, intent_key: 'compaction' } });
      publish.release();
      expect((await command).status).toBe(201);
      expect(await poll()).toMatchObject({ status: 'idle', data: { turn_id: turnId, type: terminal === 'success' ? 'done' : 'error' } });
    } finally {
      result.release({ status: 'error', message: 'Test cleanup' });
      publish.release();
      await command;
      store.dispose();
    }
  });
}
