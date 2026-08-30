/** Guarded unauthenticated HTTP routes for installed startup add-ons. */

import { createLogger, debugSuppressedError } from "../utils/logger.js";
import { isRateLimited } from "../channels/web/http/rate-limit.js";

const log = createLogger("addons.external-routes");

const EXTERNAL_ROUTE_PREFIX = "/api/addons/";
const EXTERNAL_ROUTE_RATE_WINDOW_MS = 60_000;
const EXTERNAL_ROUTE_RATE_LIMIT = 120;
const MAX_EXTERNAL_ROUTE_BODY_BYTES = 64 * 1024 * 1024;
const ALLOWED_METHODS = new Set(["GET", "POST"]);

export interface ExternalAddonRouteHandlerContext {
  addonId: string;
  packageName: string;
  entryPath: string;
}

export type ExternalAddonRouteHandler = (
  req: Request,
  pathname: string,
  context: ExternalAddonRouteHandlerContext,
) => Response | Promise<Response>;

export interface ExternalAddonRouteRegistration {
  addonId: string;
  prefix: string;
  methods: string[];
  maxBodyBytes: number;
  /** Preserve the request stream for bounded binary uploads instead of buffering it in core. */
  bodyMode?: "buffer" | "stream";
  handler: ExternalAddonRouteHandler;
}

type ExternalAddonRegistrationOwner = {
  addonId: string;
  packageName: string;
  entryPath: string;
};

type RegisteredExternalAddonRoute = ExternalAddonRouteRegistration & {
  methods: string[];
  owner: ExternalAddonRegistrationOwner;
  registeredAt: string;
};

let currentOwner: ExternalAddonRegistrationOwner | null = null;
let frozen = false;
const routes: RegisteredExternalAddonRoute[] = [];

function jsonError(error: string, status: number, headers?: HeadersInit): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

function normalizeAddonId(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^[a-z0-9](?:[a-z0-9._-]{0,63})$/.test(normalized)) {
    throw new Error("External route add-on id must be a lowercase 1-64 character slug.");
  }
  return normalized;
}

export function deriveExternalAddonId(packageName: string): string {
  const basename = String(packageName || "").trim().split("/").pop() || "";
  const match = basename.match(/^piclaw-addon-([a-z0-9](?:[a-z0-9._-]{0,63})?)$/);
  if (!match) {
    throw new Error(`Package "${packageName}" must use the piclaw-addon-<id> naming convention to register external routes.`);
  }
  return normalizeAddonId(match[1]);
}

function normalizePrefix(value: unknown, addonId: string): string {
  const prefix = typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
  const base = `${EXTERNAL_ROUTE_PREFIX}${addonId}`;
  if (!prefix || (prefix !== base && !prefix.startsWith(`${base}/`))) {
    throw new Error(`External route prefix must be ${base} or a child path.`);
  }
  if (!/^\/api\/addons\/[a-z0-9._-]+(?:\/[A-Za-z0-9._~-]+)*$/.test(prefix)) {
    throw new Error("External route prefix contains unsupported path characters.");
  }
  return prefix;
}

function normalizeMethods(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("External route methods are required.");
  const methods = [...new Set(value.map((method) => String(method || "").trim().toUpperCase()).filter(Boolean))];
  if (methods.some((method) => !ALLOWED_METHODS.has(method))) {
    throw new Error("External routes support only GET and POST methods.");
  }
  return methods.sort();
}

function normalizeMaxBodyBytes(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_EXTERNAL_ROUTE_BODY_BYTES) {
    throw new Error(`External route maxBodyBytes must be an integer from 1 to ${MAX_EXTERNAL_ROUTE_BODY_BYTES}.`);
  }
  return parsed;
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function contentLength(req: Request): number | null {
  const raw = req.headers.get("content-length");
  if (raw === null || raw === "") return null;
  if (!/^\d+$/.test(raw.trim())) return Number.NaN;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : Number.NaN;
}

async function readBoundedBody(req: Request, maxBodyBytes: number): Promise<Uint8Array | Response> {
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBodyBytes) {
        try {
          await reader.cancel("request body limit exceeded");
        } catch (error) {
          debugSuppressedError(log, "Failed to cancel oversized external add-on request body stream.", error, {
            operation: "external_addon_routes.cancel_oversized_body",
            maxBodyBytes,
          });
        }
        return jsonError("Request body too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function boundedStreamingRequest(req: Request, maxBodyBytes: number): Request | Response {
  const declaredLength = contentLength(req);
  if (declaredLength !== null && !Number.isFinite(declaredLength)) return jsonError("Invalid Content-Length.", 400);
  if (declaredLength !== null && declaredLength > maxBodyBytes) return jsonError("Request body too large.", 413);
  if (req.method === "GET" || req.body === null) return req;
  let total = 0;
  const bounded = req.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > maxBodyBytes) {
        controller.error(new Error("Request body too large."));
        return;
      }
      controller.enqueue(chunk);
    },
  }));
  return new Request(req.url, { method: req.method, headers: new Headers(req.headers), body: bounded, duplex: "half" } as RequestInit & { duplex: "half" });
}

