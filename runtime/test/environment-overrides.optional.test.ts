import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { getDb, initDatabase } from "../src/db.js";
import { setKeychainEntry } from "../src/secure/keychain.js";
import { importFresh, setEnv } from "./helpers.js";

describe("environment overrides", () => {
  let restoreEnv: (() => void) | null = null;

  beforeEach(() => {
    restoreEnv = setEnv({
      TEST_ENVIRONMENT_VISIBLE: "base-value",
      TEST_ENVIRONMENT_RESTORE: "original-value",
      TEST_ENVIRONMENT_NEW: undefined,
      PICLAW_KEYCHAIN_KEY: "environment-overrides-test-key",
    });
    initDatabase();
    getDb().prepare("DELETE FROM extension_kv WHERE extension_id = ?").run("piclaw.environment-settings");
    getDb().prepare("DELETE FROM keychain_entries").run();
  });

  afterEach(() => {
    getDb().prepare("DELETE FROM extension_kv WHERE extension_id = ?").run("piclaw.environment-settings");
    getDb().prepare("DELETE FROM keychain_entries").run();
    restoreEnv?.();
    restoreEnv = null;
  });

  async function loadModule() {
    return importFresh<typeof import("../src/environment-overrides.js")>("../src/environment-overrides.js");
  }

  test("lists process environment variables and omits keychain-injected names", async () => {
    await setKeychainEntry({ name: "github/token", secret: "secret", type: "secret" });
    process.env.GITHUB_TOKEN = "should-be-hidden";

    const envSettings = await loadModule();
    const data = envSettings.getEnvironmentSettingsData();

    expect(data.variables.some((row) => row.name === "TEST_ENVIRONMENT_VISIBLE" && row.value === "base-value")).toBe(true);
    expect(data.variables.some((row) => row.name === "GITHUB_TOKEN")).toBe(false);
    expect(data.keychainEnvNames).toContain("GITHUB_TOKEN");
  });

  test("persists overrides in extension KV and applies them to process.env", async () => {
    const envSettings = await loadModule();

    await envSettings.admitEnvironmentOverride("TEST_ENVIRONMENT_RESTORE", "override-value", () => {});

    expect(process.env.TEST_ENVIRONMENT_RESTORE).toBe("override-value");
    const stored = getDb()
      .prepare("SELECT value FROM extension_kv WHERE extension_id = ? AND scope = 'global' AND key = 'overrides'")
      .get("piclaw.environment-settings") as { value: string };
    expect(JSON.parse(stored.value)).toEqual({ TEST_ENVIRONMENT_RESTORE: "override-value" });

    await envSettings.admitEnvironmentOverride("TEST_ENVIRONMENT_RESTORE", null, () => {});
    expect(process.env.TEST_ENVIRONMENT_RESTORE).toBe("original-value");
  });

  test("rejects keychain-injected names as overrides", async () => {
    await setKeychainEntry({ name: "ssh/relay.local", secret: "secret", type: "ssh" });
    const envSettings = await loadModule();

    await expect(envSettings.admitEnvironmentOverride("SSH_RELAY_LOCAL", "bad", () => {})).rejects.toThrow("Keychain-injected");
  });
});
