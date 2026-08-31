import { describe, expect, test } from "bun:test";

import {
  WebTerminalVncHttpService,
  type WebTerminalVncHttpServiceDeps,
} from "../../../src/channels/web/terminal-vnc-http-service.js";

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`http://localhost${path}`, {
    headers: {
      origin: "http://localhost",
      host: "localhost",
      ...(init.headers || {}),
    },
    ...init,
  });
}

function createFixture(overrides: Partial<WebTerminalVncHttpServiceDeps> = {}) {
  const state = {
    authChecks: [] as string[],
    terminalResolveCalls: [] as boolean[],
    terminalSessionInfoOwners: [] as Array<{ token: string; userId: string }>,
    terminalHandoffCalls: [] as boolean[],
    vncPrepareCalls: [] as string[],
    vncResolveCalls: [] as string[],
    vncSessionInfoCalls: [] as Array<string | null | undefined>,
    vncHandoffCalls: [] as Array<{ targetId: string; allowUnauthenticated: boolean }>,
    csrfChecks: [] as string[],
  };

  const terminalOwner = { kind: "terminal" as const, token: "terminal-token", userId: "user-1" };
  const vncTarget = { id: "desk", label: "Desk", host: "10.0.0.1", port: 5901 };
  const handoff = { token: "handoff-1", expires_at: "2026-03-27T00:00:00.000Z" };

  const deps: WebTerminalVncHttpServiceDeps = {
    webRuntimeConfig: {
      terminalEnabled: true,
    },
    json,
    authGateway: {
      isAuthEnabled: () => {
        state.authChecks.push("enabled");
        return false;
      },
      isAuthenticated: () => {
        state.authChecks.push("authenticated");
        return true;
      },
    },
    terminalService: {
      resolveOwnerFromRequest: (_req, allowUnauthenticated = false) => {
        state.terminalResolveCalls.push(allowUnauthenticated);
        return terminalOwner;
      },
      getSessionInfo: (owner) => {
        state.terminalSessionInfoOwners.push({ token: owner.token, userId: owner.userId });
        return { enabled: true, transport: "websocket", ws_path: "/terminal/ws", owner: owner.token };
      },
      createHandoffFromRequest: (_req, allowUnauthenticated = false) => {
        state.terminalHandoffCalls.push(allowUnauthenticated);
        return { token: "terminal-handoff-1", expires_at: "2026-03-27T00:00:00.000Z" };
      },
    },
    vncService: {
      prepareTargetReference: async (targetId) => {
        state.vncPrepareCalls.push(targetId);
        return targetId === vncTarget.id
          ? { ok: true, target: vncTarget }
          : { ok: false, error: "Unknown or disallowed VNC target", missingDependencies: [], platform: "linux" as const };
      },
      resolveTargetReference: (targetId) => {
        state.vncResolveCalls.push(targetId);
        return targetId === vncTarget.id ? vncTarget : null;
      },
      getSessionInfo: (targetId) => {
        state.vncSessionInfoCalls.push(targetId);
        return {
          enabled: true,
          transport: "websocket",
          ws_path: "/vnc/ws",
          targets: [{ id: vncTarget.id, label: vncTarget.label, readOnly: false }],
          ...(targetId ? { target: { id: targetId, label: targetId, read_only: false, direct_connect: false } } : {}),
        };
      },
      createHandoffFromRequest: (_req, targetId, allowUnauthenticated = false) => {
        state.vncHandoffCalls.push({ targetId, allowUnauthenticated });
        return targetId === vncTarget.id ? handoff : null;
      },
    },
    checkCsrfOrigin: (req) => {
      state.csrfChecks.push(new URL(req.url).pathname);
      return true;
    },
    ...overrides,
  };

  return {
    state,
    terminalOwner,
    vncTarget,
    handoff,
    service: new WebTerminalVncHttpService(deps),
  };
}

