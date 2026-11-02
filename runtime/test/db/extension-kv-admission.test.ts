import { expect,test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { createTempWorkspace } from '../helpers.js';
import { admitSqliteWrite, type SyncSqliteOperation } from '../../src/db/sqlite-async-admission.js';
import { getExtensionKvStore,registerExtensionKvStore,resetExtensionKvStoreForTests,requireExtensionKvAuthority,withExtensionKvAuthority } from '../../src/extension-kv-registry.js';

for(const revoke of [false,true]) test(`KV write admission yields to a real writer and rechecks authority; revoke=${revoke}`,async()=>{
 const workspace=createTempWorkspace('kv-admission-'),path=join(workspace.base,'kv.sqlite');
 const db=new Database(path);db.exec('PRAGMA journal_mode=WAL;PRAGMA busy_timeout=731;CREATE TABLE values_store(id TEXT PRIMARY KEY,value TEXT)');
 const blocker=new Database(path);let current=true,entered=0;
 const check=()=>{if(!current)throw Error('revoked');};
 registerExtensionKvStore({get<T>(_id:string,key:string){const row=db.query('SELECT value FROM values_store WHERE id=?').get(key) as {value:string}|null;return row?JSON.parse(row.value) as T:null;},
  set(_id,key,value){db.query('INSERT OR REPLACE INTO values_store VALUES (?,?)').run(key,JSON.stringify(value));},
  delete(_id,key){return db.query('DELETE FROM values_store WHERE id=?').run(key).changes>0;},list(){return[];},query(){return[];},clear(){return 0;}});
 requireExtensionKvAuthority();const store=getExtensionKvStore();
 const authority={extensionId:'fixture',chatJid:'web:fixture',globalWrite:true,assertCurrent:check,
  admitWrite:<T>(body:SyncSqliteOperation<T>)=>admitSqliteWrite<T>(db,body,check),
  write<T>(body:()=>T){check();if(!db.inTransaction)throw Error('outer writer required');const value=body();check();return value;}};
 try{
  blocker.exec('BEGIN IMMEDIATE');
  const pending=withExtensionKvAuthority(authority,()=>store.write!('fixture',()=>{entered++;store.set('fixture','key',{saved:true},'global');return 7;}));
  await Bun.sleep(20);expect(entered).toBe(0);expect(db.query('PRAGMA busy_timeout').get()).toEqual({timeout:731});
  if(revoke)current=false;blocker.exec('ROLLBACK');
  if(revoke)await expect(pending).rejects.toThrow('revoked');else expect(await pending).toBe(7);
  expect(entered).toBe(revoke?0:1);expect(db.query('SELECT * FROM values_store').all()).toHaveLength(revoke?0:1);
  expect(db.inTransaction).toBe(false);expect(db.query('PRAGMA busy_timeout').get()).toEqual({timeout:731});
 }finally{if(blocker.inTransaction)blocker.exec('ROLLBACK');resetExtensionKvStoreForTests();blocker.close();db.close();workspace.cleanup();}
});

test('KV admission denies missing/wrong authority and rolls back an entered callback without retry',async()=>{
 resetExtensionKvStoreForTests();requireExtensionKvAuthority();const store=getExtensionKvStore();
 const db=new Database(':memory:');db.exec('CREATE TABLE marker(value TEXT)');let entered=0;
 const authority={extensionId:'fixture',chatJid:'web:fixture',assertCurrent(){},write<T>(body:()=>T){return body();},admitWrite:<T>(body:SyncSqliteOperation<T>)=>admitSqliteWrite<T>(db,body)};
 try{
  await expect(store.write!('fixture',()=>{entered++;})).rejects.toThrow('authority required');
  await expect(withExtensionKvAuthority(authority,()=>store.write!('other',()=>{entered++;}))).rejects.toThrow('admission unavailable');
  const failure=Object.assign(Error('entered busy'),{code:'SQLITE_BUSY'});
  await expect(withExtensionKvAuthority(authority,()=>store.write!('fixture',()=>{entered++;db.exec("INSERT INTO marker VALUES('rollback')");throw failure;}))).rejects.toBe(failure);
  expect(entered).toBe(1);expect(db.query('SELECT * FROM marker').all()).toEqual([]);expect(db.inTransaction).toBe(false);
 }finally{resetExtensionKvStoreForTests();db.close();}
});
