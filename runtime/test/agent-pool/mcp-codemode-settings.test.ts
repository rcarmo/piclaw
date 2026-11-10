import {expect,test} from "bun:test";
import {join} from "node:path";
import {createTempWorkspace} from "../helpers.js";
test("MCP codemode current/new sessions use the actual public Pi 1.5.2 script and nested tool pipeline",async()=>{
  const ws=createTempWorkspace("mcp-settings-runtime-");
  const child=Bun.spawn([process.execPath,"--no-env-file","--preload",join(import.meta.dir,"fixtures/earendil-120-offline-guard.ts"),join(import.meta.dir,"fixtures/mcp-codemode-settings.ts")],{cwd:ws.workspace,env:{PATH:process.env.PATH,HOME:"/nonexistent",PICLAW_WORKSPACE:ws.workspace,PICLAW_DB_IN_MEMORY:"1",PI_OFFLINE:"1",PI_TELEMETRY:"0",OTEL_SDK_DISABLED:"true"},stdin:"ignore",stdout:"pipe",stderr:"pipe"});
  const timer=setTimeout(()=>child.kill("SIGKILL"),20000);
  try{const [exit,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);expect(exit,stderr||stdout).toBe(0);expect(stderr).toBe("");expect(JSON.parse(stdout.trim().split("\n").at(-1)!)).toMatchObject({version:"1.5.2",currentAndNewSessions:true,scriptCalls:2,nestedPolicy:true,modelsDisabled:true,offFailClosed:true,historyPreserved:true,networkAttempts:0,childProcessAttempts:0});}
  finally{clearTimeout(timer);if(child.exitCode===null)child.kill("SIGKILL");await child.exited;ws.cleanup();}
},25000);
