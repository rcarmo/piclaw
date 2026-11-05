# Configuration

This page lists Piclaw's environment variables, config files, secrets, authentication settings, and notification settings.

**Jump to:**
[Paths](#path-overrides) ·
[Web server & networking](#web-server) ·
[Terminal](#web-terminal) ·
[Workspace env hook](#workspace-environment-hook-workspaceenvsh) ·
[Provider setup](#provider-setup-via-login) ·
[Runtime & agent](#runtime-and-agent) ·
[MCP](#mcp-server-config-pi-mcp-adapter) ·
[SSH remote tools](#ssh-backed-remote-core-tools) ·
[Authentication](#authentication-totp--passkeys) ·
[Keychain](#keychain-secrets) ·
[WhatsApp](#whatsapp-pairing) ·
[Pushover](#pushover-notifications) ·
[Dream](#dream-and-autodream) ·
[External workspace](#using-an-external-workspace) ·
[Cross-instance interop](#remote-peer-add-on)

## Configuration surface policy

Piclaw keeps `PICLAW_*` environment variables for immutable deployment bootstrap, secrets, and compatibility aliases. Runtime code should read ordinary settings through typed config helpers instead of open-coded `process.env.PICLAW_*` expressions.

The machine-readable generated observations are `docs/config/piclaw-env-observations.json`; the reviewed support catalog is `docs/config/piclaw-env-support-catalog.json`. Regenerate or check both with:

```bash
bun run scripts/audit-piclaw-env-surface.ts --write
bun run check:env-surface
```

The observations record where each `PICLAW_*` name appears and count both direct `process.env.PICLAW_*` reads and semantic helper reads such as `readEnvValue("PICLAW_...")`. The support catalog records reviewed metadata for production names. Tranche 1 uses these files as drift guards; it does not claim that supported environment variables have been removed. The catalog also stores the config-source precedence chain:

1. CLI flags where a setting supports them
2. `process.env`
3. workspace `.env`
4. `.piclaw/config.json`
5. built-in defaults

New settings should prefer `.piclaw/config.json` plus typed config access unless they are bootstrap paths, secrets, process-manager toggles, or deliberate compatibility aliases.

### Internal module layout

`runtime/src/core/config.ts` is the stable public façade. Existing runtime code should continue importing from it unless it is implementing another config module. The façade re-exports these ownership modules:

| Module | Ownership |
|--------|-----------|
| `config-context.ts` | One startup snapshot of CLI flags, `.env`, paths, JSON config and domain runtime options |
| `config-web.ts` | Web server, TLS, auth/session, terminal, VNC, upload limits, widget token and TOTP settings |
| `config-tools.ts` | Provider/tool integration, tool-output policy, workspace search, model scoping and tool activation |
| `config-runtime.ts` | Agent timeouts/budgets, Dream, session lifecycle/storage, remote interop, compaction, recovery and watchdog settings |
| `config-identity.ts` | Mutable assistant/user identity, trigger routing and UI theme |
| `config-integrations.ts` | Logging, agent-log retention and Pushover |
| `config-cli.ts`, `config-paths.ts`, `config-sources.ts` | Stateless bootstrap parsing and source helpers |
| `domain-config.ts` | Typed schemas, compatibility precedence, validation and persistence |

The modules share `config-context.ts` rather than re-reading dotenv or JSON state. Domain modules do not import the public façade; this keeps module initialisation acyclic. Mutable setters update their typed domain state and legacy live exports together.

Bootstrap environment variables are reviewed as an allowlist in the inventory. The current allowlist is:

- `PICLAW_WORKSPACE`, `PICLAW_STORE`, `PICLAW_DATA`, `PICLAW_RUNTIME_ROOT`, `PICLAW_PI_AGENT_DIR`
- `PICLAW_KEYCHAIN_KEY`, `PICLAW_KEYCHAIN_KEY_FILE`
- `PICLAW_WEB_TLS_CERT`, `PICLAW_WEB_TLS_KEY`
- `PICLAW_INTERNAL_SECRET`, `PICLAW_WEB_INTERNAL_SECRET`, `PICLAW_WEB_EXTERNAL_URL`

## Upload limits and storage

**Settings → General → Upload limit (MB)** is the per-file limit for both chat and workspace uploads (1–1024 MiB). The canonical field is `domains.web.workspaceUploadLimitMb`; its default remains 256. Existing explicit workspace values take precedence when upgrading instances that configured different compose/workspace limits. A compose-only legacy value is used as a fallback. The older `composeUploadLimitMb` settings API is an alias of the shared limit; returned compose/workspace values agree.

On single-user instances, chat attachments up to **32 MiB** remain database-backed media. Larger attachments use **8 MiB requests**, are saved under `uploads/upload-<id>/<filename>` inside the workspace, and appear in chat as downloadable `Files:` references. The file contents are not inserted into the media database. A 512 MiB file therefore does not exceed the HTTP server's per-request body cap.

Uploads never overwrite an existing attachment. Filenames must be portable leaf names without path separators, control characters or reserved device names. The completed file appears only after all declared bytes arrive. Failed uploads do not submit a chat message. Retry starts a new upload; automatic resume/deduplication after a lost acknowledgement is not provided. Abandoned staging state expires through the existing 24-hour chunk cleanup. Completed workspace files remain ordinary user files and are not deleted when a chat message is deleted.

The shared workspace fallback is unavailable in family mode; its existing owner-scoped media endpoint remains database-backed and capped at 32 MiB. This change does not expose shared workspace files to family accounts. Custom clients can continue using `/media/upload` for small media, and use `/media/upload-chunk` for large single-user chat attachments.

## Path overrides

| Variable | Default | Purpose |
|----------|---------|---------|
| `PICLAW_WORKSPACE` | `/workspace` | Working directory for `pi` + `piclaw` |
| `PICLAW_STORE` | `/workspace/.piclaw/store` | SQLite database location |
| `PICLAW_DATA` | `/workspace/.piclaw/data` | Sessions, IPC, chats.json |
| `SUPERVISOR_CONF` | `/workspace/.piclaw/supervisor/supervisord.conf` | Supervisor config path (falls back to `/etc/supervisor/supervisord.conf`) |
| `PICLAW_SKEL_DIR` | packaged `skel/` directory | Deployment/package bootstrap override for the workspace skeleton source. Retained env-only because it is needed before ordinary domain config is available. |
| `PICLAW_DB_IN_MEMORY` | `0` | Test/database bootstrap switch (`1` or `true`). Retained env-only because it selects the database before persisted config can safely be read. |
| `PICLAW_CHAT_JID` | `web:default` | Per-invocation IPC target fallback. Request payload fields take precedence; this value is intentionally not persisted. |

## Logging

`domains.logging.level` persists the runtime logging threshold in `.piclaw/config.json`. `PICLAW_LOG_LEVEL` and the older `LOG_LEVEL` name remain compatibility aliases until 3.0.0 and override the persisted value for startup and live logger checks. Allowed values are `debug`, `info`, `warn`, and `error`; the default is `info`.

## Web server

| Variable | Default | Purpose |
|----------|---------|---------|
| `PICLAW_WEB_PORT` | `8080` | Web UI port |
| `PICLAW_WEB_HOST` | `0.0.0.0` | Bind address |
| `PICLAW_WEB_IDLE_TIMEOUT` | `0` (disabled) | Drop idle clients after this many seconds |
| `PICLAW_WEB_TERMINAL_ENABLED` | `1` on Linux/macOS, `0` on Windows | Enable or disable the authenticated web terminal backend/pane |
| `PICLAW_WEB_VNC_TARGETS` | _(empty)_ | JSON allowlist for VNC targets (or use `PICLAW_VNC_TARGETS`). Supports array or object form. |
| `PICLAW_WEB_VNC_ALLOW_DIRECT` | `1` on Linux/macOS/Windows | Allow or disable direct VNC targets supplied at runtime (`PICLAW_VNC_ALLOW_DIRECT` alias) |
| `PICLAW_WEB_NOTIFICATION_DEBUG_LABELS` | `0` | Append `[Local]` / `[Web Push]` markers to notification titles for delivery debugging |
| `PICLAW_WEB_PERSIST_THINKING` | `0` | Persist agent reasoning traces into the database so they survive page reloads. See [thinking-persistence.md](thinking-persistence.md) for privacy implications. |
| `PICLAW_WEB_PERSIST_THINKING_MAX_CHARS` | `100000` | Per-turn cap on persisted thinking text (UTF-16 surrogate-safe). |
| `PICLAW_WEB_TLS_CERT` | _(empty)_ | Path to TLS certificate; enables HTTPS |
| `PICLAW_WEB_TLS_KEY` | _(empty)_ | Path to TLS private key; enables HTTPS |
| `PICLAW_WEB_MAX_CONTENT_CHARS` | `262144` | Compatibility alias for `domains.web.contentMaxChars`; max message size in characters, with oversized messages truncated with metadata. |
| `PICLAW_SEARCH_MATCH_MODE` | `or` | Compatibility alias for `domains.tools.searchMatchMode`; choose `or` (any keyword) or `and` (all keywords) for multi-word FTS queries. |
| `PICLAW_WEB_PREVIEW_CHARS` | `16000` | Compatibility alias for `domains.web.contentPreviewChars`; preview threshold, capped at the hard content limit. |
| `PICLAW_TRUST_PROXY` | `0` | Trust `Forwarded` / `X-Forwarded-*` headers from a reverse proxy for origin, host, proto, and client IP handling |

### Timeline SVG sanitization

`domains.web.sanitizeSvgFences` controls rendering of fenced `svg` blocks in timeline Markdown for the whole instance. It defaults to `true`: Piclaw accepts a bounded, conservative SVG subset and renders it as a static image, preserving the original source in a disclosure. This prevents model-provided SVG from executing or interacting with the host page. Unstyled fills and `currentColor` use the selected palette; Theme/Light/Dark preview surfaces preserve explicit source paints. See [SVG theme alignment](svg-theme-alignment.md) for supported paint tokens and viewer limits.

Set it to `false` only when you trust the authors of timeline SVG and require interactive SVG content such as tooltips, click handlers, links, or authored CSS. In that mode, complete fenced SVG source is inserted inline after Markdown rendering, so its interactive markup runs with the authority available to the PiClaw page. Reload open browser tabs after changing this setting; messages then render consistently under the new instance policy.

```json
{
  "domains": {
    "web": {
      "sanitizeSvgFences": false
    }
  }
}
```

The same setting is available in **Settings → Workspace → Timeline SVG**. It applies only to fenced `svg` Markdown blocks, not application-owned icons, SVG attachments, or workspace image previews.

If `PICLAW_WEB_TLS_CERT` and `PICLAW_WEB_TLS_KEY` are both omitted, piclaw checks for `.piclaw/certs/sandbox.local.crt` and `.piclaw/certs/sandbox.local.key` and enables HTTPS automatically if both exist.

The following operational settings are persisted under typed domains in `.piclaw/config.json`; their legacy variables remain compatibility aliases until 3.0.0:

| Typed setting | Compatibility variable | Default | Purpose |
|---------------|------------------------|---------|---------|
| `domains.sessionRecordings.directory` | `PICLAW_RECORDINGS_DIR` | `<PICLAW_DATA>/session-recordings` | Root directory for opt-in session trace recordings. |
| `domains.addons.apiFailureBackoffMs` | `PICLAW_ADDON_API_FAILURE_BACKOFF_MS` | `60000` | Suppression period for repeated identical add-on API failures. |
| `domains.agentControl.abortSettleTimeoutMs` | `PICLAW_ABORT_SETTLE_TIMEOUT_MS` | `1000` | Bounded `0..10000` ms wait for abort cleanup to settle. |

### VNC target examples

- **Array form**:

```bash
export PICLAW_WEB_VNC_TARGETS='[{"id":"lab","host":"192.168.1.50","port":5901,"readOnly":false},{"id":"pi","host":"pi.local","port":5900}]'
```

- **Object form** (keyed by target id):

```bash
export PICLAW_WEB_VNC_TARGETS='{ "lab": { "id": "lab", "host": "192.168.1.50", "port": 5901 }, "pi": { "host": "192.168.1.20", "port": 5900 } }'
```

The Classic VNC connection manager starts new direct connections at `localhost:5901`. Configured targets and successful connection history are separate lists. History is local to this browser, account and instance; it records only target reference, label, last-success time and pin state after the first framebuffer is painted. It keeps up to ten unpinned recents and ten pins, deduplicates targets, and ignores corrupt or blocked storage. Clear recent history preserves pins. Old unscoped direct-target preferences are not imported into this history.

Connected Classic sessions show only the framebuffer. Hover at the top centre for a reveal chevron, or tap/swipe down there on touch devices. `Ctrl+Alt+Shift+V` opens controls; Escape closes them. Open details or local keyboard focus retains controls. Connections & history preserves the active session until another target is selected. Disconnect closes it and cancels retries. Visual does not yet host this pane. See [VNC viewer setup](../runtime/skills/integrations/vnc-viewer-setup/SKILL.md) for configuration and isolated real-desktop tests.

The VNC password stays in JavaScript memory for the loaded page and is reused by in-page viewers and reconnects. Submitting an empty password clears it. A full reload or closed tab clears it; successful target metadata remains in scoped history. The existing pop-out flow can copy the password through its one-time, 60-second handoff record. Piclaw does not add the password to direct-target storage, URLs, cookies or logs. Same-origin code can access page memory while the viewer is loaded.

Direct-connect is enabled by default on Linux, macOS, and Windows. Disable it explicitly with:

```bash
PICLAW_WEB_VNC_ALLOW_DIRECT=0
```

Or in `.piclaw/config.json`:

```json
{
  "web": {
    "vncAllowDirect": false
  }
}
```

When direct-connect is disabled and no saved targets exist, the VNC pane shows an explicit empty state instead of suggesting a connection path that the host will reject.

CLI overrides: `piclaw --port`, `--host`, `--idle-timeout`, `--tls-cert`, `--tls-key`.

### Notification delivery debug labels

By default, PiClaw keeps browser-local notifications and service-worker Web Push titles clean.

To label delivery source while validating routing, set:

```bash
PICLAW_WEB_NOTIFICATION_DEBUG_LABELS=1
```

That appends labels like `[Local]` and `[Web Push]` to notification titles so local-vs-push behavior can be checked without digging through logs first.

### Reverse proxy / tunnel deployments

If piclaw is served behind a reverse proxy or tunnel (for example Cloudflare Tunnel, Caddy, Nginx, or another TLS terminator), set:

```bash
PICLAW_TRUST_PROXY=1
```

or in `.piclaw/config.json`:

```json
{
  "web": {
    "trustProxy": true
  }
}
```

This allows piclaw to trust forwarded host/proto information for:

- CSRF origin validation on browser POST/PATCH/DELETE/PUT requests
- WebAuthn/passkey origin handling
- absolute origin/link generation in the web channel
- client IP derivation for logging / rate limiting

For the full operator guide — including required forwarded headers, Cloudflare Tunnel, Caddy/Nginx examples, and troubleshooting — see [reverse-proxy.md](reverse-proxy.md).

Leave this disabled for direct/non-proxied deployments.

## Web terminal

The authenticated web terminal is **enabled by default on Linux and macOS** and **disabled by default on Windows**.

To disable it explicitly:

```bash
PICLAW_WEB_TERMINAL_ENABLED=0
```

To force-enable it explicitly on any platform:

```bash
PICLAW_WEB_TERMINAL_ENABLED=1
```

Pass this as an environment variable to `docker run`, `docker-compose.yml`, or `make up`, or set the nested config key `.piclaw/config.json -> web.terminalEnabled`.

On Linux, PiClaw uses Bun's native PTY backend first and falls back to an executable `script` command when native PTY creation fails. The interactive shell resolves in this order: `PICLAW_TERMINAL_SHELL`, the current user's passwd login shell, `SHELL`, `/bin/bash`, then `/bin/sh`.

On Windows, explicitly enabling the terminal uses Bun's native PTY backend. The shell resolves in this order: `PICLAW_TERMINAL_SHELL`, `SHELL`, `pwsh.exe`, `powershell.exe`, `COMSPEC`, then `cmd.exe`. Windows `PATH` and `PATHEXT` semantics are respected. Set `PICLAW_TERMINAL_SHELL` to an executable path or command name to override the selection.

`/terminal/session` reports the selected backend and a structured error when neither a shell nor PTY backend is available.

Once enabled:

1. Open the web UI.
2. Use the workspace header **hamburger menu**.
3. Choose **Open terminal in tab** or **Show terminal dock**.
4. Run `pi /login` to configure providers if needed.

## Workspace environment hook (`/workspace/.env.sh`)

PiClaw supports a workspace-scoped shell hook at `/workspace/.env.sh`.

For managed non-secret variables, prefer the built-in `env` tool first. It
writes a managed block into `/workspace/.env.sh`, persists the source of truth
under `/workspace/.piclaw/env-tool.json`, and updates `process.env`
immediately for later tool calls in the same runtime.

This file is a **power-user feature** for customizing the environment seen by:

- the embedded web terminal
- interactive shells in the container/workspace
- the supervisor-managed PiClaw runtime startup path

Common uses:

- extending `PATH` for workspace-local binaries
- redirecting tool config into the mounted workspace
- persisting GitHub CLI auth/config across container recreation
- keeping deliberate non-secret workspace defaults via the `env` tool

Example:

```bash
export PATH="/workspace/.local/bin:$PATH"
export GH_CONFIG_DIR=/workspace/.config/gh
mkdir -p /workspace/.config/gh
```

With that in place, you can install `gh` into `/workspace/.local/bin`, open the embedded terminal, run `gh auth login`, and keep the GitHub CLI auth state under the mounted workspace instead of ephemeral container-local config.

PiClaw ships an example installer script here:

```text
docs/helpers/install-gh.sh
```

Usage from inside the container / embedded terminal:

```bash
chmod +x docs/helpers/install-gh.sh
./docs/helpers/install-gh.sh
source /workspace/.env.sh
gh --version
gh auth login
```

That helper installs the latest GitHub CLI release into `/workspace/.local/bin/gh` and relies on `/workspace/.env.sh` to make it available in future shells and embedded terminal sessions.

### Behavior

- missing `/workspace/.env.sh` is a no-op
- new containers pick it up automatically on startup
- existing containers may need a one-time `.bashrc` regeneration if they were initialized before this feature existed
- the `env` tool manages only its own marked block inside `/workspace/.env.sh`
- the default workspace skeleton ignores `.env.sh` so local secrets and machine-specific paths are less likely to be committed accidentally

### Responsibility boundary

`/workspace/.env.sh` is user-controlled. If you put incompatible shell logic, exports, or PATH overrides in that file and PiClaw stops working correctly, that breakage is considered the user's responsibility rather than a PiClaw bug.

## Provider setup via `/login`

PiClaw reuses the upstream Pi provider/auth model rather than inventing a second provider-config system.

As a result:

- hosted providers are usually configured through `/login` in the web UI or `pi /login` in the terminal
- custom providers that speak the common OpenAI-style API can be configured directly from the `/login` card flow
- the built-in custom-card variants cover at least:
  - Azure OpenAI (`openai-responses` style endpoint)
  - Ollama (`openai-completions` style local endpoint)
  - generic OpenAI-compatible endpoints (base URL + API key + model id)
- provider credentials and configured models live in Pi-managed auth/config storage rather than a separate piclaw-only env-var matrix

Most users should prefer `/login` over setting raw provider env vars by hand unless they are deliberately using one of the packaged integration-specific paths.

Piclaw's `/login` provider picker uses Earendil's runtime provider catalog plus Piclaw's static fallback metadata. Recent built-in provider families exposed directly in the picker include:

- Qwen Token Plan (`qwen-token-plan`, `qwen-token-plan-cn`) — API key providers using `QWEN_TOKEN_PLAN_API_KEY` or `QWEN_TOKEN_PLAN_CN_API_KEY`.
- Z.AI China coding plan (`zai-coding-cn`) — API key provider using `ZAI_CODING_CN_API_KEY`.
- Radius (`radius`) — supports OAuth subscription login and API-key gateways.
- NVIDIA (`nvidia`) and Together (`together`) — API-key providers.
- Ant Ling (`ant-ling`) — API-key provider.
- Amazon Bedrock (`amazon-bedrock`) — external AWS credential chain or Bedrock bearer token; see [Amazon Bedrock](providers/amazon-bedrock.md) for Claude Opus 5 inference profiles, regions, caching, and the opt-in smoke command.

Use `/login <provider-id>` to configure one of these providers directly. Provider composition details are available in the `/agent/models` payload under `provider_diagnostics`; the payload includes non-secret auth source/label and composition flags.

### OpenRouter output budget

Piclaw bounds OpenRouter output reservations to avoid HTTP 402 failures caused by a model's advertised maximum output. The filter applies only to `openrouter` requests, preserves a lower explicit `max_tokens` or `max_completion_tokens` value, and defaults absent, malformed, or excessive limits to 32,768 tokens. It does not change the model's context window.

Set `domains.tools.openRouterDefaultMaxTokens` in `.piclaw/config.json` to change the ceiling. The value is bounded to 1,024–1,048,576 tokens. `PICLAW_OPENROUTER_DEFAULT_MAX_TOKENS` remains a compatibility alias until 3.0.0 and takes precedence over the persisted setting; the persisted setting takes precedence over the default.

When OpenRouter returns its structured HTTP 402 affordability response with both requested and affordable token counts, Piclaw retries once at the smaller of the failed request limit and 90% of the reported affordable count. The override exists only for that turn. Repeated, malformed, non-reducing, mismatched, or sub-1,024-token affordability results are terminal and are not sent through generic unchanged retries. Logs record only provider/model identifiers, numeric limits, reason, token field, and attempt number—not prompts, credentials, or full provider bodies.

Raising the configured ceiling enables longer OpenRouter generations but can increase reservation failures and worst-case spend.

### GitHub Copilot live model discovery

After GitHub Copilot authentication is available, Piclaw supplements Earendil's static Copilot catalog with the account's live `/models` response. The refresh runs at process boot and again when a session starts, so newly enabled account models can appear in `/model` and model selectors without waiting for a package release.

The refresh:

- keeps every static catalog model and merges live models by id
- imports chat-capable Responses, chat-completions, and Anthropic-style models
- filters known non-chat entries such as embeddings and `trajectory-compaction`
- derives API compatibility and pricing from the closest static model template while preferring live context, output, vision, and reasoning capabilities
- falls back to the static catalog if auth, discovery, or registration fails

| Variable | Default | Purpose |
|---|---:|---|
| `PICLAW_GITHUB_COPILOT_DYNAMIC_MODELS` | `1` | Set to `0`, `false`, or `no` to disable live Copilot model discovery |
| `PICLAW_GITHUB_COPILOT_MODELS_TIMEOUT_MS` | `3500` | Timeout for the Copilot `/models` request; values below 500 ms are clamped to 500 ms |

Dynamic-model cost is an estimate inherited from the closest static template (and falls back to zero only when no template is available). Treat `/stats` cost for a newly discovered model as diagnostic rather than an account invoice.

For the packaged Azure managed-identity/static-key path and its additional token-budget controls, see [Azure OpenAI extension](azure/azure-openai-extension.md).

## Runtime and agent

| Variable | Default | Purpose |
|----------|---------|---------|
| `PICLAW_AUTOSTART` | `1` | Set to `0` to keep the supervisor service idle (run `pi`/`piclaw` manually) |
| `PICLAW_AGENT_TIMEOUT` | `3600000` | Max foreground agent turn time (ms), including interactive web chats |
| `PICLAW_BACKGROUND_AGENT_TIMEOUT` | `0` | Max background invocation time (ms; `0` disables and falls back to `PICLAW_AGENT_TIMEOUT`) |
| `PICLAW_ASSISTANT_NAME` | `PiClaw` | Display name in the web UI |
| `PICLAW_ASSISTANT_AVATAR` | _(empty)_ | Avatar URL for the web UI |
| `PICLAW_USER_NAME` | _(empty)_ | Display name for the human user in the web UI |
| `PICLAW_USER_AVATAR` | _(empty)_ | Avatar URL for the human user |
| `PICLAW_USER_AVATAR_BACKGROUND` | _(empty)_ | CSS background colour for the user avatar circle |
| `PICLAW_TURN_MAX_TOOL_EXECUTIONS` | `64` | Authoritative per-turn completed tool-execution budget. Settings persists `domains.agent.toolUseMessageBudget`; values are clamped to `8..512`. Legacy `PICLAW_TURN_MAX_TOOL_USE_MESSAGES` and `PICLAW_MID_TURN_TOOL_EXECUTION_HARD_CEILING` are lower-priority compatibility aliases. |
| `PICLAW_WHATSAPP_PHONE` | _(empty)_ | Alias for `WHATSAPP_PHONE` |
| `PICLAW_TOOL_OUTPUT_RETENTION_MS` | `2592000000` (30 days) | Milliseconds to retain stored tool outputs (preferred; overrides `_DAYS`; values are capped at 30 days) |
| `PICLAW_TOOL_OUTPUT_RETENTION_DAYS` | _(legacy)_ | Days to retain stored tool outputs (deprecated; use `_MS`) |
| `PICLAW_TOOL_OUTPUT_CLEANUP_INTERVAL_MS` | `900000` (15 min) | Cleanup interval (ms) |
| `PICLAW_TOOL_OUTPUT_STORE_BYTES` | `4096` | Store tool output externally when payload exceeds this byte threshold |
| `PICLAW_TOOL_OUTPUT_STORE_LINES` | `40` | Store tool output externally when payload exceeds this line threshold |
| `PICLAW_TOOL_OUTPUT_STORE_THRESHOLDS_BY_TOOL` | _(empty)_ | Optional JSON map of per-tool byte/line thresholds, e.g. `{"proxmox":{"bytes":16384,"lines":200}}` |
| `PICLAW_TOOL_OUTPUT_PREVIEW_LINES` | `8` | Preview lines shown in compacted tool-result summaries |
| `PICLAW_TOOL_OUTPUT_PREVIEW_LINE_CHARS` | `200` | Max characters per preview line in compacted tool-result summaries |
| `PICLAW_TOOL_RESULT_COMPACTION_ENABLED` | `1` | Master runtime gate for tool-result compaction |
| `PICLAW_TOOL_RESULT_COMPACTION_TOOLS` | `bash,powershell,exec_batch` | Comma-separated or JSON-array allowlist of tools eligible for compaction |
| `PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_ENABLED` | `1` | Enable semantic summary generation for compacted tool results |
| `PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_MAX_INPUT_CHARS` | `12000` | Max sampled tool-output characters sent to semantic summarizer |
| `PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_MAX_TOKENS` | `320` | Max generated semantic summary tokens |
| `PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_TIMEOUT_MS` | `12000` | Timeout for semantic summary generation before preview fallback |
| `PICLAW_MAIN_SESSION_IDLE_TTL_MS` | `180000` (3 min) | Idle TTL for the main interactive session; `PICLAW_SESSION_IDLE_TTL_MS` overrides the fallback when set |
| `PICLAW_SIDE_SESSION_IDLE_TTL_MS` | `60000` (1 min) | Idle TTL for side/background sessions; `PICLAW_SESSION_IDLE_TTL_MS` overrides the fallback when set |
| `PICLAW_SESSION_IDLE_TTL_MS` | _(empty)_ | Shared idle TTL override for main and side sessions when their specific variables are unset |
| `PICLAW_MAIN_SESSION_POOL_MAX_SIZE` | `1` | Max number of warm main chat sessions kept cached under normal conditions |
| `PICLAW_MAIN_SESSION_PRESSURE_RSS_BYTES` | `402653184` (384 MB) | RSS threshold that enables memory-pressure session eviction mode |
| `PICLAW_MAIN_SESSION_PRESSURE_IDLE_TTL_MS` | `60000` | Main-session idle TTL while memory pressure mode is active |
| `PICLAW_MAIN_SESSION_PRESSURE_POOL_MAX_SIZE` | `1` | Max cached main sessions while memory pressure mode is active |

Notes:

- The Settings **Tool use budget** is authoritative and counts completed tool executions across all attempts in one user turn. Piclaw warns near the limit without changing the advertised tool set, admits at most the configured number of executions (including parallel batches), and blocks additional calls before execution. The former `PICLAW_MID_TURN_TOOL_EXECUTION_HARD_CEILING` setting is ignored and removed when Settings saves the budget.
- Tool output retention defaults to **30 days** and is capped at 30 days. `PICLAW_TOOL_OUTPUT_RETENTION_MS` overrides the legacy `PICLAW_TOOL_OUTPUT_RETENTION_DAYS`.
- Tool-result compaction supports both a global gate (`PICLAW_TOOL_RESULT_COMPACTION_ENABLED`) and per-tool allowlisting (`PICLAW_TOOL_RESULT_COMPACTION_TOOLS`).
- Semantic summaries are enabled by default for compacted tool results; if generation fails or times out (`PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_TIMEOUT_MS`), Piclaw falls back to preview-based summaries.
- Background and scheduled turns use `PICLAW_BACKGROUND_AGENT_TIMEOUT` when set; otherwise they fall back to `PICLAW_AGENT_TIMEOUT`.
- On `systemd --user` installs, keep `PICLAW_WORKSPACE`, `PICLAW_STORE`, and `PICLAW_DATA` stable across restarts. Startup recovery relies on the persisted SQLite state plus writable IPC files under `PICLAW_DATA/ipc/tasks`.
- Native sessions use SQLite context maintenance. Legacy JSONL rotation and session idle-wait settings have no native execution effect; retained historical file settings do not enable rotation.
- Warm-session pressure mode defaults to **384 MB RSS** before clamping the main-session cache. Set `PICLAW_MAIN_SESSION_PRESSURE_RSS_BYTES` to override the threshold.
- In pressure mode, the main-session pool clamps to `PICLAW_MAIN_SESSION_PRESSURE_POOL_MAX_SIZE` (default `1`) and uses the shorter `PICLAW_MAIN_SESSION_PRESSURE_IDLE_TTL_MS` (default `60000`).
- Oversized persisted `toolResult` payloads are sanitized before session resume and at append-time so inline image/blob payloads do not keep re-accumulating inside session files.
- Blank or no-terminal-output turns are not considered successful consumption. Automatic recovery still runs first; if no terminal assistant reply is persisted, the cursor is rewound and the failed run is held for explicit retry or skip resolution.
- `domains.recovery.automaticRecoveryTotalBudgetMs` controls the total bounded recovery window. `0` (the default) derives one-third of the effective turn timeout, bounded to 6–60 minutes and never above a positive turn timeout. A positive value remains an explicit cap; with timeout disabled, automatic mode uses 6 minutes.
- Timeout recovery exhaustion is reported separately from provider retry exhaustion, preserving timeout as the primary cause in protected handoff metadata.
- A first tool-dependent timeout or context-pressure failure may compact and run one tools-enabled continuation automatically. This one-use path requires explicitly resolved tool state, no tool failure, no terminal side-effect mix, no exhausted tool budget, available tool control, a successful non-skipped compaction, remaining recovery time/attempts, and an available source generation. It resumes the persisted session with a neutral continuation prompt; it never replays the original instruction.

### Native compaction

Both settings skins expose one host-wide automatic-compaction toggle, persisted as `domains.compaction.autoCompactionEnabled`. Native Harness decisions read it dynamically; `/auto-compact on|off` uses the same policy. A valid `PICLAW_AUTO_COMPACTION_ENABLED` compatibility override has higher precedence; conflicting saves fail without writing settings.

Compaction uses the active conversation model and SDK token thresholds. Selective/Pipelined methods, separate compaction models, remote pre-passes, legacy percentage thresholds, wall-clock deadlines and per-chat backoffs are unavailable in the native UI/API. Historical values and receipts remain intact. Manual `/compact`, accepted maintenance, recovery and accounting retain their native ownership checks. See [Native compaction policy](compaction-models-and-deadlines.md) for the field mapping and HTTP retirement contract.

Deprecated env names (still supported): `ASSISTANT_NAME`, `ASSISTANT_AVATAR`, `AGENT_TIMEOUT`, `AGENT_TIMEOUT_BACKGROUND`.

## SSH-backed remote core tools

Piclaw can redirect the core file/shell tools (`read`, `write`, `edit`, `bash`) to a remote host over SSH.

There are two ways to enable it:

1. **Startup/default session config** via env vars:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PICLAW_SSH_TARGET` | _(empty)_ | SSH target as `user@host` or `user@host:/remote/path` |
| `PICLAW_SSH_PORT` | `22` | SSH port for startup/default remote sessions |

1. **Per-chat live config** via the agent-only `ssh` tool:
   - `ssh { action: "set", ssh_target, private_key_keychain, ... }`
   - `ssh { action: "get" }`
   - `ssh { action: "clear" }`

The `ssh` tool stores chat-scoped profiles in SQLite and applies them immediately to live sessions when possible. The agent can switch a chat from local → remote → local again in the same turn without recreating the session runtime. Live SSH redirection is automatically cleared at the end of each agent turn; the stored profile remains available for later inspection or re-application.

### Required key material

Live per-chat SSH uses keychain-backed credentials:

- `private_key_keychain` — required; keychain entry containing the OpenSSH private key
- `known_hosts_keychain` — optional; keychain entry containing `known_hosts` content
- `strict_host_key_checking` — `yes`, `accept-new`, or `no`

Example tool payload:

```json
{
  "action": "set",
  "ssh_target": "agent@example.com:/srv/project",
  "ssh_port": 22,
  "private_key_keychain": "ssh/prod",
  "known_hosts_keychain": "ssh/prod.known_hosts",
  "strict_host_key_checking": "accept-new"
}
```

### Transport behavior

The SSH backend keeps the same remote-tool semantics as the packaged SSH extension model:

- multiplexed connection reuse with `ControlMaster=auto`
- `ControlPersist=600`
- persistent remote shell/session reuse across tool calls
- remote cwd/home mapping from the configured target path
- immediate live switching when the chat already has a warm session
- automatic live-redirection cleanup at the end of each agent turn, so the next turn starts with local core tools unless SSH is re-applied

If a chat has no stored SSH profile, core tools run locally as usual.

### Assistant name and avatar

Set via environment variables (see above) or in `.piclaw/config.json`:

```json
{
  "assistant": {
    "assistantName": "PiClaw",
    "assistantAvatar": "https://example.com/avatar.png"
  }
}
```

### MCP server config (`pi-mcp-adapter`)

PiClaw ships the `pi-mcp-adapter` extension for token-efficient MCP access.

Preferred shared project config:

```text
/workspace/.mcp.json
```

Starter examples seeded on first startup:

```text
/workspace/.mcp.json.example
/workspace/.pi/mcp.json.example
```

Pi-specific override layers also work:

```text
~/.pi/agent/mcp.json
/workspace/.pi/mcp.json
```

In the container image that Pi home is typically bind-mounted under:

```text
/config/.pi/agent/mcp.json
```

With the stock `docker-compose.yml` in this repo, that container path is persisted on the host under:

```text
./home/.pi/agent/mcp.json
```

The same `/config/.pi/agent/` path also holds Pi-managed provider auth/model metadata in the container image, so users should not need to re-run `/login` after every recreate as long as the `./home:/config` bind mount is preserved.

Notes:

- prefer the project-local file when MCP servers are part of the current workspace
- config lookup prefers shared MCP files first (`~/.config/mcp/mcp.json`, then project `.mcp.json`), with Pi-owned config layers used for Pi-specific imports or overrides and project-local `.pi/mcp.json` as the final override
- start a new chat/session or restart PiClaw after changing MCP config
- the adapter exposes the `mcp` tool plus `/mcp`, `/mcp status`, `/mcp tools`, `/mcp reconnect [server]`, and `/mcp-auth` commands
- `/mcp` opens the MCP management panel in the web UI and falls back to text status elsewhere
- `pi-mcp-adapter` does not require `mcp-cli`

### Default active tools

Piclaw keeps the always-active baseline small and uses `list_tools` and `activate_tools` to enable extra capabilities on demand.

#### How tool activation affects token usage

- **Default-active tools** are injected as full schemas (all fields and constraints)
  into the system prompt.
- **On-demand tools** are represented by compact catalog entries (name +
  short summary/metadata) until explicitly activated.

Because the system prompt is sent on every model request, active tool schemas
always contribute extra token cost. Typical magnitudes in this setup are:

| Tool tier | Typical prompt impact |
| --- | --- |
| Default-active | `~50-200` tokens each |
| On-demand catalog entry | `~10-15` tokens each |

With all bundled tools present, this staged setup keeps context spend predictable
and avoids full-schema bloat for rarely used tools.

#### Built-in default baseline

- `read`
- `edit`
- `write`
- `bash` on Linux/macOS, or `powershell` plus `bun_run` on Windows
- `list_tools`
- `activate_tools`
- `reset_active_tools`
- `attach_file`
- `messages`
- `keychain`
- `exit_process`

At session start, piclaw also auto-promotes available tools to the effective
default set when they are already safe/cheap:

- read-only + lightweight tools (for example `grep`, `find`, `ls`, `get_model_state`),
- message/scheduling/attachment helpers when present (`messages`, `schedule_task`,
  `scheduled_tasks`, `read_attachment`, `export_attachment`),
- `attach_file` and `keychain` when available.

Common read and inspect workflows stay fast while more expensive tools stay opt-in via activation.

#### Activate additional tools

Use this sequence:

1. `list_tools` with `query` or `intent` for compact discovery.
2. Activate only the needed tool(s) via `activate_tools`.
3. Use them in the same turn or next turn; activation updates apply within-session.

Add more always-active tools in `.piclaw/config.json` under `tools.additionalDefaultTools`:

```json
{
  "tools": {
    "additionalDefaultTools": [
      "search_workspace",
      "introspect_sql"
    ]
  }
}
```

A comma-separated string is also accepted:

```json
{
  "tools": {
    "additionalDefaultTools": "search_workspace, introspect_sql"
  }
}
```

The environment variable `PICLAW_ADDITIONAL_DEFAULT_TOOLS` is equivalent.

Notes:

- `reset_active_tools` restores this configured default set, not just the built-in baseline.
- Unknown tool names are silently ignored when applying the default set.
- On Windows, `bash` is replaced by the `powershell` tool in the default active set.
- Newly activated tools become available immediately to subsequent tool/model steps
  in the same turn; keep critical control tools in defaults.
- Tool activation is session-scoped and resets on session rotation or restart.
- On-demand tools still carry a small catalog cost in prompts even before activation.

### Workspace search / FTS roots

Piclaw's `search_workspace` tool uses SQLite FTS over a configurable set of workspace roots.
Dream and AutoDream refresh this index at the end of memory maintenance so generated note outputs are searchable immediately.

Default roots:

- `notes`
- `.pi/skills`

Override them with either `.piclaw/config.json`:

```json
{
  "tools": {
    "workspaceSearchRoots": [
      "notes",
      ".pi/skills",
      "docs",
      "workitems"
    ]
  }
}
```

or an environment variable:

```bash
PICLAW_WORKSPACE_SEARCH_ROOTS="notes,.pi/skills,docs,workitems"
```

Rules:

- Relative paths are resolved against `PICLAW_WORKSPACE`
- Absolute paths are allowed
- Configured roots are indexed automatically at session start
- `search_workspace` can still refresh indexing on demand per call
- `refresh_workspace_index` forces a full rebuild for the configured roots
- the web workspace explorer shows the current index status, last indexed time, indexed file count, configured roots, and a one-click reindex control
- `scope: notes` and `scope: skills` remain the built-in convenience filters; `scope: all` searches across the configured root set

### Dream and AutoDream

Memory maintenance has two trigger modes:

- `Dream` — manual `/dream [days]`
- `AutoDream` — built-in nightly scheduled task (`builtin-dream-midnight`)

Both modes run as out-of-band model turns on a temporary `dream:` channel. The dream channel is cleaned up after the cycle ends.
Before the model turn begins, runtime creates a pre-Dream `.zip` backup of `notes/daily/` and `notes/memory/`, prunes older Dream backups (default keep: 10), and refreshes/seeds in-window daily notes from the messages database.

Default windows:

- manual `Dream` keeps the historical default of 7 days unless you pass `/dream <days>`
- nightly `AutoDream` defaults to a 2-day window

AutoDream is gated, but nightly cadence no longer waits for a full 24-hour gap.
It runs when there has been activity since the last consolidation.

Dream runtime settings are persisted under `domains.dream` in `.piclaw/config.json`. The legacy environment variables remain compatibility aliases until 3.0.0 and override persisted values without being mutated by runtime.

| Typed setting | Compatibility variable | Default | Purpose |
|---------------|------------------------|---------|---------|
| `domains.dream.cron` | `PICLAW_DREAM_CRON` | `0 1 * * *` | Cron schedule for AutoDream. Evaluated in the runtime timezone (`TZ` / runtime timing config), so the default is 01:00 local runtime time. |
| `domains.dream.model` | `PICLAW_DREAM_MODEL` | _(unset — inherits session model)_ | Pin Dream / AutoDream to a specific model label (e.g. `anthropic/claude-sonnet-4-20250514`). The Dream pass applies it to its private SDK conversation, including manual `/dream` runs. |
| `domains.dream.backupKeep` | `PICLAW_DREAM_BACKUP_KEEP` | `10` | Number of pre-Dream note backups to retain. |
| `domains.dream.agentTimeoutMs` | `PICLAW_DREAM_AGENT_TIMEOUT_MS` | background-agent timeout, or `360000` | Positive timeout for the out-of-band Dream model turn. |

Additional Dream cue tuning remains environment-only:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PICLAW_DREAM_CUE_FULL_SLICE_MAX_MESSAGES` | `50` | `DREAM_CUES` full-slice cutoff for day message count |
| `PICLAW_DREAM_CUE_FULL_SLICE_MAX_SESSION_TREES` | `2` | `DREAM_CUES` full-slice cutoff for session-tree count |
| `PICLAW_DREAM_CUE_SMALL_TREE_MAX_MESSAGES` | `10` | Per-session-tree cue cutoff under which all messages from that tree are included |
| `PICLAW_DREAM_CUE_MAX_SNIPPETS` | `100` | Global `DREAM_CUES` snippet budget before large trees downgrade from `5+5` to `2+2` |

- if there is no prior consolidation, AutoDream runs
- if there have been no sessions since the last consolidation, AutoDream skips
- otherwise the nightly run proceeds even if the previous consolidation was late the night before

The model follows the original 4-phase Dream flow:

1. Orient
2. Signal
3. Consolidate
4. Prune and Index

In the Prune and Index phase, Dream should both remove stale pointers and add concise references to newly important memories; verbose `MEMORY.md` lines should be shortened with detail moved into the linked file.

Search collection should stay narrow:

- inspect daily/memory files first
- inspect drifted memories
- use narrow message searches for already suspected terms
- avoid exhaustive transcript sweeps

See [runtime/docs/dream-memory.md](../runtime/docs/dream-memory.md) for the detailed file sequence and outputs.

## Access mode

Only `single-user` can start. Set `domains.access.mode` in `.piclaw/config.json`; the default is `single-user`. Invalid configuration and incompatible store markers fail closed. Family features are removed. See [Access modes](access-modes.md).

## Authentication (TOTP + passkeys)

The setup below applies to supported **single-user deployments**. A 6-digit TOTP challenge can gate the UI, with optional WebAuthn passkeys. The manifest, service worker, agent avatar/icons, fonts, login bundles and static images have explicit public exceptions; arbitrary `/static/*` assets and app bundles are not all public. See `runtime/src/channels/web/http/route-flags.ts` for the classification.

The login shell discovers enabled methods through public `/auth/options`. Code login sends only a six-digit code. A failed policy fetch leaves credential entry disabled until retry. Passkey management requires a recent owner login and matching Origin.

| Variable | Default | Purpose |
|----------|---------|---------|
| `PICLAW_WEB_TOTP_SECRET` | _(empty)_ | Base32 TOTP secret. When set, `/login` requires a 6-digit code before issuing a `piclaw_session` cookie. Prefer keychain/service-environment storage; plaintext JSON remains a legacy compatibility path for the existing `/totp` flow. |
| `PICLAW_WEB_PASSKEY_MODE` | `totp-fallback` | Passkey mode: `totp-fallback`, `passkey-only`, or `totp-only`. |
| `PICLAW_WEB_TOTP_WINDOW` | `1` | TOTP step skew (number of 30s windows to accept on either side). |
| `PICLAW_WEB_SESSION_TTL` | `604800` (7 days) | Session cookie lifetime in seconds. |
| `PICLAW_WEB_INTERNAL_SECRET` / `PICLAW_INTERNAL_SECRET` | _(empty)_ | Shared secret for unattended POST/PATCH calls to `/internal/post`; required when TOTP is enabled and you want automations to keep posting. |

### Setup flow (TOTP)

You can either preconfigure `PICLAW_WEB_TOTP_SECRET` yourself or initialize it from the web UI.

#### Web-first setup

1. Leave `PICLAW_WEB_TOTP_SECRET` unset.
2. Open the web UI and run `/totp`.
3. Piclaw shows a single card containing a QR code, manual entry code, and a 6-digit confirmation input.
4. Scan the QR (or paste the manual code) into your authenticator app.
5. Enter a live 6-digit code into the same card and submit it.
6. Only after successful confirmation does Piclaw commit the secret and establish a TOTP-authenticated browser session.
7. If confirmation fails, nothing changes and the secret is not committed.

#### Preconfigured setup

1. Set `PICLAW_WEB_TOTP_SECRET` to a securely generated base32 seed. A six-digit TOTP code is not a seed; `oathtool --totp -b <seed>` produces a code from an existing seed.
2. Restart piclaw.
3. Visiting the UI redirects to `/login`.
4. Enter the 6-digit code from your authenticator app to receive an HTTP-only `piclaw_session` cookie.
5. Server sessions expire after `PICLAW_WEB_SESSION_TTL` seconds. Deleting a browser cookie removes that browser's copy; it does not revoke a copied token on the server.
6. To re-display the active secret for another device, run `/totp` in the web UI.

#### Reset flow

1. Run `/totp reset <current-code>` in the web UI.
2. Piclaw verifies the current active TOTP code first.
3. If valid, Piclaw shows a single confirmation card containing the new QR/manual code plus a 6-digit confirmation input.
4. Scan the new secret and confirm it from the same card.
5. Only after successful confirmation does Piclaw commit the new secret and invalidate existing web sessions.
6. If final confirmation fails, the old secret and current sessions remain unchanged.

### Passkey enrolment

1. Sign in with an enabled method: TOTP for the first passkey, or an existing passkey for additional keys.
2. Open **Settings → Authentication → Passkeys** in Classic or Visual.
3. Choose **Add passkey**, give it a name and complete the browser's native prompt. The key appears after server verification.
4. If your login is older than five minutes, use **Sign in again**, then return and select **Refresh**. Adding another key in passkey-only mode does not require TOTP.

### Notes

- Settings lists names, creation dates and last use, with per-key Rename and Remove actions. `/passkey list` still works; enrol/delete commands now direct you to authenticated Settings.
- Passkeys are bound to the hostname used during enrolment (RP ID).
- The login page offers an explicit passkey button and optional conditional mediation when passkeys are enabled. TOTP remains available only when configured; passkey-only mode hides the code form, and totp-only mode makes no passkey attempt.
- Removing a passkey blocks future login with it but does not sign out existing sessions. The server refuses removal of the last usable sign-in method; keys for another hostname and TOTP disabled by policy do not count as fallback.
- Legacy single-user bearer enrolment links and `/auth/webauthn/register/*` are retired (HTTP 410). Use session-bound Settings; existing registered credentials are preserved.
- All auth endpoints (`/auth/verify`, WebAuthn login, and enrol) are rate-limited per IP (10–20 attempts per 5 minutes).
- After five failed TOTP attempts in five minutes, the IP is temporarily locked out for five minutes (with audit logs emitted on failures).
- TOTP confirmation flows return explicit success/failure feedback and report whether the secret/session state changed.

In single-user mode, internal automation can use `/internal/post` with the configured secret in `x-piclaw-internal-secret` or `Authorization`. Family dispatch denies this route; an internal/widget secret does not establish an account principal.

## Keychain secrets

See [keychain.md](keychain.md) for full details. Preserve existing key material and historical authentication records in coordinated backups.

The keychain is disabled unless you provide a master key:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PICLAW_KEYCHAIN_KEY` | _(empty)_ | Master key for encrypting/decrypting keychain entries |
| `PICLAW_KEYCHAIN_KEY_FILE` | _(empty)_ | Read master key from a file (trimmed) |

Quick example:

```bash
PICLAW_KEYCHAIN_KEY="your-master-key" \
  piclaw keychain set github/token --type token --secret "ghp_xxx"
```

## WhatsApp pairing

See [whatsapp.md](whatsapp.md) for full details.

WhatsApp is optional and disabled by default. Piclaw does not attempt to connect — no QR prompt, no reconnect logs — unless explicit enablement is set. A no-op stub is used internally so all other channels work normally.

If QR pairing fails (headless/server environments), explicitly enable WhatsApp and provide a phone number to request a pairing code:

```bash
PICLAW_WHATSAPP_ENABLED=1
PICLAW_WHATSAPP_PHONE=1234567890
```

Or in `.piclaw/config.json`:

```json
{
  "whatsapp": {
    "enabled": true,
    "phoneNumber": "1234567890"
  }
}
```

Legacy top-level `whatsappPhone`/`WHATSAPP_PHONE` values are still read, but they no longer enable the channel by themselves.

## Pushover notifications

`piclaw` can send push notifications for scheduled tasks and IPC messages.

```bash
PUSHOVER_APP_TOKEN=your-app-token
PUSHOVER_USER_KEY=your-user-key
PUSHOVER_DEVICE=myphone          # optional
PUSHOVER_PRIORITY=0              # optional
PUSHOVER_SOUND=pushover          # optional
```

Or in `.piclaw/config.json` under the `pushover` key:

```json
{
  "pushover": {
    "appToken": "your-app-token",
    "userKey": "your-user-key",
    "device": "myphone"
  }
}
```

## Using an external workspace

By default, `docker-compose.yml` bind-mounts `./workspace`. To use a different path, set `WORKSPACE_PATH` in `.env`:

```bash
echo 'WORKSPACE_PATH=/mnt/data/piclaw-workspace' >> .env
make up
```

Or override directly:

```bash
WORKSPACE_PATH=/mnt/data/piclaw-workspace docker compose up -d
```

## Container UID/GID remapping

The compose stack passes `PUID` and `PGID` into the container. On startup,
`/entrypoint.sh` remaps the runtime `agent` user/group to those ids before it initializes the home directory and piclaw-managed persistent state.

The entrypoint validates the Supervisor configuration using a Python INI parser
(not the `supervisord` binary itself) before launching the process manager.
This catches malformed configs at startup instead of silently failing to start managed services.

Typical usage:

```bash
PUID=$(id -u) PGID=$(id -g) docker compose up -d
```

Or in `.env`:

```bash
PUID=1000
PGID=1000
```

Notes:

- Remapping applies to piclaw-managed paths such as `/home/agent`, `/config`,
  `/workspace/.piclaw`, and `/workspace/.pi`.
- The entrypoint does **not** recursively chown the entire `/workspace` bind mount, so existing project files outside piclaw-managed state keep their host ownership.
- If the requested uid/gid is already claimed by a different user/group inside
  the container, startup aborts with a clear error instead of silently picking a
  conflicting mapping.
- Changing `PUID` / `PGID` requires restarting/recreating the container.

## Remote Peer add-on

Cross-instance identity, pairing, messaging, and mediated work are configured by the installable [Remote Peer add-on](https://rcarmo.github.io/piclaw-addons/addons/remote-peer/). Core has no peer-specific settings or peer-owned state.

### Retired Core execution settings

Native SDK task/submission maintenance owns compaction and recovery. The former Core automatic-recovery attempt/budget/loop-guard controls, session JSONL rotation limits, and foreground/idle/scoped trigger thresholds are no longer active settings. Sessions panes retain the independent tool-use budget and session-isolation controls. Native auto-compaction remains on the Compaction pane; accepted maintenance is not cancelled or replayed by a policy edit.

Old JSON configuration and historical receipts remain untouched. Declared retired domain keys are preserved but never resolved or accepted in a new patch; unrelated unknown keys still fail validation. Stale general-setting saves containing retired execution fields reject before any change. Root SDK summary/model/watchdog utilities with real consumers retain their own settings; they do not enable a second native recovery loop. See [prompt-owner retirement](development/native-prompt-retirement.md).
