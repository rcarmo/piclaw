// Kintsugi b8469c29 fixture port; MIT — see ../src/mcp/UPSTREAM-LICENSE.
import {afterEach,expect,test} from "bun:test";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createToolOutputStore,toolOutputLimits,type ToolOutputScope} from "./fixtures/legacy-tool-output-store.ts";
import {Database} from "bun:sqlite";
import {createRetainedOutputReader} from '../src/retained-tool-output.ts';
import {mkdirSync} from "node:fs";
import {dirname} from "node:path";
import {applicationRetainedDatabase,lineageCondition,forgetRetainedCopies} from "../src/mcp/retained-database.ts";
const handles=new Map<string,Database>();
function agentDatabase(path:()=>Promise<string>){return async()=>{const file=await path();let db=handles.get(file);if(!db){mkdirSync(dirname(file),{recursive:true});db=new Database(file,{create:true});db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; PRAGMA busy_timeout=0");handles.set(file,db);}const connection=db;return{...await applicationRetainedDatabase(connection,()=>{})(),exec:async(sql:string)=>{connection.exec(sql);}};};}
async function closeAgentDatabaseFile(file:string){const db=handles.get(file);if(db){handles.delete(file);db.close();}}

const cleanup:(()=>Promise<void>)[]=[];
// Finalise the table-valued pragma so it cannot hold a read open on the shared connection.
const columns=(db:import("bun:sqlite").Database,table:string)=>{const statement=db.prepare<{name:string},[string]>("SELECT name FROM pragma_table_info(?)");try{return statement.all(table).map(row=>row.name);}finally{statement.finalize();}};
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(maxOutputs:number=toolOutputLimits.maxOutputs) {
  const dir=await mkdtemp(join(tmpdir(),"tool-output-store-"));let now=1_000_000;
  const file=join(dir,"builtin-durable","fixture","agent.sqlite"),database=agentDatabase(async()=>file),store=createToolOutputStore(database,()=>now,{maxOutputs,maxTotalBytes:toolOutputLimits.maxTotalBytes});
  cleanup.push(async()=>{await closeAgentDatabaseFile(file);await rm(dir,{recursive:true,force:true});});
  return {store,file,database,advance:(ms:number)=>{now+=ms;},get now(){return now;}};
}
const log=Array.from({length:300},(_,i)=>i===249?"line 250: NEEDLE-ALPHA failed in src/parser.ts":`line ${i+1}: value-${i+1}`).join("\n");
const scope:ToolOutputScope={owner:"agent",lineage:[{conversationId:7,before:null}]};
const save=(f:Awaited<ReturnType<typeof fixture>>,id="out_"+"a".repeat(32),text=log,where={owner:"agent",conversation:7,after:10})=>f.store.save({id,...where,tool:"bash",label:"cat big.log",text,complete:true,retentionMs:60_000});
const present=async(file:string,marker:string)=>(await Promise.all([file,`${file}-wal`].map(path=>readFile(path).then(bytes=>bytes.includes(Buffer.from(marker)),()=>false)))).some(Boolean);

test("stored outputs are searchable with FTS and readable only in bounded windows by their owning Agent",async()=>{
  const f=await fixture(),saved=await save(f);
  expect(saved).toMatchObject({lines:300,complete:true,expiresAt:f.now+60_000});
  const [hit]=await f.store.search(scope,{query:"NEEDLE ALPHA"});
  expect(hit).toMatchObject({id:saved.id,tool:"bash",label:"cat big.log"});expect(hit!.excerpt).toContain("[NEEDLE]");
  expect(hit!.line).toBeLessThanOrEqual(250);expect(hit!.line).toBeGreaterThan(250-toolOutputLimits.chunkLines);
  expect(await f.store.search(scope,{query:'"value-12" OR NEEDLE',syntax:"fts",id:saved.id})).toHaveLength(2);
  await expect(f.store.search(scope,{query:'"unterminated',syntax:"fts"})).rejects.toThrow("Invalid FTS query");
  // Another Agent cannot search, read or guess its way into the output.
  expect(await f.store.search({...scope,owner:"other"},{query:"NEEDLE"})).toEqual([]);await expect(f.store.read({...scope,owner:"other"},{id:saved.id})).rejects.toThrow("unavailable");
  const window=await f.store.read(scope,{id:saved.id,start:248,lines:3});
  expect(window).toMatchObject({startLine:248,endLine:250,nextStart:251,totalLines:300});expect(window.text.split("\n")).toEqual(["line 248: value-248","line 249: value-249","line 250: NEEDLE-ALPHA failed in src/parser.ts"]);
  expect(await f.store.read(scope,{id:saved.id,fromEnd:true,lines:2})).toMatchObject({startLine:299,endLine:300,nextStart:null});
  expect((await f.store.read(scope,{id:saved.id,lines:500})).text.length).toBeLessThanOrEqual(toolOutputLimits.readChars);
});

test('compatibility readers neither initialise a fresh store nor prune expired historical rows',async()=>{
 const f=await fixture(),reader=createRetainedOutputReader(f.database,()=>f.now),inspect=async()=> (await f.database()).withSync(db=>db.query("SELECT name FROM sqlite_schema WHERE name LIKE 'retained_tool_output%'").all());
 expect(await reader.search(scope,{query:'NEEDLE'})).toEqual([]);expect(await inspect()).toEqual([]);
 const saved=await save(f);const rows=await inspect();expect(rows.length).toBeGreaterThan(0);
 expect((await reader.read(scope,{id:saved.id,start:250,lines:1})).text).toContain('NEEDLE');
 await expect(reader.read({...scope,owner:'another-agent'},{id:saved.id})).rejects.toThrow('unavailable');
 f.advance(60_001);
 await expect(reader.read(scope,{id:saved.id})).rejects.toThrow('unavailable');
 expect(await reader.search(scope,{query:'NEEDLE'})).toEqual([]);expect(await inspect()).toEqual(rows);
 expect(await(await f.database()).withSync(db=>db.query('SELECT count(*) AS n FROM retained_tool_outputs').get())).toEqual({n:1});
});

test("a branch sees outputs captured on it and before its fork point, never later or sibling captures",async()=>{
  const f=await fixture();
  await save(f,"out_"+"1".repeat(32),"early NEEDLE",{owner:"agent",conversation:7,after:10});
  await save(f,"out_"+"2".repeat(32),"later NEEDLE",{owner:"agent",conversation:7,after:30});
  await save(f,"out_"+"3".repeat(32),"forked NEEDLE",{owner:"agent",conversation:9,after:40});
  const fork:ToolOutputScope={owner:"agent",lineage:[{conversationId:9,before:null},{conversationId:7,before:20}]};
  expect((await f.store.search(fork,{query:"NEEDLE"})).map(row=>row.id).sort()).toEqual(["out_"+"1".repeat(32),"out_"+"3".repeat(32)]);
  expect((await f.store.search(scope,{query:"NEEDLE"})).map(row=>row.id).sort()).toEqual(["out_"+"1".repeat(32),"out_"+"2".repeat(32)]);
  await expect(f.store.read(fork,{id:"out_"+"2".repeat(32)})).rejects.toThrow("unavailable");
  expect(lineageCondition("o",[])).toEqual({sql:"0",params:[]});
});

test("long lines are shortened in line windows and paged by character offset",async()=>{
  const f=await fixture(),line="x".repeat(50_000)+"TAIL-MARKER",saved=await save(f,"out_"+"b".repeat(32),`short\n${line}`);
  const window=await f.store.read(scope,{id:saved.id});expect(window).toMatchObject({linesShortened:1});expect(window.text).toContain("use offset");expect(window.text).not.toContain("TAIL-MARKER");
  const pages:string[]=[];let offset:number|null=0;
  while(offset!==null){const page=await f.store.read(scope,{id:saved.id,offset,maxChars:16_000});if(!("nextOffset" in page))throw Error("Expected a character page");pages.push(page.text);offset=page.nextOffset;}
  expect(pages.join("")).toBe(`short\n${line}`);
});

test("expired outputs are never returned, then pruning removes their text, chunks and index entries from disk",async()=>{
  const f=await fixture(),saved=await save(f),marker="PRIVATE-EXPIRY-MARKER",other=await save(f,"out_"+"c".repeat(32),`${marker}\n${log}`);
  expect(await f.store.search(scope,{query:"PRIVATE EXPIRY MARKER"})).toHaveLength(1);
  await (await f.database()).exec("PRAGMA wal_checkpoint(TRUNCATE);");expect(await present(f.file,marker)).toBe(true);
  f.advance(60_001);
  // Expiry is enforced at read time even before the next prune.
  expect(await f.store.search(scope,{query:"NEEDLE"})).toEqual([]);await expect(f.store.read(scope,{id:saved.id})).rejects.toThrow("unavailable");await expect(f.store.read(scope,{id:other.id})).rejects.toThrow("unavailable");
  expect(await f.store.prune()).toBe(0);await (await f.database()).withSync(db=>{
  for(const table of ["retained_tool_outputs","retained_tool_output_chunks"]) expect(db.query<{n:number},[]>(`SELECT count(*) AS n FROM ${table}`).get()!.n).toBe(0);expect(db.query("SELECT rowid FROM retained_tool_output_search WHERE retained_tool_output_search MATCH 'NEEDLE'").all()).toEqual([]);
  });
  // secure_delete and the WAL checkpoint leave no readable copy in the database files.
  expect(await present(f.file,marker)).toBe(false);
});

test("saving is idempotent, extends expiry and keeps the store within its item cap",async()=>{
  const f=await fixture(20),first=await save(f);f.advance(30_000);
  const again=await save(f);expect(again.id).toBe(first.id);expect(again.expiresAt).toBe(f.now+60_000);
  expect(await f.store.search(scope,{query:"NEEDLE"})).toHaveLength(1);
  for(let i=0;i<20;i++){f.advance(1);await save(f,`out_${i.toString(16).padStart(32,"0")}`,`item ${i}`);}
  // The oldest output is removed first once the cap is exceeded.
  await expect(f.store.read(scope,{id:first.id})).rejects.toThrow("unavailable");expect((await f.store.read(scope,{id:`out_${(19).toString(16).padStart(32,"0")}`})).text).toBe("item 19");
});

test("lookups, pruning and caps use indexes and never read stored text",async()=>{
  const f=await fixture();await save(f);await (await f.database()).withSync(db=>{
  // EXPLAIN of an FTS query keeps a virtual-table cursor until finalised, which would block later checkpoints.
  const plan=(sql:string,...params:(string|number)[])=>{const statement=db.prepare<{detail:string},(string|number)[]>(`EXPLAIN QUERY PLAN ${sql}`);try{return statement.all(...params).map(row=>row.detail).join(" | ");}finally{statement.finalize();}};
  expect(plan("SELECT * FROM retained_tool_outputs o WHERE o.id=? AND o.owner=?","x","agent")).toMatch(/SEARCH o USING INDEX sqlite_autoindex_retained_tool_outputs_1 \(id=\?\)/);
  expect(plan("SELECT id FROM retained_tool_outputs WHERE expiresAt<=?",1)).toContain("USING COVERING INDEX retained_tool_outputs_expiry");
  expect(plan("SELECT count(*),coalesce(sum(bytes),0) FROM retained_tool_outputs")).toContain("USING COVERING INDEX retained_tool_outputs_age");
  expect(plan("SELECT id,bytes FROM retained_tool_outputs ORDER BY createdAt")).toContain("USING COVERING INDEX retained_tool_outputs_age");
  expect(plan("DELETE FROM retained_tool_output_chunks WHERE outputId=?","x")).toMatch(/USING (COVERING )?INDEX retained_tool_output_chunks_output/);
  expect(plan("SELECT o.id,o.tool,o.label,o.expiresAt,c.line FROM retained_tool_output_search JOIN retained_tool_output_chunks c ON c.id=retained_tool_output_search.rowid JOIN retained_tool_outputs o ON o.id=c.outputId WHERE retained_tool_output_search MATCH ?","x")).toMatch(/VIRTUAL TABLE INDEX.*SEARCH c USING INTEGER PRIMARY KEY.*SEARCH o USING (COVERING )?INDEX sqlite_autoindex_retained_tool_outputs_1/);
  // Text is the last column, so metadata reads stop before its overflow pages.
  expect(columns(db,"retained_tool_outputs").at(-1)).toBe("text");
  });
});

test("workspace deletion forgets stored outputs but keeps the shared database usable",async()=>{
  const f=await fixture();await save(f);
  await forgetRetainedCopies(f.database);
  expect(await f.store.search(scope,{query:"NEEDLE"})).toEqual([]);expect(await present(f.file,"NEEDLE-ALPHA")).toBe(false);
  await save(f,"out_"+"d".repeat(32));expect(await f.store.search(scope,{query:"NEEDLE"})).toHaveLength(1);
});

test("small character windows remain bounded even when the first line is long",async()=>{
  const f=await fixture(),saved=await save(f,"out_"+"f".repeat(32),"x".repeat(5000));
  const result=await f.store.read(scope,{id:saved.id,maxChars:256});
  expect(result.text.length).toBeLessThanOrEqual(256);expect(result.text).toContain("offset");
});
test("expiry pruning during a save checkpoints deleted retained copies",async()=>{
  const f=await fixture(),marker="SAVE-PRUNE-PRIVATE-MARKER";
  await save(f,"out_"+"a".repeat(32),marker);f.advance(60_001);
  await save(f,"out_"+"b".repeat(32),"new result");
  expect(await present(f.file,marker)).toBe(false);
});

test("backward clock movement cannot advertise a copy evicted during its own save",async()=>{
  const f=await fixture(1),older=await save(f,"out_"+"a".repeat(32),"older retained");f.advance(-1000);
  await expect(save(f,"out_"+"b".repeat(32),"new backdated")).rejects.toThrow("not retained");
  expect((await f.store.read(scope,{id:older.id})).text).toBe("older retained");
  await expect(f.store.read(scope,{id:"out_"+"b".repeat(32)})).rejects.toThrow("unavailable");
});
test("read-time expiry remains forgotten after the clock moves backwards",async()=>{
  const f=await fixture(),saved=await save(f);f.advance(60_001);
  await expect(f.store.read(scope,{id:saved.id})).rejects.toThrow("unavailable");f.advance(-60_001);
  await expect(f.store.read(scope,{id:saved.id})).rejects.toThrow("unavailable");
});

test("retained output preserves unpaired UTF-16 units while text chunks remain searchable",async()=>{
  const f=await fixture(),text="before\ud800\nafter\udc00",saved=await save(f,undefined,text);
  expect((await f.store.read(scope,{id:saved.id,offset:0})).text).toBe(text);
  expect((await f.store.search(scope,{query:"after"}))[0]?.id).toBe(saved.id);
  await closeAgentDatabaseFile(f.file);
  expect((await f.store.read(scope,{id:saved.id,offset:0})).text).toBe(text);
});
test("a character cap splitting a surrogate pair retains the exact incomplete prefix",async()=>{
  const f=await fixture(),text="x".repeat(toolOutputLimits.maxChars-1)+"😀",saved=await save(f,undefined,text);
  expect(saved.complete).toBe(false);
  expect((await f.store.read(scope,{id:saved.id,offset:toolOutputLimits.maxChars-2})).text).toBe(text.slice(toolOutputLimits.maxChars-2,toolOutputLimits.maxChars));
});

test('new retained copies never replace or prune historical output metadata or SDK history',async()=>{
  const f=await fixture();
  await(await f.database()).withSync(db=>{db.exec("CREATE TABLE tool_outputs(id TEXT PRIMARY KEY, evidence TEXT); CREATE TABLE documents(id INTEGER PRIMARY KEY, evidence TEXT); INSERT INTO tool_outputs VALUES('historical','ORIGINAL_OUTPUT'); INSERT INTO documents VALUES(1,'SDK_HISTORY');");});
  await save(f);await forgetRetainedCopies(f.database);
  await(await f.database()).withSync(db=>{expect(db.query('SELECT evidence FROM tool_outputs WHERE id=?').get('historical')).toEqual({evidence:'ORIGINAL_OUTPUT'});expect(db.query('SELECT evidence FROM documents WHERE id=1').get()).toEqual({evidence:'SDK_HISTORY'});});
});

test('Agent-scoped forgetting preserves other Agents, workspaces, chunks and recall copies',async()=>{
 const f=await fixture();await save(f);
 const other=await save(f,'out_'+'e'.repeat(32),'FOREIGN NEEDLE',{owner:'other',conversation:7,after:10});
 await(await f.database()).withSync(db=>{db.exec("CREATE TABLE mcp_recall(id TEXT PRIMARY KEY,owner TEXT NOT NULL,raw TEXT NOT NULL)");db.run('INSERT INTO mcp_recall VALUES(?,?,?),(?,?,?)',['mine','agent','OWN COPY','foreign','other','FOREIGN COPY']);});
 await forgetRetainedCopies(f.database,'agent');
 expect(await f.store.search(scope,{query:'NEEDLE'})).toEqual([]);
 expect((await f.store.read({...scope,owner:'other'},{id:other.id})).text).toBe('FOREIGN NEEDLE');
 expect(await f.store.search({...scope,owner:'other'},{query:'FOREIGN'})).toHaveLength(1);
 await(await f.database()).withSync(db=>expect(db.query('SELECT id,owner,raw FROM mcp_recall').all()).toEqual([{id:'foreign',owner:'other',raw:'FOREIGN COPY'}]));
});
