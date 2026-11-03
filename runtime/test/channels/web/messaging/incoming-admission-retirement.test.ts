import {afterEach,beforeEach,expect,test} from 'bun:test';
import {initDatabase,closeDatabase} from '../../../../src/db.js';
beforeEach(()=>{initDatabase();});
afterEach(async()=>{await closeDatabase();});
import {Database} from 'bun:sqlite';
import {join} from 'node:path';
import {withTempWorkspaceEnv,importFresh} from '../../../helpers.js';
import {getRuntimeConfigPaths} from '../../../../src/core/config.js';
import {handleAgentMessage} from '../../../../src/channels/web/handlers/agent.js';
import {handlePost} from '../../../../src/channels/web/handlers/posts.js';
import {admitWebMessage} from '../../../../src/channels/web/messaging/message-store.js';

type Store=typeof import('../../../../src/db.js');
const jid='web:incoming-contract';
const row=()=>({id:42,chat_jid:jid,timestamp:'2026-11-01T00:00:00Z',data:{type:'user_message',content:'fixture',thread_id:42}});
function fixtureChannel() {
  const effects={legacy:0,admitted:0,queued:0,commands:0,source:0,events:[] as string[]};
  const channel:any={
    agentPool:{isStreaming:()=>false,isActive:()=>false,applyControlCommand:async()=>{effects.commands++;return {status:'success',message:'fixture command'};}},
    getQueuedFollowupCount:()=>0,getAgentStatus:()=>null,updateAgentStatus:()=>{},
    storeMessage:()=>{effects.legacy++;return row();},sendMessage:async()=>{},resumeChat:()=>{effects.queued++;},
    queue:{enqueue:()=>{effects.queued++;}},broadcastEvent:(event:string)=>{effects.events.push(event);},
    json:(body:unknown,status=200)=>Response.json(body,{status}),
  };
  return {channel,effects};
}
function send(channel:any,content:string,signal?:AbortSignal) {
  return handleAgentMessage(channel,new Request('https://fixture/agent/default/message',{
    method:'POST',body:JSON.stringify({content}),signal,
  }),'/agent/default/message',jid,'default');
}

test('incoming control rows use only captured admission, without SDK input acceptance or deferral',async()=>{
  const {channel,effects}=fixtureChannel();
  channel.agentPool.isDurableRuntime=()=>true;
  channel.getInputSourceAdmission=()=>()=>{effects.source++;};
  channel.getQueuedInputSourceAdmission=()=>()=>{effects.source++;};
  channel.admitMessage=async(_jid:string,_text:string, _isBot: boolean,_media:unknown,options:any,check:(phase:string)=>void,_signal:unknown,defer:unknown)=>{
    check('before');effects.admitted++;expect(options.acceptSource).toBeUndefined();expect(defer).toBeUndefined();check('after');return row();
  };
  expect((await send(channel,'/stats')).status).toBe(201);
  expect(effects).toMatchObject({legacy:0,admitted:1,source:0,queued:0,commands:1});
});

test('incoming messages fail closed without admission rather than using synchronous storage',async()=>{
  const {channel,effects}=fixtureChannel();
  expect((await send(channel,'ordinary input')).status).toBe(503);
  expect(effects).toMatchObject({legacy:0,admitted:0,queued:0,commands:0,events:[]});
  expect((await send(channel,'/settings')).status).toBe(200);
  expect(effects.events).toEqual(['ui_open_tab']);
});

test('post entry fails closed without admission rather than using synchronous storage',async()=>{
  const {channel,effects}=fixtureChannel();
  const response=await handlePost(channel,new Request('https://fixture/post',{method:'POST',body:JSON.stringify({content:'post'})}),false,jid);
  expect(response.status).toBe(503);expect(effects).toMatchObject({legacy:0,queued:0,events:[]});
});

test('incoming synchronous wrapper exports are retired',async()=>{
  const messages=await import('../../../../src/channels/web/messaging/agent-message-service.js');
  const posts=await import('../../../../src/channels/web/posts-service.js');
  expect('storeAgentUserMessage' in messages).toBe(false);expect('storePost' in posts).toBe(false);
  const handler=await Bun.file(new URL('../../../../src/channels/web/handlers/agent.ts',import.meta.url)).text();
  expect(handler.includes('handleAgentMessageInScope')).toBe(false);
});

