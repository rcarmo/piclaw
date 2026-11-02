import './src/test-guard.js';
import { test,expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { repoRoot } from './src/repo-root.js';
import { admitSqliteWrite, type SyncSqliteOperation } from '../../runtime/src/db/sqlite-async-admission.js';
import { getExtensionKvStore,requireExtensionKvAuthority,resetExtensionKvStoreForTests,withExtensionKvAuthority } from '../../runtime/src/extension-kv-registry.js';

for(const revoke of [false,true]) test(`native review preparation and UI mutation yield to the shared writer; revoke=${revoke}`,async()=>{
 const dir=await mkdtemp(join(process.env.PICLAW_WORKSPACE!,'review-admission-'));
 const path=join(dir,'root.sqlite'),root=new Database(path);root.exec('PRAGMA journal_mode=WAL;PRAGMA busy_timeout=731');
 const blocker=new Database(path),globals=globalThis as any,previous=globals.__piclawRuntimeInterop;
 const addon=await import(repoRoot('ADDONS')+'/addons/code-review/runtime.ts');
 let current=true;
 const check=()=>{if(!current)throw Error('revoked');};
 const releaseSource=addon.setReviewDatabaseSource({database:root,assertOwner:check,admitWrite:<T>(body:SyncSqliteOperation<T>)=>admitSqliteWrite<T>(root,body,check)});
 try{
  blocker.exec('BEGIN IMMEDIATE');
  const pending=addon.prepareReviewService();
  await Bun.sleep(20);expect(()=>addon.reviewService()).toThrow('Await native review preparation');
  expect(root.query("SELECT name FROM sqlite_schema WHERE name='addon_code_review_schema'").get()).toBeNull();
  blocker.exec('ROLLBACK');const service=await pending;
  expect(addon.reviewService()).toBe(service);expect(root.query('PRAGMA busy_timeout').get()).toEqual({timeout:731});
  requireExtensionKvAuthority();globals.__piclawRuntimeInterop={getExtensionKvStore};
  await writeFile(join(dir,'file.ts'),'export const fixture = 1;\n');
  const target={chatJid:'web:fixture',incarnation:'branch',agentName:'fixture',label:'Fixture',active:false};
  const context={version:1,accessMode:'single-user',kind:'operator',ownerId:'owner',actorId:'operator',workspaceRoot:dir,workspaceId:'fixture-workspace',
   async listTargets(){check();return[target];},async resolveTarget(){check();return target;},async enqueue(){throw Error('No delivery in this fixture');}};
  const authority={extensionId:'code-review',chatJid:'',globalRead:true,globalWrite:true,assertCurrent:check,
   admitWrite:<T>(body:SyncSqliteOperation<T>)=>admitSqliteWrite<T>(root,body,check),write<T>(body:()=>T){if(!root.inTransaction)throw Error('Writer required');check();const result=body();check();return result;}};
  blocker.exec('BEGIN IMMEDIATE');let done=false;
  const mutation=withExtensionKvAuthority(authority,()=>addon.reviewAction(context,'create',{path:'file.ts',title:'Fixture',target:{agentName:'fixture'},requestId:'create-fixture'},service))
   .then((value:unknown)=>{done=true;return{ok:true as const,value};},(error:unknown)=>{done=true;return{ok:false as const,error};});
  await Bun.sleep(60);expect(done).toBe(false);expect(root.query('SELECT count(*) n FROM addon_code_review_reviews').get()).toEqual({n:0});
  if(revoke)current=false;blocker.exec('ROLLBACK');const result=await mutation;
  expect(result.ok).toBe(!revoke);expect(root.query('SELECT count(*) n FROM addon_code_review_reviews').get()).toEqual({n:revoke?0:1});
  expect(root.inTransaction).toBe(false);expect(root.query('PRAGMA busy_timeout').get()).toEqual({timeout:731});
  current=true;addon.closeReviewServices();
  const reopened=await addon.prepareReviewService();expect(reopened).not.toBe(service);
 }finally{if(blocker.inTransaction)blocker.exec('ROLLBACK');current=true;releaseSource();resetExtensionKvStoreForTests();globals.__piclawRuntimeInterop=previous;blocker.close();root.close();await rm(dir,{recursive:true,force:true});}
});
