import '../setup-filesystem-isolation.js';
import assert from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import { initDatabase,getDb,closeDatabase } from '../../src/db/connection.js';
import { extensionKvDelete } from '../../src/db/extension-kv.js';
import { admitSqliteWrite } from '../../src/db/sqlite-async-admission.js';
import { getServerUiState,getServerUiThemeConfig,admitServerUiState } from '../../src/channels/web/ui-state.js';
import { captureWebRequestAuthority } from '../../src/channels/web/auth/auth-gateway.js';
import { admitWebSession,getWebSession } from '../../src/db/web-sessions.js';
import { withAddonLocalDispatch,bindAddonLocalDispatchRequest,getAddonLocalDispatchBlock,bindAddonLocalMessage,verifyAddonLocalMessage } from '../../src/addons/local-dispatch.js';

assert.equal(process.env.PICLAW_DB_IN_MEMORY,'0');initDatabase();
const db=getDb(),path=(db.query('PRAGMA database_list').all() as {name:string;file:string}[]).find(row=>row.name==='main')!.file;
const blocker=new Database(path),policy=db.query('PRAGMA busy_timeout').get();let cases=0;
try{
 extensionKvDelete('piclaw-ui','theme','global');
 blocker.exec('BEGIN IMMEDIATE');const before=db.query('SELECT total_changes() n').get();
 getServerUiState();assert.deepEqual(db.query('SELECT total_changes() n').get(),before);blocker.exec('ROLLBACK');cases++;
 const old=getServerUiThemeConfig();blocker.exec('BEGIN IMMEDIATE');let saved=false;
 const saving=admitServerUiState({ui_theme:{theme:'dracula',tint:'#123456'}},()=>{}).then(value=>{saved=true;return value.ui_theme;});
 await Bun.sleep(20);assert(!saved);assert.deepEqual(getServerUiThemeConfig(),old);assert.deepEqual(db.query('PRAGMA busy_timeout').get(),policy);
 blocker.exec('ROLLBACK');assert.equal((await saving).theme,'dracula');cases++;
 let principal:any={kind:'user',userId:'fixture',mode:'single-user',role:'owner',authentication:{method:'totp',loginId:'fixture'}};
 const req=new Request('https://fixture/agent/ui-state',{method:'POST'}),check=captureWebRequestAuthority({isAuthEnabled:()=>true,getPrincipal:()=>principal},req);
 blocker.exec('BEGIN IMMEDIATE');const denied=admitServerUiState({ui_meters:{enabled:true}},check).then(()=>null,error=>error);
 await Bun.sleep(10);principal={...principal,role:'member'};blocker.exec('ROLLBACK');assert.match(String(await denied),/principal changed/);cases++;
 db.query("INSERT INTO web_sessions(token,user_id,auth_method,created_at,expires_at,session_id) VALUES(?,'default','totp',?, ?,NULL)").run('legacy-cookie',new Date().toISOString(),'2099-01-01T00:00:00.000Z');
 blocker.exec('BEGIN IMMEDIATE');assert.equal(getWebSession('legacy-cookie',false),null);let repaired=false;
 const repair=admitWebSession('legacy-cookie').then(value=>{repaired=true;return value;});await Bun.sleep(20);assert(!repaired);
 blocker.exec('ROLLBACK');assert((await repair)?.session_id);assert.equal(db.query('SELECT 1 FROM web_sessions WHERE token=?').get('legacy-cookie'),null);cases++;
 const target={chatJid:'web:fixture',incarnation:'branch'},content='owned local dispatch';let marker:any,forwarded=0;
 blocker.exec('BEGIN IMMEDIATE');const dispatch=withAddonLocalDispatch(target,content,async()=>{
  assert.equal(db.inTransaction,false);forwarded++;const request=new Request('http://internal/message');bindAddonLocalDispatchRequest(request,target.chatJid,content);marker=getAddonLocalDispatchBlock(request,target.chatJid,content);
 });
 await Bun.sleep(20);assert.equal(forwarded,0);blocker.exec('ROLLBACK');await dispatch;assert(marker);cases++;
 const message={id:'message-1',content,content_blocks:[marker]};await admitSqliteWrite(db,()=>bindAddonLocalMessage(target.chatJid,message));
 blocker.exec('BEGIN IMMEDIATE');const changes=db.query('SELECT total_changes() n').get();
 assert.equal((await verifyAddonLocalMessage(target.chatJid,message))?.incarnation,'branch');assert.equal(await verifyAddonLocalMessage(target.chatJid,{...message,id:'message-replay'}),null);
 assert.deepEqual(db.query('SELECT total_changes() n').get(),changes);blocker.exec('ROLLBACK');cases++;
 let legacyMarker:any;await withAddonLocalDispatch(target,content,async()=>{const req=new Request('http://internal/message');bindAddonLocalDispatchRequest(req,target.chatJid,content);legacyMarker=getAddonLocalDispatchBlock(req,target.chatJid,content);});
 const retained={id:'retained-message',content,content_blocks:[legacyMarker]};blocker.exec('BEGIN IMMEDIATE');let bound=false;
 const binding=verifyAddonLocalMessage(target.chatJid,retained).then(value=>{bound=true;return value;});retained.id='mutated-caller';retained.content='mutated caller';
 await Bun.sleep(20);assert(!bound);blocker.exec('ROLLBACK');assert.equal((await binding)?.incarnation,'branch');
 assert.equal((db.query('SELECT message_id FROM addon_local_dispatch_authorities WHERE id=?').get(legacyMarker.dispatch_id) as {message_id:string}).message_id,'retained-message');cases++;
 assert.equal(db.inTransaction,false);assert.deepEqual(db.query('PRAGMA busy_timeout').get(),policy);
 console.log(JSON.stringify({kind:'http-state-write-admission',cases,realWal:true,readsStayReadOnly:true,noWireReplay:true}));
}finally{if(blocker.inTransaction)blocker.exec('ROLLBACK');blocker.close();closeDatabase();}
