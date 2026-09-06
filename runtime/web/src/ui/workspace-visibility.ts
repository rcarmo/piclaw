export const DESKTOP_WORKSPACE_OPEN_STORAGE_KEY = 'workspaceOpen.desktop';
export const DESKTOP_WORKSPACE_LAYOUT_MEDIA_QUERY = '(min-width: 1024px) and (orientation: landscape)';

export type WorkspaceLayoutBucket = 'desktop' | 'narrow';

function getRuntimeWindow(runtime: any = typeof window !== 'undefined' ? window : null) {
  return runtime && typeof runtime === 'object' ? runtime : null;
}

function getRuntimeStorage(runtime: any) {
  try {
    return getRuntimeWindow(runtime)?.localStorage || null;
  } catch {
    return null;
  }
}

export function readStoredDesktopWorkspaceOpenPreference(
  runtime: any = typeof window !== 'undefined' ? window : null,
): boolean {
  const storage = getRuntimeStorage(runtime);
  if (!storage?.getItem) return false;
  try {
    return storage.getItem(DESKTOP_WORKSPACE_OPEN_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function persistDesktopWorkspaceOpenPreference(
  workspaceOpen: boolean,
  runtime: any = typeof window !== 'undefined' ? window : null,
): void {
  const storage = getRuntimeStorage(runtime);
  if (!storage?.setItem) return;
  try {
    storage.setItem(DESKTOP_WORKSPACE_OPEN_STORAGE_KEY, String(Boolean(workspaceOpen)));
  } catch {
    return;
  }
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
