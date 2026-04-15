# Configuration

This document covers all `piclaw` configuration options: environment variables, config files, secrets, authentication, and notifications.

## Path overrides

| Variable | Default | Purpose |
|----------|---------|---------|
| `PICLAW_WORKSPACE` | `/workspace` | Working directory for `pi` + `piclaw` |
| `PICLAW_STORE` | `/workspace/.piclaw/store` | SQLite database location |
| `PICLAW_DATA` | `/workspace/.piclaw/data` | Sessions, IPC, chats.json |
| `SUPERVISOR_CONF` | `/workspace/.piclaw/supervisor/supervisord.conf` | Supervisor config path (falls back to `/etc/supervisor/supervisord.conf`) |

## Web server

| Variable | Default | Purpose |
|----------|---------|---------|
| `PICLAW_WEB_PORT` | `8080` | Web UI port |
| `PICLAW_WEB_HOST` | `0.0.0.0` | Bind address |
| `PICLAW_WEB_IDLE_TIMEOUT` | `0` (disabled) | Drop idle clients after this many seconds |
| `PICLAW_WEB_TERMINAL_ENABLED` | `1` on Linux/macOS, `0` on Windows | Enable or disable the authenticated web terminal backend/pane |
| `PICLAW_WEB_VNC_TARGETS` | _(empty)_ | JSON allowlist for VNC targets (or use `PICLAW_VNC_TARGETS`). Supports array or object form. |
| `PICLAW_WEB_VNC_ALLOW_DIRECT` | `1` on Linux/macOS/Windows | Allow or disable direct VNC targets supplied at runtime (`PICLAW_VNC_ALLOW_DIRECT` alias) |
| `PICLAW_WEB_TLS_CERT` | _(empty)_ | Path to TLS certificate; enables HTTPS |
| `PICLAW_WEB_TLS_KEY` | _(empty)_ | Path to TLS private key; enables HTTPS |
| `PICLAW_WEB_MAX_CONTENT_CHARS` | `262144` | Max message size in characters; oversized messages are truncated with metadata |
| `PICLAW_TRUST_PROXY` | `0` | Trust `Forwarded` / `X-Forwarded-*` headers from a reverse proxy for origin, host, proto, and client IP handling |

If `PICLAW_WEB_TLS_CERT` and `PICLAW_WEB_TLS_KEY` are both omitted, piclaw checks for `.piclaw/certs/sandbox.local.crt` and `.piclaw/certs/sandbox.local.key` and enables HTTPS automatically if both exist.

### VNC target examples

- **Array form**:

```bash
export PICLAW_WEB_VNC_TARGETS='[{"id":"lab","host":"192.168.1.50","port":5901,"readOnly":false},{"id":"pi","host":"pi.local","port":5900}]'
```

- **Object form** (keyed by target id):

```bash
export PICLAW_WEB_VNC_TARGETS='{ "lab": { "id": "lab", "host": "192.168.1.50", "port": 5901 }, "pi": { "host": "192.168.1.20", "port": 5900 } }'
```

When direct-connect is allowed, the UI accepts inputs like `server` + `port` from the VNC target picker and connects to `<host>:<port>` directly.

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

When direct-connect is disabled and no saved targets exist, the VNC pane now shows an explicit empty-state message instead of suggesting a direct connection path that the host will reject anyway.

CLI overrides: `piclaw --port`, `--host`, `--idle-timeout`, `--tls-cert`, `--tls-key`.

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

Once enabled:

1. Open the web UI.
2. Use the workspace header **hamburger menu**.
3. Choose **Open terminal in tab** or **Show terminal dock**.
4. Run `pi /login` to configure providers if needed.

## Workspace environment hook (`/workspace/.env.sh`)

PiClaw supports a workspace-scoped shell hook at `/workspace/.env.sh`.

This is a **power-user feature** for intentionally customizing the environment seen by:

- the embedded web terminal
- interactive shells in the container/workspace
- the supervisor-managed PiClaw runtime startup path

