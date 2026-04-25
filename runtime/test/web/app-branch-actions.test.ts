import { expect, test } from 'bun:test';

import {
  closeRenameBranchForm,
  openRenameBranchForm,
  pruneCurrentBranch,
  renameCurrentBranch,
  restoreBranch,
  runBranchLoader,
} from '../../web/src/ui/app-branch-actions.js';

function createRef<T>(value: T) {
  return { current: value };
}

test('openRenameBranchForm respects shared locks and primes the current handle', () => {
  const drafts: string[] = [];
  const openStates: boolean[] = [];
  const formLock = { inFlight: false, cooldownUntil: 0 };

  expect(openRenameBranchForm({
    hasWindow: true,
    currentBranchRecord: { chat_jid: 'web:branch', agent_name: 'feature' },
    renameBranchInFlight: false,
    renameBranchLockUntil: 0,
    getFormLock: () => formLock,
    setRenameBranchNameDraft: (value: string) => drafts.push(value),
    setIsRenameBranchFormOpen: (value: boolean) => openStates.push(value),
    now: 100,
  })).toBe(true);
  expect(drafts).toEqual(['feature']);
  expect(openStates).toEqual([true]);

  formLock.inFlight = true;
  expect(openRenameBranchForm({
    hasWindow: true,
    currentBranchRecord: { chat_jid: 'web:branch', agent_name: 'feature' },
    renameBranchInFlight: false,
    renameBranchLockUntil: 0,
    getFormLock: () => formLock,
    setRenameBranchNameDraft: (value: string) => drafts.push(value),
    setIsRenameBranchFormOpen: (value: boolean) => openStates.push(value),
    now: 100,
  })).toBe(false);
});

test('closeRenameBranchForm resets modal state', () => {
  const states: unknown[] = [];
  closeRenameBranchForm({
    setIsRenameBranchFormOpen: (value: boolean) => states.push(value),
    setRenameBranchNameDraft: (value: string) => states.push(value),
  });
  expect(states).toEqual([false, '']);
});

test('renameCurrentBranch validates, renames, and updates shared locks', async () => {
  const toasts: Array<[string, string, string, number]> = [];
  const refreshes: string[] = [];
  const renameBranchInFlightRef = createRef(false);
  const renameBranchLockUntilRef = createRef(0);
  const formLock = { inFlight: false, cooldownUntil: 0 };
  const closeCalls: string[] = [];
  const renamingStates: boolean[] = [];
  const nowValues = [100, 150];

  const renamed = await renameCurrentBranch({
    hasWindow: true,
    currentBranchRecord: { chat_jid: 'web:branch', agent_name: 'current' },
    nextName: 'Next Handle',
    openRenameForm: () => closeCalls.push('open'),
    renameBranchInFlightRef,
    renameBranchLockUntilRef,
    getFormLock: () => formLock,
    setIsRenamingBranch: (value: boolean) => renamingStates.push(value),
    renameChatBranch: async (_chatJid: string, payload: { agentName: string }) => {
      expect(payload.agentName).toBe('next-handle');
      return { branch: { agent_name: 'next-handle' } };
    },
    refreshActiveChatAgents: async () => { refreshes.push('active'); },
    refreshCurrentChatBranches: async () => { refreshes.push('branches'); },
    showIntentToast: (title: string, message: string, kind: string, timeout: number) => {
      toasts.push([title, message, kind, timeout]);
    },
    closeRenameForm: () => closeCalls.push('close'),
    now: () => nowValues.shift() ?? 200,
  });

  expect(renamed).toBe(true);
  expect(refreshes.sort()).toEqual(['active', 'branches']);
  expect(closeCalls).toContain('close');
  expect(renamingStates).toEqual([true, false]);
  expect(toasts).toContainEqual(['Branch renamed', '@next-handle', 'info', 3500]);
  expect(renameBranchInFlightRef.current).toBe(false);
  expect(formLock.inFlight).toBe(false);
  expect(renameBranchLockUntilRef.current).toBe(1050);
  expect(formLock.cooldownUntil).toBe(1050);
});

