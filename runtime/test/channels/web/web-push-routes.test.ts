import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  handleWebPushSubscriptionDelete,
  handleWebPushSubscriptionUpsert,
  handleWebPushVapidPublicKey,
} from "../../../src/channels/web/push/web-push-routes.js";

const tempDirs: string[] = [];

function createTempPushDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "piclaw-web-push-routes-"));
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

describe("web push routes", () => {
  test("returns a stored VAPID public key", async () => {
    const baseDir = createTempPushDir();
    const response = await handleWebPushVapidPublicKey({ baseDir });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(typeof payload.publicKey).toBe("string");
    expect(payload.publicKey.length).toBeGreaterThan(0);
  });

  test("stores and removes subscription device ids", async () => {
    const baseDir = createTempPushDir();
    const upsertReq = new Request("https://example.com/agent/push/subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json", "user-agent": "PiClaw Test" },
      body: JSON.stringify({
        device_id: "device-1",
        subscription: {
          endpoint: "https://push.example.test/device/1",
          expirationTime: null,
          keys: {
            auth: "auth-token",
            p256dh: "p256dh-token",
          },
        },
      }),
    });

    const upsertResponse = await handleWebPushSubscriptionUpsert(upsertReq, { baseDir });
    expect(upsertResponse.status).toBe(200);
    expect(await upsertResponse.json()).toEqual({ ok: true, endpoint: "https://push.example.test/device/1", device_id: "device-1" });

    const deleteReq = new Request("https://example.com/agent/push/subscription", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: "https://push.example.test/device/1" }),
    });
    const deleteResponse = await handleWebPushSubscriptionDelete(deleteReq, { baseDir });
    expect(deleteResponse.status).toBe(200);
    expect(await deleteResponse.json()).toEqual({ ok: true, removed: true });
  });
});