test('incoming control admission yields and cancels while a foreign WAL writer remains held',()=>
  withTempWorkspaceEnv('incoming-control-wal-',{},async ws=>{
    const store=await importFresh<Store>('../src/db.js');await store.closeDatabase();
    const path=join(ws.store,'control.sqlite');store.initDatabase({...getRuntimeConfigPaths(),databasePath:path});
    store.storeChatMetadata(jid,'2026-11-01T00:00:00Z','Fixture');
    const {channel,effects}=fixtureChannel(),controller=new AbortController();
    channel.storeMessage=(chatJid:string,content:string,isBot:boolean,mediaIds:number[],options:any)=>{
      effects.legacy++;throw Error('Retired synchronous writer entered');
    };
    channel.admitMessage=(chatJid:string,content:string, _isBot: boolean,mediaIds:number[],options:any,check:()=>void,signal:AbortSignal,defer?:()=>boolean)=>{
      effects.admitted++;return admitWebMessage(channel,{chatJid,content,isBot:false,mediaIds,agentId:'default',agentName:'Fixture'},options,check,signal,defer);
    };
    const blocker=new Database(path);blocker.exec('BEGIN IMMEDIATE');let beats=0;
    const heartbeat=setInterval(()=>{beats++;},5),started=performance.now();
    const pending=send(channel,'/stats',controller.signal);
    try {
      await Bun.sleep(40);expect(performance.now()-started).toBeLessThan(500);expect(beats).toBeGreaterThan(0);
      controller.abort(Error('fixture cancelled'));
      expect((await pending).status).toBe(400);expect(blocker.inTransaction).toBe(true);
      expect(effects).toMatchObject({legacy:0,admitted:1,commands:0,events:[]});
      expect(store.getDb().query('SELECT id FROM messages WHERE chat_jid=?').all(jid)).toEqual([]);
    }finally{clearInterval(heartbeat);if(blocker.inTransaction)blocker.exec('ROLLBACK');await pending;blocker.close();await store.closeDatabase();}
  }),10_000);

for (const publishFailure of [false,true]) {
  test(`post captures admitted port before parsing and retains accepted outcome: publication failure=${publishFailure}`,()=>
    withTempWorkspaceEnv('incoming-post-contract-',{},async()=>{
      const store=await importFresh<Store>('../src/db.js');await store.closeDatabase();store.initDatabase(getRuntimeConfigPaths());
      const {channel,effects}=fixtureChannel();let replacement=0,attemptedBroadcast=0,attemptedWake=0;
      channel.admitMessage=(chatJid:string,content:string, _isBot: boolean,mediaIds:number[],options:any,check:()=>void,signal:AbortSignal)=>{
        effects.admitted++;return admitWebMessage(channel,{chatJid,content,isBot:false,mediaIds,agentId:'default',agentName:'Fixture'},options,check,signal);
      };
      channel.broadcastEvent=()=>{
        expect(store.getDb().inTransaction).toBe(false);expect(store.getDb().query('SELECT id FROM messages WHERE chat_jid=?').all(jid)).toHaveLength(1);
        attemptedBroadcast++;if(publishFailure)throw Error('fixture publication failed');
      };
      channel.resumeChat=()=>{attemptedWake++;if(publishFailure)throw Error('fixture wake failed');};
      const request=new Request('https://fixture/post',{method:'POST'});
      request.json=async()=>{
        channel.admitMessage=async()=>{replacement++;throw Error('replacement port must not run');};
        return {content:'accepted post',media_ids:[],content_blocks:[{type:'restart_handoff',source:'exit_process'},{type:'text',text:'safe'}]};
      };
      try {
        const response=await handlePost(channel,request,false,jid);expect(response.status).toBe(201);
        expect((await response.json() as any).data.content).toBe('accepted post');
        expect({admitted:effects.admitted,legacy:effects.legacy,replacement,attemptedBroadcast,attemptedWake})
          .toEqual({admitted:1,legacy:0,replacement:0,attemptedBroadcast:1,attemptedWake:1});
        expect(store.getDb().query('SELECT id FROM messages WHERE chat_jid=?').all(jid)).toHaveLength(1);
      }finally{await store.closeDatabase();}
    }));
}
