import { expect, test } from 'bun:test';

import {
  hasActiveTextSelection,
  isEligibleChatSwipeTarget,
  resolveAdjacentSwipeChatJid,
  resolveSwipeableChatAgents,
  resolveSwipeNeighbours,
  shouldTriggerTouchChatSwipe,
} from '../../web/src/ui/chat-swipe-navigation.js';

test('resolveSwipeableChatAgents uses a stable sort independent of currentChatJid', () => {
  const candidates = [
    { chat_jid: 'web:current', is_active: false },
    { chat_jid: 'web:a', is_active: true },
    { chat_jid: 'web:b', is_active: false },
    { chat_jid: 'web:c', archived_at: '2026-01-01' },
  ];
  // Active agents first, then inactive, both alpha-sorted; same regardless of which is current
  expect(resolveSwipeableChatAgents(candidates, 'web:current')).toEqual(['web:a', 'web:b', 'web:current']);
  expect(resolveSwipeableChatAgents(candidates, 'web:a')).toEqual(['web:a', 'web:b', 'web:current']);
});

test('resolveSwipeableChatAgents loops consistently as a carousel', () => {
  const candidates = [
    { chat_jid: 'web:a', is_active: true },
    { chat_jid: 'web:b', is_active: true },
    { chat_jid: 'web:c', is_active: true },
  ];
  // Order stays [a, b, c] regardless of which is current
  expect(resolveSwipeableChatAgents(candidates, 'web:a')).toEqual(['web:a', 'web:b', 'web:c']);
  expect(resolveSwipeableChatAgents(candidates, 'web:b')).toEqual(['web:a', 'web:b', 'web:c']);
  expect(resolveSwipeableChatAgents(candidates, 'web:c')).toEqual(['web:a', 'web:b', 'web:c']);
});

test('resolveSwipeNeighbours returns agent names for prev and next', () => {
  const candidates = [
    { chat_jid: 'web:a', agent_name: 'Alpha', is_active: true },
    { chat_jid: 'web:b', agent_name: 'Beta', is_active: true },
    { chat_jid: 'web:c', agent_name: 'Gamma', is_active: false },
  ];
  const result = resolveSwipeNeighbours({ candidates, currentChatJid: 'web:b' });
  expect(result.prev?.chatJid).toBe('web:a');
  expect(result.prev?.name).toBe('Alpha');
  expect(result.next?.chatJid).toBe('web:c');
  expect(result.next?.name).toBe('Gamma');
});

test('resolveAdjacentSwipeChatJid loops like a carousel (wraps at both ends)', () => {
  const candidates = [
    { chat_jid: 'web:a', is_active: true },
    { chat_jid: 'web:b', is_active: true },
    { chat_jid: 'web:c', is_active: true },
  ];
  // Stable order: a, b, c
  expect(resolveAdjacentSwipeChatJid({ candidates, currentChatJid: 'web:a', direction: 'next' })).toBe('web:b');
  expect(resolveAdjacentSwipeChatJid({ candidates, currentChatJid: 'web:b', direction: 'next' })).toBe('web:c');
  expect(resolveAdjacentSwipeChatJid({ candidates, currentChatJid: 'web:c', direction: 'next' })).toBe('web:a'); // wraps
  expect(resolveAdjacentSwipeChatJid({ candidates, currentChatJid: 'web:a', direction: 'prev' })).toBe('web:c'); // wraps
  expect(resolveAdjacentSwipeChatJid({ candidates, currentChatJid: 'web:b', direction: 'prev' })).toBe('web:a');
});

test('shouldTriggerTouchChatSwipe requires sufficient horizontal distance and axis ratio', () => {
  expect(shouldTriggerTouchChatSwipe({ dx: 120, dy: 20 })).toBe(true);
  expect(shouldTriggerTouchChatSwipe({ dx: 50, dy: 4 })).toBe(false);  // too short
  expect(shouldTriggerTouchChatSwipe({ dx: 120, dy: 110 })).toBe(false); // too vertical
  // slow swipes should still trigger if distance is sufficient
  expect(shouldTriggerTouchChatSwipe({ dx: 120, dy: 20, elapsedMs: 3000 })).toBe(true);
});

test('isEligibleChatSwipeTarget ignores compose, post content, and other interactive controls', () => {
  const allowedTarget = {
    closest: (_selector: string) => null,
  };
  const blockedComposeTarget = {
    closest: (selector: string) => {
      if (selector.includes('.compose-box')) {
        return { closest: (_s: string) => null } as unknown as Element;
      }
      return null;
    },
  };
  const blockedPostContentTarget = {
    closest: (selector: string) => {
      if (selector.includes('.post-content')) {
        return { closest: (_s: string) => null } as unknown as Element;
      }
      return null;
    },
  };

  expect(isEligibleChatSwipeTarget(allowedTarget)).toBe(true);
  expect(isEligibleChatSwipeTarget(blockedComposeTarget)).toBe(false);
  expect(isEligibleChatSwipeTarget(blockedPostContentTarget)).toBe(false);
});

test('isEligibleChatSwipeTarget allows swipe on agent-thinking buttons', () => {
  const thinkingButton = {
    closest: (selector: string) => {
      if (selector.includes('button')) return {
        closest: (s: string) => s.includes('.agent-thinking') ? ({} as Element) : null,
      } as unknown as Element;
      return null;
    },
  };
  expect(isEligibleChatSwipeTarget(thinkingButton)).toBe(true);
});

test('hasActiveTextSelection only returns true for non-collapsed non-empty selections', () => {
  expect(hasActiveTextSelection({
    getSelection: () => ({ isCollapsed: false, toString: () => 'selected text' }),
  } as unknown as Window)).toBe(true);
  expect(hasActiveTextSelection({
    getSelection: () => ({ isCollapsed: true, toString: () => 'selected text' }),
  } as unknown as Window)).toBe(false);
  expect(hasActiveTextSelection({
    getSelection: () => ({ isCollapsed: false, toString: () => '   ' }),
  } as unknown as Window)).toBe(false);
});
