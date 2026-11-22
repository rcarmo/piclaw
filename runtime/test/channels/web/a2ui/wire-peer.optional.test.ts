import '../../../helpers.ts';
import { expect, test } from 'bun:test';
import { fixture, referenceValidator } from '../../../fixtures/a2ui-v1/schema.js';
import { getDb, initDatabase, storeMessage } from '../../../../src/db.js';
import { publishAgentA2ui } from '../../../../src/channels/web/a2ui/publish.js';
import { A2uiAgentRpc, defineA2uiAgentFunction } from '../../../../src/channels/web/a2ui/agent-rpc.js';
import { RendererRpcBroker, type RendererRpcPacket } from '../../../../src/channels/web/a2ui/renderer-rpc.js';
import { bindRendererOffer, handleA2uiRendererPeer, handleA2uiRendererReply, handleA2uiRpc } from '../../../../src/channels/web/a2ui/rpc.js';
import type { WebChannelLike } from '../../../../src/channels/web/core/web-channel-contracts.js';

const socketTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1' ? test : test.skip;
const catalogue = 'urn:a2ui:wire-peer:fixture';

/** The renderer side speaks only HTTP, SSE and pinned reference JSON schemas. */
async function openPeer(origin: string, chat_jid: string, session: string) {
  const lifetime = new AbortController();
  const response = await fetch(`${origin}/agent/a2ui-peer?${new URLSearchParams({chat_jid})}`,{
    headers:{'x-test-session':session},signal:AbortSignal.any([lifetime.signal,AbortSignal.timeout(8_000)]),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  async function next(event: string) {
    while (!text.includes('\n\n')) {
      const result = await reader.read();
      if (result.done) throw Error(`SSE closed before ${event}`);
      text += decoder.decode(result.value,{stream:true});
    }
    const end = text.indexOf('\n\n');
    const lines = text.slice(0,end).split('\n');
    text = text.slice(end+2);
    expect(lines[0]).toBe(`event: ${event}`);
    const body=lines.filter(line=>line.startsWith('data: ')).map(line=>line.slice(6)).join('\n');
    return JSON.parse(body);
  }
  try {
    const {renderer_peer} = await next('a2ui_peer');
    return { renderer_peer,next,close:()=>lifetime.abort() };
  } catch (error) { lifetime.abort(); throw error; }
}

socketTest('independent v1.0 peer exchanges canonical envelopes and private metadata over HTTP/SSE', async () => {
  initDatabase();
  const root = getDb(), chat_jid = `web:wire-peer:${crypto.randomUUID()}`, conversationId = 7;
  const thread_id = storeMessage({id:'wire-peer-root',chat_jid,sender:'user',content:'Run the wire peer',timestamp:new Date().toISOString(),is_from_me:false});
  const docs = await fixture('protocol-examples.json').json();
  const create = {...docs['195'],createSurface:{...docs['195'].createSurface,components:[
    { ...docs['195'].createSurface.components[0],children:['user_name','name_field'] },
    docs['195'].createSurface.components[1],
    {id:'name_field',component:'TextField',label:'Name',value:{'@path':'/name'}},
  ]}};
  const basic = await referenceValidator();
  const testWire = await referenceValidator('testing_catalog.json');
  expect(basic('agent_to_renderer.json')(create)).toBe(true);
  const post = await publishAgentA2ui({root,chatJid:chat_jid,conversationId,thread:()=>thread_id,authorise:()=>{}},
    {messages:[create],fallback:'Profile'});
  const source = {chat_jid,thread_id,post_id:post.rowId,revision:post.revision};
  let receivedModel: unknown;
  const agent = new A2uiAgentRpc([defineA2uiAgentFunction({catalogue,name:'pingAgent',parseArgs:args=>Object.keys(args).length ? undefined : null,
    run(_args,context) { receivedModel=context.metadata; },
  })]);
  const renderer = new RendererRpcBroker();
  const channel = {authGateway:{getPrincipal:(req:Request)=>{
    const sessionId=req.headers.get('x-test-session');
    if (sessionId) return {kind:'local',userId:'default',mode:'single-user',role:'admin',authentication:{method:'local',sessionId,expiresAt:null}};
  }},a2uiRpcScope:(chat:string)=>chat===chat_jid ? {conversationId,agent,renderer,assertCurrent(){}} : undefined} as unknown as WebChannelLike;
  const metadata={a2uiRendererCapabilities:{'1.0':{supportedCatalogIds:[catalogue]}}};
  const server = Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req) {
    switch (new URL(req.url).pathname) {
      case '/agent/a2ui-rpc': return handleA2uiRpc(channel,req);
      case '/agent/a2ui-peer': return handleA2uiRendererPeer(channel,req);
      case '/agent/a2ui-renderer-reply': return handleA2uiRendererReply(channel,req);
      // Stand-in for a native tool turn: resolve the same accepted lease before invoking the broker.
      case '/fixture/invoke': {
        const {renderer_peer,message}: {renderer_peer:string;message:RendererRpcPacket['message']} = await req.json();
        const bound = bindRendererOffer(channel,req,chat_jid,renderer_peer,metadata);
        if (!bound) return new Response(null,{status:409});
        return Response.json(await renderer.invoke(bound.hash,chat_jid,conversationId,{message},()=>{}));
      }
      default: return new Response(null,{status:404});
    }
  }});
  const send=(route:string,body:unknown,session?:string)=>fetch(new URL(route,server.url),{method:'POST',
    headers:{'Content-Type':'application/json',...(session ? {'x-test-session':session} : {})},body:JSON.stringify(body),signal:AbortSignal.timeout(9_000),
  });
  let first: Awaited<ReturnType<typeof openPeer>> | undefined, second: typeof first;
  const outstanding: Promise<Response>[] = [];
  try {
    const upstream = (await fixture('cases/call_agent_function_message.json').json()).tests[1].data;
    const call = {...upstream,callAgentFunction:{...upstream.callAgentFunction,surfaceId:post.surfaceId,
      callFunction:{...upstream.callAgentFunction.callFunction,catalogId:catalogue},
    }};
    const validateToAgent=testWire('renderer_to_agent.json');
    const validateToRenderer=testWire('agent_to_renderer.json');
    expect(validateToAgent(call)).toBe(true);
    expect((await send('/agent/a2ui-rpc',{...source,message:call,metadata})).status).toBe(403);
    const model = {version:'1.0',surfaces:{[post.surfaceId]:{name:'John Doe'}}};
    expect(basic('renderer_data_model.json')(model)).toBe(true);
    const result = await send('/agent/a2ui-rpc',{...source,message:call,metadata},'first');
    expect(result.status).toBe(200);
    const canonical = await result.json();
    expect(validateToRenderer(canonical)).toBe(true);
    expect(canonical).toEqual({version:'1.0',agentFunctionResponse:{functionCallId:call.callAgentFunction.functionCallId,value:null}});
    expect(receivedModel).toEqual({a2uiRendererDataModel:model});

    first = await openPeer(server.url.origin,chat_jid,'first');
    second = await openPeer(server.url.origin,chat_jid,'second');
    const invoke=(lease:string,id:string,session:string)=>{
      const message={version:'1.0',callRendererFunction:{functionCallId:id,callFunction:{'@call':'pingAgent',catalogId:catalogue}}};
      expect(validateToRenderer(message)).toBe(true);
      const request=send('/fixture/invoke',{renderer_peer:lease,message},session);
      outstanding.push(request);
      return request;
    };
    expect((await invoke(first.renderer_peer,'rejected','second')).status).toBe(409);
    const pending = invoke(first.renderer_peer,'first-call','first');
    const packet = await first.next('a2ui_call');
    expect(validateToRenderer(packet.message)).toBe(true);
    expect(packet.message.callRendererFunction.functionCallId).toBe('first-call');
    const other = invoke(second.renderer_peer,'second-call','second');
    expect((await second.next('a2ui_call')).message.callRendererFunction.functionCallId).toBe('second-call');
    const reply = (lease: string, id: string) => ({chat_jid,renderer_peer:lease,
      message:{version:'1.0',rendererFunctionResponse:{functionCallId:id,value:null}},
    });
    const accepted = reply(first.renderer_peer,'first-call');
    expect(validateToAgent(accepted.message)).toBe(true);
    expect((await send('/agent/a2ui-renderer-reply',reply(second.renderer_peer,'first-call'),'second')).status).toBe(409);
    expect((await send('/agent/a2ui-renderer-reply',accepted,'second')).status).toBe(409);
    const updatedModel={version:'1.0',surfaces:{[post.surfaceId]:{name:'Tab draft'}}};
    expect((await send('/agent/a2ui-renderer-reply',{...accepted,a2ui_drafts:[{surface_id:post.surfaceId,revision:post.revision,
      edits:[{component_id:'name_field',value:'Tab draft'}],
    }]},'first')).status).toBe(204);
    expect(await (await pending).json()).toEqual({message:accepted.message,metadata:{a2uiRendererDataModel:updatedModel}});
    expect((await send('/agent/a2ui-renderer-reply',accepted,'first')).status).toBe(409);
    const otherReply = reply(second.renderer_peer,'second-call');
    expect((await send('/agent/a2ui-renderer-reply',otherReply,'second')).status).toBe(204);
    expect(await (await other).json()).toEqual({message:otherReply.message,metadata:{a2uiRendererDataModel:model}});
  } finally {
    first?.close();
    second?.close();
    server.stop(true);
    await Promise.allSettled(outstanding);
  }
});
