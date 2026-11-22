/**
 * web/push/web-push-service.ts – outbound Web Push delivery helpers.
 */

import { createPrivateKey } from "node:crypto";

import { getWebRuntimeConfig } from "../../../core/config.js";
import { isSingleUserAccess } from "../../../core/config-access.js";
import type { InteractionRow } from "../../../db.js";
import { getDb } from "../../../db/connection.js";
import { getRootOwnership } from "../../../db/session-ownership.js";
import { createLogger, debugSuppressedError } from "../../../utils/logger.js";
import {
  ensureStoredVapidKeys,
  listStoredWebPushSubscriptions,
  pruneStoredWebPushSubscriptions,
  removeStoredWebPushSubscriptionAtomic,
  type StoredWebPushSubscription,
} from "./web-push-store.js";
import {
  webNotificationPresenceService,
  type WebNotificationPresenceService,
} from "./web-notification-presence-service.js";

const log = createLogger("web.push.service");
const DEFAULT_WEB_PUSH_REQUEST_TIMEOUT_MS = 15_000;
const AUTH_FAILURE_PRUNE_THRESHOLD = 3;
const SETUP_BREAKER_COOLDOWN_MS = 5 * 60 * 1000;
const DELIVERY_BREAKER_COOLDOWN_MS = 2 * 60 * 1000;

type WebPushBreakerState = {
  reason: Error;
  untilMs: number;
};

let disabledStoredWebPushSetupState: WebPushBreakerState | null = null;
const disabledStoredWebPushDeliveryStateByEndpoint = new Map<string, WebPushBreakerState>();
const authFailureCountsByEndpoint = new Map<string, number>();

export interface WebPushNotificationPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  sourceLabel?: string;
}

export interface StoredWebPushSendResult {
  attempted: number;
  sent: number;
  removed: number;
  failed: number;
}

export interface SendStoredWebPushNotificationOptions {
  baseDir?: string;
  vapidSubject?: string;
  chatJid?: string;
  kind?: "scheduled";
  targetDeviceId?: string;
  ttl?: number;
  urgency?: "very-low" | "low" | "normal" | "high";
  sendNotification?: (
    subscription: StoredWebPushSubscription,
    payload: string,
    options: {
      TTL: number;
      urgency: "very-low" | "low" | "normal" | "high";
      vapidDetails: {
        subject: string;
        publicKey: string;
        privateKey: string;
      };
    },
  ) => Promise<unknown>;
  generateRequestDetails?: (
    subscription: StoredWebPushSubscription,
    payload: string,
    options: {
      TTL: number;
      urgency: "very-low" | "low" | "normal" | "high";
      vapidDetails: {
        subject: string;
        publicKey: string;
        privateKey: string;
      };
    },
  ) => GeneratedWebPushRequestDetails;
  fetchImpl?: typeof fetch;
  presenceService?: WebNotificationPresenceService;
}

export interface GeneratedWebPushRequestDetails {
  endpoint: string;
  method?: string;
  headers?: Record<string, string | number>;
  body?: BodyInit | null;
  timeout?: number;
}

function resolvePushPath(url: string | undefined): string {
  const value = typeof url === "string" ? url.trim() : "";
  if (!value) return "/";
  if (value.startsWith("/")) return value;
  return `/${value}`;
}

function normalizePayload(payload: WebPushNotificationPayload): WebPushNotificationPayload {
  const title = typeof payload?.title === "string" && payload.title.trim()
    ? payload.title.trim()
    : "PiClaw";
  const body = typeof payload?.body === "string" && payload.body.trim()
    ? payload.body.trim()
    : "You have a new update.";
  const tag = typeof payload?.tag === "string" && payload.tag.trim()
    ? payload.tag.trim()
    : "piclaw";
  const sourceLabel = typeof payload?.sourceLabel === "string" && payload.sourceLabel.trim()
    ? payload.sourceLabel.trim()
    : undefined;
  return {
    title,
    body,
    tag,
    url: resolvePushPath(payload?.url),
    ...(sourceLabel ? { sourceLabel } : {}),
  };
}

