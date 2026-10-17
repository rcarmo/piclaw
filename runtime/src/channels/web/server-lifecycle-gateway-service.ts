import { AsyncLocalStorage } from "node:async_hooks";
import { CdpViewConnection, closeCdpViewConnections } from './cdp-view.js';
import { initTheme } from "@earendil-works/pi-coding-agent";
import type { ServerWebSocket } from "bun";
import { readAccessConfig } from "../../core/config-access.js";

import { purgeExpiredLinkPreviewImageCache } from "../../db.js";
import { createLogger } from "../../utils/logger.js";
import { startWorkspaceWatcher, type WorkspaceWatcherChannel } from "./handlers/workspace.js";
import { checkCsrfOrigin } from "./http/security.js";
import type { TerminalSocketData } from "./terminal/terminal-session-service.js";
import type { VncSocketData } from "./vnc/vnc-session-service.js";

const log = createLogger("web");
const LINK_PREVIEW_CACHE_PURGE_INTERVAL_MS = 12 * 60 * 60 * 1000;
const MAX_BIND_ATTEMPTS = 5;
const BIND_RETRY_MS = 1500;

import type { AuthenticatedPrincipal } from '../../core/access-types.js';
import { hasAuthenticatedAddonSocket, shutdownAuthenticatedAddonSockets } from '../../addons/authenticated-socket-registry.js';
import { prepareAuthenticatedAddonSocket, type AuthenticatedAddonSocketData } from '../../addons/authenticated-socket-upgrade.js';
export type WebSocketSessionData = AuthenticatedAddonSocketData | TerminalSocketData | VncSocketData | { kind: "cdp-view"; connection?: CdpViewConnection };

interface JsonResponder {
  json(payload: unknown, status?: number): Response;
}

interface AuthGatewayLike {
  isAuthEnabled(): boolean;
  isAuthenticated(req: Request): boolean;
  getPrincipal?(req: Request, refresh?: boolean): Readonly<AuthenticatedPrincipal> | null;
}

interface TerminalServiceLike {
  resolveOwnerFromRequest(req: Request, allowUnauthenticated?: boolean): TerminalSocketData | null;
  attachClient(ws: ServerWebSocket<TerminalSocketData>): void;
  handleMessage(ws: ServerWebSocket<TerminalSocketData>, message: string | Buffer | Uint8Array): void;
  detachClient(ws: ServerWebSocket<TerminalSocketData>): void;
  shutdown(): void;
}

interface VncServiceLike {
  prepareTargetReference(targetId: string): Promise<{ ok: boolean; error?: string; missingDependencies?: string[]; platform?: NodeJS.Platform }>;
  resolveOwnerFromRequest(req: Request, targetId: string, allowUnauthenticated?: boolean): VncSocketData | null;
  attachClient(ws: ServerWebSocket<VncSocketData>): void;
  handleMessage(ws: ServerWebSocket<VncSocketData>, message: string | Buffer | Uint8Array): void;
  detachClient(ws: ServerWebSocket<VncSocketData>): void;
  shutdown(): void;
}

interface WatcherLike {
  close(): Promise<void>;
}

interface SseHubLike {
  closeAll(): void;
}

interface UiBridgeLike {
  stop(): void;
}

