# PiClaw — self-hosted AI workspace

![PiClaw](docs/icon-256.png)

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/-Gp9JJ?referralCode=tyJIJY&utm_medium=integration&utm_source=template&utm_campaign=generic)

Languages: **English** · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

PiClaw is a self-hosted AI workspace, single-user by default, built on the [Pi Coding Agent](https://github.com/earendil-works/pi). Work with an agent, edit files, run commands and inspect the results in the same browser window. Conversations, files and scheduled tasks persist between visits; model requests go to the provider you configure, including local OpenAI-compatible servers.

The web UI supports English, Simplified Chinese and Japanese, with desktop and mobile layouts. Use a container, VM or dedicated machine to limit the files and services available to the agent.

![Demo Animation](docs/demo.gif)

## Install

| Method | Use it for |
|---|---|
| [Docker](#quick-start-with-docker) | Recommended deployment; includes Bun, PiClaw and bundled command-line tools |
| [Portable release](docs/getting-started.md#portable-releases) | Docker-free Linux, Apple Silicon macOS or experimental Windows use; bundles Bun and runtime dependencies |
| [Bun repository install](docs/install-from-repo.md) | Experimental tagged install using an existing Bun installation |
| [Source build](docs/development.md) | Development and local testing |

Published downloads are on [GitHub Releases](https://github.com/rcarmo/piclaw/releases); container images are on [GHCR](https://github.com/rcarmo/piclaw/pkgs/container/piclaw). Pin a release tag for repeatable deployments.

### Quick start with Docker

You need Docker and credentials for a model provider, or a reachable local model server. Provider setup happens after startup.

> [!WARNING]
> A fresh instance has no web login gate. The command below publishes the port on **localhost only**. Keep it private while you configure authentication. Anyone with access to an unprotected instance can use the agent's files and tools.

```bash
mkdir -p ./home ./workspace

docker run -d \
  --init \
  --name piclaw \
  --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -e PICLAW_WEB_PORT=8080 \
  -v "$(pwd)/home:/config" \
  -v "$(pwd)/workspace:/workspace" \
  ghcr.io/rcarmo/piclaw:latest
```

1. Open [http://localhost:8080](http://localhost:8080) on the Docker host.
2. Send `/login` in chat to configure a **model provider**. This is separate from browser sign-in. PiClaw reuses Pi's provider credentials; you do not need to put API keys in the Docker command.
3. Select a model with `/model`, then try: “Create a Markdown checklist in the workspace and show me the file.”
4. Before allowing access from other machines, [set up browser authentication](docs/getting-started.md#secure-browser-access) and HTTPS.

Both `./home` and `./workspace` are persistent data. Keep them when replacing the container; **never delete `workspace/.piclaw/store/messages.db`** to reset or upgrade PiClaw. See [first-run checks, backups and upgrades](docs/getting-started.md).

## What you can do

| Task | Included in core |
|---|---|
| Work with an agent | Streaming chat, model selection, live steering, queued follow-ups, separate conversations and `/btw` side questions |
| Work on files | Workspace browser, uploads, CodeMirror editor, shell tools and a detachable xterm.js terminal |
| Inspect results | CSV/TSV tables, PDF, image, video and code viewers; VNC remote-display panes |
| Continue work between visits | Scheduled tasks, searchable chat history and file-based [Dream memory](docs/dream-memory.md) |
| Extend workflows | Skills, [MCP servers](docs/mcp.md), browser automation, image processing, Adaptive Cards and interactive visual artefacts |

The [web UI guide](docs/web-ui.md#chat-and-status-surfaces) and [tools and skills reference](docs/tools-and-skills.md) cover the controls and commands. Local model setup is documented in [llama.cpp](docs/llama-cpp.md); Azure image generation requires [Azure OpenAI/Foundry configuration](docs/azure/azure-openai-extension.md).

[Optional add-ons](https://rcarmo.github.io/piclaw-addons/) supply Draw.io, Office document rendering and tools, kanban boards, alternative terminal renderers, Windows desktop automation, Proxmox, Portainer, Microsoft 365 and paired-instance messaging. Install them separately through [Settings and add-ons](docs/settings-and-addons.md).

## Security and limits

- **Single-user is the default.** [Experimental family mode](docs/multi-user/README.md) is a trusted multi-user mode for small groups. Promoted `family-shared` deployments provide owned conversations while sharing one workspace and process; they do not provide filesystem isolation. Isolated-container mode is unavailable. See the [family user guide](docs/multi-user/user-guide.md).
- The agent runs with its process user's permissions. Native installs can access that user's files and commands; containers expose their mounted files and configured network access. Use a dedicated environment and mount only what you intend to share.
- Browser authentication supports authenticator codes (TOTP) and passkeys. Keep the backend private, use HTTPS for remote access, and trust forwarded headers only from your configured [reverse proxy](docs/reverse-proxy.md).
- Self-hosting keeps application state on your machine. Cloud models and external tools still receive the data you send to them. The optional [keychain](docs/keychain.md) needs a master key and does not encrypt the whole workspace or chat history.

## Documentation

- [Getting started](docs/getting-started.md) — installation, first chat, authentication, persistence and upgrades
- [Configuration](docs/configuration.md) — settings, paths, providers, SSH tools and environment overrides
- [Web UI](docs/web-ui.md#chat-and-status-surfaces) — chat, workspace, editor, terminal and viewers
- [Documentation index](docs/README.md) — operations, integrations, development and architecture

## Contributing

Work items and bug reports are tracked in **[GitHub Issues](https://github.com/rcarmo/piclaw/issues)**.

- [Open a work item or bug report](https://github.com/rcarmo/piclaw/issues/new?template=workitem.md)
- [Ask a question](https://github.com/rcarmo/piclaw/issues/new?template=question.md)
- [View the project board](https://github.com/users/rcarmo/projects/13)

Use the issue templates when reporting a problem. For code changes, read [development](docs/development.md) and the [repository workflow](AGENTS.md); submit changes through a pull request.

## Credits

- [pi.dev](http://pi.dev) for the Pi core used by piclaw
- [rcarmo/vibes](https://github.com/rcarmo/vibes) — the original PiClaw UX design
- [qwibitai/nanoclaw](https://github.com/qwibitai/nanoclaw)
- [earendil-works/pi](https://github.com/earendil-works/pi)
- [davebcn87/pi-autoresearch](https://github.com/davebcn87/pi-autoresearch) — autonomous experiment loop by Tobi Lutke and David Cortés (now carried by the autoresearch add-on in `rcarmo/piclaw-addons`)
- [nicobailon/visual-explainer](https://github.com/nicobailon/visual-explainer) — visual artifact generation skill philosophy, prompt workflow, and template patterns by Nico Bailon (adapted, not vendored)

> [!NOTE]
> piclaw is **not directly affiliated** with [pi.dev](https://pi.dev). It is a derivative work built on the Pi core and adds its own runtime, tooling, and UI layers.

## Licence

[MIT](LICENSE)