async function boundedRequest(req: Request, maxBodyBytes: number): Promise<Request | Response> {
  const declaredLength = contentLength(req);
  if (declaredLength !== null && !Number.isFinite(declaredLength)) return jsonError("Invalid Content-Length.", 400);
  if (declaredLength !== null && declaredLength > maxBodyBytes) return jsonError("Request body too large.", 413);
  if (req.method === "GET" || req.body === null) return req;

  const body = await readBoundedBody(req, maxBodyBytes);
  if (body instanceof Response) return body;
  return new Request(req.url, {
    method: req.method,
    headers: new Headers(req.headers),
    body: body.byteLength > 0 ? body.buffer as ArrayBuffer : undefined,
  });
}

/** Run one startup entry import with an immutable package-owner context. */
export async function withExternalAddonRegistrationContext<T>(
  input: { packageName: string; entryPath: string },
  run: () => Promise<T>,
): Promise<T> {
  if (currentOwner) throw new Error("Nested external add-on registration contexts are not supported.");
  const packageName = String(input.packageName || "").trim();
  const entryPath = String(input.entryPath || "").trim();
  const owner = { addonId: deriveExternalAddonId(packageName), packageName, entryPath };
  currentOwner = owner;
  try {
    return await run();
  } finally {
    currentOwner = null;
  }
}

/** Register one guarded route during the owning add-on's startup import. */
export function registerExternalAddonRoute(registration: ExternalAddonRouteRegistration): () => void {
  if (frozen) throw new Error("External add-on route registration is frozen after startup.");
  if (!currentOwner) throw new Error("External add-on routes can be registered only during a startup runtime entry import.");
  if (!registration || typeof registration !== "object" || typeof registration.handler !== "function") {
    throw new Error("External route handler is required.");
  }

  const addonId = normalizeAddonId(registration.addonId);
  if (addonId !== currentOwner.addonId) {
    throw new Error(`External route add-on id "${addonId}" does not match installed owner "${currentOwner.addonId}".`);
  }
  const prefix = normalizePrefix(registration.prefix, addonId);
  const methods = normalizeMethods(registration.methods);
  const maxBodyBytes = normalizeMaxBodyBytes(registration.maxBodyBytes);
  const existing = routes.find((route) => matchesPrefix(prefix, route.prefix) || matchesPrefix(route.prefix, prefix));
  if (existing) {
    throw new Error(
      `External route prefix "${prefix}" overlaps route "${existing.prefix}" registered by "${existing.owner.packageName}".`,
    );
  }

  const route: RegisteredExternalAddonRoute = {
    ...registration,
    addonId,
    prefix,
    methods,
    maxBodyBytes,
    owner: { ...currentOwner },
    registeredAt: new Date().toISOString(),
  };
  routes.push(route);
  log.info("Registered external add-on route", {
    operation: "external_addon_routes.register",
    addonId,
    packageName: currentOwner.packageName,
    prefix,
    methods,
    maxBodyBytes,
  });

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const index = routes.indexOf(route);
    if (index >= 0) routes.splice(index, 1);
  };
}

export function freezeExternalAddonRoutes(): void {
  frozen = true;
  log.info("External add-on route registry frozen", {
    operation: "external_addon_routes.freeze",
    routeCount: routes.length,
  });
}

export function isExternalAddonRouteRegistryFrozen(): boolean {
  return frozen;
}

export async function handleExternalAddonRoutes(req: Request, pathname: string): Promise<Response | null> {
  const route = routes.find((candidate) => matchesPrefix(pathname, candidate.prefix));
  if (!route) return null;

  if (!route.methods.includes(req.method.toUpperCase())) {
    return jsonError("Method not allowed.", 405, { Allow: route.methods.join(", ") });
  }
  if (isRateLimited(req, `external-addon/${route.addonId}`, EXTERNAL_ROUTE_RATE_WINDOW_MS, EXTERNAL_ROUTE_RATE_LIMIT)) {
    return jsonError("External add-on route rate limit exceeded.", 429, { "Retry-After": "60" });
  }

  const guarded = route.bodyMode === "stream"
    ? boundedStreamingRequest(req, route.maxBodyBytes)
    : await boundedRequest(req, route.maxBodyBytes);
  if (guarded instanceof Response) return guarded;

  try {
    return await route.handler(guarded, pathname, {
      addonId: route.addonId,
      packageName: route.owner.packageName,
      entryPath: route.owner.entryPath,
    });
  } catch (error) {
    log.error("External add-on route handler failed", {
      operation: "external_addon_routes.handle",
      addonId: route.addonId,
      prefix: route.prefix,
      err: error,
    });
    return jsonError("Internal server error.", 500);
  }
}

export function getRegisteredExternalAddonRoutes(): Array<{
  addonId: string;
  packageName: string;
  entryPath: string;
  prefix: string;
  methods: string[];
  maxBodyBytes: number;
  bodyMode: "buffer" | "stream";
  registeredAt: string;
}> {
  return routes.map((route) => ({
    addonId: route.addonId,
    packageName: route.owner.packageName,
    entryPath: route.owner.entryPath,
    prefix: route.prefix,
    methods: [...route.methods],
    maxBodyBytes: route.maxBodyBytes,
    bodyMode: route.bodyMode === "stream" ? "stream" : "buffer",
    registeredAt: route.registeredAt,
  }));
}

export function resetExternalAddonRoutesForTests(): void {
  routes.length = 0;
  currentOwner = null;
  frozen = false;
}
