# Getting started

PiClaw runs one persistent single-user agent workspace. Docker and native installations use the same access validation; family accounts are removed.

## Docker

Start with the [README command](../README.md#quick-start-with-docker). It publishes port 8080 on the Docker host's loopback interface and mounts two host directories. Run it from a dedicated directory and keep that location for future upgrades.

- `--init` forwards signals and reaps child processes. Keep it enabled.
- `--restart unless-stopped` restarts the container after an unexpected exit or host reboot, unless you stopped it yourself.
- The image supports Linux AMD64 and ARM64; Docker Desktop supplies the Linux VM on macOS and Windows.
- On Linux, add `-e PUID="$(id -u)" -e PGID="$(id -g)"` if the container user needs to match your host user's ownership of the mounted directories.

Check startup with:

```bash
docker logs --tail 100 piclaw
docker ps --filter name=piclaw
```

If Docker runs on a remote host, open an SSH tunnel from your own computer, replacing `user@server` with that host:

```bash
ssh -N -L 8080:127.0.0.1:8080 user@server
```

Then visit `http://localhost:8080` on your computer. This keeps first-run setup off the public network. A localhost binding does not protect against other users on the same host.

### Docker Compose from source

The repository's [Compose file](../docker-compose.yml) uses the local `pibox:latest` image and names the container `pibox`. Build that image with `make build` before running `make up` or `docker compose up`; Compose does not build it automatically. Without the local image, Compose attempts to pull `pibox:latest` and fails with a pull-access error. It sets `init: true`, equivalent to `docker run --init`. Follow the [source-build workflow](development.md#build-from-source) to use it. It does not pull the published GHCR image.

## Portable releases

Download the matching runtime asset from [GitHub Releases](https://github.com/rcarmo/piclaw/releases). Choose a tagged release and read its release notes. Runtime bundles include Bun, PiClaw, web assets and production dependencies; they do not provide the Docker image's full set of external command-line tools or install optional add-ons.

| Platform | Asset suffix |
|---|---|
| Linux x64 | `linux-x64.run` |
| Older x64 CPUs without AVX | `linux-x64-baseline.run` |
| Linux ARM64 | `linux-arm64.run` |
| Apple Silicon macOS | `macos-arm64.tar.gz` |
| Windows x64 (experimental) | `windows-x64.zip` |

The `source.*` downloads are source archives, not runnable bundles. Their `source.SHA256SUMS` file covers those source archives, not the portable runtime assets.

### Linux

Replace `X.Y.Z` and the architecture in these examples with the downloaded filename. To unpack without a privileged installation:

```bash
chmod +x piclaw-X.Y.Z-linux-x64.run
./piclaw-X.Y.Z-linux-x64.run --extract ./piclaw-unpacked
./piclaw-unpacked/piclaw-X.Y.Z-linux-x64/bin/piclaw --version
```

To install system-wide instead:

```bash
sudo ./piclaw-X.Y.Z-linux-x64.run --install /opt/piclaw
```

The installer writes a versioned release under `/opt/piclaw/releases`, updates `/opt/piclaw/current`, and installs `piclaw` and `pi` launchers in `/usr/local/bin`. This can replace existing launchers of those names. `PICLAW_SKIP_BIN_LINK=1` disables launcher installation; `PICLAW_BIN_DIR` selects another launcher directory.

Installation does not configure a service or start PiClaw. Run the application as an ordinary user, not root.

### macOS and Windows

Extract the archive and use `bin/piclaw` on macOS or `bin\piclaw.cmd` on Windows. The macOS archive includes `install.sh`; Windows includes `install.ps1`. Read the bundled README before installing launchers. These are runtime bundles; the [desktop shell](desktop.md) is a separate experimental build.

Windows shell commands run in attached child processes to keep stdout/stderr capturable. Unix-like hosts use detached process groups so abort and shutdown can terminate the process tree. Windows does not have identical process-tree termination behaviour, and the web terminal is disabled there by default.

### Start a native workspace

With the launcher installed, run this from a Unix shell:

```bash
piclaw --workspace "$HOME/piclaw-workspace" --host 127.0.0.1 --port 8080
```

For an extracted bundle, substitute its launcher path. In Windows PowerShell, use `--workspace "$HOME\piclaw-workspace"` and the `bin\piclaw.cmd` launcher. Keep `--host 127.0.0.1` during setup: the runtime's default bind address is `0.0.0.0`.

The first start seeds missing workspace files, including `AGENTS.md`, skills and notes. Update `AGENTS.md` to describe your actual platform, workspace path, available tools and restart method; the seed describes a Debian container. Arrange service management separately if you need unattended restarts. Preserve the same workspace and Pi profile when changing launchers or service configuration.

## First chat

1. Open `http://localhost:8080` and send `/login` in chat.
2. Choose your provider and complete its credential or browser-authorisation flow. For custom OpenAI-compatible endpoints, use the provider setup controls; see [provider configuration](configuration.md#provider-setup-via-login) and [llama.cpp](llama-cpp.md).
3. Select an available model with `/model` and send a small file-creation request. Confirm that the file appears in the workspace browser.
4. Use Settings to select the UI language and appearance. Add optional integrations through [Settings and add-ons](settings-and-addons.md).

`/login` configures model access. Browser authentication is separate. Provider credentials and model metadata persist in the Pi profile, so do not add duplicate API keys to deployment variables unless a specific provider's setup requires them.

## Secure browser access

A fresh single-user instance permits unauthenticated access. Keep it on loopback or a private tunnel while setting up the login gate:

1. Send `/totp` in the web UI.
2. Scan the QR code into an authenticator app and confirm a current six-digit code in the card. The login gate is enabled only after successful confirmation.
3. Sign in with TOTP, then open **Settings → Authentication → Passkeys → Add passkey**. Name the key and complete the native browser prompt. You can add more keys after signing in with an existing passkey, including in passkey-only mode. Passkeys are bound to the hostname used for enrolment; choose the hostname you will actually use.
4. Before remote access, configure HTTPS and a [reverse proxy](reverse-proxy.md), or PiClaw's own [TLS settings](configuration.md#web-server). Enable `PICLAW_TRUST_PROXY=1` only behind a trusted proxy that overwrites forwarding headers; prevent clients from reaching the backend directly.

The [authentication reference](configuration.md#authentication-totp--passkeys) covers preconfigured TOTP, enrolment, reset, expiry and passkey-only policies. Do not select passkey-only mode before enrolling and testing a usable passkey. Protect provider credentials, downloaded files and backups independently of the browser login gate.

## Persistent files and backups

For the README's Docker command:

| Host path | Container path | Contents |
|---|---|---|
| `./home` | `/config` | Pi profile and Git configuration; `/home/agent/.pi` links to `/config/.pi` |
| `./home/.pi/agent/` | `/config/.pi/agent/` | Provider credentials (`auth.json`), model metadata (`models.json`) and other Pi profile state |
| `./workspace` | `/workspace` | Projects, notes, skills, `.piclaw` configuration, database and runtime data |

Native installs use your chosen workspace and Pi profile (normally `~/.pi/agent`, unless overridden). See [path overrides](configuration.md#path-overrides).

Saved conversations and settings persist on the server. Browser drafts and unsaved edits are not a backup. **Never delete `.piclaw/store/messages.db`**: it stores chat history, media, tasks, token usage, keychain entries and authentication records. Session data and workspace files must also be preserved; see the [storage inventory](storage.md).

For a simple consistent backup, stop PiClaw and copy both persistent directories, including hidden files, before restarting it. Preserve external configuration and the keychain bootstrap key or key file separately and securely. If backing up while running, use an atomic database snapshot and a coordinated file-backup procedure; copying a live SQLite database file alone is insufficient. A lost or changed keychain master key makes its encrypted secrets unreadable.

The optional `.env.sh` in the workspace supplies shell/startup environment overrides, such as `PATH` and `GH_CONFIG_DIR`. Invalid shell contents can break startup. Use the [environment hook reference](configuration.md#workspace-environment-hook-workspaceenvsh) and [keychain](keychain.md) for configuration and secrets respectively.

## Upgrades

1. Read the target release notes and record the current image tag or native release path.
2. Stop PiClaw and take a coordinated backup of its workspace, Pi profile, configuration and key material.
3. For Docker, pull the chosen `ghcr.io/rcarmo/piclaw:vX.Y.Z` tag, remove the stopped container and recreate it with the same mounts, ports and environment. Do not remove the mounted host directories. The README uses `latest` for initial setup; an explicit version avoids unexpected changes on recreation.
4. For a portable installation, install the new bundle or switch to its launcher. Reuse the existing workspace/profile and your platform's service manager; the installer does not restart a running process.
5. Check startup logs, model access and existing conversations/files before deleting any backup.

Database migrations can make older binaries incompatible. Keeping an old executable does not make a downgrade safe: restore a matching backup into a separate environment when necessary. Never delete database access markers or change access mode to force an older binary to start.

## First-run problems

| Symptom | Check |
|---|---|
| Browser cannot connect | Container/process logs, port conflicts and the host on which you opened the browser; remote Docker hosts need a tunnel or secured proxy |
| UI opens but the agent cannot answer | `/login`, the selected model, provider permissions and network access from the runtime |
| Local model server is unreachable from Docker | `localhost` inside a container is the container itself; use a host address reachable from its network |
| Provider login disappears after recreation | Both persistent mounts, especially `home/.pi/agent/`, and whether the service uses the same Pi profile |
| Uploads or edits fail | Ownership and permissions of the mounted workspace; match `PUID`/`PGID` where appropriate |
| Passkey or origin checks fail behind a proxy | HTTPS hostname, forwarding headers, proxy trust and direct-backend restrictions in the [proxy guide](reverse-proxy.md) |
