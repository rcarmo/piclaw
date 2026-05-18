import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { openSync, closeSync, readlinkSync, readdirSync, readFileSync, accessSync, existsSync, statSync, constants, read as fsRead, write as fsWrite } from "node:fs";
import { dirname, join } from "node:path";
import { FFIType, dlopen, ptr } from "bun:ffi";
import type { ServerWebSocket } from "bun";

import { WORKSPACE_DIR } from "../../../core/config.js";
import { DEFAULT_WEB_USER_ID, getWebSession } from "../../../db.js";
import { createLogger, debugSuppressedError } from "../../../utils/logger.js";
import { getSessionTokenFromRequest } from "../auth/session-auth.js";

export interface TerminalSessionOwner {
  token: string;
  userId: string;
  handoffToken?: string | null;
}

export interface TerminalSocketData extends TerminalSessionOwner {
  kind: "terminal";
  attachedSessionId?: string | null;
}

export interface TerminalClientMessageInput {
  type: "input";
  data: string;
}

export interface TerminalClientMessageResize {
  type: "resize";
  cols: number;
  rows: number;
}

export type TerminalClientMessage = TerminalClientMessageInput | TerminalClientMessageResize;

interface TerminalProcessLike {
  stdin: { write(chunk: string | Uint8Array): void; end?(): void };
  stdout: { on(event: "data", listener: (chunk: string | Uint8Array) => void): unknown };
  stderr: { on(event: "data", listener: (chunk: string | Uint8Array) => void): unknown };
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  kill(signal?: NodeJS.Signals | number): boolean;
  pid?: number | null;
}

export interface TerminalSessionServiceOptions {
  spawnProcess?: (cwd: string) => TerminalProcessLike;
  handoffTtlMs?: number;
  reconnectGraceMs?: number;
}

interface TerminalSessionRecord {
  id: string;
  owner: TerminalSessionOwner;
  process: TerminalProcessLike;
  clients: Set<ServerWebSocket<TerminalSocketData>>;
  createdAt: string;
  cwd: string;
  cols: number;
  rows: number;
  ptsPath: string | null;
  reconnectGraceDeadlineAt: number | null;
  reconnectGraceTimer: ReturnType<typeof setTimeout> | null;
  outputHistory: string[];
  outputHistoryBytes: number;
}

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;
const TERMINAL_FONT_FAMILY = "FiraCode Nerd Font Mono";
const TERMINAL_ANON_CLIENT_HEADER = "x-piclaw-terminal-client";

const IS_LINUX = process.platform === "linux";
const IS_MACOS = process.platform === "darwin";
const DEFAULT_TERMINAL_HANDOFF_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TERMINAL_RECONNECT_GRACE_MS = 300_000;
const DEFAULT_TERMINAL_OUTPUT_HISTORY_LIMIT_BYTES = 2 * 1024 * 1024;
const log = createLogger("web.terminal-session-service");

interface TerminalHandoffRecord {
  owner: TerminalSessionOwner;
  expiresAt: number;
}

