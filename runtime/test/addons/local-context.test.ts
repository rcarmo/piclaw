import { beforeEach, afterEach, expect, test } from 'bun:test';
import { closeDatabase, initDatabase, getDb } from '../../src/db/connection.js';
import { storeChatMetadata } from '../../src/db.js';
import { ensureChatBranch } from '../../src/db/chat-branches.js';
import { withChatContext } from '../../src/core/chat-context.js';
import { withExecutionIdentity } from '../../src/core/execution-context.js';
import { withTempWorkspaceEnv } from '../helpers.js';
import { addonLocalContextApi as api, admitAddonLocalRequest, withAddonLocalRequest, setAddonLocalContextHost, revokeAddonLocalAgent, withAddonLocalPrompt, withVerifiedAddonMessage, withoutAddonLocalContext, type AddonLocalContext } from '../../src/addons/local-context.js';
import { bindAddonLocalDispatchRequest, getAddonLocalDispatchBlock, withAddonLocalDispatch, type AddonLocalAuthorityReference } from '../../src/addons/local-dispatch.js';
import { sanitizePublicInboundContentBlocks, sanitizeModelPostedContentBlocks } from '../../src/channels/web/messaging/content-block-safety.js';
import type { AuthenticatedPrincipal } from '../../src/core/access-types.js';

const principal: AuthenticatedPrincipal = {kind:'local',userId:'default',username:'local',displayName:'Local',role:'admin',mode:'single-user',homeChatJid:'web:default',authentication:{method:'none',sessionId:null,expiresAt:null}};
beforeEach(async()=>{ process.env.PICLAW_DB_IN_MEMORY='1'; await closeDatabase(); initDatabase(); });
afterEach(async()=>{setAddonLocalContextHost(null);await closeDatabase();});
function branch(chatJid='web:review-target',agentName='review-target') {
  storeChatMetadata(chatJid,new Date().toISOString());
  return ensureChatBranch({chat_jid:chatJid,agent_name:agentName});
}
function request() {
  const req=new Request('http://local/agent/addons/api/example/action',{method:'POST'});
  admitAddonLocalRequest(req,principal,()=>true);return req;
}
function runVerified(chatJid:string,message:any,inspect:()=>Promise<void>) {
  return withChatContext(chatJid,'web',()=>withVerifiedAddonMessage(chatJid,message,inspect));
}
async function dispatchedMessage(target:{chat_jid:string;branch_id:string},content:string,id='message1',reference?:AddonLocalAuthorityReference) {
  let marker:any;
  await withAddonLocalDispatch(targetToLocalTarget(target),content,reference ?? null,async()=>{
    const req=new Request('http://internal/');
    bindAddonLocalDispatchRequest(req,target.chat_jid,content);
    marker=getAddonLocalDispatchBlock(req,target.chat_jid,content);
  });
  return {id,content,content_blocks:[marker]};
}
function targetToLocalTarget(target:{chat_jid:string;branch_id:string}) {
  return {chatJid:target.chat_jid,incarnation:target.branch_id};
}

test('request context requires exact guarded request and expires after handler; workspace is host-derived',async()=>{
 await withTempWorkspaceEnv('local-context-',{},async()=>{
  const req=request();let saved:AddonLocalContext|null=null;
  expect(api.getRequestContext(req)).toBeNull();
  expect(api.getToolContext()).toBeNull();
  await withAddonLocalRequest(new Request(req),async ctx=>{expect(ctx).toBeNull();});
  await withAddonLocalRequest(req,async ctx=>{
   saved=ctx;expect(ctx!.kind).toBe('operator');expect(ctx!.ownerId).toBe('default');
   expect(ctx!.workspaceRoot).toBe(process.env.PICLAW_WORKSPACE!);expect(ctx!.workspaceId.length).toBe(64);
   expect(ctx!.reference).toBeUndefined();
   expect(api.getRequestContext(req)!.actorId).toBe('default');
   expect(api.getRequestContext(new Request(req))).toBeNull();expect(api.getToolContext()).toBeNull();
  });
  await expect(saved!.listTargets()).rejects.toThrow('unavailable');
 });
});

