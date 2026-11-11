export const RECENT_FILES_KEY = 'piclaw_recent_files';
export const MAX_RECENT_FILES = 5;

function isIgnoredPath(path: string): boolean {
  if (path.startsWith('piclaw://addon/')) return true;
  const normalizedPath = path.trim();
  const legacyPath = normalizedPath.replace(/^\/+/, '');
  return legacyPath.startsWith('__terminal')
    || legacyPath.startsWith('__vnc')
    || normalizedPath.startsWith('piclaw://terminal')
    || normalizedPath.startsWith('piclaw://vnc')
    || normalizedPath.startsWith('piclaw://plan');
}

export function normalizeRecentFiles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const files: string[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (typeof entry !== 'string') continue;

    const path = entry.trim();
    if (!path || isIgnoredPath(path) || seen.has(path)) continue;

    seen.add(path);
    files.push(path);

    if (files.length >= MAX_RECENT_FILES) break;
  }

  return files;
}

export function getRecentFiles(): string[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(RECENT_FILES_KEY);
    if (!raw) return [];
    return normalizeRecentFiles(JSON.parse(raw));
  } catch (error) {
    console.warn('[recent-files] Failed to read recent files from localStorage.', error);
    return [];
  }
}

export function removeRecentFile(path: string): void {
  const normalizedPath = typeof path === 'string' ? path.trim() : '';
  if (!normalizedPath) return;
  try {
    if (typeof localStorage === 'undefined') return;
    // Re-read after the file check to retain entries added while it was in flight.
    const files = getRecentFiles();
    if (!files.includes(normalizedPath)) return;
    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(files.filter(file => file !== normalizedPath)));
  } catch (error) {
    console.warn('[recent-files] Failed to remove missing recent file.', error);
  }
}

/** Validate only a selected recent entry; do not read file contents or poll. */
export async function openRecentFile(path: string, open?: (path: string) => unknown): Promise<void> {
  if (typeof open !== 'function' || isIgnoredPath(path)) return;
  try {
    const response = await fetch(`/workspace/stat?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
    if (response.status === 404) {
      const payload = await response.json();
      if (payload?.code === 'FILE_NOT_FOUND') {
        removeRecentFile(path);
        return;
      }
    }
  } catch (error) {
    // Offline, invalid responses and access errors are not proof of deletion.
    console.debug('[recent-files] File check unavailable; retaining recent entry.', error);
  }
  try {
    await open(path);
  } catch (error) {
    console.warn('[recent-files] Failed to open recent file.', error);
  }
}

export function addRecentFile(path: string): void {
  const normalizedPath = typeof path === 'string' ? path.trim() : '';
  if (!normalizedPath || isIgnoredPath(normalizedPath)) return;

  try {
    if (typeof localStorage === 'undefined') return;
    const next = normalizeRecentFiles([normalizedPath, ...getRecentFiles()]);
    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(next));
  } catch (error) {
    console.warn('[recent-files] Failed to persist recent files to localStorage.', error);
  }
}
