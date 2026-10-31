import { normalizeContext, getCurrentTools, getCurrentSystemPrompt } from "../../runtime/durable-engine/node_modules/@earendil-works/pi-ai/dist/index.js";
import { test, expect } from 'bun:test';
import { createHostModels } from '../../runtime/durable-engine/src/host-models.ts';
import { HostCodexModelServices } from '../../runtime/durable-engine/src/host-codex-model-services.ts';
import { ModelRuntime } from '../../node_modules/@earendil-works/pi-coding-agent/dist/index.js';
import { createProvider, createAssistantMessageEventStream } from '../../node_modules/@earendil-works/pi-ai/dist/index.js';

const routingOwner = {};
const routingScope = () => ({ turnId: "fixture-turn", accountRef: "fixture-account", provider: routingOwner });

test('public Root 1.2 registration precedes private 1.3 selection and denies caller callbacks', async () => {
 const root = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false, credentials: {get: async()=>undefined, set:async()=>{}, delete:async()=>{}, list:async()=>[]} as any });
 const service = new HostCodexModelServices({ routingScope,capture:async()=>{throw Error('No owned request')}, assertAccount(){}, observe:async()=>{},flush:async()=>{}}, {createNativeCodexHooks(){throw Error("unused")}});
 const model:any = {provider:'openai-codex', id:'qualified-codex', api:'openai-codex-responses', name:'fixture', baseUrl:'https://fixture.invalid', type:'chat', reasoning:false,input:['text','image'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:100,maxTokens:10};
 const provider = createProvider({id:'openai-codex',auth:{},models:[model],api:{stream:()=>createAssistantMessageEventStream(),streamSimple:()=>createAssistantMessageEventStream()}});
 service.register(root,provider);
 expect(root.getPhysicalModel(model.provider,model.id)?.id).toBe(model.id);
 const models = createHostModels(root,[model],{signal:new AbortController().signal,authorize:async()=>{},assertCurrent(){},codex:service});
 const selected = models.getModel(model.provider,model.id)!;
 let called=false;
 expect(()=>models.streamSimple(selected,{messages:[]},{onPayload:()=>{called=true}})).toThrow('Unqualified request option');
 expect(called).toBe(false);
});

const fixtureModel: any = {provider:'openai-codex', id:'fixture', api:'openai-codex-responses'};
const factories = {createNativeCodexHooks: () => ({request:(p:unknown)=>p, headers:(h:any)=>h, context:(m:any)=>m, systemPrompt:(p:string)=>p})};
test('fetch delivers partial bytes before observer finishes and finish joins it', async () => {
 let release!:()=>void, writes=0, requests=0;
 const gate=new Promise<void>(r=>release=r);
 const service=new HostCodexModelServices({ routingScope,
  capture:async(signal)=>({id:'op',sessionId:'s',cwd:'/synthetic',model:fixtureModel,signal,assertCurrent(){}}),
  assertAccount(){}, async observe(_op,response,check){ await response.text(); await gate; check(); writes++; }, async flush(){},
  fetch:(async()=>{requests++; return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('partial'));c.close();}}));}) as unknown as typeof fetch,
 },factories);
 const bound=(await service.bind(fixtureModel,new AbortController().signal))!;
 const response=await bound.options.fetch!('https://synthetic.invalid');
 expect(await response.text()).toBe('partial'); expect(writes).toBe(0);
 let finished=false; const finishing=bound.finish().then(()=>{finished=true});
 await Promise.resolve(); expect(finished).toBe(false); release(); await finishing;
 expect(writes).toBe(1); expect(requests).toBe(1);
});
test('queued artifact write is fenced after revocation and observer rejection is joined', async()=>{
 let release!:()=>void, current=true, writes=0;
 const gate=new Promise<void>(r=>release=r);
 const service=new HostCodexModelServices({ routingScope,
 capture:async(signal)=>({id:'op',sessionId:'s',cwd:'/synthetic',model:fixtureModel,signal,assertCurrent(){if(!current)throw Error('revoked')}}),
 assertAccount(){},async observe(_op,_response,check){await gate; check(); writes++},async flush(){},
 fetch:(async()=>new Response('partial')) as unknown as typeof fetch,
 },factories);
 const bound=(await service.bind(fixtureModel,new AbortController().signal))!;
 await bound.options.fetch!('https://synthetic.invalid'); current=false;release();
 await expect(bound.finish()).rejects.toThrow('revoked'); expect(writes).toBe(0);
});

