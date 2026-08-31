import { describe, expect, test } from "bun:test";

import {
  WebServerLifecycleGatewayService,
  type WebServerLifecycleGatewayDeps,
} from "../../../src/channels/web/server-lifecycle-gateway-service.js";

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

function createFixture(overrides: Partial<WebServerLifecycleGatewayDeps> = {}) {
  let workspaceVisible = false;
  let workspaceShowHidden = false;

  const state = {
    loadStateCalls: 0,
    initThemeCalls: 0,
    handleRequestCalls: [] as string[],
    startWorkspaceWatcherCalls: 0,
    purgeCalls: [] as Array<{ nowIso: string; limit: number }>,
    authChecks: [] as string[],
    terminalResolveCalls: [] as boolean[],
    vncPrepareCalls: [] as string[],
    vncResolveCalls: [] as Array<{ targetId: string; allowUnauthenticated: boolean }>,
    terminalShutdownCalls: 0,
    vncShutdownCalls: 0,
    sseCloseCalls: 0,
    uiBridgeStopCalls: 0,
    upgradeCalls: [] as Array<{ url: string; data: unknown }>,
    serveCalls: [] as any[],
    serveAttempts: 0,
    sleepCalls: [] as number[],
    intervalCalls: [] as Array<{ timeout?: number; handler: TimerHandler }>,
    clearIntervalCalls: [] as unknown[],
    watcherCloseCalls: 0,
    logInfo: [] as Array<{ message: string; meta?: Record<string, unknown> }>,
    logWarn: [] as Array<{ message: string; meta?: Record<string, unknown> }>,
    logError: [] as Array<{ message: string; meta?: Record<string, unknown> }>,
  };

  const terminalOwner = { kind: "terminal" as const, token: "terminal-token", userId: "user-1" };
  const vncOwner = { kind: "vnc" as const, token: "vnc-token", userId: "user-1", targetRef: "target-a" };
  const watcher = {
    close: async () => {
      state.watcherCloseCalls += 1;
    },
  };
  const server = {
    port: 4321,
    upgrade: (req: Request, options?: { data?: unknown }) => {
      state.upgradeCalls.push({ url: req.url, data: options?.data });
      return true;
    },
    stop: (_force?: boolean) => {},
  } as any;

  const deps: WebServerLifecycleGatewayDeps = {
    webServerConfig: {
      host: "127.0.0.1",
      port: 8080,
      idleTimeout: 30,
      tlsCert: null,
      tlsKey: null,
    },
    webRuntimeConfig: {
      terminalEnabled: true,
    },
    json,
    loadState: () => {
      state.loadStateCalls += 1;
    },
    initTheme: () => {
      state.initThemeCalls += 1;
    },
    handleRequest: async (req) => {
      state.handleRequestCalls.push(new URL(req.url).pathname);
      return json({ pathname: new URL(req.url).pathname }, 200);
    },
    getWorkspaceVisible: () => workspaceVisible,
    getWorkspaceShowHidden: () => workspaceShowHidden,
    startWorkspaceWatcher: () => {
      state.startWorkspaceWatcherCalls += 1;
      return watcher;
    },
    purgeExpiredLinkPreviewImageCache: (nowIso, limit) => {
      state.purgeCalls.push({ nowIso, limit });
      return { purgedEntries: 0, purgedMedia: 0 };
    },
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
      attachClient: () => {},
      handleMessage: () => {},
      detachClient: () => {},
      shutdown: () => {
        state.terminalShutdownCalls += 1;
      },
    },
    vncService: {
      prepareTargetReference: async (targetId) => {
        state.vncPrepareCalls.push(targetId);
        return { ok: true };
      },
      resolveOwnerFromRequest: (_req, targetId, allowUnauthenticated = false) => {
        state.vncResolveCalls.push({ targetId, allowUnauthenticated });
        return { ...vncOwner, targetRef: targetId };
      },
      attachClient: () => {},
      handleMessage: () => {},
      detachClient: () => {},
      shutdown: () => {
        state.vncShutdownCalls += 1;
      },
    },
    uiBridge: {
      stop: () => {
        state.uiBridgeStopCalls += 1;
      },
    },
    sse: {
      closeAll: () => {
        state.sseCloseCalls += 1;
      },
    },
    serve: ((options: any) => {
      state.serveAttempts += 1;
      state.serveCalls.push(options);
      return server;
    }) as typeof Bun.serve,
    readTextFile: async (path) => `contents:${path}`,
    sleep: async (ms) => {
      state.sleepCalls.push(ms);
    },
    setInterval: ((handler: TimerHandler, timeout?: number) => {
      state.intervalCalls.push({ handler, timeout });
      return { timeout } as any;
    }) as typeof setInterval,
    clearInterval: ((timer: unknown) => {
      state.clearIntervalCalls.push(timer);
    }) as typeof clearInterval,
    log: {
      info: (message, meta) => {
        state.logInfo.push({ message, meta });
      },
      warn: (message, meta) => {
        state.logWarn.push({ message, meta });
      },
      error: (message, meta) => {
        state.logError.push({ message, meta });
      },
    },
    ...overrides,
  };

  return {
    state,
    server,
    terminalOwner,
    vncOwner,
    setWorkspaceVisible: (value: boolean) => {
      workspaceVisible = value;
    },
    setWorkspaceShowHidden: (value: boolean) => {
      workspaceShowHidden = value;
    },
    service: new WebServerLifecycleGatewayService(deps),
  };
}

