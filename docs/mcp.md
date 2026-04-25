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

`pi-mcp-adapter` now follows a shared-MCP-first model.

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

Shared MCP config is preferred first; Pi-owned config remains the place for Pi-specific imports and overrides.

## Safe starter shell

The seeded examples are intentionally minimal and safe:

```json
{
  "mcpServers": {}
}
```

If you want a concrete starter server, for example filesystem access:

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

## Typical flow

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

## Notes

- `pi-mcp-adapter` does not require `mcp-cli`.
- MCP servers are lazy by default, so they do not connect until first use.
- `/mcp setup` provides guided onboarding for shared/compatibility MCP config.
- `/mcp-auth <server>` currently shows OAuth token-file setup guidance for HTTP/OAuth MCP servers; it is not a full interactive browser OAuth flow.
- Global `settings.toolPrefix` controls whether proxied/direct tool names are server-prefixed (`server`, `short`, or `none`).
- Global `settings.directTools` can expose all imported MCP tools as first-class Pi tools; per-server `directTools` can enable all tools or only a named subset.
- Keep large MCP servers behind the proxy unless you intentionally want `directTools`.
