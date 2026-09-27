/** Offline v2 fixture engine; deliberately not imported by runtime/tool code. */
import { Database } from 'bun:sqlite';
import { chunkMarkdown } from '../../../src/note-retrieval/chunker.js';
import type { Source } from './passage-experiment.js';

export const ANCHOR_POLICY = Object.freeze({ version: 'anchors-v2', tokenizer: 'porter unicode61 remove_diacritics 2',
  maxQueryBytes: 512, maxUnits: 20, perStream: 50, windowBytes: 1536, maxHits: 5, responseBytes: 4096,
  minimumWeightedCoverage: 0.65, minimumUnitCoverage: 0.5, relaxedMaxIdfWeight: 2, maxFiles: 2000, maxSourceBytes: 32 * 1024 * 1024,
  maxPassages: 32768, weights: [1, 0.3, 2, 0.25] });
export type AnchorVariant = 'anchors-v2' | 'without-proximity' | 'without-expansion' | 'without-anchors' | 'relaxed-rarity' | 'all-units';
export const ANCHOR_VARIANTS: AnchorVariant[] = ['anchors-v2', 'without-proximity', 'without-expansion', 'without-anchors', 'relaxed-rarity', 'all-units'];
const STOP = new Set('a an and or the is are at of for to in on what when where how which with does do should'.split(' '));
interface Unit { raw: string; exact: boolean; tokens: string[] }
interface RecordRow { rowid: number; path: string; first: number; last: number; coreFirst: number; coreLast: number; context: string; core: string; score: number }
export interface AnchorHit { path: string; lineStart: number; lineEnd: number; text: string; sourceStatus: string | null; sourceDate: string | null;
  matchedUnits: number; queryUnits: number; weightedCoverage: number; proximityTokens: number | null }
export interface AnchorOutput { status: 'matches' | 'no_lexical_match' | 'insufficient_evidence' | 'invalid_query' | 'candidate_limit' | 'incomplete';
  limited: boolean; reasons: string[]; hits: AnchorHit[] }

const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;
const size = (s: unknown) => Buffer.byteLength(JSON.stringify(s));
const order = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));

