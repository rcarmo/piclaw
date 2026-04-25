import { expect, test } from 'bun:test';

import {
  applyModelStatePayload,
  handleMessageResponseRefresh,
  loadAgentsBootstrap,
  refreshActiveChatAgents,
  refreshCurrentChatBranches,
  refreshModelState,
  updateAgentProfileFromEvent,
} from '../../web/src/ui/app-auth-bootstrap.js';

test('loadAgentsBootstrap maps agents, user profile, and default branding', async () => {
  let agentsState: Record<string, any> = {};
  let userState = { name: 'You', avatar_url: null, avatar_background: null };
  const brandingCalls: Array<[unknown, unknown]> = [];

  await loadAgentsBootstrap({
    getAgents: async () => ({
      agents: [
        { id: 'default', name: 'Pi Prime', avatar_url: 'default.png' },
        { id: 'writer', name: 'Writer' },
      ],
      user: {
        name: ' Ada ',
        avatar_url: ' avatar.png ',
        avatar_background: ' #111111 ',
      },
    }),
    setAgents: (next) => {
      agentsState = typeof next === 'function' ? next(agentsState) : next;
    },
    setUserProfile: (next) => {
      userState = typeof next === 'function' ? next(userState) : next;
    },
    applyBranding: (name, avatarUrl) => {
      brandingCalls.push([name, avatarUrl]);
    },
  });

  expect(Object.keys(agentsState).sort()).toEqual(['default', 'writer']);
  expect(agentsState.default.name).toBe('Pi Prime');
  expect(userState).toEqual({
    name: 'Ada',
    avatar_url: 'avatar.png',
    avatar_background: '#111111',
  });
  expect(brandingCalls).toEqual([['Pi Prime', 'default.png']]);
});

test('updateAgentProfileFromEvent updates default agent + applies branding cache-bust', () => {
  const agentsRef = {
    current: {
      default: { id: 'default', name: 'Pi', avatar_url: 'old.png' },
    },
  };
  let agentsState = { ...agentsRef.current };
  const brandingCalls: Array<{ name: unknown; avatar: unknown; version: number | null | undefined }> = [];

  updateAgentProfileFromEvent({
    payload: {
      agent_id: 'default',
      agent_name: 'Pi New',
      agent_avatar: 'next.png',
    },
    agentsRef,
    setAgents: (next) => {
      agentsState = typeof next === 'function' ? next(agentsState) : next;
    },
    applyBranding: (name, avatar, version) => {
      brandingCalls.push({ name, avatar, version });
    },
  });

  expect(agentsState.default).toMatchObject({
    name: 'Pi New',
    avatar_url: 'next.png',
  });
  expect(brandingCalls).toHaveLength(1);
  expect(brandingCalls[0].name).toBe('Pi New');
  expect(brandingCalls[0].avatar).toBe('next.png');
  expect(typeof brandingCalls[0].version).toBe('number');
});

test('applyModelStatePayload only applies present model fields', () => {
  const updates: Record<string, unknown> = {
    model: null,
    thinkingLevel: 'unchanged',
    supportsThinking: 'unchanged',
    providerUsage: 'unchanged',
  };

  applyModelStatePayload({
    payload: {
      current: 'gpt-5',
      thinking_level: 'xhigh',
      thinking_level_label: 'max',
      supports_thinking: true,
      provider_usage: { prompt: 100 },
    },
    setActiveModel: (next) => {
      updates.model = typeof next === 'function' ? (next as (prev: unknown) => unknown)(updates.model) : next as unknown;
    },
    setActiveThinkingLevel: (next) => {
      updates.thinkingLevel = typeof next === 'function' ? (next as (prev: unknown) => unknown)(updates.thinkingLevel) : next as unknown;
    },
    setSupportsThinking: (next) => {
      updates.supportsThinking = typeof next === 'function'
        ? (next as (prev: boolean | unknown) => unknown)(updates.supportsThinking as boolean)
        : next;
    },
    setActiveModelUsage: (next) => {
      updates.providerUsage = typeof next === 'function' ? (next as (prev: unknown) => unknown)(updates.providerUsage) : next as unknown;
    },
  });

  expect(updates).toEqual({
    model: 'gpt-5',
    thinkingLevel: 'max',
    supportsThinking: true,
    providerUsage: { prompt: 100 },
  });
});

test('refreshModelState applies the initial payload when the active-chat ref has not been primed yet', async () => {
  const applied: any[] = [];

  refreshModelState({
    currentChatJid: 'web:default',
    getAgentModels: async () => ({ current: null, models: [], model_options: [] }),
    activeChatJidRef: { current: '' },
    applyModelState: (payload) => {
      applied.push(payload);
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(applied).toEqual([{ current: null, models: [], model_options: [] }]);
});

test('refreshModelState applies a null fallback when model refresh fails for the active chat', async () => {
  const applied: any[] = [];

  refreshModelState({
    currentChatJid: 'web:default',
    getAgentModels: async () => {
      throw new Error('network');
    },
    activeChatJidRef: { current: 'web:default' },
    applyModelState: (payload) => {
      applied.push(payload);
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(applied).toEqual([null]);
});

test('refreshCurrentChatBranches clears rows when branch refresh fails', async () => {
  let rows: any[] = [{ chat_jid: 'stale-branch' }];

  refreshCurrentChatBranches({
    currentRootChatJid: 'chat-a',
    getChatBranches: async () => {
      throw new Error('network');
    },
    setCurrentChatBranches: (next) => {
      rows = typeof next === 'function' ? next(rows) : next;
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(rows).toEqual([]);
});

test('handleMessageResponseRefresh triggers queue refresh only for queued responses', () => {
  const counters = {
    active: 0,
    branches: 0,
    context: 0,
    autoresearch: 0,
    queue: 0,
  };

  const run = (response: Record<string, unknown>) => {
    handleMessageResponseRefresh({
      response,
      refreshActiveChatAgents: () => { counters.active += 1; },
      refreshCurrentChatBranches: () => { counters.branches += 1; },
      refreshContextUsage: () => { counters.context += 1; },
      refreshAutoresearchStatus: () => { counters.autoresearch += 1; },
      refreshQueueState: () => { counters.queue += 1; },
    });
  };

  run({ ok: true });
  run({ queued: 'followup' });

  expect(counters).toEqual({
    active: 2,
    branches: 2,
    context: 2,
    autoresearch: 2,
    queue: 1,
  });
});

test('refreshActiveChatAgents merges active + archived branch rows for target chat', async () => {
  let rows: any[] = [];

  refreshActiveChatAgents({
    currentChatJid: 'chat-a',
    getActiveChatAgents: async () => ({
      chats: [
        { chat_jid: 'chat-a', root_chat_jid: 'chat-a', agent_name: 'Primary', is_active: true },
      ],
    }),
    getChatBranches: async () => ({
      chats: [
        { chat_jid: 'chat-a', root_chat_jid: 'chat-a', agent_name: 'Primary branch' },
        { chat_jid: 'chat-b', root_chat_jid: 'chat-a', agent_name: 'Branch', archived_at: '2026-01-01T00:00:00.000Z' },
      ],
    }),
    activeChatJidRef: { current: 'chat-a' },
    setActiveChatAgents: (next) => {
      rows = typeof next === 'function' ? next(rows) : next;
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(rows.map((row) => row.chat_jid).sort()).toEqual(['chat-a', 'chat-b']);
});
