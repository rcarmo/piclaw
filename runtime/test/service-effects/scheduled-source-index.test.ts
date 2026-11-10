import {Database} from 'bun:sqlite';
import {expect,test} from 'bun:test';
import {installServiceWorkSchema} from '../../src/service-effects/current-piclaw/service-work-schema.js';
const index='service_effect_s01_one_active_operation';
// Exact pre-change predicate; operations/source/membership declarations are unchanged.
const oldIndex=`CREATE UNIQUE INDEX ${index} ON service_effect_s01_operations(chat_jid) WHERE phase <> 'terminal'`;
function fixture(){const db=new Database(':memory:');db.exec('PRAGMA foreign_keys=ON');installServiceWorkSchema(db);return db;}
function add(db:Database,id:string,seq:number){db.transaction(()=>{
  db.query("INSERT OR IGNORE INTO service_effect_s01_chats(chat_jid) VALUES('chat')").run();
  db.query("INSERT INTO service_effect_s01_sources(chat_jid,source_seq,source_id,source_hash,kind,state,payload_ref,accepted_at,provenance_ref,create_wake_intent) VALUES('chat',?,?,?,'scheduled_agent','claimed','payload','2026-01-01T00:00:00.000Z','fixture',0)").run(seq,id,'a'.repeat(64));
  db.query("INSERT INTO service_effect_s01_operations(operation_id,chat_jid,version,phase,primary_source_seq) VALUES(?,'chat',1,'claimed',?)").run(id,seq);
  db.query("INSERT INTO service_effect_s01_operation_sources(chat_jid,operation_id,source_seq) VALUES('chat',?,?)").run(id,seq);
})()}
function snapshot(db:Database){return {schema:db.query('SELECT type,name,sql FROM sqlite_schema ORDER BY name').all(),receipts:db.query('SELECT * FROM piclaw_schema_migrations ORDER BY owner,migration_order').all(),operations:db.query('SELECT rowid,* FROM service_effect_s01_operations ORDER BY operation_id').all(),sources:db.query('SELECT rowid,* FROM service_effect_s01_sources ORDER BY source_seq').all(),members:db.query('SELECT rowid,* FROM service_effect_s01_operation_sources ORDER BY source_seq').all()};}
test('index-only migration preserves original rows, memberships, receipts and the legacy active operation',()=>{
  const db=fixture();try{
    db.exec(`DROP INDEX ${index};${oldIndex};DELETE FROM piclaw_schema_migrations WHERE owner='service_effect_s01' AND migration_order=3`);
    add(db,'legacy-active',1);db.exec("UPDATE service_effect_s01_chats SET active_operation_id='legacy-active',next_source_seq=2");
    const before=snapshot(db);installServiceWorkSchema(db);const after=snapshot(db);
    expect(after.operations).toEqual(before.operations);expect(after.sources).toEqual(before.sources);expect(after.members).toEqual(before.members);
    expect(after.receipts.filter((r:any)=>r.owner!=='service_effect_s01'||r.migration_order!==3)).toEqual(before.receipts);
    expect(db.query("SELECT active_operation_id,next_source_seq FROM service_effect_s01_chats").get()).toEqual({active_operation_id:'legacy-active',next_source_seq:2});
    expect(db.query("SELECT id,migration_order FROM piclaw_schema_migrations WHERE owner='service_effect_s01' AND migration_order=3").get()).toEqual({id:'sdk-scheduled-admission-index-v1',migration_order:3});
    installServiceWorkSchema(db);expect(snapshot(db)).toEqual(after);expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  }finally{db.close();}
});
test('only data-shaped SDK correlation rows bypass the legacy exclusive execution index',()=>{
  const db=fixture();try{
    add(db,'legacy-active',1);add(db,'native-scheduled:one',2);add(db,'native-scheduled:two',3);
    expect(()=>add(db,'legacy-second',4)).toThrow('UNIQUE');expect(()=>add(db,'native-scheduled-lookalike',4)).toThrow('UNIQUE');
    for(const update of ["phase='executing'","harness_session_id='session',harness_operation_id='1'","cancellation_source_id='cancel',cancellation_source_seq=1,cancellation_cause='user',cancellation_requested_at='2026-01-01T00:00:00.000Z'"]){
      expect(()=>db.exec(`UPDATE service_effect_s01_operations SET ${update} WHERE operation_id='native-scheduled:one'`)).toThrow('UNIQUE');
    }
    expect(db.query('SELECT count(*) n FROM service_effect_s01_operations').get()).toEqual({n:3});expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  }finally{db.close();}
});
for(const mode of ['missing-index','wrong-index','missing-receipt','wrong-checksum']as const)test(`index upgrade rejects ${mode} without changing original evidence`,()=>{
  const db=fixture();try{
    add(db,'legacy-active',1);
    if(mode==='missing-index')db.exec(`DROP INDEX ${index}`);
    if(mode==='wrong-index')db.exec(`DROP INDEX ${index};CREATE UNIQUE INDEX ${index} ON service_effect_s01_operations(chat_jid) WHERE phase='executing'`);
    if(mode==='missing-receipt')db.exec("DELETE FROM piclaw_schema_migrations WHERE owner='service_effect_s01' AND migration_order=3");
    if(mode==='wrong-checksum')db.exec("UPDATE piclaw_schema_migrations SET checksum='wrong' WHERE owner='service_effect_s01' AND migration_order=3");
    const before=snapshot(db);expect(()=>installServiceWorkSchema(db)).toThrow();expect(snapshot(db)).toEqual(before);
  }finally{db.close();}
});
