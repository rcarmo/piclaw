# `piclaw` — your self-hosted AI workspace

![PiClaw](docs/icon-256.png)

PiClaw packages the [Pi Coding Agent](https://github.com/badlogic/pi-mono) into a self-hosted workspace with a streaming web UI, persistent state, multi-provider LLM support, and a practical built-in toolset.

It is for people who want one stateful agent workspace they can run locally or in a container without stitching together half a dozen separate services.

## Why PiClaw

![Demo Animation](docs/demo.gif)

- **One workspace, one app** — chat, editor, terminal, viewers, boards, uploads, and automation in the same web UI
- **Persistent state** — SQLite-backed messages, media, tasks, token usage, encrypted keychain, and session-scoped SSH / Proxmox / Portainer profiles
- **Practical built-ins** — code editing, Office/PDF/CSV/image/video viewing, draw.io, VNC, browser automation, image processing, MCP, infra tools, and optional cross-instance IPC for paired remote peers
- **Agent-first workflows** — steering, queued follow-ups, side prompts, autoresearch loops, scheduled tasks, and visual artifact generation
- **Context conservation** — small always-active tool baseline with staged discovery via `list_tools` / `list_scripts`
- **Optional auth/channels** — passkeys/TOTP for the web UI, plus optional WhatsApp integration

## Quick start

```bash
mkdir -p ./home ./workspace

docker run -d \
  --init \
  --name piclaw \
  --restart unless-stopped \
  -p 8080:8080 \
  -e PICLAW_WEB_PORT=8080 \
  -v "$(pwd)/home:/config" \
  -v "$(pwd)/workspace:/workspace" \
  ghcr.io/rcarmo/piclaw:latest
```

Open `http://localhost:8080` and type `/login` to configure your LLM provider, including custom OpenAI-compatible endpoints when you are not using one of the built-in hosted providers.

> [!TIP]
> Keep `--init` enabled for `docker run` / `podman run` so the runtime inserts a tiny init process for signal forwarding and zombie reaping. The bundled `docker-compose.yml` now sets the equivalent `init: true` flag.

| Mount | Container path | Contents |
|---|---|---|
| Home | `/config` | Agent home (`.pi/`, `.gitconfig`, `.bashrc`) |
| Workspace | `/workspace` | Projects, notes, and piclaw state |

> [!NOTE]
> In the container image, `/home/agent/.pi` is backed by `/config/.pi`. With the stock `docker run` / `docker-compose.yml` examples above, Pi home state therefore persists on the host under `./home/.pi/agent/`.
>
> That means provider login state and model metadata should survive rebuilds/recreates when stored under files such as:
>
> - `./home/.pi/agent/auth.json`
> - `./home/.pi/agent/models.json`
>
> Mounting directly to `/home/agent` or `/home/agent/.pi/agent` can also work, but `/config` is the canonical documented persistence path for the container image.

> [!WARNING]
> Never delete `/workspace/.piclaw/store/messages.db`. It contains chat history, media, and task state.

> [!IMPORTANT]
> You do **not** need to set provider API keys in piclaw environment variables. PiClaw reuses provider credentials configured in Pi Agent settings.

> [!NOTE]
> Power users can place workspace-scoped shell environment overrides in `/workspace/.env.sh`. PiClaw sources that file for the embedded terminal and on runtime startup, which is useful for things like `PATH` tweaks or persisting `gh auth login` with `GH_CONFIG_DIR=/workspace/.config/gh`. This hook is user-controlled: if its contents break PiClaw startup, shell behavior, or tool resolution, that breakage is the user's responsibility.

## Web UI at a glance

PiClaw is single-user, mobile-friendly, and streams updates over SSE.

| Area | Highlights |
|---|---|
| Chat | Thought/draft panels, steering, queued follow-ups, Adaptive Cards, `/btw`, link previews, threaded turns, recovery/timeout chips |
| Status UX | Tool/intended status stays visible during silence probing, recent activity restores useful context, and tool rows can show compact `x ago` hints in the meta row |
| Workspace | Sidebar browser, drag-and-drop uploads, file-reference pills, explorer search/reindex status |
| Editor | CodeMirror 6, search/replace, dirty-state tracking, syntax highlighting, lazy local bundle |
| Terminal | Ghostty-based web terminal as dock or tab; detachable popouts |
| Viewers | Draw.io, Office docs, CSV/TSV, PDF, images, video, code previews, kanban boards, mindmaps, VNC |
| Automation | `/image`, `/flux`, `image_process`, `cdp_browser`, `mcp`, experimental `m365`, Windows-only `win_*` tools |

For the full feature tour, see [docs/web-ui.md](docs/web-ui.md).

## Configuration

Most users only need a few environment variables:

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

For the full list, auth setup (TOTP/passkeys), session-scoped SSH-backed remote tools, reverse proxy configuration, SSHFS/FUSE support, and the workspace environment hook, see [docs/configuration.md](docs/configuration.md).

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

| Area | Docs |
|---|---|
| Getting started | [Configuration](docs/configuration.md), [Web UI](docs/web-ui.md), [Install from repo](docs/install-from-repo.md) |
| Operations | [Azure VM deployment](docs/azure/README.md), [Reverse proxy](docs/reverse-proxy.md), [Release process](docs/release.md) |
| Runtime internals | [Architecture](docs/architecture.md), [Runtime flows](docs/runtime-flows.md), [Storage model](docs/storage.md) |
| UI extension model | [Web pane extensions](docs/web-pane-extensions.md), [Extension UI contract](docs/extension-ui-contract.md), [Vendored widget libraries](docs/vendored-widget-libraries.md) |
| Agent capabilities | [Tools and skills](docs/tools-and-skills.md), [Visual artifact generator](docs/visual-artifact-generator.md), [MCP via pi-mcp-adapter](docs/mcp.md), [Keychain](docs/keychain.md) |
| Other references | [Dream memory system](docs/dream-memory.md), [Web notification delivery policy](docs/web-notification-delivery-policy.md), [iOS PWA reference](docs/PWA.md), [WhatsApp](docs/whatsapp.md), [Cross-instance interop](docs/cross-instance-ipc.md), [Experimental M365 extension](docs/m365-experimental-extension.md), [Development](docs/development.md) |
| Platform study | [Azure Functions feasibility study](docs/azure/azure-functions-feasibility-study-2026-04-17.md) |

## Contributing

Work items and bug reports are tracked in **[GitHub Issues](https://github.com/rcarmo/piclaw/issues)**.

- [Open a work item or bug report](https://github.com/rcarmo/piclaw/issues/new?template=workitem.md)
- [Ask a question](https://github.com/rcarmo/piclaw/issues/new?template=question.md)
- [View the project board](https://github.com/users/rcarmo/projects/13)

See [WORKITEMS.md](WORKITEMS.md) for board lane definitions and label taxonomy.

## Credits

- [rcarmo/agentbox](https://github.com/rcarmo/agentbox)
- [qwibitai/nanoclaw](https://github.com/qwibitai/nanoclaw)
- [badlogic/pi-mono](https://github.com/badlogic/pi-mono)
- [davebcn87/pi-autoresearch](https://github.com/davebcn87/pi-autoresearch) — autonomous experiment loop by Tobi Lutke and David Cortés (vendored under `runtime/vendor/autoresearch/`)
- [nicobailon/visual-explainer](https://github.com/nicobailon/visual-explainer) — visual artifact generation skill philosophy, prompt workflow, and template patterns by Nico Bailon (adapted, not vendored)

## Licence

MIT
