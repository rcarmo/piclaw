# `piclaw` — your self-hosted AI workspace

![PiClaw](docs/icon-256.png)

PiClaw packages the [Pi Coding Agent](https://github.com/badlogic/pi-mono) into a self-hosted workspace with a streaming web UI, multi-provider LLM support, persistent state, and a growing collection of built-in tools — code editor, terminal, VNC client, document viewers, kanban boards, and autonomous experiment loops.

It is built for people who want a practical, stateful agent they can run locally or in a container without stitching together half a dozen separate services.

## Why PiClaw

![Demo Animation](docs/demo.gif)

- **Streaming web UI** — real-time chat with Markdown, KaTeX, Mermaid, and Adaptive Cards
- **Persistent agent state** — SQLite-backed messages, media, tasks, token usage, encrypted keychain, and session-scoped SSH / Proxmox / Portainer profiles
- **Workspace-native workflow** — browse files, preview documents, upload attachments, drag files into the workspace explorer with progress feedback and a client-side size guard, edit code, reference files in prompts, and optionally flip core tools to a remote SSH host for the current session
- **Built-in tools** — Ghostty-based terminal, code editor, Office/PDF/CSV/image/video viewers, draw.io, kanban board and mindmap editors, VNC client, browser automation, bundled MCP access via `pi-mcp-adapter`, and agent-only infrastructure tools for SSH, Proxmox, and Portainer
- **Agent control features** — steering, queued follow-ups, threading, side prompts, autoresearch experiment loops, and scheduled tasks
- **Context conservation by default** — small always-active tool baseline, lazy tool activation, compact capability introspection, and opt-in examples for higher-detail workflow help
- **Optional auth and channels** — passkeys/TOTP for the web UI, plus optional WhatsApp integration

## Quick start

```bash
mkdir -p ./home ./workspace

docker run -d \
  --name piclaw \
  --restart unless-stopped \
  -p 8080:8080 \
  -e PICLAW_WEB_PORT=8080 \
  -v "$(pwd)/home:/config" \
  -v "$(pwd)/workspace:/workspace" \
  ghcr.io/rcarmo/piclaw:latest
```

Open `http://localhost:8080` and type `/login` to configure your LLM provider.

| Mount | Container path | Contents |
|---|---|---|
| Home | `/config` | Agent home (`.pi/`, `.gitconfig`, `.bashrc`) |
| Workspace | `/workspace` | Projects, notes, and piclaw state |

> [!WARNING]
> Never delete `/workspace/.piclaw/store/messages.db`. It contains chat history, media, and task state.

> [!IMPORTANT]
> You do **not** need to set provider API keys in piclaw environment variables. PiClaw reuses provider credentials configured in Pi Agent settings.

> [!NOTE]
> Power users can place workspace-scoped shell environment overrides in `/workspace/.env.sh`. PiClaw sources that file for the embedded terminal and on runtime startup, which is useful for things like `PATH` tweaks or persisting `gh auth login` with `GH_CONFIG_DIR=/workspace/.config/gh`. This hook is user-controlled: if its contents break PiClaw startup, shell behavior, or tool resolution, that breakage is the user's responsibility.

## Web UI

PiClaw is single-user, mobile-friendly, and streams updates over SSE.

### Chat

- Thought and draft panels during streaming
- Live steering and queued follow-ups
- Adaptive Cards with persisted submissions
- `/btw` side conversations
- File attachments, link previews, threaded turns, and syntax-highlighted previews for common text/code attachments
- Themes and tinting via `/theme` and `/tint`
- Mobile-friendly layout with webapp manifest

### Workspace

- Sidebar file browser with auto-refresh, drag-and-drop upload progress, and a client-side 256 MB upload guard before the request even starts
- File-reference pills in prompts
- Folder sizes in the starburst explorer
- Workspace search index status with one-click reindex from the explorer header

### Editor

- CodeMirror 6 with syntax highlighting for JS/TS, Python, Go, JSON, CSS, HTML, YAML, SQL, XML/SVG, Markdown, and Shell
- Search and replace, dirty-state tracking, line wrapping
- Lazy-loaded local bundle — no CDN dependency

### Terminal

- Ghostty-based web terminal — a real shell in the browser, not a simulation
- Runs as a dock panel or a standalone tab
- Detachable into popout windows with live session transfer
- Enabled by default on Linux and macOS; disable with `PICLAW_WEB_TERMINAL_ENABLED=0`
- Still disabled by default on Windows

### Viewers

- **Draw.io** — self-hosted editor with SVG/PNG/XML export back to workspace
- **Office documents** — `.docx`, `.xlsx`, `.pptx`, `.odt`, `.ods`, `.odp`
- **CSV/TSV** — dedicated table viewer
- **PDF, images, video** — inline viewers
- **Text/code attachments** — syntax-highlighted timeline preview modal for common code/config formats
- **Kanban boards** — `*.kanban.md` in a drag-and-drop board editor (Obsidian Kanban compatible)
- **Mindmaps** — `*.mindmap.yaml` in a D3/SVG visual editor
- **VNC remote display** — connect to allowlisted targets from a tab, with direct-connect enabled by default on Linux, macOS, and Windows (experimental); disable with `PICLAW_WEB_VNC_ALLOW_DIRECT=0`

### Automation

- **`/image` and `/flux`** — workspace-backed image generation commands for Azure OpenAI / Foundry; `/image` now supports `--transparent` for transparent PNG output when the Azure OpenAI model supports it
- **`cdp_browser`** — Chromium/Edge/Chrome automation via CDP for navigation, JS evaluation, DOM clicking, and screenshots
- **`mcp` via `pi-mcp-adapter`** — token-efficient access to external MCP servers configured through `.pi/mcp.json`
- **Experimental `m365` extension** — opt-in Microsoft 365 automation bundle for Teams, Graph, OneDrive, SharePoint, and calendar flows; enable with `PICLAW_ENABLE_M365_EXPERIMENTAL=1` (primarily validated on Windows with YOLO mode, with Edge → Chrome → Chromium browser lookup across Windows/macOS/Linux). Graph-backed consumer-account support now exists; Teams chat flows still require a work/school tenant.
- **`win_*` tools** — Windows-only desktop automation via Win32 FFI for window enumeration, screenshots, element inspection, clicking, typing, and process management. No-ops on non-Windows platforms.

## Configuration

Key environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `PICLAW_WEB_PORT` | `8080` | Web UI port |
| `PICLAW_WEB_TERMINAL_ENABLED` | `1` on Linux/macOS, `0` on Windows | Enable or disable the authenticated Ghostty-based web terminal |
| `PICLAW_WEB_VNC_ALLOW_DIRECT` | `1` on Linux/macOS/Windows | Allow or disable direct VNC targets supplied at runtime |
| `PICLAW_WEB_TOTP_SECRET` | _(empty)_ | Base32 TOTP secret; enables login gate (or initialize with `/totp`) |
| `PICLAW_WEB_PASSKEY_MODE` | `totp-fallback` | `totp-fallback`, `passkey-only`, or `totp-only` |
| `PICLAW_ASSISTANT_NAME` | `PiClaw` | Display name in the UI |
| `PICLAW_ENABLE_M365_EXPERIMENTAL` | `0` | Enable the experimental Microsoft 365 extension bundle |
| `PICLAW_KEYCHAIN_KEY` | _(empty)_ | Master key for encrypted secret storage |
| `PICLAW_TRUST_PROXY` | `0` | Enable when behind a reverse proxy or tunnel |

For the full list, auth setup (TOTP/passkeys), session-scoped SSH-backed remote tools, reverse proxy configuration, and SSHFS/FUSE support, see [docs/configuration.md](docs/configuration.md).

## Other install methods

### Install without Docker

```bash
bun add -g github:rcarmo/piclaw
```

Experimental. Linux/macOS/Windows. See [docs/install-from-repo.md](docs/install-from-repo.md).

On Windows, PiClaw remains a secondary / not-officially-supported target. Shell-like child processes now run attached there (`detached=false`) so stdout/stderr remain capturable; Unix-like hosts still use detached process groups for cleaner tree termination on abort/shutdown.

### Build from source

See [docs/development.md](docs/development.md).

## Documentation

**Setup & operations**

- [Configuration](docs/configuration.md) — environment variables, auth, reverse proxy, SSHFS
- [Install from repo](docs/install-from-repo.md) — Bun-based Docker-free install
- [Release process](docs/release.md) — versioning, tagging, publishing

**Architecture & internals**

- [Architecture](docs/architecture.md)
- [Runtime flows](docs/runtime-flows.md)
- [Storage model](docs/storage.md)
- [Web pane extensions](docs/web-pane-extensions.md)
- [Extension UI contract](docs/extension-ui-contract.md)

**Reference**

- [Tools and skills](docs/tools-and-skills.md) — includes the uniform `ssh` / `proxmox` / `portainer` control surface (`discover`, `capabilities`, `recommend`, `request`, `workflow`) and the context-conserving discovery flow
- [Keychain](docs/keychain.md)
- [WhatsApp](docs/whatsapp.md)
- [Cross-instance interop](docs/cross-instance-ipc.md)
- [MCP via pi-mcp-adapter](docs/mcp.md)
- [Azure OpenAI extension](docs/azure/azure-openai-extension.md) — managed-identity provider notes plus `/image` and `/flux` behaviour
- [Experimental M365 extension](docs/m365-experimental-extension.md) — Microsoft 365 browser-auth automation, including current consumer-account support boundaries
- [Development](docs/development.md)

## Credits

- [rcarmo/agentbox](https://github.com/rcarmo/agentbox)
- [qwibitai/nanoclaw](https://github.com/qwibitai/nanoclaw)
- [badlogic/pi-mono](https://github.com/badlogic/pi-mono)
- [davebcn87/pi-autoresearch](https://github.com/davebcn87/pi-autoresearch) — autonomous experiment loop by Tobi Lutke and David Cortés (vendored under `runtime/vendor/autoresearch/`)

## Licence

MIT
