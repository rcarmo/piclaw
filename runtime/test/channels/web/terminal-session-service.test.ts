import { beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WEB_RUNTIME_CONFIG } from "../../../src/core/config.js";
import { createWebSession, deleteExpiredWebSessions, getDb, initDatabase } from "../../../src/db.js";
import {
  TerminalSessionService,
  buildShellArgs,
  findExecutable,
  isExplicitExecutablePath,
  resolveLinuxTerminalBackend,
  resolveTerminalShell,
  spawnBunNativePty,
} from "../../../src/channels/web/terminal/terminal-session-service.js";

class FakeStream {
  listeners: Array<(chunk: string) => void> = [];

  on(event: "data", listener: (chunk: string) => void) {
    if (event === "data") this.listeners.push(listener);
  }

  emit(chunk: string) {
    for (const listener of this.listeners) listener(chunk);
  }
}

class FakeProcess {
  stdinWrites: string[] = [];
  stdout = new FakeStream();
  stderr = new FakeStream();
  exitListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];
  killed = false;

  stdin = {
    write: (chunk: string | Uint8Array) => {
      this.stdinWrites.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    },
    end: () => {},
  };

  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void) {
    if (event === "exit") this.exitListeners.push(listener);
  }

  kill() {
    this.killed = true;
    return true;
  }

  emitExit(code: number | null = 0, signal: NodeJS.Signals | null = null) {
    for (const listener of this.exitListeners) listener(code, signal);
  }
}

beforeEach(() => {
  initDatabase();
  getDb().prepare("DELETE FROM web_sessions").run();
  deleteExpiredWebSessions(new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000));
});

