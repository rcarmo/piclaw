/**
 * test/tools/tracked-bash.test.ts – Tests for tracked bash tool operations.
 *
 * Verifies createTrackedBashOperations() executes commands, captures
 * output, respects timeouts, and tracks child processes.
 */

import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createBashTool } from "@earendil-works/pi-coding-agent";

import { getTestWorkspace, setEnv } from "../helpers.js";
import { initDatabase } from "../../src/db.js";
import { deleteKeychainEntry, setKeychainEntry } from "../../src/secure/keychain.js";
import {
  createTrackedBashOperations,
  resolveShellCandidates,
  TRACKED_BASH_OUTPUT_LIMIT_BYTES,
  TRACKED_BASH_OUTPUT_TRUNCATION_NOTICE,
} from "../../src/tools/tracked-bash.js";
import { buildSubprocessExecutionHint, shouldDetachChildProcess } from "../../src/utils/process-spawn.js";

function extractToolText(content: Array<{ type: string; text?: string }>): string {
  return content
    .map((item) => (item.type === "text" ? item.text ?? "" : ""))
    .join("");
}

test("tracked bash executes commands and captures output", async () => {
  const ws = getTestWorkspace();
  const ops = createTrackedBashOperations();
  let output = "";

  const result = await ops.exec("echo hello", ws.workspace, {
    onData: (data) => {
      output += data.toString("utf8");
    },
    timeout: 5,
  });

  expect(result.exitCode).toBe(0);
  expect(output).toContain("hello");
});

test("resolveShellCandidates honors the explicit Pi shellPath without fallbacks", () => {
  const candidates = resolveShellCandidates({
    platform: "linux",
    env: { SHELL: "/env/zsh" } as NodeJS.ProcessEnv,
    shellPath: "/settings/bash",
    pathExists: (path) => path === "/settings/bash" || path === "/env/zsh" || path === "/bin/bash",
  });

  expect(candidates).toEqual([{ shell: "/settings/bash", args: ["-c"], family: "posix" }]);
});

test("resolveShellCandidates rejects a missing explicit Pi shellPath", () => {
  expect(() => resolveShellCandidates({ shellPath: "/missing/bash", pathExists: () => false }))
    .toThrow("Custom shell path not found: /missing/bash");
});

test("resolveShellCandidates prefers a configured POSIX shell before bash fallback", () => {
  const candidates = resolveShellCandidates({
    platform: "linux",
    env: { SHELL: "/custom/zsh" } as NodeJS.ProcessEnv,
    pathExists: (path) => path === "/custom/zsh" || path === "/bin/bash",
  });

  expect(candidates[0]).toEqual({ shell: "/custom/zsh", args: ["-c"], family: "posix" });
  expect(candidates.some((entry) => entry.shell === "/bin/bash")).toBe(true);
  expect(candidates.some((entry) => entry.shell === "bash")).toBe(true);
});

test("resolveShellCandidates uses Windows fallback chain without requiring WSL bash", () => {
  const candidates = resolveShellCandidates({
    platform: "win32",
    env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" } as NodeJS.ProcessEnv,
    pathExists: (path) => path === "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
  });

  expect(candidates[0]).toEqual({
    shell: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    args: ["-NoProfile", "-Command"],
    family: "powershell",
  });
  expect(candidates.some((entry) => entry.shell === "pwsh.exe")).toBe(true);
  expect(candidates.some((entry) => entry.shell === "powershell.exe")).toBe(true);
  expect(candidates.some((entry) => entry.shell === "C:\\Windows\\System32\\cmd.exe")).toBe(true);
  expect(candidates.some((entry) => entry.shell === "cmd.exe")).toBe(true);
  expect(candidates.some((entry) => entry.shell.toLowerCase().includes("bash.exe"))).toBe(false);
});

test("platform spawn strategy detaches only on Unix-like hosts", () => {
  expect(shouldDetachChildProcess("linux")).toBe(true);
  expect(shouldDetachChildProcess("darwin")).toBe(true);
  expect(shouldDetachChildProcess("win32")).toBe(false);
  expect(buildSubprocessExecutionHint("linux")).toContain("detached process groups");
  expect(buildSubprocessExecutionHint("win32")).toContain("detached=false");
});

test("tracked bash rejects missing working directory", async () => {
  const ops = createTrackedBashOperations();
  let error: Error | null = null;
  try {
    await ops.exec("echo hi", "/no/such/dir", { onData: () => {} });
  } catch (err) {
    error = err as Error;
  }

  expect(error).not.toBeNull();
  expect(error?.message).toContain("Working directory does not exist");
});

