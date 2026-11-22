import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempWorkspace, setEnv } from "../../helpers.js";
import { WebServerLifecycleGatewayService } from "../../../src/channels/web/server-lifecycle-gateway-service.js";
import { WebSidePromptService } from "../../../src/channels/web/agent/side-prompt-service.js";
import { handlePasskey } from "../../../src/agent-control/handlers/passkey.js";
import { handleTotp } from "../../../src/agent-control/handlers/totp.js";
import { handleLogin, handleLogout } from "../../../src/agent-control/handlers/login.js";
import { closeDatabase, getDb, initDatabase } from "../../../src/db/connection.js";
import { createWebSession } from "../../../src/db/web-sessions.js";

let ws: ReturnType<typeof createTempWorkspace>, restore: () => void;
function mode(value: "single-user" | "family-shared" | "isolated-containers") {
  writeFileSync(join(ws.workspace, ".piclaw/config.json"), JSON.stringify({ domains: { access: {
    mode: value, ...(value === "isolated-containers" ? { isolation: { component: "backend", backendId: "test", ownerUserId: "alice", gatewayUrl: "https://gateway.local", verificationKeyRef: "gateway-key" } } : {}),
  } } }));
}
beforeEach(() => {
  ws = createTempWorkspace("piclaw-alternate-ingress-");
  restore = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  mkdirSync(join(ws.workspace, ".piclaw")); mode("family-shared");
  closeDatabase(); initDatabase(); createWebSession("sentinel", "default", 3600, "totp");
});
afterEach(() => { closeDatabase(); restore(); ws.cleanup(); });

function request(path: string) { return new Request(`https://family.local${path}`, { headers: { origin: "https://family.local", cookie: "piclaw_session=sentinel", "x-piclaw-internal-secret": "secret" } }); }

test("direct and routed websocket upgrades deny multi-user mode before target preparation or owner resolution", async () => {
  for (const accessMode of ["family-shared", "isolated-containers"] as const) {
    mode(accessMode);
    let touched = 0;
    const service = new WebServerLifecycleGatewayService({
      handleRequest: async () => { touched++; return new Response("ordinary"); },
      json: (payload: unknown, status = 200) => Response.json(payload, { status }),
      webRuntimeConfig: { terminalEnabled: true },
      authGateway: { isAuthEnabled: () => { touched++; return false; }, isAuthenticated: () => true },
      terminalService: { resolveOwnerFromRequest: () => { touched++; return { token: "valid" }; } },
      vncService: { prepareTargetReference: async () => { touched++; return { ok: true }; }, resolveOwnerFromRequest: () => { touched++; return { token: "valid" }; } },
    } as any);
    const server = { upgrade: () => { touched++; return true; } } as any;
    const replies = [
      service.handleTerminalWebSocketUpgrade(request("/terminal/ws?handoff=valid"), server),
      await service.handleVncWebSocketUpgrade(request("/vnc/ws?target=private"), server),
      await service.handleFetch(request("/terminal/ws"), server),
      await service.handleFetch(request("/vnc/ws?target=private"), server),
    ];
    for (const response of replies) { expect(response?.status).toBe(403); expect(response?.headers.get("cache-control")).toBe("private, no-store"); }
    expect(touched).toBe(0);
    expect((await service.handleFetch(request("/timeline")))?.status).toBe(200); expect(touched).toBe(1);
  }
});

test("legacy factor commands deny all multi-user actions without creating cards or changing default credentials", async () => {
  for (const accessMode of ["family-shared", "isolated-containers"] as const) {
    mode(accessMode);
    for (const action of [undefined, "list", "delete", "enrol", "reset"]) {
      const passkey = await handlePasskey({} as any, { type: "passkey", action, id: "foreign" } as any);
      const totp = await handleTotp({} as any, { type: "totp", action, code: "123456" } as any);
      expect(passkey.status).toBe("error"); expect(passkey.message).toContain("Single-user");
      expect(totp.status).toBe("error"); expect(totp.message).toContain("Single-user");
    }
  }
  expect((getDb().query("SELECT count(*) n FROM web_sessions").get() as any).n).toBe(1);
  expect((getDb().query("SELECT count(*) n FROM webauthn_enrollments").get() as any).n).toBe(0);
});

test("direct provider login/logout deny multi-user modes before runtime or credential reads", async () => {
  for (const accessMode of ["family-shared", "isolated-containers"] as const) {
    mode(accessMode);
    expect((await handleLogin({} as any, {} as any, { type: "login", raw: "/login" })).status).toBe("error");
    expect((await handleLogout({} as any, {} as any, { type: "logout", provider: "openai", raw: "/logout openai" })).status).toBe("error");
  }
});

test("direct card and side-prompt services deny before parsing payload or touching source messages/models", async () => {
  // No collaborators: any source lookup, mutation or model call would fail this fixture.
  const service = new WebSidePromptService({} as any);
  for (const accessMode of ["family-shared", "isolated-containers"] as const) {
    mode(accessMode);
    for (const method of ["handleAgentSidePrompt", "handleAgentSidePromptStream"] as const) {
      const req = new Request("https://family.local/action", { method: "POST", body: "invalid JSON" });
      const response = await service[method](req);
      expect(response.status).toBe(403); expect(req.bodyUsed).toBe(false);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  }
  expect((getDb().query("SELECT count(*) n FROM web_sessions").get() as any).n).toBe(1);
});

test("single-user websocket path still delegates through legacy checks", () => {
  mode("single-user");
  const service = new WebServerLifecycleGatewayService({ webRuntimeConfig: { terminalEnabled: false }, json: (body: unknown, status: number) => Response.json(body, { status }) } as any);
  expect(service.handleTerminalWebSocketUpgrade(request("/terminal/ws"))?.status).toBe(404);
});
