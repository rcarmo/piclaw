import { expect, test } from "bun:test";
import { writeFileSync } from "fs";
import { join } from "path";
import { closeDbQuietly, importFresh, setEnv, withTempWorkspaceEnv } from "./helpers.js";

async function withKeychainContext(
  run: (ctx: {
    workspace: { workspace: string; store: string; data: string };
    db: typeof import("../src/db.js");
    keychain: typeof import("../src/secure/keychain.js");
  }) => Promise<void>,
  env: Record<string, string | undefined> = {},
): Promise<void> {
  await withTempWorkspaceEnv(
    "piclaw-keychain-",
    { PICLAW_KEYCHAIN_KEY: "test-key", ...env },
    async (workspace) => {
      const db = await importFresh<typeof import("../src/db.js")>("../src/db.js");
      db.initDatabase();
      const keychain = await importFresh<typeof import("../src/secure/keychain.js")>("../src/secure/keychain.js");

      try {
        await run({ workspace, db, keychain });
      } finally {
        keychain.setKeyMaterialProviderForTests(null);
        closeDbQuietly(db);
      }
    },
  );
}

test("stores, updates, lists, and deletes entries across supported types", async () => {
  await withKeychainContext(async ({ keychain }) => {
    await keychain.setKeychainEntry({
      name: "alpha/token",
      type: "token",
      secret: "token-secret",
      username: "alpha-user",
    });
    await keychain.setKeychainEntry({
      name: "beta/password",
      type: "password",
      secret: "password-secret",
    });
    await keychain.setKeychainEntry({
      name: "gamma/basic",
      type: "basic",
      secret: "basic-secret",
      username: "basic-user",
    });
    await keychain.setKeychainEntry({
      name: "delta/secret",
      type: "secret",
      secret: "secret-secret",
    });

    await keychain.setKeychainEntry({
      name: "alpha/token",
      type: "token",
      secret: "rotated-token",
      username: "alpha-user",
    });

    const updated = await keychain.getKeychainEntry("alpha/token");
    expect(updated.secret).toBe("rotated-token");
    expect(updated.username).toBe("alpha-user");

    const list = keychain.listKeychainEntries();
    expect(list.map((entry) => [entry.name, entry.type])).toEqual([
      ["alpha/token", "token"],
      ["beta/password", "password"],
      ["delta/secret", "secret"],
      ["gamma/basic", "basic"],
    ]);
    expect(list.every((entry) => entry.createdAt && entry.updatedAt)).toBe(true);

    expect(await keychain.deleteKeychainEntry("beta/password")).toBe(true);
    expect(await keychain.deleteKeychainEntry("beta/password")).toBe(false);
    await expect(keychain.getKeychainEntry("beta/password")).rejects.toThrow("Keychain entry not found");
  });
});

test("stores user-only and agent-readable notes separately from secrets", async () => {
  await withKeychainContext(async ({ keychain }) => {
    await keychain.setKeychainEntry({
      name: "notes/service",
      type: "secret",
      secret: "hidden-secret",
      userNote: "Human-only deployment note",
      agentNote: "Use via $NOTES_SERVICE only",
    });

    const list = keychain.listKeychainEntries();
    expect(list.find((entry) => entry.name === "notes/service")?.agentNote).toBe("Use via $NOTES_SERVICE only");
    expect("userNote" in (list.find((entry) => entry.name === "notes/service") || {})).toBe(false);

    const uiList = keychain.listKeychainEntriesForUi();
    expect(uiList.find((entry) => entry.name === "notes/service")?.userNote).toBe("Human-only deployment note");

    await keychain.setKeychainEntry({
      name: "notes/service",
      type: "secret",
      secret: "rotated-secret",
    });
    expect(keychain.listKeychainEntriesForUi().find((entry) => entry.name === "notes/service")?.userNote).toBe("Human-only deployment note");

    expect(await keychain.updateKeychainEntryNotes("notes/service", { userNote: "Updated user", agentNote: "Updated agent" })).toBe(true);
    const updated = keychain.listKeychainEntriesForUi().find((entry) => entry.name === "notes/service");
    expect(updated?.userNote).toBe("Updated user");
    expect(updated?.agentNote).toBe("Updated agent");
  });
});

