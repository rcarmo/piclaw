export const SESSION_PICKER_PREFERENCES_STORAGE_KEY = 'piclaw:session-picker-preferences:v1';
export const SESSION_PICKER_PREFERENCES_EVENT = 'piclaw:session-picker-preferences-changed';

export interface StoredSessionPickerPreferences {
  pinnedChatJids: string[];
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface PreferenceRuntime {
  localStorage?: StorageLike;
  dispatchEvent?: (event: Event) => boolean;
}

function emptyPreferences(): StoredSessionPickerPreferences {
  return { pinnedChatJids: [] };
}

export function normalizeSessionPickerChatJid(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normaliseStoredSessionPickerPreferences(value: unknown): StoredSessionPickerPreferences {
  if (!value || typeof value !== 'object') return emptyPreferences();
  const candidate = value as Partial<StoredSessionPickerPreferences>;
  return {
    pinnedChatJids: Array.from(new Set(
      (Array.isArray(candidate.pinnedChatJids) ? candidate.pinnedChatJids : [])
        .map(normalizeSessionPickerChatJid)
        .filter(Boolean),
    )),
  };
}

function runtimeStorage(runtime: PreferenceRuntime | null | undefined): StorageLike | null {
  try {
    return runtime?.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readSessionPickerPreferences(
  runtime: PreferenceRuntime | null = typeof window !== 'undefined' ? window : null,
): StoredSessionPickerPreferences {
  try {
    const raw = runtimeStorage(runtime)?.getItem(SESSION_PICKER_PREFERENCES_STORAGE_KEY);
    return raw ? normaliseStoredSessionPickerPreferences(JSON.parse(raw)) : emptyPreferences();
  } catch {
    return emptyPreferences();
  }
}

export function writeSessionPickerPreferences(
  value: unknown,
  runtime: PreferenceRuntime | null = typeof window !== 'undefined' ? window : null,
): StoredSessionPickerPreferences {
  const preferences = normaliseStoredSessionPickerPreferences(value);
  try {
    runtimeStorage(runtime)?.setItem(SESSION_PICKER_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch (error) {
    console.debug('[session-picker-preferences] Storage unavailable; keeping the in-memory preference result.', error);
  }
  try {
    runtime?.dispatchEvent?.(new CustomEvent(SESSION_PICKER_PREFERENCES_EVENT, { detail: preferences }));
  } catch (error) {
    console.debug('[session-picker-preferences] Preference event delivery unavailable.', error);
  }
  return preferences;
}

export function togglePinnedSessionChatJid(
  chatJid: string,
  runtime: PreferenceRuntime | null = typeof window !== 'undefined' ? window : null,
): StoredSessionPickerPreferences {
  const normalizedChatJid = normalizeSessionPickerChatJid(chatJid);
  const current = readSessionPickerPreferences(runtime);
  if (!normalizedChatJid) return current;
  const pinned = new Set(current.pinnedChatJids);
  if (pinned.has(normalizedChatJid)) pinned.delete(normalizedChatJid);
  else pinned.add(normalizedChatJid);
  return writeSessionPickerPreferences({ pinnedChatJids: Array.from(pinned) }, runtime);
}