function createTerminalHandoffToken(): string {
  try {
    return crypto.randomUUID();
  } catch (error) {
    debugSuppressedError(log, "crypto.randomUUID unavailable for terminal handoff token", error);
    return `terminal-handoff-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function createTerminalSessionId(): string {
  try {
    return crypto.randomUUID();
  } catch (error) {
    debugSuppressedError(log, "crypto.randomUUID unavailable for terminal session id", error);
    return `terminal-session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function readAnonymousTerminalClientToken(req: Request): string | null {
  try {
    const urlToken = new URL(req.url).searchParams.get("client")?.trim() || "";
    const headerToken = req.headers.get(TERMINAL_ANON_CLIENT_HEADER)?.trim() || "";
    const token = urlToken || headerToken;
    return /^[a-zA-Z0-9._:-]{8,128}$/.test(token) ? token : null;
  } catch {
    return null;
  }
}

// ioctl request code for setting terminal window size (Linux)
const TIOCSWINSZ = 0x5414;

/**
 * Lazy-loaded libc ioctl binding via Bun FFI.
 * Used to call ioctl(fd, TIOCSWINSZ, &winsize) for PTY resize.
 */
let _libc: { ioctl: (fd: number, request: number, buf: Uint16Array) => number } | null = null;
let _libcLoaded = false;

function getLibc(): typeof _libc {
  if (_libcLoaded) return _libc;
  _libcLoaded = true;
  try {
    const lib = dlopen("libc.so.6", {
      ioctl: {
        args: [FFIType.i32, FFIType.u64, FFIType.ptr],
        returns: FFIType.i32,
      },
    });
    _libc = {
      ioctl: (fd, request, buf) => lib.symbols.ioctl(fd, request, buf) as number,
    };
  } catch (error) {
    debugSuppressedError(log, "libc FFI unavailable; PTY resize disabled", error);
    _libc = null;
  }
  return _libc;
}

/**
 * Resize a PTY device via ioctl(TIOCSWINSZ).
 *
 * Opens the PTS device path, sets the kernel window size via the winsize
 * struct, then closes the fd. This is the same mechanism that terminal
 * emulators and Docker's exec resize API use.
 */
function resizePty(ptsPath: string, cols: number, rows: number): boolean {
  const libc = getLibc();
  if (!libc) return false;
  let fd = -1;
  try {
    // struct winsize { unsigned short ws_row, ws_col, ws_xpixel, ws_ypixel; }
    const winsize = new Uint16Array([rows, cols, 0, 0]);
    fd = openSync(ptsPath, 0); // O_RDONLY
    return libc.ioctl(fd, TIOCSWINSZ, winsize) === 0;
  } catch (error) {
    debugSuppressedError(log, "failed to resize PTY", error, { ptsPath, cols, rows });
    return false;
  } finally {
    if (fd >= 0) {
      try { closeSync(fd); } catch (error) { debugSuppressedError(log, "failed to close PTY fd after resize", error, { fd, ptsPath }); }
    }
  }
}

// ── macOS native PTY ─────────────────────────────────────────────────
//
// On macOS, terminal resize for setuid programs (e.g. /usr/bin/top)
// requires fork()+setsid()+TIOCSCTTY in the fork-exec gap. Bun's
// Bun.spawn uses posix_spawn which cannot do this. A small native
// addon (.dylib, ~80 lines of C) provides the necessary fork+exec.
// PTY I/O uses Node's fs.read/fs.write on the master fd.

interface MacOSPtyLib {
  pty_open(pairPtr: unknown, rows: number, cols: number): number;
  pty_fork_exec_simple(slaveFd: number, shellPtr: unknown): number;
  pty_resize(masterFd: number, rows: number, cols: number): number;
}

let _macPtyLib: MacOSPtyLib | null = null;
let _macPtyLibLoaded = false;

function getMacOSPtyLib(): MacOSPtyLib | null {
  if (_macPtyLibLoaded) return _macPtyLib;
  _macPtyLibLoaded = true;
  try {
    const dir = dirname(import.meta.path);
    const dylibPath = join(dir, "pty_native.dylib");
    const srcPath = join(dir, "pty_native.c");

    const needsCompile = existsSync(srcPath) && (
      !existsSync(dylibPath) ||
      statSync(srcPath).mtimeMs > statSync(dylibPath).mtimeMs
    );
    if (needsCompile) {
      const { execFileSync } = require("node:child_process");
      execFileSync("cc", ["-shared", "-o", dylibPath, srcPath], { timeout: 10000, stdio: "ignore" });
    }
    if (!existsSync(dylibPath)) return null;

    const lib = dlopen(dylibPath, {
      pty_open: { args: [FFIType.ptr, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
      pty_fork_exec_simple: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
      pty_resize: { args: [FFIType.i32, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    });

    _macPtyLib = {
      pty_open: (p: any, r: number, c: number) => lib.symbols.pty_open(p, r, c) as number,
      pty_fork_exec_simple: (sfd: number, sh: any) => lib.symbols.pty_fork_exec_simple(sfd, sh) as number,
      pty_resize: (mfd: number, r: number, c: number) => lib.symbols.pty_resize(mfd, r, c) as number,
    };
    log.info("macOS native PTY loaded", { dylibPath });
  } catch (error) {
    debugSuppressedError(log, "macOS native PTY unavailable", error);
    _macPtyLib = null;
  }
  return _macPtyLib;
}

function spawnMacOSNativePty(cwd: string, cols: number, rows: number): TerminalProcessLike | null {
  const ptyLib = getMacOSPtyLib();
  if (!ptyLib) return null;

  const pair = new Int32Array(2);
  if (ptyLib.pty_open(ptr(pair), rows, cols) !== 0) return null;
  const masterFd = pair[0];
  const slaveFd = pair[1];

  const shell = USER_SHELL;
  const shellBuf = Buffer.alloc(Buffer.byteLength(shell) + 1);
  shellBuf.write(shell);
  const childPid = ptyLib.pty_fork_exec_simple(slaveFd, ptr(shellBuf));
  closeSync(slaveFd);

  if (childPid <= 0) { closeSync(masterFd); return null; }

  const dataListeners: Array<(chunk: string | Uint8Array) => void> = [];
  const exitListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];
  let closed = false;
  const readBuf = Buffer.alloc(32768);
  const textDecoder = new TextDecoder("utf-8", { fatal: false });

  function readLoop() {
    if (closed) return;
    fsRead(masterFd, readBuf, 0, readBuf.length, null, (err, n) => {
      if (closed) return;
      if (err || !n) {
        if (err && (err as any).code === "EIO") {
          closed = true;
          for (const l of exitListeners) l(null, null);
          return;
        }
        setTimeout(readLoop, 10);
        return;
      }
      const data = textDecoder.decode(readBuf.subarray(0, n), { stream: true });
      for (const l of dataListeners) l(data);
      readLoop();
    });
  }
  readLoop();

  const exitCheck = setInterval(() => {
    try { process.kill(childPid, 0); } catch {
      if (!closed) {
        closed = true;
        clearInterval(exitCheck);
        for (const l of exitListeners) l(null, null);
      }
    }
  }, 2000);

  const proc: TerminalProcessLike & {
    __macOSNativePty: boolean;
    __resize(cols: number, rows: number): void;
  } = {
    __macOSNativePty: true,
    __resize(newCols: number, newRows: number) {
      if (!closed) ptyLib.pty_resize(masterFd, newRows, newCols);
    },
    stdin: {
      write(chunk: string | Uint8Array) {
        if (closed) return;
        const data = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
        fsWrite(masterFd, data, 0, data.length, null, (err) => {
          if (err) debugSuppressedError(log, "macOS PTY write failed", err as Error);
        });
      },
    },
    stdout: { on(event: string, listener: (chunk: string | Uint8Array) => void) { if (event === "data") dataListeners.push(listener); return this; } },
    stderr: { on() { return this; } },
    on(event: string, listener: (code: number | null, signal: NodeJS.Signals | null) => void) { if (event === "exit") exitListeners.push(listener); return this; },
    kill(signal?: NodeJS.Signals | number) {
      if (closed) return true;
      closed = true;
      clearInterval(exitCheck);
      try { process.kill(childPid, typeof signal === "string" ? signal : "SIGHUP"); } catch (error) { debugSuppressedError(log, "macOS PTY kill failed", error as Error); }
      try { closeSync(masterFd); } catch (error) { debugSuppressedError(log, "macOS PTY close failed", error as Error); }
      return true;
    },
    pid: childPid,
  };

  return proc;
}

/**
 * Find child PIDs of a given parent by reading /proc.
 */
function getChildPids(parentPid: number): number[] {
  if (!IS_LINUX) return [];
  try {
    return readdirSync("/proc")
      .filter((entry) => /^\d+$/.test(entry))
      .map((entry) => {
        try {
          const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
          // Format: pid (comm) state ppid ...
          const match = stat.match(/^\d+\s+\(.*?\)\s+\S+\s+(\d+)/);
          return match && parseInt(match[1], 10) === parentPid ? parseInt(entry, 10) : 0;
        } catch (error) {
          debugSuppressedError(log, "failed to inspect child process stat", error, { procEntry: entry, parentPid });
          return 0;
        }
      })
      .filter((pid) => pid > 0);
  } catch (error) {
    debugSuppressedError(log, "failed to scan /proc for child processes", error, { parentPid });
    return [];
  }
}

/**
 * Find the PTS device path for the shell spawned inside `script`.
 *
 * The process tree is: piclaw → script → bash
 * We walk child PIDs and check /proc/<pid>/fd/0 for a /dev/pts/* link.
 */
function findChildPts(parentPid: number): { ptsPath: string; childPids: number[] } | null {
  if (!IS_LINUX) return null;
  const childPids = getChildPids(parentPid);
  for (const cpid of childPids) {
    try {
      const target = readlinkSync(`/proc/${cpid}/fd/0`);
      if (target.startsWith("/dev/pts/")) {
        return { ptsPath: target, childPids };
      }
    } catch (error) {
      debugSuppressedError(log, "failed to inspect child PTY path", error, { parentPid, childPid: cpid });
    }
  }
  return null;
}

function normalizeChunk(chunk: string | Uint8Array): string {
  if (typeof chunk === "string") return chunk;
  return Buffer.from(chunk).toString("utf8");
}

const EXTRA_BIN_DIRS = ["/run/current-system/sw/bin", "/usr/local/bin", "/usr/bin", "/bin"];

function findExecutable(name: string): string {
  const dirs = (process.env.PATH || "").split(":").concat(EXTRA_BIN_DIRS);
  for (const dir of dirs) {
    const candidate = `${dir}/${name}`;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch (error) {
      debugSuppressedError(log, "candidate executable unavailable", error, { name, candidate });
    }
  }
  return name;
}

const SCRIPT_BIN = findExecutable("script");
const BASH_BIN = findExecutable("bash");
const EXPECT_BIN = IS_LINUX ? "" : findExecutable("expect");
const USER_SHELL = process.env.SHELL || BASH_BIN;
const IS_ZSH = USER_SHELL.endsWith("/zsh");

/** Build shell arguments: zsh gets PROMPT_SP disabled to avoid blank lines in the web terminal. */
function buildShellArgs(): string[] {
  return IS_ZSH ? ["+o", "PROMPT_SP", "-i"] : ["-i"];
}

function defaultSpawnProcess(cwd: string): TerminalProcessLike {
  // macOS: prefer native PTY addon for proper resize (including setuid apps like top).
  if (IS_MACOS) {
    const proc = spawnMacOSNativePty(cwd, DEFAULT_COLS, DEFAULT_ROWS);
    if (proc) return proc;
  }

  // Linux: use `script` with GNU flags to allocate a PTY.
  // macOS fallback: use `expect` (no resize for setuid apps).
  const shellArgs = buildShellArgs();
  const command = IS_LINUX
    ? { bin: SCRIPT_BIN, args: ["-qf", "-c", [USER_SHELL, ...shellArgs].join(" "), "/dev/null"] }
    : { bin: EXPECT_BIN, args: ["-c", `log_user 0; spawn -noecho ${USER_SHELL} ${shellArgs.join(" ")}; log_user 1; interact`] };
  return spawn(command.bin, command.args, {
    cwd,
    env: {
      ...process.env,
      TERM: process.env.TERM || "xterm-256color",
      COLORTERM: process.env.COLORTERM || "truecolor",
      CLICOLOR: process.env.CLICOLOR || "1",
      FORCE_COLOR: process.env.FORCE_COLOR || "1",
      HOME: process.env.HOME || "/home/agent",
      COLUMNS: String(DEFAULT_COLS),
      LINES: String(DEFAULT_ROWS),
      PROMPT_EOL_MARK: "",
      SHELL_SESSION_DID_INIT: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
}

export class TerminalSessionService {
  private readonly sessions = new Map<string, TerminalSessionRecord>();
  private readonly handoffs = new Map<string, TerminalHandoffRecord>();
  private readonly spawnProcess: (cwd: string) => TerminalProcessLike;
  private readonly handoffTtlMs: number;
  private readonly reconnectGraceMs: number;

  constructor(options: TerminalSessionServiceOptions = {}) {
    this.spawnProcess = options.spawnProcess ?? defaultSpawnProcess;
    this.handoffTtlMs = Number.isFinite(options.handoffTtlMs)
      ? Math.max(1, Number(options.handoffTtlMs))
      : DEFAULT_TERMINAL_HANDOFF_TTL_MS;
    this.reconnectGraceMs = Number.isFinite(options.reconnectGraceMs)
      ? Math.max(0, Number(options.reconnectGraceMs))
      : DEFAULT_TERMINAL_RECONNECT_GRACE_MS;
  }

  resolveOwnerFromRequest(req: Request, allowUnauthenticated = false): TerminalSocketData | null {
    const token = getSessionTokenFromRequest(req);
    if (token) {
      const session = getWebSession(token);
      if (session) {
        return { kind: "terminal", token, userId: session.user_id, handoffToken: null };
      }
    }
    if (!allowUnauthenticated) return null;
    const anonymousClientToken = readAnonymousTerminalClientToken(req);
    if (!anonymousClientToken) return null;
    return {
      kind: "terminal",
      token: `web-terminal-anon:${anonymousClientToken}`,
      userId: DEFAULT_WEB_USER_ID,
      handoffToken: null,
    };
  }

  getSessionInfo(owner: TerminalSessionOwner) {
    const session = this.sessions.get(owner.token);
    return {
      enabled: true,
      transport: "websocket",
      ws_path: "/terminal/ws",
      cwd: WORKSPACE_DIR,
      shell: "/usr/bin/bash -i",
      font_family: TERMINAL_FONT_FAMILY,
      active: Boolean(session),
      connected_clients: session?.clients.size ?? 0,
    };
  }

  attachClient(ws: ServerWebSocket<TerminalSocketData>): void {
    const owner = ws.data;
    const isHandoff = this.validateHandoff(owner);
    const existingSession = this.sessions.get(owner.token);
    const canResumeDetachedSession = !isHandoff && this.canResumeDetachedSession(owner);
    // Allow same-owner reconnect without resetting the session — the old client
    // may still be closing (WebSocket close is async). This prevents a race where
    // a tab-switch dispose + remount kills the shell because the old WS hasn't
    // fully closed yet.
    if (!isHandoff && !canResumeDetachedSession && !existingSession) {
      this.resetSession(owner, "fresh attach");
    }
    const session = this.ensureSession(owner);
    this.clearReconnectGrace(session);
    if (isHandoff) {
      for (const client of Array.from(session.clients)) {
        if (client === ws) continue;
        try {
          client.close(1000, "terminal handoff");
        } catch (error) {
          debugSuppressedError(log, "Old terminal websocket was already closing during handoff.", error, {
            token: owner.token,
            userId: owner.userId,
          });
        }
        session.clients.delete(client);
      }
    }
    const replayOutput = this.getReplayOutput(session);
    ws.data.attachedSessionId = session.id;
    session.clients.add(ws);
    this.send(ws, {
      type: "session",
      session_id: session.id,
      created_at: session.createdAt,
      process_pid: session.process.pid ?? null,
      cwd: session.cwd,
      cols: session.cols,
      rows: session.rows,
      font_family: TERMINAL_FONT_FAMILY,
    });
    if (replayOutput) {
      this.send(ws, {
        type: "output",
        data: replayOutput,
      });
    }
  }

  handleMessage(ws: ServerWebSocket<TerminalSocketData>, rawMessage: string | Buffer | Uint8Array): void {
    const session = this.sessions.get(ws.data.token);
    if (!session) return;
    if (!session.clients.has(ws)) return;

    const messageText = typeof rawMessage === "string" ? rawMessage : Buffer.from(rawMessage).toString("utf8");
    const payload = this.parseClientMessage(messageText);

    if (payload.type === "input") {
      if (typeof payload.data === "string" && payload.data.length > 0) {
        try {
          session.process.stdin.write(payload.data);
        } catch (error) {
          debugSuppressedError(log, "failed to write terminal input to process stdin", error, {
            token: ws.data.token,
            userId: ws.data.userId,
            sessionId: session.id,
            processPid: session.process.pid ?? null,
            ptsPath: session.ptsPath,
          });
        }
      }
      return;
    }

    if (payload.type === "resize") {
      const cols = Number.isFinite(payload.cols) ? Math.max(20, Math.min(400, Math.floor(payload.cols))) : session.cols;
      const rows = Number.isFinite(payload.rows) ? Math.max(5, Math.min(200, Math.floor(payload.rows))) : session.rows;
      if (cols !== session.cols || rows !== session.rows) {
        session.cols = cols;
        session.rows = rows;
        this.resizeSession(session, cols, rows);
      }
      return;
    }
  }

  detachClient(ws: ServerWebSocket<TerminalSocketData>): void {
    const attachedSessionId = String(ws.data.attachedSessionId || "").trim();
    if (!attachedSessionId) return;
    const session = Array.from(this.sessions.values()).find(
      (candidate) => candidate.id === attachedSessionId && candidate.owner.token === ws.data.token,
    );
    if (!session) return;
    session.clients.delete(ws);
    if (session.clients.size > 0) {
      this.clearReconnectGrace(session);
      return;
    }
    if (this.hasPendingHandoff(ws.data)) {
      this.clearReconnectGrace(session);
      return;
    }
    this.scheduleReconnectGrace(session);
  }

  private parseClientMessage(messageText: string): TerminalClientMessage {
    try {
      return JSON.parse(messageText) as TerminalClientMessage;
    } catch (error) {
      debugSuppressedError(log, "terminal control frame was not JSON; treating as input", error);
      return { type: "input", data: messageText };
    }
  }

  createHandoffFromRequest(req: Request, allowUnauthenticated = false): { token: string; expires_at: string } | null {
    const owner = this.resolveOwnerFromRequest(req, allowUnauthenticated);
    if (!owner) return null;
    const session = this.sessions.get(owner.token);
    if (!session || session.clients.size === 0) return null;
    this.sweepExpiredHandoffs();
    const token = createTerminalHandoffToken();
    const expiresAt = Date.now() + this.handoffTtlMs;
    this.handoffs.set(token, {
      owner: { token: owner.token, userId: owner.userId, handoffToken: null },
      expiresAt,
    });
    return {
      token,
      expires_at: new Date(expiresAt).toISOString(),
    };
  }

  shutdown(): void {
    for (const session of this.sessions.values()) {
      this.clearReconnectGrace(session);
      try {
        session.process.kill("SIGHUP");
      } catch (error) {
        debugSuppressedError(log, "terminal process already exited during shutdown", error, { pid: session.process.pid ?? null });
      }
    }
    this.sessions.clear();
    this.handoffs.clear();
  }

  /**
   * Resize a terminal session's PTY via ioctl(TIOCSWINSZ) + SIGWINCH.
   *
   * On first resize, discovers the PTS device path by walking /proc for
   * the child shell's fd/0 link. Once found, caches it for subsequent
   * resizes. Sends SIGWINCH to all child processes after updating the
   * kernel window size.
   */
  private resizeSession(session: TerminalSessionRecord, cols: number, rows: number): void {
    // macOS native PTY: resize via ioctl in the addon
    const proc = session.process as any;
    if (proc?.__macOSNativePty && typeof proc.__resize === "function") {
      proc.__resize(cols, rows);
      return;
    }

    // Linux: ioctl on PTS device + SIGWINCH to children
    const pid = session.process.pid;
    if (!pid) return;

    if (!session.ptsPath) {
      const result = findChildPts(pid);
      if (result) session.ptsPath = result.ptsPath;
    }

    if (!session.ptsPath) return;

    if (resizePty(session.ptsPath, cols, rows)) {
      // Send SIGWINCH to child processes so they re-query the terminal size
      for (const cpid of getChildPids(pid)) {
        try { process.kill(cpid, "SIGWINCH"); } catch (error) { debugSuppressedError(log, "failed to deliver SIGWINCH to child process", error, { childPid: cpid, sessionPid: pid }); }
      }
    }
  }

  private sweepExpiredHandoffs(nowMs = Date.now()): void {
    for (const [token, record] of this.handoffs.entries()) {
      if (!record || record.expiresAt <= nowMs) {
        this.handoffs.delete(token);
      }
    }
  }

  private validateHandoff(owner: TerminalSessionOwner): boolean {
    const handoffToken = String(owner?.handoffToken || "").trim();
    if (!handoffToken) return false;
    this.sweepExpiredHandoffs();
    const record = this.handoffs.get(handoffToken);
    if (!record) return false;
    if (record.owner.token !== owner.token || record.owner.userId !== owner.userId) return false;
    this.handoffs.delete(handoffToken);
    return true;
  }

  private hasPendingHandoff(owner: TerminalSessionOwner): boolean {
    this.sweepExpiredHandoffs();
    for (const record of this.handoffs.values()) {
      if (record.owner.token === owner.token && record.owner.userId === owner.userId) {
        return true;
      }
    }
    return false;
  }

  private ensureSession(owner: TerminalSessionOwner): TerminalSessionRecord {
    const existing = this.sessions.get(owner.token);
    if (existing) return existing;

    const proc = this.spawnProcess(WORKSPACE_DIR);
    const session: TerminalSessionRecord = {
      id: createTerminalSessionId(),
      owner,
      process: proc,
      clients: new Set(),
      createdAt: new Date().toISOString(),
      cwd: WORKSPACE_DIR,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      ptsPath: null,
      reconnectGraceDeadlineAt: null,
      reconnectGraceTimer: null,
      outputHistory: [],
      outputHistoryBytes: 0,
    };

    proc.stdout.on("data", (chunk) => {
      const data = normalizeChunk(chunk);
      this.appendOutputHistory(session, data);
      this.broadcast(session, { type: "output", data });
    });
    proc.stderr.on("data", (chunk) => {
      const data = normalizeChunk(chunk);
      this.appendOutputHistory(session, data);
      this.broadcast(session, { type: "output", data });
    });
    proc.on("exit", (code, signal) => {
      this.broadcast(session, { type: "exit", code: code ?? null, signal: signal ?? null });
      const current = this.sessions.get(owner.token);
      if (current?.id === session.id) {
        this.clearReconnectGrace(session);
        this.sessions.delete(owner.token);
      }
    });

    // Discover PTS device path after a short delay to let `script` allocate the PTY,
    // then set the initial window size via ioctl so the shell starts with correct dimensions.
    if (IS_LINUX && proc.pid) {
      setTimeout(() => {
        if (!proc.pid) return;
        const result = findChildPts(proc.pid);
        if (result) {
          session.ptsPath = result.ptsPath;
          resizePty(result.ptsPath, session.cols, session.rows);
          for (const cpid of result.childPids) {
            try { process.kill(cpid, "SIGWINCH"); } catch (error) { debugSuppressedError(log, "failed to deliver initial SIGWINCH to child process", error, { childPid: cpid, sessionPid: proc.pid ?? null }); }
          }
        }
      }, 300);
    }

    this.sessions.set(owner.token, session);
    return session;
  }

  private resetSession(owner: TerminalSessionOwner, reason: string): void {
    const session = this.sessions.get(owner.token);
    if (!session) return;
    this.clearReconnectGrace(session);
    for (const client of Array.from(session.clients)) {
      try {
        client.close(1000, reason);
      } catch (error) {
        debugSuppressedError(log, "terminal websocket already closing during session reset", error, {
          token: owner.token,
          userId: owner.userId,
          reason,
        });
      }
    }
    session.clients.clear();
    try {
      session.process.kill("SIGHUP");
    } catch (error) {
      debugSuppressedError(log, "terminal process already exited during session reset", error, {
        pid: session.process.pid ?? null,
        token: owner.token,
        userId: owner.userId,
        reason,
      });
    }
    this.sessions.delete(owner.token);
  }

  private appendOutputHistory(session: TerminalSessionRecord, chunk: string): void {
    if (!chunk) return;
    session.outputHistory.push(chunk);
    session.outputHistoryBytes += Buffer.byteLength(chunk, "utf8");
    while (session.outputHistoryBytes > DEFAULT_TERMINAL_OUTPUT_HISTORY_LIMIT_BYTES && session.outputHistory.length > 1) {
      const removed = session.outputHistory.shift() || "";
      session.outputHistoryBytes -= Buffer.byteLength(removed, "utf8");
    }
    if (session.outputHistoryBytes < 0) {
      session.outputHistoryBytes = 0;
    }
  }

  private getReplayOutput(session: TerminalSessionRecord): string {
    return session.outputHistory.length > 0 ? session.outputHistory.join("") : "";
  }

  private clearReconnectGrace(session: TerminalSessionRecord | null | undefined): void {
    if (!session) return;
    session.reconnectGraceDeadlineAt = null;
    if (!session.reconnectGraceTimer) return;
    clearTimeout(session.reconnectGraceTimer);
    session.reconnectGraceTimer = null;
  }

  private canResumeDetachedSession(owner: TerminalSessionOwner, nowMs = Date.now()): boolean {
    const session = this.sessions.get(owner.token);
    if (!session) return false;
    if (session.clients.size > 0) return false;
    const deadline = Number.isFinite(session.reconnectGraceDeadlineAt)
      ? Number(session.reconnectGraceDeadlineAt)
      : null;
    return deadline !== null && deadline >= nowMs;
  }

  private scheduleReconnectGrace(session: TerminalSessionRecord, nowMs = Date.now()): void {
    this.clearReconnectGrace(session);
    if (!(this.reconnectGraceMs > 0)) {
      this.terminateDetachedSession(session, "last-client detach");
      return;
    }
    session.reconnectGraceDeadlineAt = nowMs + this.reconnectGraceMs;
    session.reconnectGraceTimer = setTimeout(() => {
      session.reconnectGraceTimer = null;
      const current = this.sessions.get(session.owner.token);
      if (current?.id !== session.id) return;
      if (session.clients.size > 0) {
        this.clearReconnectGrace(session);
        return;
      }
      if (this.hasPendingHandoff(session.owner)) {
        this.clearReconnectGrace(session);
        return;
      }
      this.terminateDetachedSession(session, "last-client detach");
    }, this.reconnectGraceMs);
  }

  private terminateDetachedSession(session: TerminalSessionRecord, reason: string): void {
    this.clearReconnectGrace(session);
    try {
      session.process.kill("SIGHUP");
    } catch (error) {
      debugSuppressedError(log, "terminal process already exited during detached session cleanup", error, {
        pid: session.process.pid ?? null,
        token: session.owner.token,
        userId: session.owner.userId,
        sessionId: session.id,
        reason,
      });
    }
    const current = this.sessions.get(session.owner.token);
    if (current?.id === session.id) {
      this.sessions.delete(session.owner.token);
    }
  }

  private broadcast(session: TerminalSessionRecord, payload: Record<string, unknown>): void {
    const encoded = JSON.stringify(payload);
    for (const client of Array.from(session.clients)) {
      this.send(client, encoded, true);
    }
  }

  private send(ws: ServerWebSocket<TerminalSocketData>, payload: string | Record<string, unknown>, preEncoded = false): void {
    try {
      ws.send(preEncoded ? (payload as string) : JSON.stringify(payload));
    } catch (error) {
      debugSuppressedError(log, "failed to send terminal websocket payload", error, { token: ws.data?.token ?? null, userId: ws.data?.userId ?? null });
    }
  }
}