test("reads key material from PICLAW_KEYCHAIN_KEY_FILE when no env key is set", async () => {
  await withTempWorkspaceEnv(
    "piclaw-keychain-file-",
    { PICLAW_KEYCHAIN_KEY: undefined },
    async (workspace) => {
      const keyFile = join(workspace.workspace, "keychain.key");
      writeFileSync(keyFile, "file-backed-key\n", "utf8");

      const db = await importFresh<typeof import("../src/db.js")>("../src/db.js");
      db.initDatabase();
      const keychain = await importFresh<typeof import("../src/secure/keychain.js")>("../src/secure/keychain.js");
      const restoreKeyFile = setEnv({ PICLAW_KEYCHAIN_KEY: undefined, PICLAW_KEYCHAIN_KEY_FILE: keyFile });

      try {
        await keychain.setKeychainEntry({
          name: "file-backed",
          type: "secret",
          secret: "file-secret",
        });

        const entry = await keychain.getKeychainEntry("file-backed");
        expect(entry.secret).toBe("file-secret");
      } finally {
        keychain.setKeyMaterialProviderForTests(null);
        restoreKeyFile();
        closeDbQuietly(db);
      }
    },
  );
});

test("supports provider overrides and reports disabled keychain when no key material exists", async () => {
  await withKeychainContext(async ({ keychain }) => {
    await keychain.setKeychainEntry({
      name: "provider-entry",
      type: "password",
      secret: "provider-secret",
      username: "provider-user",
    });

    const restoreDisabled = setEnv({ PICLAW_KEYCHAIN_KEY: undefined, PICLAW_KEYCHAIN_KEY_FILE: undefined });
    try {
      keychain.setKeyMaterialProviderForTests({
        getKeyMaterial: () => new TextEncoder().encode("test-key"),
      });

      const entry = await keychain.getKeychainEntry("provider-entry");
      expect(entry.secret).toBe("provider-secret");
      expect(entry.username).toBe("provider-user");

      keychain.setKeyMaterialProviderForTests(null);
      await expect(keychain.getKeychainEntry("provider-entry")).rejects.toThrow("Keychain is disabled");
    } finally {
      restoreDisabled();
    }
  });
});

test("buildInjectedShellEnv ignores auto-injected keychain env when the database is not initialized", async () => {
  await withTempWorkspaceEnv(
    "piclaw-keychain-uninitialized-",
    { PICLAW_KEYCHAIN_KEY: "test-key" },
    async () => {
      const keychain = await importFresh<typeof import("../src/secure/keychain.js")>("../src/secure/keychain.js");
      await expect(keychain.buildInjectedShellEnv({ includeProcessEnv: false })).resolves.toEqual({});
    },
  );
});

test("auto-injects only referenced env-style keychain entries for shell use", async () => {
  await withKeychainContext(async ({ keychain }) => {
    await keychain.setKeychainEntry({
      name: "STRIPE_KEY",
      type: "token",
      secret: "stripe-secret",
    });
    await keychain.setKeychainEntry({
      name: "ssh/prod",
      type: "secret",
      secret: "PRIVATE_KEY_DATA",
    });

    expect(keychain.isInjectableKeychainEnvName("STRIPE_KEY")).toBe(true);
    expect(keychain.isInjectableKeychainEnvName("ssh/prod")).toBe(false);
    expect(keychain.toShellEnvName("ssh/prod")).toBe("SSH_PROD");
    expect(keychain.listInjectableKeychainEnvNames()).toEqual(["STRIPE_KEY", "SSH_PROD"]);
    await expect(keychain.loadAutoInjectedKeychainEnv(["echo $STRIPE_KEY ${SSH_PROD}"])).resolves.toEqual({
      STRIPE_KEY: "stripe-secret",
      SSH_PROD: "PRIVATE_KEY_DATA",
    });
    await expect(keychain.loadAutoInjectedKeychainEnv(["echo $STRIPE_KEY"])).resolves.toEqual({
      STRIPE_KEY: "stripe-secret",
    });
    await expect(keychain.loadAutoInjectedKeychainEnv(["env"])).resolves.toEqual({});
    await expect(keychain.loadAutoInjectedKeychainEnv(["node -e 'process.env[name]'"])).resolves.toEqual({});
    await expect(keychain.loadAutoInjectedKeychainEnv(["echo ${!name}"])).resolves.toEqual({});

    const env = await keychain.buildInjectedShellEnv({
      includeProcessEnv: false,
      referencedTexts: ["echo $STRIPE_KEY"],
    });
    expect(env).toEqual({
      STRIPE_KEY: "stripe-secret",
    });
  });
});