describe("web terminal/VNC HTTP service", () => {
  test("terminal session preserves auth gating and owner/session-info delegation", async () => {
    const disabled = createFixture({
      webRuntimeConfig: { terminalEnabled: false },
    });
    const disabledResponse = disabled.service.handleTerminalSession(createRequest("/terminal/session"));
    expect(disabledResponse.status).toBe(200);
    expect(await disabledResponse.json()).toEqual({ enabled: false, error: "Web terminal is disabled." });

    const unauthenticated = createFixture({
      authGateway: {
        isAuthEnabled: () => true,
        isAuthenticated: () => false,
      },
    });
    expect(unauthenticated.service.handleTerminalSession(createRequest("/terminal/session")).status).toBe(401);
    expect(unauthenticated.state.terminalResolveCalls).toEqual([]);

    const fixture = createFixture();
    const response = fixture.service.handleTerminalSession(createRequest("/terminal/session"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: true,
      transport: "websocket",
      ws_path: "/terminal/ws",
      owner: "terminal-token",
    });
    expect(fixture.state.authChecks).toEqual(["enabled"]);
    expect(fixture.state.terminalResolveCalls).toEqual([true]);
    expect(fixture.state.terminalSessionInfoOwners).toEqual([{ token: "terminal-token", userId: "user-1" }]);
  });

  test("terminal handoff preserves auth, CSRF, and live-session transfer behavior", async () => {
    const disabled = createFixture({
      webRuntimeConfig: { terminalEnabled: false },
    });
    expect((await disabled.service.handleTerminalHandoff(createRequest("/terminal/handoff", { method: "POST" }))).status).toBe(404);

    const unauthenticated = createFixture({
      authGateway: {
        isAuthEnabled: () => true,
        isAuthenticated: () => false,
      },
    });
    expect((await unauthenticated.service.handleTerminalHandoff(createRequest("/terminal/handoff", { method: "POST" }))).status).toBe(401);
    expect(unauthenticated.state.csrfChecks).toEqual([]);

    const csrfBlocked = createFixture({
      checkCsrfOrigin: () => false,
    });
    expect((await csrfBlocked.service.handleTerminalHandoff(createRequest("/terminal/handoff", { method: "POST" }))).status).toBe(403);
    expect(csrfBlocked.state.terminalHandoffCalls).toEqual([]);

    const noLiveSession = createFixture({
      terminalService: {
        resolveOwnerFromRequest: (_req, allowUnauthenticated = false) => {
          noLiveSession.state.terminalResolveCalls.push(allowUnauthenticated);
          return noLiveSession.terminalOwner;
        },
        getSessionInfo: (owner) => ({ enabled: true, transport: "websocket", ws_path: "/terminal/ws", owner: owner.token }),
        createHandoffFromRequest: (_req, allowUnauthenticated = false) => {
          noLiveSession.state.terminalHandoffCalls.push(allowUnauthenticated);
          return null;
        },
      },
    });
    expect((await noLiveSession.service.handleTerminalHandoff(createRequest("/terminal/handoff", { method: "POST" }))).status).toBe(409);
    expect(noLiveSession.state.terminalHandoffCalls).toEqual([true]);

    const fixture = createFixture();
    const response = await fixture.service.handleTerminalHandoff(createRequest("/terminal/handoff", { method: "POST" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      handoff: { token: "terminal-handoff-1", expires_at: "2026-03-27T00:00:00.000Z" },
    });
    expect(fixture.state.authChecks).toEqual(["enabled"]);
    expect(fixture.state.csrfChecks).toEqual(["/terminal/handoff"]);
    expect(fixture.state.terminalHandoffCalls).toEqual([true]);
  });

  test("VNC session preserves auth gating, target validation, and response shaping", async () => {
    const unauthenticated = createFixture({
      authGateway: {
        isAuthEnabled: () => true,
        isAuthenticated: () => false,
      },
    });
    expect((await unauthenticated.service.handleVncSession(createRequest("/vnc/session?target=desk"))).status).toBe(401);
    expect(unauthenticated.state.vncPrepareCalls).toEqual([]);
    expect(unauthenticated.state.vncResolveCalls).toEqual([]);

    const unknownTarget = createFixture();
    const unknownResponse = await unknownTarget.service.handleVncSession(createRequest("/vnc/session?target=unknown"));
    expect(unknownResponse.status).toBe(404);
    expect(await unknownResponse.json()).toEqual({
      error: "Unknown or disallowed VNC target",
      enabled: true,
      transport: "websocket",
      ws_path: "/vnc/ws",
      targets: [{ id: "desk", label: "Desk", readOnly: false }],
    });
    expect(unknownTarget.state.vncPrepareCalls).toEqual(["unknown"]);
    expect(unknownTarget.state.vncResolveCalls).toEqual([]);
    expect(unknownTarget.state.vncSessionInfoCalls).toEqual([undefined]);

    const fixture = createFixture();
    const response = await fixture.service.handleVncSession(createRequest("/vnc/session?target=desk"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: true,
      transport: "websocket",
      ws_path: "/vnc/ws",
      targets: [{ id: "desk", label: "Desk", readOnly: false }],
      target: { id: "desk", label: "desk", read_only: false, direct_connect: false },
    });
    expect(fixture.state.authChecks).toEqual(["enabled"]);
    expect(fixture.state.vncPrepareCalls).toEqual(["desk"]);
    expect(fixture.state.vncResolveCalls).toEqual([]);
    expect(fixture.state.vncSessionInfoCalls).toEqual(["desk"]);
  });

  test("managed CDP browser session returns actionable diagnostics after authentication", async () => {
    const fixture = createFixture({
      vncService: {
        prepareTargetReference: async (targetId) => {
          fixture.state.vncPrepareCalls.push(targetId);
          return {
            ok: false,
            error: "Managed CDP browser view is unavailable. Missing: x11vnc, xauth, Chromium, Chrome, or Edge. Run /skill:cdp-browser-vnc-setup for setup and bring-your-own guidance.",
            missingDependencies: ["x11vnc", "xauth", "Chromium, Chrome, or Edge"],
            platform: "linux" as const,
          };
        },
        resolveTargetReference: () => null,
        getSessionInfo: () => ({ enabled: false, transport: "websocket", ws_path: "/vnc/ws", targets: [] }),
        createHandoffFromRequest: () => null,
      },
    });

    const response = await fixture.service.handleVncSession(createRequest("/vnc/session?target=cdp-browser"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Managed CDP browser view is unavailable. Missing: x11vnc, xauth, Chromium, Chrome, or Edge. Run /skill:cdp-browser-vnc-setup for setup and bring-your-own guidance.",
      missing_dependencies: ["x11vnc", "xauth", "Chromium, Chrome, or Edge"],
      platform: "linux",
      enabled: false,
      transport: "websocket",
      ws_path: "/vnc/ws",
      targets: [],
    });
    expect(fixture.state.vncPrepareCalls).toEqual(["cdp-browser"]);
  });

  test("VNC handoff preserves auth, CSRF, target validation, and transfer behavior", async () => {
    const missingTarget = createFixture();
    expect((await missingTarget.service.handleVncHandoff(createRequest("/vnc/handoff", { method: "POST" }))).status).toBe(400);
    expect(missingTarget.state.csrfChecks).toEqual([]);

    const unauthenticated = createFixture({
      authGateway: {
        isAuthEnabled: () => true,
        isAuthenticated: () => false,
      },
    });
    expect((await unauthenticated.service.handleVncHandoff(createRequest("/vnc/handoff?target=desk", { method: "POST" }))).status).toBe(401);
    expect(unauthenticated.state.csrfChecks).toEqual([]);

    const csrfBlocked = createFixture({
      checkCsrfOrigin: () => false,
    });
    expect((await csrfBlocked.service.handleVncHandoff(createRequest("/vnc/handoff?target=desk", { method: "POST" }))).status).toBe(403);
    expect(csrfBlocked.state.vncResolveCalls).toEqual([]);
    expect(csrfBlocked.state.vncHandoffCalls).toEqual([]);

    const unknownTarget = createFixture();
    const unknownResponse = await unknownTarget.service.handleVncHandoff(createRequest("/vnc/handoff?target=unknown", { method: "POST" }));
    expect(unknownResponse.status).toBe(404);
    expect(await unknownResponse.json()).toEqual({
      error: "Unknown or disallowed VNC target",
      enabled: true,
      transport: "websocket",
      ws_path: "/vnc/ws",
      targets: [{ id: "desk", label: "Desk", readOnly: false }],
    });
    expect(unknownTarget.state.vncPrepareCalls).toEqual(["unknown"]);
    expect(unknownTarget.state.vncResolveCalls).toEqual([]);
    expect(unknownTarget.state.vncHandoffCalls).toEqual([]);

    const noLiveSession = createFixture({
      vncService: {
        prepareTargetReference: async (targetId) => {
          noLiveSession.state.vncPrepareCalls.push(targetId);
          return targetId === noLiveSession.vncTarget.id
            ? { ok: true, target: noLiveSession.vncTarget }
            : { ok: false, error: "Unknown or disallowed VNC target", missingDependencies: [], platform: "linux" as const };
        },
        resolveTargetReference: (targetId) => {
          noLiveSession.state.vncResolveCalls.push(targetId);
          return targetId === noLiveSession.vncTarget.id ? noLiveSession.vncTarget : null;
        },
        getSessionInfo: (targetId) => {
          noLiveSession.state.vncSessionInfoCalls.push(targetId);
          return {
            enabled: true,
            transport: "websocket",
            ws_path: "/vnc/ws",
            targets: [{ id: noLiveSession.vncTarget.id, label: noLiveSession.vncTarget.label, readOnly: false }],
          };
        },
        createHandoffFromRequest: (_req, targetId, allowUnauthenticated = false) => {
          noLiveSession.state.vncHandoffCalls.push({ targetId, allowUnauthenticated });
          return null;
        },
      },
    });
    expect((await noLiveSession.service.handleVncHandoff(createRequest("/vnc/handoff?target=desk", { method: "POST" }))).status).toBe(409);
    expect(noLiveSession.state.vncHandoffCalls).toEqual([{ targetId: "desk", allowUnauthenticated: true }]);

    const fixture = createFixture();
    const response = await fixture.service.handleVncHandoff(createRequest("/vnc/handoff?target=desk", { method: "POST" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, handoff: fixture.handoff });
    expect(fixture.state.authChecks).toEqual(["enabled"]);
    expect(fixture.state.csrfChecks).toEqual(["/vnc/handoff"]);
    expect(fixture.state.vncPrepareCalls).toEqual(["desk"]);
    expect(fixture.state.vncResolveCalls).toEqual([]);
    expect(fixture.state.vncHandoffCalls).toEqual([{ targetId: "desk", allowUnauthenticated: true }]);
  });
});
