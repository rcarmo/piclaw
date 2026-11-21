# Keychain

Piclaw includes an encrypted SQLite-backed keychain for tool credentials. Internal keychain entry ciphertext lives in `messages.db`; bootstrap key material, provider login files and external keychain backends have separate storage. Per-user TOTP seeds use dedicated auth tables and are never listed or injected through the generic keychain.

## How it works

- Secrets are stored in `keychain_entries` inside `/workspace/.piclaw/store/messages.db`.
- Each entry is encrypted with **AES-256-GCM**.
- Keys are derived with **PBKDF2-SHA256** using a per-entry salt.
- A per-entry nonce is stored alongside the ciphertext.
- Entry names are included as additional authenticated data (AAD) to prevent swaps.
- SQLite runs with `PRAGMA secure_delete=ON` so deletes overwrite data pages.

## Configuration

The service and CLI share the workspace's `.piclaw/config.json`. To use the keychain without setting an environment variable, add the path to a file containing the master key:

```json
{
  "keychain": {
    "keyFile": "/secure/path/piclaw-master-key"
  }
}
```

On Linux and macOS, use an absolute path outside the workspace in a directory controlled by the operator. The key file must be a non-empty regular file of at most 4 KiB, owned by the user running Piclaw, with mode `0600` or `0400`. The loader rejects symlinks, hard links and unsafe permissions. Settings contain only the path. This keeps the key out of environment variables, arguments and normal CLI output; a shell running as the same OS user can still read the file.

Piclaw uses these sources in order:

1. `PICLAW_KEYCHAIN_KEY` in the process environment.
2. `PICLAW_KEYCHAIN_KEY_FILE` in the process environment.
3. `keychain.keyFile` in the workspace configuration.

Existing environment settings still take precedence. To move an existing store to the protected-file option, use the **same master key**; changing the key would make existing entries unreadable. Use `piclaw --workspace /path/to/workspace …` if the CLI's default workspace is not the one the service uses.

Local encryption and decryption require a master key. Metadata listing and explicit external-provider lookup do not.

## Entry format

Each entry stores:

- `name` (unique, freeform; e.g. `github/foo/bar`)
- `type` (`token`, `password`, `basic`, `secret`)
- `secret` (encrypted)
- `username` (optional, encrypted with the secret)

## Adding entries

Use **Settings → Keychain** to enter or rotate a credential. For operator automation, configure the master key separately, then use a protected secret file to keep the value out of command history and process arguments:

```bash
piclaw keychain set github/foo/bar \
  --type token \
  --username octo \
  --secret-file /secure/path/token.txt
```

You can update an entry by calling `set` again with the same name.

## Listing and deleting

```bash
piclaw keychain list
piclaw keychain delete github/foo/bar
```

## Agent tool

The native `keychain` tool lists local entry metadata on demand. Call it with `{"action":"list"}` and optionally a case-insensitive `query` against entry or shell variable names, `limit` (1–200, default 50) and `offset` (default 0).

The result includes the entry name, type, eligible `shellEnv` (or `null`) and any deliberately agent-readable `agentNote` (up to 300 characters). Names, notes and results can enter model context and history. Keep credentials and instructions out of names and notes. Listing does not decrypt entries, read private notes, contact external providers or modify the store.

The tool has no `get`, `set` or `delete` action. Use Settings or the operator CLI for credential management. Agents should pass references to credential consumers and should not call the CLI to read, write or transmit secret values through tool arguments or output.

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

Piclaw injects an eligible keychain entry into a supported shell command only when that command text directly references its environment-variable name as `$NAME` or `${NAME}` (PowerShell also accepts `$env:NAME`; cmd accepts `%NAME%`). It sanitises entry names as described below. Dynamic lookups such as `process.env[name]` or Bash `${!name}`, and listing the environment with `env`, do not request injection. Other keychain entries need not appear in that command's environment.

This applies to:

- local `bash`
- local Windows `powershell`
- `/bash` and `/shell`
- SSH-backed `bash` sessions via the `ssh` tool
- exec-style wrappers for supported Proxmox/Portainer flows

Example:

After the operator saves `STRIPE_KEY`, a Bash command can pass `"$STRIPE_KEY"` to the process that needs it. In PowerShell, use `$env:STRIPE_KEY` in the same way. Do not send the value to stdout.

Notes:

- Auto-injection only considers local entries. Names already valid as shell identifiers keep their spelling and case. Other names map runs of `/`, `-` and `.` to `_`, discard remaining characters outside ASCII letters, digits and underscores, and convert to upper case.
- Examples: `ApiKey` → `$ApiKey`, `ssh/prod` → `$SSH_PROD`, `github/piclaw-bot-pat` → `$GITHUB_PICLAW_BOT_PAT`.
- Empty or digit-leading results are skipped. The first entry in SQLite name order wins on a collision. Check `shellEnv` on the entry you intend to use; choose an explicit reference when it is `null`.
- Explicit env maps using `keychain:...` still work for arbitrary entry names, including cases where you want a different env name than the auto-generated one.
- For `vm.agent.exec` and `container.exec`, use `shell_family=posix` for Linux/Unix targets and `shell_family=powershell` for Windows targets.
- Tool output is redacted against known keychain secret values for normal tool execution paths (bash, read, request results, SSH exec output, guest/container exec output).

