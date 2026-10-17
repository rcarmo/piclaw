/**
 * test/tools/tracked-bash.test.ts – Tests for tracked bash tool operations.
 *
 * Verifies createTrackedBashOperations() executes commands, captures
 * output, respects timeouts, and tracks child processes.
 */

import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

for (const action of ["revoke", "cancel"] as const) {
  test(`tracked bash fences ${action} during asynchronous environment resolution`, async () => {
    const directory = mkdtempSync(join(getTestWorkspace().workspace, "spawn-fence-"));
    const controller = new AbortController();
    let allowed = true, checks = 0;
    const ops = createTrackedBashOperations({ validateSpawn: () => { checks++; return allowed; } });
    try {
      const execution = ops.exec("printf forbidden > sentinel", directory, {
        onData: () => {}, signal: controller.signal, timeout: 2,
      });
      // Actual env/keychain resolution yields even for a literal command. No mock
      // or pre-exec barrier: change authority after entering the real backend.
      queueMicrotask(() => { if (action === "revoke") allowed = false; else controller.abort(); });
      await expect(execution).rejects.toThrow(action === "revoke" ? "Bash execution no longer authorized" : "aborted");
      expect(checks).toBe(action === "revoke" ? 1 : 0);
      expect(existsSync(join(directory, "sentinel"))).toBe(false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}

for (const invalid of [false, undefined, "true", Promise.resolve(true), Promise.resolve(false), "throw"] as const) {
  test(`tracked bash admission fails closed for ${String(invalid)}`, async () => {
    const directory = mkdtempSync(join(getTestWorkspace().workspace, "spawn-deny-"));
    let checks = 0;
    const ops = createTrackedBashOperations({ validateSpawn: (() => {
      checks++;
      if (invalid === "throw") throw new Error("private authority failure", { cause: new Error("private cause") });
      return invalid;
    }) as () => boolean });
    try {
      let error: unknown;
      try { await ops.exec("printf forbidden > sentinel", directory, { onData: () => {}, timeout: 2 }); }
      catch (caught) { error = caught; }
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Bash execution no longer authorized");
      expect(error).not.toHaveProperty("cause");
      expect(checks).toBe(1); // Policy denial must not fall back to another shell.
      expect(existsSync(join(directory, "sentinel"))).toBe(false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}

test("tracked bash observes invalid async admission without leaking rejections or spawning", async () => {
  const directory = mkdtempSync(join(getTestWorkspace().workspace, "spawn-async-deny-"));
  const source = `
    import { createTrackedBashOperations } from ${JSON.stringify(join(import.meta.dir, "../../src/tools/tracked-bash.ts"))};
    const marker = "PRIVATE_ASYNC_POLICY_SENTINEL";
    let unhandled = 0, settled = 0;
    process.on("unhandledRejection", () => { unhandled++; });
    const callbacks = [
      async () => { throw new Error(marker); },
      () => ({ then(_resolve, reject) { settled++; reject(new Error(marker)); } }),
      () => ({ get then() { settled++; throw new Error(marker); } }),
    ];
    for (const validateSpawn of callbacks) {
      const ops = createTrackedBashOperations({ shellPath: "/bin/bash", validateSpawn });
      try {
        await ops.exec("printf forbidden > sentinel", ${JSON.stringify(directory)}, { onData() {}, timeout: 2 });
        process.exit(2);
      } catch (error) {
        if (error.message !== "Bash execution no longer authorized" || error.cause) process.exit(3);
      }
      await Bun.sleep(0);
    }
    await Bun.sleep(10);
    console.log(JSON.stringify({ unhandled, settled }));
  `;
  try {
    const child = Bun.spawn([process.execPath, "--eval", source], {
      stdout: "pipe", stderr: "pipe",
      env: { ...process.env, PICLAW_WEB_VNC_ALLOW_DIRECT: undefined },
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ unhandled: 0, settled: 2 });
    expect(existsSync(join(directory, "sentinel"))).toBe(false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("tracked bash admits a literal true and rechecks each fallback candidate", async () => {
  const directory = mkdtempSync(join(getTestWorkspace().workspace, "spawn-fallback-"));
  const shell = join(directory, "unavailable-shell");
  writeFileSync(shell, "#!/no/such/interpreter\n", { mode: 0o700 });
  const restore = setEnv({ SHELL: shell });
  let checks = 0;
  try {
    const ops = createTrackedBashOperations({ validateSpawn: () => ++checks === 1 });
    await expect(ops.exec("printf forbidden > sentinel", directory, { onData: () => {}, timeout: 2 }))
      .rejects.toThrow("Bash execution no longer authorized");
    expect(checks).toBe(2);
    expect(existsSync(join(directory, "sentinel"))).toBe(false);
    const admitted = createTrackedBashOperations({ shellPath: "/bin/bash", validateSpawn: () => true });
    expect((await admitted.exec("printf admitted > sentinel", directory, { onData: () => {}, timeout: 2 })).exitCode).toBe(0);
    expect(readFileSync(join(directory, "sentinel"), "utf8")).toBe("admitted");
  } finally { restore(); rmSync(directory, { recursive: true, force: true }); }
});

test("tracked bash rechecks abort after a synchronous admission callback", async () => {
  const controller = new AbortController();
  const ops = createTrackedBashOperations({ validateSpawn: () => { controller.abort(); return true; } });
  let output = "";
  await expect(ops.exec("printf forbidden", getTestWorkspace().workspace, {
    signal: controller.signal, onData: chunk => { output += chunk; }, timeout: 2,
  })).rejects.toThrow("aborted");
  expect(output).toBe("");
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
