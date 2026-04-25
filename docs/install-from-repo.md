# Install from the GitHub repository

> Experimental: this Bun repo-install path works, but it is not yet the main recommended production install route.

PiClaw can be installed directly from the repository with Bun:

```bash
bun add -g github:rcarmo/piclaw
```

This is the intended **Docker-free** install path for people who want the
packaged PiClaw CLI and web assets without building from source manually.

One reason this path exists is to support people who want to run PiClaw on
low-end ARM SBCs, lightweight VMs, or other sandboxed environments where
Docker is not the best fit or is not available. That said, this is still an
experimental path and not a generally supported deployment target.

The repository root is the package/install boundary for this flow. The nested
`runtime/` directory is the packaged implementation subtree that contains the
runtime sources, web app, extensions, vendored assets, skills, packaged runtime
scripts, and packaged runtime docs.

For maintainer-facing placement rules inside the repo, see
`docs/repo-runtime-boundaries-2026-03-28.md`.

## What happens at install time

Repo installs are expected to include the vendored Draw.io editor and the other
bundled runtime assets directly in the package tree, so a normal
`bun add -g github:rcarmo/piclaw` install should not need a Draw.io download at
install time — including on Windows.

A small `postinstall` repair step still runs automatically after `bun add`, but
it is only a fallback for incomplete source checkouts or damaged package trees.
No devDependencies or full source rebuild are required for a working runtime.

Draw.io now lives in the `piclaw-addons` repository and is no longer repaired by
piclaw's core postinstall step.

### Full development rebuild

If you want to rebuild everything from source (requires devDependencies):

```bash
bun install               # includes devDependencies
bun run build:web         # rebuild vendor bundles + web app from source
bun run build             # recompile TypeScript via tsc (optional — Bun runs .ts directly)
```

## Current scope

This path is intended for:

- Bun users
- direct GitHub-repository installs
- Linux and macOS as the primary supported targets

Windows also works in practice, but remains a secondary / not-officially-supported target for now.

For shell execution specifically, PiClaw now uses a platform split:

- Unix-like hosts: detached child process groups for cleaner process-tree termination on abort/shutdown
- Windows: attached child processes (`detached=false`) so stdout/stderr remain capturable

That tradeoff favors reliable shell output on Windows over strict parity with Unix process-group behavior.

It is **not** the same as a development/source install flow.

## What you should get

After install, the goal is that:

- `piclaw` is available in PATH
- the CLI runs without a manual build
- bundled web assets are already present
- bundled extensions/viewers required by normal runtime behavior are included
- bundled Pi extensions such as `pi-mcp-adapter` are installed with the package and available to session startup wiring
- the vendored Draw.io editor ships in the repo/package and does not rely on a Windows-time download
- bundled automation extensions such as `cdp_browser` are available after install
- Windows-only `win_*` desktop automation extensions are included but remain inert on non-Windows hosts
- first runtime startup seeds missing workspace skeleton files from the packaged `skel/` tree (for example `AGENTS.md`, `.pi/skills/`, `notes/`, `.piclaw/config.json.example`, `.piclaw/README.md`, and the Dream/notes bootstrap files)
- if the core Dream memory files are missing, first startup also queues a silent Dream bootstrap so `notes/memory/` and daily summaries are populated instead of staying at placeholder state
- Dream/AutoDream workspace bootstrap files are present for direct Bun installs as well as container installs
- out-of-band Dream runs use a temporary `dream:` channel/session and clean it up after the cycle, so direct installs do not accumulate visible Dream chats

## Notes

- PiClaw now ships `pi-mcp-adapter` as a bundled dependency. Prefer shared MCP config in `.mcp.json` (project-local) or `~/.config/mcp/mcp.json` (shared global MCP config), and use `.pi/mcp.json` / `~/.pi/agent/mcp.json` for Pi-specific overrides. Starter examples are seeded at `.mcp.json.example` and `.pi/mcp.json.example`.
- `pi-mcp-adapter` does not require `mcp-cli`, and it brings its own `mcp` / `/mcp` / `/mcp-auth` surfaces once loaded.
- This path is Bun-first. npm parity is not part of the initial scope.
- The published GHCR image remains the main documented production runtime.
- The Bun repo-install path now ships the bundled `cdp-browser` and `win-ui` extensions in the package tree alongside the existing optional extensions.
- Build, pack, and install commands should be run from the repo root; `runtime/` is not a separate package.
- If repo-install behavior differs slightly from the published package layout, those differences should stay small and documented.
- Dream/AutoDream details, file sequence, and outputs are documented in [`runtime/docs/dream-memory.md`](../runtime/docs/dream-memory.md).
