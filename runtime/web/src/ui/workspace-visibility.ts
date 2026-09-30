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
