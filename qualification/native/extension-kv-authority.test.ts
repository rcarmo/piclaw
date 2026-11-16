import { test, expect } from "bun:test";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { getRuntimeConfigPaths } from "../../runtime/src/core/config.js";
import { registerRootExtensionKvStore } from "../../runtime/src/db/register-extension-kv.js";
import { getExtensionKvStore, requireExtensionKvAuthority, resetExtensionKvStoreForTests, withExtensionKvAuthority } from "../../runtime/src/extension-kv-registry.ts";

test("explicit namespace global grants preserve chat default and revoke across await", async () => {
  await closeDatabase(); initDatabase({ ...getRuntimeConfigPaths(), databasePath: ":memory:" });
  resetExtensionKvStoreForTests(); registerRootExtensionKvStore(); requireExtensionKvAuthority();
  const kv = getExtensionKvStore(); let current = true, writes = 0;
  const base = { extensionId: "imap", chatJid: "web:one", assertCurrent() { if (!current) throw Error("revoked"); }, write<T>(body: () => T): T { writes++; this.assertCurrent(); return getDb().transaction(body).immediate(); } };
  try {
    expect(() => kv.get("imap", "account", "global")).toThrow();
    withExtensionKvAuthority(base, () => {
      expect(() => kv.get("imap", "account", "global")).toThrow();
      kv.set("imap", "local", 1, "chat", "web:one");
      expect(() => kv.get("imap", "local", "chat", "web:two")).toThrow();
    });
    withExtensionKvAuthority({ ...base, globalRead: true }, () => {
      expect(kv.get("imap", "account", "global")).toBeNull();
      expect(() => kv.set("imap", "account", 1, "global")).toThrow();
    });
    await withExtensionKvAuthority({ ...base, globalRead: true, globalWrite: true }, async () => {
      kv.set("imap", "account", 1, "global", "");
      expect(kv.get("imap", "account", "global")).toBe(1);
      expect(() => kv.get("proxmox", "account", "global")).toThrow();
      expect(() => kv.get("imap", "account", "global", "foreign")).toThrow();
      expect(() => kv.clear("imap", "global")).toThrow();
      await Promise.resolve(); current = false;
      expect(() => kv.get("imap", "account", "global")).toThrow("revoked");
      expect(() => kv.set("imap", "account", 2, "global")).toThrow("revoked");
    });
    expect(writes).toBeGreaterThan(1);
  } finally { resetExtensionKvStoreForTests(); await closeDatabase(); }
});