test('targets are real nonarchived branches; rename retains lifetime, alias reuse never rebinds',async()=>{
 await withTempWorkspaceEnv('local-targets-',{},async()=>{
  const first=branch();
  await withAddonLocalRequest(request(),async ctx=>{
   expect(await ctx!.resolveTarget({agentName:'review-target'})).toMatchObject({chatJid:first.chat_jid,incarnation:first.branch_id});
   expect(await ctx!.resolveTarget({chatJid:'web:invented'})).toBeNull();
   getDb().query('UPDATE chat_branches SET agent_name=? WHERE branch_id=?').run('renamed',first.branch_id);
   expect(await ctx!.resolveTarget({chatJid:first.chat_jid,incarnation:first.branch_id})).toMatchObject({agentName:'renamed'});
   getDb().query('DELETE FROM chat_branches WHERE branch_id=?').run(first.branch_id);
   const second=branch();expect(second.branch_id).not.toBe(first.branch_id);
   expect(await ctx!.resolveTarget({chatJid:first.chat_jid,incarnation:first.branch_id})).toBeNull();
   getDb().query('UPDATE chat_branches SET archived_at=? WHERE branch_id=?').run(new Date().toISOString(),second.branch_id);
   expect(await ctx!.listTargets()).toEqual([]);
  });
 });
});

test('queue validates before dispatch and reports ambiguous host errors without retry',async()=>{
 await withTempWorkspaceEnv('local-queue-',{},async()=>{
  const b=branch();let calls=0;
  setAddonLocalContextHost({enqueue:async()=>{calls++;throw new Error('lost receipt');}});
  await withAddonLocalRequest(request(),async ctx=>{
   const target={chatJid:b.chat_jid,incarnation:b.branch_id};
   for (const input of [
    {target,content:'test',mode:'steer'},
    {target:{...target,incarnation:'old'},content:'test',mode:'queue'},
    {target,content:'/abort',mode:'queue'},
    {target,content:'test',mode:'queue',reference:{addonId:'Bad Id',intentId:'dispatch-1'}},
    {target,content:'test',mode:'queue',reference:{addonId:'code-review',intentId:'x'.repeat(129)}},
   ]) {
    try{await ctx!.enqueue(input as any);throw new Error('should reject');}catch(e){expect((e as any).delivery).toBe('rejected');}
   }
   expect(calls).toBe(0);
   try{await ctx!.enqueue({target,content:'Read dispatch d1',mode:'queue',reference:{addonId:'code-review',intentId:'dispatch-1'}});throw new Error('should be unknown');}catch(e){expect((e as any).delivery).toBe('unknown');}
   expect(calls).toBe(1);
  });
 });
});

