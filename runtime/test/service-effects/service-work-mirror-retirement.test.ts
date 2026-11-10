import {expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {readFileSync} from 'node:fs';
import {installServiceWorkSchema} from '../../src/service-effects/current-piclaw/service-work-schema.js';
import {ensureOwnedMigrationLedger} from '../../src/db/migrations.js';
import {join} from 'node:path';
import {createTempWorkspace} from '../helpers.js';
const archive='service_effect_s01_legacy_harness_v1';
const oldSchema=readFileSync(new URL('../fixtures/service-work-harness-v1.sql',import.meta.url),'utf8');
const columns=(db:Database)=>(db.query('PRAGMA main.table_info(service_effect_s01_operations)').all() as {name:string}[]).map(row=>row.name);
const snapshot=(db:Database)=>({schema:db.query('SELECT * FROM sqlite_schema ORDER BY type,name').all(),
  temp:db.query('SELECT * FROM sqlite_temp_schema ORDER BY type,name').all(),
  tables:['chats','sources','operations','operation_sources','intents','queued_inputs','decisions','wake_intents'].map(t=>db.query(`SELECT rowid,* FROM main.service_effect_s01_${t} ORDER BY rowid`).all()),
  receipts:db.query('SELECT * FROM main.piclaw_schema_migrations ORDER BY owner,migration_order').all(),
  history:db.query("SELECT 1 FROM sqlite_schema WHERE name=? AND type='table'").get(archive)?db.query(`SELECT rowid,* FROM ${archive} ORDER BY rowid`).all():[]});
function fixture(body:(db:Database)=>void,historical=true){const db=new Database(':memory:');try{db.exec('PRAGMA foreign_keys=ON');if(historical){ensureOwnedMigrationLedger(db);db.exec(oldSchema);seed(db);}body(db);}finally{db.close();}}
function seed(db:Database){db.transaction(()=>{
  db.exec(`INSERT INTO service_effect_s01_chats(chat_jid) VALUES('chat');
  INSERT INTO service_effect_s01_sources(chat_jid,source_seq,source_id,source_hash,kind,state,payload_ref,target_operation_id,parent_source_seq,accepted_at,disposition_reason,provenance_ref,create_wake_intent)
    VALUES('chat',1,'accepted','${'a'.repeat(64)}','message','claimed','immutable-payload',NULL,NULL,'2026-10-28T00:00:00.000Z',NULL,'provenance',0);
  INSERT INTO service_effect_s01_operations(rowid,operation_id,chat_jid,version,phase,primary_source_seq,harness_session_id,harness_operation_id,harness_lane,harness_state,harness_watch_generation)
    VALUES(81,'operation','chat',3,'executing',1,'session','42','main','running',7);
  INSERT INTO service_effect_s01_operation_sources(operation_id,chat_jid,source_seq) VALUES('operation','chat',1);
  UPDATE service_effect_s01_chats SET active_operation_id='operation',next_source_seq=2 WHERE chat_jid='chat';
  INSERT INTO service_effect_s01_decisions VALUES('old-bind','bindHarness','${'b'.repeat(64)}','{"history":"preserve exact old request/decision bytes"}');`);
})();}

test('fresh S01 schema has immutable binding and host phases, never lane/state/watch mirrors or an archive',()=>fixture(db=>{
  installServiceWorkSchema(db);
  for(const name of ['harness_lane','harness_state','harness_watch_generation'])expect(columns(db)).not.toContain(name);
  expect(columns(db)).toContain('harness_session_id');expect(columns(db)).toContain('harness_operation_id');
  expect(db.query('SELECT 1 FROM sqlite_schema WHERE name=?').get(archive)).toBeNull();
  const before=snapshot(db);installServiceWorkSchema(db);expect(snapshot(db)).toEqual(before);
},false));

test('populated owned upgrade preserves every host protocol row, rowid, FK, decision and original receipt',()=>fixture(db=>{
  const before=snapshot(db),old=before.tables[2] as Record<string,unknown>[];
  const foreignBefore=db.query("SELECT s.name,f.* FROM sqlite_schema s,pragma_foreign_key_list(s.name,'main') f WHERE s.type='table' ORDER BY s.name,f.id,f.seq").all();
  installServiceWorkSchema(db);
  for(const name of ['harness_lane','harness_state','harness_watch_generation'])expect(columns(db)).not.toContain(name);
  expect(db.query(`SELECT * FROM ${archive}`).all()).toEqual(old.map(row=>({operation_id:row.operation_id,operation_rowid:row.rowid,harness_lane:row.harness_lane,harness_state:row.harness_state,harness_watch_generation:row.harness_watch_generation})));
  const after=snapshot(db);
  const retained=old.map(({harness_lane,harness_state,harness_watch_generation,...row})=>row);
  expect(after.tables[2]).toEqual(retained);
  for(const index of [0,1,3,4,5,6,7])expect(after.tables[index]).toEqual(before.tables[index]);
  expect(after.receipts.filter((r:any)=>r.migration_order===1)).toEqual(before.receipts);
  expect(db.query("SELECT s.name,f.* FROM sqlite_schema s,pragma_foreign_key_list(s.name,'main') f WHERE s.type='table' ORDER BY s.name,f.id,f.seq").all()).toEqual(foreignBefore);
  expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  const migrated=snapshot(db);installServiceWorkSchema(db);expect(snapshot(db)).toEqual(migrated);
}));

for(const [label,sql]of [
  ['unknown index',"CREATE INDEX unknown_mirror_index ON service_effect_s01_operations(harness_state)"],
  ['unknown view',"CREATE VIEW mirror_view AS SELECT harness_state FROM service_effect_s01_operations"],
  ['unknown trigger',"CREATE TRIGGER mirror_trigger AFTER UPDATE ON service_effect_s01_operations BEGIN SELECT 1; END"],
  ['partial mirror columns',"ALTER TABLE service_effect_s01_operations DROP COLUMN harness_lane"],
  ['uppercase temp shadow',"CREATE TEMP TABLE SERVICE_EFFECT_S01_OPERATIONS(untouched TEXT)"],
  ['unregistered archive',`CREATE TABLE ${archive}(untouched TEXT)`],
  ['inbound obsolete-field FK',"CREATE TABLE foreign_observation(value INTEGER REFERENCES service_effect_s01_operations(harness_watch_generation))"],
  ['uppercase obsolete-field FK',"CREATE TABLE foreign_observation(value INTEGER REFERENCES SERVICE_EFFECT_S01_OPERATIONS(HARNESS_WATCH_GENERATION))"],
]as const)test(`retirement refuses ${label} without mutation`,()=>fixture(db=>{
  db.exec(sql);const before=snapshot(db);expect(()=>installServiceWorkSchema(db)).toThrow();expect(snapshot(db)).toEqual(before);
}));

for(const sql of [
  "DELETE FROM piclaw_schema_migrations WHERE owner='service_effect_s01' AND migration_order=2",
  "UPDATE piclaw_schema_migrations SET checksum='wrong' WHERE owner='service_effect_s01' AND migration_order=2",
  "UPDATE piclaw_schema_migrations SET migration_order=999 WHERE owner='service_effect_s01' AND migration_order=2",
  `DROP TABLE ${archive}`,
  "ALTER TABLE service_effect_s01_operations ADD COLUMN harness_state TEXT",
])test(`retired-root drift refuses unchanged: ${sql}`,()=>fixture(db=>{
  installServiceWorkSchema(db);db.exec(sql);const before=snapshot(db);
  expect(()=>installServiceWorkSchema(db)).toThrow();expect(snapshot(db)).toEqual(before);
}));

test('mixed-case historical target cannot hide an unknown dependent index',()=>fixture(db=>{
  // Recreate the frozen source with SQLite-equivalent uppercase identifiers.
  const upper=new Database(':memory:');try{
    upper.exec('PRAGMA foreign_keys=ON');ensureOwnedMigrationLedger(upper);upper.exec(oldSchema.replaceAll('service_effect_s01_operations','SERVICE_EFFECT_S01_OPERATIONS'));seed(upper);
    upper.exec('CREATE INDEX unknown_core_index ON SERVICE_EFFECT_S01_OPERATIONS(version)');
    const before=snapshot(upper);expect(()=>installServiceWorkSchema(upper)).toThrow();expect(snapshot(upper)).toEqual(before);
  }finally{upper.close();}
}));

test('new unregistered archive index cannot be hidden by an existing retirement receipt',()=>fixture(db=>{
  installServiceWorkSchema(db);db.exec(`CREATE INDEX unknown_archive_index ON ${archive}(harness_state)`);
  const before=snapshot(db);expect(()=>installServiceWorkSchema(db)).toThrow();expect(snapshot(db)).toEqual(before);
}));

test('lost fresh receipt never adopts native state as historical input',()=>fixture(db=>{
  installServiceWorkSchema(db);db.exec("DELETE FROM piclaw_schema_migrations WHERE owner='service_effect_s01' AND migration_order=2");
  const before=snapshot(db);expect(()=>installServiceWorkSchema(db)).toThrow();expect(snapshot(db)).toEqual(before);
},false));

test('caller rollback rolls retirement and receipt back together',()=>fixture(db=>{
  const before=snapshot(db);expect(()=>db.transaction(()=>{installServiceWorkSchema(db);throw Error('caller rollback');})()).toThrow('caller rollback');expect(snapshot(db)).toEqual(before);
}));

test('populated file upgrade survives physical close/reopen without changing host or archived evidence',()=>{
  const ws=createTempWorkspace('s01-mirror-upgrade-'),path=join(ws.store,'owned.sqlite');
  let db=new Database(path);
  try{
    db.exec('PRAGMA foreign_keys=ON');db.transaction(()=>{ensureOwnedMigrationLedger(db);db.exec(oldSchema);seed(db);})();
    const old=snapshot(db);installServiceWorkSchema(db);const migrated=snapshot(db);
    expect(migrated.history).toHaveLength(1);
    expect(migrated.tables[1]).toEqual(old.tables[1]);expect(migrated.tables[6]).toEqual(old.tables[6]);
    db.close();db=new Database(path);db.exec('PRAGMA foreign_keys=ON');installServiceWorkSchema(db);
    expect(snapshot(db)).toEqual(migrated);expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  }finally{db.close();ws.cleanup();}
});

test('full-width historical rowid/watch values are copied without JavaScript number coercion',()=>fixture(db=>{
  db.exec("UPDATE service_effect_s01_operations SET rowid=9223372036854775807,harness_watch_generation=9223372036854775807,harness_lane='歴史',harness_state='suspended'");
  installServiceWorkSchema(db);
  expect(db.query(`SELECT CAST(operation_rowid AS TEXT) AS original_rowid,CAST(harness_watch_generation AS TEXT) AS original_watch,harness_lane,harness_state FROM ${archive}`).get()).toEqual({original_rowid:'9223372036854775807',original_watch:'9223372036854775807',harness_lane:'歴史',harness_state:'suspended'});
  expect(db.query('SELECT CAST(rowid AS TEXT) AS original_rowid,phase FROM service_effect_s01_operations').get()).toEqual({original_rowid:'9223372036854775807',phase:'executing'});
}));

test('retirement and receipt fail atomically without changing old schema or history',()=>fixture(db=>{
  db.exec("CREATE TRIGGER refuse_retirement BEFORE INSERT ON piclaw_schema_migrations WHEN NEW.owner='service_effect_s01' AND NEW.migration_order=2 BEGIN SELECT RAISE(ABORT,'injected receipt failure'); END");
  const before=snapshot(db);
  expect(()=>installServiceWorkSchema(db)).toThrow('injected receipt failure');expect(snapshot(db)).toEqual(before);
  expect(db.query('SELECT 1 FROM sqlite_schema WHERE name=?').get(archive)).toBeNull();
}));
