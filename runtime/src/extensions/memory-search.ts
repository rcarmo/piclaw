/** Exact-reference note reads. No search, reranker, arbitrary path selector or exported content reader. */
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { getChatJid } from '../core/chat-context.js';
import { getWorkspaceDir } from '../core/config-context.js';
import { admitNoteIndexMetadata, admitNoteIndexStore, NoteIndexDenied } from '../note-retrieval/access.js';
import { CHUNKER_VERSION } from '../note-retrieval/chunker.js';
import { NOTE_INDEX_FORMAT } from '../note-retrieval/schema.js';
import { admittedNotePath, readNote, NoteSourceExcluded, NoteSourceUnstable } from '../note-retrieval/files.js';
import { markNoteIndexDirty } from '../note-retrieval/coordinator.js';
import { requestBackgroundWorkspaceIndexRefresh } from '../workspace-search.js';
import { prepareFtsQuery, extractFtsFallbackTerms, isFtsOperatorQuery } from '../utils/fts-query.js';
import { prepareBroadNoteQuery } from '../note-retrieval/query-candidates.js';

const querySchema = Type.Object({
  query: Type.String({ description: 'Plain-language or FTS5 note query (1–512 characters).', minLength: 1, maxLength: 512 }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5, description: 'Maximum verified hits (default 5).' })),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 50, description: 'Bounded candidate offset (default 0).' })),
  mode: Type.Optional(Type.Union([Type.Literal('strict'), Type.Literal('candidate')], { description: 'strict (default) uses the existing all-term retrieval; candidate explicitly requests broader lexical matches, not assessed answers.' })),
}, { additionalProperties: false });
const schema = Type.Object({
  chunk_id: Type.String({ description: 'Exact nr1 chunk reference; never a path or heading.', pattern: '^nr1:[a-f0-9]{64}$' }),
  source_revision: Type.String({ description: 'Full-source SHA-256 supplied with the chunk reference.', pattern: '^[a-f0-9]{64}$' }),
}, { additionalProperties: false });
type Request = { chunk_id: string; source_revision: string };
type Status = 'ok' | 'partial' | 'access_denied' | 'invalid_request' | 'not_found' | 'source_stale' | 'index_unavailable' | 'source_unavailable' | 'limit_exceeded' | 'cancelled';
interface IndexState { namespace: string | null; binding: string | null; format: string | null; published: number | null; state: string; dirty: number; coverage: number; last_complete: number | null }
interface Chunk { chunk_id: string; revision: string; path: string; chunker: string; first_byte: number; after_last_byte: number; line_start: number; line_end: number; heading: string; kind: string; content: string }
class Cancelled extends Error {}
class Deadline extends Error {}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const positive = (n: number) => Number.isSafeInteger(n) && n > 0;
const answer = (status: Status, fields: Record<string, unknown> = {}) => ({
  content: [{ type: 'text' as const, text: JSON.stringify({ status, ...fields }) }], details: { status },
});

/** Factory captures the server's chat binding; only its registered execute closure
 * can reach the module-private content path. This is not an authentication API for
 * arbitrary extension code (extensions already share host process privileges). */
