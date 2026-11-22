const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

/** Parse bounded absolute A2UI paths consistently with snapshot writes and browser reads. */
export function absoluteA2uiPointer(path: unknown, allowRoot = false): string[] | undefined {
  if (allowRoot && (path === '/' || path === '')) return [];
  if (typeof path !== 'string' || path.length > 256 || !path.startsWith('/')) return;
  const raw = path.slice(1).split('/');
  if (raw.length > 24 || raw.some(segment => !segment || /~(?![01])|[\x00-\x1f\x7f]/.test(segment))) return;
  const segments = raw.map(segment => segment.replace(/~([01])/g, (_, escape) => escape === '1' ? '/' : '~'));
  if (segments.some(segment => FORBIDDEN_SEGMENTS.has(segment)
    || (/^\d+$/.test(segment) && (Number(segment) >= 96 || /^0\d/.test(segment))))) return;
  return segments;
}