test('pruneCurrentBranch archives non-default root sessions, blocks the default root, and navigates on success', async () => {
  const toasts: Array<[string, string, string, number]> = [];
  const navigateCalls: string[] = [];

  const rejected = await pruneCurrentBranch({
    hasWindow: true,
    currentChatJid: 'web:default',
    currentBranchRecord: { chat_jid: 'web:default', root_chat_jid: 'web:default', agent_name: 'default' },
    currentChatBranches: [],
    activeChatAgents: [],
    pruneChatBranch: async () => {},
    refreshActiveChatAgents: async () => {},
    refreshCurrentChatBranches: async () => {},
    showIntentToast: (title: string, message: string, kind: string, timeout: number) => {
      toasts.push([title, message, kind, timeout]);
    },
    baseHref: 'https://example.test/?chat_jid=web%3Adefault',
    chatOnlyMode: true,
    navigate: (url: string) => navigateCalls.push(url),
    confirm: () => true,
  });
  expect(rejected).toBe(false);
  expect(toasts[0]).toEqual(['Cannot archive session', 'The default chat session cannot be archived.', 'warning', 4000]);

  toasts.length = 0;
  const archivedRoot = await pruneCurrentBranch({
    hasWindow: true,
    currentChatJid: 'web:root',
    currentBranchRecord: { chat_jid: 'web:root', root_chat_jid: 'web:root', agent_name: 'root' },
    currentChatBranches: [{ chat_jid: 'web:root', root_chat_jid: 'web:root', agent_name: 'root' }],
    activeChatAgents: [],
    pruneChatBranch: async (chatJid: string) => { expect(chatJid).toBe('web:root'); },
    refreshActiveChatAgents: async () => {},
    refreshCurrentChatBranches: async () => {},
    showIntentToast: (title: string, message: string, kind: string, timeout: number) => {
      toasts.push([title, message, kind, timeout]);
    },
    baseHref: 'https://example.test/?chat_jid=web%3Aroot',
    chatOnlyMode: true,
    navigate: (url: string) => navigateCalls.push(url),
    confirm: () => true,
  });
  expect(archivedRoot).toBe(true);
  expect(toasts).toContainEqual(['Session archived', '@root — web:root has been archived.', 'info', 3000]);
  expect(navigateCalls[navigateCalls.length - 1]).toContain('chat_jid=web%3Adefault');

  toasts.length = 0;
  const pruned = await pruneCurrentBranch({
    hasWindow: true,
    currentChatJid: 'web:branch',
    currentBranchRecord: { chat_jid: 'web:branch', root_chat_jid: 'web:root', agent_name: 'feature' },
    currentChatBranches: [],
    activeChatAgents: [],
    pruneChatBranch: async (chatJid: string) => { expect(chatJid).toBe('web:branch'); },
    refreshActiveChatAgents: async () => {},
    refreshCurrentChatBranches: async () => {},
    showIntentToast: (title: string, message: string, kind: string, timeout: number) => {
      toasts.push([title, message, kind, timeout]);
    },
    baseHref: 'https://example.test/?chat_jid=web%3Abranch',
    chatOnlyMode: true,
    navigate: (url: string) => navigateCalls.push(url),
    confirm: () => true,
  });

  expect(pruned).toBe(true);
  expect(toasts).toContainEqual(['Branch pruned', '@feature — web:branch has been archived.', 'info', 3000]);
  expect(navigateCalls[navigateCalls.length - 1]).toContain('chat_jid=web%3Aroot');
});

