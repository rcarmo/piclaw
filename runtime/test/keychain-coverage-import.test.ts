import { expect, test } from "bun:test";
import { writeFileSync } from "fs";
import { join } from "path";
import { closeDbQuietly, setEnv, withTempWorkspaceEnv } from "./helpers.js";

test("plain import covers keychain file-key, CRUD, resolution, and disabled-state branches", async () => {
  await withTempWorkspaceEnv(
    "piclaw-keychain-plain-",
    { PICLAW_KEYCHAIN_KEY: undefined },
    async (ws) => {
      const keyFile = join(ws.workspace, "keychain.key");
      writeFileSync(keyFile, "plain-file-key\n", "utf8");
      const restoreKeyFile = setEnv({ PICLAW_KEYCHAIN_KEY: undefined, PICLAW_KEYCHAIN_KEY_FILE: keyFile });

      const db = await import("../src/db.js");
      db.initDatabase();
      db.getDb().exec("DELETE FROM keychain_entries;");
      const keychain = await import("../src/secure/keychain.js");

      try {
        await keychain.setKeychainEntry({
          name: "plain/service",
          type: "basic",
          secret: "plain-secret",
          username: "plain-user",
        });

        expect(keychain.listKeychainEntries()).toHaveLength(1);
        expect(keychain.listKeychainEntries().map((entry) => entry.name)).toEqual(["plain/service"]);
        expect(await keychain.resolveKeychainEnv({
          TOKEN: "keychain:plain/service",
          USER: "keychain:plain/service:username",
          PLAIN: "literal",
        })).toEqual({
          TOKEN: "plain-secret",
          USER: "plain-user",
          PLAIN: "literal",
        });
        expect(await keychain.resolveKeychainPlaceholders("keychain:plain/service:username:keychain:plain/service")).toBe(
          "plain-user:plain-secret"
        );
        expect(await keychain.resolveKeychainPlaceholders("plain text")).toBe("plain text");
        expect(await keychain.resolveKeychainPlaceholders("prefix keychain: suffix")).toBe("prefix keychain: suffix");
        await expect(keychain.resolveKeychainEnv({ BAD: "keychain::secret" })).rejects.toThrow("Invalid keychain reference");

        restoreKeyFile();
        await expect(keychain.getKeychainEntry("plain/service")).rejects.toThrow("Keychain is disabled");

        const restoreKeyFileAgain = setEnv({ PICLAW_KEYCHAIN_KEY: undefined, PICLAW_KEYCHAIN_KEY_FILE: keyFile });
        try {
          const entry = await keychain.getKeychainEntry("plain/service");
          expect(entry.secret).toBe("plain-secret");

          const row = db.getDb().prepare(
            `SELECT nonce, salt, kdf_iterations
             FROM keychain_entries
             WHERE name = ?`
          ).get("plain/service") as { nonce: Uint8Array; salt: Uint8Array; kdf_iterations: number };
          const encoder = new TextEncoder();
          const keyMaterial = encoder.encode("plain-file-key");
          const baseKey = await crypto.subtle.importKey("raw", keyMaterial.buffer.slice(0), "PBKDF2", false, ["deriveKey"]);
          const aesKey = await crypto.subtle.deriveKey(
            {
              name: "PBKDF2",
              salt: new Uint8Array(row.salt),
              iterations: row.kdf_iterations,
              hash: "SHA-256",
            },
            baseKey,
            {
              name: "AES-GCM",
              length: 256,
            },
            false,
            ["encrypt"],
          );
          const badCiphertext = new Uint8Array(
            await crypto.subtle.encrypt(
              {
                name: "AES-GCM",
                iv: new Uint8Array(row.nonce),
                additionalData: encoder.encode("plain/service"),
              },
              aesKey,
              encoder.encode(JSON.stringify({ username: "only-user" })),
            ),
          );
          db.getDb().prepare("UPDATE keychain_entries SET ciphertext = ? WHERE name = ?").run(Buffer.from(badCiphertext), "plain/service");
          await expect(keychain.getKeychainEntry("plain/service")).rejects.toThrow("Invalid keychain payload");

          await keychain.setKeychainEntry({
            name: "plain/service",
            type: "basic",
            secret: "plain-secret",
            username: "plain-user",
          });
        } finally {
          restoreKeyFileAgain();
        }

        expect(await keychain.deleteKeychainEntry("plain/service")).toBe(true);
        expect(keychain.listKeychainEntries()).toEqual([]);
        expect(await keychain.deleteKeychainEntry("plain/service")).toBe(false);
        const restoreKeyFileFinal = setEnv({ PICLAW_KEYCHAIN_KEY: undefined, PICLAW_KEYCHAIN_KEY_FILE: keyFile });
        try {
          await expect(keychain.getKeychainEntry("plain/service")).rejects.toThrow("Keychain entry not found");
        } finally {
          restoreKeyFileFinal();
        }
      } finally {
        keychain.setKeyMaterialProviderForTests(null);
        closeDbQuietly(db);
      }
    },
  );
});
