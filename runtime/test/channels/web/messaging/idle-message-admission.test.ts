import {afterEach,expect,test} from 'bun:test';
import {createTempWorkspace,setEnv} from '../../../helpers.js';
import {initDatabase,getDb,closeDatabase} from '../../../../src/db/connection.js';
import {admitWebMessage} from '../../../../src/channels/web/messaging/message-store.js';
import {createMedia,getMediaById} from '../../../../src/db/media.js';
import {setDeferredQueuedFollowups,getDeferredQueuedFollowups} from '../../../../src/db/chat-cursors.js';
let cleanup:()=>void=()=>{};
afterEach(()=>{closeDatabase();cleanup();});
function fixture(){const ws=createTempWorkspace('idle-admission-');const restore=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data});cleanup=()=>{restore();ws.cleanup();};initDatabase();return getDb();}
const params=(content='ordinary input',mediaIds:number[]=[])=>({chatJid:'web:idle',content,isBot:false,mediaIds,agentId:'default',agentName:'Fixture'});
const channel={broadcastEvent(){}};
const count=(table:string)=>(getDb().query(`SELECT count(*) AS n FROM ${table}`).get() as {n:number}).n;
test('async incoming storage commits media, spill, self-thread and chat metadata once',async()=>{
  fixture();const existing=createMedia('original.txt','text/plain',new TextEncoder().encode('original'));
  const content='long message '.repeat(10000);
  const row=await admitWebMessage(channel,params(content,[existing]),{},()=>{},new AbortController().signal);
  expect(row!.id).toBeGreaterThan(0);expect(count('messages')).toBe(1);expect(count('media')).toBe(2);expect(count('message_media')).toBe(2);expect(count('chats')).toBe(1);
  expect(row!.data.thread_id).toBe(row!.id);const media=getDb().query('SELECT id,filename FROM media WHERE id<>?').get(existing) as {id:number;filename:string};expect(media.filename).toMatch(/^message-web-/);expect(new TextDecoder().decode(getMediaById(media.id)!.data)).toBe(content);
});
test('post-mutation authority failure rolls back generated spill, message, links, FTS and metadata',async()=>{
  fixture();let checks=0;
  await expect(admitWebMessage(channel,params('spill me '.repeat(15000)),{},()=>{if(++checks===2)throw Error('revoked');},new AbortController().signal)).rejects.toThrow('revoked');
  for(const table of ['messages','media','message_media','chats'])expect(count(table)).toBe(0);
  expect(getDb().query("SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'spill'").all()).toEqual([]);
});
test('before-commit routing failure rolls back storage and is never mistaken for committed input',async()=>{
  fixture();await expect(admitWebMessage(channel,params('before commit'),{},()=>{},new AbortController().signal,()=>{throw Error('route changed');})).rejects.toThrow('route changed');expect(count('messages')).toBe(0);expect(count('chats')).toBe(0);
});
test('cancelled or missing incoming media has no durable side effects',async()=>{
  fixture();const abort=new AbortController();abort.abort(Error('cancelled'));
  await expect(admitWebMessage(channel,params(),{},()=>{},abort.signal)).rejects.toThrow('cancelled');
  await expect(admitWebMessage(channel,params('missing',[99999]),{},()=>{},new AbortController().signal)).rejects.toThrow('unavailable');expect(count('messages')).toBe(0);expect(count('media')).toBe(0);
});
test('admitted storage rolls back spill media when its transaction fails',async()=>{
  fixture();getDb().exec("CREATE TRIGGER deny_message BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT,'denied');END");
  await expect(admitWebMessage(channel,params('spill fail '.repeat(14000)),{})).rejects.toThrow('denied');expect(count('messages')).toBe(0);expect(count('media')).toBe(0);
});
test('callback contention is terminal and rolls back its one message ID and generated spill rows',async()=>{
  const db=fixture(),insert=db.prepare.bind(db);let attempts=0;const ids:string[]=[];
  const failure=Object.assign(Error('synthetic contention'),{code:'SQLITE_BUSY'});
  db.prepare=((sql:string)=>{
    if(sql.includes('INSERT INTO messages')){
      const statement=insert(sql);
      return new Proxy(statement,{get(target,key){if(key==='run')return(...args:any[])=>{ids.push(args[0]);if(++attempts===1)throw failure;return target.run(...args);};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
    }
    return insert(sql);
  }) as typeof db.prepare;
  try{await expect(admitWebMessage(channel,params('retry-spill '.repeat(15000)),{},()=>{},new AbortController().signal)).rejects.toBe(failure);}finally{db.prepare=insert;}
  expect(attempts).toBe(1);expect(ids).toHaveLength(1);expect(count('messages')).toBe(0);expect(count('media')).toBe(0);expect(count('message_media')).toBe(0);expect(count('chats')).toBe(0);
  expect(db.query("SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'retry'").all()).toEqual([]);
});
test('atomic incoming spill and deferred consume share one rollback and commit',async()=>{
  fixture();setDeferredQueuedFollowups('web:idle',[{rowId:-7,queuedContent:'queued',queuedAt:new Date().toISOString()}]);
  const content='consumed-spill '.repeat(15000);
  await expect(admitWebMessage(channel,params(content),{consumeDeferredFollowupRowId:-7,beforeDeferredFollowupConsume:()=>{throw Error('fault before consume');}},()=>{},new AbortController().signal)).rejects.toThrow('fault before consume');
  expect(getDeferredQueuedFollowups('web:idle').map(item=>item.rowId)).toEqual([-7]);expect(count('media')).toBe(0);expect(count('messages')).toBe(0);
  const row=await admitWebMessage(channel,params(content),{consumeDeferredFollowupRowId:-7,threadId:77},()=>{},new AbortController().signal);
  expect(row.data.thread_id).toBe(77);expect(getDeferredQueuedFollowups('web:idle')).toEqual([]);expect(count('messages')).toBe(1);expect(count('media')).toBe(1);
});
test('postcommit preview failure never retries or prevents committed acknowledgement',async()=>{
  fixture();let publications=0;const broken={get pendingLinkPreviews(){publications++;throw Error('postcommit preview failure');},broadcastEvent(){}};
  const row = await admitWebMessage(broken,params('https://example.invalid/fixture'),{},()=>{},new AbortController().signal);
  expect(row!.id).toBeGreaterThan(0);
  expect(count('messages')).toBe(1);expect(count('chats')).toBe(1);expect(publications).toBe(1);
});
test('postcommit SQLITE_BUSY preview and cancellation still return the durable row',async()=>{
  fixture();const abort=new AbortController();let publications=0;
  const broken={get pendingLinkPreviews(){publications++;abort.abort(Error('cancel after commit'));throw Object.assign(Error('postcommit busy'),{code:'SQLITE_BUSY'});},broadcastEvent(){}};
  const row=await admitWebMessage(broken,params('https://example.invalid/committed'),{},()=>{},abort.signal);
  expect(row!.id).toBeGreaterThan(0);expect(abort.signal.aborted).toBe(true);expect(count('messages')).toBe(1);expect(publications).toBe(1);
});