test('pruneCurrentBranch blocks archiving a root session while child branches still exist', async () => {
  const toasts: Array<[string, string, string, number]> = [];

  const result = await pruneCurrentBranch({
    hasWindow: true,
    currentChatJid: 'web:root',
    currentBranchRecord: { chat_jid: 'web:root', root_chat_jid: 'web:root', agent_name: 'root' },
    currentChatBranches: [
      { chat_jid: 'web:root', root_chat_jid: 'web:root', agent_name: 'root' },
      { chat_jid: 'web:root:branch:1', root_chat_jid: 'web:root', agent_name: 'child' },
    ],
    activeChatAgents: [],
    pruneChatBranch: async () => {
      throw new Error('should not prune');
    },
    refreshActiveChatAgents: async () => {},
    refreshCurrentChatBranches: async () => {},
    showIntentToast: (title: string, message: string, kind: string, timeout: number) => {
      toasts.push([title, message, kind, timeout]);
    },
    baseHref: 'https://example.test/?chat_jid=web%3Aroot',
    chatOnlyMode: true,
    navigate: () => undefined,
    confirm: () => true,
  });

  expect(result).toBe(false);
  expect(toasts).toEqual([
    ['Cannot archive session', 'Archive or delete the child branch sessions first.', 'warning', 4500],
  ]);
});

test('restoreBranch shows collision-aware messaging and navigates to restored branch', async () => {
  const toasts: Array<[string, string, string, number]> = [];
  const navigateCalls: string[] = [];

  const restored = await restoreBranch({
    targetChatJid: 'web:archived',
    restoreChatBranch: async () => ({ branch: { chat_jid: 'web:restored', agent_name: 'feature-2' } }),
    currentChatBranches: [{ chat_jid: 'web:archived', agent_name: 'feature', archived_at: '2026-03-29T00:00:00Z' }],
    refreshActiveChatAgents: async () => {},
    refreshCurrentChatBranches: async () => {},
    showIntentToast: (title: string, message: string, kind: string, timeout: number) => {
      toasts.push([title, message, kind, timeout]);
    },
    baseHref: 'https://example.test/?chat_jid=web%3Aroot',
    chatOnlyMode: true,
    navigate: (url: string) => navigateCalls.push(url),
  });

  expect(restored).toBe(true);
  expect(toasts[0]?.[0]).toBe('Branch restored');
  expect(toasts[0]?.[1]).toContain('Restored archived @feature as @feature-2');
  expect(navigateCalls[0]).toContain('chat_jid=web%3Arestored');
});

test('runBranchLoader redirects on success and reports errors when the fork fails', async () => {
  const states: Array<{ status: string; message: string }> = [];
  const navigateCalls: Array<[string, unknown]> = [];

  const ok = await runBranchLoader({
    branchLoaderSourceChatJid: 'web:source',
    forkChatBranch: async () => ({ branch: { chat_jid: 'web:new-branch' } }),
    setBranchLoaderState: (value: { status: string; message: string }) => states.push(value),
    navigate: (url: string, options?: unknown) => navigateCalls.push([url, options]),
    baseHref: 'https://example.test/?branch_loader=1&branch_source_chat_jid=web%3Asource',
    isCancelled: () => false,
  });

  expect(ok).toBe(true);
  expect(states[0]).toEqual({ status: 'running', message: 'Preparing a new chat branch…' });
  expect(navigateCalls[0]?.[0]).toContain('chat_jid=web%3Anew-branch');
  expect(navigateCalls[0]?.[1]).toEqual({ replace: true });

  states.length = 0;
  const failed = await runBranchLoader({
    branchLoaderSourceChatJid: 'web:source',
    forkChatBranch: async () => { throw new Error('Popup blocked'); },
    setBranchLoaderState: (value: { status: string; message: string }) => states.push(value),
    navigate: () => undefined,
    baseHref: 'https://example.test/?branch_loader=1',
    isCancelled: () => false,
  });

  expect(failed).toBe(false);
  expect(states[1]?.status).toBe('error');
  expect(states[1]?.message).toContain('Popup blocked');
});