Typical uses include:

- extending `PATH` for workspace-local binaries
- redirecting tool config into the mounted workspace
- persisting GitHub CLI auth/config across container recreation

Example:

```bash
export PATH="/workspace/.local/bin:$PATH"
export GH_CONFIG_DIR=/workspace/.config/gh
mkdir -p /workspace/.config/gh
```

With that in place, you can install `gh` into `/workspace/.local/bin`, open the embedded terminal, run `gh auth login`, and keep the GitHub CLI auth state under the mounted workspace instead of ephemeral container-local config.

If you want a ready-made helper, PiClaw ships an example installer script here:

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
- the default workspace skeleton ignores `.env.sh` so local secrets and machine-specific paths are less likely to be committed accidentally

### Responsibility boundary

`/workspace/.env.sh` is user-controlled. If you put incompatible shell logic, exports, or PATH overrides in that file and PiClaw stops working correctly, that breakage is considered the user's responsibility rather than a PiClaw bug.

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
| `PICLAW_SESSION_MAX_SIZE_MB` | `100` | Session file size threshold (MB) for auto-rotation warnings |
| `PICLAW_SESSION_AUTO_ROTATE` | `0` | Automatically rotate oversized session files before the next prompt |
| `PICLAW_WHATSAPP_PHONE` | _(empty)_ | Alias for `WHATSAPP_PHONE` |
| `PICLAW_TOOL_OUTPUT_RETENTION_DAYS` | `30` | Days to retain stored tool outputs |
| `PICLAW_TOOL_OUTPUT_CLEANUP_INTERVAL_MS` | `43200000` | Cleanup interval (ms) |

Notes:

- Interactive web turns now use `PICLAW_AGENT_TIMEOUT` directly.
- Background/scheduled turns use `PICLAW_BACKGROUND_AGENT_TIMEOUT` when set, otherwise they fall back to `PICLAW_AGENT_TIMEOUT`.
- On `systemd --user` installs, keep `PICLAW_WORKSPACE`, `PICLAW_STORE`, and `PICLAW_DATA` stable across restarts. Startup recovery relies on the persisted SQLite state plus writable IPC files under `PICLAW_DATA/ipc/tasks`.

Deprecated env names (still supported): `ASSISTANT_NAME`, `ASSISTANT_AVATAR`, `AGENT_TIMEOUT`, `AGENT_TIMEOUT_BACKGROUND`.

## Experimental M365 extension

| Variable | Default | Purpose |
|----------|---------|---------|
| `PICLAW_ENABLE_M365_EXPERIMENTAL` | `0` | Enable the packaged Microsoft 365 experimental extension |
| `M365_EDGE_PATH` | _(auto-discover)_ | Override browser path (Edge → Chrome → Chromium fallback order otherwise) |
| `M365_USE_TEMP_EDGE_PROFILE` | `false` | Use a temporary browser profile instead of the normal logged-in browser profile |
| `PICLAW_M365_YOLO` | `0` | Skip the explicit consent interstitial before auth navigation |
| `M365_TENANT_ID` | `common` / auto-discovered | Force a tenant id instead of starting from the multi-tenant default and inferring it from token claims |
| `M365_CHATSVC_REGION` | _(auto-discover)_ | Force the Teams chatsvc region instead of inferring it from Teams token claims |

Notes:

- Graph-backed consumer-account support now exists when an Outlook Live session is visible in the browser.
- Teams chat tools still require a work/school M365 account.
- For operational details, platform notes, and account-scope guidance, see [m365-experimental-extension.md](m365-experimental-extension.md).

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

The `ssh` tool stores chat-scoped profiles in SQLite and applies them immediately to live sessions when possible. That means the agent can switch a chat from local → remote → local again in the same turn/session without recreating the session runtime.

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

Preferred project-local config:

```text
/workspace/.pi/mcp.json
```

Starter example seeded on first startup:

```text
/workspace/.pi/mcp.json.example
```

Global Pi-home config also works:

```text
~/.pi/agent/mcp.json
```

In the container image that Pi home is typically bind-mounted under:

```text
/config/.pi/agent/mcp.json
```

Notes:

- prefer the project-local file when MCP servers are part of the current workspace
- config is merged from Pi-home config, optional imported tool configs, then project-local `.pi/mcp.json` overrides
- start a new chat/session or restart PiClaw after changing MCP config
- the adapter exposes the `mcp` tool plus `/mcp`, `/mcp status`, `/mcp tools`, `/mcp reconnect [server]`, and `/mcp-auth` commands
- `/mcp` opens the MCP management panel in the web UI and falls back to text status elsewhere
- `pi-mcp-adapter` does not require `mcp-cli`

### Default active tools

Piclaw now keeps the agent's always-active tool list intentionally small and uses
`list_internal_tools` and `activate_tools` to enable extra capabilities on demand.

Built-in default baseline:

- `read`
- `edit`
- `write`
- `bash` on Linux/macOS, or `powershell` plus `bun_run` on Windows
- `list_internal_tools`
- `activate_tools`
- `reset_active_tools`
- `attach_file`
- `messages`
- `keychain`
- `exit_process`

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

Notes:

- `reset_active_tools` restores this configured default set, not just the built-in baseline.
- Unknown tool names are ignored when the active tool list is applied.
- On Windows, `bash` is replaced by the `powershell` tool in the default active set.
- Newly activated tools become available immediately to subsequent tool/model steps in the same turn; keep critical control tools in the default baseline or config-defined defaults.

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
- the web workspace explorer now shows the current index status, last indexed time, indexed file count, configured roots, and a one-click reindex control
- `scope: notes` and `scope: skills` remain the built-in convenience filters; `scope: all` searches across the configured root set

### Dream and AutoDream

Memory maintenance has two trigger modes:

- `Dream` — manual `/dream [days]`
- `AutoDream` — built-in nightly scheduled task (`builtin-dream-midnight`)

Both modes now run as out-of-band model turns on a temporary `dream:` channel.
The dream channel is cleaned up after the cycle ends.
Before the model turn begins, runtime creates a pre-Dream `.zip` backup of `notes/daily/` and `notes/memory/`, prunes older Dream backups (default keep: 10), and refreshes/seeds in-window daily notes from the messages database.

Default windows:

- manual `Dream` keeps the historical default of 7 days unless you pass `/dream <days>`
- nightly `AutoDream` now defaults to a narrower 2-day window

AutoDream is gated, but nightly cadence no longer waits for a full 24-hour gap.
It runs when there has been activity since the last consolidation.

| Variable | Default | Purpose |
|----------|---------|---------||
| `PICLAW_DREAM_MODEL` | _(unset — inherits session model)_ | Pin Dream to a specific model label (e.g. `anthropic/claude-sonnet-4-20250514`). The scheduler switches before the Dream turn and restores the original model afterward. |
| `PICLAW_DREAM_BACKUP_KEEP` | `10` | Number of pre-Dream note backups to retain |

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

## Authentication (TOTP + passkeys)

You can gate the entire web UI behind a 6-digit TOTP challenge and optionally enable WebAuthn passkeys. Static assets needed by iOS/Android webapps (manifest, icons, avatars, `/static/*`) remain public so homescreen shortcuts keep working.

| Variable | Default | Purpose |
|----------|---------|---------|
| `PICLAW_WEB_TOTP_SECRET` | _(empty)_ | Base32 TOTP secret. When set, `/login` requires a 6-digit code before issuing a `piclaw_session` cookie. Leave unset to keep the UI open until you initialize TOTP with `/totp`. |
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