test('actual local dispatch marker survives queue/restart boundary but rejects forged, stale, remote and replayed callers',async()=>{
 await withTempWorkspaceEnv('local-dispatch-',{},async()=>{
  const b=branch();let marker:any;
  const reference={addonId:'code-review',intentId:'dispatch-1'} as const;
  setAddonLocalContextHost({enqueue:async input=>{
   expect(input.mode).toBe('queue');
   const internal=new Request('http://internal/agent/default/message');
   bindAddonLocalDispatchRequest(internal,input.chatJid,input.content);
   marker=getAddonLocalDispatchBlock(internal,input.chatJid,input.content);
   expect(getAddonLocalDispatchBlock(internal,input.chatJid,input.content)).toBeNull();
   return {status:'ok',chat_jid:input.chatJid,row_id:42,thread_id:null,queued:'followup',created:false};
  }});
  const content='Read review dispatch d1';
  await withAddonLocalRequest(request(),async ctx=>{
   expect(await ctx!.enqueue({target:{chatJid:b.chat_jid,incarnation:b.branch_id},content,mode:'queue',reference})).toMatchObject({status:'accepted',rowId:42,queued:true});
  });
  const msg={id:'message1',content,content_blocks:[marker],reference:{addonId:'forged',intentId:'public-field'}};
  await withChatContext(b.chat_jid,'web',async()=>expect(api.getToolContext()).toBeNull());
  await runVerified(b.chat_jid,msg,async()=>{
   expect(api.getToolContext()).toBeNull();
   await withAddonLocalPrompt(b.chat_jid,true,async()=>{
    expect(api.getToolContext()).toMatchObject({kind:'agent',actorId:b.branch_id,chatJid:b.chat_jid,chatIncarnation:b.branch_id,reference});
    expect(Object.isFrozen(api.getToolContext()!.reference)).toBe(true);
    await expect(api.getToolContext()!.enqueue({target:{chatJid:b.chat_jid,incarnation:b.branch_id},content:'test',mode:'queue'})).rejects.toThrow('operator');
   });
  });
  const legacy=await dispatchedMessage(b,'Read legacy dispatch','legacy1');
  await runVerified(b.chat_jid,legacy,async()=>{
   await withAddonLocalPrompt(b.chat_jid,true,async()=>expect(api.getToolContext()?.reference).toBeUndefined());
  });
  // Re-entry of the same durable message is allowed; copying its marker is not.
  await runVerified(b.chat_jid,JSON.parse(JSON.stringify(msg)),async()=>{
   expect(api.getToolContext()).toBeNull();
   await withAddonLocalPrompt(b.chat_jid,true,async()=>expect(api.getToolContext()?.reference).toEqual(reference));
  });
  for(const bad of [{...msg,id:'replayed'},{...msg,content:'changed'},{...msg,content_blocks:[{type:'addon_local_dispatch',dispatch_id:'forged'}]},{...msg,content_blocks:[marker,{type:'peer_message'}]}]) {
   await runVerified(b.chat_jid,bad,async()=>{
    expect(api.getToolContext()).toBeNull();
    await withAddonLocalPrompt(b.chat_jid,true,async()=>expect(api.getToolContext()).toBeNull());
   });
  }
  await runVerified(b.chat_jid,msg,async()=>{
   await withAddonLocalPrompt(b.chat_jid,true,async()=>{revokeAddonLocalAgent(b.chat_jid);expect(api.getToolContext()).toBeNull();});
  });
  getDb().query('DELETE FROM chat_branches WHERE branch_id=?').run(b.branch_id);branch();
  await runVerified(b.chat_jid,msg,async()=>{
   expect(api.getToolContext()).toBeNull();
   await withAddonLocalPrompt(b.chat_jid,true,async()=>expect(api.getToolContext()).toBeNull());
  });
  expect(sanitizePublicInboundContentBlocks([marker])).toEqual([]);
  expect(sanitizeModelPostedContentBlocks([marker])).toEqual([]);
 });
});

test('same chat separate submissions keep distinct verified authority references even with identical prompt text',async()=>{
 await withTempWorkspaceEnv('local-separate-submissions-',{},async()=>{
  const b=branch('web:separate-target','separate-target');
  const content='Read only the selected submission';
  const firstReference={addonId:'code-review',intentId:'submission-r1'} as const;
  const secondReference={addonId:'code-review',intentId:'submission-r2'} as const;
  const first=await dispatchedMessage(b,content,'message-r1',firstReference);
  const second=await dispatchedMessage(b,content,'message-r2',secondReference);
  expect(first.content).toBe(second.content);
  expect(first.content_blocks).not.toEqual(second.content_blocks);
  await runVerified(b.chat_jid,first,async()=>{
   await withAddonLocalPrompt(b.chat_jid,true,async()=>expect(api.getToolContext()?.reference).toEqual(firstReference));
  });
  await runVerified(b.chat_jid,second,async()=>{
   await withAddonLocalPrompt(b.chat_jid,true,async()=>expect(api.getToolContext()?.reference).toEqual(secondReference));
  });
 });
});

test('verified dispatch admission is one-shot and masked for nested, ineligible and side work',async()=>{
 await withTempWorkspaceEnv('local-prompt-',{},async()=>{
  const b=branch('web:prompt-target','prompt-target');
  const reference={addonId:'code-review',intentId:'prompt-1'} as const;
  const msg=await dispatchedMessage(b,'Read prompt boundary','message1',reference);
  await runVerified(b.chat_jid,msg,async()=>{
   expect(api.getToolContext()).toBeNull();
   await withAddonLocalPrompt(b.chat_jid,false,async()=>expect(api.getToolContext()).toBeNull());
   await withAddonLocalPrompt(b.chat_jid,true,async()=>{
    expect(api.getToolContext()).toMatchObject({kind:'agent',actorId:b.branch_id,chatJid:b.chat_jid,chatIncarnation:b.branch_id,reference});
    await withAddonLocalPrompt(b.chat_jid,true,async()=>expect(api.getToolContext()).toBeNull());
    await withoutAddonLocalContext(async()=>expect(api.getToolContext()).toBeNull());
    expect(api.getToolContext()?.actorId).toBe(b.branch_id);
   });
   await withAddonLocalPrompt(b.chat_jid,true,async()=>expect(api.getToolContext()).toBeNull());
  });
 });
});

