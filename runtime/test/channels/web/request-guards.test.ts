import { afterEach, describe, expect, test } from "bun:test";
import {withAddonLocalRequest} from '../../../src/addons/local-context.js';
import type {AuthenticatedPrincipal} from '../../../src/core/access-types.js';

import { getRouteFlags } from "../../../src/channels/web/http/route-flags.js";
import { getDataRateLimitRule } from "../../../src/channels/web/http/rate-limit-rules.js";
import { enforceRequestGuards } from "../../../src/channels/web/http/request-guards.js";
import { resetRateLimiterStateForTests } from "../../../src/channels/web/http/rate-limit.js";
import { buildRouteFlags } from "./helpers/route-flags.js";

afterEach(() => {
  resetRateLimiterStateForTests();
});

function createChannel(overrides: {
  authGateway?: Partial<{
    isAuthEnabled(): boolean;
    isInternalSecretEnabled(): boolean;
    verifyInternalSecret(req: Request): boolean;
    isAuthenticated(req: Request): boolean;
    getPrincipal(req:Request,refresh?:boolean):AuthenticatedPrincipal|null;
  }>;
} = {}): any {
  return {
    authGateway: {
      isAuthEnabled: () => true,
      isInternalSecretEnabled: () => true,
      verifyInternalSecret: () => false,
      isAuthenticated: () => true,
      ...overrides.authGateway,
    },
    endpointContexts: {
      auth: () => ({}) as any,
    },
    json: (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status }),
  };
}

describe("request guards", () => {
  test("blocks internal routes without the internal secret", async () => {
    const response = await enforceRequestGuards(
      createChannel(),
      new Request("https://example.com/internal/post", { method: "POST" }),
      "/internal/post",
      buildRouteFlags({ isInternalPost: true, isMutating: true }),
    );

    expect(response?.status).toBe(401);
    expect(await response?.json()).toEqual({ error: "Unauthorized" });
  });

  test("redirects unauthenticated GET requests to login", async () => {
    const response = await enforceRequestGuards(
      createChannel({
        authGateway: {
          isAuthenticated: () => false,
          isInternalSecretEnabled: () => false,
        },
      }),
      new Request("https://example.com/thread/1", { method: "GET" }),
      "/thread/1",
      buildRouteFlags({ isGetOrHead: true }),
    );

    expect(response?.status).toBe(302);
    expect(response?.headers.get("location")).toBe("/login");
  });

  test("MCP read and preview share the enforced rate bucket", async () => {
    const path = "/agent/settings/mcp";
    const req = new Request("https://example.com" + path);
    const limit = getDataRateLimitRule("GET", path)!.limit;
    const channel = createChannel({ authGateway: { isInternalSecretEnabled: () => false } });
    for (let i = 0; i < limit; i++) expect(await enforceRequestGuards(channel, req, path, getRouteFlags(req, path))).toBeNull();
    expect((await enforceRequestGuards(channel, req, path, getRouteFlags(req, path)))?.status).toBe(429);
    const preview = new Request("https://example.com" + path + "/preview", { method: "POST", headers: { origin: "https://example.com", host: "example.com" } });
    expect((await enforceRequestGuards(channel, preview, path + "/preview", getRouteFlags(preview, path + "/preview")))?.status).toBe(429);
    const apply = new Request("https://example.com" + path + "/apply", { method: "POST", headers: { origin: "https://example.com", host: "example.com" } });
    expect((await enforceRequestGuards(channel, apply, path + "/apply", getRouteFlags(apply, path + "/apply")))?.status).toBe(429);
  });

  test("rejects mutating requests that fail the CSRF origin check", async () => {
    const response = await enforceRequestGuards(
      createChannel({
        authGateway: {
          isInternalSecretEnabled: () => false,
        },
      }),
      new Request("https://example.com/post", {
        method: "POST",
        headers: {
          origin: "https://evil.example.com",
          host: "example.com",
        },
      }),
      "/post",
      buildRouteFlags({ isMutating: true }),
    );

    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual({ error: "Origin not allowed" });
  });
});

test('large media upload route is authenticated, CSRF guarded and chunk-rate limited', async () => {
  const path='/media/upload-chunk';const req=new Request('https://example.com'+path,{method:'POST',headers:{origin:'https://example.com',host:'example.com'}});
  const flags=getRouteFlags(req,path);
  expect((await enforceRequestGuards(createChannel({authGateway:{isAuthenticated:()=>false}}),req,path,flags))?.status).toBe(401);
  const hostile=new Request('https://example.com'+path,{method:'POST',headers:{origin:'https://evil.test',host:'example.com'}});
  expect((await enforceRequestGuards(createChannel(),hostile,path,getRouteFlags(hostile,path)))?.status).toBe(403);
  expect(await enforceRequestGuards(createChannel(),req,path,flags)).toBeNull();
  expect(getDataRateLimitRule('POST',path)).toMatchObject({bucket:'data/media_upload_chunk',limit:240});
});

const operator:AuthenticatedPrincipal={kind:'local',userId:'default',username:'default',displayName:'Fixture',role:'admin',mode:'single-user',homeChatJid:'web:default',authentication:{method:'local',sessionId:null,expiresAt:null}};
for(const path of ['/agent/settings/mcp','/agent/settings/mcp/oauth/callback','/agent/addons/api/token-optimizer/config'])test('real request guard admits the current operator for '+path,async()=>{
 let principal:AuthenticatedPrincipal=operator;const channel=createChannel({authGateway:{isInternalSecretEnabled:()=>false,getPrincipal:()=>principal}}),request=new Request('https://example.com'+path);
 expect(await enforceRequestGuards(channel,request,path,getRouteFlags(request,path))).toBeNull();
 await withAddonLocalRequest(request,async context=>{expect(context?.kind).toBe('operator');expect(context?.ownerId).toBe('default');principal={...operator,role:'member'};await expect(context!.listTargets()).rejects.toThrow('unavailable');});
 await withAddonLocalRequest(request,async context=>expect(context).toBeNull());
});
test('native MCP operator admission cannot be borrowed by adjacent paths, internal access or failed CSRF',async()=>{
 for(const path of ['/agent/settings/mcp-other','/agent/settings/mcpx']){const request=new Request('https://example.com'+path),channel=createChannel({authGateway:{getPrincipal:()=>operator}});expect(await enforceRequestGuards(channel,request,path,getRouteFlags(request,path))).toBeNull();await withAddonLocalRequest(request,async context=>expect(context).toBeNull());}
 const path='/agent/settings/mcp',internal=new Request('https://example.com'+path),channel=createChannel({authGateway:{verifyInternalSecret:()=>true,getPrincipal:()=>operator}});expect(await enforceRequestGuards(channel,internal,path,getRouteFlags(internal,path))).toBeNull();await withAddonLocalRequest(internal,async context=>expect(context).toBeNull());
 const hostile=new Request('https://example.com'+path,{method:'POST',headers:{origin:'https://evil.example.com',host:'example.com'}});expect((await enforceRequestGuards(createChannel({authGateway:{getPrincipal:()=>operator}}),hostile,path,getRouteFlags(hostile,path)))?.status).toBe(403);await withAddonLocalRequest(hostile,async context=>expect(context).toBeNull());
});
