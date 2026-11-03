import * as admission from "../../../src/db/sqlite-async-admission.js";
import '../../helpers.js';
import { expect, spyOn, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { withTempWorkspaceEnv } from '../../helpers.js';
import { getRuntimeConfigPaths } from '../../../src/core/config.js';
import * as db from '../../../src/db.js';
import * as keychain from '../../../src/secure/keychain.js';
import { WebChannel } from '../../../src/channels/web.js';
import { createWebAgentControlPlaneService } from '../../../src/channels/web/agent/agent-control-plane-service.js';
import { isProviderReadyOobeCompletedForInstance } from '../../../src/channels/web/oobe-instance-state.js';
import { listScheduledTasks } from '../../../src/scheduled-task-query-service.js';

const request = (path: string, body?: unknown, method = 'POST', signal?: AbortSignal) => new Request('http://fixture' + path, {
  method, signal, headers: { 'Content-Type': 'application/json', Origin: 'http://fixture' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
function fixture(path?: string) {
  db.closeDatabase(); db.initDatabase({ ...getRuntimeConfigPaths(), ...(path ? { databasePath: path } : {}) });
  keychain.setKeyMaterialProviderForTests({ getKeyMaterial: () => new TextEncoder().encode('owned-synthetic-key-material-only') });
  const channel = new WebChannel({ queue: { enqueue() {} }, agentPool: {} } as any);
  return { root: db.getDb(), channel };
}
const seed = () => db.storeMessage({ id: 'preserve-post-identity', chat_jid: 'web:default', sender: 'user', sender_name: 'User', content: 'owned fixture', timestamp: '2026-01-01', is_from_me: false, is_bot_message: false });
for (const action of ['keychain-set', 'keychain-delete', 'keychain-notes', 'post-delete', 'oobe'] as const) test(`remaining live ${action} yields to WAL before changing SQL`, () =>
  withTempWorkspaceEnv('remaining-root-wal-', {}, async ws => {
    const path = join(ws.store, 'root.sqlite'), f = fixture(path), row = seed();
    if (action.startsWith('keychain')) await keychain.setKeychainEntry({ name: 'fixture-only', type: 'secret', secret: 'synthetic-only' });
    const blocker = new Database(path), before = f.root.serialize(); blocker.exec('BEGIN IMMEDIATE'); let settled = false;
    const start = performance.now();
    let pending: Promise<Response>;
    if (action === 'post-delete') pending = Promise.resolve().then(() => f.channel.handleDeletePost(request('/post/' + row, undefined, 'DELETE'), row, false));
    else if (action === 'oobe') {
      const service = createWebAgentControlPlaneService(f.channel as any, { defaultChatJid: 'web:default', defaultAgentId: 'default' });
      pending = service.handleAgentOobeComplete(request('/agent/oobe-complete', { kind: 'provider-ready' }));
    } else pending = f.channel.handleRequest(request(action === 'keychain-notes' ? '/agent/keychain/notes' : '/agent/keychain',
      { name: 'fixture-only', type: 'secret', secret: 'updated-synthetic-only', userNote: 'fixture note' }, action === 'keychain-delete' ? 'DELETE' : 'POST'));
    const observed = pending.then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
    try {
      await Bun.sleep(35); expect(performance.now() - start).toBeLessThan(500); expect(settled).toBe(false); expect(f.root.serialize()).toEqual(before);
      blocker.exec('ROLLBACK'); const result = await observed; expect('error' in result).toBe(false); if ('value' in result) expect(result.value.status).toBe(200);
    } finally { if (blocker.inTransaction) blocker.exec('ROLLBACK'); await observed; blocker.close(); await db.closeDatabase(); keychain.setKeyMaterialProviderForTests(null); }
  }), 12_000);

test('OOBE automatic completion is sticky even after the last history message is removed', () =>
  withTempWorkspaceEnv('oobe-reader-', {}, async () => {
    const f = fixture(); seed();
    try { expect(await isProviderReadyOobeCompletedForInstance()).toBe(true); f.root.exec("DELETE FROM messages"); expect(await isProviderReadyOobeCompletedForInstance()).toBe(true); }
    finally { await db.closeDatabase(); keychain.setKeyMaterialProviderForTests(null); }
  }));

test('scheduled task snapshot reads do not reserve the writer under WAL', () =>
  withTempWorkspaceEnv('scheduled-reader-wal-', {}, async ws => {
    const path = join(ws.store, 'root.sqlite'), f = fixture(path), blocker = new Database(path);
    db.createTask({ id: 'readonly-snapshot', chat_jid: 'web:default', prompt: 'fixture only', model: null, task_kind: 'agent', command: null, cwd: null, timeout_sec: null, schedule_type: 'once', schedule_value: '2099-01-01T00:00:00.000Z', next_run: '2099-01-01T00:00:00.000Z', status: 'active', created_at: '2026-01-01T00:00:00.000Z' });
    blocker.exec('BEGIN IMMEDIATE'); const start = performance.now();
    try { expect(listScheduledTasks().tasks.map(task => task.id)).toEqual(['readonly-snapshot']); expect(performance.now() - start).toBeLessThan(500); }
    finally { blocker.exec('ROLLBACK'); blocker.close(); await db.closeDatabase(); keychain.setKeyMaterialProviderForTests(null); }
  }), 12_000);

for (const action of ['set','delete','notes'] as const) test(`keychain ${action} cannot adopt a database selected during JSON parsing`, () =>
  withTempWorkspaceEnv('keychain-json-authority-', {}, async () => {
    const f=fixture(),req=request(action==='notes'?'/agent/keychain/notes':'/agent/keychain',{name:'fixture-only',type:'secret',secret:'synthetic',userNote:'note'},action==='delete'?'DELETE':'POST'),json=req.json.bind(req);
    req.json=async()=>{await db.closeDatabase();fixture();return json();};
    try{expect((await f.channel.handleRequest(req)).status).toBe(400);expect(keychain.listKeychainEntries()).toEqual([]);}
    finally{await db.closeDatabase();keychain.setKeyMaterialProviderForTests(null);}
  }));

test('keychain captures its plaintext input and database before asynchronous encryption',()=>
  withTempWorkspaceEnv('keychain-crypto-binding-',{},async()=>{
    fixture();const input={name:'original-fixture',type:'secret' as const,secret:'original-synthetic'};
    try{
      const pending=keychain.setKeychainEntry(input);input.name='replacement-fixture';input.secret='replacement-synthetic';await pending;
      expect((await keychain.getKeychainEntry('original-fixture')).secret).toBe('original-synthetic');expect(keychain.listKeychainEntries().map(row=>row.name)).toEqual(['original-fixture']);
      keychain.setKeyMaterialProviderForTests({getKeyMaterial(){fixture();return new TextEncoder().encode('owned-synthetic-key-material-only');}});
      await expect(keychain.setKeychainEntry({name:'must-not-adopt',type:'secret',secret:'synthetic'})).rejects.toThrow('database binding changed');
      expect(keychain.listKeychainEntries()).toEqual([]);
    }finally{await db.closeDatabase();keychain.setKeyMaterialProviderForTests(null);}
  }));

for(const action of ['keychain-set','keychain-delete','keychain-notes','post-delete','oobe'] as const)test(`cancelled ${action} retains the held writer and commits no SQL`,()=>
  withTempWorkspaceEnv('remaining-root-cancel-',{},async ws=>{
    const path=join(ws.store,'cancel.sqlite'),f=fixture(path),row=seed(),abort=new AbortController();await keychain.setKeychainEntry({name:'fixture-only',type:'secret',secret:'synthetic-only'});
    const before=f.root.serialize(),blocker=new Database(path);blocker.exec('BEGIN IMMEDIATE');
    let pending:Promise<unknown>;
    if(action==='post-delete')pending=f.channel.handleDeletePost(request('/post/'+row,undefined,'DELETE',abort.signal),row,false);
    else if(action==='oobe')pending=createWebAgentControlPlaneService(f.channel as any,{defaultChatJid:'web:default',defaultAgentId:'default'}).handleAgentOobeComplete(request('/agent/oobe-complete',{kind:'provider-ready'},'POST',abort.signal));
    else pending=f.channel.handleRequest(request(action==='keychain-notes'?'/agent/keychain/notes':'/agent/keychain',{name:'fixture-only',type:'secret',secret:'synthetic-updated',userNote:'changed'},action==='keychain-delete'?'DELETE':'POST',abort.signal));
    const observed=pending.then(value=>value,error=>error);
    try{await Bun.sleep(35);const start=performance.now();abort.abort(Error('fixture request cancelled'));const result=await observed;expect(result instanceof Error||(result as Response).status>=400).toBe(true);expect(performance.now()-start).toBeLessThan(500);expect(blocker.inTransaction).toBe(true);expect(f.root.serialize()).toEqual(before);}
    finally{if(blocker.inTransaction)blocker.exec('ROLLBACK');await observed;blocker.close();await db.closeDatabase();keychain.setKeyMaterialProviderForTests(null);}
  }));

for(const changed of ['gateway','database'] as const)test(`OOBE completion revalidates pre-JSON ${changed} authority`,()=>
  withTempWorkspaceEnv('oobe-authority-',{},async()=>{
    const f=fixture(),service=createWebAgentControlPlaneService(f.channel as any,{defaultChatJid:'web:default',defaultAgentId:'default'}),req=request('/agent/oobe-complete',{kind:'provider-ready'}),json=req.json.bind(req);
    req.json=async()=>{if(changed==='gateway')f.channel.authGateway={} as any;else{await db.closeDatabase();fixture();}return json();};
    try{await expect(service.handleAgentOobeComplete(req)).rejects.toThrow('changed');expect(db.getRouterState('web:oobe:provider-ready:completed')).toBeUndefined();}
    finally{await db.closeDatabase();keychain.setKeyMaterialProviderForTests(null);}
  }));

test('post DELETE is scope-fenced, atomic across cascade/media, and acknowledges committed deletion despite observer failure',()=>
  withTempWorkspaceEnv('delete-atomic-publication-',{},async()=>{
    const f=fixture(),root=seed();const reply=db.storeMessage({id:'reply-fixture',chat_jid:'web:default',sender:'user',sender_name:'User',content:'reply',thread_id:root,timestamp:'2026-01-02',is_from_me:false,is_bot_message:false});
    const media=db.createMedia('fixture.txt','text/plain',new TextEncoder().encode('fixture-media'));db.attachMediaToMessage(root,[media]);db.attachMediaToMessage(reply,[media]);
    try{
      const before=f.root.serialize();const wrong=await f.channel.handleDeletePost(request('/post/'+root+'?chat_jid=web:foreign',undefined,'DELETE'),root,false);expect(wrong.status).toBe(200);expect(await wrong.json()).toEqual({deleted:0,ids:[]});expect(f.root.serialize()).toEqual(before);
      f.root.exec(`CREATE TRIGGER reject_reply_delete BEFORE DELETE ON messages WHEN old.rowid=${reply} BEGIN SELECT RAISE(ABORT,'cascade denied'); END`);
      await expect(f.channel.handleDeletePost(request('/post/'+root+'?cascade=1',undefined,'DELETE'),root,true)).rejects.toThrow('cascade denied');
      expect(db.getMessageByRowId('web:default',root)).not.toBeNull();expect(db.getMediaIdsForMessage(root)).toEqual([media]);expect(db.getMediaIdsForMessage(reply)).toEqual([media]);
      f.root.exec('DROP TRIGGER reject_reply_delete');f.channel.broadcastEvent=()=>{throw Error('optional SSE failed');};
      const diagnostics=spyOn(process.stderr,'write').mockImplementation(()=>{throw Error('optional logger failed')});let response:Response;try{response=await f.channel.handleDeletePost(request('/post/'+root+'?cascade=1',undefined,'DELETE'),root,true);}finally{diagnostics.mockRestore();}expect(response.status).toBe(200);expect(await response.json()).toEqual({deleted:2,ids:[root,reply]});expect(db.getMessageByRowId('web:default',root)).toBeUndefined();expect(db.getMediaInfoById(media)).toBeUndefined();
    }finally{await db.closeDatabase();keychain.setKeyMaterialProviderForTests(null);}
  }));

test('post DELETE refuses a new UUID at the selected row while waiting for WAL',()=>
  withTempWorkspaceEnv('delete-source-identity-',{},async ws=>{
    const path=join(ws.store,'delete.sqlite'),f=fixture(path),row=seed(),blocker=new Database(path);blocker.exec('BEGIN IMMEDIATE');
    const pending=f.channel.handleDeletePost(request('/post/'+row,undefined,'DELETE'),row,false).then(value=>value,error=>error);
    try{await Bun.sleep(30);blocker.query("UPDATE messages SET id='replacement-identity' WHERE rowid=?").run(row);blocker.exec('COMMIT');expect(await pending).toBeInstanceOf(Error);expect(f.root.query('SELECT id FROM messages WHERE rowid=?').get(row)).toEqual({id:'replacement-identity'});}
    finally{if(blocker.inTransaction)blocker.exec('ROLLBACK');await pending;blocker.close();await db.closeDatabase();keychain.setKeyMaterialProviderForTests(null);}
  }));

for(const action of ['keychain-set','keychain-delete','keychain-notes','post-delete','oobe'] as const)test(`known committed ${action} receipt survives late request cancellation without replay`,()=>
  withTempWorkspaceEnv('remaining-known-commit-',{},async()=>{
    const f=fixture(),row=seed(),abort=new AbortController();await keychain.setKeychainEntry({name:'fixture-only',type:'secret',secret:'synthetic-only'});
    const invoke=admission.admitSqliteWrite;let commits=0;const fault=spyOn(admission,'admitSqliteWrite').mockImplementation((async(...args:Parameters<typeof invoke>)=>{const value=await invoke(...args);commits++;abort.abort(Error('after known commit'));return value;}) as any);
    try{
      let response:Response;
      if(action==='post-delete')response=await f.channel.handleDeletePost(request('/post/'+row,undefined,'DELETE',abort.signal),row,false);
      else if(action==='oobe')response=await createWebAgentControlPlaneService(f.channel as any,{defaultChatJid:'web:default',defaultAgentId:'default'}).handleAgentOobeComplete(request('/agent/oobe-complete',{kind:'provider-ready'},'POST',abort.signal));
      else response=await f.channel.handleRequest(request(action==='keychain-notes'?'/agent/keychain/notes':'/agent/keychain',{name:'fixture-only',type:'secret',secret:'synthetic-updated',userNote:'committed note'},action==='keychain-delete'?'DELETE':'POST',abort.signal));
      expect(response.status).toBe(200);expect(commits).toBe(1);expect(abort.signal.aborted).toBe(true);
      if(action==='post-delete')expect(db.getMessageByRowId('web:default',row)).toBeUndefined();
      else if(action==='oobe')expect(db.getRouterState('web:oobe:provider-ready:completed')).toBe('true');
      else if(action==='keychain-delete')expect(keychain.listKeychainEntries()).toEqual([]);
      else if(action==='keychain-notes')expect(keychain.listKeychainEntriesForUi()[0]?.userNote).toBe('committed note');
      else expect((await keychain.getKeychainEntry('fixture-only')).secret).toBe('synthetic-updated');
    }finally{fault.mockRestore();await db.closeDatabase();keychain.setKeyMaterialProviderForTests(null);}
  }));
