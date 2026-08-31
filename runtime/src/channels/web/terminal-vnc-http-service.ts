import type { TerminalSocketData } from "./terminal/terminal-session-service.js";
import { checkCsrfOrigin as defaultCheckCsrfOrigin } from "./http/security.js";

type JsonObject = Record<string, unknown>;

interface JsonResponder {
  json(payload: unknown, status?: number): Response;
}

interface AuthGatewayLike {
  isAuthEnabled(): boolean;
  isAuthenticated(req: Request): boolean;
}

interface TerminalOwnerLike {
  token: string;
  userId: string;
}

interface TerminalHandoffLike {
  token: string;
  expires_at: string;
}

interface TerminalServiceLike {
  resolveOwnerFromRequest(req: Request, allowUnauthenticated?: boolean): TerminalSocketData | null;
  getSessionInfo(owner: TerminalOwnerLike): JsonObject;
  createHandoffFromRequest(req: Request, allowUnauthenticated?: boolean): TerminalHandoffLike | null;
}

interface VncTargetLike {
  id: string;
}

interface VncHandoffLike {
  token: string;
  expires_at: string;
}

interface VncTargetPreparationLike {
  ok: boolean;
  target?: VncTargetLike;
  error?: string;
  missingDependencies?: string[];
  platform?: NodeJS.Platform;
}

interface VncServiceLike {
  prepareTargetReference(targetId: string): Promise<VncTargetPreparationLike>;
  resolveTargetReference(targetId: string): VncTargetLike | null;
  getSessionInfo(targetRef?: string | null): JsonObject;
  createHandoffFromRequest(req: Request, targetRef: string, allowUnauthenticated?: boolean): VncHandoffLike | null;
}

export interface WebTerminalVncHttpServiceDeps extends JsonResponder {
  webRuntimeConfig: {
    terminalEnabled: boolean;
  };
  authGateway: AuthGatewayLike;
  terminalService: TerminalServiceLike;
  vncService: VncServiceLike;
  checkCsrfOrigin?: (req: Request) => boolean;
}

export interface WebTerminalVncHttpChannel extends JsonResponder {
  authGateway: AuthGatewayLike;
  terminalService: TerminalServiceLike;
  vncService: VncServiceLike;
}

export type WebTerminalVncHttpServiceSurface = Pick<
  WebTerminalVncHttpService,
  "handleTerminalSession" | "handleTerminalHandoff" | "handleVncSession" | "handleVncHandoff"
>;

export function createWebTerminalVncHttpService(
  channel: WebTerminalVncHttpChannel,
  configs: Pick<WebTerminalVncHttpServiceDeps, "webRuntimeConfig">
): WebTerminalVncHttpService {
  return new WebTerminalVncHttpService({
    ...configs,
    json: (payload, status = 200) => channel.json(payload, status),
    authGateway: channel.authGateway,
    terminalService: channel.terminalService,
    vncService: channel.vncService,
  });
}

export class WebTerminalVncHttpService {
  constructor(private readonly deps: WebTerminalVncHttpServiceDeps) {}

  handleTerminalSession(req: Request): Response {
    if (!this.deps.webRuntimeConfig.terminalEnabled) {
      return this.deps.json({ enabled: false, error: "Web terminal is disabled." }, 200);
    }
    const authEnabled = this.deps.authGateway.isAuthEnabled();
    if (authEnabled && !this.deps.authGateway.isAuthenticated(req)) {
      return this.deps.json({ error: "Unauthorized" }, 401);
    }
    const owner = this.deps.terminalService.resolveOwnerFromRequest(req, !authEnabled);
    if (!owner) {
      return this.deps.json({ error: "Unauthorized" }, 401);
    }
    return this.deps.json(this.deps.terminalService.getSessionInfo(owner));
  }

  async handleTerminalHandoff(req: Request): Promise<Response> {
    if (!this.deps.webRuntimeConfig.terminalEnabled) {
      return this.deps.json({ error: "Web terminal is disabled." }, 404);
    }
    const authEnabled = this.deps.authGateway.isAuthEnabled();
    if (authEnabled && !this.deps.authGateway.isAuthenticated(req)) {
      return this.deps.json({ error: "Unauthorized" }, 401);
    }
    if (!this.checkCsrfOrigin(req)) {
      return this.deps.json({ error: "Origin not allowed" }, 403);
    }
    const handoff = this.deps.terminalService.createHandoffFromRequest(req, !authEnabled);
    if (!handoff) {
      return this.deps.json({ error: "No live terminal session is available to transfer." }, 409);
    }
    return this.deps.json({ ok: true, handoff }, 200);
  }

  async handleVncSession(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const targetId = url.searchParams.get("target")?.trim() || "";
    const authEnabled = this.deps.authGateway.isAuthEnabled();
    if (authEnabled && !this.deps.authGateway.isAuthenticated(req)) {
      return this.deps.json({ error: "Unauthorized" }, 401);
    }
    if (targetId) {
      const prepared = await this.deps.vncService.prepareTargetReference(targetId);
      if (!prepared.ok) {
        const managedUnavailable = targetId === "cdp-browser";
        return this.deps.json({
          error: prepared.error || "Unknown or disallowed VNC target",
          ...(managedUnavailable ? {
            missing_dependencies: prepared.missingDependencies ?? [],
            platform: prepared.platform ?? process.platform,
          } : {}),
          ...this.deps.vncService.getSessionInfo(),
        }, managedUnavailable ? 503 : 404);
      }
    }
    return this.deps.json(this.deps.vncService.getSessionInfo(targetId || null), 200);
  }

  async handleVncHandoff(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const targetId = url.searchParams.get("target")?.trim() || "";
    if (!targetId) {
      return this.deps.json({ error: "Missing VNC target." }, 400);
    }
    const authEnabled = this.deps.authGateway.isAuthEnabled();
    if (authEnabled && !this.deps.authGateway.isAuthenticated(req)) {
      return this.deps.json({ error: "Unauthorized" }, 401);
    }
    if (!this.checkCsrfOrigin(req)) {
      return this.deps.json({ error: "Origin not allowed" }, 403);
    }
    const prepared = await this.deps.vncService.prepareTargetReference(targetId);
    if (!prepared.ok) {
      const managedUnavailable = targetId === "cdp-browser";
      return this.deps.json({
        error: prepared.error || "Unknown or disallowed VNC target",
        ...(managedUnavailable ? {
          missing_dependencies: prepared.missingDependencies ?? [],
          platform: prepared.platform ?? process.platform,
        } : {}),
        ...this.deps.vncService.getSessionInfo(),
      }, managedUnavailable ? 503 : 404);
    }
    const handoff = this.deps.vncService.createHandoffFromRequest(req, targetId, !authEnabled);
    if (!handoff) {
      return this.deps.json({ error: "No live VNC session is available to transfer." }, 409);
    }
    return this.deps.json({ ok: true, handoff }, 200);
  }

  private checkCsrfOrigin(req: Request): boolean {
    return (this.deps.checkCsrfOrigin ?? defaultCheckCsrfOrigin)(req);
  }
}