/** Fixed-source metadata is displayed only; it never changes ranking or authority. */
export function buildAnchorIndex(db: Database, sources: Source[]): void {
  if (sources.length > ANCHOR_POLICY.maxFiles || sources.reduce((sum, s) => sum + s.bytes.byteLength, 0) > ANCHOR_POLICY.maxSourceBytes) throw Error('Fixture input limit');
  db.exec(`CREATE TABLE anchor_sources(path TEXT PRIMARY KEY, text TEXT NOT NULL, status TEXT, date TEXT);
    CREATE TABLE anchor_windows(rowid INTEGER PRIMARY KEY,path TEXT,first INTEGER,last INTEGER,coreFirst INTEGER,coreLast INTEGER);
    CREATE TABLE anchor_meta(excluded INTEGER NOT NULL);
    INSERT INTO anchor_meta VALUES(0);
    CREATE VIRTUAL TABLE anchor_fts USING fts5(core,context,heading,path,tokenize='${ANCHOR_POLICY.tokenizer}');
    CREATE VIRTUAL TABLE anchor_exact USING fts5(context,tokenize='unicode61 remove_diacritics 0');
    CREATE VIRTUAL TABLE anchor_tokens USING fts5vocab(anchor_fts,instance);`);
  let rows = 0, excluded = 0;
  db.transaction(() => {
    for (const source of sources) {
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(source.bytes);
      const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
      const status = /^Status:[ \t]*([^\r\n]+)$/mi.exec(text)?.[1]?.trim() ?? null;
      const date = /^(?:Date|Updated|Effective):[ \t]*(\d{4}-\d{2}-\d{2})\s*$/mi.exec(text)?.[1] ?? null;
      db.query('INSERT INTO anchor_sources VALUES(?,?,?,?)').run(source.path, text, status, date);
      const chunks = chunkMarkdown(source.bytes, 'anchor-fixture', source.path).chunks;
      for (const chunk of chunks) {
        // Split core at blank lines. Windows expand by adjacent complete paragraphs
        // within a chunk; contiguous preceding headings may cross chunk boundaries.
        const parts: Array<{ first: number; last: number }> = [];
        let start: number | null = null;
        for (let i = chunk.lineStart - 1; i <= chunk.lineEnd; i++) {
          if (i === chunk.lineEnd || !lines[i]?.trim()) {
            if (start !== null) { parts.push({ first: start, last: i - 1 }); start = null; }
          } else if (start === null) start = i;
          else if (Buffer.byteLength(lines.slice(start, i + 1).join('')) > ANCHOR_POLICY.windowBytes) {
            // Bound long prose cores by complete lines rather than dropping an
            // entire paragraph. A single overlong line is still an exclusion.
            parts.push({ first: start, last: i - 1 }); start = i;
          }
        }
        for (let index = 0; index < parts.length; index++) {
          const part = parts[index]!;
          const core = lines.slice(part.first, part.last + 1).join('');
          if (Buffer.byteLength(core) > ANCHOR_POLICY.windowBytes) { excluded++; continue; }
          let first = part.first, last = part.last;
          const previous = parts[index - 1], next = parts[index + 1];
          if (previous && Buffer.byteLength(lines.slice(previous.first, last + 1).join('')) <= ANCHOR_POLICY.windowBytes) first = previous.first;
          if (next && Buffer.byteLength(lines.slice(first, next.last + 1).join('')) <= ANCHOR_POLICY.windowBytes) last = next.last;
          // Preserve a directly preceding title/subheading chain, with no fabricated
          // heading text or guessed anaphora. Never reach into another paragraph.
          let headingStart = first;
          while (headingStart > 0 && (!lines[headingStart - 1]!.trim() || /^\s*#{1,6}\s/.test(lines[headingStart - 1]!))) headingStart--;
          if (Buffer.byteLength(lines.slice(headingStart, last + 1).join('')) <= ANCHOR_POLICY.windowBytes) first = headingStart;
          if (++rows > ANCHOR_POLICY.maxPassages) throw Error('Fixture passage limit');
          const context = lines.slice(first, last + 1).join('');
          db.query('INSERT INTO anchor_windows VALUES(?,?,?,?,?,?)').run(rows, source.path, first + 1, last + 1, part.first + 1, part.last + 1);
          db.query('INSERT INTO anchor_fts(rowid,core,context,heading,path) VALUES(?,?,?,?,?)').run(rows, core, context, chunk.headingPath.join(' / '), source.path);
          db.query('INSERT INTO anchor_exact(rowid,context) VALUES(?,?)').run(rows, context);
        }
      }
    }
    db.query('UPDATE anchor_meta SET excluded=?').run(excluded);
  })();
}

function parse(db: Database, query: string): Unit[] | null {
  if (Buffer.byteLength(query) > ANCHOR_POLICY.maxQueryBytes) return null;
  const input = query.replace(/[“”]/g, '"');
  if ((input.match(/"/g)?.length ?? 0) % 2) return null;
  const raw = [...input.matchAll(/"([^"\n]+)"|([\p{L}\p{N}_]+(?:[-./][\p{L}\p{N}_]+)*)/gu)].map(m => {
    const value = (m[1] ?? m[2]!).trim();
    return { raw: value, exact: m[1] !== undefined || (/\p{N}/u.test(value) && /[-./_]/.test(value)) };
  }).filter(unit => unit.exact || !STOP.has(unit.raw.toLowerCase()));
  if (!raw.length || raw.length > ANCHOR_POLICY.maxUnits) return null;
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS temp.anchor_query USING fts5(text,tokenize='${ANCHOR_POLICY.tokenizer}');
    CREATE VIRTUAL TABLE IF NOT EXISTS temp.anchor_query_tokens USING fts5vocab(temp,anchor_query,instance);
    DELETE FROM temp.anchor_query;`);
  raw.forEach((unit, i) => db.query('INSERT INTO temp.anchor_query(rowid,text) VALUES(?,?)').run(i + 1, unit.raw));
  const units: Unit[] = [], seen = new Set<string>();
  raw.forEach((unit, i) => {
    const tokens = (db.query('SELECT term FROM temp.anchor_query_tokens WHERE doc=? ORDER BY offset').all(i + 1) as Array<{ term: string }>).map(row => row.term);
    const key = unit.exact ? `exact:${unit.raw}` : JSON.stringify(tokens);
    if (tokens.length && !seen.has(key)) { seen.add(key); units.push({ ...unit, tokens }); }
  });
  return units.length ? units : null;
}

/** Case/punctuation-sensitive quoted or identifier text; never match a prefix
 * of a hyphenated identifier, a plural or a reordered entity phrase. */
export function exactAnchor(text: string, raw: string): boolean {
  let start = -1;
  while ((start = text.indexOf(raw, start + 1)) >= 0) {
    const before = [...text.slice(0, start)].at(-1) ?? '', rest = text.slice(start + raw.length);
    // A full stop ending a sentence is not part of the identifier. Dotted
    // suffixes, slash paths and hyphenated extensions remain distinct anchors.
    const suffix = /^[\p{L}\p{N}\p{M}_/-]|^\.[\p{L}\p{N}\p{M}_]/u.test(rest);
    if (!/[\p{L}\p{N}\p{M}_./-]/u.test(before) && !suffix) return true;
  }
  return false;
}

function proximity(db: Database, rowid: number, units: Unit[], field: string): number | null {
  // Exact anchors are validated against literal surface text. Porter offsets
  // cannot identify which literal occurrence matched, so do not fabricate a
  // proximity advantage from a nearby stem/punctuation variant.
  if (units.some(unit => unit.exact)) return null;
  const tokens = db.query('SELECT term,offset FROM anchor_tokens WHERE doc=? AND col=? ORDER BY offset').all(rowid, field) as Array<{term: string; offset: number}>;
  const spans: Array<{first: number; last: number; unit: number}> = [];
  units.forEach((unit, group) => {
    tokens.forEach((token, i) => {
      if (unit.tokens.every((term, j) => tokens[i + j]?.term === term && tokens[i + j]!.offset === token.offset + j)) {
        spans.push({ first: token.offset, last: token.offset + unit.tokens.length - 1, unit: group });
      }
    });
  });
  const groups = new Set(spans.map(span => span.unit));
  if (groups.size < 2) return null;
  spans.sort((a, b) => a.first - b.first || a.last - b.last || a.unit - b.unit);
  let best = Infinity, left = 0;
  const counts = new Map<number, number>();
  for (let right = 0; right < spans.length; right++) {
    const item = spans[right]!; counts.set(item.unit, (counts.get(item.unit) ?? 0) + 1);
    while (counts.size === groups.size) {
      best = Math.min(best, Math.max(...spans.slice(left, right + 1).map(s => s.last)) - spans[left]!.first + 1);
      const first = spans[left++]!; const count = counts.get(first.unit)! - 1;
      if (count) counts.set(first.unit, count); else counts.delete(first.unit);
    }
  }
  return Number.isFinite(best) ? best : null;
}

export function retrieveAnchored(db: Database, query: string, variant: AnchorVariant = 'anchors-v2'): AnchorOutput {
  const output: AnchorOutput = { status: 'no_lexical_match', limited: false, reasons: [], hits: [] };
  if ((db.query('SELECT excluded FROM anchor_meta').get() as {excluded: number}).excluded) { output.limited = true; output.reasons.push('source_window_exclusion'); }
  const units = parse(db, query);
  if (!units) return { ...output, status: 'invalid_query' };
  const field = variant === 'without-expansion' ? 'core' : 'context';
  const anchors = variant === 'without-anchors' ? [] : units.filter(unit => unit.exact);
  const phrases = units.map(unit => quote(unit.raw));
  const match = db.query('SELECT rowid FROM anchor_fts WHERE rowid=? AND anchor_fts MATCH ?');
  const total = Number((db.query('SELECT count(*) n FROM anchor_windows').get() as {n: number}).n);
  const weights = units.map(unit => {
    const count = Number((db.query('SELECT count(*) n FROM anchor_fts WHERE anchor_fts MATCH ?').get(`context : ${quote(unit.raw)}`) as {n: number}).n);
    const weight = Math.log(1 + (total + .5) / (count + .5));
    // Explicit ablation: limiting rarity can recover morphology misses but also
    // admit wrong-attribute queries. No silent fallback to this weaker policy.
    return variant === 'relaxed-rarity' ? Math.min(ANCHOR_POLICY.relaxedMaxIdfWeight, Math.max(1, weight)) : weight;
  });
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const candidates = new Map<number, RecordRow>();
  const base = `SELECT w.*,anchor_fts.core,anchor_fts.context,bm25(anchor_fts,${ANCHOR_POLICY.weights.join(',')}) score
    FROM anchor_fts JOIN anchor_windows w ON w.rowid=anchor_fts.rowid WHERE anchor_fts MATCH ?`;
  const suffix = ' ORDER BY score,w.path COLLATE BINARY,w.first,w.last,w.coreFirst,w.coreLast LIMIT ?';
  const broadQuery = `${field} : (${phrases.join(' OR ')})`;
  const streams: Array<[string, string[]]> = [
    ['all-units', [`${field} : (${phrases.join(' AND ')})`]],
    ['broad', [broadQuery]],
  ];
  if (anchors.length) streams.unshift(['anchors', [broadQuery, anchors.map(unit => quote(unit.raw)).join(' AND ')]]);
  for (const [name, params] of streams) {
    const sql = base + (name === 'anchors' ? ' AND w.rowid IN (SELECT rowid FROM anchor_exact WHERE anchor_exact MATCH ?)' : '') + suffix;
    const rows = db.query(sql).all(...params, ANCHOR_POLICY.perStream + 1) as RecordRow[];
    if (rows.length > ANCHOR_POLICY.perStream) { output.limited = true; output.reasons.push(`candidate_limit:${name}`); }
    for (const row of rows.slice(0, ANCHOR_POLICY.perStream)) candidates.set(row.rowid, row);
  }
  const canonicalScore = db.query(`SELECT bm25(anchor_fts,${ANCHOR_POLICY.weights.join(',')}) score FROM anchor_fts WHERE anchor_fts MATCH ? AND rowid=?`);
  const ranked = [...candidates.values()].flatMap(row => {
    // Re-score every stream's candidate under one common MATCH expression.
    row.score = (canonicalScore.get(broadQuery, row.rowid) as {score:number}).score;
    const text = field === 'core' ? row.core : row.context;
    if (!anchors.every(anchor => exactAnchor(text, anchor.raw))) return [];
    const matched = units.map(unit => Boolean(match.get(row.rowid, `${field} : ${quote(unit.raw)}`)));
    const count = matched.filter(Boolean).length;
    const weighted = matched.reduce((sum, yes, i) => sum + (yes ? weights[i]! : 0), 0) / weightSum;
    if (variant === 'all-units' ? count !== units.length
      : count < Math.ceil(units.length * ANCHOR_POLICY.minimumUnitCoverage) || weighted < ANCHOR_POLICY.minimumWeightedCoverage) return [];
    const span = proximity(db, row.rowid, units.filter((_, i) => matched[i]), field);
    return [{ row, count, weighted, span, text }];
  });
  ranked.sort((a, b) => b.weighted - a.weighted || b.count - a.count
    || (variant === 'without-proximity' ? 0 : (a.span ?? Infinity) - (b.span ?? Infinity))
    || a.row.score - b.row.score || order(a.row.path, b.row.path) || a.row.first - b.row.first || a.row.last - b.row.last
    || a.row.coreFirst - b.row.coreFirst || a.row.coreLast - b.row.coreLast);
  output.status = candidates.size ? 'insufficient_evidence' : 'no_lexical_match';
  for (const item of ranked) {
    const { row } = item;
    const first = field === 'core' ? row.coreFirst : row.first, last = field === 'core' ? row.coreLast : row.last;
    // Deduplicate overlapping source ranges before packing. Higher-ranked context
    // wins; do not duplicate evidence or silently glue distant passages together.
    const overlapping = output.hits.filter(hit => hit.path === row.path && first <= hit.lineEnd && last >= hit.lineStart);
    if (overlapping.length) {
      // Existing ranges are disjoint. Include every range bridged by this hit,
      // not just the first one, or transitive overlaps would duplicate evidence.
      const full = (db.query('SELECT text FROM anchor_sources WHERE path=?').get(row.path) as {text:string}).text;
      const mergedFirst = Math.min(first, ...overlapping.map(hit => hit.lineStart)), mergedLast = Math.max(last, ...overlapping.map(hit => hit.lineEnd));
      const text = (full.match(/[^\n]*\n|[^\n]+$/g) ?? []).slice(mergedFirst - 1, mergedLast).join('');
      const merged = { ...overlapping[0]!, lineStart: mergedFirst, lineEnd: mergedLast, text };
      const hits = output.hits.flatMap(hit => hit === overlapping[0] ? [merged] : overlapping.includes(hit) ? [] : [hit]);
      if (Buffer.byteLength(text) <= ANCHOR_POLICY.windowBytes && size({ ...output, hits }) <= ANCHOR_POLICY.responseBytes) output.hits = hits;
      else output.limited = true;
      continue;
    }
    const meta = db.query('SELECT status,date FROM anchor_sources WHERE path=?').get(row.path) as {status: string|null;date: string|null};
    const hit: AnchorHit = { path: row.path, lineStart: first, lineEnd: last, text: item.text, sourceStatus: meta.status, sourceDate: meta.date,
      matchedUnits: item.count, queryUnits: units.length, weightedCoverage: Math.round(item.weighted * 1e6) / 1e6, proximityTokens: item.span };
    if (output.hits.length >= ANCHOR_POLICY.maxHits || size({ ...output, status: 'matches', hits: [...output.hits, hit] }) > ANCHOR_POLICY.responseBytes) {
      output.limited = true; break;
    }
    output.hits.push(hit); output.status = 'matches';
  }
  if (!output.hits.length && output.limited) output.status = output.reasons.some(reason => reason.startsWith('candidate_limit:')) ? 'candidate_limit' : 'incomplete';
  return output;
}
