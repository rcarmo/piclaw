const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

/** Parse bounded absolute A2UI paths consistently with snapshot writes and browser reads. */
export function absoluteA2uiPointer(path: unknown, allowRoot = false): string[] | undefined {
  if (allowRoot && (path === '/' || path === '')) return [];
  if (typeof path !== 'string' || path.length > 768 || !path.startsWith('/')) return;
  const raw = path.slice(1).split('/');
  if (raw.length > 24 || raw.some(segment => !segment || /~(?![01])|[\x00-\x1f\x7f]/.test(segment))) return;
  const segments = raw.map(segment => segment.replace(/~([01])/g, (_, escape) => escape === '1' ? '/' : '~'));
  if (segments.some(segment => FORBIDDEN_SEGMENTS.has(segment)
    || (/^\d+$/.test(segment) && (Number(segment) >= 96 || /^0\d/.test(segment))))) return;
  return segments;
}

export function scopedA2uiPointer(path: unknown, base = '/'): string | undefined {
  if (typeof path !== 'string' || path.length > 256) return;
  const absolute = path.startsWith('/') ? path : !path || path === '.' ? base : `${base === '/' ? '' : base}/${path}`;
  return absoluteA2uiPointer(absolute, true) ? absolute : undefined;
}

export function readA2uiPath(model: unknown, path: string): unknown {
  const keys = absoluteA2uiPointer(path, true);
  if (!keys) return;
  let value = model;
  for (const key of keys) {
    if (!value || typeof value !== 'object' || (Array.isArray(value) && !/^\d+$/.test(key)) || !Object.hasOwn(value, key)) return;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