interface LoggerLike {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface WebServerLifecycleGatewayDeps extends JsonResponder {
  webServerConfig: {
    host: string;
    port: number;
    idleTimeout: number;
    tlsCert?: string | null;
    tlsKey?: string | null;
  };
  webRuntimeConfig: {
    terminalEnabled: boolean;
  };
  loadState(): void;
  initTheme(): void;
  handleRequest(req: Request): Promise<Response>;
  startWorkspaceWatcher(): WatcherLike;
  getWorkspaceVisible(): boolean;
  getWorkspaceShowHidden(): boolean;
  purgeExpiredLinkPreviewImageCache(nowIso: string, limit: number): { purgedEntries: number; purgedMedia: number };
  authGateway: AuthGatewayLike;
  terminalService: TerminalServiceLike;
  vncService: VncServiceLike;
  uiBridge: UiBridgeLike;
  sse: SseHubLike;
  serve?: typeof Bun.serve;
  readTextFile?: (path: string) => Promise<string>;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<unknown>;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
  log?: LoggerLike;
}

export interface WebServerLifecycleGatewayChannel extends JsonResponder, WorkspaceWatcherChannel {
  syncWorkspaceWatcher?(): void;
  loadState(): void;
  handleRequest(req: Request): Promise<Response>;
  authGateway: AuthGatewayLike;
  terminalService: TerminalServiceLike;
  vncService: VncServiceLike;
  uiBridge: UiBridgeLike;
  sse: SseHubLike;
}

export function createWebServerLifecycleGateway(
  channel: WebServerLifecycleGatewayChannel,
  configs: Pick<WebServerLifecycleGatewayDeps, "webServerConfig" | "webRuntimeConfig">
): WebServerLifecycleGatewayService {
  return new WebServerLifecycleGatewayService({
    ...configs,
    json: (payload, status = 200) => channel.json(payload, status),
    loadState: () => channel.loadState(),
    initTheme: () => initTheme(),
    handleRequest: (req) => channel.handleRequest(req),
    startWorkspaceWatcher: () => startWorkspaceWatcher(channel),
    getWorkspaceVisible: () => channel.workspaceVisible,
    getWorkspaceShowHidden: () => channel.workspaceShowHidden,
    purgeExpiredLinkPreviewImageCache: (nowIso, limit) => purgeExpiredLinkPreviewImageCache(nowIso, limit),
    authGateway: channel.authGateway,
    terminalService: channel.terminalService,
    vncService: channel.vncService,
    uiBridge: channel.uiBridge,
    sse: channel.sse,
  });
}

export class WebServerLifecycleGatewayService {
  server: Bun.Server<WebSocketSessionData> | null = null;
  workspaceWatcher: WatcherLike | null = null;
  linkPreviewCachePurgeTimer: unknown | null = null;
  private accepting = true;
  private readonly entered = new Set<Promise<unknown>>();
  private readonly admissionContext = new AsyncLocalStorage<{ active: boolean }>();
  private drainPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private startPromise: Promise<void> | null = null;
  private startupWork: Promise<void> | null = null;
  private readonly startupAbort = new AbortController();
  private workspaceWatcherShowHidden: boolean | null = null;
  private workspaceWatcherSyncPromise: Promise<void> = Promise.resolve();

  constructor(private readonly deps: WebServerLifecycleGatewayDeps) {}

