# Keychain

Piclaw includes an encrypted SQLite-backed keychain for storing tokens and username/password pairs and injecting them into tool environment variables. All secrets live inside `messages.db` (no extra files).

## How it works

- Secrets are stored in `keychain_entries` inside `/workspace/.piclaw/store/messages.db`.
- Each entry is encrypted with **AES-256-GCM**.
- Keys are derived with **PBKDF2-SHA256** using a per-entry salt.
- A per-entry nonce is stored alongside the ciphertext.
- Entry names are included as additional authenticated data (AAD) to prevent swaps.
- SQLite runs with `PRAGMA secure_delete=ON` so deletes overwrite data pages.

## Configuration

The keychain is disabled unless you provide a master key:

| Variable | Purpose |
|----------|---------|
| `PICLAW_KEYCHAIN_KEY` | Master key for encrypting/decrypting secrets |
| `PICLAW_KEYCHAIN_KEY_FILE` | Path to a file containing the master key |

If neither is set, keychain operations fail with a “Keychain is disabled” error.

## Entry format

Each entry stores:

- `name` (unique, freeform; e.g. `github/foo/bar`)
- `type` (`token`, `password`, `basic`, `secret`)
- `secret` (encrypted)
- `username` (optional, encrypted with the secret)

## Adding entries

Use the CLI (recommended):

```bash
PICLAW_KEYCHAIN_KEY="your-master-key" \
  piclaw keychain set github/foo/bar \
    --type token \
    --secret "ghp_xxx" \
    --username "octo"
```

Or with a secret file:

```bash
PICLAW_KEYCHAIN_KEY="your-master-key" \
  piclaw keychain set github/foo/bar \
    --type token \
    --secret-file /path/to/token.txt
```

You can update an entry by calling `set` again with the same name.

## Listing and deleting

```bash
PICLAW_KEYCHAIN_KEY="your-master-key" piclaw keychain list
PICLAW_KEYCHAIN_KEY="your-master-key" piclaw keychain delete github/foo/bar
```

## Agent tool

The agent has a `keychain` tool that can:

- **list** — list all entry names and types
- **get** — retrieve a secret or username by name
- **set** — store or update an entry (name, type, secret, optional username)
- **delete** — remove an entry by name

## Low-level API

If you need direct access, you can call the module directly:

```bash
PICLAW_KEYCHAIN_KEY="your-master-key" \
  bun -e 'import { initDatabase } from "./runtime/src/db.ts";
    import { setKeychainEntry } from "./runtime/src/secure/keychain.ts";
    initDatabase();
    await setKeychainEntry({
      name: "github/foo/bar",
      type: "token",
      secret: "ghp_xxx",
      username: "octo"
    });'
```

## Using entries in tools

Tool env maps can reference keychain entries with the `keychain:` prefix.

- `keychain:NAME` resolves to the stored secret.
- `keychain:NAME:username` resolves to the stored username.

Example:

```json
{
  "env": {
    "GITHUB_TOKEN": "keychain:github/foo/bar",
    "GITHUB_USER": "keychain:github/foo/bar:username"
  }
}
```

## Automatic bash environment injection

To align local and SSH bash flows, Piclaw now auto-injects keychain entries whose names are already valid shell env vars (for example `STRIPE_KEY` or `DATABASE_URL`) into every bash environment.

This applies to:

- local `bash`
- local Windows `powershell`
- `/bash` and `/shell`
- SSH-backed `bash` sessions via the `ssh` tool
- exec-style wrappers for supported Proxmox/Portainer flows

Example:

```bash
PICLAW_KEYCHAIN_KEY="your-master-key" \
  piclaw keychain set STRIPE_KEY \
    --type token \
    --secret "sk_live_xxx"

# Later, in bash or SSH-backed bash:
curl -H "Authorization: Bearer $STRIPE_KEY" https://api.stripe.com

# In PowerShell:
$env:STRIPE_KEY
```

Notes:

- Keychain entry names are sanitized into shell env names before auto-injection: `/`, `-`, and `.` become `_`, then the result is uppercased.
- Examples: `ssh/prod` → `$SSH_PROD`, `github/piclaw-bot-pat` → `$GITHUB_PICLAW_BOT_PAT`, `restic/azure-account-key` → `$RESTIC_AZURE_ACCOUNT_KEY`.
- Entries whose sanitized form is empty or begins with a digit are skipped.
- Explicit env maps using `keychain:...` still work for arbitrary entry names, including cases where you want a different env name than the auto-generated one.
- For `vm.agent.exec` and `container.exec`, use `shell_family=posix` for Linux/Unix targets and `shell_family=powershell` for Windows targets.
- Tool output is redacted against known keychain secret values for normal tool execution paths (bash, read, request results, SSH exec output, guest/container exec output).

## Using keychain placeholders in bash commands

The tracked bash runner also replaces `keychain:<name>` placeholders directly in command strings. This remains available as a fallback for arbitrary key names, but env-style auto-injection is the preferred path for bash and SSH bash:

```bash
/bash echo keychain:github/deploy
/bash "curl -H 'Authorization: Bearer keychain:github/token' https://api.github.com"
```

`keychain:<name>:username` resolves to the stored username (if present).

## SSH keys and known_hosts entries

The per-chat `ssh` tool expects SSH material to come from the keychain.

Typical entries:

- `ssh/prod` — type `secret`, secret = full OpenSSH private key
- `ssh/prod.pub` — optional public key copy
- `ssh/prod.known_hosts` — optional `known_hosts` text blob

Example:

```bash
PICLAW_KEYCHAIN_KEY="your-master-key" \
  piclaw keychain set ssh/prod \
    --type secret \
    --secret-file ~/.ssh/id_ed25519

PICLAW_KEYCHAIN_KEY="your-master-key" \
  piclaw keychain set ssh/prod.known_hosts \
    --type secret \
    --secret-file ~/.ssh/known_hosts
```

The runtime writes these values to temporary files with restrictive permissions and uses them for the SSH control connection.

## Agent prompt hints

When the keychain extension is active, the agent also gets prompt hints for:

- sanitized auto-injected env-style secret names
- likely SSH profiles from `ssh/*`
- likely Proxmox profiles from `proxmox/*` (used by the proxmox addon in [piclaw-addons](https://github.com/rcarmo/piclaw-addons))
- likely Portainer profiles from `portainer/*` (used by the portainer addon in [piclaw-addons](https://github.com/rcarmo/piclaw-addons))

This is intended to steer the agent toward the `ssh` tool and addon-provided `proxmox`/`portainer` tools instead of fetching raw credential material.

## Notes

- Entry names can be hierarchical (`github/foo/bar`).
- The keychain uses the current master key for all entries; rotating keys requires re-encrypting entries (not yet automated).
- Avoid logging secrets. The tool runner resolves keychain values only at execution time.
