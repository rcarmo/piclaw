import '../../../helpers.ts';
import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright';
import { initDatabase } from '../../../../src/db.js';
import { CLASSIC_CONTENT_SECURITY_POLICY } from '../../../../src/channels/web/http/security.js';
import { RendererRpcBroker, type RendererRpcPacket } from '../../../../src/channels/web/a2ui/renderer-rpc.js';
import { bindRendererOffer, handleA2uiRendererPeer, handleA2uiRendererReply } from '../../../../src/channels/web/a2ui/rpc.js';
import { CLASSIC_A2UI_CATALOG } from '../../../../src/channels/web/a2ui/surface.js';
import type { WebChannelLike } from '../../../../src/channels/web/core/web-channel-contracts.js';

const browserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1' ? test : test.skip;
const chatJid='web:classic-renderer-rpc', catalogue='urn:piclaw:fixture:renderer:1', surfaceId='renderer-fixture';
const post_id=42, thread_id=8, revision=3;

for (const engine of [chromium,webkit]) {
  browserTest(`Classic negotiates and executes private renderer calls over ${engine.name()}`, async () => {
    initDatabase();
    const web = new URL('../../../../web/', import.meta.url).pathname;
    const scratch=await mkdtemp(join(tmpdir(),'a2ui-peer-'));
    let server: ReturnType<typeof Bun.serve> | undefined, browser: Awaited<ReturnType<typeof engine.launch>> | undefined;
    const renderer = new RendererRpcBroker();
    const channel = {authGateway:{getPrincipal:() => ({kind:'local',userId:'default',mode:'single-user',role:'admin',authentication:{method:'local',sessionId:null}})},
      a2uiRpcScope: (chat:string) => chat===chatJid ? {conversationId:17,renderer,assertCurrent() {}} : undefined,
    } as unknown as WebChannelLike;
    try {
      const entry=join(scratch,'fixture.ts');
      const resolve=(name:string)=>JSON.stringify(Bun.resolveSync(name,web));
      await Bun.write(entry, `
        import { SSEClient, sendAgentMessage } from ${JSON.stringify(join(web,'src/api.ts'))};
        import { rememberA2uiDraftEdit } from ${JSON.stringify(join(web,'src/ui/a2ui-drafts.ts'))};
        import { z } from ${resolve('zod')};
        const parse = schema => args => { const result=schema.safeParse(args); return result.success ? result.data : undefined; };
        const catalog = {id:${JSON.stringify(catalogue)},protocolVersion:'1.0',functions:{
          inspectLabel:{allowedCallers:'rendererOrAgent',parseArgs:parse(z.object({label:z.string().nullish()}).strict()),
            execute:({label}) => label ?? 'empty root'},
          inspectData:{allowedCallers:'rendererOrAgent',parseArgs:parse(z.object({data:z.record(z.string(),z.string())}).strict()),execute:({data})=>data},
          invalidValue:{allowedCallers:'agentOnly',parseArgs:parse(z.object({}).strict()),execute:() => new Map()},
        }};
        const chat = ${JSON.stringify(chatJid)};
        rememberA2uiDraftEdit(chat,${JSON.stringify(surfaceId)},${revision},'/title',{component_id:'field',value:'Browser draft'},false);
        const stream = new SSEClient((kind,data)=>{ if (kind==='connected') window.publicConnected=data; },()=>{},
          {chatJid:chat,enableA2uiRpc:true,rendererCatalogues:[catalog]});
        stream.connect();
        window.invokeFixture = kind => sendAgentMessage('default', kind, null, [], null, chat);
        window.reconnectFixture = () => stream.forceReconnect({immediate:true});
        window.disconnectFixture = () => stream.disconnect();
      `);
      const build=await Bun.build({entrypoints:[entry],outdir:scratch,target:'browser',format:'esm',splitting:true});
      expect(build.success).toBe(true);
      const js=new Set(build.outputs.filter(file=>file.path.endsWith('.js')).map(file=>new URL(`file://${file.path}`).pathname.split('/').at(-1)!));
      let peerOpened=false, mainConnections=0;
      const dropFirstPeer=new AbortController();
      const seenDescriptions: string[]=[];
      const peerHashes=new Set<string>();
      let transmittedLocalDraft=false;
      server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req) {
        const {pathname}=new URL(req.url);
        if(js.has(pathname.slice(1))) return new Response(Bun.file(join(scratch,pathname.slice(1))));
        if(pathname==='/sse/stream') {
          mainConnections++;
          return new Response(new ReadableStream({start(controller) {
            controller.enqueue(new TextEncoder().encode('event: connected\ndata: {}\n\n'));
          }}),{headers:{'Content-Type':'text/event-stream'}});
        }
        if(pathname==='/agent/a2ui-peer') {
          const peerRequest=peerOpened ? req : new Request(req,{signal:AbortSignal.any([req.signal,dropFirstPeer.signal])});
          peerOpened=true;
          return handleA2uiRendererPeer(channel,peerRequest);
        }
        if(pathname==='/agent/a2ui-renderer-reply') return handleA2uiRendererReply(channel,req);
        if(pathname===`/thread/${post_id}`) return Response.json({thread:[{id:post_id,chat_jid:chatJid,data:{thread_id,
          content_blocks:[{type:'a2ui_surface',state:'active',owner:'agent',revision,fallback_text:'Renderer fixture',
            surface:{surfaceId,catalogId:CLASSIC_A2UI_CATALOG,components:[],dataModel:{title:'Committed'}}}],
        }}]});
        if(pathname==='/agent/default/message') {
          const payload=await req.json() as {renderer_peer?:string;metadata?:unknown;content:string;a2ui_drafts?:unknown};
          const selection=bindRendererOffer(channel,req,chatJid,payload.renderer_peer,payload.metadata);
          if (!selection) return Response.json({connected:false});
          seenDescriptions.push(payload.content);
          peerHashes.add(selection.hash);
          if(payload.a2ui_drafts!==undefined) transmittedLocalDraft=true;
          if(payload.content==='ready') return Response.json({connected:true,catalogues:selection.catalogues});
          const mode=payload.content;
          const hasSurface=mode==='bound'||mode==='computed'||mode==='stale'||mode==='bad-arg';
          const packet:RendererRpcPacket={message:{version:'1.0',callRendererFunction:{functionCallId:mode,
            ...(hasSurface ? {surfaceId} : {}),callFunction:mode==='blocked'
              ? {'@call':'openUrl',catalogId:CLASSIC_A2UI_CATALOG,args:{url:'https://example.invalid/forbidden'}}
              : mode==='literal-args' ? {'@call':'inspectData',catalogId:catalogue,args:{data:{'@@call':'literal','@@type':'custom'}}}
              : mode==='illegal-result' ? {'@call':'invalidValue',catalogId:catalogue}
              : {'@call':'inspectLabel',catalogId:catalogue,args:{label:mode==='computed'
                ? {'@call':'formatString',args:{value:'Current: ${/title}'}}
                : mode==='bad-arg' ? {'@call':'formatNumber',args:{value:{'@path':'/title'}}} : {'@path':'/title'}}},
          }},...(hasSurface ? {source:{post_id,thread_id,revision:mode==='stale'?revision-1:revision}} : {})};
          if (mode==='malformed') {
            // Inject an envelope fault below the agent-side schema gate.
            Reflect.deleteProperty(packet.message.callRendererFunction.callFunction,'catalogId');
          }
          return Response.json((await renderer.invoke(selection.hash,chatJid,17,packet,()=>{})).message);
        }
        return new Response('<!doctype html><html><body><script type="module" src="/fixture.js"></script></body></html>',
          {headers:{'Content-Type':'text/html','Content-Security-Policy':CLASSIC_CONTENT_SECURITY_POLICY}});
      }});
      browser=await engine.launch({headless:true});
      const page=await browser.newPage();
      const errors:string[]=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(server.url.origin);
      await page.waitForFunction(()=>typeof (window as any).invokeFixture==='function');
      const call=(kind:string)=>page.evaluate(label=>(window as any).invokeFixture(label),kind);
      let ready: {connected:boolean;catalogues?:string[]}|undefined;
      for(let attempt=0;attempt<50;attempt++) {
        ready=await call('ready');
        if(ready?.connected) break;
        await Bun.sleep(30);
      }
      expect(peerOpened).toBe(true);
      expect(ready).toEqual({connected:true,catalogues:[CLASSIC_A2UI_CATALOG,catalogue]});
      expect(await page.evaluate(()=>(window as any).publicConnected)).toEqual({});
      expect(await call('bound')).toEqual({version:'1.0',rendererFunctionResponse:{functionCallId:'bound',value:'Browser draft'}});
      expect(await call('computed')).toEqual({version:'1.0',rendererFunctionResponse:{functionCallId:'computed',value:'Current: Browser draft'}});
      expect(transmittedLocalDraft).toBe(false);
      expect(await call('literal-args')).toEqual({version:'1.0',rendererFunctionResponse:{functionCallId:'literal-args',value:{'@call':'literal','@type':'custom'}}});
      expect(await call('unbound')).toEqual({version:'1.0',rendererFunctionResponse:{functionCallId:'unbound',value:'empty root'}});
      for(const denied of ['stale','blocked','bad-arg']) expect(await call(denied)).toMatchObject({version:'1.0',
        rendererFunctionResponse:{functionCallId:denied,error:{code:'INVALID_FUNCTION_CALL'}}});
      expect(await call('illegal-result')).toMatchObject({rendererFunctionResponse:{functionCallId:'illegal-result',error:{code:'EXECUTION_ERROR'}}});
      expect(await call('malformed')).toEqual({version:'1.0',error:{code:'INVALID_FUNCTION_CALL',functionCallId:'malformed',message:'The renderer rejected a malformed invocation.'}});
      expect(page.context().pages()).toHaveLength(1);
      dropFirstPeer.abort();
      for(let attempt=0;attempt<60 && peerHashes.size<2;attempt++) { await call('ready'); await Bun.sleep(100); }
      expect(peerHashes.size).toBe(2);
      expect(mainConnections).toBe(1);
      expect(await call('bound')).toEqual({version:'1.0',rendererFunctionResponse:{functionCallId:'bound',value:'Browser draft'}});
      await page.evaluate(()=>(window as any).reconnectFixture());
      for(let attempt=0;attempt<50 && peerHashes.size<3;attempt++) { await call('ready'); await Bun.sleep(30); }
      expect(peerHashes.size).toBe(3);
      expect(await call('bound')).toEqual({version:'1.0',rendererFunctionResponse:{functionCallId:'bound',value:'Browser draft'}});
      await page.evaluate(()=>(window as any).disconnectFixture());
      expect(await call('after-disconnect')).toEqual({connected:false});
      expect(seenDescriptions).not.toContain('after-disconnect');
      expect(errors).toEqual([]);
    } finally { await browser?.close(); server?.stop(true); await rm(scratch,{recursive:true,force:true}); }
  });
}
