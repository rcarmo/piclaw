# PiClaw documentation

Start with [getting started](getting-started.md) for installation, first chat, authentication and backups. PiClaw supports single-user deployments only.

## Use PiClaw

- [Web UI](web-ui.md#chat-and-status-surfaces) — chat, workspace, editor, terminal and viewers
- [Configuration](configuration.md) — settings, paths, providers, remote SSH tools and environment overrides
- [Tools and skills](tools-and-skills.md) — tool discovery, skills and slash commands
- [Budget limits](budget-limits.md) — opt-in spend/quota caps, status, approvals and enforcement limits
- [Settings and add-ons](settings-and-addons.md) — installation and configuration; [add-on catalogue](https://rcarmo.github.io/piclaw-addons/)
- [Visual artefact generation](visual-artifact-generator.md) — diagrams, charts and interactive output
- [Dream memory](dream-memory.md) — file-based memory maintenance
- [Thinking persistence](thinking-persistence.md) — opt-in reasoning storage and privacy
- [Notifications](web-notification-delivery-policy.md) and [iOS PWA](PWA.md)

## Install and operate

- [Getting started](getting-started.md) — Docker, portable bundles, persistence, upgrades and troubleshooting
- [Bun repository install](install-from-repo.md) — experimental Docker-free package installation
- [Desktop shell](desktop.md) — experimental native wrapper
- [Reverse proxy](reverse-proxy.md) — HTTPS, tunnels, forwarded headers and passkeys
- [Keychain](keychain.md) — encrypted secrets and bootstrap keys
- [Storage model](storage.md) — database and file inventory
- [Observability](observability.md) and [session recordings](session-recordings.md)
- [Azure VM deployment](azure/README.md)

## Connect providers and services

- [MCP](mcp.md) — Model Context Protocol servers through `pi-mcp-adapter`
- [llama.cpp](llama-cpp.md) — local model servers and router presets
- [Azure OpenAI / Foundry](azure/azure-openai-extension.md)
- [WhatsApp](whatsapp.md) — optional channel setup
- [Remote Peer add-on](https://rcarmo.github.io/piclaw-addons/addons/remote-peer/) — paired-instance messaging
- [Microsoft 365 add-on](https://rcarmo.github.io/piclaw-addons/addons/m365/) — Teams, Graph, files and calendar

## Develop and extend

- [Development](development.md), [repository workflow](../AGENTS.md), [CI flows](ci-flows.md) and [release process](release.md)
- [Architecture](architecture.md), [runtime flows](runtime-flows.md) and [runtime stream sessions](runtime-stream-sessions.md)
- [Pipelined compaction](pipelined-compaction.md)
- [Local note retrieval contract](design/local-note-retrieval-contract.md) — proposed access, freshness and citation rules; [lifecycle and implementation test map](design/local-note-retrieval-lifecycle-tests.md); no new tools enabled
- [Add-on runtime API](addon-runtime-api.md)
- [Web pane extensions](web-pane-extensions.md) and [extension UI contract](extension-ui-contract.md)
- [Vendored widget libraries](vendored-widget-libraries.md)
- [Azure Functions feasibility study](azure/azure-functions-feasibility-study-2026-04-17.md)

## Gated multi-user development

Family and isolated-container modes cannot start. These guides support implementation review and controlled testing, not deployment:

- [Access modes and implementation status](multi-user/README.md)
- [Family preview user guide](multi-user/user-guide.md)
- [Administrator guide](multi-user/administrator-guide.md) and [troubleshooting](multi-user/troubleshooting.md)
- [Copy-only migration](multi-user/migration-copy.md) and [offline recovery](multi-user/operator-recovery.md)
