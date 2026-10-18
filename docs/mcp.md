# MCP via pi-mcp-adapter

PiClaw ships [`pi-mcp-adapter`](https://github.com/nicobailon/pi-mcp-adapter) so you can use external MCP servers without exposing every MCP tool directly in the base prompt.

## What ships

- bundled `pi-mcp-adapter` dependency
- automatic extension loading in PiClaw sessions
- shared project starter config at `.mcp.json.example`
- Pi-specific override starter config at `.pi/mcp.json.example`
- workspace skill guidance under `.pi/skills/mcp-adapter/` when present

The adapter exposes one primary proxy tool:

```text
mcp({ ... })
```

and slash commands such as:

```text
/mcp
/mcp status
/mcp tools
/mcp reconnect
/mcp reconnect <server>
/mcp setup
/mcp-auth <server>
```

In the web UI, plain `/mcp` opens the MCP management panel. In non-UI contexts it falls back to a text status summary.

## Config locations

`pi-mcp-adapter` uses a shared-MCP-first lookup order.

Preferred shared config locations:

1. user/global shared MCP config: `~/.config/mcp/mcp.json`
2. project-local shared MCP config: `/workspace/.mcp.json`

Pi-specific override layers still work:

3. Pi-home config: `~/.pi/agent/mcp.json` (or an override path passed via `--mcp-config`)
4. project-local Pi override: `/workspace/.pi/mcp.json`

Use the shared files when the MCP configuration should also be usable by other MCP-aware tools. Use the Pi-owned files only for PiClaw-specific overrides.

Starter examples seeded on first startup:

```text
/workspace/.mcp.json.example
/workspace/.pi/mcp.json.example
```

In the container image, Pi home is typically bind-mounted at:

```text
/config/.pi/agent/mcp.json
```

## Imports from other tool configs

`pi-mcp-adapter` can also import MCP server definitions from other tools through its Pi-owned config layers. Current supported import kinds include:

- `cursor`
- `claude-code`
- `claude-desktop`
- `codex`
- `windsurf`
- `vscode`

Shared MCP config comes first; Pi-owned config is for PiClaw-specific imports and overrides.

## Keychain-backed bearer tokens

PiClaw can resolve an HTTP MCP bearer token from its encrypted keychain before the adapter starts. The effective configuration is loaded once into an immutable, revisioned bridge snapshot; sessions never reread raw MCP config:

```json
{
  "mcpServers": {
    "memory": {
      "url": "https://mcp.example.test/mcp",
      "auth": "bearer",
      "bearerTokenKeychain": "mcp/memory",
      "bearerTokenEnv": "PICLAW_MCP_MEMORY_TOKEN"
    }
  }
}
```

Store the token with `piclaw keychain set mcp/memory --type token --secret-file <path>`. `bearerTokenKeychain` and `bearerTokenEnv` must appear together. The decrypted token is retained in a generation-scoped secret map, never added to global `process.env`. Each live session receives an immutable per-server environment containing only referenced variables, that server's credential and required operational values. Concurrent/replacement sessions retain their generation until the final lease releases it. The token is not written into MCP config, bridge snapshots, dry-run output, diagnostics, metadata caches or transcripts.

Do not combine `bearerTokenKeychain` with a literal `bearerToken`, and choose a dedicated environment variable name that is not already set.

## Environment expansion

`pi-mcp-adapter` 2.15.0 expands `${NAME}`, `$env:NAME`, and `{env:NAME}` in MCP `socket`, `env`, `cwd`, `url`, HTTP `headers`, and `bearerToken` values. Plain `$NAME` is intentionally literal. A leading `!!` preserves a literal leading `!`; a leading single `!` is an adapter command-secret expression.

PiClaw validates all supported environment references before loading the adapter, after keychain-backed references are resolved in memory. Missing variables quarantine only the affected optional server instead of becoming empty stdio/header values. Literal bearer tokens, literal sensitive headers/environment fields and literal OAuth client secrets are quarantined and removed from every exported snapshot. Command-secret expressions are not executed by loading or dry-run; they run once inside the server-scoped environment only when the eligible server connects.

## Safe starter shell

The seeded examples contain no configured servers:

```json
{
  "mcpServers": {}
}
```

For a concrete starter server, for example filesystem access:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "bunx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "."
      ],
      "lifecycle": "lazy"
    }
  }
}
```

## Bridge snapshots and safe writes

The bridge preserves source provenance for the shared-global, Pi-global, shared-project and Pi-project layers plus approved imports. Project precedence remains unchanged. Invalid higher-precedence server entries become disabled tombstones, so they cannot reveal a lower definition with the same name; a malformed project override fails the complete lower projection closed.

A redacted dry-run classifies every server as `mapped`, `blocked`, or `quarantined`. This is a migration preview only: socket, lazy/idle lifecycle, resource policy, auth, per-request headers and other adapter-only semantics remain blocked from native 0.99.1 projection rather than being approximated. `pi-mcp-adapter` remains the sole runtime owner.

Authorized project-override writes require the current bridge revision, reject unknown/malformed fields and literal secrets, lock the Piclaw-owned `.pi/mcp.json` directory, reject symlink components, write a `0600` temporary file, fsync, rename and reload the bridge. Stale/failed writes leave the active snapshot unchanged.

## Setup flow

1. Start with shared project config in `.mcp.json`
2. Add one or more MCP servers, or run `/mcp setup`
3. Use `.pi/mcp.json` only if you need Pi-specific overrides/imports
4. Start a new PiClaw chat/session or let adapter-driven setup reload PiClaw
5. Discover tools with:
   - `mcp({})`
   - `mcp({ search: "..." })`
   - `mcp({ describe: "tool_name" })`
   - `/mcp`
   - `/mcp status`
   - `/mcp tools`
   - `/mcp reconnect [server]`
6. Call tools through the proxy:

```text
mcp({ tool: "filesystem_read_file", args: "{\"path\":\"./README.md\"}" })
```

`args` must be a JSON string.

## Optional Parallel Search preset

In **Settings → MCP → Adapter servers**, select **Use Parallel Search preset**,
review the populated fields, then **Preview server change**. Acknowledge the
session reload and select **Apply server change** to enable it in current and new
sessions. The same flow is available in Classic and Visual.

[Parallel Search MCP](https://docs.parallel.ai/integrations/mcp/search-mcp)
provides free web search and page fetching without an account or API key.
Anonymous searches use Fast mode and are subject to service rate limits. The
preset uses Streamable HTTP, connects lazily, and keeps `web_search` and
`web_fetch` behind the existing `mcp` proxy. First connect the lazy server with
`mcp({ connect: "parallel-search" })`. Then discover its tool names and schemas
with `mcp({ search: "parallel-search" })` and
`mcp({ describe: "<tool name>" })`.
Call a discovered tool with `mcp({ tool: "<tool name>", args: "<JSON arguments>" })`.
Search takes `objective` and `search_queries`; fetch takes `urls`. Reuse one
`session_id` across related calls in a conversation. Search results include
source URLs and excerpts; fetch can extract those pages for follow-up reading.

No search provider is selected automatically. The existing DuckDuckGo/SearXNG
skills and configured MCP servers remain available. The preset is unavailable
when a server named `parallel-search` already exists, including a disabled or
inherited definition. Select that server to inspect or edit it instead. To stop
using the new server, select it and use **Preview disable**, then Apply. Existing
tool authorization and owner-only settings controls still apply.

The preset sets a 60-second protocol request timeout; the existing PiClaw outer
MCP guard also applies. Errors and quotas are returned through the proxy without
switching providers. Authentication remains opt-in through the normal MCP
configuration and keychain references.

## Tool authorization filters

Per-server `includeTools` and `excludeTools` are authorization controls for the adapter's model-visible surfaces, not only prompt-size filters. They apply to direct tools and to generic proxy status, list, search, describe, resource reads, and tool calls. Exclusions take precedence over inclusions.

The adapter evaluates the active server policy against the underlying raw MCP tool/resource name for both raw and prefixed requests. Cached metadata cannot grant access after configuration changes. Denied proxy calls stop locally before server connection or transport invocation and return a structured `tool_not_allowed` error.

For example, a read-only projection can be defined as:

```json
{
  "mcpServers": {
    "workiq": {
      "command": "workiq.exe",
      "includeTools": ["retrieve", "fetch", "list_agents"],
      "excludeTools": ["create_entity", "update_entity", "delete_entity", "do_action"]
    }
  }
}
```

Use `excludeTools` as defense in depth, not as a substitute for least-privilege credentials or server-side authorization.

## Timeout, abort, and output handling

`pi-mcp-adapter` 2.15.0 forwards Pi abort signals into connect, discovery, resource, and tool requests. It also applies `requestTimeoutMs` consistently across those request types. Configure a global protocol-request timeout in the active MCP configuration file:

```json
{
  "settings": {
    "requestTimeoutMs": 120000
  },
  "mcpServers": {}
}
```

A server-level `requestTimeoutMs` overrides the global value. If it is omitted or set to `0` or any negative value, the MCP SDK default applies.

For compatibility with existing installations, PiClaw also keeps an outer 120-second guard around registered MCP tools. Override it with `PICLAW_MCP_TOOL_TIMEOUT_MS`, or set that variable to `0` to disable only the outer guard. The shorter of the PiClaw guard and the adapter/SDK request timeout wins, so increase both settings when requests must run for more than two minutes.

The adapter also guards oversized MCP output by default and spills excess text to temporary files. Set `settings.outputGuard` to `false` to disable it, or provide `{ "maxBytes", "maxLines", "detailsMaxBytes" }` to tune the thresholds.

## Notes

- `pi-mcp-adapter` does not require `mcp-cli`.
- MCP servers are lazy by default, so they do not connect until first use.
- `/mcp setup` provides guided onboarding for shared/compatibility MCP config.
- Interactive sessions can authenticate with `/mcp-auth`; remote/headless sessions can use the proxy tool's `auth-start` and `auth-complete` actions.
- Global `settings.toolPrefix` controls whether proxied/direct tool names are server-prefixed (`server`, `short`, or `none`).
- Global `settings.directTools` can expose all imported MCP tools as first-class Pi tools; per-server `directTools` can enable all tools or only a named subset.
- Keep large MCP servers behind the proxy unless you deliberately enable `directTools`.

## Legacy instance-config permission migration

On startup and before selecting an MCP owner, Piclaw tightens an existing
owner-owned, single-link regular `.piclaw/config.json` to mode `0600` on qualified
POSIX hosts. The migration uses a no-follow file descriptor and does not rewrite
configuration contents. Symlinks, hardlinks, foreign ownership and unverifiable
ownership are not repaired or trusted.

If an instance MCP policy cannot be safely read or migrated, ordinary agent
sessions still start with a warning diagnostic, **without MCP or codemode**.
MCP registration remains blocked; no default adapter is selected from untrusted
contents. Settings reads/writes remain strict. After repairing the configuration,
restart to replace degraded sessions before applying MCP settings. An explicit
unsupported native owner or a failed/in-progress MCP transition remains fenced;
those are not permission-migration fallbacks.

Upgrade acceptance must exercise real session creation and agent output as well
as HTTP/service health. A healthy web endpoint alone does not qualify a rollout.
