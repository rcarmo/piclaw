import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

import { createTempWorkspace, setEnv } from "../../helpers.js";
import { handleAgentRoutes } from "../../../src/channels/web/http/dispatch-agent.js";
import { initDatabase } from "../../../src/db.js";
import * as definitions from '../../../src/agent-control/provider-defs.js';
import { createRealTestModelServices } from '../../model-services-fixture.js';

let restoreEnv: (() => void) | null = null;
let cleanupWorkspace: (() => void) | null = null;

afterEach(() => {
  restoreEnv?.();
  cleanupWorkspace?.();
  restoreEnv = null;
  cleanupWorkspace = null;
});

describe("dispatch-agent settings-data providers", () => {
  test("marks custom model providers as configured from models.json", async () => {
    const ws = createTempWorkspace("piclaw-dispatch-agent-settings-");
    cleanupWorkspace = ws.cleanup;
    const piAgentDir = join(ws.workspace, ".pi-agent-test");
    mkdirSync(piAgentDir, { recursive: true });
    writeFileSync(join(piAgentDir, "models.json"), JSON.stringify({
      providers: {
        "opencode-zen": {
          baseUrl: "https://opencode.ai/zen",
          api: "openai-completions",
          apiKey: "oc-test",
          models: [{ id: "big-pickle" }],
        },
      },
    }, null, 2));

    restoreEnv = setEnv({
      PICLAW_WORKSPACE: ws.workspace,
      PICLAW_STORE: ws.store,
      PICLAW_DATA: ws.data,
      PICLAW_PI_AGENT_DIR: piAgentDir,
      PICLAW_DB_IN_MEMORY: "1",
    });
    initDatabase();

    const channel = {
      json: (body: unknown, status = 200) => new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    } as any;

    const url = new URL("http://localhost/agent/settings-data");
    const response = await handleAgentRoutes(channel, new Request(url), "/agent/settings-data", url);
    expect(response).not.toBeNull();

    const payload = await response!.json() as { providers?: Array<Record<string, unknown>> };
    const provider = payload.providers?.find((entry) => entry.id === "opencode-zen");
    expect(provider).toBeDefined();
    expect(provider?.configured).toBe(true);
    expect(provider?.authType).toBe("custom");
    expect(provider?.hasApiKey).toBe(false);
    expect(provider?.isCustom).toBe(true);
  });
});

async function settingsFixture(pool: any, auth: Record<string,unknown> = {}) {
  const ws=createTempWorkspace('settings-provider-discovery-');cleanupWorkspace=ws.cleanup;
  const agentDir=join(ws.workspace,'.pi-agent-test');mkdirSync(agentDir,{recursive:true});
  writeFileSync(join(agentDir,'auth.json'),JSON.stringify(auth));
  restoreEnv=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data,PICLAW_PI_AGENT_DIR:agentDir,PICLAW_DB_IN_MEMORY:'1'});initDatabase();
  return {agentDir, async read(agentPool=pool){const url=new URL('http://localhost/agent/settings-data');const response=await handleAgentRoutes({agentPool,json:(body:unknown,status=200)=>Response.json(body,{status})} as any,new Request(url),url.pathname,url);expect(response!.status).toBe(200);return response!.json() as Promise<{providers:Record<string,any>[]}>;}};
}

test('Settings discovers an extension-only runtime provider using the same actual registry/runtime identities',async()=>{
  const id='fixture-extension-settings',key='synthetic-key-not-in-the-response';
  const f=await settingsFixture(undefined,{[id]:{type:'api_key',key}});
  const {modelRuntime,modelRegistry}=await createRealTestModelServices(f.agentDir);
  modelRuntime.registerNativeProvider({id,name:'Fixture Extension',getModels:()=>[],auth:{apiKey:{name:'Fixture',login:async()=>({type:'api_key',key})}},
    stream(){throw Error('Settings must not execute a provider');},streamSimple(){throw Error('Settings must not execute a provider');}});
  const before=definitions.getProviderDefs();const calls=spyOn(definitions,'getProviderDefs');
  try{
    const payload=await f.read({modelRuntime,getModelRegistry:()=>modelRegistry});
    expect(calls.mock.calls.some(args=>args[0]===modelRegistry&&args[1]===modelRuntime)).toBe(true);
    expect(payload.providers.find(provider=>provider.id===id)).toMatchObject({name:'Fixture Extension',configured:true,authType:'api_key',hasApiKey:true});
    expect(JSON.stringify(payload)).not.toContain(key);
    expect(payload.providers.slice(0,before.length).map(({id,name,hasOAuth,hasApiKey})=>({id,name,hasOAuth,hasApiKey}))).toEqual(before.map(({id,name,hasOAuth,hasApiKey})=>({id,name,hasOAuth,hasApiKey})));
  }finally{calls.mockRestore();}
});

for(const mode of ['missing','registry-throws','registry-read-throws','runtime-throws'] as const)test(`Settings retains the exact static provider list during ${mode}`,async()=>{
  const f=await settingsFixture(undefined),before=definitions.getProviderDefs();
  const pool=mode==='missing'?undefined:mode==='registry-throws'?{getModelRegistry(){throw Error('Registry not ready');}}:mode==='registry-read-throws'?{getModelRegistry:()=>({getAll(){throw Error('Registry refreshing');}})}:{modelRuntime:{getProviders(){throw Error('Runtime refreshing');}}};
  const payload=await f.read(pool);
  expect(payload.providers.map(({id,name,hasOAuth,hasApiKey})=>({id,name,hasOAuth,hasApiKey}))).toEqual(before.map(({id,name,hasOAuth,hasApiKey})=>({id,name,hasOAuth,hasApiKey})));
});
