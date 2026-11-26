// Disposable end-to-end fixture. Run through the repository's test:local launcher.
import assert from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels, fauxProvider, fauxAssistantMessage, fauxToolCall, contentText, type TranscriptContext } from '@earendil-works/pi-ai';
import { estimateMessageTokens } from '@earendil-works/pi-ai/utils/estimate';
import { createRegistry, defineExtension, Harness, ToolTask, hook } from '@earendil-works/pi-durable';
import { SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite';
import { CodemodeSandbox } from '@earendil-works/pi-codemode';
import type { McpClient, Tool } from '@earendil-works/pi-mcp';
import { BunSqliteDatabase } from '../src/bun-sqlite.ts';
import { createMcpCodemodeTool } from '../src/mcp/codemode.ts';
import { mcpToolsExtension } from '../src/mcp/client.ts';
import { createMcpRecallExtension } from '../src/mcp/recall.ts';
import { McpConnectionStore } from '../src/mcp/connections.ts';
import { applicationRetainedDatabase } from '../src/mcp/retained-database.ts';
import { defaultMcpRecallSettings } from '../src/mcp/recall-output.ts';

assert.equal(process.env.PICLAW_TEST_FS_ISOLATION_ACTIVE, '1');
const sizes = [10, 100, 1000];
const modeOptions = ['off', 'observe', 'active'] as const;
const owner = {id:'fixture',name:'fixture'};
const cases = Array.from({length:72}, (_, id) => ({id, title:`Record ${id}`, payload:`常 é ${id} ` + (id % 2 ? 'repeat '.repeat(66) : Array.from({length:68},(_,i)=>((id+1)*65537*(i+3)).toString(36)).join(' '))}));
const target = `${cases[62]!.payload.slice(0,5)} tail`;
const data = {items:cases, target};
const json = JSON.stringify(data);
const catalog = (count:number):Tool[] => Array.from({length:count},(_,i)=>({
  name:`records_${i}`,description:`Find fixture records metadata list. ${i===0?'Authoritative target lookup.':'Auxiliary notes.'} ${'Field help. '.repeat(i%10)}`,
  inputSchema:{type:'object',properties:{filter:{type:'string',description:'Filter the fixture list'}},additionalProperties:false},
  outputSchema:{type:'object',properties:{items:{type:'array'},target:{type:'string'}},required:['items','target']},
}));
const scripts = {
  discovery: `const found=await searchTools('Authoritative target lookup',{limit:8}); const picked=found.find(row=>row.description.includes('Authoritative target lookup')); if(!picked)throw Error('Discovery failed'); `,
  direct: `const found=await searchTools('Authoritative target lookup',{limit:5}); const picked=found.find(row=>row.description.includes('Authoritative target lookup')); if(!picked)throw Error('Discovery failed'); const schema=await describeTool(picked.name);if(!schema.includes('filter'))throw Error('Wrong schema');const value=await tools[picked.name]({filter:'target'});if(value.items[62].payload.length<100)throw Error('Original script value changed');return {target:value.target};`,
};
async function measure(count:number,mode:typeof modeOptions[number],strategy:'broad'|'targeted',pass:number){
 const dir=mkdtempSync(join(tmpdir(),'mcp-context-bench-')),file=join(dir,'bench.sqlite');
 const db=new Database(file,{create:true});db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
 const connectionStore=new McpConnectionStore(db,()=>{}),config=await connectionStore.save({...owner,workspaceId:'bench',enabled:true,transport:'http',url:'https://fixture.invalid/mcp',auth:'none',allowHttp:false,timeoutSeconds:2,recall:{...defaultMcpRecallSettings(),mode}});
 let calls=0,requestBytes=0,estimatedTokens=0,emittedBytes=0,rounds=0,checkpointBytes=0;
 const sizeCheckpoints=()=>db.query<{n:number},[]>(`SELECT coalesce(sum(octet_length(r.content)),0) n FROM document_revisions r JOIN documents d ON d.id=r.document_id WHERE json_extract(d.record,'$.kind') IN ('pi.codemode.run','pi.codemode.journal')`).get()!.n;
 const client={async callTool(name:string){assert.equal(name,'records_0');calls++;return {content:[{type:'text',text:json}],structuredContent:data};}} as unknown as McpClient;
 const registry=createRegistry(),models=createModels(),faux=fauxProvider({tokensPerSecond:1_000_000});models.setProvider(faux.provider);
 const sandbox=new CodemodeSandbox();let harness:Harness|undefined;
 registry.install(defineExtension({name:'fixture.benchmark',tools:[createMcpCodemodeTool(sandbox)],hooks:[hook(ToolTask,{afterTool(call){if(call.name==='codemode')checkpointBytes=Math.max(checkpointBytes,sizeCheckpoints());}})]}));
 registry.install(mcpToolsExtension(config,catalog(count),async()=>client));
 registry.install(createMcpRecallExtension({harness:()=>harness!,connections:connectionStore,identityOf:async()=>({owner:'bench:agent',agentId:'agent'}),database:applicationRetainedDatabase(db,()=>{})}));
 const request=(handler:(text:string)=>ReturnType<typeof fauxAssistantMessage>)=> ({messages}:TranscriptContext)=>{
   rounds++;requestBytes+=Buffer.byteLength(JSON.stringify(messages));estimatedTokens+=messages.reduce((total,message)=>total+estimateMessageTokens(message),0);
   const tool=messages.findLast(message=>message.role==='toolResult');
   const text=tool&&tool.role==='toolResult'?contentText(tool.content):'';
   emittedBytes+=Buffer.byteLength(text);return handler(text);
 };
 const run=(code:string)=>fauxAssistantMessage([fauxToolCall('codemode',{code:`// @options: {"max_output_tokens": 16000}\n${code}`})],{stopReason:'toolUse'});
 const start=performance.now(),initialHeap=process.memoryUsage().heapUsed;let peakHeap=initialHeap;
 const sampler=setInterval(()=>{peakHeap=Math.max(peakHeap,process.memoryUsage().heapUsed);},10);
 try{
  harness=await Harness.open(await SqliteStorage.open(new BunSqliteDatabase(file)),{registry,models},context);
  const root=await harness.root(context);await root.configure({model:{provider:'faux',modelId:'faux-1'}},context);
  if(strategy==='targeted')faux.setResponses([request(()=>run(scripts.direct)),request(text=>{assert.ok(text.includes(target));return fauxAssistantMessage('Done');})]);
  else faux.setResponses([
   request(()=>run(scripts.discovery+`return found;`)),
   request(()=>run(scripts.discovery+`return await tools[picked.name]({filter:'target'});`)),
   request(text=>{
    if(mode!=='active'){assert.ok(text.includes(target));return fauxAssistantMessage('Done');}
    const id=/mcp_[a-f0-9]{64}/.exec(text)?.[0];assert.ok(id);
    // The task needs a field outside the summary. Count any required recall work.
    return run(`let offset=0, raw=''; do {const x=await tools.mcp_recall_retrieve({id:${JSON.stringify(id)},mode:'full',offset,maxChars:16000});raw+=x.text;offset=x.nextOffset;}while(offset!==null);const value=JSON.parse(raw);return {target:value.target};`);
   }),
   request(text=>{assert.ok(text.includes(target));return fauxAssistantMessage('Done');}),
  ]);
  const receipt=await(await root.submit({type:'input',content:'Find the exact target in the fixture without losing the original result.'},context)).wait(context);
  assert.equal(receipt.status,'done');assert.equal(calls,1);
  assert.ok(checkpointBytes>0,'must sample before SDK task-scoped documents retire');
  console.log(JSON.stringify({count,mode,strategy,pass,rounds,requestBytes,estimatedTokens,emittedBytes,checkpointBytes,peakHeapDelta:Math.max(peakHeap,process.memoryUsage().heapUsed)-initialHeap,ms:performance.now()-start,calls}));
 }finally{clearInterval(sampler);await harness?.close(context);await sandbox.close();db.close();rmSync(dir,{recursive:true,force:true});}
}
const repeats=Number(process.argv[2]??3);assert.ok(Number.isInteger(repeats)&&repeats>0&&repeats<=10);
for(const count of sizes)for(const mode of modeOptions)for(let pass=0;pass<repeats;pass++){
 for(const strategy of pass%2?['targeted','broad'] as const:['broad','targeted'] as const){Bun.gc(true);await measure(count,mode,strategy,pass);}
}