describe("web server lifecycle gateway service", () => {
  test("dispatches websocket upgrade paths and delegates normal requests", async () => {
    const fixture = createFixture();
    const service = fixture.service as any;

    const terminalReq = createRequest("/terminal/ws");
    const terminalResponse = await service.handleFetch(terminalReq, fixture.server);
    expect(terminalResponse).toBeUndefined();
    expect(fixture.state.upgradeCalls[0]?.data).toEqual(fixture.terminalOwner);

    const vncReq = createRequest("/vnc/ws?target=desktop-a&handoff=handoff-1");
    const vncResponse = await service.handleFetch(vncReq, fixture.server);
    expect(vncResponse).toBeUndefined();
    expect(fixture.state.upgradeCalls[1]?.data).toEqual({
      ...fixture.vncOwner,
      targetRef: "desktop-a",
      handoffToken: "handoff-1",
    });

    const standardResponse = await service.handleFetch(createRequest("/timeline?limit=10"));
    expect(standardResponse?.status).toBe(200);
    expect(fixture.state.handleRequestCalls).toEqual(["/timeline"]);
  });

  test("terminal websocket upgrade preserves auth, csrf, and upgrade failure responses", () => {
    const disabled = createFixture({
      webRuntimeConfig: { terminalEnabled: false },
    });
    expect(disabled.service.handleTerminalWebSocketUpgrade(createRequest("/terminal/ws"), disabled.server)?.status).toBe(404);

    const unauthenticated = createFixture({
      authGateway: {
        isAuthEnabled: () => true,
        isAuthenticated: () => false,
      },
    });
    expect(unauthenticated.service.handleTerminalWebSocketUpgrade(createRequest("/terminal/ws"), unauthenticated.server)?.status).toBe(401);

    const csrfBlocked = createFixture();
    const csrfResponse = csrfBlocked.service.handleTerminalWebSocketUpgrade(
      createRequest("/terminal/ws", { headers: { origin: "https://evil.example", host: "localhost" } }),
      csrfBlocked.server,
    );
    expect(csrfResponse?.status).toBe(403);

    const noOwner = createFixture({
      terminalService: {
        resolveOwnerFromRequest: () => null,
        attachClient: () => {},
        handleMessage: () => {},
        detachClient: () => {},
        shutdown: () => {},
      },
    });
    expect(noOwner.service.handleTerminalWebSocketUpgrade(createRequest("/terminal/ws"), noOwner.server)?.status).toBe(401);

    const upgradeFailure = createFixture({
      serve: ((options: any) => {
        upgradeFailure.state.serveCalls.push(options);
        return {
          ...upgradeFailure.server,
          upgrade: () => false,
        } as any;
      }) as typeof Bun.serve,
    });
    expect(upgradeFailure.service.handleTerminalWebSocketUpgrade(createRequest("/terminal/ws"), {
      ...upgradeFailure.server,
      upgrade: () => false,
    } as any)?.status).toBe(400);
  });

  test("vnc websocket upgrade preserves target, auth, csrf, and handoff behavior", async () => {
    const fixture = createFixture();

    const missingTarget = await fixture.service.handleVncWebSocketUpgrade(createRequest("/vnc/ws"), fixture.server);
    expect(missingTarget?.status).toBe(400);

    const unauthenticated = createFixture({
      authGateway: {
        isAuthEnabled: () => true,
        isAuthenticated: () => false,
      },
    });
    expect((await unauthenticated.service.handleVncWebSocketUpgrade(createRequest("/vnc/ws?target=desk"), unauthenticated.server))?.status).toBe(401);
    expect(unauthenticated.state.vncPrepareCalls).toEqual([]);

    const csrfBlocked = createFixture();
    const csrfResponse = await csrfBlocked.service.handleVncWebSocketUpgrade(
      createRequest("/vnc/ws?target=desk", { headers: { origin: "https://evil.example", host: "localhost" } }),
      csrfBlocked.server,
    );
    expect(csrfResponse?.status).toBe(403);

    const noOwner = createFixture({
      vncService: {
        prepareTargetReference: async () => ({ ok: true }),
        resolveOwnerFromRequest: () => null,
        attachClient: () => {},
        handleMessage: () => {},
        detachClient: () => {},
        shutdown: () => {},
      },
    });
    expect((await noOwner.service.handleVncWebSocketUpgrade(createRequest("/vnc/ws?target=desk"), noOwner.server))?.status).toBe(401);

    const managedUnavailable = createFixture({
      vncService: {
        prepareTargetReference: async (targetId) => {
          managedUnavailable.state.vncPrepareCalls.push(targetId);
          return { ok: false, error: "Missing Chromium", missingDependencies: ["Chromium"], platform: "linux" as const };
        },
        resolveOwnerFromRequest: () => null,
        attachClient: () => {},
        handleMessage: () => {},
        detachClient: () => {},
        shutdown: () => {},
      },
    });
    const managedResponse = await managedUnavailable.service.handleVncWebSocketUpgrade(
      createRequest("/vnc/ws?target=cdp-browser"),
      managedUnavailable.server,
    );
    expect(managedResponse?.status).toBe(503);
    expect(await managedResponse?.json()).toEqual({
      error: "Missing Chromium",
      missing_dependencies: ["Chromium"],
      platform: "linux",
    });
    expect(managedUnavailable.state.vncPrepareCalls).toEqual(["cdp-browser"]);

    const okResponse = await fixture.service.handleFetch(createRequest("/vnc/ws?target=desk&handoff=token-7"), fixture.server);
    expect(okResponse).toBeUndefined();
    expect(fixture.state.vncPrepareCalls).toEqual(["desk"]);
    expect(fixture.state.vncResolveCalls).toEqual([{ targetId: "desk", allowUnauthenticated: true }]);
    expect(fixture.state.upgradeCalls[0]?.data).toEqual({
      ...fixture.vncOwner,
      targetRef: "desk",
      handoffToken: "token-7",
    });
  });

  test("start retries busy ports, falls back when tls loading fails, and wires lifecycle side effects", async () => {
    const fixture = createFixture({
      webServerConfig: {
        host: "127.0.0.1",
        port: 8080,
        idleTimeout: 30,
        tlsCert: "/tmp/cert.pem",
        tlsKey: "/tmp/key.pem",
      },
      readTextFile: async () => {
        throw new Error("missing tls files");
      },
      serve: ((options: any) => {
        fixture.state.serveAttempts += 1;
        fixture.state.serveCalls.push(options);
        if (fixture.state.serveAttempts === 1) {
          const error = new Error("busy") as Error & { code?: string };
          error.code = "EADDRINUSE";
          throw error;
        }
        return fixture.server;
      }) as typeof Bun.serve,
    });

    await fixture.service.start();

    expect(fixture.state.loadStateCalls).toBe(1);
    expect(fixture.state.initThemeCalls).toBe(1);
    expect(fixture.state.serveAttempts).toBe(2);
    expect(fixture.state.sleepCalls).toEqual([1500]);
    expect(fixture.state.logWarn[0]?.meta?.operation).toBe("start.bind_retry");
    expect(fixture.state.logError[0]?.meta?.operation).toBe("load_tls_options");
    expect(fixture.state.serveCalls[1]?.tls).toBeUndefined();
    expect(fixture.state.startWorkspaceWatcherCalls).toBe(0);

    fixture.setWorkspaceVisible(true);
    await fixture.service.syncWorkspaceWatcher();

    expect(fixture.state.startWorkspaceWatcherCalls).toBe(1);
    expect(fixture.state.purgeCalls).toHaveLength(1);
    expect(fixture.state.intervalCalls).toHaveLength(1);
    expect(fixture.service.server).toBe(fixture.server);
    expect(fixture.state.logInfo.some((entry) => entry.meta?.operation === "start.listen")).toBe(true);
  });

  test("stop tears down websocket, watcher, and timer side effects", async () => {
    const fixture = createFixture();

    await fixture.service.start();
    fixture.setWorkspaceVisible(true);
    await fixture.service.syncWorkspaceWatcher();
    await fixture.service.stop();

    expect(fixture.state.sseCloseCalls).toBe(1);
    expect(fixture.state.uiBridgeStopCalls).toBe(1);
    expect(fixture.state.terminalShutdownCalls).toBe(1);
    expect(fixture.state.vncShutdownCalls).toBe(1);
    expect(fixture.state.clearIntervalCalls).toHaveLength(1);
    expect(fixture.state.watcherCloseCalls).toBe(1);
    expect(fixture.service.server).toBeNull();
    expect(fixture.service.workspaceWatcher).toBeNull();
    expect(fixture.service.linkPreviewCachePurgeTimer).toBeNull();
  });

  test("syncWorkspaceWatcher toggles watcher lifecycle and restarts on hidden-mode changes", async () => {
    const fixture = createFixture();

    await fixture.service.start();
    expect(fixture.state.startWorkspaceWatcherCalls).toBe(0);

    fixture.setWorkspaceVisible(true);
    await fixture.service.syncWorkspaceWatcher();
    expect(fixture.state.startWorkspaceWatcherCalls).toBe(1);
    expect(fixture.state.watcherCloseCalls).toBe(0);

    fixture.setWorkspaceShowHidden(true);
    await fixture.service.syncWorkspaceWatcher();
    expect(fixture.state.startWorkspaceWatcherCalls).toBe(2);
    expect(fixture.state.watcherCloseCalls).toBe(1);

    fixture.setWorkspaceVisible(false);
    await fixture.service.syncWorkspaceWatcher();
    expect(fixture.state.watcherCloseCalls).toBe(2);

    await fixture.service.stop();
  });
});