export function createMemorySearchExtension(chatJid?: string): ExtensionFactory {
  return function memorySearch(pi: ExtensionAPI) {
    let session: { manager: ExtensionContext['sessionManager']; id: string; cwd: string } | null = null;
    pi.on('session_start', async (_event, ctx) => {
      session = null;
      try {
        admitNoteIndexMetadata()();
        if (!chatJid || !ctx?.sessionManager || realpathSync(ctx.cwd) !== realpathSync(getWorkspaceDir())) return;
        const id = ctx.sessionManager.getSessionId();
        if (typeof id !== 'string' || !id) return;
        session = { manager: ctx.sessionManager, id, cwd: ctx.cwd };
      } catch { session = null; }
    });
    pi.on('session_shutdown', async () => { session = null; });
    pi.registerTool({
      name: 'memory_query', label: 'memory_query', parameters: querySchema,
      description: 'Search indexed local Markdown notes in single-user mode. Strict mode is the default. Explicit candidate mode broadens lexical matching but returns unassessed candidates, never an answer verdict. Both modes source-verify citations and enforce the same bounds. Activate explicitly.',
      promptSnippet: 'memory_query: strict by default. Candidate mode is explicit broader lexical recall, NOT answer evidence; verify cited text via memory_get. Partial never means no answer.',
      async execute(_callId, params, signal, _onUpdate, ctx) {
        const captured = session;
        let revoked = false;
        const checkSession = () => {
          try {
            admitNoteIndexMetadata()();
            if (revoked || !captured || session !== captured || !chatJid || getChatJid('') !== chatJid
              || !ctx || ctx.cwd !== captured.cwd || ctx.sessionManager !== captured.manager
              || ctx.sessionManager.getSessionId() !== captured.id || !pi.getActiveTools().includes('memory_query')
              || realpathSync(ctx.cwd) !== realpathSync(getWorkspaceDir())) throw new NoteIndexDenied();
          } catch { revoked = true; throw new NoteIndexDenied(); }
        };
        try { checkSession(); } catch { return answer('access_denied'); }
        let access: ReturnType<typeof admitNoteIndexStore>;
        try { access = admitNoteIndexStore(); } catch { return answer('access_denied'); }
        const started = performance.now();
        const check = () => {
          checkSession(); access.validate();
          if (signal?.aborted || ctx.signal?.aborted) throw new Cancelled();
          if (performance.now() - started >= 2000) throw new Deadline();
        };
        const finish = (status: Status, fields: Record<string, unknown> = {}) => { check(); return answer(status, fields); };
        const db = access.database;
        try {
          check();
          if (!params || typeof params !== 'object' || Object.keys(params).some(k => !['query','limit','offset','mode'].includes(k))) return finish('invalid_request');
          const { query, limit = 5, offset = 0, mode = 'strict' } = params as { query: unknown; limit?: unknown; offset?: unknown; mode?: unknown };
          if (typeof query !== 'string' || query.trim().length < 1 || query.length > 512
            || (query.match(/"/g)?.length ?? 0) % 2 !== 0
            || (mode !== 'strict' && mode !== 'candidate')
            || !Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 5
            || !Number.isSafeInteger(offset) || (offset as number) < 0 || (offset as number) > 50) return finish('invalid_request');
          const fts = mode === 'candidate' ? prepareBroadNoteQuery(query) : prepareFtsQuery(query, 'and');
          if (!fts || fts.length > 2048) return finish('invalid_request');
          if (db.inTransaction || !db.query("SELECT 1 FROM sqlite_master WHERE name='note_retrieval_state'").get()) return finish('index_unavailable');
          const state = () => db.query('SELECT namespace,binding,format,published,state,dirty,coverage,last_complete,exclusions FROM note_retrieval_state WHERE id=1').get() as (IndexState & { exclusions: number }) | null;
          const initial = state();
          const compatible = (s: typeof initial): s is NonNullable<typeof initial> & { namespace: string; published: number } => Boolean(s
            && typeof s.namespace === 'string' && s.namespace.length > 0 && s.namespace.length <= 256
            && s.format === NOTE_INDEX_FORMAT && s.binding === JSON.stringify(access.binding)
            && positive(s.published as number) && ['ready','stale','limited','indexing'].includes(s.state)
            && Number.isSafeInteger(s.dirty) && Number.isSafeInteger(s.coverage) && Number.isSafeInteger(s.exclusions));
          if (!compatible(initial)) return finish('index_unavailable');
          const reasons = new Set<string>();
          let ownDirty = 0;
          const overdue = (s: NonNullable<typeof initial>) => !positive(s.last_complete as number)
            || Date.now() < s.last_complete! || Date.now() - s.last_complete! >= 300_000;
          if (initial.state !== 'ready' || overdue(initial)) reasons.add('refresh_pending');
          if (initial.exclusions > 0) reasons.add('excluded_sources');
          const scopeDirty = () => Boolean(db.query('SELECT 1 FROM note_retrieval_dirty LIMIT 1').get());
          if (scopeDirty()) reasons.add('refresh_pending');
          if (reasons.has('refresh_pending')) requestBackgroundWorkspaceIndexRefresh({ scope: 'notes' });
          type Candidate = Chunk & { rank: number; generation: number };
          const candidatesSql = `SELECT c.chunk_id,c.revision,c.path,c.chunker,c.first_byte,c.after_last_byte,c.line_start,c.line_end,c.heading,c.kind,
              hex(CAST(c.content AS BLOB)) AS content,c.generation,bm25(note_retrieval_fts) AS rank
              FROM note_retrieval_fts LEFT JOIN note_retrieval_chunks c
                ON c.chunk_id=note_retrieval_fts.chunk_id AND c.generation=note_retrieval_fts.generation
              WHERE note_retrieval_fts MATCH ? AND note_retrieval_fts.generation=?
              ORDER BY rank,c.path COLLATE BINARY,c.first_byte,c.chunk_id COLLATE BINARY LIMIT 21 OFFSET ?`;
          let candidates: Candidate[];
          try {
            candidates = db.query(candidatesSql).all(fts, initial.published, offset as number) as Candidate[];
          } catch (error) {
            check();
            if ((error as { code?: string }).code === 'SQLITE_ERROR' && /fts5: syntax error|unterminated string|malformed MATCH expression|fts5: (?:unterminated|unknown special query)/i.test(String((error as Error).message))) return finish('invalid_request');
            return finish('index_unavailable');
          }
          const originalCandidates = JSON.stringify(candidates);
          if (candidates.length > 20) { reasons.add('validation_budget'); candidates = candidates.slice(0,20); }
          const terms = extractFtsFallbackTerms(query, { dropFtsKeywords: isFtsOperatorQuery(query) });
          const verified: Array<Record<string, unknown>> = [];
          const sources = new Map<string, Awaited<ReturnType<typeof readNote>> | null>();
          const observedDirty = new Map<string, number | null>();
          const dirtyRevision = (path: string) => {
            const row = db.query("SELECT revision FROM note_retrieval_dirty WHERE path=? OR path='*' ORDER BY path LIMIT 1").get(path) as { revision: number } | null;
            return row?.revision ?? null;
          };
          const dirty = (path: string) => Boolean(db.query("SELECT 1 FROM note_retrieval_dirty WHERE path=? OR path='*'").get(path));
          const stale = (path: string) => {
            check(); reasons.add('source_stale'); markNoteIndexDirty([path]); ownDirty++; check();
            requestBackgroundWorkspaceIndexRefresh({ scope: 'notes' });
          };
          for (const row of candidates) {
            check();
            if (!row.chunk_id) return finish('index_unavailable');
            if (typeof row.path !== 'string' || !admittedNotePath(row.path) || row.chunker !== CHUNKER_VERSION
              || row.generation !== initial.published || row.revision?.length !== 64 || !/^[a-f0-9]{64}$/.test(row.revision)
              || ![row.first_byte,row.after_last_byte,row.line_start,row.line_end].every(n => Number.isSafeInteger(n) && n >= 0)
              || row.after_last_byte <= row.first_byte || row.after_last_byte - row.first_byte > 16 * 1024
              || row.line_start < 1 || row.line_end < row.line_start || typeof row.heading !== 'string'
              || row.heading.length > 16 * 1024 || !['section','paragraph','lines','fence'].includes(row.kind)
              || typeof row.content !== 'string' || !Number.isFinite(row.rank)
              || row.chunk_id !== `nr1:${hash(JSON.stringify([initial.namespace,row.path,row.revision,CHUNKER_VERSION,row.first_byte,row.after_last_byte]))}`) return finish('index_unavailable');
            const headings: unknown = JSON.parse(row.heading);
            if (!Array.isArray(headings) || !headings.every(s => typeof s === 'string')) return finish('index_unavailable');
            if (!observedDirty.has(row.path)) observedDirty.set(row.path, dirtyRevision(row.path));
            if (dirty(row.path)) { reasons.add('refresh_pending'); continue; }
            if (!sources.has(row.path)) {
              try { sources.set(row.path, await readNote(access.binding.workspace, row.path, check)); }
              catch (error) {
                check();
                if (error instanceof NoteSourceExcluded || ['ENOENT','ENOTDIR','ELOOP'].includes((error as NodeJS.ErrnoException).code ?? '')) {
                  stale(row.path); sources.set(row.path,null);
                } else if (error instanceof Cancelled || error instanceof Deadline || error instanceof NoteIndexDenied) throw error;
                else { reasons.add('source_unavailable'); sources.set(row.path,null); }
              }
            }
            check();
            const source = sources.get(row.path);
            if (!source) continue;
            if (source.revision !== row.revision) { stale(row.path); sources.set(row.path,null); continue; }
            const bytes = source.bytes;
            if (row.after_last_byte > bytes.length || (row.first_byte > 0 && bytes[row.first_byte-1] !== 10)
              || (row.after_last_byte < bytes.length && bytes[row.after_last_byte-1] !== 10)) return finish('index_unavailable');
            let startLine=1,endLine=1;
            for (let i=0;i<row.after_last_byte;i++) if (bytes[i]===10) {
              if (i<row.first_byte) startLine++;
              if (i<row.after_last_byte-1) endLine++;
            }
            if (startLine !== row.line_start || endLine !== row.line_end) return finish('index_unavailable');
            const slice=bytes.subarray(row.first_byte,row.after_last_byte);
            let text:string;
            try { text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(slice); }
            catch { return finish('index_unavailable'); }
            if (text.includes('\0') || slice.toString('hex').toUpperCase() !== row.content) return finish('index_unavailable');
            const lower = text.toLocaleLowerCase('und');
            const locations = terms.map(term=>lower.indexOf(term.toLocaleLowerCase('und'))).filter(at=>at>=0);
            const first = locations.length ? Math.min(...locations) : 0;
            const characters = [...text];
            const matchCharacter = [...text.slice(0, first)].length;
            const snippet = characters.slice(Math.max(0, matchCharacter-80), Math.max(0, matchCharacter-80)+320).join('');
            if (verified.length < (limit as number)) verified.push({ chunk_id: row.chunk_id, source_revision: row.revision,
              path: row.path, heading_path: headings, line_start: row.line_start, line_end: row.line_end,
              first_byte: row.first_byte, after_last_byte: row.after_last_byte, kind: row.kind,
              snippet, rank: row.rank, index_generation: initial.published,
              validated_at: new Date().toISOString() });
          }
          // No awaited I/O between final classification and return.
          check();
          for (const [path, source] of sources) if (source) {
            try { source.verify(); } catch (error) {
              check();
              if (error instanceof NoteSourceUnstable || error instanceof NoteSourceExcluded
                || ['ENOENT','ENOTDIR','ELOOP'].includes((error as NodeJS.ErrnoException).code ?? '')) {
                stale(path); verified.splice(0,verified.length,...verified.filter(hit=>hit.path!==path));
              } else { reasons.add('source_unavailable'); verified.splice(0,verified.length,...verified.filter(hit=>hit.path!==path)); }
            }
          }
          const current=state();
          if (!compatible(current) || current.namespace !== initial.namespace) return finish('index_unavailable');
          if (JSON.stringify(db.query(candidatesSql).all(fts, initial.published, offset as number)) !== originalCandidates) return finish('index_unavailable');
          if (current.published !== initial.published || current.dirty !== initial.dirty + ownDirty
            || current.coverage !== initial.coverage + ownDirty || current.last_complete !== initial.last_complete
            || (current.state !== initial.state && !(ownDirty > 0 && current.state === 'stale'))
            || (scopeDirty() && !reasons.has('refresh_pending') && ownDirty === 0)) {
            reasons.add('refresh_pending'); verified.length=0;
          }
          for (const hit of verified) if (dirty(hit.path as string)) {
            reasons.add('refresh_pending'); verified.length=0; break;
          }
          if (overdue(current)) reasons.add('refresh_pending');
          if (current.exclusions > 0) reasons.add('excluded_sources');
          for (const [path, revision] of observedDirty) if (dirtyRevision(path) !== revision && !sources.has(path)) {
            reasons.add('refresh_pending'); verified.length = 0; break;
          }
          const response = (hits: typeof verified) => answer(reasons.size ? 'partial':'ok', {
            completeness: reasons.size ? 'partial':'complete', reasons: [...reasons].sort(), hits,
            retrieval_mode: mode, answer_assessed: false,
            ...(mode === 'candidate' ? { candidate_warning: 'Broad lexical matches can omit answers and include irrelevant, contradicted or missing facts; inspect cited source before answering.' } : {}),
            limit, offset, index_generation: current.published, validated_at: new Date().toISOString(),
          });
          let result=response(verified);
          if (Buffer.byteLength(JSON.stringify(result)) > 16 * 1024) {
            reasons.add('validation_budget');
            while (verified.length && Buffer.byteLength(JSON.stringify(response(verified))) > 16 * 1024) verified.pop();
            result=response(verified);
            if (Buffer.byteLength(JSON.stringify(result)) > 16 * 1024) return finish('limit_exceeded');
          }
          check(); return result;
        } catch (error) {
          try { checkSession(); access.validate(); } catch { return answer('access_denied'); }
          if (signal?.aborted || ctx.signal?.aborted || error instanceof Cancelled) return answer('cancelled');
          if (error instanceof Deadline || performance.now()-started >= 2000) return answer('limit_exceeded');
          return answer('index_unavailable');
        }
      },
    });
    pi.registerTool({
      name: 'memory_get', label: 'memory_get', parameters: schema,
      description: 'Read one exact revision-bound local note chunk in single-user mode. Requires chunk_id and source_revision from the current note index. Returns no content for stale, denied or unavailable references; never guesses another passage. Activate explicitly. This does not search or refresh synchronously.',
      promptSnippet: 'memory_get: verify and read one exact note chunk reference; no arbitrary paths or guessed replacements.',
      async execute(_callId, params, signal, _onUpdate, ctx) {
        const captured = session;
        let revoked = false;
        const checkSession = () => {
          try {
            admitNoteIndexMetadata()();
            if (revoked || !captured || session !== captured || !chatJid || getChatJid('') !== chatJid
              || !ctx || ctx.cwd !== captured.cwd || ctx.sessionManager !== captured.manager
              || ctx.sessionManager.getSessionId() !== captured.id || !pi.getActiveTools().includes('memory_get')
              || realpathSync(ctx.cwd) !== realpathSync(getWorkspaceDir())) throw new NoteIndexDenied();
          } catch { revoked = true; throw new NoteIndexDenied(); }
        };
        // Authorise before reading request selectors, opening index rows or paths.
        try { checkSession(); } catch { return answer('access_denied'); }
        let access: ReturnType<typeof admitNoteIndexStore>;
        try { access = admitNoteIndexStore(); } catch { return answer('access_denied'); }
        const started = performance.now();
        const check = () => {
          checkSession(); access.validate();
          if (signal?.aborted || ctx.signal?.aborted) throw new Cancelled();
          if (performance.now() - started >= 2000) throw new Deadline();
        };
        const finish = (status: Status, fields: Record<string, unknown> = {}) => { check(); return answer(status, fields); };
        const db = access.database;
        try {
          check();
          if (!params || typeof params !== 'object' || Object.keys(params).some(k => k !== 'chunk_id' && k !== 'source_revision')) return finish('invalid_request');
          const { chunk_id: id, source_revision: revision } = params as Request;
          if (typeof id !== 'string' || !/^nr1:[a-f0-9]{64}$/.test(id)
            || typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) return finish('invalid_request');
          // Never validate against a caller-held stale read transaction.
          if (db.inTransaction) return finish('index_unavailable');
          if (!db.query("SELECT 1 FROM sqlite_master WHERE name='note_retrieval_state'").get()) return finish('index_unavailable');
          const state = () => db.query('SELECT namespace,binding,format,published,state,dirty,coverage,last_complete FROM note_retrieval_state WHERE id=1').get() as IndexState | null;
          const initial = state();
          const compatible = (s: IndexState | null): s is IndexState & { namespace: string; published: number } => Boolean(s
            && typeof s.namespace === 'string' && s.namespace.length > 0 && s.namespace.length <= 256
            && s.format === NOTE_INDEX_FORMAT && s.binding === JSON.stringify(access.binding)
            && positive(s.published as number) && ['ready','stale','limited','indexing'].includes(s.state));
          if (!compatible(initial)) return finish('index_unavailable');
          const select = db.query('SELECT chunk_id,revision,path,chunker,first_byte,after_last_byte,line_start,line_end,heading,kind,hex(CAST(content AS BLOB)) AS content FROM note_retrieval_chunks WHERE generation=? AND chunk_id=?');
          const row = select.get(initial.published, id) as Chunk | null;
          if (!row || row.revision !== revision) return finish('not_found');
          const fields = [row.first_byte,row.after_last_byte,row.line_start,row.line_end];
          if (typeof row.path !== 'string' || !admittedNotePath(row.path) || row.chunker !== CHUNKER_VERSION
            || !fields.every(n => Number.isSafeInteger(n) && n >= 0) || row.after_last_byte <= row.first_byte
            || row.after_last_byte - row.first_byte > 16 * 1024 || row.line_start < 1 || row.line_end < row.line_start
            || typeof row.heading !== 'string' || row.heading.length > 16 * 1024
            || !['section','paragraph','lines','fence'].includes(row.kind)
            || row.chunk_id !== `nr1:${hash(JSON.stringify([initial.namespace,row.path,row.revision,CHUNKER_VERSION,row.first_byte,row.after_last_byte]))}`) return finish('index_unavailable');
          const headings: unknown = JSON.parse(row.heading);
          if (!Array.isArray(headings) || !headings.every(s => typeof s === 'string')) return finish('index_unavailable');
          const dirty = () => Boolean(db.query("SELECT 1 FROM note_retrieval_dirty WHERE path=? OR path='*'").get(row.path));
          const stale = () => {
            check(); markNoteIndexDirty([row.path]); check();
            requestBackgroundWorkspaceIndexRefresh({ scope: 'notes' });
            return finish('source_stale');
          };
          if (dirty()) return stale();
          let source: Awaited<ReturnType<typeof readNote>>;
          try { source = await readNote(access.binding.workspace, row.path, check); }
          catch (error) {
            check();
            if (error instanceof NoteSourceExcluded || ['ENOENT','ENOTDIR','ELOOP'].includes((error as NodeJS.ErrnoException).code ?? '')) return stale();
            if (error instanceof Cancelled || error instanceof Deadline || error instanceof NoteIndexDenied) throw error;
            return finish('source_unavailable');
          }
          check();
          if (source.revision !== row.revision) return stale();
          const bytes = source.bytes;
          if (row.after_last_byte > bytes.length || (row.first_byte > 0 && bytes[row.first_byte - 1] !== 10)
            || (row.after_last_byte < bytes.length && bytes[row.after_last_byte - 1] !== 10)) return finish('index_unavailable');
          let startLine = 1, endLine = 1;
          for (let i = 0; i < row.after_last_byte; i++) if (bytes[i] === 10) {
            if (i < row.first_byte) startLine++;
            if (i < row.after_last_byte - 1) endLine++;
          }
          if (row.line_start !== startLine || row.line_end !== endLine) return finish('index_unavailable');
          const slice = bytes.subarray(row.first_byte, row.after_last_byte);
          let text: string;
          try { text = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(slice); }
          catch { return finish('index_unavailable'); }
          if (text.includes('\0') || typeof row.content !== 'string' || slice.toString('hex').toUpperCase() !== row.content) return finish('index_unavailable');
          // Build before final validation; no awaited I/O occurs afterwards.
          const result = answer('ok', { chunk_id: id, source_revision: revision, path: row.path,
            heading_path: headings, line_start: row.line_start, line_end: row.line_end,
            first_byte: row.first_byte, after_last_byte: row.after_last_byte,
            index_generation: initial.published, validated_at: new Date().toISOString(), text });
          if (Buffer.byteLength(JSON.stringify(result)) > 32 * 1024) return finish('limit_exceeded');
          check();
          try { source.verify(); } catch (error) {
            check();
            if (error instanceof NoteSourceUnstable || error instanceof NoteSourceExcluded
              || ['ENOENT','ENOTDIR','ELOOP'].includes((error as NodeJS.ErrnoException).code ?? '')) return stale();
            throw error;
          }
          const current = state();
          if (!compatible(current) || current.namespace !== initial.namespace || current.published !== initial.published
            || current.dirty !== initial.dirty || current.coverage !== initial.coverage
            || current.last_complete !== initial.last_complete || current.state !== initial.state) {
            if (dirty()) return stale();
            return finish('index_unavailable');
          }
          if (dirty()) return stale();
          if (JSON.stringify(select.get(current.published,id)) !== JSON.stringify(row)) return finish('index_unavailable');
          check(); return result;
        } catch (error) {
          // Denials precede detailed error classes and never include selectors or paths.
          try { checkSession(); access.validate(); } catch { return answer('access_denied'); }
          if (signal?.aborted || ctx.signal?.aborted || error instanceof Cancelled) return answer('cancelled');
          if (error instanceof Deadline || performance.now() - started >= 2000) return answer('limit_exceeded');
          return answer('index_unavailable');
        }
      },
    });
  };
}
