# omp RPC Engine Pilot

PiClaw supports an alternative agent engine backend that runs [omp (Oh My Pi)](https://github.com/can1357/oh-my-pi) as a managed subprocess, speaking its bidirectional JSON-lines RPC protocol. This is a pilot path — the default engine remains the in-process Pi Coding Agent (`@earendil-works/pi-coding-agent`).

## Why a subprocess?

omp is a diverged fork of the same Pi Coding Agent lineage. Its session-construction API (`createAgentSession(options)`) collapsed the factory chain piclaw depends on (`createAgentSessionRuntime`, `DefaultResourceLoader`, `createAgentSessionFromServices`), and several `SessionManager` methods changed signatures. In-process replacement is not viable without a full session-layer rewrite. Instead, piclaw embeds omp as a child process and bridges its protocol into piclaw's existing event pipeline.

## Enabling

Set the environment variable before startup:

```bash
PICLAW_AGENT_ENGINE=omp-rpc
```

Or set it in `.piclaw/config.json` under `domains.agent.engine`:

```json
{ "domains": { "agent": { "engine": "omp-rpc" } } }
```

The setting is process-wide: every chat created while it is `"omp-rpc"` uses omp; every chat created while `"pi"` (default) uses the existing in-process engine. There is no per-chat toggle in this pilot.

## Prerequisites

- **omp must be installed and on PATH** (or set `PICLAW_OMP_BIN` to the binary path).
- **omp must be independently authenticated.** omp resolves provider credentials from its own home directory (`~/.omp/`), separate from piclaw's `~/.pi/agent/`. Run `omp` interactively and use `/login` to configure providers before enabling the pilot.

## Architecture

```
AgentPool.runAgent()
  ├── getAgentEngine() === "omp-rpc" → OmpRpcPool.runAgent()
  │     ├── getOrCreate(chatJid) → spawn omp --mode rpc --cwd <workspace> --session-dir <dir>
  │     ├── OmpRpcClient: ready handshake → set_host_tools → prompt → agent_end
  │     ├── Session events bridged via bridgeOmpFrameToAgentSessionEvent → options.onEvent
  │     └── Token usage recorded via recordSessionEventUsage
  └── else → runAgentPrompt() (existing pi path, unchanged)
```

### Components

| File | Responsibility |
|---|---|
| `runtime/src/agent-pool/omp-rpc/rpc-protocol-types.ts` | Wire types for the omp ndjson RPC protocol subset |
| `runtime/src/agent-pool/omp-rpc/client.ts` | Subprocess client: spawn, ready handshake, command/response correlation, host-tool dispatch, streaming event relay, shutdown |
| `runtime/src/agent-pool/omp-rpc/pool.ts` | Per-chat pool of OmpRpcClient instances; runAgent() bridges events and records usage |
| `runtime/src/agent-pool/omp-rpc/event-bridge.ts` | Translates omp session-event frames into piclaw AgentSessionEvent objects |
| `runtime/src/agent-pool/omp-rpc/host-tools.ts` | Harvests piclaw's built-in extension tools as omp host-tool definitions via a capturing ExtensionAPI shim |

### How piclaw tools work under omp

omp exposes RPC host tools to the model via its `xd://` internal-URL device idiom. When the model wants to use piclaw's `introspect_sql`, it reads `xd://introspect_sql` for the schema and writes JSON arguments to execute it. The host-tool bridge (`set_host_tools` / `host_tool_call` / `host_tool_result`) handles the round trip back to piclaw's real tool implementations.

### Smart compaction

piclaw's own smart-compaction extension is excluded from the omp host-tool set. omp manages its own context window compaction via its native `compact` RPC command.

## Limitations

- No shared provider auth: omp uses its own credential store, independent of piclaw's.
- No per-chat model sync: omp uses its own default model; piclaw's `ModelRegistry` is not bridged.
- No recovery/retry loop: the omp path returns a single attempt per prompt (no automatic-recovery phases).
- Streaming partial tool output (`tool_execution_update`) is not bridged — the wire shapes differ and it is not load-bearing for the pilot.
- Message-row persistence is handled by the channel layer (same as the pi path); the omp pool handles streaming and token-usage recording only.
