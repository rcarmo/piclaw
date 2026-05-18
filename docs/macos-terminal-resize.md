# macOS Terminal Resize — Known Limitation & Architecture Notes

> Reference for future PRs touching the web terminal on macOS.

## Summary

macOS `/usr/bin/top` (setuid root) does **not** resize when the PTY master fd
is held in a **child process** that communicates via pipes (the `pty_spawn`
architecture). All other terminal applications (nano, vim, htop, ncurses apps,
shell scripts) resize correctly.

## What works

| App | Resize | Notes |
|-----|--------|-------|
| Shell prompt (`stty size`) | ✅ | Correct after every resize |
| nano | ✅ | Full-screen ncurses redraw |
| vim | ✅ | Full-screen ncurses redraw |
| htop | ✅ | Not setuid |
| Custom ncurses / ANSI apps | ✅ | SIGWINCH delivered, ioctl returns new size |
| `/usr/bin/top` | ❌ | Setuid root — see below |

## Root cause

The issue is in **how** the PTY child process is created, not in the resize
ioctl itself.

### The fork-vs-posix_spawn gap

Terminal.app, iTerm2, and Go's `creack/pty` library all use this sequence:

```
fork()
  ├─ child (before exec):
  │    setsid()              ← new session, become session leader
  │    ioctl(slave, TIOCSCTTY) ← set controlling terminal
  │    dup2(slave, 0/1/2)
  │    close(extras)
  │    exec(shell)
  └─ parent:
       ioctl(master, TIOCSWINSZ)  ← kernel delivers SIGWINCH to fg group
```

The critical detail: `setsid()` + `TIOCSCTTY` happen **between fork and exec**,
in the raw child context before any new program image loads.

Bun's `Bun.spawn()` uses `posix_spawn()`, which does **not** support running
custom code between process creation and exec. We tried a C helper
(`pty_login`) that calls `setsid` + `TIOCSCTTY` after exec — the calls
succeed, but macOS does not treat the controlling terminal relationship the
same way for setuid binaries. The setuid `top` never responds to SIGWINCH.

### Evidence from automated testing

A Playwright + xterm.js test framework was built to verify resize by measuring
top's output volume before and after `ioctl(TIOCSWINSZ)`:

| Architecture | top resized? | Output ratio |
|---|---|---|
| Go webterm (`creack/pty`, direct fd in server, real `fork`) | ✅ | 0.070 |
| `pty_spawn` C binary (7 ioctl variants tested) | ❌ | 0.78–1.09 |
| `pty_spawn` rewritten in Go (pipe relay) | ❌ | 0.79 |
| FFI `openpty` + `pty_login` helper (Bun holds master fd) | ❌ | 1.09 |

A ratio near **0.16** indicates resize (area ratio of 60×15 / 140×40).
Values near **0.8–1.0** mean no resize occurred.

### Why only `top`?

`/usr/bin/top` is a **setuid root** binary with the entitlement
`com.apple.system-task-ports.read`. macOS applies stricter security checks
for SIGWINCH delivery to setuid processes. Non-setuid apps receive SIGWINCH
normally regardless of PTY architecture.

## Implementation

This PR uses a native C addon (`pty_native.c`, ~80 lines) compiled to a
`.dylib` on first use. It provides three functions:

- `pty_open(rows, cols)` — creates a PTY pair via `openpty()` with `O_CLOEXEC`
- `pty_fork_exec_simple(slaveFd, shell)` — `fork()` with `setsid()` + `TIOCSCTTY` in the fork-exec gap, then `exec(shell)`
- `pty_resize(masterFd, rows, cols)` — `ioctl(TIOCSWINSZ)`

The `fork()` happens directly in Bun's process. Only async-signal-safe
functions are called before `exec()` replaces the child process image.
PTY I/O uses Node's `fs.read`/`fs.write` on the master fd.

If `cc` is not available (no Xcode CLT), the compile fails gracefully and
piclaw falls back to the existing `expect`-based PTY.

### Files

| File | Lines | Purpose |
|------|-------|---------|
| `pty_native.c` | ~80 | Native PTY addon (C source, compiled on first use) |
| `terminal-session-service.ts` | +150 | macOS PTY integration: load dylib, spawn, I/O, resize |

### What changes for Linux

Nothing. All macOS code is gated by `IS_MACOS`. Zero code paths change on Linux.

## References

- `creack/pty` (Go): `go/pkg/mod/github.com/creack/pty@v1.1.18/start.go`
- iTerm2 PTY code: `github.com/gnachman/iTerm2/sources/Tasks/PTYTask.m`

### Troubleshooting

If terminal resize doesn't work for `top` on macOS, ensure Xcode Command
Line Tools are installed:

```bash
xcode-select --install
```

The native addon requires `cc` to compile on first use. Without it, piclaw
falls back to the `expect`-based PTY which works for all apps except
setuid `top`.
