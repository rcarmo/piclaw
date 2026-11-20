import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createTempWorkspace, importFresh, setEnv } from "../helpers.js";
import { createFakeExtensionApi } from "./fake-extension-api.js";

const secret = "SYNTHETIC_KEYCHAIN_SECRET";
const username = "SYNTHETIC_KEYCHAIN_USERNAME";
const userNote = "SYNTHETIC_PRIVATE_NOTE";

describe("agent keychain inventory", () => {
  let ws: ReturnType<typeof createTempWorkspace>;
  let restoreEnv: () => void;
  let keychain: typeof import("../../src/secure/keychain.js");

  beforeEach(async () => {
    ws = createTempWorkspace("piclaw-keychain-tools-");
    restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store,
      PICLAW_DATA: ws.data, PICLAW_KEYCHAIN_KEY: "test-keychain-tools" });
    const db = await importFresh<typeof import("../../src/db.js")>("../src/db.js");
    db.initDatabase();
    keychain = await importFresh<typeof import("../../src/secure/keychain.js")>("../src/secure/keychain.js");
    await keychain.setKeychainEntry({ name: "ssh/piclaw", type: "secret", secret, username, userNote, agentNote: "Build server" });
  });

  afterEach(() => {
    keychain.setKeyMaterialProviderForTests(null);
    restoreEnv();
    ws.cleanup();
  });

  async function register() {
    const { keychainTools } = await importFresh<typeof import("../../src/extensions/keychain-tools.js")>("../src/extensions/keychain-tools.js");
    const fake = createFakeExtensionApi();
    keychainTools(fake.api);
    return { fake, tool: fake.tools.get("keychain") };
  }

  test("advertises metadata only and rejects obsolete plaintext operations without touching storage", async () => {
    const { tool } = await register();
    expect(Object.keys(tool.parameters.properties).sort()).toEqual(["action", "limit", "offset", "query"]);
    expect(tool.parameters.additionalProperties).toBe(false);
    for (const args of [
      { action: "get", name: "ssh/piclaw" },
      { action: "get", name: "ssh/piclaw", field: "username" },
      { action: "set", name: "ssh/piclaw", secret: "UNSAFE_ARGUMENT" },
      { action: "delete", name: "ssh/piclaw" },
      { action: "list", secret: "UNSAFE_ARGUMENT" },
    ]) {
      const result = await tool.execute("old-call", args);
      expect(result.isError).toBe(true);
      for (const value of [secret, username, "UNSAFE_ARGUMENT"]) expect(JSON.stringify(result)).not.toContain(value);
    }
    expect(await keychain.getKeychainEntry("ssh/piclaw")).toMatchObject({ secret, username });
  });

  test("returns only allowed metadata even when the master key is unavailable", async () => {
    const { tool } = await register();
    let keyReads = 0;
    keychain.setKeyMaterialProviderForTests({ getKeyMaterial() { keyReads++; throw Error("No key material"); } });
    const result = await tool.execute("list", { action: "list" });
    expect(result.isError).not.toBe(true);
    expect(result.details).toEqual({ count: 1, total: 1, offset: 0,
      entries: [{ name: "ssh/piclaw", type: "secret", shellEnv: "SSH_PICLAW", agentNote: "Build server" }] });
    expect(JSON.parse(result.content[0].text)).toEqual(result.details);
    for (const value of [secret, username, userNote]) expect(JSON.stringify(result)).not.toContain(value);
    expect(keyReads).toBe(0);
  });

  test("filters and pages, preserving case and the real eligibility/collision rules", async () => {
    for (const name of ["ApiKey", "abc-def", "abc/def", "123credential"]) {
      await keychain.setKeychainEntry({ name, type: "token", secret });
    }
    const { tool } = await register();
    const list = async (args = {}) => (await tool.execute("list", { action: "list", ...args })).details;
    expect((await list({ query: "apikey" })).entries).toEqual([{ name: "ApiKey", type: "token", shellEnv: "ApiKey" }]);
    expect((await list({ query: "abc_def" })).entries).toEqual([{ name: "abc-def", type: "token", shellEnv: "ABC_DEF" }]);
    expect(await list({ query: "abc", offset: 1, limit: 1 })).toEqual({ count: 1, total: 2, offset: 1,
      entries: [{ name: "abc/def", type: "token", shellEnv: null }] });
    expect((await list({ query: "123credential" })).entries[0].shellEnv).toBeNull();
    expect(await list({ query: "missing" })).toEqual({ count: 0, total: 0, offset: 0, entries: [] });
    for (const args of [{ limit: 0 }, { limit: 201 }, { offset: -1 }, { offset: 0.5 }, { query: "x".repeat(201) }]) {
      expect((await tool.execute("bad-list", { action: "list", ...args })).isError).toBe(true);
    }
  });

  test("does not ask external providers to list or decrypt entries", async () => {
    const providers = await import("../../src/secure/keychain-providers.js");
    let calls = 0;
    providers.registerKeychainProvider({ id: "inventory-test", label: "Fixture",
      async list() { calls++; return [{ name: "external/token", type: "token", source: "fixture" }]; },
      async get() { calls++; return null; },
    });
    try {
      const { tool } = await register();
      expect((await tool.execute("list", { action: "list" })).details.total).toBe(1);
      expect(calls).toBe(0);
    } finally { providers.unregisterKeychainProvider("inventory-test"); }
  });

  test("prompt and summary steer agents towards references without enumerating stored data", async () => {
    const { fake, tool } = await register();
    const before = fake.handlers.find(({ event }) => event === "before_agent_start")!;
    const { systemPrompt } = await before.handler({ systemPrompt: "base prompt" });
    expect(systemPrompt).toContain("Settings → Keychain");
    expect(systemPrompt).toContain("keychain:NAME");
    expect(systemPrompt).toContain("dynamic lookups and env enumeration do not trigger it");
    for (const value of [secret, username, userNote, "ssh/piclaw", "Build server"]) expect(systemPrompt).not.toContain(value);
    expect(tool.callSummary({ action: "list", query: "private-name" })).toBe("List entries");
  });
});