test("builds injected POSIX and PowerShell exec commands", async () => {
  await withKeychainContext(async ({ keychain }) => {
    await keychain.setKeychainEntry({
      name: "STRIPE_KEY",
      type: "token",
      secret: "stripe-secret",
    });
    await keychain.setKeychainEntry({
      name: "QUOTE_KEY",
      type: "token",
      secret: "it'" + 's-secret',
    });

    const shellSecrets = await import("../src/secure/shell-secrets.js");
    const wrapped = await shellSecrets.buildInjectedPosixCommand("echo", ["$STRIPE_KEY", "keychain:STRIPE_KEY"]);
    expect(wrapped.command).toBe("sh");
    expect(wrapped.commandArgs).toHaveLength(2);
    expect(wrapped.commandArgs[0]).toBe("-lc");
    expect(wrapped.commandArgs[1]).toBe("exec 'echo' '$STRIPE_KEY' 'stripe-secret'");
    expect(wrapped.env).toEqual({ STRIPE_KEY: "stripe-secret" });

    const wrappedWithQuote = await shellSecrets.buildInjectedPosixCommand("printf", ["%s", "keychain:QUOTE_KEY"]);
    expect(wrappedWithQuote.env).toEqual({});

    const wrappedPowerShell = await shellSecrets.buildInjectedPowerShellCommand("Write-Output", ["$env:STRIPE_KEY", "keychain:STRIPE_KEY"]);
    expect(wrappedPowerShell.command).toBe("powershell");
    expect(wrappedPowerShell.commandArgs).toHaveLength(3);
    expect(wrappedPowerShell.commandArgs[0]).toBe("-NoProfile");
    expect(wrappedPowerShell.commandArgs[1]).toBe("-Command");
    expect(wrappedPowerShell.commandArgs[2]).toContain("& 'Write-Output' '$env:STRIPE_KEY' 'stripe-secret'");
    expect(wrappedPowerShell.env).toEqual({ STRIPE_KEY: "stripe-secret" });

    const proc = Bun.spawn([wrapped.command, ...wrapped.commandArgs], {
      env: { ...process.env, ...wrapped.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("$STRIPE_KEY stripe-secret");

    const procQuoted = Bun.spawn([wrappedWithQuote.command, ...wrappedWithQuote.commandArgs], {
      env: { ...process.env, ...wrappedWithQuote.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdoutQuoted, stderrQuoted, exitCodeQuoted] = await Promise.all([
      new Response(procQuoted.stdout).text(),
      new Response(procQuoted.stderr).text(),
      procQuoted.exited,
    ]);
    expect(exitCodeQuoted).toBe(0);
    expect(stderrQuoted).toBe("");
    expect(stdoutQuoted).toBe("it's-secret");
  });
});

test("resolves keychain env references and inline placeholders", async () => {
  await withKeychainContext(async ({ keychain }) => {
    await keychain.setKeychainEntry({
      name: "service/api",
      type: "basic",
      secret: "api-secret",
      username: "api-user",
    });

    const env = await keychain.resolveKeychainEnv({
      TOKEN: "keychain:service/api:token",
      PASSWORD: "keychain:service/api:password",
      USERNAME: "keychain:service/api:user",
      PLAIN: "literal",
      OMITTED: undefined,
    });

    expect(env).toEqual({
      TOKEN: "api-secret",
      PASSWORD: "api-secret",
      USERNAME: "api-user",
      PLAIN: "literal",
    });

    const placeholderText = await keychain.resolveKeychainPlaceholders(
      "curl -u keychain:service/api:user:keychain:service/api:token https://example.test/?token=keychain:service/api:secret&again=keychain:service/api:token"
    );

    expect(placeholderText).toBe(
      "curl -u api-user:api-secret https://example.test/?token=api-secret&again=api-secret"
    );
    expect(await keychain.resolveKeychainPlaceholders("plain text")).toBe("plain text");
  });
});

test("resolves keychain references whose entry names contain colons", async () => {
  await withKeychainContext(async ({ keychain }) => {
    await keychain.setKeychainEntry({
      name: "service:api",
      type: "basic",
      secret: "api-secret",
      username: "api-user",
    });
    await keychain.setKeychainEntry({
      name: "service:api:staging",
      type: "secret",
      secret: "staging-secret",
    });

    const env = await keychain.resolveKeychainEnv({
      TOKEN: "keychain:service:api:token",
      USERNAME: "keychain:service:api:username",
      STAGING: "keychain:service:api:staging",
    });
    expect(env).toEqual({
      TOKEN: "api-secret",
      USERNAME: "api-user",
      STAGING: "staging-secret",
    });

    const placeholderText = await keychain.resolveKeychainPlaceholders(
      "curl -u keychain:service:api:username:keychain:service:api:token keychain:service:api:staging"
    );
    expect(placeholderText).toBe("curl -u api-user:api-secret staging-secret");
  });
});

test("rejects invalid entry shapes, invalid references, missing usernames, and unsupported KDFs", async () => {
  await withKeychainContext(async ({ db, keychain }) => {
    await expect(
      keychain.setKeychainEntry({ name: "", type: "token", secret: "x" })
    ).rejects.toThrow("Keychain entry name is required");
    await expect(
      keychain.setKeychainEntry({ name: "missing-secret", type: "token", secret: "" })
    ).rejects.toThrow("Keychain entry secret is required");
    await expect(keychain.resolveKeychainEnv({ BAD: "keychain:broken:wat" })).rejects.toThrow(
      "Invalid keychain reference"
    );

    await keychain.setKeychainEntry({
      name: "no-username",
      type: "secret",
      secret: "hidden",
    });

    await expect(
      keychain.resolveKeychainEnv({ USER: "keychain:no-username:username" })
    ).rejects.toThrow("has no username");
    await expect(
      keychain.resolveKeychainPlaceholders("keychain:no-username:username")
    ).rejects.toThrow("has no username");

    await keychain.setKeychainEntry({
      name: "legacy-kdf",
      type: "secret",
      secret: "legacy-secret",
    });
    db.getDb().prepare("UPDATE keychain_entries SET kdf = ? WHERE name = ?").run("legacy-kdf", "legacy-kdf");
    await expect(keychain.getKeychainEntry("legacy-kdf")).rejects.toThrow("Unsupported keychain KDF");
  });
});

test("keychain availability never returns key material or configured paths",async()=>{
 await withKeychainContext(async({keychain})=>{expect(keychain.getKeychainStatus()).toEqual({enabled:true,reason:"ready"});});
 await withKeychainContext(async({keychain})=>{expect(keychain.getKeychainStatus()).toEqual({enabled:false,reason:"not_configured"});},{PICLAW_KEYCHAIN_KEY:"",PICLAW_KEYCHAIN_KEY_FILE:""});
 await withKeychainContext(async({keychain})=>{expect(keychain.getKeychainStatus()).toEqual({enabled:false,reason:"unavailable"});},{PICLAW_KEYCHAIN_KEY:"",PICLAW_KEYCHAIN_KEY_FILE:"/synthetic/missing-key"});
});
