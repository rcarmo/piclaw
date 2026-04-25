import { expect, test } from 'bun:test';

import {
  canUseComposeSessionSwitcher,
  shouldOpenSessionSwitcherFromBlankCompose,
  shouldRouteComposeValueToSessionSwitcher,
} from '../../web/src/ui/compose-session-switcher.js';

test('opens the session switcher when @ is typed into a blank compose box', () => {
  expect(shouldOpenSessionSwitcherFromBlankCompose({ key: '@' } as any, '', {
    searchMode: false,
    showSessionSwitcherButton: true,
  })).toBe(true);
});

test('does not open the session switcher when compose already has content', () => {
  expect(shouldOpenSessionSwitcherFromBlankCompose({ key: '@' } as any, 'hello', {
    searchMode: false,
    showSessionSwitcherButton: true,
  })).toBe(false);
});

test('does not open the session switcher when searching or when no switcher is available', () => {
  expect(shouldOpenSessionSwitcherFromBlankCompose({ key: '@' } as any, '', {
    searchMode: true,
    showSessionSwitcherButton: true,
  })).toBe(false);
  expect(shouldOpenSessionSwitcherFromBlankCompose({ key: '@' } as any, '', {
    searchMode: false,
    showSessionSwitcherButton: false,
  })).toBe(false);
});

test('ignores modified keystrokes and non-@ characters', () => {
  expect(shouldOpenSessionSwitcherFromBlankCompose({ key: '@', ctrlKey: true } as any, '', {
    searchMode: false,
    showSessionSwitcherButton: true,
  })).toBe(false);
  expect(shouldOpenSessionSwitcherFromBlankCompose({ key: 'a' } as any, '', {
    searchMode: false,
    showSessionSwitcherButton: true,
  })).toBe(false);
});

test('routes a bare @ compose value to the session switcher popup', () => {
  expect(shouldRouteComposeValueToSessionSwitcher('@', {
    searchMode: false,
    showSessionSwitcherButton: true,
  })).toBe(true);
  expect(shouldRouteComposeValueToSessionSwitcher('@agent', {
    searchMode: false,
    showSessionSwitcherButton: true,
  })).toBe(false);
  expect(shouldRouteComposeValueToSessionSwitcher('@', {
    searchMode: true,
    showSessionSwitcherButton: true,
  })).toBe(false);
});

test('session switcher is only available when not searching and when the button is shown', () => {
  expect(canUseComposeSessionSwitcher({ searchMode: false, showSessionSwitcherButton: true })).toBe(true);
  expect(canUseComposeSessionSwitcher({ searchMode: true, showSessionSwitcherButton: true })).toBe(false);
  expect(canUseComposeSessionSwitcher({ searchMode: false, showSessionSwitcherButton: false })).toBe(false);
});
