import { handleAgentMessage } from '../../../src/channels/web/handlers/agent.js';
import { AgentStatusStore } from '../../../src/channels/web/agent/agent-status-store.js';
import { handleAgentStatusRequest } from '../../../src/channels/web/agent/agent-status.js';
import { createNativeTurnView } from '../../../src/channels/web/agent/native-turn-view.js';

// Disposable production handler/store; only the SDK operation/publication are held.
// Compaction status comes from the production native turn view, as in the app:
// the SDK's live document lists the compaction while it runs (#1650).
export function manualCompactionBackend() {
  const events: Array<{ type: string; data: any }> = [];
  let release!: (value: any) => void;
  let publish!: () => void;
  let active = false;
  let aborts = 0;
  let messageId = 456;
  const store = new AgentStatusStore();
  let compacting = false;
  let observe!: ReturnType<typeof createNativeTurnView>;
  const live = () => observe({ conversation: { id: 1 }, entries: [], docs: { 'pi.live': compacting ? { compactions: [{ taskId: 1 }] } : {} } });
  const channel: any = {
    agentPool: {
      isStreaming: () => false, isActive: () => active,
      applyControlCommand: async (_chat: string, command: any) => {
        if (command.type === 'abort') {
          aborts++; active = false; compacting = false; release({ status: 'error', message: 'Compaction cancelled.' });
          return { status: 'success', message: 'Compaction aborted.' };
        }
        if (command.type === 'stats') return { status: 'success', message: 'Stats result' };
        const held = new Promise(resolve => { release = resolve; });
        if (command.type === 'compact') { compacting = true; live(); }
        return held;
      },
    },
    json: (body: any, status = 200) => Response.json(body, { status }),
    getQueuedFollowupCount: () => 0,
    broadcastEvent(type: string, data: any) { events.push({ type, data }); },
    getAgentStatus: (chat: string) => store.get(chat),
    updateAgentStatus(chat: string, data: any) { store.update(chat, data); },
    // Controls persist their timeline row through the same admission port as input.
    admitMessage: async (_chat: string, content: string) => ({ id: messageId++, timestamp: new Date(Date.UTC(2026, 9, 15, 12, 0, 0, messageId)).toISOString(), data: { thread_id: null }, content }),
    sendMessage: async () => {
      events.push({ type: 'agent_response', data: { chat_jid: 'web:hook-fixture', id: 457, content: 'Command result' } });
      await new Promise<void>(resolve => { publish = resolve; });
    },
  };
  observe = createNativeTurnView(null as any, channel, 'web:hook-fixture');
  const context: any = {
    defaultChatJid: 'web:hook-fixture', json: channel.json, getAgentStatus: channel.getAgentStatus,
    getExtensionWorkingState: () => null, recoverStaleInflightRun() { throw Error('Unexpected recovery'); }, getBuffer: () => undefined,
  };
  return {
    events, get aborts() { return aborts; },
    finish(status: string) { active = false; compacting = false; release({ status, message: `Compaction ${status}` }); },
    // Publishing the command result ends the turn; the live view then reports idle
    // unless a compaction is still running (an earlier command can publish late).
    publish() { publish(); if (!compacting) live(); },
    async fetch(request: Request): Promise<Response | null> {
      const path = new URL(request.url).pathname;
      if (path === '/manual') return handleAgentMessage(channel, request, '/agent/default/message', 'web:hook-fixture', 'default');
      if (path === '/status') return handleAgentStatusRequest(request, context);
      return null;
    },
    cleanup() { store.dispose(); },
  };
}
