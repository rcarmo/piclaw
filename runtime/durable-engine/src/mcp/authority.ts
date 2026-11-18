import {AsyncLocalStorage} from 'node:async_hooks';
import type {Context} from '@earendil-works/chord/context';
import type {ToolExecutionApi} from '@earendil-works/pi-durable';
type Invocation={kind:'call';check():void}|{kind:'cleanup'};
/** Invocation-local effect fences around the public SDK transport; the SDK remains the executor. */
export function createMcpAuthority(options:{assertOwner():void;assertConnection():void;captureSource(api:ToolExecutionApi):Promise<()=>void>}){
 const scopes=new AsyncLocalStorage<Invocation>();
 const metadata=new Set(['initialize','notifications/initialized','ping','tools/list','resources/list','resources/templates/list']);
 return{
  async invoke<T>(api:ToolExecutionApi,context:Context,body:()=>Promise<T>):Promise<T>{
   options.assertOwner();options.assertConnection();context.abortSignal?.throwIfAborted();
   const source=await options.captureSource(api);
   const check=()=>{options.assertOwner();options.assertConnection();context.abortSignal?.throwIfAborted();source();};
   check();return scopes.run({kind:'call',check},async()=>{const result=await body();check();return result;});
  },
  /** Run only the existing client's disposal under an explicit bounded cleanup grant. */
  cleanup<T>(body:()=>Promise<T>):Promise<T>{options.assertOwner();return scopes.run({kind:'cleanup'},body);},
  /** Called immediately before each physical fetch/stdin write, after any awaited preparation. */
  assertSend(method:string|undefined,httpMethod='POST'){
   options.assertOwner();const scope=scopes.getStore();
   if(scope?.kind==='cleanup'){
    if(httpMethod==='DELETE'||method==='notifications/cancelled')return;
    throw Error('MCP cleanup cannot invoke a tool or read a resource');
   }
   options.assertConnection();
   if(scope?.kind==='call'){scope.check();return;}
   if(httpMethod==='GET'||method!==undefined&&metadata.has(method))return;
   throw Error('MCP invocation source authority is required');
  },
 };
}
export type McpAuthority=ReturnType<typeof createMcpAuthority>;