test("tracked bash abort kills descendant processes before the tool promise settles", async () => {
  if (process.platform === "win32") return;
  const ws = getTestWorkspace();
  const dir = mkdtempSync(join(tmpdir(), "piclaw-bash-abort-"));
  const pidPath = join(dir, "descendant.pid");
  const controller = new AbortController();
  const pending = createTrackedBashOperations().exec(
    `sleep 30 & child=$!; printf '%s' "$child" > '${pidPath}'; wait "$child"`,
    ws.workspace,
    { onData: () => {}, signal: controller.signal, timeout: 30 },
  );
  try {
    for (let index = 0; index < 100 && !existsSync(pidPath); index += 1) await Bun.sleep(10);
    expect(existsSync(pidPath)).toBe(true);
    const descendantPid = Number(readFileSync(pidPath, "utf8"));
    controller.abort();
    await expect(pending).rejects.toThrow("aborted");
    let alive = true;
    for (let index = 0; index < 100 && alive; index += 1) {
      try { process.kill(descendantPid, 0); } catch { alive = false; }
      if (alive) await Bun.sleep(10);
    }
    expect(alive).toBe(false);
  } finally {
    controller.abort();
    await Promise.allSettled([pending]);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tracked bash times out and cancels", async () => {
  const ws = getTestWorkspace();
  const ops = createTrackedBashOperations();
  let error: Error | null = null;
  const start = Date.now();

  try {
    await ops.exec("sleep 2", ws.workspace, { onData: () => {}, timeout: 0.1 });
  } catch (err) {
    error = err as Error;
  }

  const duration = Date.now() - start;
  expect(error).not.toBeNull();
  expect(error?.message).toContain("timeout");
  expect(duration).toBeLessThan(1000);
});

test("tracked bash auto-injects env-style keychain entries", async () => {
  const ws = getTestWorkspace();
  const restore = setEnv({ PICLAW_KEYCHAIN_KEY: "test-key" });
  initDatabase();

  await setKeychainEntry({
    name: "STRIPE_KEY",
    type: "token",
    secret: "stripe-secret",
  });
  await setKeychainEntry({
    name: "ssh/prod",
    type: "secret",
    secret: "PRIVATE_KEY_DATA",
  });

  const ops = createTrackedBashOperations();
  let output = "";

  try {
    const result = await ops.exec("echo \"$STRIPE_KEY|${ssh_prod-unset}\"", ws.workspace, {
      onData: (data) => {
        output += data.toString("utf8");
      },
      timeout: 5,
    });

    expect(result.exitCode).toBe(0);
    expect(output.trim()).toBe("stripe-secret|unset");
  } finally {
    deleteKeychainEntry("STRIPE_KEY");
    deleteKeychainEntry("ssh/prod");
    restore();
  }
});

test("tracked bash resolves keychain env", async () => {
  const ws = getTestWorkspace();
  const restore = setEnv({ PICLAW_KEYCHAIN_KEY: "test-key" });
  initDatabase();

  await setKeychainEntry({
    name: "bash-env",
    type: "token",
    secret: "bash-secret",
    username: "bash-user",
  });

  const ops = createTrackedBashOperations();
  let output = "";

  try {
    const result = await ops.exec("echo \"$TOKEN|$USER\"", ws.workspace, {
      onData: (data) => {
        output += data.toString("utf8");
      },
      env: {
        TOKEN: "keychain:bash-env",
        USER: "keychain:bash-env:username",
        PATH: process.env.PATH || "",
      },
      timeout: 5,
    });

    expect(result.exitCode).toBe(0);
    expect(output.trim()).toContain("bash-secret|bash-user");
  } finally {
    deleteKeychainEntry("bash-env");
    restore();
  }
});

test("tracked bash resolves keychain placeholders in commands", async () => {
  const ws = getTestWorkspace();
  const restore = setEnv({ PICLAW_KEYCHAIN_KEY: "test-key" });
  initDatabase();

  await setKeychainEntry({
    name: "bash-cmd",
    type: "token",
    secret: "cmd-secret",
    username: "cmd-user",
  });

  const ops = createTrackedBashOperations();
  let output = "";

  try {
    const result = await ops.exec("echo keychain:bash-cmd keychain:bash-cmd:username", ws.workspace, {
      onData: (data) => {
        output += data.toString("utf8");
      },
      timeout: 5,
    });

    expect(result.exitCode).toBe(0);
    expect(output.trim()).toBe("cmd-secret cmd-user");
  } finally {
    deleteKeychainEntry("bash-cmd");
    restore();
  }
});

test("tracked bash streams output before process exit", async () => {
  const ws = getTestWorkspace();
  const ops = createTrackedBashOperations();
  let execSettled = false;
  let resolveFirstChunk: ((value: string) => void) | null = null;
  const firstChunkReady = new Promise<string>((resolve) => {
    resolveFirstChunk = resolve;
  });

  const execPromise = ops.exec("printf first; sleep 0.2; printf second", ws.workspace, {
    onData: (data) => {
      const text = data.toString("utf8");
      if (text && resolveFirstChunk) {
        resolveFirstChunk(text);
        resolveFirstChunk = null;
      }
    },
    timeout: 5,
  }).finally(() => {
    execSettled = true;
  });

  const first = await Promise.race([firstChunkReady, execPromise.then(() => "__resolved__")]);
  expect(first).toBe("first");
  expect(execSettled).toBe(false);

  const result = await execPromise;
  expect(result.exitCode).toBe(0);
});

test("tracked bash caps streamed output and appends a truncation marker", async () => {
  const ws = getTestWorkspace();
  const ops = createTrackedBashOperations();
  let output = "";

  const result = await ops.exec("yes x | head -c 400000", ws.workspace, {
    onData: (data) => {
      output += data.toString("utf8");
    },
    timeout: 5,
  });

  expect(result.exitCode).toBe(0);
  expect(output).toContain(TRACKED_BASH_OUTPUT_TRUNCATION_NOTICE.trim());
  expect(Buffer.byteLength(output, "utf8")).toBeLessThanOrEqual(
    TRACKED_BASH_OUTPUT_LIMIT_BYTES + Buffer.byteLength(TRACKED_BASH_OUTPUT_TRUNCATION_NOTICE, "utf8")
  );
});

test.skipIf(process.platform === "win32")("tracked bash recreates TMPDIR before Earendil bash output spooling", async () => {
  const ws = getTestWorkspace();
  const tempBase = mkdtempSync(join(tmpdir(), "piclaw-bash-spool-recreate-"));
  const spoolDir = join(tempBase, "tmp");
  mkdirSync(spoolDir, { recursive: true });
  const restore = setEnv({ TMPDIR: spoolDir, TMP: spoolDir, TEMP: spoolDir });

  try {
    const tool = createBashTool(ws.workspace, { operations: createTrackedBashOperations() });
    rmSync(spoolDir, { recursive: true, force: true });

    const result = await tool.execute("bash-spool-recreate", { command: "seq 1 2505", timeout: 5 });
    const details = result.details as { fullOutputPath?: string } | undefined;
    const fullOutputPath = details?.fullOutputPath;

    expect(existsSync(spoolDir)).toBe(true);
    expect(fullOutputPath).toBeTruthy();
    expect(fullOutputPath?.startsWith(spoolDir)).toBe(true);
    expect(fullOutputPath && existsSync(fullOutputPath)).toBe(true);
    expect(extractToolText(result.content as Array<{ type: string; text?: string }>)).toContain("Full output:");
    expect(readFileSync(fullOutputPath!, "utf8")).toContain("2505");
  } finally {
    restore();
    rmSync(tempBase, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === "win32")("tracked bash turns unwritable spool temp directories into bounded tool errors", async () => {
  const ws = getTestWorkspace();
  const tempBase = mkdtempSync(join(tmpdir(), "piclaw-bash-spool-eacces-"));
  const spoolDir = join(tempBase, "tmp");
  mkdirSync(spoolDir, { recursive: true });
  chmodSync(spoolDir, 0o555);
  const restore = setEnv({ TMPDIR: spoolDir, TMP: spoolDir, TEMP: spoolDir });

  try {
    const tool = createBashTool(ws.workspace, { operations: createTrackedBashOperations() });
    await expect(tool.execute("bash-spool-eacces", { command: "seq 1 2505", timeout: 5 }))
      .rejects.toThrow(`Bash output spool temp directory is unavailable: ${spoolDir}`);
  } finally {
    restore();
    chmodSync(spoolDir, 0o755);
    rmSync(tempBase, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === "win32")("tracked bash drains output written after the shell exits", async () => {
  const ws = getTestWorkspace();
  const ops = createTrackedBashOperations();
  let output = "";

  const result = await ops.exec(
    'printf "HEAD\\n"; ( for i in 1 2 3 4 5 6; do sleep 0.05; printf "TICK$i\\n"; done ) &',
    ws.workspace,
    {
      onData: (data) => {
        output += data.toString("utf8");
      },
      timeout: 5,
    },
  );

  expect(result.exitCode).toBe(0);
  expect(output).toContain("HEAD");
  expect(output).toContain("TICK6");
});

test.skipIf(process.platform === "win32")("tracked bash releases quiet inherited stdout handles after exit", async () => {
  const ws = getTestWorkspace();
  const ops = createTrackedBashOperations();
  let output = "";
  const start = Date.now();

  const result = await ops.exec('printf "DONE\\n"; ( sleep 2 ) &', ws.workspace, {
    onData: (data) => {
      output += data.toString("utf8");
    },
    timeout: 5,
  });

  const elapsed = Date.now() - start;
  expect(result.exitCode).toBe(0);
  expect(output).toContain("DONE");
  expect(elapsed).toBeLessThan(1500);
});
