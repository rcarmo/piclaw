/** Bounded lexical candidate preparation only; no source access or answer assessment. */
const STOP = new Set('a an and or the is are at of for to in on what when where how which with does do should'.split(' '));

/** Expand quoted phrases and plain terms into a bounded FTS5 OR expression.
 * This changes candidate generation only. A match says nothing about whether
 * the requested fact is present or contradicted by the source. */
export function prepareBroadNoteQuery(input: string): string | null {
  const normalized = input.replace(/[“”]/g, '"');
  if (Buffer.byteLength(normalized) > 512 || (normalized.match(/"/g)?.length ?? 0) % 2 !== 0) return null;
  const units = [...normalized.matchAll(/"([^"\n]+)"|([\p{L}\p{N}_]+(?:[-./][\p{L}\p{N}_]+)*)/gu)]
    .map(match => match[1] ?? match[2]!)
    .filter(value => !STOP.has(value.toLocaleLowerCase('und')));
  if (!units.length || units.length > 20) return null;
  const fts = [...new Set(units)].map(value => `"${value.replaceAll('"', '""')}"`).join(' OR ');
  return fts.length <= 512 ? fts : null;
}
