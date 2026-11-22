const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const ARRAY_INDEX=/^(?:0|[1-9][0-9]*)$/;
const MAX_ARRAY_ITEMS=96;

/** Parse bounded absolute A2UI paths consistently with snapshot writes and browser reads. */
export function absoluteA2uiPointer(path: unknown, allowRoot = false): string[] | undefined {
  if (path==='/' || path==='') return allowRoot ? [] : undefined; // A2UI's root convention.
  if (typeof path !== 'string' || path.length > 768 || !path.startsWith('/')) return;
  const raw = path.slice(1).split('/');
  if (raw.length > 24 || raw.some(segment => /~(?![01])|[\x00-\x1f\x7f]/.test(segment))) return;
  const segments = raw.map(segment => segment.replace(/~([01])/g, (_, escape) => escape === '1' ? '/' : '~'));
  if (segments.some(segment=>FORBIDDEN_SEGMENTS.has(segment))) return;
  return segments;
}

export function scopedA2uiPointer(path: unknown, base = '/'): string | undefined {
  if (typeof path !== 'string' || path.length > 256) return;
  const absolute = path.startsWith('/') ? path : !path || path === '.' ? base : `${base === '/' ? '' : base}/${path}`;
  return absoluteA2uiPointer(absolute, true) ? absolute : undefined;
}

/** The order of overlapping writes is significant; a parent replaces its children. */
export function setA2uiOverlay<T>(edits:Map<string,T>,path:string,value:T):void {
  for (const previous of edits.keys()) if (previous===path || previous.startsWith(`${path}/`)) edits.delete(previous);
  edits.set(path,value);
}

export function isA2uiArrayIndex(key:string):boolean {
  return ARRAY_INDEX.test(key) && Number(key)<MAX_ARRAY_ITEMS;
}

function readMember(value: unknown,key:string):unknown {
  if (!value || typeof value!=='object' || (Array.isArray(value) && !isA2uiArrayIndex(key)) || !Object.hasOwn(value,key)) return;
  return (value as Record<string,unknown>)[key];
}

export function readA2uiPath(model:unknown,path:string):unknown {
  const keys=absoluteA2uiPointer(path,true);
  if (!keys) return;
  for (const key of keys) model=readMember(model,key);
  return model;
}

/** Update a detached model. Empty and numeric object keys are never normalised.
 *  Wire null deletes a key; draft null is a value. Array deletion preserves indexes. */
export function writeA2uiPath(model:Record<string,unknown>,path:string,value:unknown,remove=false):void {
  const keys=absoluteA2uiPointer(path);
  if (!keys) throw Error('Invalid A2UI model path');
  let current=model;
  for (let i=0;i<keys.length;i++) {
    const key=keys[i]!;
    if (Array.isArray(current) && !isA2uiArrayIndex(key)) throw Error('Invalid A2UI array index');
    if (i===keys.length-1) {
      if (remove) delete current[key];
      else current[key]=structuredClone(value);
      return;
    }
    let child=readMember(current,key);
    if (remove && (!child || typeof child!=='object')) return;
    if (child==null) current[key]=child=ARRAY_INDEX.test(keys[i+1]!) ? [] : {};
    if (typeof child!=='object') throw Error('Cannot traverse a primitive A2UI model value');
    current=child as Record<string,unknown>;
  }
}
