/** Synthetic-fixture experiment only. Not registered as a tool or imported by runtime code. */
import { Database } from 'bun:sqlite';
import { chunkMarkdown } from '../../../src/note-retrieval/chunker.js';

export const POLICY = Object.freeze({
  version: 'passage-bm25-v1', tokenizer: 'porter unicode61 remove_diacritics 2',
  windowBytes: 1536, overlapLines: 2, candidateLimit: 50, maxTerms: 8,
  maxQueryBytes: 512, limit: 5, responseBytes: 4096,
  headingWeight: 2, pathWeight: 0.5,
});
export type Variant = 'passage-or' | 'passage-two-thirds' | 'passage-all';
export const VARIANTS: Variant[] = ['passage-or', 'passage-two-thirds', 'passage-all'];
export interface Source { path: string; bytes: Uint8Array }
export interface Passage { path: string; lineStart: number; lineEnd: number; text: string }
interface Candidate extends Passage { rowid: number; score: number }
export interface PassageOutput {
  status: 'matches' | 'no_lexical_match' | 'insufficient_term_coverage' | 'candidate_limit' | 'invalid_query';
  limited: boolean;
  hits: Array<Passage & { matchedTerms: number; queryTerms: number }>;
}

export function createPassageIndex(db: Database, sources: Source[]): void {
  db.exec(`CREATE VIRTUAL TABLE passage_fts USING fts5(
    text, heading, path, lineStart UNINDEXED, lineEnd UNINDEXED,
    tokenize='${POLICY.tokenizer}');`);
  const insert = db.query('INSERT INTO passage_fts(text,heading,path,lineStart,lineEnd) VALUES(?,?,?,?,?)');
  db.transaction(() => {
    for (const source of sources) {
      const { chunks } = chunkMarkdown(source.bytes, 'fixture-experiment', source.path);
      for (const chunk of chunks) {
        // Small sections are returned whole. Long sections become complete-line
        // windows; never let a hidden tail count as delivered evidence.
        const lines = chunk.text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
        for (let start = 0; start < lines.length;) {
          let end = start, bytes = 0;
          while (end < lines.length && bytes + Buffer.byteLength(lines[end]!) <= POLICY.windowBytes) {
            bytes += Buffer.byteLength(lines[end++]!);
          }
          // Overlong lines get no truncated/guessed passage in this experiment.
          if (end === start) { start++; continue; }
          insert.run(lines.slice(start, end).join(''), chunk.headingPath.join(' / '), source.path,
            chunk.lineStart + start, chunk.lineStart + end - 1);
          if (end === lines.length) break;
          start = Math.max(start + 1, end - POLICY.overlapLines);
        }
      }
    }
  })();
}

/** Plain lexical units plus exact quoted phrases; no executable FTS operators.
 * Hyphenated identifiers remain a single FTS phrase. Unknown terms are retained
 * in the denominator, preventing a lone known topic from passing a long query. */
export function queryUnits(query: string): string[] | null {
  if (Buffer.byteLength(query) > POLICY.maxQueryBytes || (query.match(/"/g)?.length ?? 0) % 2) return null;
  const units = [...query.matchAll(/"([^"]+)"|([\p{L}\p{N}_]+(?:[-./][\p{L}\p{N}_]+)*)/gu)]
    .map(match => (match[1] ?? match[2]!).trim().toLowerCase());
  const unique = [...new Set(units)].filter(Boolean);
  return unique.length && unique.length <= POLICY.maxTerms ? unique : null;
}

export function retrievePassages(db: Database, query: string, variant: Variant): PassageOutput {
  const rawUnits = queryUnits(query);
  if (!rawUnits) return { status: 'invalid_query', limited: false, hits: [] };
  // Deduplicate equivalents using the SAME SQLite tokenizer, not an ad-hoc
  // JS stemmer. 'run running absent' must not pass by counting one stem twice.
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS temp.query_units USING fts5(text, tokenize='${POLICY.tokenizer}');
    CREATE VIRTUAL TABLE IF NOT EXISTS temp.query_tokens USING fts5vocab(temp,query_units,instance);
    DELETE FROM temp.query_units;`);
  rawUnits.forEach((unit, i) => db.query('INSERT INTO temp.query_units(rowid,text) VALUES(?,?)').run(i + 1, unit));
  const seen = new Set<string>();
  const units = rawUnits.filter((_, i) => {
    const tokens = db.query('SELECT term FROM temp.query_tokens WHERE doc=? ORDER BY offset').all(i + 1) as Array<{term: string}>;
    const signature = JSON.stringify(tokens.map(token => token.term));
    if (!tokens.length || seen.has(signature)) return false;
    seen.add(signature); return true;
  });
  if (!units.length) return { status: 'invalid_query', limited: false, hits: [] };
  const quoted = units.map(term => `"${term.replaceAll('"', '""')}"`);
  const required = variant === 'passage-all' ? units.length
    : variant === 'passage-two-thirds' ? Math.ceil(units.length * 2 / 3) : 1;
  const candidates = db.query(`SELECT rowid,path,lineStart,lineEnd,text,bm25(passage_fts,1,${POLICY.headingWeight},${POLICY.pathWeight}) score
    FROM passage_fts WHERE passage_fts MATCH ?
    ORDER BY score,path COLLATE BINARY,CAST(lineStart AS INTEGER),CAST(lineEnd AS INTEGER)
    LIMIT ?`).all(quoted.join(' OR '), POLICY.candidateLimit + 1) as Candidate[];
  const output: PassageOutput = { status: 'no_lexical_match', limited: candidates.length > POLICY.candidateLimit, hits: [] };
  const termMatch = db.query('SELECT rowid FROM passage_fts WHERE rowid=? AND passage_fts MATCH ?');
  for (const candidate of candidates.slice(0, POLICY.candidateLimit)) {
    // Coverage is checked in the returned text, not hidden path/title tokens.
    const matchedTerms = quoted.filter(term => termMatch.get(candidate.rowid, `text : ${term}`) !== null).length;
    if (matchedTerms < required) { if (!output.hits.length) output.status = 'insufficient_term_coverage'; continue; }
    const hit = { path: candidate.path, lineStart: Number(candidate.lineStart), lineEnd: Number(candidate.lineEnd),
      text: candidate.text, matchedTerms, queryTerms: units.length };
    const next: PassageOutput = { ...output, status: 'matches', hits: [...output.hits, hit] };
    if (output.hits.length === POLICY.limit || Buffer.byteLength(JSON.stringify(next)) > POLICY.responseBytes) {
      output.limited = true; break;
    }
    output.status = 'matches'; output.hits.push(hit);
  }
  if (output.limited && !output.hits.length) output.status = 'candidate_limit';
  return output;
}
