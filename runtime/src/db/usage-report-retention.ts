import { createHash } from "node:crypto";
import type Database from "bun:sqlite";
import { unlinkedUsageReportPredicate } from "./usage-report-projection.js";

export interface UsageRetentionPlan {
  version:1; owner:"legacy-usage-reports"; before:string; after:number; through:number; examined:number;
  rows:readonly {id:number;sha256:string;serializedBytes:number}[];
  next:number|null;
}
function eligible(database: Database): string {
  const window=database.query("SELECT 1 FROM main.sqlite_schema WHERE name='budget_cap_windows'").get()
    ? ' AND NOT EXISTS (SELECT 1 FROM main.budget_cap_windows w WHERE t.run_at>=w.starts_at AND t.run_at<w.ends_at)' : '';
  return `length(t.run_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',t.run_at)=t.run_at AND t.run_at < ? AND t.usage_event_id IS NULL AND t.invocation_id IS NULL AND t.work_id IS NULL AND ${unlinkedUsageReportPredicate(database,"t")}${window}`;
}
function fields(value:unknown,keys:readonly string[]):boolean {
  return !!value&&typeof value==="object"&&!Array.isArray(value)&&JSON.stringify(Reflect.ownKeys(value).sort())===JSON.stringify([...keys].sort())&&keys.every(key=>"value" in Object.getOwnPropertyDescriptor(value,key)!);
}
const positive=(n:unknown):n is number=>typeof n==="number"&&Number.isSafeInteger(n)&&n>0;
function cutoff(value:string){if(typeof value!=="string"||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)throw Error("Invalid usage retention cutoff");}
function encoded(row:object){return JSON.stringify(row,(_key,value)=>{
  if(typeof value==="bigint"){const number=Number(value);if(!Number.isSafeInteger(number))throw Error("Unsafe usage retention integer");return number;}
  return value;
});}
function proof(row:object){const value=encoded(row);return{sha256:createHash("sha256").update(value).digest("hex"),serializedBytes:Buffer.byteLength(value)};}
function frame<T>(database:Database,write:boolean,fn:()=>T):T{return database.inTransaction?fn():write?database.transaction(fn).immediate():database.transaction(fn)();}

/** Dry-run snapshot. Persist this exact bounded plan before applying; replaying
 * its fixed IDs can never spill into the following page after a lost ACK. */
export function planUsageReportRetention(database:Database,input:{before:string;after?:number;limit?:number}):UsageRetentionPlan {
  cutoff(input.before);const after=input.after??0,limit=input.limit??1000;
  if(!Number.isSafeInteger(after)||after<0||!positive(limit)||limit>1000)throw Error("Invalid usage retention window");
  return frame(database,false,()=>{
    const filter=eligible(database);
    // Bound examined records as well as deletes, including protected/recent rows.
    const rows=database.query("SELECT * FROM main.token_usage WHERE id>? ORDER BY id LIMIT ?").all(after,limit+1) as {id:number|bigint}[];
    const page=rows.slice(0,limit),selected:UsageRetentionPlan["rows"][number][]=[];let through=after;
    for(const row of page){
      const id=Number(row.id);if(!positive(id))throw Error("Unsafe usage report identity");through=id;
      if(database.query(`SELECT 1 FROM main.token_usage t WHERE t.id=? AND ${filter}`).get(id,input.before)) selected.push(Object.freeze({id,...proof(row)}));
    }
    return Object.freeze({version:1,owner:"legacy-usage-reports",before:input.before,after,through,examined:page.length,rows:Object.freeze(selected),next:rows.length>limit?through:null});
  });
}

/** Only the reporting owner deletes its eligible legacy observations. No event,
 * reservation, work, native history or other owner's table is ever mutated. */
export function applyUsageReportRetention(database:Database,input:UsageRetentionPlan,validate:()=>void=()=>{}) {
  const plan=structuredClone(input);
  if(!fields(plan,["version","owner","before","after","through","examined","rows","next"])||plan.version!==1||plan.owner!=="legacy-usage-reports"||!Number.isSafeInteger(plan.after)||plan.after<0||!Number.isSafeInteger(plan.through)||plan.through<plan.after||!Number.isSafeInteger(plan.examined)||plan.examined<0||plan.examined>1000||(plan.examined===0?plan.through!==plan.after:plan.through<=plan.after)||!Array.isArray(plan.rows)||plan.rows.length>plan.examined)throw Error("Invalid usage retention plan");
  cutoff(plan.before);let previous=plan.after;
  for(const row of plan.rows){
    if(!fields(row,["id","sha256","serializedBytes"])||!positive(row.id)||row.id<=previous||row.id>plan.through||typeof row.sha256!=="string"||row.sha256.length!==64||/[^a-f0-9]/.test(row.sha256)||!positive(row.serializedBytes))throw Error("Invalid usage retention row proof");
    previous=row.id;
  }
  if(plan.next!==null&&(plan.examined===0||plan.next!==plan.through))throw Error("Invalid usage retention cursor");
  return frame(database,true,()=>{
    validate();const filter=eligible(database);const present:UsageRetentionPlan["rows"][number][]=[],alreadyAbsent:number[]=[];
    // Validate the complete selected page before the first DELETE.
    for(const expected of plan.rows){
      const row=database.query("SELECT * FROM main.token_usage WHERE id=?").get(expected.id) as object|null;
      if(!row){alreadyAbsent.push(expected.id);continue;}
      if(JSON.stringify(proof(row))!==JSON.stringify({sha256:expected.sha256,serializedBytes:expected.serializedBytes})||
        !database.query(`SELECT 1 FROM main.token_usage t WHERE t.id=? AND ${filter}`).get(expected.id,plan.before))throw Error("Usage retention plan changed or became referenced");
      present.push(expected);
    }
    const removed:number[]=[],blocked:number[]=[];let serializedBytesRemoved=0;
    for(const row of present){
      database.query(`DELETE FROM main.token_usage WHERE id=? AND id IN (SELECT t.id FROM main.token_usage t WHERE t.id=? AND ${filter})`).run(row.id,row.id,plan.before);
      const direct=database.query("SELECT changes() AS n").get() as {n:number|bigint};
      if(Number(direct.n)===1){removed.push(row.id);serializedBytesRemoved+=row.serializedBytes;}else blocked.push(row.id);
    }
    validate();return{removed,alreadyAbsent,blocked,serializedBytesRemoved,next:blocked.length?plan.after:plan.next};
  });
}
