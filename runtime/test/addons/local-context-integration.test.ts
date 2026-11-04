import { afterEach, beforeEach, expect, test } from 'bun:test';
import { closeDatabase, initDatabase, getDb } from '../../src/db/connection.js';
import { registerRootExtensionKvStore } from '../../src/db/register-extension-kv.js';
import { storeChatMetadata } from '../../src/db.js';
import { ensureChatBranch } from '../../src/db/chat-branches.js';
import { withChatContext } from '../../src/core/chat-context.js';
import { withTempWorkspaceEnv } from '../helpers.js';
import { addonLocalContextApi, setAddonLocalContextHost, withAddonLocalPrompt, withVerifiedAddonMessage } from '../../src/addons/local-context.js';
import { getAddonLocalDispatchBlock } from '../../src/addons/local-dispatch.js';
import { WebChannelRuntimePublicSurfaceService } from '../../src/channels/web/core/web-channel-runtime-public-surface-service.js';
import { registerAddonConfigApi, handleRegisteredAddonConfigApiRequest, resetAddonConfigApiRegistryForTests } from '../../src/channels/web/handlers/addon-config-api.js';
import { enforceRequestGuards } from '../../src/channels/web/http/request-guards.js';
import { getRouteFlags } from '../../src/channels/web/http/route-flags.js';
import { parseAgentMessageRequest } from '../../src/channels/web/messaging/agent-message-service.js';
import type { AuthenticatedPrincipal } from '../../src/core/access-types.js';
const principal:AuthenticatedPrincipal={kind:'local',userId:'default',username:'local',displayName:'Local',role:'admin',mode:'single-user',homeChatJid:'web:default',authentication:{method:'none',sessionId:null,expiresAt:null}};
const json=(body:unknown,status=200)=>Response.json(body,{status});
beforeEach(()=>{closeDatabase();initDatabase();});
afterEach(()=>{resetAddonConfigApiRegistryForTests();setAddonLocalContextHost(null);closeDatabase();});

test('guarded config action3 context traverses real internal request adapter and public sanitiser',async()=>{
 await withTempWorkspaceEnv('addon-http-',{},async()=>{
  storeChatMetadata('web:target',new Date().toISOString());const b=ensureChatBranch({chat_jid:'web:target',agent_name:'target'});
  const reference={addonId:'code-review',intentId:'dispatch-1'} as const;
  let valid=true,refreshes=0,queued:any=null;
  const channel:any={authGateway:{isAuthEnabled:()=>false,isInternalSecretEnabled:()=>false,verifyInternalSecret:()=>false,isAuthenticated:()=>valid,getPrincipal:(_req:Request,refresh:boolean)=>{if(refresh)refreshes++;return valid?principal:null;}},endpointContexts:{},json};
  const host=new WebChannelRuntimePublicSurfaceService({handleAgentMessage:async(req)=>{
   const parsed=await parseAgentMessageRequest(req);if('response' in parsed)throw Error('Unexpected malformed request');
   expect(parsed.payload.content_blocks).toBeUndefined();
   const marker=getAddonLocalDispatchBlock(req,'web:target',parsed.payload.content!);expect(marker).not.toBeNull();
   queued={id:'materialised',content:parsed.payload.content,content_blocks:[marker],reference:{addonId:'forged',intentId:'public-body'}};
   return json({chat_jid:'web:target',row_id:15,thread_id:null,queued:'followup'},201);
  }} as any);
  setAddonLocalContextHost({enqueue:request=>host.enqueueAgentMessage(request)});
  registerAddonConfigApi('example','dispatch',{set:async(_payload,req,context)=>{
   expect(context).not.toBeNull();expect(addonLocalContextApi.getRequestContext(req)?.ownerId).toBe('default');
   return context!.enqueue({target:{chatJid:b.chat_jid,incarnation:b.branch_id},content:'Read dispatch fixture',mode:'queue',reference});
  }});
  const path='/agent/addons/api/example/dispatch';
  const req=new Request('http://localhost'+path,{method:'POST',headers:{origin:'http://localhost','content-type':'application/json'},body:JSON.stringify({ownerId:'forged',actorId:'forged',reference:{addonId:'forged',intentId:'body-forged'}})});
  expect(await enforceRequestGuards(channel,req,path,getRouteFlags(req,path))).toBeNull();
  const response=await handleRegisteredAddonConfigApiRequest(req,'example','dispatch',json);
  expect(await response!.json()).toMatchObject({status:'accepted',rowId:15,queued:true});expect(refreshes).toBeGreaterThan(0);
  await withChatContext('web:target','web',()=>withVerifiedAddonMessage('web:target',queued,async()=>{
   expect(addonLocalContextApi.getToolContext()).toBeNull();
   await withAddonLocalPrompt('web:target',true,async()=>expect(addonLocalContextApi.getToolContext()).toMatchObject({actorId:b.branch_id,reference}));
  }));
  registerAddonConfigApi('example','expiry',{set:async(_body,_req,context)=>{valid=false;await expect(context!.listTargets()).rejects.toThrow('unavailable');return {ok:true};}});
  const expired=new Request('http://localhost'+path,{method:'POST',headers:{origin:'http://localhost'},body:'{}'});
  expect(await enforceRequestGuards(channel,expired,path,getRouteFlags(expired,path))).toBeNull();
  expect((await handleRegisteredAddonConfigApiRequest(expired,'example','expiry',json))!.status).toBe(200);
 });
});