test('reported spend remains settled after failed output and request cleanup', async()=>{
 const root=await ModelRuntime.create({modelsPath:null,refreshOnCreate:false,credentials:{read:async()=>undefined,get:async()=>undefined,set:async()=>{},delete:async()=>{},list:async()=>[]} as any});
 const order:string[]=[];
 let settled=false, released=false, cleanups=0;
 const model:any={...fixtureModel,name:'fixture',type:'chat',baseUrl:'https://synthetic.invalid',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:100,maxTokens:10};
 const spent={input:3,output:2,cacheRead:0,cacheWrite:0,totalTokens:5,cost:{input:1,output:1,cacheRead:0,cacheWrite:0,total:2}};
 const message:any={role:'assistant',provider:model.provider,model:model.id,api:model.api,content:[],timestamp:1,stopReason:'stop',usage:spent};
 const stream=()=>{const s=createAssistantMessageEventStream(); queueMicrotask(()=>{s.push({type:'done',reason:'stop',message});s.end(message)});return s};
 const provider=createProvider({id:model.provider,auth:{apiKey:{name:'synthetic',resolve:async()=>({auth:{apiKey:'synthetic'},source:'fixture'})}},models:[model],api:{stream,streamSimple:stream}});
 const service=new HostCodexModelServices({ routingScope,capture:async(signal)=>({id:'o',sessionId:'s',cwd:'/synthetic',model,signal,assertCurrent(){}}),assertAccount(){},observe:async()=>{},flush:async()=>{order.push('flush');throw Error('output failed')}},factories);
 service.register(root,provider);
 const models=createHostModels(root,[model],{signal:new AbortController().signal,authorize:async()=>{},assertCurrent(){},codex:service,
 prepareRequest:async()=>({retainTerminal:async(m)=>{expect(m.usage.totalTokens).toBe(5);order.push('retain')},dispatch:async()=>{order.push('dispatch')},settle:async(m:any)=>{expect(m.usage.totalTokens).toBe(5);if(!settled)order.push('settle');settled=true},abandon:async()=>{cleanups++;if(!settled){released=true;order.push('release')}}})});
 const result=await models.streamSimple(models.getModel(model.provider,model.id)!,{messages:[]}).result();
 expect(result.stopReason).toBe('error');expect(result.usage.totalTokens).toBe(5);
 expect(order.indexOf('retain')).toBeLessThan(order.indexOf('settle'));
 expect(order.filter(step=>step==='retain')).toHaveLength(1);
 expect(order.indexOf('settle')).toBeLessThan(order.indexOf('flush'));
 expect(cleanups).toBe(1);expect(settled).toBe(true);expect(released).toBe(false);expect(order).not.toContain('release');
});


test("non-Codex profiles bind request-scoped tools and headers without HTTP output capture", async () => {
 const model:any = {provider:"github-copilot",id:"gpt-5",api:"openai-responses"};
 let captures=0, headers=0, filters=0;
 const service = new HostCodexModelServices({ routingScope,
  capture:async(signal)=>{captures++;return {id:"op",sessionId:"s",cwd:"/synthetic",model,signal,assertCurrent(){}}},
  assertAccount(){}, observe:async()=>{throw Error("Unexpected observer")},flush:async()=>{throw Error("Unexpected flush")},
 }, {createNativeCodexHooks:()=>({
  request:(p:unknown)=>p, headers:(h:any)=>{headers++;return {...h,"copilot-integration-id":"vscode-chat"}},
  tools:(names:string[])=>{filters++;return names.filter(n=>n!=="bash")},
  context:(m:any)=>m,systemPrompt:(p:string)=>p,
 })});
 const bound=(await service.bind(model,new AbortController().signal))!;
 const tools=[{name:"bash",description:"shell",parameters:{}},{name:"exec_command",description:"native",parameters:{}}];
 const context=normalizeContext({messages:[],tools});
 expect(getCurrentTools(bound.context(context).messages).map(t=>t.name)).toEqual(["exec_command"]);
 expect(getCurrentTools(context.messages)).toEqual(tools);
 expect(bound.headers({})["copilot-integration-id"]).toBe("vscode-chat");
 expect(bound.options).not.toHaveProperty("fetch");
 expect(bound.options).not.toHaveProperty("transport");
 await bound.finish();expect([captures,headers,filters]).toEqual([1,1,1]);
});


