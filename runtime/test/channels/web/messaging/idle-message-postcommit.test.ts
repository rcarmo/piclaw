import {afterEach,expect,test} from 'bun:test';
import {createTempWorkspace,setEnv} from '../../../helpers.js';
import {initDatabase,getDb,closeDatabase} from '../../../../src/db/connection.js';
import {admitWebMessage} from '../../../../src/channels/web/messaging/message-store.js';
import {handleAgentMessage} from '../../../../src/channels/web/handlers/agent.js';
let cleanup:()=>void=()=>{};afterEach(async()=>{await closeDatabase();cleanup();});
function fixture(){const ws=createTempWorkspace('idle-postcommit-');const restore=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data});cleanup=()=>{restore();ws.cleanup();};initDatabase();return ws;}
const rows=()=>(getDb().query('SELECT count(*) AS n FROM messages').get() as {n:number}).n;

test('real handler returns 201 and schedules once despite postcommit preview SQLITE_BUSY and late abort',async()=>{
fixture();const abort=new AbortController();let attempts=0,scheduled=0,publications=0;const events:string[]=[];
const channel={agentPool:{isStreaming:()=>false,isActive:()=>false},getInputSourceAdmission:()=>()=>{},dispatchAcceptedInput:async(_chat:string,_id:string,row:number)=>{scheduled++;return {submission_id:row,queued:false};},queue:{enqueue:()=>{throw Error('Host lane must not run');}},broadcastEvent:(type:string)=>events.push(type),json:(value:unknown,status=200)=>Response.json(value,{status}),
get pendingLinkPreviews(){publications++;abort.abort(Error('late abort'));throw Object.assign(Error('postcommit preview contention'),{code:'SQLITE_BUSY'});},
admitMessage(jid:string,text:string, _isBot: boolean,media:number[],options:unknown,check:()=>void,signal:AbortSignal,defer:()=>boolean){attempts++;return admitWebMessage(channel as any,{chatJid:jid,content:text,isBot:false,mediaIds:media,agentId:'default',agentName:'Fixture'},options as any,check,signal,defer);}} as any;
const response=await handleAgentMessage(channel,new Request('https://fixture/agent/default/message',{method:'POST',body:JSON.stringify({content:'https://example.invalid/committed'}),signal:abort.signal}),'/agent/default/message','web:late','default');
expect(response.status).toBe(201);expect((await response.json()).row_id).toBeGreaterThan(0);expect(rows()).toBe(1);expect(events).toEqual(['new_post']);expect(attempts).toBe(1);expect(publications).toBe(1);expect(scheduled).toBe(1);
});

