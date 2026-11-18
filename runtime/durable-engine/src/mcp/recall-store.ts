// Kintsugi b8469c29 MIT port; see UPSTREAM-LICENSE. Foreign Kintsugi journals are never imported.
import {createHash} from "node:crypto";
import type {Database} from "bun:sqlite";
import {Type} from "typebox";
import {Value} from "typebox/value";
import {mcpAgentAllowed} from "./policy.ts";
import type {Harness,ConversationId,DocumentReader} from "@earendil-works/pi-durable";
import {type Context} from "@earendil-works/chord/context";
const invalidArguments=(message:string)=>new Error(message);
import {defaultMcpRecallSettings,type McpRecallSettings} from "#token-optimizer/core";
import {recallStorageAllowed} from './recall-privacy.ts';
import {captureMark,checkpointDeletes,conversationLineage,lineageCondition,type AgentDatabase} from "./retained-database.ts";
import type {McpConnection,McpConnectionStore} from "./connections.ts";
export type McpRecallGrant={connectionId:string;epoch:string};
/** Retained metadata; the raw value is read only when one result is retrieved. */
export type McpRecallItem={id:string;owner:string;grants:McpRecallGrant[];tool:string;kind:"mcp-envelope"|"emitted-text";summary:string;handler:string;sources:string[];bytes:number;createdAt:number;lastSeen:number;hits:number;pinned:boolean;isError:boolean};
export type McpRecallRecord=McpRecallItem&{raw:string};
export const mcpAccessEpoch=(config:McpConnection)=>config.accessEpoch??`legacy:${config.revision}`;
export type McpRecallIdentity={owner:string;agentId:string};
export function mcpRecallAllowed(config:McpConnection|undefined,workspaceId:string,owner:string):config is McpConnection {
  return mcpAgentAllowed(config,workspaceId,owner);
}
const grantsSchema=Type.Array(Type.Object({connectionId:Type.String(),epoch:Type.String()}));
const sourcesSchema=Type.Array(Type.String());
type Row={id:string;owner:string;tool:string;kind:string;grants:string;sources:string;handler:string;bytes:number;createdAt:number;lastSeen:number;hits:number;pinned:number;isError:number;summary:string;legacy:number};
// Metadata columns precede the raw value, so listing and pruning never read its overflow pages.
const columns="r.id,r.owner,r.tool,r.kind,r.grants,r.sources,r.handler,r.bytes,r.createdAt,r.lastSeen,r.hits,r.pinned,r.isError,r.summary,r.legacy";
const item=(row:Row):McpRecallItem=>({id:row.id,owner:row.owner,tool:row.tool,kind:row.kind==="emitted-text"?"emitted-text":"mcp-envelope",grants:Value.Parse(grantsSchema,JSON.parse(row.grants)),sources:Value.Parse(sourcesSchema,JSON.parse(row.sources)),handler:row.handler,bytes:row.bytes,createdAt:row.createdAt,lastSeen:row.lastSeen,hits:row.hits,pinned:Boolean(row.pinned),isError:Boolean(row.isError),summary:row.summary});
// SQLite TEXT normalises unpaired UTF-16 units. Keep their exact JSON representation separately; FTS indexes plain text.
const retainedRaw=(row:{raw:string;exact_raw:string|null}):string=>row.exact_raw===null?row.raw:Value.Parse(Type.String(),JSON.parse(row.exact_raw));
const initialized=new WeakSet<Database>();
function initialize(db:Database){
  if(initialized.has(db))return;
  // Publish the table, triggers and rebuilt FTS index in one transaction, including recovery after an interrupted upgrade.
  db.transaction(()=>{
  let rebuilt=false;
  if(db.query("SELECT 1 FROM sqlite_master WHERE name='mcp_recall'").get()) {
    const statement=db.prepare<{name:string},[]>("PRAGMA table_info(mcp_recall)");let names:string[];
    try {names=statement.all().map(column=>column.name);}finally{statement.finalize();}
    if(!names.includes("legacy")||!names.includes("exact_raw")) {
        db.exec("DROP TRIGGER IF EXISTS mcp_recall_insert; DROP TRIGGER IF EXISTS mcp_recall_delete; DROP TABLE IF EXISTS mcp_recall_search; ALTER TABLE mcp_recall RENAME TO mcp_recall_previous;");
        db.exec("CREATE TABLE mcp_recall(n INTEGER PRIMARY KEY,id TEXT NOT NULL UNIQUE,digest TEXT NOT NULL,owner TEXT NOT NULL,conversation INTEGER NOT NULL,after INTEGER NOT NULL,tool TEXT NOT NULL,kind TEXT NOT NULL,grants TEXT NOT NULL,sources TEXT NOT NULL,handler TEXT NOT NULL,bytes INTEGER NOT NULL,createdAt INTEGER NOT NULL,lastSeen INTEGER NOT NULL,hits INTEGER NOT NULL,pinned INTEGER NOT NULL,isError INTEGER NOT NULL,summary TEXT NOT NULL,legacy INTEGER NOT NULL DEFAULT 0,exact_raw TEXT,raw TEXT NOT NULL);");
        db.exec(`INSERT INTO mcp_recall SELECT n,id,digest,owner,conversation,after,tool,kind,grants,sources,handler,bytes,createdAt,lastSeen,hits,pinned,isError,summary,${names.includes("legacy")?"legacy":"0"},${names.includes("exact_raw")?"exact_raw":"NULL"},raw FROM mcp_recall_previous; DROP TABLE mcp_recall_previous;`);
      rebuilt=true;
    }
  }
  db.exec(`CREATE TABLE IF NOT EXISTS mcp_recall (n INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, digest TEXT NOT NULL, owner TEXT NOT NULL, conversation INTEGER NOT NULL, after INTEGER NOT NULL, tool TEXT NOT NULL, kind TEXT NOT NULL, grants TEXT NOT NULL, sources TEXT NOT NULL, handler TEXT NOT NULL, bytes INTEGER NOT NULL, createdAt INTEGER NOT NULL, lastSeen INTEGER NOT NULL, hits INTEGER NOT NULL, pinned INTEGER NOT NULL, isError INTEGER NOT NULL, summary TEXT NOT NULL, legacy INTEGER NOT NULL DEFAULT 0, exact_raw TEXT, raw TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS mcp_recall_owner ON mcp_recall(owner, digest);
    CREATE VIRTUAL TABLE IF NOT EXISTS mcp_recall_search USING fts5(raw, content='mcp_recall', content_rowid='n', tokenize='unicode61');
    CREATE TRIGGER IF NOT EXISTS mcp_recall_insert AFTER INSERT ON mcp_recall BEGIN INSERT INTO mcp_recall_search(rowid,raw) VALUES(new.n,new.raw); END;
    CREATE TRIGGER IF NOT EXISTS mcp_recall_delete AFTER DELETE ON mcp_recall BEGIN INSERT INTO mcp_recall_search(mcp_recall_search,rowid,raw) VALUES('delete',old.n,old.raw); END;
    INSERT INTO mcp_recall_search(mcp_recall_search,rank) VALUES('secure-delete',1);`);
  if(rebuilt)db.exec("INSERT INTO mcp_recall_search(mcp_recall_search) VALUES('rebuild')");
  })();
  initialized.add(db);
}
/** Retention bounds the live recall index. It never deletes committed source journal evidence. */
export function expiredMcpRecall(rows:readonly McpRecallItem[],configs:readonly McpConnection[],now:number):Set<string>{
  const removed=new Set<string>(),configFor=(grant:McpRecallGrant)=>configs.find(config=>config.id===grant.connectionId&&mcpAccessEpoch(config)===grant.epoch);
  for(const row of rows){
    const settings=row.grants.map(grant=>configFor(grant)).map(config=>config?(config.recall??defaultMcpRecallSettings()):undefined);
    if(settings.some(value=>!value)||!row.pinned&&settings.some(value=>now-row.lastSeen>value!.maxAgeDays*86_400_000))removed.add(row.id);
  }
  function cap(group:McpRecallItem[],maxItems:number,maxBytes:number){
    const live=group.filter(row=>!removed.has(row.id));let bytes=live.reduce((sum,row)=>sum+row.bytes,0),items=live.length;
    for(const row of live.sort((a,b)=>Number(a.pinned)-Number(b.pinned)||a.lastSeen-b.lastSeen||a.id.localeCompare(b.id))){if(items<=maxItems&&bytes<=maxBytes)break;removed.add(row.id);items--;bytes-=row.bytes;}
  }
  for(const config of configs){const settings=config.recall??defaultMcpRecallSettings();cap(rows.filter(row=>row.grants.some(grant=>grant.connectionId===config.id)),settings.maxItems,settings.maxBytes);}
  cap([...rows],256,16*1024*1024);
  return removed;
}
export function createMcpRecallStore(workspaceId:string,harness:()=>Harness,connections:McpConnectionStore,identityOf:(id:ConversationId,context:Context)=>Promise<McpRecallIdentity>,database:AgentDatabase,now:()=>number=Date.now){
  async function use<T>(action:(db:Database)=>T) {return (await database()).withSync(db=>{initialize(db);return action(db);});}
  function configs(){return connections.list().flatMap(row=>{const config=connections.credential(row.id);return config?[config]:[];});}
  const allowed=(row:McpRecallItem,identity:McpRecallIdentity)=>row.owner===identity.owner&&row.grants.every(grant=>{const config=connections.credential(grant.connectionId);return mcpRecallAllowed(config,workspaceId,identity.agentId)&&(config.recall??defaultMcpRecallSettings()).mode!=="off"&&mcpAccessEpoch(config)===grant.epoch;});
  function remove(db:Database,ids:Iterable<string>){let removed=0;for(const id of ids){db.run("DELETE FROM mcp_recall WHERE id=?",[id]);removed++;}return removed;}
  function prune(db:Database){return remove(db,expiredMcpRecall(db.query<Row,[]>(`SELECT ${columns} FROM mcp_recall r`).all().map(item),configs(),now()));}
  // Never inside a transaction.
  const checkpoint=(db:Database,removed:number)=>{if(removed)checkpointDeletes(db);};
  /** Rows this conversation may use: its Agent's, captured on its branch history, under current grants. */
  async function visible(conversationId:ConversationId,context:Context){
    const identity=await identityOf(conversationId,context),lineage=lineageCondition("r",await conversationLineage(harness(),conversationId,context));
    await use(db=>checkpoint(db,db.transaction(()=>prune(db))()));
    return {owner:identity.owner,identity,sql:`r.owner=? AND r.legacy=0 AND ${lineage.sql}`,params:[identity.owner,...lineage.params],legacy:[] as string[]};
  }
  async function list(conversationId:ConversationId,context:Context,tool?:string){
    const scope=await visible(conversationId,context);
    return use(db=>db.query<Row,(string|number)[]>(`SELECT ${columns} FROM mcp_recall r WHERE ${scope.sql} AND (?='' OR r.tool=?) ORDER BY r.lastSeen DESC`).all(...scope.params,tool??"",tool??"").map(item).filter(row=>allowed(row,scope.identity)));
  }
  async function get(conversationId:ConversationId,id:string,context:Context):Promise<McpRecallRecord|undefined>{
    const scope=await visible(conversationId,context);
    return use(db=>{
    const row=db.query<Row&{raw:string;exact_raw:string|null},(string|number)[]>(`SELECT ${columns},r.raw,r.exact_raw FROM mcp_recall r WHERE r.id=? AND ${scope.sql}`).get(id,...scope.params);
    if(!row)return;
    row.raw=retainedRaw(row);
    // Retained copies are re-checked against the current sensitivity rules before they leave the store.
    if(!recallStorageAllowed(row.tool,row.raw)){checkpoint(db,remove(db,[row.id]));return;}
    const value=item(row);return allowed(value,scope.identity)?{...value,raw:row.raw}:undefined;
    });
  }
  async function search(conversationId:ConversationId,input:{query:string;tool?:string;limit?:number},context:Context){
    const words=input.query.match(/[\p{L}\p{N}_]+/gu)?.slice(0,16)??[];if(!words.length)throw invalidArguments("Enter at least one searchable word");
    const scope=await visible(conversationId,context),limit=input.limit??10;
    return use(db=>{
    // FTS ranks candidates; grants are checked afterwards, so read a bounded surplus.
    const rows=db.query<Row&{raw:string;exact_raw:string|null;excerpt:string},(string|number)[]>(`SELECT ${columns},r.raw,r.exact_raw,snippet(mcp_recall_search,0,'[',']',' … ',40) AS excerpt FROM mcp_recall_search JOIN mcp_recall r ON r.n=mcp_recall_search.rowid
      WHERE mcp_recall_search MATCH ? AND ${scope.sql} AND (?='' OR r.tool=?) ORDER BY bm25(mcp_recall_search),r.lastSeen DESC LIMIT ?`).all(words.map(word=>`"${word}"`).join(" AND "),...scope.params,input.tool??"",input.tool??"",limit*4+1);
    const results=rows.map(row=>({...row,raw:retainedRaw(row)})).filter(row=>recallStorageAllowed(row.tool,row.raw)).map(row=>({...item(row),excerpt:row.excerpt.slice(0,600)})).filter(row=>allowed(row,scope.identity));
    return {results:results.slice(0,limit),limited:results.length>limit};
    });
  }
  async function capture(conversationId:ConversationId,input:Pick<McpRecallRecord,"grants"|"tool"|"kind"|"raw"|"summary"|"handler"|"sources"|"isError">,context:Context){
    const identity=await identityOf(conversationId,context),owner=identity.owner,bytes=Buffer.byteLength(input.raw);
    if(!bytes||bytes>1024*1024||!input.grants.length||!recallStorageAllowed(input.tool,input.raw))return null;
    const digest=createHash("sha256").update(JSON.stringify([owner,input.grants,input.tool,input.kind,input.raw])).digest("hex"),conversation=Number(conversationId);
    const scope=await visible(conversationId,context),id=scope.legacy.includes(`mcp_${digest}`)?`mcp_${digest}`:"mcp_"+createHash("sha256").update(JSON.stringify([digest,conversation])).digest("hex"),after=await captureMark(harness(),conversationId,context),at=now();
    const draft:McpRecallItem={...input,grants:input.grants.map(grant=>({...grant})),sources:[...input.sources],owner,id,bytes,createdAt:at,lastSeen:at,hits:1,pinned:false};
    if(!allowed(draft,identity))return null;
    return use(db=>{
    if(!allowed(draft,identity))return null;
    let removed=0;
    const stored=db.transaction(()=>{
      // The same result already visible on this branch is refreshed rather than copied again.
      const previous=db.query<Row,(string|number)[]>(`SELECT ${columns} FROM mcp_recall r WHERE r.digest=? AND ${scope.sql}`).get(digest,...scope.params);
      if(previous){
        db.run("UPDATE mcp_recall SET hits=hits+1,lastSeen=?,summary=?,handler=?,sources=? WHERE id=?",[at,input.summary,input.handler,JSON.stringify(input.sources),previous.id]);
        return {...item(previous),hits:previous.hits+1,lastSeen:at,summary:input.summary,handler:input.handler,sources:[...input.sources]};
      }
      db.run("INSERT OR IGNORE INTO mcp_recall(id,digest,owner,conversation,after,tool,kind,grants,sources,handler,bytes,createdAt,lastSeen,hits,pinned,isError,summary,legacy,exact_raw,raw) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [id,digest,owner,conversation,after,draft.tool,draft.kind,JSON.stringify(draft.grants),JSON.stringify(draft.sources),draft.handler,bytes,at,at,1,0,Number(draft.isError),draft.summary,Number(scope.legacy.includes(id)),/[\uD800-\uDFFF]/u.test(input.raw)?JSON.stringify(input.raw):null,input.raw]);
      removed=prune(db);
      const row=db.query<Row,[string]>(`SELECT ${columns} FROM mcp_recall r WHERE r.id=?`).get(id);
      return row?item(row):null;
    })();
    checkpoint(db,removed);return stored;
    });
  }
  async function change(conversationId:ConversationId,action:"pin"|"forget",id:string|undefined,all:boolean,pinned:boolean,context:Context,tool?:string){
    const rows=await list(conversationId,context),scope=await visible(conversationId,context);
    const targets=rows.filter(row=>row.id===id||(all||tool!==undefined&&row.tool===tool)&&action==="forget");
    return use(db=>{
    db.transaction(()=>{for(const row of targets)if(action==="forget")remove(db,[row.id]);else db.run("UPDATE mcp_recall SET pinned=? WHERE id=?",[Number(pinned),row.id]);})();
    checkpoint(db,action==="forget"?targets.length:0);
    return targets.length;
    });
  }
  function settings(row:McpRecallItem):McpRecallSettings[] {return row.grants.map(grant=>connections.credential(grant.connectionId)?.recall??defaultMcpRecallSettings());}
  return {list,get,search,capture,change,settings};
}
export type McpRecallStore=ReturnType<typeof createMcpRecallStore>;
