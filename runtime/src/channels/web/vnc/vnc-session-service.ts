import { createConnection, type Socket } from "node:net";
import type { ServerWebSocket } from "bun";

import { DEFAULT_WEB_USER_ID, getWebSession } from "../../../db.js";
import { getWebRuntimeConfig } from "../../../core/config.js";
import { createLogger, debugSuppressedError } from "../../../utils/logger.js";
import { WebSocketTcpBridge } from "../remote-display/websocket-tcp-bridge.js";
import { getSessionTokenFromRequest } from "../auth/session-auth.js";
import {
  MANAGED_CDP_VNC_TARGET_ID,
  ManagedCdpBrowserDesktop,
  type ManagedCdpBrowserDesktopOptions,
  type ManagedCdpBrowserPrepareResult,
} from "./managed-cdp-browser-desktop.js";

/** Allowlisted or direct-connect VNC target metadata. */
export interface VncTargetRecord {
  /** Stable target identifier used in API payloads and websocket ownership checks. */
  id: string;
  /** Human-readable label shown in the web UI target picker. */
  label: string;
  /** TCP host or IP address used for the upstream VNC socket connection. */
  host: string;
  /** TCP port used for the upstream VNC socket connection. */
  port: number;
  /** Whether the target should be presented as read-only in the UI. */
  readOnly?: boolean;
}

/** Ownership metadata stored on VNC websocket sessions and handoff tokens. */
export interface VncSessionOwner {
  /** Discriminator used by shared websocket bridge owner records. */
  kind: "vnc";
  /** Session or fallback token associated with the websocket owner. */
  token: string;
  /** Web user id associated with the session owner. */
  userId: string;
  /** Resolved VNC target id attached to the websocket session. */
  targetRef: string;
  /** Optional handoff token used when reattaching an existing session. */
  handoffToken?: string | null;
}

/** Websocket data payload carried by VNC websocket sessions. */
export type VncSocketData = VncSessionOwner;

/** Construction options for the VNC websocket/session bridge service. */
export interface VncSessionServiceOptions {
  /** Optional explicit allowlist of VNC targets, overriding env-based target parsing. */
  targets?: VncTargetRecord[];
  /** Whether host:port direct-connect targets may be used in addition to allowlisted targets. */
  allowDirectTargets?: boolean;
  /** Maximum time to wait for the upstream TCP socket to connect before aborting. */
  connectTimeoutMs?: number;
  /** Time-to-live for generated websocket handoff tokens in milliseconds. */
  handoffTtlMs?: number;
  /** Optional socket factory override for tests or custom transports. */
  createSocket?: (target: VncTargetRecord) => Socket;
  /** Optional managed CDP browser desktop override for tests. */
  managedCdpBrowserDesktop?: Pick<ManagedCdpBrowserDesktop, "prepare" | "shutdown">;
  /** Managed CDP browser desktop construction overrides. */
  managedCdpBrowserDesktopOptions?: ManagedCdpBrowserDesktopOptions;
}

export type VncTargetPreparationResult =
  | { ok: true; target: VncTargetRecord }
  | { ok: false; error: string; missingDependencies: string[]; platform: NodeJS.Platform };

const FALLBACK_VNC_OWNER = {
  token: "web-vnc-local-default",
  userId: DEFAULT_WEB_USER_ID,
};
const DEFAULT_VNC_HANDOFF_TTL_MS = 15_000;
const log = createLogger("web.vnc-session-service");

function sanitizeId(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "target";
}

function toPort(value: unknown): number | null {
  const port = typeof value === "number" ? value : parseInt(String(value || ""), 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) return null;
  return port;
}

function parseTargetRecord(input: unknown, fallbackId?: string): VncTargetRecord | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const id = sanitizeId(String(record.id || fallbackId || ""));
  const label = String(record.label || id || "VNC target").trim() || id;
  const host = String(record.host || "").trim();
  const port = toPort(record.port);
  if (!id || !host || port === null) return null;
  return {
    id,
    label,
    host,
    port,
    readOnly: Boolean(record.readOnly ?? record.read_only ?? false),
  };
}

