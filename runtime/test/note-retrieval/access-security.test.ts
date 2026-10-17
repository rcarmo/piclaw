import {test,expect} from 'bun:test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {withTempWorkspaceEnv} from '../helpers.js';
import {admitNoteIndexMetadata} from '../../src/note-retrieval/access.js';

test('each metadata validation rereads access config and revocation stays latched after restore',async()=>{
 await withTempWorkspaceEnv('note-access-revoke-',{},async({workspace})=>{
  const file=join(workspace,'.piclaw/config.json');mkdirSync(join(workspace,'.piclaw'),{recursive:true});
  const save=(mode:string)=>writeFileSync(file,JSON.stringify({domains:{access:{mode}}}));
  save('single-user');const validate=admitNoteIndexMetadata();validate();
  await Bun.sleep(0);save('family-shared');expect(()=>validate()).toThrow('Note index access denied');
  save('single-user');expect(()=>validate()).toThrow('Note index access denied');
  expect(()=>admitNoteIndexMetadata()()).not.toThrow();
 });
});

test('forked writer validation rereads root filesystem identity after await and latches revocation',async()=>{
 await withTempWorkspaceEnv('note-access-root-',{},async({workspace,store,data})=>{
  // Capture and validate in the child to avoid opening a test-global database.
  const script=`const fs=await import('node:fs');const {initDatabase}=await import('./src/db/connection.ts');const {admitNoteIndexStore}=await import('./src/note-retrieval/access.ts');initDatabase();const {validate}=admitNoteIndexStore();validate();await Bun.sleep(0);const root=process.env.PICLAW_DATA;fs.renameSync(root,root+'-old');fs.mkdirSync(root);let denied=false,latched=false;try{validate()}catch{denied=true}fs.rmdirSync(root);fs.renameSync(root+'-old',root);try{validate()}catch{latched=true}if(!denied||!latched)throw Error('root replacement did not revoke');`;
  const child=Bun.spawn([process.execPath,'-e',script],{cwd:join(import.meta.dir,'../..'),env:{...process.env,PICLAW_WORKSPACE:workspace,PICLAW_STORE:store,PICLAW_DATA:data,PICLAW_DB_IN_MEMORY:'0'},stdout:'ignore',stderr:'pipe'});
  const [errors,code]=await Promise.all([new Response(child.stderr).text(),child.exited]);expect(code,errors).toBe(0);
 });
});
