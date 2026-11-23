// Ported from rcarmo/kintsugi b8469c29; MIT — see UPSTREAM-LICENSE.
import {Type} from "typebox";
import {Value} from "typebox/value";
import type { Database } from "bun:sqlite";
const invalidArguments = (message:string) => new Error(message);
import { checkpointDeletes, lineageCondition, type AgentDatabase, type Lineage } from "../../src/mcp/retained-database.ts";

/** Bounds for the per-workspace store. Expired rows are never returned, then deleted and overwritten on the next prune. */
export const toolOutputLimits = { maxChars: 4 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024, maxOutputs: 5000, readLines: 500, readChars: 16_000, lineChars: 2000, chunkLines: 20, chunkChars: 4000 } as const;
export type StoredToolOutput = { id: string; owner: string; conversation: number; after: number; tool: string; label: string; lines: number; bytes: number; complete: boolean; createdAt: number; expiresAt: number };
type Row = Omit<StoredToolOutput, "complete"> & { complete: number; text: string };
// SQLite TEXT replaces unpaired UTF-16 surrogates. Rare non-well-formed copies use JSON-in-BLOB; FTS chunks remain searchable text.
const decodeText = (text:string|Uint8Array):string => text instanceof Uint8Array?Value.Parse(Type.String(),JSON.parse(Buffer.from(text).toString("utf8"))):text;
const unavailable = () => invalidArguments("This stored output is unavailable: it expired, belongs to another Agent or branch, or was never stored. Check retained history; do not rerun an effect solely to reconstruct expired output.");
/** Who is asking: the owning Agent, and the branch history it can see. */
export type ToolOutputScope = { owner: string; lineage: Lineage };
const initialized = new WeakSet<Database>();

/**
 * Tables in the workspace's existing Agent search database. Raw outputs stay here, not in model context;
 * the durable journal keeps only the committed model-facing projection.
 */
