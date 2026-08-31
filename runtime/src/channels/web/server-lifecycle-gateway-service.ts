import { initTheme } from "@earendil-works/pi-coding-agent";
import type { ServerWebSocket } from "bun";

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

export type WebSocketSessionData = TerminalSocketData | VncSocketData;

interface JsonResponder {
  json(payload: unknown, status?: number): Response;
}

interface AuthGatewayLike {
  isAuthEnabled(): boolean;
  isAuthenticated(req: Request): boolean;
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
  sleep?: (ms: number) => Promise<unknown>;
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
  private workspaceWatcherShowHidden: boolean | null = null;
  private workspaceWatcherSyncPromise: Promise<void> = Promise.resolve();

  constructor(private readonly deps: WebServerLifecycleGatewayDeps) {}

  async start(): Promise<void> {
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

    let lastBindError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_BIND_ATTEMPTS; attempt++) {
      try {
        this.server = this.serve<WebSocketSessionData>({
          hostname: this.deps.webServerConfig.host,
          port: this.deps.webServerConfig.port,
          reusePort: true,
          idleTimeout: this.deps.webServerConfig.idleTimeout,
          maxRequestBodySize: 512 * 1024 * 1024,
          fetch: (req, server) => this.handleFetch(req, server),
          websocket: {
            open: (ws) => {
              if (ws.data?.kind === "vnc") {
                this.deps.vncService.attachClient(ws as ServerWebSocket<VncSocketData>);
                return;
              }
              this.deps.terminalService.attachClient(ws as ServerWebSocket<TerminalSocketData>);
            },
            message: (ws, message) => {
              if (ws.data?.kind === "vnc") {
                this.deps.vncService.handleMessage(ws as ServerWebSocket<VncSocketData>, message as any);
                return;
              }
              this.deps.terminalService.handleMessage(ws as ServerWebSocket<TerminalSocketData>, message as any);
            },
            close: (ws) => {
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
          continue;
        }
        throw err;
      }
    }

    if (lastBindError) throw lastBindError;

    await this.syncWorkspaceWatcher();
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

  async stop(): Promise<void> {
    this.deps.sse.closeAll();
    this.deps.uiBridge.stop();
    this.deps.terminalService.shutdown();
    this.deps.vncService.shutdown();
    if (this.linkPreviewCachePurgeTimer) {
      this.clearInterval(this.linkPreviewCachePurgeTimer);
      this.linkPreviewCachePurgeTimer = null;
    }
    this.server?.stop(true);
    this.server = null;
    await this.workspaceWatcherSyncPromise;
    if (this.workspaceWatcher) {
      await this.workspaceWatcher.close();
      this.workspaceWatcher = null;
      this.workspaceWatcherShowHidden = null;
    }
  }

  async handleFetch(req: Request, server?: Bun.Server<WebSocketSessionData>): Promise<Response | undefined> {
    const pathname = new URL(req.url).pathname;
    if (pathname === "/terminal/ws") {
      return this.handleTerminalWebSocketUpgrade(req, server);
    }
    if (pathname === "/vnc/ws") {
      return this.handleVncWebSocketUpgrade(req, server);
    }
    return this.deps.handleRequest(req);
  }

  handleTerminalWebSocketUpgrade(req: Request, server?: Bun.Server<WebSocketSessionData>): Response | undefined {
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
    await (this.deps.sleep ? this.deps.sleep(ms) : Bun.sleep(ms));
  }

  private setInterval(handler: TimerHandler, timeout?: number): unknown {
    return (this.deps.setInterval ?? globalThis.setInterval)(handler, timeout as number);
  }

  private clearInterval(timer: unknown): void {
    (this.deps.clearInterval ?? globalThis.clearInterval)(timer as never);
  }
}
