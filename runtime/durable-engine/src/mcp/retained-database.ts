// Piclaw binding for Kintsugi's retained-output indexes. No database or executor is opened here.
import type {Database} from 'bun:sqlite';
import type {Context} from '@earendil-works/chord/context';
import type {ConversationId,Harness} from '@earendil-works/pi-durable';
import {createLogger} from '../../../src/utils/logger.js';
const log=createLogger('mcp.retained-output');
export interface RetainedDatabase {withSync<T>(action:(database:Database)=>T):Promise<T>}
export type AgentDatabase=()=>Promise<RetainedDatabase>;
/** Borrow the existing application connection; every callback is one JS turn. The stores own only their data transactions. */
export function applicationRetainedDatabase(database:Database,assertCurrent:()=>void):AgentDatabase {
 const handle:RetainedDatabase={async withSync(action){assertCurrent();const value=action(database);assertCurrent();return value;}};
 return async()=>{assertCurrent();return handle;};
}
/** Retained copies use secure deletion. Busy WAL readers defer physical truncation, never access revocation. */
export function checkpointDeletes(database:Database){
 if(database.inTransaction)throw Error('Retained-output checkpoint requires a completed transaction');
 const result=database.query('PRAGMA wal_checkpoint(TRUNCATE)').get() as {busy?:number};
 if(result.busy)log.warn('Retained-output WAL checkpoint is busy; deleted rows are already inaccessible',{operation:'mcp.retained_checkpoint_busy'});
}
/** Forget only disposable copies. SDK journals and historical file-backed outputs are never touched. */
export async function forgetRetainedCopies(database:AgentDatabase,owner?:string){
 await(await database()).withSync(db=>{db.transaction(()=>{
  const exists=(table:string)=>!!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if(exists('retained_tool_outputs')){
   if(exists('retained_tool_output_chunks'))db.run('DELETE FROM retained_tool_output_chunks WHERE outputId IN (SELECT id FROM retained_tool_outputs'+(owner===undefined?'':' WHERE owner=?')+')',owner===undefined?[]:[owner]);
   db.run('DELETE FROM retained_tool_outputs'+(owner===undefined?'':' WHERE owner=?'),owner===undefined?[]:[owner]);
  }
  if(exists('mcp_recall'))db.run('DELETE FROM mcp_recall'+(owner===undefined?'':' WHERE owner=?'),owner===undefined?[]:[owner]);
 })();checkpointDeletes(db);});
}
export type Lineage=readonly{conversationId:number;before:number|null}[];
export async function conversationLineage(harness:Harness,id:ConversationId,context:Context):Promise<Lineage>{
 return harness.commit(async tx=>{const rows:{conversationId:number;before:number|null}[]=[];let current=await tx.conversation(id),before:number|null=null;
  while(current){rows.push({conversationId:Number(current.id),before});before=current.parent?Math.min(before??Number.MAX_SAFE_INTEGER,Number(current.parent.at)):null;current=current.parent?await tx.conversation(current.parent.conversationId):undefined;}return rows;
 },context);
}
export async function captureMark(harness:Harness,id:ConversationId,context:Context){return Number(await harness.commit(tx=>tx.latestEntryId(id),context)??0);}
export function lineageCondition(alias:string,lineage:Lineage,columns:{conversation?:'conversation'|'conversation_id';mark?:'after'|'id';inclusive?:boolean}={}){
 if(!lineage.length)return{sql:'0',params:[]};
 const conversation=columns.conversation??'conversation',mark=columns.mark??'after',comparison=columns.inclusive?'<=':'<';
 return{sql:`EXISTS (SELECT 1 FROM json_each(?) lineage WHERE json_extract(lineage.value,'$[0]')=${alias}.${conversation} AND (json_extract(lineage.value,'$[1]') IS NULL OR ${alias}.${mark}${comparison}json_extract(lineage.value,'$[1]')))`,params:[JSON.stringify(lineage.map(row=>[row.conversationId,row.before]))]};
}
