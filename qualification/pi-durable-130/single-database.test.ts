import './src/test-guard.js';
import {expect,test,spyOn} from 'bun:test';
import {watch} from 'node:fs';
import {readdir,stat} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {AgentRuntimeFacade} from '../../runtime/src/agent-pool/runtime-facade.js';
import {createDurableConversationAdapter} from '../../runtime/src/agent-pool/durable-runtime-adapter.js';
import {CURRENT_SQLITE_SCHEMA_VERSION} from '../../runtime/durable-engine/qualification/sqlite.js';
import {defineDoc,type Harness} from '../../runtime/durable-engine/qualification/durable.js';
import {nativeMessageFixture} from './src/native-message-fixture.js';
import {TestOwner} from './src/ownership.js';
import {barrier,context} from './src/fixture.js';

// Multiple owned connections to one file. Root correlation is not a second SDK
// transaction/lifecycle, and no JSONL factory or S01/S02 owner is constructed.
test('single physical database: native accepted inputs, passive facade/document state and new-owner reopen',async()=>{
  const f=await nativeMessageFixture(),path=join(f.identity.workspace.store,'messages.db');
  const spies=(['create','open','continueRecent'] as const).map(name=>spyOn(SessionManager,name).mockImplementation(()=>{throw Error('JSONL session factory forbidden');}));
  const fileEvents:string[]=[],watcher=watch(dirname(path),{recursive:true},(_event,name)=>{if(name?.endsWith('.jsonl'))fileEvents.push(name);});
  const facade=()=>{
    const adapter=createDurableConversationAdapter({incarnation:f.domain,manifest:[{chatJid:f.chat,branchId:'main',conversationId:f.base.root.id}],runtime:f.runtime});
    const position=adapter.sessionPosition(f.chat,'main','preserved-session-id');
    return new AgentRuntimeFacade({pool:new Map(),getDurableSession:chat=>chat===f.chat?position:undefined,modelRegistry:{} as ConstructorParameters<typeof AgentRuntimeFacade>[0]['modelRegistry'],modelRuntime:{} as ConstructorParameters<typeof AgentRuntimeFacade>[0]['modelRuntime'],authPath:'unused'});
  };
  const checkConnections=async()=>{
    f.options.owner.assert();
    for(const rows of [f.root.query('PRAGMA database_list').all(),await f.candidateDatabase.all('SELECT * FROM pragma_database_list')])expect((rows as {seq:number;name:string;file:string}[]).filter(row=>row.name!=='temp')).toEqual([{seq:0,name:'main',file:path}]);
    expect(f.root.query('PRAGMA foreign_keys').get()).toEqual({foreign_keys:1});expect(await f.candidateDatabase.get('SELECT * FROM pragma_foreign_keys')).toEqual({foreign_keys:1});
    expect(f.root.query('PRAGMA integrity_check').all()).toEqual([{integrity_check:'ok'}]);expect(await f.candidateDatabase.all('SELECT * FROM pragma_integrity_check')).toEqual([{integrity_check:'ok'}]);
    expect(f.root.query('PRAGMA foreign_key_check').all()).toEqual([]);expect(await f.candidateDatabase.all('SELECT * FROM pragma_foreign_key_check')).toEqual([]);
  };
  try{
    const ledger=f.root.query('SELECT * FROM core_schema_migrations ORDER BY name').all();expect(ledger.length).toBeGreaterThan(0);expect(()=>TestOwner.acquire(path)).toThrow('owner busy');
    await f.open();f.base.host.modelHold=barrier();f.base.host.finalContent=[{type:'text',text:'single database answer'}];
    const primary=f.accept('native primary'),id=await f.runtime.submitMessage(primary),queued=f.accept('native follow-up'),queuedId=await f.runtime.submitMessage(queued,'followUp');
    const app=facade();expect(app.getSessionGenerationForChat(f.chat)).toBe('preserved-session-id');expect(await app.getCurrentModelLabel(f.chat)).toBe('qualification/synthetic');
    expect(app).not.toHaveProperty('restoreSessionPosition');expect('applySlashCommand' in app).toBe(false);
    expect(await f.runtime.submitMessage(primary)).toBe(id);expect(await f.runtime.submitMessage(queued,'followUp')).toBe(queuedId);
    f.base.host.modelHold.release();expect((await f.runtime.waitForMessage(primary,id)).status).toBe('done');expect((await f.runtime.waitForMessage(queued,queuedId)).status).toBe('done');
    const tree=await app.getSessionTreeForChat(f.chat);expect(tree.version).toBe(1);expect(tree.flat).toBe(true);expect(tree.leafId).toBe(await app.saveSessionPosition(f.chat));
    expect(tree.nodes.some(node=>node.role==='assistant'&&node.detail==='single database answer')).toBe(true);expect(tree.nodes.every(node=>typeof node.id==='string')).toBe(true);expect(JSON.stringify(tree)).not.toContain('thinking');
    expect((await app.applyControlCommand(f.chat,{type:'tree',raw:'/tree'})).status).toBe('success');expect((await app.applyControlCommand(f.chat,{type:'tree',targetId:tree.leafId!,raw:'/tree target'})).status).toBe('error');
    const Probe=defineDoc({kind:'qualification.single-database',version:1,scope:'session',checkpointWhen:()=>false,initial:()=>({outcome:''})});
    const harness=Reflect.get(f.runtime,'harness') as Harness;await harness.commit(async tx=>{(await tx.doc(Probe)).outcome='same-file';},context);
    for(const table of ['messages','service_effect_s01_sources','piclaw_durable_bindings_v1','conversations','entries','tasks','submissions','documents','document_revisions'])expect((f.root.query(`SELECT count(*) n FROM ${table}`).get() as {n:number}).n).toBeGreaterThan(0);
    expect(f.root.query('SELECT * FROM service_effect_s01_operations').all()).toEqual([]);expect(f.root.query('SELECT * FROM service_effect_s02_commits').all()).toEqual([]);expect(f.root.query('SELECT * FROM piclaw_durable_intent_bindings_v1').all()).toEqual([]);
    expect(f.root.query('SELECT version FROM durable_schema').get()).toEqual({version:CURRENT_SQLITE_SCHEMA_VERSION});expect(f.root.query('SELECT * FROM core_schema_migrations ORDER BY name').all()).toEqual(ledger);await checkConnections();
    const position=await app.saveSessionPosition(f.chat),sdk=f.sdkSnapshot(),bindings=[await f.bindings.get(primary),await f.bindings.get(queued)],generation=f.owner().generation,calls=f.base.host.modelCalls;
    await f.reopen();expect(f.owner().generation).toBe(generation+1);const reopened=facade();
    expect(await reopened.saveSessionPosition(f.chat)).toBe(position);expect(await reopened.getSessionTreeForChat(f.chat)).toEqual(tree);expect(await reopened.getCurrentModelLabel(f.chat)).toBe('qualification/synthetic');expect(reopened.getSessionGenerationForChat(f.chat)).toBe('preserved-session-id');
    await expect(app.getSessionTreeForChat(f.chat)).rejects.toThrow('Runtime closed');await expect(app.getCurrentModelLabel(f.chat)).rejects.toThrow('Runtime closed');await expect(app.saveSessionPosition(f.chat)).rejects.toThrow('Runtime closed');
    expect(await (Reflect.get(f.runtime,'harness') as Harness).commit(async tx=>(await tx.doc(Probe)).outcome,context)).toBe('same-file');expect([await f.bindings.get(primary),await f.bindings.get(queued)]).toEqual(bindings);
    expect(await f.runtime.submitMessage(primary)).toBe(id);expect(await f.runtime.submitMessage(queued,'followUp')).toBe(queuedId);expect(f.sdkSnapshot()).toEqual(sdk);expect(f.base.host.modelCalls).toBe(calls);expect(f.base.host.effects).toBe(0);
    expect(f.root.query('SELECT * FROM core_schema_migrations ORDER BY name').all()).toEqual(ledger);await checkConnections();
    const files:string[]=[];const scan=async(dir:string)=>{for(const entry of await readdir(dir,{withFileTypes:true})){const next=join(dir,entry.name);if(entry.isDirectory())await scan(next);else files.push(next);}};await scan(f.identity.workspace.base);
    expect(files.filter(file=>![path,path+'-wal',path+'-shm'].includes(file))).toEqual([]);expect((await stat(path)).ino).toBeGreaterThan(0);expect(fileEvents).toEqual([]);for(const spy of spies)expect(spy).not.toHaveBeenCalled();
  }finally{watcher.close();for(const spy of spies)spy.mockRestore();await f.close();}
},20000);