export function createToolOutputStore(database: AgentDatabase, now: () => number = Date.now, limits: { maxOutputs: number; maxTotalBytes: number } = toolOutputLimits) {
  async function use<T>(action: (next: Database) => T) {
    return (await database()).withSync(next => {
    initialize(next);return action(next);
    });
  }
  function initialize(next: Database) {
    if (initialized.has(next)) return;
    // Large text stays in the last column: metadata reads stop before its overflow pages. The age index covers caps.
    next.exec(`CREATE TABLE IF NOT EXISTS retained_tool_outputs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, conversation INTEGER NOT NULL, after INTEGER NOT NULL, tool TEXT NOT NULL, label TEXT NOT NULL, lines INTEGER NOT NULL, bytes INTEGER NOT NULL, complete INTEGER NOT NULL, createdAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL, text TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS retained_tool_outputs_expiry ON retained_tool_outputs(expiresAt, id);
      CREATE INDEX IF NOT EXISTS retained_tool_outputs_age ON retained_tool_outputs(createdAt, bytes, id);
      CREATE TABLE IF NOT EXISTS retained_tool_output_chunks (id INTEGER PRIMARY KEY, outputId TEXT NOT NULL, line INTEGER NOT NULL, offset INTEGER NOT NULL, text TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS retained_tool_output_chunks_output ON retained_tool_output_chunks(outputId);
      CREATE VIRTUAL TABLE IF NOT EXISTS retained_tool_output_search USING fts5(text, content='retained_tool_output_chunks', content_rowid='id', tokenize='unicode61');
      CREATE TRIGGER IF NOT EXISTS tool_output_chunk_insert AFTER INSERT ON retained_tool_output_chunks BEGIN INSERT INTO retained_tool_output_search(rowid,text) VALUES(new.id,new.text); END;
      CREATE TRIGGER IF NOT EXISTS tool_output_chunk_delete AFTER DELETE ON retained_tool_output_chunks BEGIN INSERT INTO retained_tool_output_search(retained_tool_output_search,rowid,text) VALUES('delete',old.id,old.text); END;
      INSERT INTO retained_tool_output_search(retained_tool_output_search,rank) VALUES('secure-delete',1);`);
    initialized.add(next);
  }
  function remove(database: Database, ids: string[]) {
    for (const id of ids) {database.run("DELETE FROM retained_tool_output_chunks WHERE outputId=?", [id]);database.run("DELETE FROM retained_tool_outputs WHERE id=?", [id]);}
    return ids.length;
  }
  function expireIn(database:Database) {return remove(database,database.query<{id:string},[number]>("SELECT id FROM retained_tool_outputs WHERE expiresAt<=?").all(now()).map(row=>row.id));}
  function pruneIn(database: Database) {
    let removed = expireIn(database);
    const totals = database.query<{ n: number; bytes: number }, []>("SELECT count(*) AS n,coalesce(sum(bytes),0) AS bytes FROM retained_tool_outputs").get()!;
    let { n, bytes } = totals;
    if (n > limits.maxOutputs || bytes > limits.maxTotalBytes) for (const row of database.query<{ id: string; bytes: number }, []>("SELECT id,bytes FROM retained_tool_outputs ORDER BY createdAt").all()) {
      if (n <= limits.maxOutputs && bytes <= limits.maxTotalBytes) break;
      removed += remove(database, [row.id]);n--;bytes -= row.bytes;
    }
    return removed;
  }
  function checkpoint(database: Database, removed: number) {
    if (removed) checkpointDeletes(database);
    return removed;
  }
  async function prune() {
    return use(database => checkpoint(database, database.transaction(() => pruneIn(database))()));
  }
  async function find(scope: ToolOutputScope, id: string) {
    const visible = lineageCondition("o", scope.lineage);
    const row = await use(db => {
      checkpoint(db,db.transaction(()=>expireIn(db))());
      return db.query<Omit<Row,"text">&{text:string|Uint8Array}, (string | number)[]>(`SELECT * FROM retained_tool_outputs o WHERE o.id=? AND o.owner=? AND o.expiresAt>? AND ${visible.sql}`).get(id, scope.owner, now(), ...visible.params);
    });
    if (!row) throw unavailable();
    return {...row,text:decodeText(row.text)};
  }
  const describe = (row: Row): StoredToolOutput => ({ id: row.id, owner: row.owner, conversation: row.conversation, after: row.after, tool: row.tool, label: row.label, lines: row.lines, bytes: row.bytes, complete: Boolean(row.complete), createdAt: row.createdAt, expiresAt: row.expiresAt });
  return {
    prune,
    /** Idempotent by ID: a replayed save keeps the first copy and extends its expiry. */
    async save(input: { id: string; owner: string; conversation: number; after: number; tool: string; label: string; text: string; complete: boolean; retentionMs: number }): Promise<StoredToolOutput> {
      return use(database => {
      const at = now(), text = input.text.slice(0, toolOutputLimits.maxChars), complete = input.complete && text.length === input.text.length;
      let removed = 0;
      const saved = database.transaction(() => {
        removed += pruneIn(database);
        const existing = database.query<Omit<Row, "text">, [string]>("SELECT id,owner,conversation,after,tool,label,lines,bytes,complete,createdAt,expiresAt FROM retained_tool_outputs WHERE id=?").get(input.id);
        if (existing) {
          if (existing.owner !== input.owner) throw new Error("Stored output identity collision");
          database.run("UPDATE retained_tool_outputs SET expiresAt=max(expiresAt,?) WHERE id=?", [at + input.retentionMs, input.id]);
          return describe({ ...existing, text: "", expiresAt: Math.max(existing.expiresAt, at + input.retentionMs) });
        }
        const lines = text.split("\n"), row: Row = { id: input.id, owner: input.owner, conversation: input.conversation, after: input.after, tool: input.tool, label: input.label.slice(0, 1000), text, lines: lines.length, bytes: Buffer.byteLength(text), complete: Number(complete), createdAt: at, expiresAt: at + input.retentionMs };
        database.run("INSERT INTO retained_tool_outputs(id,owner,conversation,after,tool,label,lines,bytes,complete,createdAt,expiresAt,text) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", [row.id, row.owner, row.conversation, row.after, row.tool, row.label, row.lines, row.bytes, row.complete, row.createdAt, row.expiresAt, /[\uD800-\uDFFF]/u.test(row.text)?Buffer.from(JSON.stringify(row.text)):row.text]);
        // Small line groups keep search results close to the line a reader should open.
        let offset = 0, chunk: string[] = [], chunkLine = 1, chunkOffset = 0;
        const flush = () => {if (chunk.length) database.run("INSERT INTO retained_tool_output_chunks(outputId,line,offset,text) VALUES(?,?,?,?)", [row.id, chunkLine, chunkOffset, chunk.join("\n")]);chunk = [];};
        for (const [index, line] of lines.entries()) {
          if (line.length > toolOutputLimits.chunkChars) {
            flush();
            for (let start = 0; start < line.length; start += toolOutputLimits.chunkChars) database.run("INSERT INTO retained_tool_output_chunks(outputId,line,offset,text) VALUES(?,?,?,?)", [row.id, index + 1, offset + start, line.slice(start, start + toolOutputLimits.chunkChars)]);
          } else {
            if (chunk.length >= toolOutputLimits.chunkLines || chunk.reduce((n, item) => n + item.length + 1, 0) + line.length > toolOutputLimits.chunkChars) flush();
            if (!chunk.length) {chunkLine = index + 1;chunkOffset = offset;}
            chunk.push(line);
          }
          offset += line.length + 1;
        }
        flush();
        removed += pruneIn(database);
        return describe(row);
      })();
      checkpoint(database,removed);
      if (!database.query("SELECT 1 FROM retained_tool_outputs WHERE id=?").get(saved.id)) throw new Error("Stored output was not retained within the configured limits");
      return saved;
      });
    },
    async search(scope: ToolOutputScope, input: { query: string; id?: string; syntax?: "plain" | "fts"; limit?: number }) {
      const words = input.query.match(/[\p{L}\p{N}_]+/gu)?.slice(0, 32) ?? [];
      if (input.syntax !== "fts" && !words.length) throw invalidArguments("Enter at least one searchable word");
      const query = input.syntax === "fts" ? input.query : words.map(word => `"${word}"`).join(" AND ");
      if (input.id) await find(scope, input.id);
      return use(db => {
      const visible = lineageCondition("o", scope.lineage);
      checkpoint(db,db.transaction(()=>expireIn(db))());
      try {
        return db.query<{ id: string; tool: string; label: string; line: number; offset: number; excerpt: string; expiresAt: number }, (string | number)[]>(`SELECT o.id,o.tool,o.label,c.line,c.offset,snippet(retained_tool_output_search,0,'[',']',' … ',32) AS excerpt,o.expiresAt
          FROM retained_tool_output_search JOIN retained_tool_output_chunks c ON c.id=retained_tool_output_search.rowid JOIN retained_tool_outputs o ON o.id=c.outputId
          WHERE retained_tool_output_search MATCH ? AND o.owner=? AND o.expiresAt>? AND (?='' OR o.id=?) AND ${visible.sql} ORDER BY bm25(retained_tool_output_search),o.createdAt DESC,c.line LIMIT ?`)
          .all(query, scope.owner, now(), input.id ?? "", input.id ?? "", ...visible.params, input.limit ?? 8).map(row => ({ ...row, label: row.label.slice(0, 200), excerpt: row.excerpt.slice(0, 800), expiresAt: new Date(row.expiresAt).toISOString() }));
      } catch (error) {
        if (error instanceof Error && /fts5|syntax error|unterminated|no such column/i.test(error.message)) throw invalidArguments("Invalid FTS query. Use words, quoted phrases, OR, NOT or prefix*.");
        throw error;
      }
      });
    },
    /** A bounded window: at most 500 lines or 16,000 characters, with long lines shortened. Offsets page through long lines. */
    async read(scope: ToolOutputScope, input: { id: string; start?: number; lines?: number; fromEnd?: boolean; offset?: number; maxChars?: number }) {
      const row = await find(scope, input.id), base = { ...describe(row), expiresAt: new Date(row.expiresAt).toISOString(), createdAt: new Date(row.createdAt).toISOString() };
      const maxChars = Math.min(input.maxChars ?? toolOutputLimits.readChars, toolOutputLimits.readChars);
      if (input.offset !== undefined) {
        const text = row.text.slice(input.offset, input.offset + maxChars), next = input.offset + text.length;
        return { ...base, offset: input.offset, text, nextOffset: next < row.text.length ? next : null, totalChars: row.text.length };
      }
      const all = row.text.split("\n"), count = Math.min(input.lines ?? 200, toolOutputLimits.readLines);
      const first = input.fromEnd ? Math.max(1, all.length - count + 1) : Math.max(1, input.start ?? 1);
      const shown: string[] = [];let used = 0, shortened = 0, last = first - 1;
      for (let index = first - 1; index < Math.min(all.length, first - 1 + count); index++) {
        let line = all[index]!;
        const budget = Math.min(toolOutputLimits.lineChars,maxChars);
        if (line.length > budget) {const suffix = " … [line shortened; use offset to read the rest]";line = line.slice(0,Math.max(0,budget-suffix.length))+suffix.slice(0,budget);shortened++;}
        if (shown.length && used + line.length + 1 > maxChars) break;
        shown.push(line);used += line.length + 1;last = index + 1;
      }
      return { ...base, startLine: first, endLine: last, text: shown.join("\n"), linesShortened: shortened, nextStart: last < all.length ? last + 1 : null, totalLines: all.length };
    },
  };
}
export type ToolOutputStore = ReturnType<typeof createToolOutputStore>;
