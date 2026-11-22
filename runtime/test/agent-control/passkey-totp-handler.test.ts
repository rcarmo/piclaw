/**
 * test/agent-control/passkey-totp-handler.test.ts
 *
 * Covers passkey/totp command handlers for help/list/delete and missing-secret
 * safeguards.
 */

import { createHmac } from "node:crypto";
import { afterEach, expect, test } from "bun:test";

import { createTempWorkspace, resetWebTotpSecretIfLoaded, setEnv } from "../helpers.js";

let restoreEnv: (() => void) | null = null;
let cleanupWorkspace: (() => void) | null = null;

afterEach(async () => {
  await resetWebTotpSecretIfLoaded();
  restoreEnv?.();
  restoreEnv = null;
  cleanupWorkspace?.();
  cleanupWorkspace = null;
});

async function setup(extraEnv: Record<string, string | undefined> = {}) {
  const ws = createTempWorkspace("piclaw-passkey-handler-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({
    PICLAW_WORKSPACE: ws.workspace,
    PICLAW_STORE: ws.store,
    PICLAW_DATA: ws.data,
    PICLAW_WEB_TOTP_SECRET: undefined,
    ...extraEnv,
  });

  const token = `?t=${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const db = (await import(`../../src/db.js${token}`)) as typeof import("../../src/db.js");
  db.initDatabase();

  const config = (await import(`../../src/core/config.js`)) as typeof import("../../src/core/config.js");
  config.setWebTotpSecret(extraEnv.PICLAW_WEB_TOTP_SECRET || "");

  const passkey = (await import(`../../src/agent-control/handlers/passkey.js${token}`)) as typeof import("../../src/agent-control/handlers/passkey.js");
  const totp = (await import(`../../src/agent-control/handlers/totp.js${token}`)) as typeof import("../../src/agent-control/handlers/totp.js");
  return { db, config, passkey, totp };
}

function expectPrivateTotpSurface(result: { contentBlocks?: unknown[] }, title: string) {
  const block = result.contentBlocks?.[0];
  expect(block).toMatchObject({ type: 'a2ui_surface', owner: 'totp', state: 'active', fallback_text: title,
    surface: { dataModel: {} } });
  const encoded = JSON.stringify(block);
  expect(encoded).not.toContain('otpauth:');
  expect(encoded).not.toContain('base64');
  expect(encoded).not.toContain('secretHash');
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(value: string): Buffer | null {
  const clean = value.toUpperCase().replace(/[^A-Z2-7]/g, "");
  if (!clean) return null;

  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];

  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) continue;
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return bytes.length > 0 ? Buffer.from(bytes) : null;
}

function totpCode(secret: string, timeMs = Date.now(), stepSeconds = 30, digits = 6): string {
  const key = decodeBase32(secret) ?? Buffer.from(secret, "utf8");
  const counter = Math.floor(timeMs / 1000 / stepSeconds);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (code % 10 ** digits).toString().padStart(digits, "0");
}

test("handlePasskey returns help, list, and delete validation errors", async () => {
  const { passkey } = await setup();

  const help = await passkey.handlePasskey({} as any, { type: "passkey", raw: "/passkey" } as any);
  expect(help.status).toBe("success");
  expect(help.message).toContain("/passkey enrol");

  const listEmpty = await passkey.handlePasskey({} as any, { type: "passkey", action: "list" } as any);
  expect(listEmpty.status).toBe("success");
  expect(listEmpty.message).toContain("No passkeys");

  const deleteNoTarget = await passkey.handlePasskey({} as any, { type: "passkey", action: "delete" } as any);
  expect(deleteNoTarget.status).toBe("error");
  expect(deleteNoTarget.message).toContain("Usage: /passkey delete");

  const deleteNoMatch = await passkey.handlePasskey(
    {} as any,
    { type: "passkey", action: "delete", target: "does-not-exist" } as any
  );
  expect(deleteNoMatch.status).toBe("error");
  expect(deleteNoMatch.message).toContain("No passkey matches");
});

test("handlePasskey enrol redirects to browser-bound Settings without creating a token", async () => {
  const { passkey } = await setup();

  const enrol = await passkey.handlePasskey({} as any, { type: "passkey", action: "enrol" } as any);
  expect(enrol.status).toBe("success");
  expect(enrol.message).toContain("Settings → Authentication");
  expect(enrol.message).toContain("no enrolment link");
});

test("handleTotp validates action and returns a protected setup surface without committing immediately", async () => {
  const { config, totp } = await setup();

  const badAction = await totp.handleTotp({} as any, { type: "totp", action: "noop" } as any);
  expect(badAction.status).toBe("error");
  expect(badAction.message).toContain("Usage: /totp enrol|enroll|reset");

  const generated = await totp.handleTotp({} as any, { type: "totp", action: "enrol" } as any);
  expect(generated.status).toBe("success");
  expect(Array.isArray(generated.contentBlocks)).toBe(true);
  expect(generated.message).toContain("Nothing is saved until confirmation succeeds");
  expect(config.WEB_RUNTIME_CONFIG.totpSecret).toBe("");

  expectPrivateTotpSurface(generated, 'Set up TOTP');
});

test("handleTotp reuses the active secret for secondary-device setup and stages reset without committing", async () => {
  const secret = "CURRENTSECRET";
  const { config, totp } = await setup({ PICLAW_WEB_TOTP_SECRET: secret });

  const secondary = await totp.handleTotp({} as any, { type: "totp" } as any);
  expect(secondary.status).toBe("success");
  expectPrivateTotpSurface(secondary, 'Add another TOTP device');
  expect(JSON.stringify(secondary)).not.toContain(secret);

  const missingCode = await totp.handleTotp({} as any, { type: "totp", action: "reset" } as any);
  expect(missingCode.status).toBe("error");
  expect(missingCode.message).toContain("current TOTP code required for confirmation");

  const badCode = await totp.handleTotp({} as any, { type: "totp", action: "reset", code: "000000" } as any);
  expect(badCode.status).toBe("error");
  expect(badCode.message).toContain("Invalid confirmation code");

  const code = totpCode(secret);
  const reset = await totp.handleTotp({} as any, { type: "totp", action: "reset", code } as any);
  expect(reset.status).toBe("success");
  expect(reset.message).toContain("Nothing changes until confirmation succeeds");
  expect(config.WEB_RUNTIME_CONFIG.totpSecret).toBe(secret);

  expectPrivateTotpSurface(reset, 'Confirm new TOTP secret');
  expect(JSON.stringify(reset)).not.toContain(secret);
  expect(JSON.stringify(reset)).not.toContain(code);
});
