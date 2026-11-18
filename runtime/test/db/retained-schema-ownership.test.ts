import {expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {initDatabase,getDb,closeDatabase} from '../../src/db/connection.js';
import {Harness,MemoryStorage,createRegistry} from '../../durable-engine/qualification/durable.ts';
import {BACKGROUND_CONTEXT as context} from '../../durable-engine/qualification/context.ts';
import {createModels} from '../../durable-engine/node_modules/@earendil-works/pi-ai';
import {applicationRetainedDatabase} from '../../durable-engine/src/mcp/retained-database.ts';
import {createToolOutputStore} from '../../durable-engine/src/mcp/tool-output-store.ts';
import {createMcpRecallStore} from '../../durable-engine/src/mcp/recall-store.ts';
import {McpConnectionStore} from '../../durable-engine/src/mcp/connections.ts';
import {readSchemaInventory,assertSchemaInventory,type SchemaContract} from '../../scripts/lib/schema-ownership.ts';
const contract=JSON.parse(readFileSync(join(import.meta.dir,'../../scripts/schema-ownership.json'),'utf8')) as SchemaContract;
test('retained schemas have exact metadata/cache owners and preserve strict missing/drift/foreign negatives',async()=>{
 process.env.PICLAW_DB_IN_MEMORY='1';initDatabase();const database=getDb(),harness=await Harness.open(new MemoryStorage(),{registry:createRegistry(),models:createModels()},context);
 try{
  const receipts=database.query('SELECT * FROM piclaw_schema_migrations ORDER BY owner,migration_order').all(),borrowed=applicationRetainedDatabase(database,()=>{}),connections=new McpConnectionStore(database,()=>{});
  await createToolOutputStore(borrowed).prune();const root=await harness.root(context);await createMcpRecallStore('schema_fixture',()=>harness,connections,async()=>({owner:'schema_fixture',agentId:'default'}),borrowed).list(root.id,context);
  const before=database.query('SELECT * FROM sqlite_schema ORDER BY type,name').all(),inventory=assertSchemaInventory(readSchemaInventory(database),contract,'core');
  expect(inventory.objects.find(row=>row.name==='mcp_connections_v1')?.owner).toBe('core:outbound-mcp');
  for(const name of ['retained_tool_outputs','retained_tool_output_search','mcp_recall','mcp_recall_search'])expect(inventory.objects.find(row=>row.name===name)?.category).toBe('projection-cache');
  expect(database.query('SELECT * FROM sqlite_schema ORDER BY type,name').all()).toEqual(before);expect(database.query('SELECT * FROM piclaw_schema_migrations ORDER BY owner,migration_order').all()).toEqual(receipts);
  for(const [sql,reason]of [
   ['DROP INDEX retained_tool_outputs_expiry','Missing required object index:retained_tool_outputs_expiry'],
   ['DROP TRIGGER mcp_recall_insert','Missing required object trigger:mcp_recall_insert'],
   ['ALTER TABLE retained_tool_outputs ADD unreviewed TEXT','Unapproved schema drift table:retained_tool_outputs'],
   ['CREATE TABLE retained_tool_outputs_unowned(id INTEGER)','Unowned object table:retained_tool_outputs_unowned'],
  ]){database.exec('SAVEPOINT retained_schema_negative');try{database.exec(sql);expect(()=>assertSchemaInventory(readSchemaInventory(database),contract,'core')).toThrow(reason);}finally{database.exec('ROLLBACK TO retained_schema_negative; RELEASE retained_schema_negative');}}
  expect(database.query('SELECT * FROM sqlite_schema ORDER BY type,name').all()).toEqual(before);
 }finally{await harness.close(context);await closeDatabase();}
});
