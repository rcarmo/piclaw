/**
 * test/cli-keychain.test.ts – Tests for the CLI keychain sub-command.
 *
 * Exercises `piclaw keychain set/get/list/delete` via handleCliOptions()
 * in a temp workspace, verifying encrypted storage and retrieval.
 */

import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTempWorkspace, setEnv, importFresh } from "./helpers.js";

const ws = createTempWorkspace("piclaw-cli-keychain-");
const restore = setEnv({
  PICLAW_WORKSPACE: ws.workspace,
  PICLAW_STORE: ws.store,
  PICLAW_DATA: ws.data,
  PICLAW_KEYCHAIN_KEY: "cli-key",
});

const { handleCliOptions } = await importFresh<typeof import("../src/cli.js")>("../src/cli.js");
const { getKeychainEntry } = await importFresh<typeof import("../src/secure/keychain.js")>(
  "../src/secure/keychain.js"
);

afterAll(() => {
  restore();
  ws.cleanup();
});

test("cli keychain set and delete", async () => {
  const handledSet = await handleCliOptions([
    "keychain",
    "set",
    "cli/foo/bar",
    "--type",
    "token",
    "--secret",
    "cli-secret",
    "--username",
    "cli-user",
  ]);

  expect(handledSet).toBe(true);
  const entry = await getKeychainEntry("cli/foo/bar");
  expect(entry.secret).toBe("cli-secret");
  expect(entry.username).toBe("cli-user");

  const handledDelete = await handleCliOptions(["keychain", "delete", "cli/foo/bar"]);
  expect(handledDelete).toBe(true);

  await expect(getKeychainEntry("cli/foo/bar")).rejects.toThrow("Keychain entry not found");
});

test("cli keychain list orders entries", async () => {
  await handleCliOptions([
    "keychain",
    "set",
    "cli/zeta",
    "--secret",
    "secret-z",
  ]);
  await handleCliOptions([
    "keychain",
    "set",
    "cli/alpha",
    "--secret",
    "secret-a",
  ]);

  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: any[]) => {
    logs.push(args.map(String).join(" "));
  };

  try {
    await handleCliOptions(["keychain", "list"]);
  } finally {
    console.log = originalLog;
  }

  const output = logs[logs.length - 1] || "[]";
  const entries = JSON.parse(output);
  const names = entries.map((entry: any) => entry.name);
  expect(names).toEqual(["cli/alpha", "cli/zeta"]);
});

test("cli keychain command accepts leading global runtime flags", async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: any[]) => {
    logs.push(args.map(String).join(" "));
  };

  try {
    const handled = await handleCliOptions([
      "--workspace",
      ws.workspace,
      "--port",
      "9090",
      "keychain",
      "list",
    ]);
    expect(handled).toBe(true);
  } finally {
    console.log = originalLog;
  }

  expect(logs.length).toBeGreaterThan(0);
  expect(() => JSON.parse(logs[logs.length - 1] || "[]")).not.toThrow();
});

test("cli keychain list survives value-taking flags without swallowing the subcommand", async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: any[]) => {
    logs.push(args.map(String).join(" "));
  };

  try {
    const handledPort = await handleCliOptions(["-p", "keychain", "list"]);
    const handledWorkspace = await handleCliOptions(["-w", "keychain", "list"]);
    expect(handledPort).toBe(true);
    expect(handledWorkspace).toBe(true);
  } finally {
    console.log = originalLog;
  }

  expect(logs.length).toBeGreaterThanOrEqual(2);
  for (const output of logs.slice(-2)) {
    expect(() => JSON.parse(output || "[]")).not.toThrow();
  }
});

test("cli keychain errors when disabled", async () => {
  const restoreDisabled = setEnv({ PICLAW_KEYCHAIN_KEY: undefined, PICLAW_KEYCHAIN_KEY_FILE: undefined });

  const errors: string[] = [];
  const originalError = console.error;
  const originalExit = process.exitCode ?? 0;
  console.error = (...args: any[]) => {
    errors.push(args.map(String).join(" "));
  };

  try {
    const handled = await handleCliOptions(["keychain", "get", "cli/alpha"]);
    expect(handled).toBe(true);
    expect(process.exitCode).toBe(1);
  } finally {
    console.error = originalError;
    process.exitCode = originalExit;
    restoreDisabled();
  }

  expect(errors.some((line) => line.includes("Keychain is disabled"))).toBe(true);
});

test.skipIf(process.platform === "win32")("CLI stores a token using workspace config with no master key environment variables", () => {
  const fixture = createTempWorkspace("piclaw-cli-key-file-");
  const configDir = join(fixture.workspace, ".piclaw");
  const keyFile = join(fixture.base, "key");
  const tokenFile = join(fixture.base, "token");
  const key = "synthetic-global-master-key";
  const token = "synthetic-automation-token";
  const env: NodeJS.ProcessEnv = { ...process.env, PICLAW_LOG_LEVEL: "error" };
  delete env.PICLAW_KEYCHAIN_KEY;
  delete env.PICLAW_KEYCHAIN_KEY_FILE;
  delete env.PICLAW_DB_IN_MEMORY;
  const cli = fileURLToPath(new URL("../src/index.ts", import.meta.url));
  const run = (...args: string[]) => Bun.spawnSync({
    cmd: [process.execPath, "--no-env-file", cli, "--workspace", fixture.workspace, "keychain", ...args],
    cwd: fixture.workspace, env,
  });
  try {
    mkdirSync(configDir);
    writeFileSync(join(configDir, "config.json"), JSON.stringify({ keychain: { keyFile } }), { mode: 0o600 });
    writeFileSync(keyFile, key, { mode: 0o600 });
    writeFileSync(tokenFile, token, { mode: 0o600 });
    const stored = run("set", "infra/monitor", "--type", "token", "--secret-file", tokenFile);
    expect(stored.stderr.toString()).toBe("");
    expect(stored.exitCode).toBe(0);
    expect(stored.stdout.toString().trim()).toBe("Stored keychain entry infra/monitor.");

    // A separate process can decrypt the same store with the old bootstrap.
    env.PICLAW_KEYCHAIN_KEY = key;
    const loaded = run("get", "infra/monitor");
    expect(loaded.exitCode).toBe(0);
    expect(JSON.parse(loaded.stdout.toString()).secret).toBe(token);
    delete env.PICLAW_KEYCHAIN_KEY;

    chmodSync(keyFile, 0o644);
    const refused = run("set", "infra/refused", "--secret-file", tokenFile);
    expect(refused.exitCode).toBe(1);
    expect(refused.stdout.toString()).toBe("");
    expect(refused.stderr.toString().trim()).toBe("Cannot load the configured keychain key file. Use an absolute path to a private regular file owned by the current user.");
    const list = run("list");
    expect(list.exitCode).toBe(0);
    expect(JSON.parse(list.stdout.toString()).map((entry: { name: string }) => entry.name)).toEqual(["infra/monitor"]);
  } finally {
    fixture.cleanup();
  }
});