## Using keychain placeholders in bash commands

The tracked bash runner supports legacy `keychain:<name>` placeholders in command strings. Inline substitution can place a secret in the executed command line. Prefer a keychain reference in a supported env map or a literal shell variable. Do not `echo` credentials, print the environment, or enable shell tracing while handling them.

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

Host-managed instructions describe credential references and command-scoped injection. They do not enumerate stored entries; use the inventory tool when needed. For example, when the consuming tool is available, pass an entry name in an SSH `private_key_keychain` or `known_hosts_keychain` field, or a Proxmox or Portainer `api_token_keychain` field.

## Notes

- Entry names can be hierarchical (`github/foo/bar`).
- The keychain uses the current master key for all entries; rotating keys requires re-encrypting entries (not yet automated). Preserve existing key material and historical authentication records in backups.
- Family-shared mode intentionally shares tool/provider credentials and workspace access. Per-user factors are separate to avoid accidental exposure, not to confine hostile users with shell/filesystem access. Family mode remains startup-disabled.
- Avoid logging secrets. The tool runner resolves keychain values only at execution time.

## External keychain providers

Extensions can register platform-native or third-party secret management backends as fallback providers. Secrets are still looked up in the internal encrypted keychain first; external providers are queried only when an entry is not found locally.

### Lookup order

```
1. Internal SQLite keychain (encrypted, always checked first)
2. Registered external providers (in registration order)
```

### Registering a provider

Extensions register providers during initialization via `registerKeychainProvider()`:

```typescript
import { registerKeychainProvider } from "../secure/keychain-providers.js";

registerKeychainProvider({
  id: "macos-keychain",
  label: "macOS Keychain",

  async get(name) {
    // Shell out to `security find-generic-password` or use a native binding.
    // Return { name, type, secret, username? } if found, or null.
    const result = await lookupMacOSKeychain(name);
    return result ?? null;
  },

  async list() {
    // Return metadata (name + type) for discoverable entries.
    // No secrets are returned here.
    return [
      { name: "github/token", type: "token", source: "macos-keychain" },
    ];
  },

  // Optional: allow the agent to store secrets in this backend.
  async set(entry) {
    await storeMacOSKeychain(entry.name, entry.secret);
    return true;
  },

  // Optional: allow the agent to delete secrets from this backend.
  async delete(name) {
    return await deleteMacOSKeychain(name);
  },
});
```

### Provider interface

| Method | Required | Signature | Purpose |
|--------|----------|-----------|----------|
| `get` | ✅ | `(name: string) => Promise<Entry \| null>` | Retrieve a secret by name |
| `list` | ✅ | `() => Promise<Metadata[]>` | List available entries (no secrets) |
| `set` | optional | `(entry: Entry) => Promise<boolean>` | Store a secret |
| `delete` | optional | `(name: string) => Promise<boolean>` | Remove a secret |

### Compatibility

All existing keychain consumers work without changes:

- **Operator CLI `piclaw keychain list`** and the agent inventory list local entries only. The low-level `listAllKeychainEntries()` API can also query external metadata.
- **Operator CLI `piclaw keychain get`** and explicit credential references — fall back to external providers when internal lookup misses.
- **Automatic shell injection** — local entries only. Use a supported explicit `keychain:NAME` env reference or credential-reference field for an external entry.
- **SSH key and legacy placeholder resolution** — can resolve explicit references through external providers.

### Error handling

- Providers that throw during `get()` or `list()` are skipped with a warning log; other providers continue to be queried.
- A broken provider never blocks lookups.

### Example use cases

| Provider | Backend | What it enables |
|----------|---------|------------------|
| `macos-keychain` | macOS `security` CLI | Bridge secrets from the system keychain on dev machines |
| `1password` | 1Password CLI (`op`) | Resolve secrets from team vaults |
| `azure-keyvault` | Azure Key Vault REST API | Production secrets from managed identity |
| `hashicorp-vault` | Vault HTTP API | Enterprise secret management |
| `bitwarden` | Bitwarden CLI (`bw`) | Personal password manager integration |

### Lifecycle

- Providers are registered at extension load time and persist for the process lifetime.
- `unregisterKeychainProvider(id)` removes a provider (useful during extension shutdown).
- Provider state is in-memory only — the registry is rebuilt on each process start.

Settings exposes secret-free storage availability (`ready`, `not_configured`, or
`unavailable`) and disables adding entries when local encrypted storage cannot
load key material. Restart through the normal operator workflow after changing
bootstrap configuration. External-provider listing remains independent.
Failed web writes log an outcome/reason only, never the entry name, posted secret,
notes, key material or configured path.
