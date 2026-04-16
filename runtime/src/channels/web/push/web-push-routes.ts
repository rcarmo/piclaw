/**
 * web/push/web-push-routes.ts – HTTP handlers for VAPID key discovery and subscription persistence.
 */

import {
  getStoredVapidPublicKey,
  removeStoredWebPushSubscription,
  upsertStoredWebPushSubscription,
} from "./web-push-store.js";

function resolveUserAgent(req: Request): string | null {
  const value = req.headers.get("user-agent");
  return value && value.trim() ? value.trim() : null;
}

function resolveDeviceId(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

export async function handleWebPushVapidPublicKey(options: { baseDir?: string } = {}): Promise<Response> {
  return Response.json({ publicKey: getStoredVapidPublicKey(options.baseDir) });
}

export async function handleWebPushSubscriptionUpsert(req: Request, options: { baseDir?: string } = {}): Promise<Response> {
  try {
    const body = await req.json().catch(() => null);
    const subscription = body && typeof body === "object" && body.subscription ? body.subscription : body;
    const stored = upsertStoredWebPushSubscription(subscription, {
      baseDir: options.baseDir,
      userAgent: resolveUserAgent(req),
      deviceId: resolveDeviceId((body as Record<string, unknown> | null)?.device_id ?? (body as Record<string, unknown> | null)?.deviceId),
    });
    return Response.json({ ok: true, endpoint: stored.endpoint, device_id: stored.deviceId });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid push subscription." }, { status: 400 });
  }
}

export async function handleWebPushSubscriptionDelete(req: Request, options: { baseDir?: string } = {}): Promise<Response> {
  const body = await req.json().catch(() => null);
  const subscription = body && typeof body === "object" && body.subscription ? body.subscription : body;
  const endpoint = typeof subscription?.endpoint === "string"
    ? subscription.endpoint.trim()
    : typeof body?.endpoint === "string"
      ? body.endpoint.trim()
      : "";

  if (!endpoint) {
    return Response.json({ error: "Missing push subscription endpoint." }, { status: 400 });
  }

  const removed = removeStoredWebPushSubscription(endpoint, options.baseDir);
  return Response.json({ ok: true, removed });
}
