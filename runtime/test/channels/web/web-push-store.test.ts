import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  ensureStoredVapidKeys,
  getStoredVapidPublicKey,
  listStoredWebPushSubscriptions,
  normalizeStoredWebPushSubscription,
  removeStoredWebPushSubscription,
  upsertStoredWebPushSubscription,
} from "../../../src/channels/web/push/web-push-store.js";

const tempDirs: string[] = [];

function createTempPushDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "piclaw-web-push-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

function createSubscription(endpoint = "https://push.example.test/device/1", deviceId: string | null = null) {
  return {
    endpoint,
    expirationTime: null,
    keys: {
      auth: "auth-token",
      p256dh: "p256dh-token",
    },
    ...(deviceId ? { deviceId } : {}),
  };
}

describe("web push store", () => {
  test("generates and reuses a stored VAPID keypair", () => {
    const baseDir = createTempPushDir();

    const created = ensureStoredVapidKeys(baseDir);
    const reread = ensureStoredVapidKeys(baseDir);

    expect(created.publicKey).toBeTruthy();
    expect(created.privateKeyPem).toContain("BEGIN PRIVATE KEY");
    expect(created.publicKeyPem).toContain("BEGIN PUBLIC KEY");
    expect(reread.publicKey).toBe(created.publicKey);
    expect(getStoredVapidPublicKey(baseDir)).toBe(created.publicKey);
  });

  test("normalizes valid subscriptions and rejects malformed ones", () => {
    const normalized = normalizeStoredWebPushSubscription(createSubscription());

    expect(normalized?.endpoint).toBe("https://push.example.test/device/1");
    expect(normalized?.expirationTime).toBeNull();
    expect(normalized?.keys).toEqual({
      auth: "auth-token",
      p256dh: "p256dh-token",
    });
    expect(typeof normalized?.createdAt).toBe("string");
    expect(typeof normalized?.updatedAt).toBe("string");
    expect(normalized?.userAgent).toBeNull();
    expect(normalized?.deviceId).toBeNull();

    expect(normalizeStoredWebPushSubscription({ endpoint: "", keys: {} })).toBeNull();
    expect(normalizeStoredWebPushSubscription(null)).toBeNull();
  });

  test("upserts and removes stored subscriptions by endpoint", () => {
    const baseDir = createTempPushDir();

    const created = upsertStoredWebPushSubscription(createSubscription(), {
      baseDir,
      userAgent: "PiClaw Test",
      now: "2026-04-14T18:50:00.000Z",
    });
    const updated = upsertStoredWebPushSubscription(createSubscription(), {
      baseDir,
      userAgent: "PiClaw Test 2",
      now: "2026-04-14T18:55:00.000Z",
    });

    expect(created.createdAt).toBe("2026-04-14T18:50:00.000Z");
    expect(updated.createdAt).toBe("2026-04-14T18:50:00.000Z");
    expect(updated.updatedAt).toBe("2026-04-14T18:55:00.000Z");
    expect(updated.userAgent).toBe("PiClaw Test 2");
    expect(listStoredWebPushSubscriptions(baseDir)).toHaveLength(1);

    expect(removeStoredWebPushSubscription(created.endpoint, baseDir)).toBe(true);
    expect(removeStoredWebPushSubscription(created.endpoint, baseDir)).toBe(false);
    expect(listStoredWebPushSubscriptions(baseDir)).toHaveLength(0);
  });

  test("replaces an existing subscription when the same device gets a new endpoint", () => {
    const baseDir = createTempPushDir();

    upsertStoredWebPushSubscription(createSubscription("https://push.example.test/device/old", "device-1"), {
      baseDir,
      userAgent: "PiClaw Test",
      now: "2026-04-14T19:00:00.000Z",
    });
    const updated = upsertStoredWebPushSubscription(createSubscription("https://push.example.test/device/new", "device-1"), {
      baseDir,
      userAgent: "PiClaw Test",
      now: "2026-04-14T19:05:00.000Z",
      deviceId: "device-1",
    });

    expect(updated.endpoint).toBe("https://push.example.test/device/new");
    expect(updated.deviceId).toBe("device-1");
    expect(listStoredWebPushSubscriptions(baseDir).map((entry) => entry.endpoint)).toEqual([
      "https://push.example.test/device/new",
    ]);
  });
});