function sanitizeDirectHost(host: string): string | null {
  const value = String(host || "").trim();
  if (!value || value.length > 255) return null;
  if (/[\s/?#\\]/.test(value)) return null;
  if (/^[a-z0-9._-]+$/i.test(value)) return value;
  if (/^[a-f0-9:]+$/i.test(value)) return value;
  return null;
}

/**
 * Parse a direct-connect VNC reference like `192.168.1.10:5901` or `[fd00::1]:5901`.
 * @param input Raw target reference supplied by the caller.
 * @returns A normalized direct-connect target record when the reference is valid, otherwise null.
 */
export function parseDirectVncTargetReference(input: string | null | undefined): VncTargetRecord | null {
  const text = String(input || "").trim();
  if (!text) return null;

  const ipv6Match = /^\[([^\]]+)\]:(\d+)$/.exec(text);
  const parsed = ipv6Match
    ? {
        host: sanitizeDirectHost(ipv6Match[1]) || "",
        displayHost: `[${ipv6Match[1]}]`,
        portText: ipv6Match[2],
      }
    : (() => {
        const firstColon = text.indexOf(":");
        const lastColon = text.lastIndexOf(":");
        if (firstColon <= 0 || firstColon !== lastColon) return null;
        const host = sanitizeDirectHost(text.slice(0, lastColon)) || "";
        return {
          host,
          displayHost: host,
          portText: text.slice(lastColon + 1),
        };
      })();

  if (!parsed) return null;

  const { host, displayHost, portText } = parsed;
  const port = toPort(portText);
  if (!host || !displayHost || port === null) return null;
  const endpoint = `${displayHost}:${port}`;
  return {
    id: endpoint,
    label: endpoint,
    host,
    port,
    readOnly: false,
  };
}

/**
 * Parse allowlisted VNC targets from JSON env/config text.
 * @param raw JSON text containing an object or array of VNC target definitions.
 * @returns Normalized allowlisted targets, or an empty array when parsing fails.
 */
export function parseVncTargets(raw?: string | null): VncTargetRecord[] {
  const text = String(raw || "").trim();
  if (!text) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    debugSuppressedError(log, "failed to parse configured VNC targets", error);
    return [];
  }

  const targets: VncTargetRecord[] = [];
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const target = parseTargetRecord(item);
      if (target) targets.push(target);
    }
    return targets;
  }

  if (parsed && typeof parsed === "object") {
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const target = parseTargetRecord(value, id);
      if (target) targets.push(target);
    }
  }
  return targets;
}

function defaultCreateSocket(target: VncTargetRecord): Socket {
  return createConnection({ host: target.host, port: target.port });
}

