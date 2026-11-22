// Adapted from Kintsugi v0.8.7 (6d1cd829); see mcp/UPSTREAM-LICENSE.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { SqliteExecutor, SqliteValue } from '@earendil-works/pi-durable/storage/sqlite';

export const optimizerHistoryWindow = 512;
export const optimizerOversizedEntry = 'piclaw.optimizer-skipped-entry';
export const optimizerMaxEntryBytes = 128 * 1024;
const maxPayloadEntries = 1024;
const maxPayloadBytes = maxPayloadEntries * optimizerMaxEntryBytes;

export type OptimizerReadBudget = { remaining: number; bytes: number; partial: boolean };
export function optimizerReadBudget(): OptimizerReadBudget {
  return {remaining:maxPayloadEntries,bytes:maxPayloadBytes,partial:false};
}
export const optimizerHistoryRead = new AsyncLocalStorage<OptimizerReadBudget|'id'>();

const entryScan = /^SELECT record FROM entries WHERE conversation_id = \?(?: AND id >= \?)?(?: AND id <= \?)? ORDER BY id (?:ASC|DESC) LIMIT \?$/;
const taskRead = 'SELECT record FROM tasks WHERE id = ?';
const skippedEntry = (id: number, conversationId: number) => ({record:JSON.stringify({id,conversationId,kind:optimizerOversizedEntry})});
// The SDK caches task records across scopes. Reject a skipped task read
// rather than putting a synthetic record into that cache.
export class OptimizerTaskPayloadSkipped extends Error {}

/** Use the SQLite executor seam, not a patched SDK. In analysis scopes only,
 * read lengths from SQLite column metadata before fetching bounded payloads.
 * Keep cursor positions for omissions. Nothing is written to the transcript. */
export function boundOptimizerHistoryReads(executor: SqliteExecutor): SqliteExecutor {
  return {
    ...executor,
    get<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T|undefined> {
      const budget=optimizerHistoryRead.getStore();
      // Return the original promise on ordinary SDK reads, with no extra await.
      if (!budget) return executor.get<T>(sql,...params);
      return (async()=>{
        if (sql!==taskRead) {
          if (/\b(?:entries|tasks)\b/i.test(sql)) throw Error('Unrecognised optimiser history lookup');
          return executor.get<T>(sql,...params);
        }
        const row=await executor.get<{bytes:number}>('SELECT octet_length(record) AS bytes FROM tasks WHERE id = ?',...params);
        if (!row) return undefined;
        if (budget === 'id' || !canLoad(budget,row.bytes)) throw new OptimizerTaskPayloadSkipped('Optimiser task payload omitted');
        return executor.get<T>(sql,...params);
      })();
    },
    all<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T[]> {
      const budget=optimizerHistoryRead.getStore();
      if (!budget) return executor.all<T>(sql,...params);
      return (async()=>{
        if (!entryScan.test(sql)) {
          if (/\b(?:entries|tasks)\b/i.test(sql)) throw Error('Unrecognised optimiser history scan');
          return executor.all<T>(sql,...params);
        }
        if (budget === 'id') return (await executor.all<{id:number;conversation_id:number}>(
          sql.replace('SELECT record ','SELECT id, conversation_id '),...params)).map(row=>skippedEntry(row.id,row.conversation_id)) as T[];
        const metadata=await executor.all<{id:number;conversation_id:number;bytes:number}>(
          sql.replace('SELECT record ','SELECT id, conversation_id, octet_length(record) AS bytes '),...params);
        const allowed=metadata.filter(row=>canLoad(budget,row.bytes));
        const loaded=allowed.length ? await executor.all<{id:number;record:string}>(
          `SELECT id, record FROM entries WHERE id IN (${allowed.map(()=>'?').join(',')})`,...allowed.map(row=>row.id)) : [];
        if (loaded.length !== allowed.length) budget.partial=true;
        const byId=new Map(loaded.map(row=>[row.id,row.record]));
        return metadata.map(row=>byId.has(row.id) ? {record:byId.get(row.id)!} : skippedEntry(row.id,row.conversation_id)) as T[];
      })();
    },
  };
}

function canLoad(budget: OptimizerReadBudget, bytes: number): boolean {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > optimizerMaxEntryBytes || bytes > budget.bytes || budget.remaining <= 0) {
    budget.partial=true;return false;
  }
  budget.remaining--;budget.bytes-=bytes;return true;
}