test('public wire marker is discarded and failed CSRF never receives local context',async()=>{
 await withTempWorkspaceEnv('addon-csrf-',{},async()=>{
  const path='/agent/addons/api/example/dispatch';
  const channel:any={authGateway:{isAuthEnabled:()=>false,isInternalSecretEnabled:()=>false,verifyInternalSecret:()=>false,isAuthenticated:()=>true,getPrincipal:()=>principal},endpointContexts:{},json};
  const req=new Request('http://localhost'+path,{method:'POST',headers:{origin:'https://evil.example'},body:'{}'});
  expect((await enforceRequestGuards(channel,req,path,getRouteFlags(req,path)))!.status).toBe(403);
  registerAddonConfigApi('example','dispatch',{set:async(_body,_req,context)=>{expect(context).toBeNull();return {ok:true};}});
  await handleRegisteredAddonConfigApiRequest(req,'example','dispatch',json);
  const parsed=await parseAgentMessageRequest(new Request('http://localhost/',{method:'POST',body:JSON.stringify({content:'x',content_blocks:[{type:'addon_local_dispatch',dispatch_id:'fake'}]})}));
  expect('payload' in parsed&&parsed.payload.content_blocks).toEqual([]);
 });
});


test("authenticated configuration KV owner grants are exact, request-fenced and disposable", async () => {
 const { registerAddonConfigKvAuthority } = await import("../../src/channels/web/handlers/addon-config-api.js");
 const { getExtensionKvStore, resetExtensionKvStoreForTests, requireExtensionKvAuthority } = await import("../../src/extension-kv-registry.js");
 await withTempWorkspaceEnv("addon-admin-kv-", {}, async () => {
  resetExtensionKvStoreForTests(); registerRootExtensionKvStore(); requireExtensionKvAuthority();
  const kv = getExtensionKvStore(); let valid = true, owned = true, transactions = 0;
  const release = registerAddonConfigKvAuthority((extensionId, chatJid) => {
   if (extensionId !== "imap") throw Error("namespace denied");
   const assertCurrent = () => { if (!owned) throw Error("owner expired"); };
   return { extensionId, chatJid, globalRead: true, globalWrite: true, assertCurrent,
    write: body => getDb().transaction(() => { transactions++; assertCurrent(); const result = body(); assertCurrent(); return result; }).immediate() };
  });
  try {
   const path = "/agent/addons/api/imap/config";
   const channel:any = { authGateway: { isAuthEnabled:()=>false,isInternalSecretEnabled:()=>false,verifyInternalSecret:()=>false,isAuthenticated:()=>valid,getPrincipal:()=>valid?principal:null },endpointContexts:{},json };
   registerAddonConfigApi("imap", "config", { get: () => kv.get("imap","settings","global"), set: async () => {
    kv.set("imap","settings", { configured:true },"global");
    expect(() => kv.set("portainer","settings",{},"global")).toThrow();
    await Promise.resolve(); valid = false;
    expect(() => kv.set("imap","settings",{},"global")).toThrow("expired");
    valid = true; return { ok:true };
   }});
   const req = new Request("http://localhost"+path,{method:"POST",headers:{origin:"http://localhost"},body:"{}"});
   expect(await enforceRequestGuards(channel,req,path,getRouteFlags(req,path))).toBeNull();
   expect((await handleRegisteredAddonConfigApiRequest(req,"imap","config",json))!.status).toBe(200);
   const get = new Request("http://localhost"+path);
   expect(await enforceRequestGuards(channel,get,path,getRouteFlags(get,path))).toBeNull();
   expect(await (await handleRegisteredAddonConfigApiRequest(get,"imap","config",json))!.json()).toEqual({configured:true});
   storeChatMetadata("web:target", new Date().toISOString()); ensureChatBranch({chat_jid:"web:target",agent_name:"target"});
   registerAddonConfigApi("imap", "chat", { get: () => { expect(() => kv.get("imap","plan","chat","web:target")).not.toThrow(); expect(() => kv.get("imap","plan","chat","web:other")).toThrow(); return {ok:true}; } });
   const scopedPath = "/agent/addons/api/imap/chat";
   const scoped = new Request("http://localhost"+scopedPath+"?chat_jid=web%3Atarget");
   expect(await enforceRequestGuards(channel,scoped,scopedPath,getRouteFlags(scoped,scopedPath))).toBeNull();
   expect((await handleRegisteredAddonConfigApiRequest(scoped,"imap","chat",json))!.status).toBe(200);
   const evil = new Request("http://localhost"+path,{method:"POST",headers:{origin:"https://evil.example"},body:"{}"});
   expect((await enforceRequestGuards(channel,evil,path,getRouteFlags(evil,path)))!.status).toBe(403);
   expect((await handleRegisteredAddonConfigApiRequest(evil,"imap","config",json))!.status).toBe(500);
   owned = false;
   expect((await handleRegisteredAddonConfigApiRequest(get,"imap","config",json))!.status).toBe(500);
   expect(transactions).toBeGreaterThan(0);
  } finally { release(); resetExtensionKvStoreForTests(); }
 });
});
