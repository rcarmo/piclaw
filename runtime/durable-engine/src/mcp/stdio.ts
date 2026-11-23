// Public SDK PipeTransport port of Kintsugi b8469c29; MIT — see UPSTREAM-LICENSE.
// Piclaw's host process is already the unprivileged Agent. No shell or ambient credentials are forwarded.
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {McpClient,PipeTransport,type McpPipe,type McpPipeHandlers} from '@earendil-works/pi-mcp';
import type {McpAuthority} from './authority.ts';
import {mcpEnvironmentNameIssue} from './environment.ts';
export interface McpStdioConnection {command:string[];workdir:string;timeoutSeconds:number;env?:Record<string,string>}
export function openMcpPipe(config:McpStdioConnection,handlers:McpPipeHandlers,assertCurrent:()=>void,authority?:Pick<McpAuthority,'assertSend'>):McpPipe{
 if(process.platform==='win32')throw Error('MCP stdio requires POSIX process-group cleanup');
 if(!config.command.length||config.command.some(arg=>arg.includes('\0'))||!config.workdir.startsWith('/'))throw Error('Invalid MCP process configuration');
 const env:NodeJS.ProcessEnv={};for(const key of ['PATH','HOME','TMPDIR','TMP','TEMP','LANG','LC_ALL','TZ'])if(process.env[key]!==undefined)env[key]=process.env[key];
 for(const[key,value]of Object.entries(config.env??{})){const issue=mcpEnvironmentNameIssue(key);if(issue)throw Error(issue);if(value.includes('\0'))throw Error('Environment values must not contain NUL bytes');if(value.startsWith('keychain:'))throw Error('MCP environment references must resolve before process launch');env[key]=value;}
 assertCurrent();
 const child=spawn(config.command[0]!,config.command.slice(1),{cwd:config.workdir,env,detached:true,stdio:'pipe'}) as ChildProcessWithoutNullStreams;
 const failures:Error[]=[];let closed=false;
 const exists=()=>{if(!child.pid)return false;try{process.kill(-child.pid,0);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error;}};
 const kill=()=>{if(!child.pid)return;try{process.kill(-child.pid,'SIGKILL');}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}};
 let joining=false,pipesClosed=false;
 const ended=Promise.withResolvers<void>();
 const join=async()=>{
  if(joining)return;
  joining=true;
  try{
   // `close` can wait forever for inherited pipes. Start the bounded join on
   // parent exit or forced disposal; a live group is never a successful close.
   const deadline=performance.now()+2000;
   while((!pipesClosed||exists())&&performance.now()<deadline)await new Promise(r=>setTimeout(r,10));
   if(!pipesClosed||exists())throw Error('MCP process group or pipe cleanup is uncertain');
   if(failures.length)throw Error('MCP process pipe cleanup failed');
   if(!closed&&(child.signalCode!==null||child.exitCode!==0))throw Error('MCP process exited unsuccessfully');
   ended.resolve();
  }catch(error){child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();ended.reject(error);}
 };
 child.on('error',error=>{failures.push(error);if(!child.pid)ended.reject(Error('MCP process could not start'));});
 for(const stream of [child.stdin,child.stdout,child.stderr])stream.on('error',error=>failures.push(error));
 child.stdout.on('data',bytes=>handlers.onStdout(bytes));child.stderr.on('data',bytes=>handlers.onStderr(bytes));
 child.once('exit',()=>{try{kill();}catch(error){failures.push(error instanceof Error?error:Error('MCP process termination failed'));}void join();});
 child.once('close',()=>{pipesClosed=true;void join();});
 return{write(data){if(closed||child.stdin.destroyed||child.exitCode!==null||child.signalCode!==null)throw Error('MCP process is closed');assertCurrent();const rpc=JSON.parse(typeof data==='string'?data:Buffer.from(data).toString('utf8')) as {method?:string};authority?.assertSend(rpc.method);child.stdin.write(data);},closeStdin(){if(!child.stdin.destroyed&&!child.stdin.writableEnded)child.stdin.end();},close(){closed=true;try{kill();}finally{void join();}},exited:ended.promise};
}
export async function connectMcpStdio(config:McpStdioConnection,assertCurrent:()=>void,signal?:AbortSignal,authority?:McpAuthority){
 const client=new McpClient({name:'piclaw',version:'1',requestTimeoutMs:config.timeoutSeconds*1000});let pipe:McpPipe|undefined;
 const transport=new PipeTransport({open:async handlers=>{assertCurrent();return pipe=openMcpPipe(config,handlers,assertCurrent,authority);},maxMessageBytes:4*1024*1024,maxStderrBytes:16*1024,closeTimeoutMs:500});
 let closing:Promise<void>|undefined;
 const close=()=>closing??=(async()=>{const body=async()=>{const results=await Promise.allSettled([client.close(),...(pipe?[pipe.exited]:[])]);const errors=results.filter((r):r is PromiseRejectedResult=>r.status==='rejected');if(errors.length)throw new AggregateError(errors.map(r=>r.reason),'MCP stdio cleanup uncertain');};await(authority?authority.cleanup(body):body());})();
 const abort=()=>{void close().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
 try{signal?.throwIfAborted();await client.connect(transport);return{client,tools:client.serverCapabilities?.tools?await client.listTools({signal}):[],close};}
 catch(error){try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'MCP stdio startup cleanup uncertain');}throw error;}
 finally{signal?.removeEventListener('abort',abort);if(signal?.aborted)await close();}
}