function getDefaultVapidSubject(): string {
  const configuredSubject = String(getWebRuntimeConfig().pushVapidSubject || "").trim();
  return configuredSubject || "mailto:notifications@localhost.invalid";
}

function getStoredVapidDetails(baseDir?: string, vapidSubject?: string): {
  subject: string;
  publicKey: string;
  privateKey: string;
} {
  const keys = ensureStoredVapidKeys(baseDir);
  const privateJwk = createPrivateKey(keys.privateKeyPem).export({ format: "jwk" }) as JsonWebKey;
  const privateKey = typeof privateJwk.d === "string" ? privateJwk.d : "";
  if (!privateKey) {
    throw new Error("Stored VAPID key is missing the private key scalar.");
  }

  return {
    subject: typeof vapidSubject === "string" && vapidSubject.trim() ? vapidSubject.trim() : getDefaultVapidSubject(),
    publicKey: keys.publicKey,
    privateKey,
  };
}

function getActiveBreaker(state: WebPushBreakerState | null): WebPushBreakerState | null {
  if (!state) return null;
  if (Date.now() < state.untilMs) return state;
  return null;
}

function getActiveDeliveryBreaker(endpoint: string): WebPushBreakerState | null {
  const state = disabledStoredWebPushDeliveryStateByEndpoint.get(endpoint) || null;
  const active = getActiveBreaker(state);
  if (!active && state) {
    disabledStoredWebPushDeliveryStateByEndpoint.delete(endpoint);
  }
  return active;
}

function subscriptionFailureKey(subscription: StoredWebPushSubscription): string {
  return `${subscription.ownerUserId || ""}\u0000${subscription.loginSessionId || ""}\u0000${subscription.endpoint}`;
}

function tripStoredWebPushSetupBreaker(error: unknown): void {
  const reason = error instanceof Error ? error : new Error(String(error || "Unknown web push setup failure"));
  if (getActiveBreaker(disabledStoredWebPushSetupState)) return;
  disabledStoredWebPushSetupState = {
    reason,
    untilMs: Date.now() + SETUP_BREAKER_COOLDOWN_MS,
  };
  log.warn("Disabled stored web push delivery after a fatal setup failure.", {
    errorMessage: reason.message,
    err: reason,
    cooldownMs: SETUP_BREAKER_COOLDOWN_MS,
  });
}

function tripStoredWebPushDeliveryBreaker(subscription: StoredWebPushSubscription, error: unknown): void {
  const reason = error instanceof Error ? error : new Error(String(error || "Unknown web push delivery failure"));
  const key = subscriptionFailureKey(subscription);
  if (getActiveDeliveryBreaker(key)) return;
  disabledStoredWebPushDeliveryStateByEndpoint.set(key, {
    reason,
    untilMs: Date.now() + DELIVERY_BREAKER_COOLDOWN_MS,
  });
  log.warn("Temporarily disabled stored web push delivery after repeated delivery failures.", {
    errorMessage: reason.message,
    err: reason,
    cooldownMs: DELIVERY_BREAKER_COOLDOWN_MS,
    subscriptionScope: subscription.ownerUserId ? "account" : "single-user",
  });
}

async function loadGenerateRequestDetailsImpl(): Promise<NonNullable<SendStoredWebPushNotificationOptions["generateRequestDetails"]>> {
  const mod = await import("web-push");
  const api = (mod as Record<string, any>).default && typeof (mod as Record<string, any>).default === "object"
    ? (mod as Record<string, any>).default
    : mod;
  const generateRequestDetails = api?.generateRequestDetails;
  if (typeof generateRequestDetails !== "function") {
    throw new Error("web-push generateRequestDetails is unavailable.");
  }
  return generateRequestDetails.bind(api);
}

function normalizeRequestHeaders(headers: GeneratedWebPushRequestDetails["headers"]): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) continue;
    if (normalizedKey.toLowerCase() === "content-length") continue;
    normalized[normalizedKey] = String(value);
  }
  return normalized;
}

