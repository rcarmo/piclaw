import {afterEach,expect,test} from 'bun:test';
import {createTempWorkspace,setEnv} from '../../../helpers.js';
import {initDatabase,getDb,closeDatabase} from '../../../../src/db/connection.js';
import {admitWebMessage} from '../../../../src/channels/web/messaging/message-store.js';
import {captureInputTarget} from '../../../../src/channels/web/messaging/input-request-authority.js';
import {ensureChatBranch,getChatBranchByChatJid} from '../../../../src/db/chat-branches.js';
let cleanup=()=>{};afterEach(()=>{closeDatabase();cleanup();});
function fixture(){const ws=createTempWorkspace('input-target-proof-');const restore=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data});cleanup=()=>{restore();ws.cleanup();};initDatabase();return getDb();}
const params={chatJid:'web:new-proof',content:'new chat payload',isBot:false,mediaIds:[],agentId:'default',agentName:'Fixture'};
const channel={broadcastEvent(){}};
test('private absent-target proof creates its chat only in the committing transaction',async()=>{
 fixture();const validate=captureInputTarget(params.chatJid);validate();expect(getChatBranchByChatJid(params.chatJid)).toBeNull();
 const row=await admitWebMessage(channel,params,{},validate,new AbortController().signal);expect(row!.id).toBeGreaterThan(0);expect(getChatBranchByChatJid(params.chatJid)?.branch_id).toBeTruthy();expect((getDb().query('SELECT count(*) n FROM messages').get() as any).n).toBe(1);
});
test('failed admission rolls back introduced target lifetime and spill/message state',async()=>{
 fixture();const validate=captureInputTarget(params.chatJid);
 await expect(admitWebMessage(channel,{...params,content:'spill '.repeat(20000)}, {}, phase=>{validate(phase);if(phase==='after')throw Error('revoked at commit');},new AbortController().signal)).rejects.toThrow('revoked at commit');
 expect(getChatBranchByChatJid(params.chatJid)).toBeNull();for(const table of ['messages','media','chats'])expect((getDb().query(`SELECT count(*) n FROM ${table}`).get() as any).n).toBe(0);
});
test('callback BUSY is terminal and rolls back its introduced lifetime, never adopts an external lifetime',async()=>{
 const db=fixture(),prepare=db.prepare.bind(db);const validate=captureInputTarget(params.chatJid);let attempts=0;
 const failure=Object.assign(Error('busy'),{code:'SQLITE_BUSY'});
 db.prepare=((sql:string)=>{const statement=prepare(sql);if(!sql.includes('INSERT INTO messages'))return statement;return new Proxy(statement,{get(target,key){if(key==='run')return(...args:any[])=>{if(++attempts===1)throw failure;return target.run(...args);};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});}) as typeof db.prepare;
 try{await expect(admitWebMessage(channel,params,{},validate,new AbortController().signal)).rejects.toBe(failure);}finally{db.prepare=prepare;}
 expect(attempts).toBe(1);expect(getChatBranchByChatJid(params.chatJid)).toBeNull();
 for(const table of ['messages','media','chats'])expect((db.query(`SELECT count(*) n FROM ${table}`).get() as any).n).toBe(0);
 const externalParams={...params,chatJid:'web:externally-created'};const external=captureInputTarget(externalParams.chatJid);ensureChatBranch({chat_jid:externalParams.chatJid,agent_name:'external'});
 await expect(admitWebMessage(channel,externalParams,{},external,new AbortController().signal)).rejects.toThrow('lifetime changed');expect((db.query('SELECT count(*) n FROM messages WHERE chat_jid=?').get(externalParams.chatJid) as any).n).toBe(0);
});
test('cancellation before admission cannot create a new target branch',async()=>{
 fixture();const validate=captureInputTarget(params.chatJid);const abort=new AbortController();abort.abort(Error('stopped'));
 await expect(admitWebMessage(channel,params,{},validate,abort.signal)).rejects.toThrow('stopped');expect(getChatBranchByChatJid(params.chatJid)).toBeNull();
});
test('cancellation after mutation rolls back the new branch, message and spill',async()=>{
 fixture();const validate=captureInputTarget(params.chatJid),abort=new AbortController();
 await expect(admitWebMessage(channel,{...params,content:'spill '.repeat(20000)},{},phase=>{validate(phase);if(phase==='after')abort.abort(Error('stopped before commit'));},abort.signal)).rejects.toThrow('stopped before commit');
 expect(getChatBranchByChatJid(params.chatJid)).toBeNull();for(const table of ['messages','media','chats'])expect((getDb().query(`SELECT count(*) n FROM ${table}`).get() as any).n).toBe(0);
});
test('an external target created during acquisition backoff cannot be adopted by the admitted callback',async()=>{
 const db=fixture(),transaction=db.transaction.bind(db),validate=captureInputTarget(params.chatJid);let failAcquisition=true,checks=0;
 db.transaction=((operation:()=>unknown)=>{const run=transaction(operation);return Object.assign(()=>run(),{
  immediate(){if(failAcquisition){failAcquisition=false;throw Object.assign(Error('writer acquisition busy'),{code:'SQLITE_BUSY'});}return run.immediate();},
  deferred:()=>run.deferred(),exclusive:()=>run.exclusive(),
 });}) as typeof db.transaction;
 try {
  const pending=admitWebMessage(channel,params,{},phase=>{checks++;validate(phase);},new AbortController().signal);
  const observed=pending.then(()=>null,error=>error);await Bun.sleep(0);
  expect(checks).toBe(0);expect(getChatBranchByChatJid(params.chatJid)).toBeNull();
  const external=ensureChatBranch({chat_jid:params.chatJid,agent_name:'external-between-acquisitions'});
  // The common writer now rejects the replaced lifetime before entering caller authorization.
  expect(String(await observed)).toContain('lifetime changed');expect(checks).toBe(0);
  expect(getChatBranchByChatJid(params.chatJid)?.branch_id).toBe(external.branch_id);
  expect((db.query('SELECT count(*) n FROM messages').get() as any).n).toBe(0);
 } finally {db.transaction=transaction;}
});
