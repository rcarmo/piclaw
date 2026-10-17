import { describe, expect, spyOn, test } from "bun:test";

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
    authGateway: deps.authGateway,
    calls: state,
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
  test("concurrent starts allocate once and a stopped instance cannot restart", async () => {
    const fixture = createFixture();
    const starting = fixture.service.start();
    expect(fixture.service.start()).toBe(starting);
    await starting;
    await fixture.service.start();
    expect(fixture.calls.serveAttempts).toBe(1);
    expect(fixture.calls.intervalCalls).toHaveLength(1);
    await fixture.service.stop();
    await expect(fixture.service.start()).rejects.toThrow("cannot restart");
    expect(fixture.calls.serveAttempts).toBe(1);
  });

  test("stop joins held TLS and fences every startup publication after release", async () => {
    const tls = Promise.withResolvers<string>();
    const reading = Promise.withResolvers<void>();
    const fixture = createFixture({
      webServerConfig: { host: "127.0.0.1", port: 8080, idleTimeout: 30, tlsCert: "cert", tlsKey: "key" },
      readTextFile: () => { reading.resolve(); return tls.promise; },
    });
    fixture.setWorkspaceVisible(true);
    const starting = fixture.service.start();
    await reading.promise;
    let stopped = false;
    const stopping = fixture.service.stop();
    void stopping.then(() => { stopped = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(stopped).toBe(false);
    expect(fixture.calls.sseCloseCalls).toBe(0);
    tls.resolve("held TLS contents");
    await Promise.all([starting, stopping]);
    await fixture.service.syncWorkspaceWatcher();
    expect(fixture.calls.serveAttempts).toBe(0);
    expect(fixture.calls.startWorkspaceWatcherCalls).toBe(0);
    expect(fixture.calls.intervalCalls).toHaveLength(0);
    expect(fixture.calls.purgeCalls).toHaveLength(0);
    expect(fixture.calls.logInfo.some(entry => entry.meta?.operation === "start.listen")).toBe(false);
    expect(fixture.service.server).toBeNull();
  });

  test("stop interrupts a held busy-bind retry without another serve attempt", async () => {
    const sleeping = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let signal: AbortSignal | undefined;
    const fixture = createFixture({
      serve: (() => { fixture.calls.serveAttempts++; throw Object.assign(new Error("busy"), { code: "EADDRINUSE" }); }) as typeof Bun.serve,
      sleep: (_ms, abort) => { signal = abort; sleeping.resolve(); return release.promise; },
    });
    const starting = fixture.service.start();
    await sleeping.promise;
    await fixture.service.stop();
    await starting;
    expect(signal?.aborted).toBe(true);
    expect(fixture.calls.serveAttempts).toBe(1);
    expect(fixture.calls.intervalCalls).toHaveLength(0);
    release.resolve();
    await Promise.resolve();
    expect(fixture.calls.serveAttempts).toBe(1);
  });

  test("stop clears the owned bind-retry timeout promptly", async () => {
    const sleeping = Promise.withResolvers<void>();
    const timeoutToken = {};
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    let cleared = false;
    const timeoutSpy = spyOn(globalThis, "setTimeout").mockImplementation(((handler: TimerHandler, ms?: number, ...args: any[]) => {
      if (ms === 1500) { sleeping.resolve(); return timeoutToken; }
      return originalSetTimeout(handler, ms, ...args);
    }) as typeof setTimeout);
    const clearSpy = spyOn(globalThis, "clearTimeout").mockImplementation(((timer: unknown) => {
      if (timer === timeoutToken) { cleared = true; return; }
      originalClearTimeout(timer as never);
    }) as typeof clearTimeout);
    try {
      const fixture = createFixture({
        sleep: undefined,
        serve: (() => { fixture.calls.serveAttempts++; throw Object.assign(new Error("busy"), { code: "EADDRINUSE" }); }) as typeof Bun.serve,
      });
      const starting = fixture.service.start();
      await sleeping.promise;
      await fixture.service.stop();
      await starting;
      expect(cleared).toBe(true);
      expect(fixture.calls.serveAttempts).toBe(1);
      expect(fixture.calls.intervalCalls).toHaveLength(0);
    } finally {
      timeoutSpy.mockRestore();
      clearSpy.mockRestore();
    }
  });

  test("stop before startup work begins prevents all allocation", async () => {
    const fixture = createFixture();
    const starting = fixture.service.start();
    await fixture.service.stop();
    await starting;
    expect(fixture.calls.loadStateCalls).toBe(0);
    expect(fixture.calls.serveAttempts).toBe(0);
    expect(fixture.calls.intervalCalls).toHaveLength(0);
  });

  test("stop fences watcher restart after held close and joins partial listener cleanup", async () => {
    const closing = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const fixture = createFixture();
    fixture.setWorkspaceVisible(true);
    fixture.service.workspaceWatcher = { close: async () => { closing.resolve(); await release.promise; } };
    let listenerClosed = false, stopped = false;
    fixture.server.stop = async () => { listenerClosed = true; };
    const starting = fixture.service.start();
    await closing.promise;
    const stopping = fixture.service.stop();
    void stopping.then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release.resolve();
    await Promise.all([starting, stopping]);
    expect(listenerClosed).toBe(true);
    expect(fixture.calls.startWorkspaceWatcherCalls).toBe(0);
    expect(fixture.calls.intervalCalls).toHaveLength(0);
    expect(fixture.service.workspaceWatcher).toBeNull();
    expect(fixture.service.server).toBeNull();
  });

  test("startup failure cleans partial resources without joining its own cleanup wrapper", async () => {
    const fixture = createFixture({ purgeExpiredLinkPreviewImageCache: () => { throw new Error("purge failed"); } });
    fixture.setWorkspaceVisible(true);
    let listenerClosed = false;
    fixture.server.stop = async () => { listenerClosed = true; };
    await expect(fixture.service.start()).rejects.toThrow("purge failed");
    await fixture.service.stop();
    expect(listenerClosed).toBe(true);
    expect(fixture.calls.watcherCloseCalls).toBe(1);
    expect(fixture.service.server).toBeNull();
    expect(fixture.service.workspaceWatcher).toBeNull();
  });

  test("startup preserves its primary error identity when cleanup succeeds", async () => {
    const primary = new Error("purge failed");
    const fixture = createFixture({ purgeExpiredLinkPreviewImageCache: () => { throw primary; } });
    expect(await fixture.service.start().catch(error => error)).toBe(primary);
    await fixture.service.stop();
  });

  test("startup and transport failures retain both identities and still close the watcher", async () => {
    const primary = new Error("purge failed");
    const cleanup = new Error("transport failed");
    const fixture = createFixture({ purgeExpiredLinkPreviewImageCache: () => { throw primary; } });
    fixture.setWorkspaceVisible(true);
    let stopCalls = 0;
    fixture.server.stop = async () => { stopCalls++; throw cleanup; };
    const failure = await fixture.service.start().catch(error => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors).toEqual([primary, cleanup]);
    expect(failure.errors[0]).toBe(primary);
    expect(failure.errors[1]).toBe(cleanup);
    const stopping = fixture.service.stop();
    expect(fixture.service.stop()).toBe(stopping);
    expect(await stopping.catch(error => error)).toBe(cleanup);
    expect(fixture.calls.watcherCloseCalls).toBe(1);
    expect(fixture.service.workspaceWatcher).toBeNull();
    expect(fixture.service.server).toBe(fixture.server);
    await fixture.service.syncWorkspaceWatcher();
    await expect(fixture.service.start()).rejects.toThrow("cannot restart");
    await Promise.resolve();
    expect(stopCalls).toBe(1);
    expect(fixture.calls.serveAttempts).toBe(1);
    expect(fixture.calls.startWorkspaceWatcherCalls).toBe(1);
    expect(fixture.calls.intervalCalls).toHaveLength(0);
    expect(fixture.calls.logInfo.some(entry => entry.meta?.operation === "start.listen")).toBe(false);
  });

  test("independent cleanup collects failures and clears timers after an earlier failure", async () => {
    const sseFailure = new Error("sse failed");
    const transportFailure = new Error("transport failed");
    const watcherFailure = new Error("watcher failed");
    const fixture = createFixture({ sse: { closeAll: () => { throw sseFailure; } } });
    fixture.setWorkspaceVisible(true);
    await fixture.service.start();
    fixture.server.stop = async () => { throw transportFailure; };
    fixture.service.workspaceWatcher = { close: async () => { fixture.calls.watcherCloseCalls++; throw watcherFailure; } };
    const stopping = fixture.service.stop();
    const failure = await stopping.catch(error => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors).toEqual([sseFailure, transportFailure, watcherFailure]);
    expect(fixture.calls.uiBridgeStopCalls).toBe(1);
    expect(fixture.calls.terminalShutdownCalls).toBe(1);
    expect(fixture.calls.vncShutdownCalls).toBe(1);
    expect(fixture.calls.clearIntervalCalls).toHaveLength(1);
    expect(fixture.service.linkPreviewCachePurgeTimer).toBeNull();
    expect(fixture.calls.watcherCloseCalls).toBe(1);
    expect(fixture.service.workspaceWatcher).not.toBeNull();
    expect(fixture.service.server).toBe(fixture.server);
    expect(fixture.service.stop()).toBe(stopping);
    expect(await fixture.service.stop().catch(error => error)).toBe(failure);
  });

  test("stop synchronously seals admission and joins a real pending request body before teardown", async () => {
    const body = Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>();
    const entered = Promise.withResolvers<void>();
    let writes = 0, stopped = false;
    const fixture = createFixture({ handleRequest: async req => {
      entered.resolve();
      await req.text();
      writes++;
      return json({ accepted: true });
    } });
    const req = createRequest('/post', { method: 'POST', body: new ReadableStream({ start(controller) { body.resolve(controller); } }) });
    const pending = fixture.service.handleFetch(req);
    await entered.promise;
    const stopping = fixture.service.stop();
    expect(fixture.service.stop()).toBe(stopping);
    void stopping.then(() => { stopped = true; });
    const denied = createRequest('/post', { method: 'POST', body: 'must not read' });
    expect((await fixture.service.handleFetch(denied))?.status).toBe(503);
    expect(denied.bodyUsed).toBe(false);
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(fixture.calls.sseCloseCalls).toBe(0);
    const controller = await body.promise;
    controller.enqueue(new TextEncoder().encode('accepted before seal')); controller.close();
    expect((await pending)?.status).toBe(200);
    await stopping;
    expect(writes).toBe(1);
    expect(fixture.calls.sseCloseCalls).toBe(1);
    expect((await fixture.service.handleFetch(createRequest('/post')))?.status).toBe(503);
    expect(writes).toBe(1);
  });

  test("handler rejection releases the join and transport cleanup failure remains sticky", async () => {
    const release = Promise.withResolvers<void>();
    const failure = new Error('handler failed');
    const fixture = createFixture({ handleRequest: async () => { await release.promise; throw failure; } });
    const request = fixture.service.handleFetch(createRequest('/post')).catch(error => error);
    const stopping = fixture.service.stop();
    release.resolve();
    expect(await request).toBe(failure);
    await stopping;
    const broken = createFixture();
    broken.server.stop = async () => { throw new Error('transport failed'); };
    broken.service.server = broken.server;
    const rejected = broken.service.stop();
    await expect(rejected).rejects.toThrow('transport failed');
    expect(broken.service.stop()).toBe(rejected);
    expect((await broken.service.handleFetch(createRequest('/post')))?.status).toBe(503);
  });

  test("already-entered WebSocket add-on control callbacks join the same admission drain", async () => {
    const release = Promise.withResolvers<void>();
    let messages = 0, closed = 0, joined = false;
    const fixture = createFixture();
    await fixture.service.start();
    const socket = { data: { kind: 'authenticated-addon', session: { message: async () => { messages++; await release.promise; } } }, close: () => { closed++; } };
    fixture.calls.serveCalls[0].websocket.message(socket, 'first');
    const drain = fixture.service.sealAdmissions();
    void drain.then(() => { joined = true; });
    fixture.calls.serveCalls[0].websocket.message(socket, 'denied');
    await Promise.resolve();
    expect(messages).toBe(1); expect(closed).toBe(1); expect(joined).toBe(false);
    release.resolve(); await drain;
    expect(joined).toBe(true);
    await fixture.service.stop();
  });
  test("CDP viewer upgrade requires authentication and same origin", async () => {
    const fixture = createFixture();
    const req = createRequest('/cdp-view/ws');
    expect((await fixture.service.handleFetch(req, fixture.server))?.status).toBe(401);
    fixture.authGateway.isAuthEnabled = () => true;
    expect(await fixture.service.handleFetch(req, fixture.server)).toBeUndefined();
    expect(fixture.state.upgradeCalls.at(-1)?.data).toEqual({ kind: 'cdp-view' });
    fixture.authGateway.isAuthenticated = () => false;
    expect((await fixture.service.handleFetch(req, fixture.server))?.status).toBe(401);
    fixture.authGateway.isAuthenticated = () => true;
    expect((await fixture.service.handleFetch(createRequest('/cdp-view/ws', { headers: { origin: 'https://evil.example', host: 'localhost' } }), fixture.server))?.status).toBe(403);
  });
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

test('socket disposal failure does not prevent independent gateway services from stopping',async()=>{
 const {withAddonRegistrationOwner}=await import('../../../src/addons/registration-owner');
 const {registerAuthenticatedWebSocket,reserveAuthenticatedAddonSocket,resetAuthenticatedAddonSocketsForTests}=await import('../../../src/addons/authenticated-socket-registry');
 const {service,calls}=createFixture();await service.start();
 await withAddonRegistrationOwner({addonId:'gateway-stop',packageName:'gateway-stop',entryPath:'test'},async()=>{registerAuthenticatedWebSocket({path:'stream',maxMessageBytes:8,maxQueuedBytes:8,maxSessionMs:1000,maxConnections:1,authorize:async()=>({chatJid:'web:a'}),open:async()=>({message:async()=>{},dispose:async()=>{throw Error('private transcript');}})});});
 const session=reserveAuthenticatedAddonSocket('/agent/addons/gateway-stop/stream')!.session;await session.open({} as any,{chatJid:'web:a'},{send:async()=>{},close:()=>{}});
 await expect(service.stop()).rejects.toThrow('Authenticated socket shutdown failed.');expect(calls.sseCloseCalls).toBe(1);expect(calls.uiBridgeStopCalls).toBe(1);expect(calls.terminalShutdownCalls).toBe(1);expect(calls.vncShutdownCalls).toBe(1);expect(service.server).toBeNull();resetAuthenticatedAddonSocketsForTests();
});

test('production gateway add-on upgrade dispatch fences Origin/auth and rejects send backpressure',async()=>{
 const {initDatabase,storeChatMetadata}=await import('../../../src/db');const {ensureChatBranch}=await import('../../../src/db/chat-branches');const {withAddonRegistrationOwner}=await import('../../../src/addons/registration-owner');const {registerAuthenticatedWebSocket}=await import('../../../src/addons/authenticated-socket-registry');initDatabase();storeChatMetadata('web:gateway','2026-01-01','gateway','web',false);ensureChatBranch({chat_jid:'web:gateway',agent_name:'gateway'});
 const principal:any={kind:'user',userId:'default',username:'test',displayName:'Test',role:'admin',mode:'single-user',homeChatJid:'web:gateway',authentication:{method:'session',sessionId:'synthetic',expiresAt:null}};let authEnabled=true;let context:any,disposed=0;let remove!:()=>void;
 await withAddonRegistrationOwner({addonId:'gateway-addon',packageName:'gateway-addon',entryPath:'test'},async()=>{remove=registerAuthenticatedWebSocket({path:'realtime',maxMessageBytes:8,maxQueuedBytes:16,maxSessionMs:1000,maxConnections:1,authorize:async()=>({chatJid:'web:gateway'}),open:async c=>{context=c;return{message:async()=>{},dispose:async()=>{disposed++;}};}});});
 const fixture=createFixture({authGateway:{isAuthEnabled:()=>authEnabled,isAuthenticated:()=>true,getPrincipal:()=>principal} as any});await fixture.service.start();const path='/agent/addons/gateway-addon/realtime';
 try{
  expect((await fixture.service.handleFetch(createRequest(path,{headers:{origin:'http://foreign'}}),fixture.server))?.status).toBe(403);authEnabled=false;expect((await fixture.service.handleFetch(createRequest(path),fixture.server))?.status).toBe(403);authEnabled=true;
  const upgradeRequest=new Request('http://localhost'+path,{headers:{origin:'http://localhost',upgrade:'websocket'}});expect(await fixture.service.handleFetch(upgradeRequest,fixture.server)).toBeUndefined();const data:any=fixture.state.upgradeCalls.at(-1)!.data;expect(data.kind).toBe('authenticated-addon');
  const handlers=fixture.state.serveCalls.at(-1).websocket;const ws:any={data,readyState:1,getBufferedAmount:()=>0,send:()=>0,close:()=>{}};handlers.open(ws);await new Promise(resolve=>setTimeout(resolve,0));await expect(context.send('frame')).rejects.toThrow('backpressure');ws.getBufferedAmount=()=>17;await expect(context.send('frame')).rejects.toThrow('overloaded');handlers.close(ws);await data.session.close();expect(disposed).toBe(1);
 }finally{remove();await fixture.service.stop();}
});
