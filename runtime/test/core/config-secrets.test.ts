import { expect, test } from "bun:test";
import { chmodSync, linkSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempWorkspace, setEnv } from "../helpers.js";

import {
  getKeychainBootstrapConfig,
  getWebSecretBootstrapConfig,
  readKeychainBootstrapKeyMaterial,
  setWebSecretCompatibilityValue,
} from "../../src/core/config-secrets.js";

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("web secret bootstrap keeps process env precedence and live rotation", () => {
  const keys = ["PICLAW_INTERNAL_SECRET", "PICLAW_WEB_INTERNAL_SECRET", "PICLAW_WEB_TOTP_SECRET", "PICLAW_WEB_WIDGET_TOKEN"];
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.PICLAW_INTERNAL_SECRET = "internal-primary";
    process.env.PICLAW_WEB_INTERNAL_SECRET = "internal-alias";
    setWebSecretCompatibilityValue("PICLAW_WEB_TOTP_SECRET", "totp-live");
    setWebSecretCompatibilityValue("PICLAW_WEB_WIDGET_TOKEN", "widget-live");
    expect(getWebSecretBootstrapConfig()).toEqual({
      internalSecret: "internal-primary",
      totpSecret: "totp-live",
      widgetToken: "widget-live",
    });
    setWebSecretCompatibilityValue("PICLAW_WEB_TOTP_SECRET", "");
    setWebSecretCompatibilityValue("PICLAW_WEB_WIDGET_TOKEN", "");
    expect(process.env.PICLAW_WEB_TOTP_SECRET).toBeUndefined();
    expect(process.env.PICLAW_WEB_WIDGET_TOKEN).toBeUndefined();
  } finally {
    restoreEnv(before);
  }
});

function withKeyFiles(run: (fixture: { directory: string; configure: (keyFile: unknown) => void }) => void): void {
  const ws = createTempWorkspace("piclaw-config-secrets-");
  const restore = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_KEYCHAIN_KEY: undefined, PICLAW_KEYCHAIN_KEY_FILE: undefined });
  const directory = join(ws.workspace, ".piclaw");
  try {
    mkdirSync(directory);
    run({ directory, configure: (keyFile) => {
      writeFileSync(join(directory, "config.json"), JSON.stringify({ keychain: { keyFile, key: "ignored-inline-key" } }));
    } });
  } finally {
    restore();
    ws.cleanup();
  }
}

test("keychain bootstrap keeps environment precedence and ignores inline JSON keys", () => {
  withKeyFiles(({ directory, configure }) => {
    const keyFile = join(directory, "env-key");
    writeFileSync(keyFile, "file-key\n", "utf8");
    configure(join(directory, "configured-but-missing"));
    process.env.PICLAW_KEYCHAIN_KEY = "direct-key";
    process.env.PICLAW_KEYCHAIN_KEY_FILE = keyFile;
    expect(getKeychainBootstrapConfig()).toEqual({ key: "direct-key", keyFile });
    expect(readKeychainBootstrapKeyMaterial()).toBe("direct-key");
    delete process.env.PICLAW_KEYCHAIN_KEY;
    expect(readKeychainBootstrapKeyMaterial()).toBe("file-key");
    delete process.env.PICLAW_KEYCHAIN_KEY_FILE;
    configure(undefined);
    expect(readKeychainBootstrapKeyMaterial()).toBe("");
  });
});

test.skipIf(process.platform === "win32")("configured key files require an absolute path to a private, owner-owned regular file", () => {
  withKeyFiles(({ directory, configure }) => {
    const keyFile = join(directory, "master");
    const symlink = join(directory, "symlink");
    const hardlink = join(directory, "hardlink");
    writeFileSync(keyFile, "configured-key\n", { mode: 0o600 });
    configure(keyFile);
    expect(readKeychainBootstrapKeyMaterial()).toBe("configured-key");
    chmodSync(keyFile, 0o400);
    expect(readKeychainBootstrapKeyMaterial()).toBe("configured-key");
    symlinkSync(keyFile, symlink);
    const refuses = (path: unknown) => {
      configure(path);
      expect(readKeychainBootstrapKeyMaterial).toThrow("Cannot load the configured keychain key file");
    };
    for (const path of [symlink, directory, join(directory, "missing"), "master", null, ""]) refuses(path);
    chmodSync(keyFile, 0o644);
    refuses(keyFile);
    chmodSync(keyFile, 0o600);
    writeFileSync(keyFile, " ");
    refuses(keyFile);
    writeFileSync(keyFile, "x".repeat(4097));
    refuses(keyFile);
    writeFileSync(keyFile, "configured-key\n");
    linkSync(keyFile, hardlink);
    refuses(hardlink);
    refuses(keyFile);
  });
});