test("public normalized transcript profiles current prompt and tools without reviving historical state", async () => {
 const model = fixtureModel;
 let seenPrompt = "", seenTools: string[] = [];
 const service = new HostCodexModelServices({ routingScope,
  capture: async signal => ({id:"op",sessionId:"s",cwd:"/synthetic",model,signal,assertCurrent(){}}),
  assertAccount(){}, observe:async()=>{}, flush:async()=>{},
 }, {createNativeCodexHooks:()=>({
  ...factories.createNativeCodexHooks(),
  tools:(names:string[])=>{seenTools=names;return names.filter(name=>name!=="bash" && name!=="unwanted")},
  systemPrompt:(prompt:string)=>{seenPrompt=prompt;return prompt+"\nPROFILE"},
 })});
 const context = normalizeContext({
  systemPrompt:"Base instructions",
  tools:["bash","exec_command","unwanted","removed"].map(name=>({name,description:name,parameters:{type:"object",properties:{}}})),
  messages:[
   {role:"system",content:"",sections:{agents:"OLD AGENTS",obsolete:"NEVER ACTIVATE"},timestamp:1},
   {role:"user",content:[{type:"text",text:"keep history"}],timestamp:2},
   {role:"toolResult",toolCallId:"old-call",toolName:"removed",content:[{type:"text",text:"old result"}],details:{count:3,ok:true,items:[null,"value"]},isError:false,timestamp:3},
   {role:"system",content:"",sections:{agents:"# AGENTS\nCurrent guidance",copilot:"# Copilot\nCurrent guidance",obsolete:null},toolsRemoved:[{name:"removed"}],timestamp:4},
  ],
 });
 const before=JSON.stringify(context);
 const bound=await service.bind(model,new AbortController().signal);
 const result=bound.context(context);
 expect(seenTools).toEqual(["bash","exec_command","unwanted"]);
 expect(seenPrompt).toContain("# AGENTS\nCurrent guidance");
 expect(seenPrompt).toContain("# Copilot\nCurrent guidance");
 expect(seenPrompt).not.toContain("OLD AGENTS");
 expect(seenPrompt).not.toContain("NEVER ACTIVATE");
 expect(getCurrentSystemPrompt(result.messages)).toBe(seenPrompt+"\nPROFILE");
 expect(getCurrentTools(result.messages).map(tool=>tool.name)).toEqual(["exec_command"]);
 expect(getCurrentTools(result.messages)[0]?.parameters).toEqual({type:"object",properties:{}});
 expect(result.messages.filter(message=>message.role!=="system")).toEqual(context.messages.filter(message=>message.role!=="system"));
 expect(result.messages.find(message=>message.role==="toolResult")).toBe(context.messages.find(message=>message.role==="toolResult"));
 expect(result).not.toHaveProperty("tools");
 expect(JSON.stringify(context)).toBe(before);
 await bound.finish();
});