  start(): Promise<void> {
    if (!this.accepting) return Promise.reject(new Error("Web admission is sealed; this instance cannot restart."));
    if (this.startPromise) return this.startPromise;
    // Install the join before invoking dependencies (which may synchronously stop us).
    this.startupWork = Promise.resolve().then(() => this.startResources());
    this.startPromise = this.startupWork.catch(async error => {
      // stop joins startupWork, not this cleanup wrapper: never wait on ourselves.
      try { await this.stop(); }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], "Web startup and cleanup failed."); }
      throw error;
    });
    return this.startPromise;
  }

  private async startResources(): Promise<void> {
    if (!this.accepting) return;
    this.deps.loadState();
    try {
      this.deps.initTheme();
    } catch (err) {
      this.logger.warn("Failed to initialize theme cache", {
        operation: "start.init_theme",
        err,
      });
    }
    const tls = await this.loadTlsOptions();
    if (!this.accepting) return;

    let lastBindError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_BIND_ATTEMPTS; attempt++) {
      if (!this.accepting) return;
      try {
        this.server = this.serve<WebSocketSessionData>({
          hostname: this.deps.webServerConfig.host,
          port: this.deps.webServerConfig.port,
          reusePort: true,
          idleTimeout: this.deps.webServerConfig.idleTimeout,
          maxRequestBodySize: 512 * 1024 * 1024,
          fetch: (req, server) => this.handleFetch(req, server),
          websocket: {
            maxPayloadLength: 1024 * 1024,
            open: (ws) => {
              if (!this.accepting) { ws.close(1012, 'Web channel is stopping.'); return; }
              if (ws.data?.kind === 'authenticated-addon') {
                const data = ws.data;
                void this.joinEntered(() => data.session.open(data.principal, data.scope, {
                  send: async message => {
                    if (ws.readyState !== 1 || ws.getBufferedAmount() + (typeof message === 'string' ? Buffer.byteLength(message) : message.byteLength) > data.session.registration.maxQueuedBytes) throw Error('Socket output is closed or overloaded.');
                    if (ws.send(message) <= 0) throw Error('Socket output backpressure.');
                  }, close: (code, reason) => ws.close(code, reason),
                })).catch(() => { ws.close(1011, 'Add-on socket failed.'); });
                return;
              }
              if (ws.data?.kind === "cdp-view") {
                const connection = ws.data.connection = new CdpViewConnection(ws);
                void connection.list().catch(() => ws.close());
                return;
              } else if (ws.data?.kind === "vnc") {
                this.deps.vncService.attachClient(ws as ServerWebSocket<VncSocketData>);
                return;
              }
              this.deps.terminalService.attachClient(ws as ServerWebSocket<TerminalSocketData>);
            },
            message: (ws, message) => {
              if (!this.accepting) { ws.close(1012, 'Web channel is stopping.'); return; }
              if (ws.data?.kind === 'authenticated-addon') {
                const data = ws.data;
                void this.joinEntered(() => data.session.message(message as string | Uint8Array)).catch(() => { ws.close(1008, 'Add-on socket rejected message.'); });
                return;
              }
              if (ws.data?.kind === "cdp-view") { ws.data.connection?.message(message); return; }
              if (ws.data?.kind === "vnc") {
                this.deps.vncService.handleMessage(ws as ServerWebSocket<VncSocketData>, message as any);
                return;
              }
              this.deps.terminalService.handleMessage(ws as ServerWebSocket<TerminalSocketData>, message as any);
            },
            close: (ws) => {
              if (ws.data?.kind === 'authenticated-addon') {
                void ws.data.session.close().catch(() => { this.deps.log?.warn('Add-on socket cleanup failed.', { operation: 'addon_socket.cleanup_failed' }); });
                return;
              }
              if (ws.data?.kind === "cdp-view") { ws.data.connection?.close(); return; }
              if (ws.data?.kind === "vnc") {
                this.deps.vncService.detachClient(ws as ServerWebSocket<VncSocketData>);
                return;
              }
              this.deps.terminalService.detachClient(ws as ServerWebSocket<TerminalSocketData>);
            },
          },
          ...(tls ? { tls } : {}),
        });
        lastBindError = null;
        break;
      } catch (err: any) {
        lastBindError = err;
        if (err?.code === "EADDRINUSE" && attempt < MAX_BIND_ATTEMPTS) {
          this.logger.warn("Port busy; retrying web bind", {
            operation: "start.bind_retry",
            port: this.deps.webServerConfig.port,
            attempt,
            maxAttempts: MAX_BIND_ATTEMPTS,
            retryMs: BIND_RETRY_MS,
          });
          await this.sleep(BIND_RETRY_MS);
          if (!this.accepting) return;
          continue;
        }
        throw err;
      }
    }

    if (lastBindError) throw lastBindError;

    if (!this.accepting) return;
    await this.syncWorkspaceWatcher();
    if (!this.accepting) return;
    const purgeNow = () => {
      const result = this.deps.purgeExpiredLinkPreviewImageCache(new Date().toISOString(), 256);
      if (result.purgedEntries > 0) {
        this.logger.info("Purged expired link-preview cache entries", {
          operation: "start.purge_link_preview_cache",
          purgedEntries: result.purgedEntries,
          purgedMedia: result.purgedMedia,
        });
      }
    };
    purgeNow();
    this.linkPreviewCachePurgeTimer = this.setInterval(purgeNow, LINK_PREVIEW_CACHE_PURGE_INTERVAL_MS);
    const scheme = tls ? "https" : "http";
    this.logger.info("Web UI listening", {
      operation: "start.listen",
      scheme,
      host: this.deps.webServerConfig.host,
      port: this.deps.webServerConfig.port,
    });
  }

  /** Revoke new HTTP/control admission synchronously; keep broadcasts alive. */
  sealAdmissions(): Promise<void> {
    this.accepting = false;
    this.startupAbort.abort();
    return this.drainPromise ??= this.drainEntered();
  }

  private async drainEntered(): Promise<void> {
    // An accepted request may enter a nested in-process dispatch while unwinding.
    while (this.entered.size) await Promise.allSettled([...this.entered]);
  }

  /** Same permanent fence for trusted in-process input/control, not output. */
  runInternalDispatch<T>(dispatch: () => T | Promise<T>): Promise<T> {
    if (!this.accepting && !this.admissionContext.getStore()?.active)
      return Promise.reject(new Error("Web admission is sealed; internal dispatch is unavailable."));
    return this.joinEntered(dispatch);
  }

  private joinEntered<T>(run: () => T | Promise<T>): Promise<T> {
    // Register before invoking user code, including callbacks that throw.
    const completion = Promise.withResolvers<void>();
    this.entered.add(completion.promise);
    const context = { active: true };
    return this.admissionContext.run(context, async () => {
      try { return await run(); }
      finally {
        context.active = false;
        this.entered.delete(completion.promise); completion.resolve();
      }
    });
  }

  handleRequest(req: Request, dispatch: () => Promise<Response>): Promise<Response> {
    if (!this.accepting && !this.admissionContext.getStore()?.active)
      return Promise.resolve(this.deps.json({ error: 'Web channel is stopping.' }, 503));
    return this.joinEntered(dispatch);
  }

  stop(): Promise<void> {
    const drained = this.sealAdmissions();
    return this.stopPromise ??= this.finishStop(drained);
  }

  private async finishStop(drained: Promise<void>): Promise<void> {
    // TLS may be uninterruptible. Do not certify stop until startup has settled.
    await this.startupWork?.catch((error) => {
      log.debug("Web startup failed before shutdown cleanup", { err: error });
    });
    await drained;
    const sockets=shutdownAuthenticatedAddonSockets().then(()=>true,()=>false);
    const failures: unknown[] = [];
    for (const cleanup of [
      () => closeCdpViewConnections(),
      () => this.deps.sse.closeAll(),
      () => this.deps.uiBridge.stop(),
      () => this.deps.terminalService.shutdown(),
      () => this.deps.vncService.shutdown(),
      () => {
        if (this.linkPreviewCachePurgeTimer) {
          this.clearInterval(this.linkPreviewCachePurgeTimer);
          this.linkPreviewCachePurgeTimer = null;
        }
      },
      async () => { await this.server?.stop(true); this.server = null; },
      async () => { await this.workspaceWatcherSyncPromise; },
      async () => {
        if (this.workspaceWatcher) {
          await this.workspaceWatcher.close();
          this.workspaceWatcher = null;
          this.workspaceWatcherShowHidden = null;
        }
      },
      async () => { if (!(await sockets)) throw Error('Authenticated socket shutdown failed.'); },
    ]) {
      try { await cleanup(); }
      catch (error) { failures.push(error); }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, "Web cleanup failed.");
  }

  private denyMultiUserUpgrade(): Response {
    return new Response(JSON.stringify({ error: "Remote sessions are unavailable in this access mode." }), {
      status: 403, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", Vary: "Cookie" },
    });
  }

  handleFetch(req: Request, server?: Bun.Server<WebSocketSessionData>): Promise<Response | undefined> {
    if (!this.accepting) return Promise.resolve(this.deps.json({ error: 'Web channel is stopping.' }, 503));
    return this.joinEntered(() => this.dispatchFetch(req, server));
  }

  private async dispatchFetch(req: Request, server?: Bun.Server<WebSocketSessionData>): Promise<Response | undefined> {
    const pathname = new URL(req.url).pathname;
    if (hasAuthenticatedAddonSocket(pathname)) {
      try {
        if (!server || !this.deps.authGateway.getPrincipal) return this.deps.json({ error: 'Authenticated add-on sockets are unavailable.' }, 403);
        const data = await prepareAuthenticatedAddonSocket(req, pathname, { isAuthEnabled: () => this.deps.authGateway.isAuthEnabled(), getPrincipal: (request, refresh) => this.deps.authGateway.getPrincipal!(request, refresh) });
        if (server.upgrade(req, { data })) return undefined;
        void data.session.close().catch(() => { this.deps.log?.warn('Add-on socket upgrade cleanup failed.', { operation: 'addon_socket.upgrade_cleanup_failed' }); });
        return this.deps.json({ error: 'WebSocket upgrade failed.' }, 400);
      } catch { return this.deps.json({ error: 'Authenticated add-on socket access denied.' }, 403); }
    }
    if (pathname === "/cdp-view/ws") {
      if (readAccessConfig().mode !== "single-user") return this.denyMultiUserUpgrade();
      if (!this.deps.authGateway.isAuthEnabled() || !this.deps.authGateway.isAuthenticated(req)) return Response.json({ error: "Authentication required." }, { status: 401 });
      if (!checkCsrfOrigin(req)) return Response.json({ error: "Invalid origin." }, { status: 403 });
      return server?.upgrade(req, { data: { kind: "cdp-view" } }) ? undefined : Response.json({ error: "WebSocket upgrade failed." }, { status: 400 });
    }
    if (pathname === "/terminal/ws") {
      return this.handleTerminalWebSocketUpgrade(req, server);
    }
    if (pathname === "/vnc/ws") {
      return this.handleVncWebSocketUpgrade(req, server);
    }
    return this.deps.handleRequest(req);
  }

  handleTerminalWebSocketUpgrade(req: Request, server?: Bun.Server<WebSocketSessionData>): Response | undefined {
    if (readAccessConfig().mode !== "single-user") return this.denyMultiUserUpgrade();
    if (!this.deps.webRuntimeConfig.terminalEnabled) {
      return this.deps.json({ error: "Web terminal is disabled." }, 404);
    }
    const url = new URL(req.url);
    const handoffToken = url.searchParams.get("handoff")?.trim() || "";
    const authEnabled = this.deps.authGateway.isAuthEnabled();
    if (authEnabled && !this.deps.authGateway.isAuthenticated(req)) {
      return this.deps.json({ error: "Unauthorized" }, 401);
    }
    if (!checkCsrfOrigin(req)) {
      return this.deps.json({ error: "Origin not allowed" }, 403);
    }
    const owner = this.deps.terminalService.resolveOwnerFromRequest(req, !authEnabled);
    if (!owner) {
      return this.deps.json({ error: "Unauthorized" }, 401);
    }
    owner.handoffToken = handoffToken || null;
    if (!server?.upgrade(req, { data: owner })) {
      return this.deps.json({ error: "WebSocket upgrade failed" }, 400);
    }
    return undefined;
  }

  async syncWorkspaceWatcher(): Promise<void> {
    this.workspaceWatcherSyncPromise = this.workspaceWatcherSyncPromise
      .then(async () => {
        if (!this.accepting) return;
        const visible = this.deps.getWorkspaceVisible();
        const showHidden = this.deps.getWorkspaceShowHidden();
        if (!visible) {
          if (this.workspaceWatcher) {
            await this.workspaceWatcher.close();
            this.workspaceWatcher = null;
            this.workspaceWatcherShowHidden = null;
            this.logger.info("Workspace watcher disabled", {
              operation: "workspace_watcher.disable",
            });
          }
          return;
        }

        if (this.workspaceWatcher && this.workspaceWatcherShowHidden === showHidden) {
          return;
        }

        if (this.workspaceWatcher) {
          await this.workspaceWatcher.close();
          this.workspaceWatcher = null;
          this.workspaceWatcherShowHidden = null;
          this.logger.info("Workspace watcher restarting", {
            operation: "workspace_watcher.restart",
            showHidden,
          });
        } else {
          this.logger.info("Workspace watcher enabling", {
            operation: "workspace_watcher.enable",
            showHidden,
          });
        }

        if (!this.accepting) return;
        this.workspaceWatcher = this.deps.startWorkspaceWatcher();
        this.workspaceWatcherShowHidden = showHidden;
      })
      .catch((err) => {
        this.logger.error("Failed to synchronize workspace watcher", {
          operation: "workspace_watcher.sync",
          err,
        });
      });
    await this.workspaceWatcherSyncPromise;
  }

  async handleVncWebSocketUpgrade(req: Request, server?: Bun.Server<WebSocketSessionData>): Promise<Response | undefined> {
    if (readAccessConfig().mode !== "single-user") return this.denyMultiUserUpgrade();
    const url = new URL(req.url);
    const targetId = url.searchParams.get("target")?.trim() || "";
    const handoffToken = url.searchParams.get("handoff")?.trim() || "";
    if (!targetId) {
      return this.deps.json({ error: "Missing VNC target." }, 400);
    }
    const authEnabled = this.deps.authGateway.isAuthEnabled();
    if (authEnabled && !this.deps.authGateway.isAuthenticated(req)) {
      return this.deps.json({ error: "Unauthorized" }, 401);
    }
    if (!checkCsrfOrigin(req)) {
      return this.deps.json({ error: "Origin not allowed" }, 403);
    }
    const prepared = await this.deps.vncService.prepareTargetReference(targetId);
    if (!prepared.ok) {
      return this.deps.json({
        error: prepared.error || "Unknown or disallowed VNC target",
        missing_dependencies: prepared.missingDependencies ?? [],
        platform: prepared.platform ?? process.platform,
      }, targetId === "cdp-browser" ? 503 : 401);
    }
    const owner = this.deps.vncService.resolveOwnerFromRequest(req, targetId, !authEnabled);
    if (!owner) {
      return this.deps.json({ error: "Unauthorized or unknown/disallowed VNC target" }, 401);
    }
    owner.handoffToken = handoffToken || null;
    if (!server?.upgrade(req, { data: owner })) {
      return this.deps.json({ error: "WebSocket upgrade failed" }, 400);
    }
    return undefined;
  }

  private async loadTlsOptions(): Promise<{ cert: string; key: string } | null> {
    if (!this.deps.webServerConfig.tlsCert || !this.deps.webServerConfig.tlsKey) return null;
    try {
      const [cert, key] = await Promise.all([
        this.readTextFile(this.deps.webServerConfig.tlsCert),
        this.readTextFile(this.deps.webServerConfig.tlsKey),
      ]);
      return { cert, key };
    } catch (error) {
      this.logger.error("Failed to load TLS cert/key", {
        operation: "load_tls_options",
        err: error,
      });
      return null;
    }
  }

  private get logger(): LoggerLike {
    return this.deps.log ?? log;
  }

  private get serve(): typeof Bun.serve {
    return this.deps.serve ?? Bun.serve;
  }

  private async readTextFile(path: string): Promise<string> {
    if (this.deps.readTextFile) {
      return this.deps.readTextFile(path);
    }
    return Bun.file(path).text();
  }

  private async sleep(ms: number): Promise<void> {
    const signal = this.startupAbort.signal;
    if (signal.aborted) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort!: () => void;
    const aborted = new Promise<void>(resolve => {
      onAbort = resolve;
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      const sleeping = this.deps.sleep
        ? this.deps.sleep(ms, signal)
        : new Promise<void>(resolve => { timer = setTimeout(resolve, ms); });
      await Promise.race([sleeping, aborted]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
  }

  private setInterval(handler: TimerHandler, timeout?: number): unknown {
    return (this.deps.setInterval ?? globalThis.setInterval)(handler, timeout as number);
  }

  private clearInterval(timer: unknown): void {
    (this.deps.clearInterval ?? globalThis.clearInterval)(timer as never);
  }
}
