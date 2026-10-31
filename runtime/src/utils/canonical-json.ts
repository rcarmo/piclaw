/** Canonical validated JSON, preserving every field (including attempts).
 * Unlike effect-request hashing, no tracing/lease/attempt keys are omitted.
 * Keep this representation stable: existing financial hashes use it. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().filter(key => object[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}
