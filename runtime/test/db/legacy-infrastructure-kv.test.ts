import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { withTempWorkspaceEnv } from '../helpers.js';
import { initDatabase, closeDatabase, getDb } from '../../src/db/connection.js';
import { getRuntimeConfigPaths } from '../../src/core/config.js';
import * as store from '../../src/db.js';

const created='2001-02-03T04:05:06.007Z',updated='2008-09-10T11:12:13.014Z';
const px={base_url:'https://旧.invalid/api2/json?quoted="\n\u0000',api_token_keychain:'synthetic/px',allow_insecure_tls:true};
const pt={base_url:'https://portainer.invalid:9443',api_token_keychain:'synthetic/pt',allow_insecure_tls:false};
const retained=' { "source" : "newer", "escaped" : "\\u0061" } ';
const schema=(db:Database)=>db.query("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all();
const kv=(db:Database)=>db.query('SELECT * FROM extension_kv ORDER BY extension_id,scope,scope_key,key').all();
afterEach(async()=>{await closeDatabase();});
async function fixture(prefix:string,run:(path:string,legacy:unknown[])=>Promise<void>,fail=false){
  await withTempWorkspaceEnv('legacy-infrastructure-kv-',{},async ws=>{
    await closeDatabase(); const path=join(ws.store,'legacy.sqlite'),seed=new Database(path);
    try{
      seed.exec(`CREATE TABLE chats(jid TEXT PRIMARY KEY,name TEXT,last_message_time TEXT);
        INSERT INTO chats(jid) VALUES('web:px'),('web:pt'),('web:existing');
        CREATE TABLE extension_kv(extension_id TEXT NOT NULL,scope TEXT NOT NULL DEFAULT 'chat',scope_key TEXT NOT NULL DEFAULT '',key TEXT NOT NULL,value TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT(datetime('now')),updated_at TEXT NOT NULL DEFAULT(datetime('now')),PRIMARY KEY(extension_id,scope,scope_key,key));`);
      for(const id of ['proxmox','portainer'])seed.exec(`CREATE TABLE ${prefix}${id}_configs(chat_jid TEXT PRIMARY KEY,base_url TEXT NOT NULL,api_token_keychain TEXT NOT NULL,allow_insecure_tls INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(chat_jid) REFERENCES chats(jid));`);
      const add=(id:string,chat:string,value:typeof px,tls:number)=>seed.query(`INSERT INTO ${prefix}${id}_configs VALUES(?,?,?,?,?,?)`).run(chat,value.base_url,value.api_token_keychain,tls,created,updated);
      add('proxmox','web:px',px,1);add('portainer','web:pt',pt,2);add('proxmox','web:existing',px,1);
      seed.query('INSERT INTO extension_kv VALUES(?,?,?,?,?,?,?)').run('proxmox','chat','web:existing','config',retained,'keep-created','keep-updated');
      if(fail)seed.exec("CREATE TRIGGER reject_legacy_portainer BEFORE INSERT ON extension_kv WHEN NEW.extension_id='portainer' BEGIN SELECT RAISE(ABORT,'copy rejected'); END");
      const legacy=['proxmox','portainer'].map(id=>seed.query(`SELECT * FROM ${prefix}${id}_configs ORDER BY chat_jid`).all());
      seed.close(); await run(path,legacy);
    }finally{seed.close();await closeDatabase();}
  });
}
for(const prefix of ['', 'chat_'])test(`Root bootstrap preserves legacy profile bytes, timestamps and existing overrides: ${prefix||'canonical'}`,()=>fixture(prefix,async(path,legacy)=>{
  const paths={...getRuntimeConfigPaths(),databasePath:path};initDatabase(paths);
  const root=getDb();
  expect(kv(root)).toEqual([
    {extension_id:'portainer',scope:'chat',scope_key:'web:pt',key:'config',value:JSON.stringify(pt),created_at:created,updated_at:updated},
    {extension_id:'proxmox',scope:'chat',scope_key:'web:existing',key:'config',value:retained,created_at:'keep-created',updated_at:'keep-updated'},
    {extension_id:'proxmox',scope:'chat',scope_key:'web:px',key:'config',value:JSON.stringify(px),created_at:created,updated_at:updated},
  ]);
  expect(['proxmox','portainer'].map(id=>root.query(`SELECT * FROM ${id}_configs ORDER BY chat_jid`).all())).toEqual(legacy);
  const before=kv(root);await closeDatabase();initDatabase(paths);expect(kv(getDb())).toEqual(before);
}));
test('legacy profile copy failure rolls back the existing Root schema batch without partial KV or renamed tables',()=>fixture('chat_',async(path)=>{
  const paths={...getRuntimeConfigPaths(),databasePath:path},inspect=new Database(path,{readonly:true});
  const before={schema:schema(inspect),kv:kv(inspect),px:inspect.query('SELECT * FROM chat_proxmox_configs ORDER BY chat_jid').all(),pt:inspect.query('SELECT * FROM chat_portainer_configs ORDER BY chat_jid').all()};inspect.close();
  expect(()=>initDatabase(paths)).toThrow('copy rejected');expect(()=>getDb()).toThrow('not initialized');
  const after=new Database(path,{readonly:true});try{expect({schema:schema(after),kv:kv(after),px:after.query('SELECT * FROM chat_proxmox_configs ORDER BY chat_jid').all(),pt:after.query('SELECT * FROM chat_portainer_configs ORDER BY chat_jid').all()}).toEqual(before);}finally{after.close();}
},true));
test('Pool-time raw migration export is retired',()=>{expect(store).not.toHaveProperty('migrateProxmoxPortainerToKv');});