function createHandoffToken(): string {
  try {
    return crypto.randomUUID();
  } catch (error) {
    debugSuppressedError(log, "crypto.randomUUID unavailable for VNC handoff token", error);
    return `vnc-handoff-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Manages allowlisted/direct VNC target metadata and per-websocket TCP bridge sessions. */
export class VncSessionService {
  private readonly targets = new Map<string, VncTargetRecord>();
  private readonly allowDirectTargetsOverride: boolean | null;
  private readonly createSocket: (target: VncTargetRecord) => Socket;
  private readonly connectTimeoutMs: number;
  private readonly handoffTtlMs: number;
  private readonly bridge: WebSocketTcpBridge<VncSocketData, VncTargetRecord>;
  private readonly managedCdpBrowserDesktop: Pick<ManagedCdpBrowserDesktop, "prepare" | "shutdown">;
  private managedCdpBrowserTarget: VncTargetRecord | null = null;

  /**
   * Create a VNC websocket/session bridge service.
   * @param options Optional target, timeout, and socket-factory overrides.
   */
  constructor(options: VncSessionServiceOptions = {}) {
    const webRuntimeConfig = getWebRuntimeConfig();
    const configured = options.targets || parseVncTargets(webRuntimeConfig.vncTargetsRaw || "");
    for (const target of configured) {
      this.targets.set(target.id, target);
    }
    this.allowDirectTargetsOverride = typeof options.allowDirectTargets === "boolean"
      ? options.allowDirectTargets
      : null;
    this.createSocket = options.createSocket || defaultCreateSocket;
    this.connectTimeoutMs = Number.isFinite(options.connectTimeoutMs)
      ? Math.max(1, Number(options.connectTimeoutMs))
      : 10_000;
    this.handoffTtlMs = Number.isFinite(options.handoffTtlMs)
      ? Math.max(1, Number(options.handoffTtlMs))
      : DEFAULT_VNC_HANDOFF_TTL_MS;
    this.managedCdpBrowserDesktop = options.managedCdpBrowserDesktop
      ?? new ManagedCdpBrowserDesktop(options.managedCdpBrowserDesktopOptions);
    this.bridge = new WebSocketTcpBridge<VncSocketData, VncTargetRecord>({
      createSocket: (target) => this.createSocketWithHandshakeTimeout(target),
      onConnect: (ws, target) => {
        try {
          ws.send(JSON.stringify({ type: "vnc.connected", target: { id: target.id, label: target.label } }));
        } catch (error) {
          debugSuppressedError(log, "failed to send VNC connect acknowledgement", error, { targetId: target.id });
        }
      },
      onError: (ws, _target, error) => {
        try {
          ws.send(JSON.stringify({ type: "vnc.error", error: error.message || String(error) }));
        } catch (sendError) {
          debugSuppressedError(log, "failed to send VNC upstream error to client", sendError, { upstreamError: error.message || String(error) });
        }
      },
      handleControlMessage: (ws, message) => {
        try {
          const payload = JSON.parse(message) as { type?: string };
          if (payload?.type === "ping") {
            try {
              ws.send(JSON.stringify({ type: "pong" }));
            } catch (error) {
              debugSuppressedError(log, "failed to send VNC pong", error);
            }
            return true;
          }
        } catch (error) {
          debugSuppressedError(log, "VNC control frame was not JSON; forwarding upstream", error);
        }
        return false;
      },
    });
  }

  private createSocketWithHandshakeTimeout(target: VncTargetRecord): Socket {
    const socket = this.createSocket(target);
    let cleared = false;
    const clear = () => {
      if (cleared) return;
      cleared = true;
      clearTimeout(timer);
    };
    const timer = setTimeout(() => {
      try {
        socket.destroy(new Error(`Timed out connecting to VNC target ${target.label || target.id}.`));
      } catch (error) {
        debugSuppressedError(log, "failed to destroy timed-out VNC socket", error, { targetId: target.id, targetLabel: target.label || target.id });
      }
    }, this.connectTimeoutMs);
    socket.once("data", clear);
    socket.once("error", clear);
    socket.once("close", clear);
    return socket;
  }

  /**
   * Report whether direct host:port VNC targets are enabled.
   * @returns True when direct-connect targets are permitted.
   */
  private getAllowDirectTargets(): boolean {
    if (typeof this.allowDirectTargetsOverride === "boolean") return this.allowDirectTargetsOverride;
    return getWebRuntimeConfig().vncAllowDirect;
  }

  isDirectConnectEnabled(): boolean {
    return this.getAllowDirectTargets();
  }

  /**
   * List sanitized allowlisted targets safe for UI exposure.
   * @returns Allowlisted targets without host/port details.
   */
  getTargets(): Array<Pick<VncTargetRecord, "id" | "label" | "readOnly">> {
    const targets = Array.from(this.targets.values());
    if (this.managedCdpBrowserTarget && !this.targets.has(MANAGED_CDP_VNC_TARGET_ID)) targets.push(this.managedCdpBrowserTarget);
    return targets.map((target) => ({
      id: target.id,
      label: target.label,
      readOnly: Boolean(target.readOnly),
    }));
  }

  /**
   * Resolve an allowlisted VNC target by id.
   * @param targetId Caller-supplied target identifier.
   * @returns The matching allowlisted target, or null when not found.
   */
  getTarget(targetId: string): VncTargetRecord | null {
    const normalized = sanitizeId(targetId);
    const configured = this.targets.get(normalized);
    if (configured) return configured;
    if (normalized === MANAGED_CDP_VNC_TARGET_ID) return this.managedCdpBrowserTarget;
    return null;
  }

  /** Prepare a stable target before session metadata or websocket ownership is resolved. */
  async prepareTargetReference(targetRef: string): Promise<VncTargetPreparationResult> {
    const normalized = sanitizeId(targetRef);
    const configured = this.targets.get(normalized);
    if (configured) return { ok: true, target: configured };
    if (normalized !== MANAGED_CDP_VNC_TARGET_ID) {
      const target = this.resolveTargetReference(targetRef);
      return target
        ? { ok: true, target }
        : { ok: false, error: "Unknown or disallowed VNC target", missingDependencies: [], platform: process.platform };
    }

    const prepared: ManagedCdpBrowserPrepareResult = await this.managedCdpBrowserDesktop.prepare();
    if (!prepared.ok) {
      this.managedCdpBrowserTarget = null;
      return prepared;
    }
    this.managedCdpBrowserTarget = prepared.target;
    return { ok: true, target: prepared.target };
  }

  /**
   * Resolve either an allowlisted target id or an optional direct-connect reference.
   * @param targetRef Target id or direct host:port reference.
   * @returns The normalized target record when allowed and valid, otherwise null.
   */
  resolveTargetReference(targetRef: string): VncTargetRecord | null {
    const allowlisted = this.getTarget(targetRef);
    if (allowlisted) return allowlisted;
    if (!this.getAllowDirectTargets()) return null;
    return parseDirectVncTargetReference(targetRef);
  }

  /**
   * Resolve websocket owner metadata for a request targeting a VNC endpoint.
   * @param req Incoming HTTP request carrying session cookies or query auth.
   * @param targetRef Target id or direct-connect reference being requested.
   * @param allowUnauthenticated Whether fallback local-owner access is allowed.
   * @returns Owner metadata for the request when authorized, otherwise null.
   */
  resolveOwnerFromRequest(req: Request, targetRef: string, allowUnauthenticated = false): VncSessionOwner | null {
    const target = this.resolveTargetReference(targetRef);
    if (!target) return null;

    const token = getSessionTokenFromRequest(req);
    if (token) {
      const session = getWebSession(token);
      if (session) {
        return { kind: "vnc", token, userId: session.user_id, targetRef: target.id, handoffToken: null };
      }
    }

    if (!allowUnauthenticated) return null;
    return { kind: "vnc", token: FALLBACK_VNC_OWNER.token, userId: FALLBACK_VNC_OWNER.userId, targetRef: target.id, handoffToken: null };
  }

  private matchesOwner(left: VncSessionOwner | null | undefined, right: VncSessionOwner | null | undefined): boolean {
    if (!left || !right) return false;
    return left.kind === "vnc"
      && right.kind === "vnc"
      && left.token === right.token
      && left.userId === right.userId
      && left.targetRef === right.targetRef;
  }

  /**
   * Create a websocket handoff token for an existing VNC connection owned by the request.
   * @param req Incoming HTTP request carrying session cookies or query auth.
   * @param targetRef Target id or direct-connect reference being handed off.
   * @param allowUnauthenticated Whether fallback local-owner access is allowed.
   * @returns A handoff token payload when a matching live connection exists, otherwise null.
   */
  createHandoffFromRequest(req: Request, targetRef: string, allowUnauthenticated = false): { token: string; expires_at: string } | null {
    const owner = this.resolveOwnerFromRequest(req, targetRef, allowUnauthenticated);
    if (!owner) return null;
    const record = this.bridge.findConnection((entry) => this.matchesOwner(entry.owner as VncSessionOwner, owner));
    if (!record) return null;
    const token = createHandoffToken();
    const prepared = this.bridge.prepareHandoff(record, token, this.handoffTtlMs);
    if (!prepared) return null;
    return {
      token,
      expires_at: new Date(Date.now() + this.handoffTtlMs).toISOString(),
    };
  }

  /**
   * Build the UI-facing VNC session metadata payload.
   * @param targetRef Optional target id/reference to resolve and describe in the response.
   * @returns Transport metadata, allowlist exposure, and optional target details for the UI.
   */
  getSessionInfo(targetRef?: string | null) {
    const allowDirectTargets = this.getAllowDirectTargets();
    const target = targetRef ? this.resolveTargetReference(targetRef) : null;
    const isManagedTarget = target?.id === MANAGED_CDP_VNC_TARGET_ID;
    const isDirectTarget = Boolean(target && !isManagedTarget && !this.targets.has(target.id));
    return {
      enabled: this.targets.size > 0 || allowDirectTargets || Boolean(this.managedCdpBrowserTarget),
      transport: "websocket",
      ws_path: "/vnc/ws",
      renderer: "placeholder",
      host_policy: allowDirectTargets ? "allowlist+direct-opt-in" : "allowlist",
      direct_connect_enabled: allowDirectTargets,
      targets: this.getTargets(),
      ...(target ? {
        target: {
          id: target.id,
          label: target.label,
          read_only: Boolean(target.readOnly),
          direct_connect: isDirectTarget,
          ...(isManagedTarget ? { managed: true } : {}),
        },
      } : {}),
    };
  }

  /**
   * Attach a websocket client to a VNC bridge connection or handoff session.
   * @param ws Connected websocket carrying VNC owner metadata in `ws.data`.
   * @returns Nothing.
   */
  attachClient(ws: ServerWebSocket<VncSocketData>): void {
    const target = this.resolveTargetReference(ws.data.targetRef);
    if (!target) {
      try {
        ws.close(1008, "Unknown VNC target.");
      } catch (error) {
        debugSuppressedError(log, "failed to close websocket for unknown VNC target", error, { targetRef: ws.data.targetRef });
      }
      return;
    }

    const handoffToken = String(ws.data.handoffToken || "").trim();
    if (handoffToken) {
      const handoffRecord = this.bridge.getHandoffRecord(handoffToken);
      const handoffOwner = handoffRecord?.owner as VncSessionOwner | undefined;
      const sameOwner = this.matchesOwner(handoffOwner, ws.data);
      const sameTarget = Boolean(handoffRecord && (handoffRecord.target as VncTargetRecord)?.id === target.id);
      if (!handoffRecord || !sameOwner || !sameTarget) {
        try {
          ws.close(1008, "Invalid or expired VNC handoff.");
        } catch (error) {
          debugSuppressedError(log, "failed to close websocket for invalid VNC handoff", error, { targetRef: ws.data.targetRef });
        }
        return;
      }
      this.bridge.attachClient(ws, target, { handoffToken });
      return;
    }

    this.bridge.attachClient(ws, target);
  }

  /**
   * Forward an inbound websocket frame to the VNC bridge.
   * @param ws Connected websocket carrying VNC owner metadata.
   * @param message Raw websocket frame payload.
   * @returns Nothing.
   */
  handleMessage(ws: ServerWebSocket<VncSocketData>, message: string | Buffer | Uint8Array): void {
    this.bridge.handleMessage(ws, message);
  }

  /**
   * Detach a websocket client from the VNC bridge.
   * @param ws Connected websocket to remove.
   * @returns Nothing.
   */
  detachClient(ws: ServerWebSocket<VncSocketData>): void {
    this.bridge.detachClient(ws);
  }

  /**
   * Shut down all active VNC bridge sessions managed by this service.
   * @returns Nothing.
   */
  shutdown(): void {
    this.bridge.shutdown();
    this.managedCdpBrowserTarget = null;
    this.managedCdpBrowserDesktop.shutdown();
  }
}
