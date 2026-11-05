import { describe, expect, test } from 'bun:test';
import { WebChannelRuntimeStateService } from '../../../../src/channels/web/runtime/runtime-state-service.js';

describe('web SDK observation state', () => {
  test('only SDK observations update status; host intents and terminal guesses cannot replace them', () => {
    const statuses = new Map<string, Record<string, unknown>>();
    const store = {
      update(chat: string, value: Record<string, unknown>) { expect(this).toBe(store); statuses.set(chat, value); },
      get(chat: string) { expect(this).toBe(store); return statuses.get(chat) ?? null; },
      dispose() { expect(this).toBe(store); statuses.clear(); },
    };
    const service = new WebChannelRuntimeStateService({ agentStatusStore: store });
    try {
      for (const intent_key of ['native_task', 'compaction', 'session_rotation']) {
        service.updateAgentStatus('chat', { type: 'intent', intent_key, title: 'Working' });
        expect(service.getAgentStatus('chat')).toBeNull();
      }
      service.updateAgentStatus('chat', { sdk_observation: true, type: 'thinking', state: 'active' });
      service.updateAgentStatus('chat', { type: 'done' });
      expect(service.getAgentStatus('chat')).toMatchObject({ type: 'thinking', state: 'active' });
      service.updateAgentStatus('chat', { sdk_observation: true, type: 'done', state: 'idle' });
      expect(service.getAgentStatus('chat')).toMatchObject({ type: 'done', state: 'idle' });
      for (const name of ['resumeChat', 'resumePendingChats', 'loadState', 'saveState', 'getContextUsage', 'setContextUsage'])
        expect(service).not.toHaveProperty(name);
    } finally { service.dispose(); }
    service.updateAgentStatus('chat', { sdk_observation: true, type: 'thinking' });
    expect(service.getAgentStatus('chat')).toBeNull();
    expect(statuses.size).toBe(0);
    service.dispose();
  });

  test('panel state and draft/thought buffers retain the injected observer receiver', () => {
    const panels = new Map<string, boolean>();
    const buffers = new Map<string, { text: string; totalLines: number }>();
    const observer = {
      setPanelExpanded(turn: string, panel: string, expanded: boolean) { expect(this).toBe(observer); panels.set(`${turn}:${panel}`, expanded); },
      isPanelExpanded(turn: string, panel: string) { expect(this).toBe(observer); return panels.get(`${turn}:${panel}`) ?? false; },
      updateBuffer(turn: string, panel: string, text: string, totalLines: number) { expect(this).toBe(observer); buffers.set(`${turn}:${panel}`, { text, totalLines }); },
      getBuffer(turn: string, panel: string) { expect(this).toBe(observer); return buffers.get(`${turn}:${panel}`); },
    };
    const service = new WebChannelRuntimeStateService({ agentBuffers: observer });
    try {
      service.setPanelExpanded('turn', 'thought', true);
      service.updateThoughtBuffer('turn', 'thought', 1);
      service.updateDraftBuffer('turn', 'draft', 2);
      expect(service.isPanelExpanded('turn', 'thought')).toBe(true);
      expect(service.isPanelExpanded('turn', 'draft')).toBe(false);
      expect(service.getBuffer('turn', 'thought')).toEqual({ text: 'thought', totalLines: 1 });
      expect(service.getBuffer('turn', 'draft')).toEqual({ text: 'draft', totalLines: 2 });
    } finally { service.dispose(); }
  });
});
