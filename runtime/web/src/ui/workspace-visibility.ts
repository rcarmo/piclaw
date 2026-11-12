export const DESKTOP_WORKSPACE_OPEN_STORAGE_KEY = 'workspaceOpen.desktop';
export const WINDOW_WORKSPACE_OPEN_STORAGE_KEY = 'workspaceOpen.window';
export const DESKTOP_WORKSPACE_LAYOUT_MEDIA_QUERY = '(min-width: 1024px) and (orientation: landscape)';

export type WorkspaceLayoutBucket = 'desktop' | 'narrow';

function getRuntimeWindow(runtime: any = typeof window !== 'undefined' ? window : null) {
  return runtime && typeof runtime === 'object' ? runtime : null;
}

function getRuntimeStorage(runtime: any, kind: 'localStorage' | 'sessionStorage' = 'localStorage') {
  try {
    return getRuntimeWindow(runtime)?.[kind] || null;
  } catch {
    return null;
  }
}

function readPreference(storage: Storage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writePreference(storage: Storage | null, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    return;
  }
}

export function readStoredDesktopWorkspaceOpenPreference(
  runtime: any = typeof window !== 'undefined' ? window : null,
): boolean {
  const session = getRuntimeStorage(runtime, 'sessionStorage');
  const own = readPreference(session, WINDOW_WORKSPACE_OPEN_STORAGE_KEY);
  if (own === 'true' || own === 'false') return own === 'true';
  const initial = readPreference(getRuntimeStorage(runtime), DESKTOP_WORKSPACE_OPEN_STORAGE_KEY) === 'true';
  // Snapshot the first load too: reloading this window must not pick up another
  // window's later choice. localStorage is only a default for new windows.
  writePreference(session, WINDOW_WORKSPACE_OPEN_STORAGE_KEY, String(initial));
  return initial;
}

export function persistDesktopWorkspaceOpenPreference(
  workspaceOpen: boolean,
  runtime: any = typeof window !== 'undefined' ? window : null,
): void {
  const value = String(Boolean(workspaceOpen));
  writePreference(getRuntimeStorage(runtime, 'sessionStorage'), WINDOW_WORKSPACE_OPEN_STORAGE_KEY, value);
  writePreference(getRuntimeStorage(runtime), DESKTOP_WORKSPACE_OPEN_STORAGE_KEY, value);
}

/**
 * Window-scoped boolean preference: this window's own value (sessionStorage)
 * wins; the shared value (localStorage) is only the default for new windows.
 */
export function readWindowScopedPreference(
  windowKey: string,
  sharedKey: string,
  defaultValue: boolean,
  runtime: any = typeof window !== 'undefined' ? window : null,
): boolean {
  const session = getRuntimeStorage(runtime, 'sessionStorage');
  const own = readPreference(session, windowKey);
  if (own === 'true' || own === 'false') return own === 'true';
  const shared = readPreference(getRuntimeStorage(runtime), sharedKey);
  const initial = shared === 'true' || shared === 'false' ? shared === 'true' : defaultValue;
  writePreference(session, windowKey, String(initial));
  return initial;
}

export function persistWindowScopedPreference(
  windowKey: string,
  sharedKey: string,
  value: boolean,
  runtime: any = typeof window !== 'undefined' ? window : null,
): void {
  writePreference(getRuntimeStorage(runtime, 'sessionStorage'), windowKey, String(Boolean(value)));
  writePreference(getRuntimeStorage(runtime), sharedKey, String(Boolean(value)));
}

export const WINDOW_SIDEBAR_OPEN_STORAGE_KEY = 'sessionsOpen.window';
export const POPOUT_WINDOW_STORAGE_KEY = 'piclaw.window.popout';
const UNCLUTTERED_HINT_PARAMS = ['chat_only', 'chat-only'];

/**
 * Pop-out chat windows open with `chat_only=1`. That is a one-off hint, not a
 * mode: this window starts with the side bar and workspace collapsed, without
 * changing other windows' defaults, and the parameter is removed from the URL.
 * The window is otherwise a normal workbench window.
 */
export function applyUnclutteredWindowHint(runtime: any = typeof window !== 'undefined' ? window : null): boolean {
  const runtimeWindow = getRuntimeWindow(runtime);
  const href = runtimeWindow?.location?.href;
  if (!href) return false;
  const url = new URL(href);
  const hinted = UNCLUTTERED_HINT_PARAMS.some((name) => {
    const value = url.searchParams.get(name);
    return value !== null && !['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase());
  });
  if (!hinted) return false;
  const session = getRuntimeStorage(runtime, 'sessionStorage');
  writePreference(session, WINDOW_WORKSPACE_OPEN_STORAGE_KEY, 'false');
  writePreference(session, WINDOW_SIDEBAR_OPEN_STORAGE_KEY, 'false');
  writePreference(session, POPOUT_WINDOW_STORAGE_KEY, 'true');
  for (const name of UNCLUTTERED_HINT_PARAMS) url.searchParams.delete(name);
  runtimeWindow.history?.replaceState?.(runtimeWindow.history.state, '', url.toString());
  return true;
}

/** Pop-out windows do not overwrite the remembered main session. */
export function isPopoutWindow(runtime: any = typeof window !== 'undefined' ? window : null): boolean {
  return readPreference(getRuntimeStorage(runtime, 'sessionStorage'), POPOUT_WINDOW_STORAGE_KEY) === 'true';
}

export function resolveWorkspaceLayoutBucket(runtime: any = typeof window !== 'undefined' ? window : null): WorkspaceLayoutBucket {
  const runtimeWindow = getRuntimeWindow(runtime);
  if (!runtimeWindow?.matchMedia) return 'desktop';
  return runtimeWindow.matchMedia(DESKTOP_WORKSPACE_LAYOUT_MEDIA_QUERY).matches ? 'desktop' : 'narrow';
}

export function shouldCollapseWorkspaceAfterLayoutChange(
  previousBucket: WorkspaceLayoutBucket,
  nextBucket: WorkspaceLayoutBucket,
): boolean {
  return previousBucket === 'desktop' && nextBucket === 'narrow';
}
