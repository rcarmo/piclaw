import { expect, test } from "bun:test";
import { handleAgentDebugRequest } from "../../../../src/channels/web/agent/agent-debug.js";

test("native debug never substitutes private extension/resource-loader provenance", async () => {
  let legacyReads=0;
  const pool:any={ getDurableSessionMetadata:async()=>({backend:"durable",conversationId:7,extensions:["native-extension"],tools:[{name:"native_tool",description:"Native tool"}]}) };
  Object.defineProperty(pool,"getSessionForIntrospection",{get(){legacyReads++;throw Error("Private legacy introspection forbidden");}});
  const response=await handleAgentDebugRequest(new Request("http://fixture/agent/debug"),{defaultChatJid:"web:default",agentPool:pool,json:(value,status=200)=>Response.json(value,{status})});
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({chatJid:"web:default",backend:"durable",conversationId:7,extensions:[{name:"native-extension",sourceInfo:null}],tools:[{name:"native_tool",description:"Native tool",sourceInfo:null}],commands:[],promptTemplates:[],skills:[],unavailable:["legacy-extension-provenance","legacy-extension-commands","prompt-templates","skills"]});
  expect(legacyReads).toBe(0);
});

test("missing native metadata reader returns unavailable, not fabricated empty legacy resources", async () => {
  const response=await handleAgentDebugRequest(new Request("http://fixture/agent/debug"),{defaultChatJid:"web:default",agentPool:{getSessionForIntrospection:()=>{throw Error("Legacy must not open");}} as any,json:(value,status=200)=>Response.json(value,{status})});
  expect(response.status).toBe(503);expect(await response.json()).toEqual({error:"Native debug metadata unavailable"});
});

test("durable debug uses actual native metadata without constructing a legacy session", async () => {
  const ctx: any = { defaultChatJid: "web:default", agentPool: {
    async getDurableSessionMetadata(chat: string) { expect(chat).toBe("web:native"); return { backend: "durable", conversationId: 42,
      extensions: ["app.host-builtins"], tools: [{ name: "read", description: "Read a file" }] }; },
    async getSessionForIntrospection() { throw Error("Legacy hydration forbidden"); },
  }, json: (payload: unknown, status = 200) => Response.json(payload, { status }) };
  const response = await handleAgentDebugRequest(new Request("http://local/agent/debug?chat_jid=web:native"), ctx);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ backend: "durable", conversationId: 42, extensions: [{ name: "app.host-builtins", sourceInfo: null }],
    tools: [{ name: "read", description: "Read a file", sourceInfo: null }], commands: [], unavailable: ["legacy-extension-provenance", "legacy-extension-commands", "prompt-templates", "skills"] });
});

test("unbound durable debug returns404 without legacy fallback", async () => {
  const ctx: any = { defaultChatJid: "web:default", agentPool: { getDurableSessionMetadata: async () => null,
    getSessionForIntrospection: async () => { throw Error("Legacy fallback forbidden"); } },
    json: (payload: unknown, status = 200) => Response.json(payload, { status }) };
  expect((await handleAgentDebugRequest(new Request("http://local/agent/debug"), ctx)).status).toBe(404);
});

test("native debug metadata failure returns a sanitised unavailable response", async () => {
  const response = await handleAgentDebugRequest(new Request("http://fixture/agent/debug"), {
    defaultChatJid: "web:default", json: (value: unknown, status = 200) => Response.json(value, { status }),
    agentPool: { getDurableSessionMetadata: async () => { throw Error("private native storage detail"); },
      getSessionForIntrospection: async () => { throw Error("Legacy fallback forbidden"); } },
  } as any);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "Native debug metadata unavailable" });
});
