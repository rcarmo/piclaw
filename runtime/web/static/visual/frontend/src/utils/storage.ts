/**
 * Safe localStorage wrappers that guard against:
 * - SecurityError (private/incognito browsing modes)
 * - QuotaExceededError (storage quota exceeded)
 * - Corrupt/invalid JSON when parsing stored values
 */

export function safeGetItem(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function safeSetItem(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* quota or security error */ }
}

export function safeRemoveItem(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

export function safeParseJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch { return fallback; }
}
