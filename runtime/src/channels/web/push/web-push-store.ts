/**
 * web/push/web-push-store.ts – Minimal persistent storage for VAPID keys and Web Push subscriptions.
 */

import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { WORKSPACE_DIR } from "../../../core/config.js";
import { createLogger, debugSuppressedError } from "../../../utils/logger.js";

const log = createLogger("web.push.store");
const DEFAULT_PUSH_DIR = resolve(WORKSPACE_DIR, ".piclaw", "web-push");
const VAPID_FILE_NAME = "vapid-keys.json";
const SUBSCRIPTIONS_FILE_NAME = "subscriptions.json";

export interface StoredWebPushSubscription {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    auth: string;
    p256dh: string;
  };
  createdAt: string;
  updatedAt: string;
  userAgent: string | null;
  deviceId: string | null;
}

export interface StoredVapidKeys {
  createdAt: string;
  publicKey: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

function resolvePushDir(baseDir = DEFAULT_PUSH_DIR): string {
  return resolve(baseDir);
}

function resolveVapidKeysPath(baseDir = DEFAULT_PUSH_DIR): string {
  return resolve(resolvePushDir(baseDir), VAPID_FILE_NAME);
}

function resolveSubscriptionsPath(baseDir = DEFAULT_PUSH_DIR): string {
  return resolve(resolvePushDir(baseDir), SUBSCRIPTIONS_FILE_NAME);
}

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch (error) {
    debugSuppressedError(log, "Failed to read stored web push state; ignoring the stale file.", error, { path });
    return null;
  }
}

function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function encodeBase64Url(value: Buffer | Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function createVapidKeys(): StoredVapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    publicKeyEncoding: { format: "pem", type: "spki" },
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
  });

  const publicJwk = createPublicKey(publicKey).export({ format: "jwk" }) as JsonWebKey;
  const x = typeof publicJwk.x === "string" ? publicJwk.x : "";
  const y = typeof publicJwk.y === "string" ? publicJwk.y : "";
  if (!x || !y) {
    throw new Error("Generated VAPID key is missing JWK coordinates.");
  }

  const publicPoint = Buffer.concat([
    Buffer.from([0x04]),
    decodeBase64Url(x),
    decodeBase64Url(y),
  ]);

  return {
    createdAt: new Date().toISOString(),
    publicKey: encodeBase64Url(publicPoint),
    publicKeyPem: publicKey,
    privateKeyPem: privateKey,
  };
}

function readStoredVapidKeys(baseDir = DEFAULT_PUSH_DIR): StoredVapidKeys | null {
  const path = resolveVapidKeysPath(baseDir);
  const parsed = readJsonFile<StoredVapidKeys>(path);
  if (!parsed) return null;
  if (!parsed.publicKey || !parsed.publicKeyPem || !parsed.privateKeyPem) return null;
  return parsed;
}

export function ensureStoredVapidKeys(baseDir = DEFAULT_PUSH_DIR): StoredVapidKeys {
  const existing = readStoredVapidKeys(baseDir);
  if (existing) return existing;
  const created = createVapidKeys();
  writeJsonFile(resolveVapidKeysPath(baseDir), created);
  return created;
}

export function getStoredVapidPublicKey(baseDir = DEFAULT_PUSH_DIR): string {
  return ensureStoredVapidKeys(baseDir).publicKey;
}

export function normalizeStoredWebPushSubscription(
  value: unknown,
  options: { now?: string; userAgent?: string | null; deviceId?: string | null } = {}
): StoredWebPushSubscription | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, any>;
  const endpoint = typeof input.endpoint === "string" ? input.endpoint.trim() : "";
  const p256dh = typeof input.keys?.p256dh === "string" ? input.keys.p256dh.trim() : "";
  const auth = typeof input.keys?.auth === "string" ? input.keys.auth.trim() : "";
  if (!endpoint || !endpoint.startsWith("https://") || !p256dh || !auth) return null;

  const now = options.now || new Date().toISOString();
  const rawExpirationTime = input.expirationTime;
  const expirationTime = rawExpirationTime === null || rawExpirationTime === undefined
    ? null
    : Number(rawExpirationTime);
  return {
    endpoint,
    expirationTime: Number.isFinite(expirationTime) ? expirationTime : null,
    keys: { auth, p256dh },
    createdAt: now,
    updatedAt: now,
    userAgent: typeof options.userAgent === "string" && options.userAgent.trim() ? options.userAgent.trim() : null,
    deviceId: typeof options.deviceId === "string" && options.deviceId.trim() ? options.deviceId.trim() : (typeof input.deviceId === "string" && input.deviceId.trim() ? input.deviceId.trim() : null),
  };
}

export function listStoredWebPushSubscriptions(baseDir = DEFAULT_PUSH_DIR): StoredWebPushSubscription[] {
  const path = resolveSubscriptionsPath(baseDir);
  const parsed = readJsonFile<StoredWebPushSubscription[]>(path);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((entry) => normalizeStoredWebPushSubscription(entry, {
    now: typeof entry?.updatedAt === "string" && entry.updatedAt.trim() ? entry.updatedAt : new Date().toISOString(),
    userAgent: typeof entry?.userAgent === "string" ? entry.userAgent : null,
    deviceId: typeof entry?.deviceId === "string" ? entry.deviceId : null,
  }) !== null);
}

function writeStoredWebPushSubscriptions(entries: StoredWebPushSubscription[], baseDir = DEFAULT_PUSH_DIR): void {
  writeJsonFile(resolveSubscriptionsPath(baseDir), entries);
}

export function upsertStoredWebPushSubscription(
  value: unknown,
  options: { baseDir?: string; userAgent?: string | null; now?: string; deviceId?: string | null } = {}
): StoredWebPushSubscription {
  const normalized = normalizeStoredWebPushSubscription(value, {
    now: options.now,
    userAgent: options.userAgent,
    deviceId: options.deviceId,
  });
  if (!normalized) {
    throw new Error("Invalid push subscription.");
  }

  const baseDir = options.baseDir || DEFAULT_PUSH_DIR;
  const entries = listStoredWebPushSubscriptions(baseDir);
  const endpointIndex = entries.findIndex((entry) => entry.endpoint === normalized.endpoint);
  const deviceIndex = normalized.deviceId ? entries.findIndex((entry) => entry.deviceId === normalized.deviceId) : -1;
  const existingIndex = endpointIndex !== -1 ? endpointIndex : deviceIndex;
  if (existingIndex !== -1) {
    const existing = entries[existingIndex];
    entries[existingIndex] = {
      ...existing,
      endpoint: normalized.endpoint,
      expirationTime: normalized.expirationTime,
      keys: normalized.keys,
      updatedAt: normalized.updatedAt,
      userAgent: normalized.userAgent || existing.userAgent || null,
      deviceId: normalized.deviceId || existing.deviceId || null,
    };
    writeStoredWebPushSubscriptions(entries, baseDir);
    return entries[existingIndex];
  }

  entries.push(normalized);
  writeStoredWebPushSubscriptions(entries, baseDir);
  return normalized;
}

export function removeStoredWebPushSubscription(endpoint: string, baseDir = DEFAULT_PUSH_DIR): boolean {
  const normalizedEndpoint = typeof endpoint === "string" ? endpoint.trim() : "";
  if (!normalizedEndpoint) return false;
  const entries = listStoredWebPushSubscriptions(baseDir);
  const nextEntries = entries.filter((entry) => entry.endpoint !== normalizedEndpoint);
  if (nextEntries.length === entries.length) return false;
  writeStoredWebPushSubscriptions(nextEntries, baseDir);
  return true;
}
