import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { WEB_RUNTIME_CONFIG } from "../../../src/core/config.js";
import { upsertStoredWebPushSubscription, listStoredWebPushSubscriptions } from "../../../src/channels/web/push/web-push-store.js";
import {
  buildStoredAgentReplyWebPushNotification,
  sendStoredAgentReplyWebPushNotification,
  sendStoredWebPushNotification
} from "../../../src/channels/web/push/web-push-service.js";
import { WebNotificationPresenceService } from "../../../src/channels/web/push/web-notification-presence-service.js";
import { createTempWorkspace } from "../../helpers.js";

const tempDirs: string[] = [];

function createTempPushDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "piclaw-web-push-service-"));
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

function createSubscription(id: number, deviceId: string | null = null) {
  return {
    endpoint: `https://push.example.test/device/${id}`,
    expirationTime: null,
    keys: {
      auth: `auth-${id}`,
      p256dh: `p256dh-${id}`,
    },
    ...(deviceId ? { deviceId } : {}),
  };
}

describe("web push service", () => {
  test("sends payloads with derived VAPID details", async () => {
    const baseDir = createTempPushDir();
    upsertStoredWebPushSubscription(createSubscription(1), { baseDir });

    const deliveries: Array<{ endpoint: string; payload: Record<string, unknown>; options: Record<string, unknown> }> = [];
    const result = await sendStoredWebPushNotification({
      title: "Hello",
      body: "World",
      url: "/?chat_jid=web%3Adefault",
      tag: "piclaw:test",
    }, {
      baseDir,
      vapidSubject: "mailto:test@example.com",
      ttl: 30,
      urgency: "high",
      sendNotification: async (subscription, payload, options) => {
        deliveries.push({
          endpoint: subscription.endpoint,
          payload: JSON.parse(payload),
          options,
        });
      },
    });

    expect(result).toEqual({ attempted: 1, sent: 1, removed: 0, failed: 0 });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.endpoint).toBe("https://push.example.test/device/1");
    expect(deliveries[0]?.payload).toEqual({
      title: "Hello",
      body: "World",
      url: "/?chat_jid=web%3Adefault",
      tag: "piclaw:test",
    });
    expect(deliveries[0]?.options.TTL).toBe(30);
    expect(deliveries[0]?.options.urgency).toBe("high");
    expect((deliveries[0]?.options.vapidDetails as any)?.subject).toBe("mailto:test@example.com");
    expect((deliveries[0]?.options.vapidDetails as any)?.publicKey).toBeTruthy();
    expect((deliveries[0]?.options.vapidDetails as any)?.privateKey).toBeTruthy();
    expect(String((deliveries[0]?.options.vapidDetails as any)?.privateKey)).not.toContain("BEGIN");
  });

  test("defaults to the configured VAPID subject when one is not supplied", async () => {
    const baseDir = createTempPushDir();
    const previousSubject = WEB_RUNTIME_CONFIG.pushVapidSubject;
    WEB_RUNTIME_CONFIG.pushVapidSubject = "mailto:configured@example.com";
    upsertStoredWebPushSubscription(createSubscription(11), { baseDir });

    try {
      const deliveries: Array<Record<string, unknown>> = [];
      const result = await sendStoredWebPushNotification({
        title: "Default subject",
        body: "Uses the deployment URL subject",
      }, {
        baseDir,
        sendNotification: async (_subscription, _payload, options) => {
          deliveries.push(options.vapidDetails as Record<string, unknown>);
        },
      });

      expect(result).toEqual({ attempted: 1, sent: 1, removed: 0, failed: 0 });
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]?.subject).toBe("mailto:configured@example.com");
    } finally {
      WEB_RUNTIME_CONFIG.pushVapidSubject = previousSubject;
    }
  });

  test("removes expired subscriptions and keeps non-expired failures", async () => {
    const baseDir = createTempPushDir();
    upsertStoredWebPushSubscription(createSubscription(1), { baseDir });
    upsertStoredWebPushSubscription(createSubscription(2), { baseDir });
    upsertStoredWebPushSubscription(createSubscription(3), { baseDir });

    const result = await sendStoredWebPushNotification({
      title: "Hello again",
      body: "Testing cleanup",
    }, {
      baseDir,
      sendNotification: async (subscription) => {
        if (subscription.endpoint.endsWith("/1")) {
          throw { statusCode: 410 };
        }
        if (subscription.endpoint.endsWith("/2")) {
          throw new Error("temporary failure");
        }
      },
    });

    expect(result).toEqual({ attempted: 3, sent: 1, removed: 1, failed: 1 });
    expect(listStoredWebPushSubscriptions(baseDir).map((entry) => entry.endpoint)).toEqual([
      "https://push.example.test/device/2",
      "https://push.example.test/device/3",
    ]);
  });

  test("prunes rejected subscriptions after repeated auth failures", async () => {
    const baseDir = createTempPushDir();
    upsertStoredWebPushSubscription(createSubscription(21), { baseDir });

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await sendStoredWebPushNotification({
        title: "Auth rejected",
        body: "Testing bounded auth pruning",
      }, {
        baseDir,
        sendNotification: async () => {
          throw { statusCode: 403, message: "forbidden" };
        },
      });

      expect(result.attempted).toBe(1);
    }

    expect(listStoredWebPushSubscriptions(baseDir)).toEqual([]);
  });

  test("uses generated request details with fetch and cleans up 410 responses", async () => {
    const baseDir = createTempPushDir();
    upsertStoredWebPushSubscription(createSubscription(5), { baseDir });

    const result = await sendStoredWebPushNotification({
      title: "Hello via fetch",
      body: "Testing generated request details",
    }, {
      baseDir,
      generateRequestDetails: (subscription, payload) => ({
        endpoint: subscription.endpoint,
        method: "POST",
        headers: {
          TTL: 60,
          Authorization: "WebPush test",
          "Content-Length": payload.length,
        },
        body: payload,
      }),
      fetchImpl: async () => ({
        ok: false,
        status: 410,
        headers: new Headers({ "content-type": "text/plain" }),
        text: async () => "gone",
      } as Response),
    });

    expect(result).toEqual({ attempted: 1, sent: 0, removed: 1, failed: 0 });
    expect(listStoredWebPushSubscriptions(baseDir)).toEqual([]);
  });

  test("suppresses Web Push when the same device still has a live client for that chat", async () => {
    const baseDir = createTempPushDir();
    upsertStoredWebPushSubscription(createSubscription(13, "device-13"), { baseDir, deviceId: "device-13" });

    const presenceService = new WebNotificationPresenceService({ now: () => 1000 });
    presenceService.upsert({
      device_id: "device-13",
      client_id: "client-1",
      chat_jid: "web:default",
      visibility_state: "hidden",
      has_focus: false,
    }, {
      nowMs: 1000,
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/135.0.0.0 Safari/537.36",
    });

    const deliveries: Array<Record<string, unknown>> = [];
    const result = await sendStoredAgentReplyWebPushNotification({
      id: 88,
      chat_jid: "web:default",
      timestamp: "2026-04-14T22:02:00.000Z",
      data: { content: "Suppressed" },
    } as any, {
      baseDir,
      presenceService,
      sendNotification: async (_subscription, payload) => {
        deliveries.push(JSON.parse(payload));
      },
    });

    expect(result).toEqual({ attempted: 0, sent: 0, removed: 0, failed: 0 });
    expect(deliveries).toEqual([]);
  });

  test("allows Web Push when the only live client is a hidden iPhone PWA", async () => {
    const baseDir = createTempPushDir();
    upsertStoredWebPushSubscription(createSubscription(14, "device-14"), { baseDir, deviceId: "device-14" });

    const presenceService = new WebNotificationPresenceService({ now: () => 1000 });
    presenceService.upsert({
      device_id: "device-14",
      client_id: "client-1",
      chat_jid: "web:default",
      visibility_state: "hidden",
      has_focus: false,
    }, {
      nowMs: 1000,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1",
    });

    const deliveries: Array<Record<string, unknown>> = [];
    const result = await sendStoredAgentReplyWebPushNotification({
      id: 89,
      chat_jid: "web:default",
      timestamp: "2026-04-16T22:02:00.000Z",
      data: { content: "Delivered" },
    } as any, {
      baseDir,
      presenceService,
      sendNotification: async (_subscription, payload) => {
        deliveries.push(JSON.parse(payload));
      },
    });

    expect(result).toEqual({ attempted: 1, sent: 1, removed: 0, failed: 0 });
    expect(deliveries).toEqual([{
      title: "PiClaw reply",
      body: "Delivered",
      url: "/?chat_jid=web%3Adefault#msg-89",
      tag: "piclaw:reply:web%3Adefault",
      sourceLabel: "Web Push",
    }]);
  });

  test("builds a reply notification payload from a stored interaction", () => {
    const payload = buildStoredAgentReplyWebPushNotification({
      id: 42,
      chat_jid: "web:default:branch:abc",
      timestamp: "2026-04-14T22:00:00.000Z",
      data: {
        content: "Hello from PiClaw\n\nwith extra whitespace.",
      },
    } as any);

    expect(payload).toEqual({
      title: "PiClaw reply",
      body: "Hello from PiClaw with extra whitespace.",
      url: "/?chat_jid=web%3Adefault%3Abranch%3Aabc#msg-42",
      tag: "piclaw:reply:web%3Adefault%3Abranch%3Aabc",
      sourceLabel: "Web Push",
    });
  });

  test("sends a reply notification built from a stored interaction", async () => {
    const baseDir = createTempPushDir();
    upsertStoredWebPushSubscription(createSubscription(7), { baseDir });

    const deliveries: Array<Record<string, unknown>> = [];
    const result = await sendStoredAgentReplyWebPushNotification({
      id: 77,
      chat_jid: "web:default",
      timestamp: "2026-04-14T22:01:00.000Z",
      data: {
        content: "Reply body",
      },
    } as any, {
      baseDir,
      sendNotification: async (_subscription, payload) => {
        deliveries.push(JSON.parse(payload));
      },
    });

    expect(result).toEqual({ attempted: 1, sent: 1, removed: 0, failed: 0 });
    expect(deliveries).toEqual([{
      title: "PiClaw reply",
      body: "Reply body",
      url: "/?chat_jid=web%3Adefault#msg-77",
      tag: "piclaw:reply:web%3Adefault",
      sourceLabel: "Web Push",
    }]);
  });

  test("scopes delivery breakers per endpoint and does not inflate skipped-failure metrics", async () => {
    const baseDir = createTempPushDir();
    upsertStoredWebPushSubscription(createSubscription(31), { baseDir });

    const firstResult = await sendStoredWebPushNotification({
      title: "Trip endpoint breaker",
      body: "first attempt",
    }, {
      baseDir,
      sendNotification: async () => {
        throw new Error("systemic failure");
      },
    });

    expect(firstResult).toEqual({ attempted: 1, sent: 0, removed: 0, failed: 1 });

    upsertStoredWebPushSubscription(createSubscription(32), { baseDir });
    const deliveries: string[] = [];
    const secondResult = await sendStoredWebPushNotification({
      title: "Other endpoint still delivers",
      body: "second attempt",
    }, {
      baseDir,
      sendNotification: async (subscription) => {
        deliveries.push(subscription.endpoint);
      },
    });

    expect(secondResult).toEqual({ attempted: 1, sent: 1, removed: 0, failed: 0 });
    expect(deliveries).toEqual(["https://push.example.test/device/32"]);
  });


});
