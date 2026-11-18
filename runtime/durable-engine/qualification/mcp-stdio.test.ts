import {afterEach,expect,test} from 'bun:test';
import {mkdtempSync,readFileSync,rmSync,existsSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {BACKGROUND_CONTEXT} from '@earendil-works/chord/context';
import type {ToolExecutionApi} from '@earendil-works/pi-durable';
import {connectMcpStdio} from '../src/mcp/stdio.ts';
import {createMcpAuthority} from '../src/mcp/authority.ts';
const closes:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const close of closes.splice(0).reverse())await close();});
function fixture(){const dir=mkdtempSync(join(tmpdir(),'mcp-pipe-')),marker=join(dir,'calls'),pid=join(dir,'pid');closes.push(async()=>rmSync(dir,{recursive:true,force:true}));return{dir,marker,pid,config:{command:[process.execPath,resolve(import.meta.dir,'../../../qualification/native/mcp-stdio-fixture.ts'),marker,pid],workdir:dir,timeoutSeconds:2}};}
test('public SDK pipe transport executes framed MCP and joins the owned process',async()=>{const f=fixture(),c=await connectMcpStdio(f.config,()=>{});closes.push(c.close);expect(c.tools.map(t=>t.name)).toEqual(['echo']);const response=await c.client.callTool('echo',{message:'PIPE_OK'});expect(response.content).toEqual([{type:'text',text:'PIPE_OK'}]);expect(readFileSync(f.marker,'utf8')).toBe('call\n');await c.close();const pid=Number(readFileSync(f.pid,'utf8'));expect(()=>process.kill(pid,0)).toThrow();});
test('pipe writes enforce current invocation source immediately before stdin I/O',async()=>{const f=fixture();let source=true;const authority=createMcpAuthority({assertOwner(){},assertConnection(){},captureSource:async()=>()=>{if(!source)throw Error('source revoked');}});const c=await connectMcpStdio(f.config,()=>{},undefined,authority);closes.push(c.close);await expect(c.client.callTool('echo',{message:'FORBIDDEN'})).rejects.toThrow();expect(existsSync(f.marker)).toBe(false);await authority.invoke({} as ToolExecutionApi,BACKGROUND_CONTEXT,()=>c.client.callTool('echo',{message:'ALLOWED'}));source=false;await expect(authority.invoke({} as ToolExecutionApi,BACKGROUND_CONTEXT,()=>c.client.callTool('echo',{message:'FORBIDDEN'}))).rejects.toThrow();expect(readFileSync(f.marker,'utf8')).toBe('call\n');});
test('stdio does not inherit ambient host credentials',async()=>{
 const f=fixture(),script=join(f.dir,'env-server.ts'),previous=process.env.MCP_AMBIENT_CANARY;process.env.MCP_AMBIENT_CANARY='SYNTHETIC_OMIT';
 try{
  writeFileSync(script,`import{createInterface}from'node:readline';for await(const line of createInterface({input:process.stdin})){const r=JSON.parse(line);if(r.id===undefined)continue;const result=r.method==='initialize'?{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'env',version:'1'}}:r.method==='tools/list'?{tools:[{name:'env',inputSchema:{type:'object',properties:{}}}]}:{content:[{type:'text',text:JSON.stringify({ambient:!!process.env.MCP_AMBIENT_CANARY,path:!!process.env.PATH,explicit:process.env.MCP_EXPLICIT_CANARY})}]};console.log(JSON.stringify({jsonrpc:'2.0',id:r.id,result}));}`);
  const c=await connectMcpStdio({...f.config,command:[process.execPath,script],env:{MCP_EXPLICIT_CANARY:'allowed'}},()=>{});closes.push(c.close);
  const r=await c.client.callTool('env',{});expect(r.content).toEqual([{type:'text',text:JSON.stringify({ambient:false,path:true,explicit:'allowed'})}]);
 }finally{if(previous===undefined)delete process.env.MCP_AMBIENT_CANARY;else process.env.MCP_AMBIENT_CANARY=previous;}
});
test('stdio startup errors are visible and do not leave a process',async()=>{await expect(connectMcpStdio({command:['/no-such-owned-mcp-fixture'],workdir:tmpdir(),timeoutSeconds:1},()=>{})).rejects.toThrow();});
test('unresolved keychain env references are rejected before process launch',async()=>{const f=fixture();await expect(connectMcpStdio({...f.config,env:{TOKEN:'keychain:fixture/token'}},()=>{})).rejects.toThrow('resolve');expect(existsSync(f.pid)).toBe(false);});

test('parent exit never exempts a server descendant from process-group cleanup',async()=>{
 const f=fixture(),script=join(f.dir,'descendant-server.ts'),childPid=join(f.dir,'child-pid');
 writeFileSync(script,`import{createInterface}from'node:readline';import{writeFileSync}from'node:fs';const child=Bun.spawn([process.execPath,'-e','setInterval(()=>{},1000)'],{stdin:'ignore',stdout:'ignore',stderr:'ignore'});writeFileSync(${JSON.stringify(childPid)},String(child.pid));for await(const line of createInterface({input:process.stdin})){const r=JSON.parse(line);if(r.id===undefined)continue;const result=r.method==='initialize'?{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'tree',version:'1'}}:{tools:[]};console.log(JSON.stringify({jsonrpc:'2.0',id:r.id,result}));}process.exit(0);`);
 const c=await connectMcpStdio({...f.config,command:[process.execPath,script]},()=>{});closes.push(c.close);const pid=Number(readFileSync(childPid,'utf8'));await c.close();expect(()=>process.kill(pid,0)).toThrow();
});