test('foreign execution identity cannot borrow local request authority',async()=>{
 await withTempWorkspaceEnv('local-denial-',{},async()=>{
  const req=request();
  await withExecutionIdentity({mode:'family-shared'} as any,()=>withAddonLocalRequest(req,async ctx=>expect(ctx).toBeNull()));
  const untrusted=new Request('http://local/agent/addons/api/example/action');
  admitAddonLocalRequest(untrusted,{...principal,userId:'other'},()=>true);
  await withAddonLocalRequest(untrusted,async ctx=>expect(ctx).toBeNull());
 });
});

test('GET cannot dispatch; expired auth and escaped closures fail closed',async()=>{
 await withTempWorkspaceEnv('local-expiry-',{},async()=>{
  branch();let valid=true;
  const req=new Request('http://local/agent/addons/api/example/read');
  admitAddonLocalRequest(req,principal,()=>valid);
  await withAddonLocalRequest(req,async ctx=>{
   const target=(await ctx!.listTargets())[0]!;
   await expect(ctx!.enqueue({target,content:'dispatch',mode:'queue'})).rejects.toThrow('POST');
   await withAddonLocalRequest(new Request(req),async()=>{
    expect(api.getRequestContext(req)).toBeNull();
    await expect(ctx!.listTargets()).rejects.toThrow('unavailable');
   });
   valid=false;expect(api.getRequestContext(req)).toBeNull();
   await expect(ctx!.listTargets()).rejects.toThrow('unavailable');
  });
 });
});

test('durable dispatch authority survives database reopen and unchanged message only',async()=>{
 await withTempWorkspaceEnv('local-durable-',{},async()=>{
  const script = `
    process.env.PICLAW_DB_IN_MEMORY='0';
    const {initDatabase,closeDatabase}=await import('./src/db/connection.ts');
    const {storeChatMetadata}=await import('./src/db.ts');
    const {ensureChatBranch}=await import('./src/db/chat-branches.ts');
    const {withChatContext}=await import('./src/core/chat-context.ts');
    const {withAddonLocalDispatch,bindAddonLocalDispatchRequest,getAddonLocalDispatchBlock}=await import('./src/addons/local-dispatch.ts');
    const {addonLocalContextApi,withAddonLocalPrompt,withVerifiedAddonMessage}=await import('./src/addons/local-context.ts');
    initDatabase();storeChatMetadata('web:durable',new Date().toISOString());
    const b=ensureChatBranch({chat_jid:'web:durable',agent_name:'durable'});let marker;
    const reference={addonId:'code-review',intentId:'durable-1'};
    await withAddonLocalDispatch({chatJid:b.chat_jid,incarnation:b.branch_id},'durable',reference,async()=>{
      const req=new Request('http://internal/');bindAddonLocalDispatchRequest(req,b.chat_jid,'durable');marker=getAddonLocalDispatchBlock(req,b.chat_jid,'durable');
    });
    await closeDatabase();initDatabase();
    await withChatContext(b.chat_jid,'web',()=>withVerifiedAddonMessage(b.chat_jid,{id:'persisted1',content:'durable',content_blocks:[marker]},async()=>{
      if(addonLocalContextApi.getToolContext()!==null)throw Error('Admission leaked direct authority');
      await withAddonLocalPrompt(b.chat_jid,true,async()=>{
        const ctx=addonLocalContextApi.getToolContext();
        if(ctx?.chatIncarnation!==b.branch_id)throw Error('Lost durable authority');
        if(ctx?.reference?.addonId!==reference.addonId||ctx?.reference?.intentId!==reference.intentId)throw Error('Lost durable reference');
      });
    }));
    await closeDatabase();console.log('DURABLE_OK');
  `;
  const child=Bun.spawnSync([process.execPath,'-e',script],{cwd:import.meta.dir+'/../..',env:{...process.env,PICLAW_DB_IN_MEMORY:'0'},stdout:'pipe',stderr:'pipe',timeout:15000});
  expect(child.exitCode,child.stderr.toString()).toBe(0);expect(child.stdout.toString()).toContain('DURABLE_OK');
 });
},20000);