async function dispatchGeneratedWebPushRequest(
  requestDetails: GeneratedWebPushRequestDetails,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const controller = typeof AbortController !== "undefined" && Number.isFinite(requestDetails.timeout) && Number(requestDetails.timeout) > 0
    ? new AbortController()
    : null;
  const timeoutMs = Number.isFinite(requestDetails.timeout) && Number(requestDetails.timeout) > 0
    ? Number(requestDetails.timeout)
    : DEFAULT_WEB_PUSH_REQUEST_TIMEOUT_MS;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    const response = await fetchImpl(requestDetails.endpoint, {
      method: requestDetails.method || "POST",
      headers: normalizeRequestHeaders(requestDetails.headers),
      body: requestDetails.body ?? undefined,
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (response.ok) return;

    const body = await response.text().catch(() => "");
    const error = new Error(`Received unexpected response code: ${response.status}`);
    (error as Error & { statusCode?: number; headers?: Record<string, string>; body?: string; endpoint?: string }).statusCode = response.status;
    (error as Error & { statusCode?: number; headers?: Record<string, string>; body?: string; endpoint?: string }).headers = Object.fromEntries(response.headers.entries());
    (error as Error & { statusCode?: number; headers?: Record<string, string>; body?: string; endpoint?: string }).body = body;
    (error as Error & { statusCode?: number; headers?: Record<string, string>; body?: string; endpoint?: string }).endpoint = requestDetails.endpoint;
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function isExpiredSubscriptionError(error: unknown): boolean {
  const statusCode = Number((error as { statusCode?: unknown } | null)?.statusCode);
  return statusCode === 404 || statusCode === 410;
}

function isAuthRejectedSubscriptionError(error: unknown): boolean {
  const statusCode = Number((error as { statusCode?: unknown } | null)?.statusCode);
  return statusCode === 401 || statusCode === 403;
}

function isPotentialSystemicDeliveryError(error: unknown): boolean {
  return !isExpiredSubscriptionError(error) && !isAuthRejectedSubscriptionError(error);
}

function clearSubscriptionFailureState(subscription: StoredWebPushSubscription): void {
  authFailureCountsByEndpoint.delete(subscriptionFailureKey(subscription));
}

function shouldPruneSubscriptionAfterAuthFailure(subscription: StoredWebPushSubscription): boolean {
  const key = subscriptionFailureKey(subscription), nextCount = (authFailureCountsByEndpoint.get(key) ?? 0) + 1;
  authFailureCountsByEndpoint.set(key, nextCount);
  return nextCount >= AUTH_FAILURE_PRUNE_THRESHOLD;
}

function buildReplyNotificationBody(interaction: InteractionRow): string {
  const content = String(interaction?.data?.content || "").trim();
  if (content) {
    return content.replace(/\s+/g, " ").slice(0, 200);
  }
  const contentBlocks = Array.isArray(interaction?.data?.content_blocks)
    ? interaction.data.content_blocks
    : [];
  if (contentBlocks.length > 0) {
    return "Sent an attachment.";
  }
  return "You have a new reply.";
}

export function buildStoredAgentReplyWebPushNotification(interaction: InteractionRow, kind?: "scheduled"): WebPushNotificationPayload | null {
  if (!interaction || typeof interaction !== "object") return null;
  const chatJid = typeof interaction.chat_jid === "string" ? interaction.chat_jid.trim() : "";
  if (!chatJid) return null;
  const rowId = Number(interaction.id);
  if (kind === "scheduled" && (!Number.isSafeInteger(rowId) || rowId <= 0)) return null;
  const suffix = rowId > 0 ? `#msg-${rowId}` : "";
  return {
    title: kind === "scheduled" ? "PiClaw scheduled result" : "PiClaw reply",
    body: buildReplyNotificationBody(interaction),
    url: `/?chat_jid=${encodeURIComponent(chatJid)}${suffix}`,
    tag: kind === "scheduled" ? `piclaw:scheduled:${rowId}` : `piclaw:reply:${encodeURIComponent(chatJid)}`,
    sourceLabel: "Web Push",
  };
}

export async function sendStoredAgentReplyWebPushNotification(
  interaction: InteractionRow,
  options: SendStoredWebPushNotificationOptions = {},
): Promise<StoredWebPushSendResult> {
  const payload = buildStoredAgentReplyWebPushNotification(interaction, options.kind);
  if (!payload) {
    return { attempted: 0, sent: 0, removed: 0, failed: 0 };
  }

  return await sendStoredWebPushNotification(payload, {
    ...options,
    chatJid: typeof interaction.chat_jid === "string" ? interaction.chat_jid.trim() : options.chatJid,
  });
}

export async function sendStoredWebPushNotification(
  payload: WebPushNotificationPayload,
  options: SendStoredWebPushNotificationOptions = {},
): Promise<StoredWebPushSendResult> {
  if (!isSingleUserAccess()) return { attempted: 0, sent: 0, removed: 0, failed: 0 };
  return sendStoredWebPushNotificationInternal(payload, options);
}

async function sendStoredWebPushNotificationInternal(
  payload: WebPushNotificationPayload,
  options: SendStoredWebPushNotificationOptions & { targetOwnerUserId?: string; validateRecipient?: (subscription: StoredWebPushSubscription) => boolean },
): Promise<StoredWebPushSendResult> {
  const subscriptions = listStoredWebPushSubscriptions(options.baseDir, options.targetOwnerUserId ? { ownerUserId: options.targetOwnerUserId } : undefined)
    .filter(subscription => options.targetOwnerUserId ? subscription.ownerUserId === options.targetOwnerUserId : subscription.ownerUserId === null);
  if (subscriptions.length === 0) {
    return { attempted: 0, sent: 0, removed: 0, failed: 0 };
  }
  if (getActiveBreaker(disabledStoredWebPushSetupState)) {
    return { attempted: 0, sent: 0, removed: 0, failed: 0 };
  }

  const normalizedPayload = normalizePayload(payload);
  const serializedPayload = JSON.stringify(normalizedPayload);
  let requestOptions: {
    TTL: number;
    urgency: "very-low" | "low" | "normal" | "high";
    vapidDetails: {
      subject: string;
      publicKey: string;
      privateKey: string;
    };
  };
  let generateRequestDetails: NonNullable<SendStoredWebPushNotificationOptions["generateRequestDetails"]> | null;
  try {
    const vapidDetails = getStoredVapidDetails(options.baseDir, options.vapidSubject);
    requestOptions = {
      TTL: Number.isFinite(options.ttl) ? Number(options.ttl) : 60,
      urgency: options.urgency || "normal",
      vapidDetails,
    };
    generateRequestDetails = options.sendNotification
      ? null
      : (options.generateRequestDetails || await loadGenerateRequestDetailsImpl());
  } catch (error) {
    tripStoredWebPushSetupBreaker(error);
    return { attempted: 0, sent: 0, removed: 0, failed: 0 };
  }
  const presenceService = options.presenceService || webNotificationPresenceService;

  const eligibleSubscriptions: StoredWebPushSubscription[] = [], invalidSubscriptions = new Set<string>();
  for (const subscription of subscriptions) {
    if (typeof options.targetDeviceId === "string" && options.targetDeviceId.trim() && subscription.deviceId !== options.targetDeviceId.trim()) {
      continue;
    }
    if (getActiveDeliveryBreaker(subscriptionFailureKey(subscription))) {
      continue;
    }
    if (options.validateRecipient && !options.validateRecipient(subscription)) {
      invalidSubscriptions.add(subscriptionFailureKey(subscription));
      continue;
    }
    if (presenceService.shouldSendWebPush(subscription.deviceId, options.chatJid, undefined, subscription.ownerUserId && subscription.loginSessionId
      ? { ownerUserId: subscription.ownerUserId, loginSessionId: subscription.loginSessionId } : undefined)) eligibleSubscriptions.push(subscription);
  }
  if (invalidSubscriptions.size > 0) await pruneStoredWebPushSubscriptions(subscription => invalidSubscriptions.has(subscriptionFailureKey(subscription)), options.baseDir);

  const outcomes = await Promise.all(eligibleSubscriptions.map(async (subscription) => {
    try {
      if (options.validateRecipient && !options.validateRecipient(subscription)) return { attempted: 0, sent: 0, removed: 0, failed: 0, systemicError: null as Error | null };
      if (options.sendNotification) {
        await options.sendNotification(subscription, serializedPayload, requestOptions);
      } else if (generateRequestDetails) {
        const requestDetails = generateRequestDetails(subscription, serializedPayload, requestOptions);
        await dispatchGeneratedWebPushRequest(requestDetails, options.fetchImpl || fetch);
      }
      clearSubscriptionFailureState(subscription);
      return { attempted: 1, sent: 1, removed: 0, failed: 0, systemicError: null as Error | null };
    } catch (error) {
      if (isExpiredSubscriptionError(error)) {
        clearSubscriptionFailureState(subscription);
        if (await removeStoredWebPushSubscriptionAtomic(subscription.endpoint, options.baseDir, subscription.ownerUserId && subscription.loginSessionId
          ? { ownerUserId: subscription.ownerUserId, loginSessionId: subscription.loginSessionId } : undefined)) {
          log.info("Removed expired web push subscription after delivery failure.", {
            subscriptionScope: subscription.ownerUserId ? "account" : "single-user",
            statusCode: (error as { statusCode?: unknown } | null)?.statusCode,
          });
          return { attempted: 1, sent: 0, removed: 1, failed: 0, systemicError: null as Error | null };
        }
      } else if (isAuthRejectedSubscriptionError(error) && shouldPruneSubscriptionAfterAuthFailure(subscription)) {
        if (await removeStoredWebPushSubscriptionAtomic(subscription.endpoint, options.baseDir, subscription.ownerUserId && subscription.loginSessionId
          ? { ownerUserId: subscription.ownerUserId, loginSessionId: subscription.loginSessionId } : undefined)) {
          log.info("Removed rejected web push subscription after repeated auth failures.", {
            subscriptionScope: subscription.ownerUserId ? "account" : "single-user",
            statusCode: (error as { statusCode?: unknown } | null)?.statusCode,
            threshold: AUTH_FAILURE_PRUNE_THRESHOLD,
          });
          authFailureCountsByEndpoint.delete(subscriptionFailureKey(subscription));
          return { attempted: 1, sent: 0, removed: 1, failed: 0, systemicError: null as Error | null };
        }
      }

      const normalizedError = error instanceof Error
        ? error
        : new Error(typeof (error as { message?: unknown } | null)?.message === "string"
            ? String((error as { message: string }).message)
            : "Web push delivery failed.");
      debugSuppressedError(log, "Web push delivery failed for a stored subscription.", error, {
        subscriptionScope: subscription.ownerUserId ? "account" : "single-user",
      });
      return {
        attempted: 1,
        sent: 0,
        removed: 0,
        failed: 1,
        systemicError: isPotentialSystemicDeliveryError(error) ? normalizedError : null,
      };
    }
  }));

  const attempted = outcomes.reduce((total, entry) => total + entry.attempted, 0);
  const sent = outcomes.reduce((total, entry) => total + entry.sent, 0);
  const removed = outcomes.reduce((total, entry) => total + entry.removed, 0);
  const failed = outcomes.reduce((total, entry) => total + entry.failed, 0);
  const systemicFailures = outcomes
    .map((entry) => entry.systemicError)
    .filter(Boolean) as Error[];

  if (attempted > 0 && sent === 0 && removed === 0 && failed === attempted && systemicFailures.length === eligibleSubscriptions.length) {
    for (let index = 0; index < eligibleSubscriptions.length; index += 1) {
      const subscription = eligibleSubscriptions[index];
      const error = systemicFailures[index];
      if (subscription && error) {
        tripStoredWebPushDeliveryBreaker(subscription, error);
      }
    }
  }

  return {
    attempted,
    sent,
    removed,
    failed,
  };
}
