import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { openSync, closeSync, readlinkSync, readdirSync, readFileSync, accessSync, constants } from "node:fs";
import { FFIType, dlopen } from "bun:ffi";
import type { ServerWebSocket } from "bun";

import { WORKSPACE_DIR } from "../../../core/config.js";
import { DEFAULT_WEB_USER_ID, getWebSession } from "../../../db.js";
import { getSessionTokenFromRequest } from "../auth/session-auth.js";

export interface TerminalSessionOwner {
  token: string;
  userId: string;
  handoffToken?: string | null;
}

export interface TerminalSocketData extends TerminalSessionOwner {
  kind: "terminal";
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
}

interface TerminalSessionRecord {
  owner: TerminalSessionOwner;
  process: TerminalProcessLike;
  clients: Set<ServerWebSocket<TerminalSocketData>>;
  createdAt: string;
  cwd: string;
  cols: number;
  rows: number;
  ptsPath: string | null;
}

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;
const TERMINAL_FONT_FAMILY = "FiraCode Nerd Font Mono";
const FALLBACK_TERMINAL_OWNER: TerminalSessionOwner = {
  token: "web-terminal-local-default",
  userId: DEFAULT_WEB_USER_ID,
};

const IS_LINUX = process.platform === "linux";
const DEFAULT_TERMINAL_HANDOFF_TTL_MS = 5 * 60 * 1000;

interface TerminalHandoffRecord {
  owner: TerminalSessionOwner;
  expiresAt: number;
}

function createTerminalHandoffToken(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `terminal-handoff-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
  } catch {
    /* expected: PTY resizing is optional when libc FFI is unavailable. */
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
  } catch {
    /* expected: PTY path can disappear during resize races. */
    return false;
  } finally {
    if (fd >= 0) {
      try { closeSync(fd); } catch { /* expected: fd may already be closed during PTY teardown. */ }
    }
  }
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
        } catch {
          /* expected: /proc entries may vanish while scanning child processes. */
          return 0;
        }
      })
      .filter((pid) => pid > 0);
  } catch {
    /* expected: /proc traversal is unavailable or racing on non-Linux/teardown paths. */
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
    } catch {
      /* expected: child may exit before /proc/<pid>/fd/0 can be inspected. */
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
    try { accessSync(candidate, constants.X_OK); return candidate; } catch { /* next */ }
  }
  return name;
}

const SCRIPT_BIN = findExecutable("script");
const BASH_BIN = findExecutable("bash");

function defaultSpawnProcess(cwd: string): TerminalProcessLike {
  return spawn(SCRIPT_BIN, ["-qf", "-c", `${BASH_BIN} -i`, "/dev/null"], {
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
    },
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
}

export class TerminalSessionService {
  private readonly sessions = new Map<string, TerminalSessionRecord>();
  private readonly handoffs = new Map<string, TerminalHandoffRecord>();
  private readonly spawnProcess: (cwd: string) => TerminalProcessLike;
  private readonly handoffTtlMs: number;

  constructor(options: TerminalSessionServiceOptions = {}) {
    this.spawnProcess = options.spawnProcess ?? defaultSpawnProcess;
    this.handoffTtlMs = Number.isFinite(options.handoffTtlMs)
      ? Math.max(1, Number(options.handoffTtlMs))
      : DEFAULT_TERMINAL_HANDOFF_TTL_MS;
  }

  resolveOwnerFromRequest(req: Request, allowUnauthenticated = false): TerminalSocketData | null {
    const token = getSessionTokenFromRequest(req);
    if (token) {
      const session = getWebSession(token);
      if (session) {
        return { kind: "terminal", token, userId: session.user_id, handoffToken: null };
      }
    }
    return allowUnauthenticated ? { kind: "terminal", ...FALLBACK_TERMINAL_OWNER, handoffToken: null } : null;
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
    const session = this.ensureSession(owner);
    if (this.validateHandoff(owner)) {
      for (const client of Array.from(session.clients)) {
        if (client === ws) continue;
        try {
          client.close(1000, "terminal handoff");
        } catch {
          /* expected: old browser websocket may already be closing during handoff. */
        }
        session.clients.delete(client);
      }
    }
    session.clients.add(ws);
    this.send(ws, {
      type: "session",
      cwd: session.cwd,
      cols: session.cols,
      rows: session.rows,
      font_family: TERMINAL_FONT_FAMILY,
    });
  }

  handleMessage(ws: ServerWebSocket<TerminalSocketData>, rawMessage: string | Buffer | Uint8Array): void {
    const session = this.sessions.get(ws.data.token);
    if (!session) return;

    const messageText = typeof rawMessage === "string" ? rawMessage : Buffer.from(rawMessage).toString("utf8");
    const payload = this.parseClientMessage(messageText);

    if (payload.type === "input") {
      if (typeof payload.data === "string" && payload.data.length > 0) {
        session.process.stdin.write(payload.data);
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
    const session = this.sessions.get(ws.data.token);
    if (!session) return;
    session.clients.delete(ws);
  }

  private parseClientMessage(messageText: string): TerminalClientMessage {
    try {
      return JSON.parse(messageText) as TerminalClientMessage;
    } catch {
      /* expected: plain text input frames are not JSON control messages. */
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
      try {
        session.process.kill("SIGHUP");
      } catch {
        /* expected: terminal process may already be gone during shutdown. */
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
        try { process.kill(cpid, "SIGWINCH"); } catch { /* expected: child may exit between pid scan and signal delivery. */ }
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
    return true;
  }

  private ensureSession(owner: TerminalSessionOwner): TerminalSessionRecord {
    const existing = this.sessions.get(owner.token);
    if (existing) return existing;

    const proc = this.spawnProcess(WORKSPACE_DIR);
    const session: TerminalSessionRecord = {
      owner,
      process: proc,
      clients: new Set(),
      createdAt: new Date().toISOString(),
      cwd: WORKSPACE_DIR,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      ptsPath: null,
    };

    proc.stdout.on("data", (chunk) => {
      this.broadcast(session, { type: "output", data: normalizeChunk(chunk) });
    });
    proc.stderr.on("data", (chunk) => {
      this.broadcast(session, { type: "output", data: normalizeChunk(chunk) });
    });
    proc.on("exit", (code, signal) => {
      this.broadcast(session, { type: "exit", code: code ?? null, signal: signal ?? null });
      this.sessions.delete(owner.token);
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
            try { process.kill(cpid, "SIGWINCH"); } catch { /* expected: child may exit before the delayed resize signal lands. */ }
          }
        }
      }, 300);
    }

    this.sessions.set(owner.token, session);
    return session;
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
    } catch {
      /* expected: browser websocket may close between broadcast iteration and send. */
    }
  }
}