test("terminal shell and backend selection prefer explicit native-capable paths", () => {
  const root = mkdtempSync(join(tmpdir(), "piclaw-explicit-shell-"));
  const shell = join(root, process.platform === "win32" ? "shell.exe" : "shell");
  try {
    writeFileSync(shell, "test");
    chmodSync(shell, 0o755);
    expect(resolveTerminalShell({ PICLAW_TERMINAL_SHELL: shell, PATH: root }, null)).toBe(shell);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  expect(buildShellArgs("/usr/bin/zsh")).toEqual(["+o", "PROMPT_SP", "-i"]);
  expect(buildShellArgs("/bin/sh")).toEqual(["-i"]);
  expect(buildShellArgs("C:\\Program Files\\PowerShell\\7\\pwsh.exe")).toEqual(["-NoLogo", "-NoProfile"]);
  expect(buildShellArgs("C:\\Windows\\System32\\cmd.exe")).toEqual(["/Q"]);
  expect(resolveLinuxTerminalBackend({ bunTerminalAvailable: true, setsidPath: "/usr/bin/setsid", scriptPath: null })).toBe("bun-native-pty");
  expect(resolveLinuxTerminalBackend({ bunTerminalAvailable: true, setsidPath: null, scriptPath: "/usr/bin/script" })).toBe("script");
  expect(resolveLinuxTerminalBackend({ bunTerminalAvailable: false, setsidPath: "/usr/bin/setsid", scriptPath: "/usr/bin/script" })).toBe("script");
  expect(resolveLinuxTerminalBackend({ bunTerminalAvailable: false, setsidPath: null, scriptPath: null })).toBe("unavailable");
});

test("explicit executable path detection is platform-aware", () => {
  expect(isExplicitExecutablePath("C:\\Windows\\System32\\cmd.exe", "win32")).toBeTrue();
  expect(isExplicitExecutablePath("C:/Windows/System32/cmd.exe", "win32")).toBeTrue();
  expect(isExplicitExecutablePath("\\\\server\\share\\pwsh.exe", "win32")).toBeTrue();
  expect(isExplicitExecutablePath("pwsh.exe", "win32")).toBeFalse();
  expect(isExplicitExecutablePath("/bin/bash", "linux")).toBeTrue();
  expect(isExplicitExecutablePath("bin/bash", "linux")).toBeTrue();
  expect(isExplicitExecutablePath("bash", "linux")).toBeFalse();
  expect(isExplicitExecutablePath("C:\\Windows\\System32\\cmd.exe", "linux")).toBeFalse();
});

test("Windows executable discovery uses semicolon PATH entries and PATHEXT", () => {
  const root = mkdtempSync(join(tmpdir(), "piclaw-win-path-"));
  try {
    const first = join(root, "first");
    const second = join(root, "second");
    const executable = join(second, "pwsh.EXE");
    mkdirSync(first);
    mkdirSync(second);
    writeFileSync(executable, "test");
    chmodSync(executable, 0o755);
    const env = { PATH: `${first};${second}`, PATHEXT: ".EXE;.CMD" };
    expect(findExecutable("pwsh", env, "win32")?.toLowerCase()).toBe(executable.toLowerCase());
    expect(resolveTerminalShell({ ...env, PICLAW_TERMINAL_SHELL: "pwsh" }, null, "win32").toLowerCase()).toBe(executable.toLowerCase());
    expect(resolveTerminalShell({ ...env, PICLAW_TERMINAL_SHELL: join(first, "missing.exe"), COMSPEC: executable }, null, "win32").toLowerCase()).toBe(executable.toLowerCase());
    expect(resolveTerminalShell({ PATH: first, PATHEXT: ".EXE;.CMD", COMSPEC: executable }, null, "win32").toLowerCase()).toBe(executable.toLowerCase());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const windowsNativePtyTest = process.platform === "win32" && typeof Bun.Terminal === "function" ? test : test.skip;

windowsNativePtyTest("Bun native Windows PTY runs PowerShell without expect", async () => {
  const shell = resolveTerminalShell(process.env, null, "win32");
  const proc = spawnBunNativePty(process.cwd(), { ...process.env, TERM: "xterm-256color" }, shell, 80, 24, null);
  expect(proc).not.toBeNull();
  const output: string[] = [];
  proc!.stdout.on("data", (chunk) => output.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")));
  const exited = new Promise<void>((resolve) => proc!.on("exit", () => resolve()));
  proc!.stdin.write("Write-Output PICLAW_WINDOWS_PTY_OK; exit\r\n");
  await Promise.race([
    exited,
    Bun.sleep(10_000).then(() => { throw new Error("Windows PTY shell did not exit"); }),
  ]);
  expect(output.join("")).toContain("PICLAW_WINDOWS_PTY_OK");
}, 15_000);

const nativePtyTest = process.platform === "linux" && typeof Bun.Terminal === "function" ? test : test.skip;

nativePtyTest("Bun native Linux PTY provides a controlling TTY and foreground job control without script", async () => {
  const setsid = "/usr/bin/setsid";
  const proc = spawnBunNativePty(process.cwd(), { ...process.env, PS1: "", TERM: "xterm-256color" }, "/bin/bash", 80, 24, setsid);
  expect(proc).not.toBeNull();
  const output: string[] = [];
  proc!.stdout.on("data", (chunk) => output.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")));
  const exited = new Promise<void>((resolve) => proc!.on("exit", () => resolve()));
  try {
    // Assert command output while the PTY is open, not against an exit/data
    // callback race. Require a complete marker line rather than echoed input.
    proc!.stdin.write("tty; /bin/sh -c 't=$(ps -o tpgid= -p $$); p=$(ps -o pgid= -p $$); [ $t -eq $p ] && echo PICLAW_JOB_CONTROL_OK'\n");
    const deadline = Date.now() + 5_000;
    while (!/^PICLAW_JOB_CONTROL_OK\r?$/m.test(output.join("")) && Date.now() < deadline) await Bun.sleep(10);
    const text = output.join("");
    expect(text).toMatch(/\/dev\/pts\/\d+/);
    expect(text).toMatch(/^PICLAW_JOB_CONTROL_OK\r?$/m);
    expect(text).not.toContain("no job control");
    expect(text).not.toContain("can't access tty");
    proc!.stdin.write("exit\n");
    await Promise.race([
      exited,
      Bun.sleep(2_000).then(() => { throw new Error("native PTY shell did not exit"); }),
    ]);
  } finally { proc!.kill(); }
}, 10_000);

test("terminal session service resolves owner from web session cookie", () => {
  createWebSession("terminal-token", "user-1", 3600, "totp");
  const service = new TerminalSessionService({
    spawnProcess: () => new FakeProcess() as any,
  });

  const req = new Request("https://example.com/terminal/session", {
    headers: { cookie: "piclaw_session=terminal-token" },
  });

  expect(service.resolveOwnerFromRequest(req)).toEqual({ kind: "terminal", token: "terminal-token", userId: "user-1", handoffToken: null });
});

test("terminal session service derives an anonymous owner from the per-client token when allowed", () => {
  const service = new TerminalSessionService({
    spawnProcess: () => new FakeProcess() as any,
  });

  const req = new Request("https://example.com/terminal/session", {
    headers: { "x-piclaw-terminal-client": "anon-client-1" },
  });
  expect(service.resolveOwnerFromRequest(req, true)).toEqual({
    kind: "terminal",
    token: "web-terminal-anon:anon-client-1",
    userId: "default",
    handoffToken: null,
  });
});

test("terminal session service refuses unauthenticated fallback when no per-client token is supplied", () => {
  const service = new TerminalSessionService({
    spawnProcess: () => new FakeProcess() as any,
  });

  const req = new Request("https://example.com/terminal/session");
  expect(service.resolveOwnerFromRequest(req, true)).toBeNull();
});

test("terminal session service passes the configured image protocol into spawned shells", () => {
  const previousProtocol = WEB_RUNTIME_CONFIG.terminalImageProtocol;
  const previousInlineProtocol = process.env.TERM_INLINE_IMAGE_PROTOCOL;
  const spawnedEnvs: NodeJS.ProcessEnv[] = [];

  try {
    WEB_RUNTIME_CONFIG.terminalImageProtocol = "sixel";
    delete process.env.TERM_INLINE_IMAGE_PROTOCOL;

    const service = new TerminalSessionService({
      spawnProcess: (_cwd, env) => {
        spawnedEnvs.push({ ...env });
        return new FakeProcess() as any;
      },
    });
    const ws = {
      data: { kind: "terminal", token: "terminal-config", userId: "user-config", handoffToken: null },
      send: () => {},
    } as any;

    service.attachClient(ws);

    expect(spawnedEnvs).toHaveLength(1);
    expect(spawnedEnvs[0]?.PICLAW_TERMINAL).toBe("1");
    expect(spawnedEnvs[0]?.PICLAW_TERMINAL_IMAGE_PROTOCOL).toBe("sixel");
    expect(spawnedEnvs[0]?.TERM_INLINE_IMAGE_PROTOCOL).toBe("sixel");
  } finally {
    WEB_RUNTIME_CONFIG.terminalImageProtocol = previousProtocol;
    if (previousInlineProtocol === undefined) delete process.env.TERM_INLINE_IMAGE_PROTOCOL;
    else process.env.TERM_INLINE_IMAGE_PROTOCOL = previousInlineProtocol;
  }
});

test("terminal session service spawns one shell per web session and relays IO", () => {
  createWebSession("terminal-io", "user-io", 3600, "totp");
  const processes: FakeProcess[] = [];
  const service = new TerminalSessionService({
    spawnProcess: () => {
      const proc = new FakeProcess();
      processes.push(proc);
      return proc as any;
    },
  });

  const owner = { token: "terminal-io", userId: "user-io" };
  const sent: string[] = [];
  const ws = {
    data: owner,
    send: (payload: string) => sent.push(payload),
  } as any;

  expect(service.getSessionInfo(owner).active).toBe(false);
  service.attachClient(ws);
  expect(processes.length).toBe(1);
  expect(service.getSessionInfo(owner).active).toBe(true);
  expect(service.getSessionInfo(owner).connected_clients).toBe(1);

  service.handleMessage(ws, JSON.stringify({ type: "input", data: "pwd\n" }));
  service.handleMessage(ws, JSON.stringify({ type: "resize", cols: 100, rows: 40 }));

  expect(processes[0].stdinWrites.some((entry) => entry.includes("pwd\n"))).toBe(true);
  expect(processes[0].stdinWrites.some((entry) => entry.includes("stty cols 100 rows 40"))).toBe(false);
  expect(processes[0].stdinWrites.some((entry) => entry.includes("\\033[?25h"))).toBe(false);

  processes[0].stdout.emit("hello from shell\r\n");
  expect(sent.some((payload) => payload.includes("hello from shell"))).toBe(true);

  processes[0].emitExit(0, null);
  expect(service.getSessionInfo(owner).active).toBe(false);
});

test("terminal session handoff ignores already-closing prior clients during takeover", () => {
  createWebSession("terminal-handoff-throws", "user-handoff", 3600, "totp");
  const proc = new FakeProcess();
  const service = new TerminalSessionService({
    spawnProcess: () => proc as any,
  });
  const first = {
    data: { kind: "terminal", token: "terminal-handoff-throws", userId: "user-handoff", handoffToken: null },
    send: () => {},
    close: () => { throw new Error("already closing"); },
  } as any;

  service.attachClient(first);
  const req = new Request("https://example.com/terminal/handoff", {
    method: "POST",
    headers: { cookie: "piclaw_session=terminal-handoff-throws" },
  });
  const handoff = service.createHandoffFromRequest(req);

  const second = {
    data: { kind: "terminal", token: "terminal-handoff-throws", userId: "user-handoff", handoffToken: handoff?.token || null },
    send: () => {},
    close: () => undefined,
  } as any;

  expect(() => service.attachClient(second)).not.toThrow();
  expect(service.getSessionInfo({ token: "terminal-handoff-throws", userId: "user-handoff" }).connected_clients).toBe(1);
});

test("terminal session handoff tokens are issued for live sessions and close prior clients on takeover", () => {
  createWebSession("terminal-handoff", "user-handoff", 3600, "totp");
  const proc = new FakeProcess();
  const service = new TerminalSessionService({
    spawnProcess: () => proc as any,
  });
  const closes: string[] = [];
  const first = {
    data: { kind: "terminal", token: "terminal-handoff", userId: "user-handoff", handoffToken: null },
    send: () => {},
    close: () => closes.push("first"),
  } as any;

  service.attachClient(first);
  const req = new Request("https://example.com/terminal/handoff", {
    method: "POST",
    headers: { cookie: "piclaw_session=terminal-handoff" },
  });
  const handoff = service.createHandoffFromRequest(req);
  expect(handoff?.token).toBeTruthy();

  const second = {
    data: { kind: "terminal", token: "terminal-handoff", userId: "user-handoff", handoffToken: handoff?.token || null },
    send: () => {},
    close: () => closes.push("second"),
  } as any;

  service.attachClient(second);
  expect(closes).toEqual(["first"]);
  expect(service.getSessionInfo({ token: "terminal-handoff", userId: "user-handoff" }).connected_clients).toBe(1);
});

test("terminal session service ignores input from detached clients during reconnect grace", () => {
  createWebSession("terminal-detached", "user-detached", 3600, "totp");
  const proc = new FakeProcess();
  const service = new TerminalSessionService({
    spawnProcess: () => proc as any,
    reconnectGraceMs: 1_000,
  });
  const ws = {
    data: { kind: "terminal", token: "terminal-detached", userId: "user-detached", handoffToken: null },
    send: () => {},
  } as any;

  service.attachClient(ws);
  service.detachClient(ws);

  expect(service.getSessionInfo({ token: "terminal-detached", userId: "user-detached" }).active).toBe(true);
  expect(service.getSessionInfo({ token: "terminal-detached", userId: "user-detached" }).connected_clients).toBe(0);

  service.handleMessage(ws, JSON.stringify({ type: "input", data: "whoami\n" }));
  expect(proc.stdinWrites).toEqual([]);
});

test("terminal session shutdown kills live shells", () => {
  const proc = new FakeProcess();
  const service = new TerminalSessionService({
    spawnProcess: () => proc as any,
  });
  const owner = { token: "terminal-shutdown", userId: "user-shutdown" };
  const ws = {
    data: owner,
    send: () => {},
  } as any;

  service.attachClient(ws);
  service.shutdown();
  expect(proc.killed).toBe(true);
});
