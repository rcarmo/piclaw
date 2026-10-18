import {expect,test} from 'bun:test';
import {withTempWorkspaceEnv} from '../helpers.js';
for(const mode of ['normal','disabled','excluded','permission','error','timeout','cancel'])test(`Parallel preset through real PiClaw session: ${mode}`,async()=>{
 await withTempWorkspaceEnv('parallel-mcp-',{PARALLEL_API_KEY:undefined,MCP_DIRECT_TOOLS:undefined},async ws=>{
  const child=Bun.spawn([process.execPath,'--no-env-file',new URL('fixtures/mcp-parallel-search-runtime.ts',import.meta.url).pathname,mode],{env:{...process.env,PI_OFFLINE:'1',PI_SKIP_VERSION_CHECK:'1',PI_TELEMETRY:'0',OTEL_SDK_DISABLED:'true'},stdin:'ignore',stdout:'pipe',stderr:'pipe'});
  const timer=setTimeout(()=>child.kill('SIGKILL'),30000);
  try{const[code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);expect(code,`${err}\n${out}`).toBe(0);expect(out).toContain(`"mode":"${mode}"`);expect(out).toContain('"status":"pass"');}
  finally{clearTimeout(timer);if(child.exitCode===null)child.kill('SIGKILL');await child.exited;}
 });
},35000);
