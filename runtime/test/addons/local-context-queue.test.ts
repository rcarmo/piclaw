import { afterEach, beforeEach, expect, test } from 'bun:test';
import { getDb, storeChatMetadata, closeDatabase, initDatabase } from '../../src/db.js';
import { ensureChatBranch } from '../../src/db/chat-branches.js';
import { withChatContext } from '../../src/core/chat-context.js';
import { addonLocalContextApi as api, withAddonLocalPrompt, withVerifiedAddonMessage } from '../../src/addons/local-context.js';
import { bindAddonLocalDispatchRequest, getAddonLocalDispatchBlock, withAddonLocalDispatch, type AddonLocalAuthorityReference } from '../../src/addons/local-dispatch.js';
import { admitWebMessage } from '../../src/channels/web/messaging/message-store.js';
import { materializeDeferredFollowups } from '../../src/channels/web/runtime/process-chat-control-runtime.js';
import { QueuedFollowupLifecycleService } from '../../src/channels/web/runtime/queued-followup-lifecycle-service.js';
import { withTempWorkspaceEnv } from '../helpers.js';
import type { NewMessage } from '../../src/types.js';

beforeEach(()=>{ process.env.PICLAW_DB_IN_MEMORY='1'; closeDatabase(); initDatabase(); });
afterEach(()=>{ closeDatabase(); });

function branch(chatJid='web:queue-target',agentName='queue-target') {
  storeChatMetadata(chatJid,new Date().toISOString());
  return ensureChatBranch({chat_jid:chatJid,agent_name:agentName});
}

async function dispatchedMessage(target:{chat_jid:string;branch_id:string},content:string,reference?:AddonLocalAuthorityReference) {
  let marker:any;
  await withAddonLocalDispatch({chatJid:target.chat_jid,incarnation:target.branch_id},content,reference ?? null,async()=>{
    const req=new Request('http://internal/');
    bindAddonLocalDispatchRequest(req,target.chat_jid,content);
    marker=getAddonLocalDispatchBlock(req,target.chat_jid,content);
  });
  return {id:'queued-addon-1',chat_jid:target.chat_jid,sender:'local',sender_name:'Local',content,content_blocks:[marker]} as NewMessage;
}

function queueRuntime(chatJid:string) {
  const queued=new QueuedFollowupLifecycleService();
  const persistedByRowId=new Map<number,NewMessage>();
  const resumed:number[]=[];
  const channel={
    peekQueuedFollowupItem:(jid:string)=>queued.peekQueuedFollowupItem(jid),
    broadcastEvent:()=>{},
    resumeChat:(jid:string,threadRootId?:number|null)=>{ expect(jid).toBe(chatJid); resumed.push(threadRootId ?? 0); },
    admitMessage:async(jid:string,content:string,isBot:boolean,mediaIds:number[],options:any={},authorise?:any,signal?:AbortSignal)=>{
      expect(jid).toBe(chatJid);
      const stored = await admitWebMessage(channel, { chatJid: jid, content, isBot, mediaIds,
        agentId: 'default', agentName: 'Fixture' }, options, authorise, signal);
      if (!stored) throw Error('Fixture materialisation missing');
      const rowId=stored.id, timestamp=stored.timestamp;
      const id=(getDb().query('SELECT id FROM messages WHERE rowid=?').get(rowId) as {id:string}).id;
      const message:NewMessage={
        id,
        chat_jid:jid,
        sender:'web-user',
        sender_name:'Web User',
        content,
        timestamp,
        thread_id:options.threadId ?? null,
        content_blocks:Array.isArray(options.contentBlocks)?options.contentBlocks:undefined,
        link_previews:Array.isArray(options.linkPreviews)?options.linkPreviews:undefined,
        screen_hint:options.screenHint,
      };
      persistedByRowId.set(rowId,message);
      return stored;
    },
  };
  return {queued,persistedByRowId,resumed,channel};
}

async function materialiseNext(chatJid:string,runtime:ReturnType<typeof queueRuntime>) {
  const result=await materializeDeferredFollowups({channel:runtime.channel as any,chatJid,agentId:'default'});
  expect(result.status).toBe('resumed');
  const rowId=(result as {rowId:number}).rowId;
  expect(typeof rowId).toBe('number');
  const message=runtime.persistedByRowId.get(rowId);
  expect(message).toBeDefined();
  return {rowId,message:message!};
}

test('queued public follow-up does not inherit prior verified addon scope after dequeue',async()=>{
  await withTempWorkspaceEnv('local-context-queue-',{},async()=>{
    const target=branch();
    const reference={addonId:'code-review',intentId:'queue-1'} as const;
    const addonQueued=await dispatchedMessage(target,'Read addon dispatch',reference);
    const runtime=queueRuntime(target.chat_jid);
    runtime.queued.enqueueQueuedFollowupItem(target.chat_jid,0,addonQueued.content,null,new Date().toISOString(),{
      contentBlocks:addonQueued.content_blocks,
      source:'addon.local-context',
    });

    const first=await materialiseNext(target.chat_jid,runtime);
    expect(first.message.content_blocks).toMatchObject([{type:'addon_local_dispatch'}]);
    expect(runtime.resumed).toEqual([first.rowId]);

    await withChatContext(target.chat_jid,'web',()=>withVerifiedAddonMessage(target.chat_jid,first.message,async()=>{
      expect(api.getToolContext()).toBeNull();
      await withAddonLocalPrompt(target.chat_jid,true,async()=>{
        expect(api.getToolContext()).toMatchObject({actorId:target.branch_id,chatJid:target.chat_jid,chatIncarnation:target.branch_id,reference});
        runtime.queued.enqueueQueuedFollowupItem(target.chat_jid,0,'ordinary public next message',null,new Date().toISOString(),{source:'web.compose'});
        expect(api.getToolContext()?.reference).toEqual(reference);
      });
      await withAddonLocalPrompt(target.chat_jid,true,async()=>expect(api.getToolContext()).toBeNull());
    }));

    expect(runtime.queued.getQueuedFollowupCount(target.chat_jid)).toBe(1);
    const second=await materialiseNext(target.chat_jid,runtime);
    expect(second.message.content_blocks).toBeUndefined();
    expect(runtime.resumed).toEqual([first.rowId,second.rowId]);

    await withChatContext(target.chat_jid,'web',()=>withVerifiedAddonMessage(target.chat_jid,second.message,async()=>{
      expect(api.getToolContext()).toBeNull();
      await withAddonLocalPrompt(target.chat_jid,true,async()=>expect(api.getToolContext()).toBeNull());
    }));

    await withChatContext(target.chat_jid,'web',()=>withVerifiedAddonMessage(target.chat_jid,first.message,async()=>{
      expect(api.getToolContext()).toBeNull();
      await withAddonLocalPrompt(target.chat_jid,true,async()=>expect(api.getToolContext()?.reference).toEqual(reference));
      await withAddonLocalPrompt(target.chat_jid,true,async()=>expect(api.getToolContext()).toBeNull());
    }));
  });
});