test("maintenance operation preserves system policy while retaining request and header guards", async () => {
 const signal = new AbortController().signal;
 let promptCalls = 0, checks = 0;
 const service = new HostCodexModelServices({ routingScope,
  capture: async () => Object.freeze({ id: "maintenance-work", sessionId: "actual-session", cwd: "/synthetic",
   model: fixtureModel, signal, profilePrompt: false, assertCurrent() { checks++; } }),
  assertAccount() {}, async observe() { throw Error("No transport in this test"); }, async flush() {},
 }, { createNativeCodexHooks: () => ({
  request: payload => payload, headers: headers => headers, context: messages => [...messages],
  systemPrompt() { promptCalls++; throw Error("Maintenance prompt must not be rewritten"); },
 }) });
 const bound = await service.bind(fixtureModel, signal);
 const transcript = normalizeContext({ systemPrompt: "Compact exactly; preserve safety policy.", messages: [], tools: [] });
 expect(getCurrentSystemPrompt(bound.context(transcript).messages)).toBe("Compact exactly; preserve safety policy.");
 expect(bound.headers({ "x-maintenance": "owned" })).toEqual({ "x-maintenance": "owned" });
 expect(bound.options.onPayload({ tools: [] }, fixtureModel)).toEqual({ tools: [] });
 await bound.finish();
 expect(promptCalls).toBe(0);
 expect(checks).toBeGreaterThan(0);
});


test('native Codex requests public summaries without decoding encrypted reasoning or enabling off', async () => {
  const factories = {createNativeCodexHooks: () => ({request:(p:any)=>p,headers:(h:any)=>h,systemPrompt:(t:any)=>t,context:(c:any)=>c})};
  const service = new HostCodexModelServices({ routingScope,capture:async(signal,model)=>({id:"op",sessionId:"s",cwd:"/synthetic",model,signal,assertCurrent(){}}),assertAccount(){},observe:async()=>{},flush:async()=>{}}, factories as any);
  const model = {provider:'openai-codex',id:'gpt-test',api:'openai-codex-responses'} as any;
  const bound = await service.bind(model, new AbortController().signal);
  expect(bound.options.onPayload({reasoning:{effort:'medium',summary:'auto'}},model)).toEqual({reasoning:{effort:'medium',summary:'detailed'}});
  expect(bound.options.onPayload({reasoning:{effort:'none'}},model)).toEqual({reasoning:{effort:'none'}});
  expect(bound.options.onPayload({model:'gpt-test'},model)).toEqual({model:'gpt-test'});
});

test("native application retains bash/files/codemode/model tools and host policy without Codex shell substitution", async () => {
 let filters = 0, prompts = 0, requests = 0;
 const service = new HostCodexModelServices({ routingScope, preserveHostTools: true,
  capture: async signal => ({ id: "owned", sessionId: "native", cwd: "/fixture", model: fixtureModel, signal, assertCurrent() {} }),
  assertAccount() {}, async observe() {}, async flush() {},
 }, { createNativeCodexHooks: () => ({
  request: p => { requests++; return p; }, headers: h => ({ ...h, "x-owned": "kept" }), context: m => [...m],
  tools: () => { filters++; throw Error("Native host must not replace its tools"); },
  systemPrompt: () => { prompts++; throw Error("Native policy must not become a Codex coding prompt"); },
 }) });
 const bound = await service.bind(fixtureModel, new AbortController().signal);
 const names = ["read", "bash", "edit", "write", "codemode", "set_model", "list_models", "exec_command", "write_stdin", "apply_patch"];
 const input = normalizeContext({ systemPrompt: "Host instructions; use codemode and bash.", messages: [], tools: names.map(name => ({ name, description: name, parameters: {} })) });
 const output = bound.context(input);
 expect(getCurrentTools(output.messages).map(t => t.name)).toEqual(names.slice(0, 7));
 expect(getCurrentSystemPrompt(output.messages)).toBe("Host instructions; use codemode and bash.");
 expect(bound.headers({})["x-owned"]).toBe("kept");
 expect(bound.options.onPayload({ tools: [] }, fixtureModel)).toEqual({ tools: [] });
 expect([filters, prompts, requests]).toEqual([0, 0, 1]);
 expect(getCurrentTools(input.messages).map(t => t.name)).toEqual(names);
 await bound.finish();
});
