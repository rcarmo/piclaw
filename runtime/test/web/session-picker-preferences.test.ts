import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  normaliseStoredSessionPickerPreferences,
  readSessionPickerPreferences,
  SESSION_PICKER_PREFERENCES_STORAGE_KEY,
  togglePinnedSessionChatJid,
} from '../../web/src/ui/session-picker-preferences.ts';

function createRuntime(initial: unknown = null) {
  const values = new Map<string, string>();
  if (initial !== null) values.set(SESSION_PICKER_PREFERENCES_STORAGE_KEY, JSON.stringify(initial));
  return {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
    dispatchEvent: () => true,
  };
}

test('session pin preferences normalize full chat JIDs and remove duplicates', () => {
  expect(normaliseStoredSessionPickerPreferences({
    pinnedChatJids: [' web:root ', 'web:root', '', 17, 'web:root:branch:a'],
  })).toEqual({ pinnedChatJids: ['web:root', 'web:root:branch:a'] });
});

test('session pinning persists by full chat JID and toggles independently', () => {
  const runtime = createRuntime();
  togglePinnedSessionChatJid('web:root:branch:a', runtime as any);
  togglePinnedSessionChatJid('web:other:branch:a', runtime as any);
  expect(readSessionPickerPreferences(runtime as any).pinnedChatJids).toEqual([
    'web:root:branch:a',
    'web:other:branch:a',
  ]);
  togglePinnedSessionChatJid('web:root:branch:a', runtime as any);
  expect(readSessionPickerPreferences(runtime as any).pinnedChatJids).toEqual(['web:other:branch:a']);
});

test('invalid or unavailable session pin storage falls back safely', () => {
  expect(readSessionPickerPreferences({ localStorage: { getItem: () => '{', setItem() {} } } as any)).toEqual({ pinnedChatJids: [] });
  expect(normaliseStoredSessionPickerPreferences(null)).toEqual({ pinnedChatJids: [] });
});

test('classic and visual session search typography matches the model picker', () => {
  for (const theme of ['classic', 'visual']) {
    const css = readFileSync(join(import.meta.dir, `../../web/static/${theme}/css/chat.css`), 'utf8');
    expect(css).toMatch(/\.compose-session-search\s*\{[^}]*font:\s*12px var\(--font-family-mono\);/s);
  }
});