1. Set `PICLAW_WEB_TOTP_SECRET` to a base32 string (for example, output from `oathtool --totp -b`).
2. Restart piclaw.
3. Visiting the UI redirects to `/login`.
4. Enter the 6-digit code from your authenticator app to receive an HTTP-only `piclaw_session` cookie.
5. Sessions expire automatically after `PICLAW_WEB_SESSION_TTL` seconds or when you delete the cookie.
6. To re-display the active secret for another device, run `/totp` in the web UI.

#### Reset flow

1. Run `/totp reset <current-code>` in the web UI.
2. Piclaw verifies the current active TOTP code first.
3. If valid, Piclaw shows a single confirmation card containing the new QR/manual code plus a 6-digit confirmation input.
4. Scan the new secret and confirm it from the same card.
5. Only after successful confirmation does Piclaw commit the new secret and invalidate existing web sessions.
6. If final confirmation fails, the old secret and current sessions remain unchanged.

### Passkey enrolment

1. Sign in with TOTP.
2. Run `/passkey enrol` in the web UI to get a one-time enrolment link (valid for 5 minutes).
3. Open the link in the same browser and complete the passkey prompt. The enrol page requires a TOTP session — passkey-only sessions are not sufficient.

### Notes

- Multiple passkeys are supported per user; use `/passkey list` to review and `/passkey delete` to revoke.
- Passkeys are bound to the hostname used during enrolment (RP ID).
- Login attempts automatically try passkeys first when supported; TOTP remains as fallback unless you set `PICLAW_WEB_PASSKEY_MODE=passkey-only`.
- `/passkey enrol` still requires a TOTP-authenticated session. Passkeys are a login factor; TOTP remains the enrollment/bootstrap factor.
- All auth endpoints (`/auth/verify`, WebAuthn login, and enrol) are rate-limited per IP (10–20 attempts per 5 minutes).
- After five failed TOTP attempts in five minutes, the IP is temporarily locked out for five minutes (with audit logs emitted on failures).
- TOTP confirmation flows return explicit success/failure feedback and report whether the secret/session state changed.

Internal automation still works via `/internal/post` as long as the request includes the configured secret in the `x-piclaw-internal-secret` header or the `Authorization` header.

## Keychain secrets

See [keychain.md](keychain.md) for full details.

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

WhatsApp is optional. If `WHATSAPP_PHONE` is not set or empty, piclaw does not attempt to connect — no QR prompt, no reconnect logs. A no‑op stub is used internally so all other channels work normally.

If QR pairing fails (headless/server environments), provide a phone number to request a pairing code:

```bash
WHATSAPP_PHONE=1234567890
```

Or in `.piclaw/config.json`:

```json
{ "whatsappPhone": "1234567890" }
```

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
`/entrypoint.sh` now remaps the runtime `agent` user/group to those ids before
it initializes the home directory and piclaw-managed persistent state.

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
- The entrypoint intentionally does **not** recursively chown the entire
  `/workspace` bind mount, so existing project files outside piclaw-managed
  state keep their host ownership.
- If the requested uid/gid is already claimed by a different user/group inside
  the container, startup aborts with a clear error instead of silently picking a
  conflicting mapping.
- Changing `PUID` / `PGID` requires restarting/recreating the container.

## Cross-instance interop

Optional settings for multi-instance communication. See [cross-instance-ipc.md](cross-instance-ipc.md) for details.

| Variable | Default | Purpose |
|----------|---------|---------|
| `PICLAW_REMOTE_INTEROP_ENABLED` | `0` | Enable cross-instance interop endpoints |
| `PICLAW_REMOTE_INTEROP_ALLOW_HTTP` | `0` | Allow `http://` callback URLs (not just `https://`) |
| `PICLAW_REMOTE_SHORT_CIRCUIT_ENABLED` | `0` | Enable short-circuit execution mode |
| `PICLAW_REMOTE_INSTANCE_NAME` | _(empty)_ | Display name for this instance in interop metadata |
| `PICLAW_REMOTE_INTEROP_DECISION_MODEL` | _(empty)_ | Model label for interop mediation (metadata only) |
